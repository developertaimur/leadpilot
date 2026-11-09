# LeadPilot

WhatsApp lead CRM. Leads arrive inbound via the WhatsApp webhook or outbound via campaigns
(Google Sheets import + batch send). Inbound messages get AI-generated replies, with a human-takeover
switch so staff can step into any conversation. The AI may suggest a lead stage; only a person changes it.

New machine? Follow **`docs/SETUP.md`** (written for a setup agent; it covers both repos, OpenWA, XAMPP MySQL,
the database import, `.env` and the webhook).

## Stack
- Node.js (v26), **CommonJS**, Express 5 — entry point `backend/server.js`, all routes mounted under `/api`
- Prisma 7 (`prisma-client-js`) + MySQL/MariaDB (XAMPP, MariaDB 10.4) via `@prisma/adapter-mariadb`.
  MySQL on Windows stores table names in lowercase (`lead`, `conversation`, …).
- **WhatsApp: OpenWA** (separate open-source gateway, https://github.com/rmyndharis/OpenWA, unmodified), running in
  Docker (`docker-compose.dev.yml`, container `openwa-api`) at `http://127.0.0.1:2785`. Auth header `X-API-Key`;
  one session (UUID). Engine `baileys`; `RESOLVE_LID_TO_PHONE=true`; `SSRF_ALLOWED_HOSTS=host.docker.internal`.
  The old Meta WhatsApp Cloud API code is gone.
- Google Sheets API (service account) for campaign imports
- AI: Gemini (`@google/genai` 2.18) primary, Groq (`groq-sdk` 1.5) fallback — **built and wired**
- Socket.IO — installed, not wired

All commands run from `backend/`. Dev server: `npm run dev` (nodemon). Tests: `npm test` (node:test).

## Structure (`backend/src`)
Requests flow: route → controller → use case → repository → Prisma.

| Folder | Purpose |
|---|---|
| `api/routes/` | Express routers, one per resource. No logic. |
| `api/controllers/` | Read `req`, call one use case, map errors to HTTP status. No business logic. |
| `api/middleware/` | `jsonBody` (express.json, 512kb, keeps the raw body for signatures), `verifyOpenWASignature`. |
| `application/useCases/` | One business action per file (`<verb><Noun>.useCase.js`). Validation and orchestration live here. |
| `application/ai/` | `contextBuilder.js` (pure prompt builder), `generateReply.js` (provider manager), `autoReply.js` (switch + per-conversation queue). |
| `domain/rules/` | Pure functions, no I/O: `phoneNumber.rules` (E.164), `whatsappChatId.rules`, `leadStage.rules` (`stageChangeData`). `domain/entities/` is empty. |
| `infrastructure/database/` | `prismaClient.js` singleton + one repository per model. Only place that touches Prisma. |
| `infrastructure/whatsapp/` | `openwa.client.js` (`sendText`, `getSessionStatus`, `resolveLidPhone`, `OpenWAError`), `openwa.webhook.js` (`verifySignature`, `parseIncoming`, `logSafeId`). |
| `infrastructure/ai/` | `gemini.client.js`, `groq.client.js` (`generateStructuredReply` + `GeminiError`/`GroqError`), `replyValidation.js` (shared strict JSON validation, `STAGES`). |
| `infrastructure/channels/` | `channelSenders` registry: `Conversation.channel` → send function (WHATSAPP → OpenWA). |
| `infrastructure/http/` | `connectionErrors.failedBeforeConnecting` (shared by the HTTP clients). |
| `infrastructure/sheets/` | Google Sheets reader (rows keyed by header). |
| `infrastructure/realtime/` | Empty — Socket.IO goes here (Phase 3). |
| `config/env.js` | The only module that reads `process.env`. |

## Schema (`backend/prisma/schema.prisma`)
- **Lead** — name?, phoneNumber (unique, E.164), stage `LeadStage`, **aiSuggestedStage** `LeadStage?`,
  **aiSuggestionReason** `String? @db.Text`, source?, campaignId?
- **Conversation** — one per lead (`leadId` unique), `humanTakeover` bool, `channel` (WHATSAPP)
- **Message** — conversationId, sender `LEAD|AI|HUMAN`, content (Text), whatsappMessageId? (unique, dedupes webhook retries)
- **Campaign** — name, source?, status `ACTIVE|PAUSED`, googleSheetId?, googleSheetTabName?, defaultRegion?
- **BusinessProfile** — single row (read `findFirst` ordered by id asc): name, context, salesInstructions? (Text)
- `LeadStage`: NEW, CONTACTED, INTERESTED, QUALIFIED, CONVERTED, LOST
- Latest migration: `20261106002146_add_ai_suggestion_to_lead`

## Env settings (names only; values live in `backend/.env`, never in git — see `backend/.env.example`)
`DATABASE_URL`, `PORT`, `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`, `DEFAULT_PHONE_REGION`, `OPENWA_BASE_URL`,
`OPENWA_API_KEY`, `OPENWA_SESSION_ID`, `OPENWA_WEBHOOK_SECRET`, `BATCH_DELAY_SECONDS` (45),
`BATCH_DAILY_CAP` (20), `BATCH_MAX_CONSECUTIVE_FAILURES` (3), `GEMINI_API_KEY`, `GROQ_API_KEY`,
`AI_AUTO_REPLY_ENABLED` (on only for `true`, trimmed, any case; anything else is off).

## What is built
- CRUD + filters/stats for leads, campaigns, conversations, messages
- Google Sheets → leads sync (per-campaign region, only updates leads still at NEW)
- **Webhook** `POST /api/whatsapp/webhook` (OpenWA):
  - HMAC-SHA256 of the **raw body** in `X-OpenWA-Signature` (`sha256=<hex>`), secret `OPENWA_WEBHOOK_SECRET`; bad/missing → 401.
  - Only `message.received` is handled. Ignored with 200 (one info line): own messages (`fromMe`), groups and non-1:1
    chats, unsupported types, empty text. Other events → 200, no log. Malformed → 400.
  - Media is saved as a placeholder: `[voice note]`, `[audio]`, `[image]`, `[video]`, `[document]`, `[sticker]` (+ caption).
  - `@lid` senders: OpenWA's `senderPhone`, else one `resolveLidPhone` lookup, else skipped.
  - Dedupe by whatsappMessageId; auto-create lead (source `whatsapp_inbound`) + conversation; save the LEAD message.
  - Answers 200 only after the save (500 on a save failure, so OpenWA retries). GET is not served.
- `GET /api/whatsapp/status` — proxies the OpenWA session status (`configured`, `reachable`, `status`, `ready`; 502 on OpenWA errors)
- Outbound AI/HUMAN messages via the channel registry; the first outbound moves NEW → CONTACTED (inside `createMessage`)
- Campaign `send-batch` — 202 at once, sends in the background one lead at a time, `BATCH_DELAY_SECONDS` between sends,
  rolling 24 h cap, stops on SEND_PACING_LIMITED / NOT_CONFIGURED / N failures in a row; "unknown outcome" sends keep
  their conversation (never greeted twice). Greeting is a fixed text.
- BusinessProfile: `GET` + `PUT /api/business-profile` with partial updates
- **AI reply pipeline** (see below), behind `AI_AUTO_REPLY_ENABLED`
- **AI stage suggestions**: review queue = `GET /api/leads?aiSuggestedStage=<STAGE>` (invalid value → 400 with a fixed
  message; combines with `stage`, `source`, `channel`). Any stage change clears the suggestion.
- Human takeover: `PATCH /api/conversations/:id/takeover` `{ "humanTakeover": true|false }`
- node:test suite: **263 tests**

## AI reply pipeline (built)
1. **Webhook → `autoReply.scheduleReply(conversationId, messageId)`**, called only after `res.sendStatus(200)`, only for a
   message saved just now (not a duplicate/skip/ignore/failure). Media placeholders trigger it too.
   - Switch off → does nothing. Never throws, never rejects; jobs start on a later event-loop turn.
   - In-memory queue per conversation: jobs run one after another, conversations in parallel; the map entry is removed
     when idle. One process only; lost on restart (no retry by design).
2. **`replyToLead(conversationId, triggerMessageId)`** (never throws; one log line per call, ids/codes only):
   load conversation + lead (`findConversationWithLead`) → skip if `humanTakeover` → load business profile and the last
   20 messages (`findLastMessagesByConversation`) → **superseded before AI** unless the newest message is the trigger →
   `buildAiRequest` (no context → `no_business_context`; null → `nothing_to_answer`) → `generateReply` → re-read: takeover
   on → `human_takeover_during_ai`; newer message → `superseded` → send+save via `createMessage` (sender AI) → if
   `suggestedStage` ≠ the **reloaded** stage, `setAiSuggestion` → if `requiresHuman`, `setHumanTakeover(true)` **after**
   the send. If the send fails and `requiresHuman` was true, takeover is still set (never when false).
   Statuses: `skipped` (reason), `send_failed` (errorCode), `replied` (provider, requiresHuman, suggestionSaved,
   errorCode), `failed` (step, errorCode; also BAD_REQUEST for bad ids).
3. **`generateReply({ request, currentStage })`**: exactly one Gemini call; Groq **only** on a real `GeminiError` QUOTA
   (429); any other failure → the fallback. Never throws for provider failures (bad `currentStage` → TypeError).
   Post-processing: CONVERTED → null; equal to the current stage → null; reason kept. One log line at most
   (`AI reply: gemini quota, used groq`, `AI reply: gemini api_error 503, used fallback`, …).
   Fallback (requiresHuman true, reason `AI unavailable`):
   `Thank you for your message. Our team will get back to you shortly.` + newline +
   `Aapke message ka shukriya. Hamari team jald hi aap se rabta karegi.`
4. **Context Builder `buildAiRequest({ businessProfile, messages, lead })`** — pure. System instruction layers in order:
   `=== LAYER 1: ENGINE RULES (fixed) ===` (8 rules + output fields, in code), `=== LAYER 2: SALES INSTRUCTIONS ===`
   (skipped when empty), `=== LAYER 3: BUSINESS CONTEXT ===` (with `Business name:`), `=== LEAD FACTS ===` (stage and a
   filtered first name). Turns: last 20, LEAD→user, AI/HUMAN→model, empties dropped, same-role merged with `\n`, a
   leading model turn gets the fixed user note `(chat history starts here)`, must end with the lead or → null.
   Message text never goes into the system instruction; no ids, phones or timestamps in the output.
5. **Providers**: Gemini `gemini-3.5-flash` (responseSchema, 20 s timeout, no retries); Groq `openai/gpt-oss-20b`
   (strict `json_schema`, `reasoning_effort: 'low'`, `max_completion_tokens: 2048`, `maxRetries: 0`, `logLevel: 'off'`).
   Error codes: QUOTA, TIMEOUT, NOT_CONFIGURED, INVALID_RESPONSE, UNREACHABLE, API_ERROR (with status).
   Output `{ reply, suggestedStage, reason, requiresHuman }`, strictly validated (reply ≤ 4096 chars).
6. **Stage writes**: `leadRepository.updateLeadStage` is the **only** writer of `Lead.stage` and always clears both
   suggestion fields (`stageChangeData`). Callers: `PATCH /api/leads/:id/stage` (patching the current stage = dismissing
   the suggestion) and `createMessage`'s NEW → CONTACTED move. The AI path writes suggestions only through
   `setAiSuggestion` (positive lead id, never CONVERTED, reason trimmed, empty → null). Tests scan the AI files to
   prove no stage writer is named.

## Not built / next
- **Next step:** a separately approved end-to-end run with the owner's test number (real OpenWA + AI, switch on).
  `findConversationWithLead` has not been smoke-tested against the dev DB yet.
- Idea (not decided): also try Groq when Gemini returns 503 (today a 503 gives the fallback + takeover).
- Phase 3: Socket.IO realtime; split `server.js` into `app.js` + `server.js`.
- Phase 4 hardening: auth on all endpoints; `prismaClient.js` must read `DATABASE_URL` via `env.js` (it still uses
  `process.env` directly — a known violation); 400 vs 500 error mapping; proposal for lowercase table names.
- Phase 5: update docs, Postman collection, README, manual end-to-end checklist, AI Settings dashboard (needs auth first).
- Non-text inbound content (voice transcription, media), multi-message webhook batches.

## Locked rules
### Code
- **All `process.env` access goes through `src/config/env.js`.** Everything else imports from it.
  (Exception: `prisma.config.ts`, which is Prisma CLI config.)
- CommonJS only (`require` / `module.exports`).
- Prisma 7: generator `prisma-client-js`, import from `@prisma/client`, `PrismaClient` must get the
  `PrismaMariaDb` adapter. Do not switch to the `prisma-client` generator or a custom `output` path.
- Keep the layering: controllers never import repositories for business actions; use cases never touch `req`/`res`.
- Call dependencies through their module objects at call time (`repo.fn()`, not destructured), so tests can mock them.
- **AI never changes `Lead.stage`.** Only `updateLeadStage` writes it.
- **Logs never contain message text, names, phone numbers, API keys or secrets** — ids and codes only. Errors are
  reported by code (`err.code`, `HTTP_<status>`, `err.name`), never by `err.message`.

### Workflow
- **Design decisions are made in the mentor chat.** For every task, propose a plan and wait for approval
  before editing. Don't redesign locked decisions. If something conflicts with this file, stop and ask.
- **One task = one small change = one commit.** Never touch files outside the task.
- **Never commit or push unless the owner sends the git commands.** End commit messages with the
  `Co-Authored-By` line the harness gives.
- **Never read or print values from `backend/.env`** (or OpenWA's `.env`/`data/`). Hide Prisma's "Datasource" line.
  When showing phone numbers, show only the last 4 digits.
- **No real Gemini, Groq or OpenWA calls and no real database writes** unless the owner explicitly authorizes them
  for one task (e.g. "exactly one real Groq call"). Never retry such a call.
- Dev-database checks are **smoke tests**: a temp script in the scratchpad (deleted afterwards), the real
  repositories, `fetch` replaced by a throwing function first, read-only counts before/after, throwaway rows with a
  reserved fake number (+12025550199) deleted by id in `finally`. Each needs separate approval.
- Temp scripts go in the scratchpad and are deleted afterwards.
- Windows: **stop the dev server before any `npx prisma migrate` / `npx prisma generate`**, then fully
  restart it. nodemon ignores `node_modules`, so it will not pick up a regenerated client.
- Windows: use `curl.exe`, not `curl` (PowerShell aliases `curl` to `Invoke-WebRequest`).
- Do not install dependencies without approval.

### Testing workflow (standing rules)
- Every code change includes tests. Run `npm test` before reporting a task done, and report the full
  results, changed files and final diff. Existing tests must pass unedited; if one needs changing, stop and ask.
- Tests use `node:test` with zero extra dependencies. Files live in `backend/test/**/*.test.js`.
  Never run `test-send-whatsapp.js` (it sends a real WhatsApp message).
- All external services are mocked: WhatsApp/OpenWA, Gemini, Groq, Google Sheets. The fetch guard in
  `test/setup.js` (blocks non-local hosts and port 2785) and the fake values in `test/test.env` must stay in place.
- Whenever a new key is added to `src/config/env.js`, add a fake value for it to `test/test.env` and
  extend `test/safety.test.js` in the same task.
- Never modify real dev or production data in tests. Integration tests against a database are not
  allowed until a separate isolated test database is approved (the test `DATABASE_URL` points at a dead port).
- If an implementation failure appears, show the failure and the proposed fix before changing
  application code.
- Turn the AI switch on per test with `mock.property(env, 'aiAutoReplyEnabled', true)`; tests that start background
  jobs `await autoReply.whenIdle()` in `afterEach`.

Test layout: `test/test.env` (fake env, loaded via `--env-file`), `test/setup.js` (blocks non-local
`fetch`), `test/helpers/startApp.js` (mounts routers under `/api` on a random port), `test/helpers/invalidReplies.js`,
`test/safety.test.js` (canary — if it fails, stop), `test/config/`, `test/domain/`, `test/infrastructure/`,
`test/ai/`, `test/useCases/`, `test/routes/`.
Mock with `mock.method(moduleObject, 'fn')` and always `mock.restoreAll()` in `afterEach`.

**Known limits**
- `syncCampaignFromSheet` destructures `getSheetRows` at require time, so it can't be mocked yet.
- `server.js` creates the app and calls `listen()` in one file, so tests can't import it; route tests
  use `startApp` instead.
- `env.test.js` reloads `env.js` and always **sets** values (never deletes), so dotenv cannot fill them from a real `.env`.

### AI providers
- **Gemini** (primary): SDK is `@google/genai` — NOT the legacy `@google/generative-ai`. Model `gemini-3.5-flash`.
- **Groq** (fallback): `groq-sdk`, model `openai/gpt-oss-20b` (`llama-3.3-70b-versatile` is deprecated),
  called with `chat.completions.create()`.
- Neither provider keeps memory between calls. The **Context Builder** rebuilds the full prompt from the DB
  on every request, and is a separate function from the provider-calling code.

## Operations
- OpenWA: `docker compose -f docker-compose.dev.yml up -d` in the OpenWA folder; dashboard and API at
  `http://localhost:2785`; admin key file `OpenWA/data/.api-key`.
- OpenWA's webhook points at `http://host.docker.internal:5000/api/whatsapp/webhook` with the same secret as
  `OPENWA_WEBHOOK_SECRET`, events `message.received`. A wrong secret shows as 401 in the backend log.
- Check readiness: `curl.exe http://localhost:5000/api/whatsapp/status` → `"ready": true`.
- Turn AI replies on: `AI_AUTO_REPLY_ENABLED=true` in `backend/.env`, then fully restart the dev server.
- Hand a conversation back to the AI: `PATCH /api/conversations/:id/takeover` with `{ "humanTakeover": false }`.
