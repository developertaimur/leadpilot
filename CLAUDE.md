# LeadPilot

WhatsApp lead CRM. Leads arrive inbound via the WhatsApp webhook or outbound via campaigns
(Google Sheets import + batch send). The goal is AI-generated replies with a human-takeover switch
so staff can step into any conversation.

## Stack
- Node.js, **CommonJS**, Express 5 — entry point `backend/server.js`, all routes mounted under `/api`
- Prisma 7 (`prisma-client-js`) + MySQL via `@prisma/adapter-mariadb`
- WhatsApp Cloud API (Graph v21.0), Google Sheets API (service account)
- AI: Gemini (`@google/genai`) primary, Groq (`groq-sdk`) fallback — installed, not yet wired
- Socket.IO — installed, not yet wired

All commands run from `backend/`. Dev server: `npm run dev` (nodemon). Tests: `npm test` (node:test).

## Structure (`backend/src`)
Requests flow: route → controller → use case → repository → Prisma.

| Folder | Purpose |
|---|---|
| `api/routes/` | Express routers, one per resource. No logic. |
| `api/controllers/` | Read `req`, call one use case, map errors to HTTP status. No business logic. |
| `application/useCases/` | One business action per file (`<verb><Noun>.useCase.js`). Validation and orchestration live here. |
| `domain/rules/` | Pure functions, no I/O (e.g. `normalizePhoneNumber` → E.164). `domain/entities/` is empty. |
| `infrastructure/database/` | `prismaClient.js` singleton + one repository per model. Only place that touches Prisma. |
| `infrastructure/whatsapp/` | `whatsapp.client.js` (send text), `whatsapp.parser.js` (webhook payload → `{phoneNumber, text, name, whatsappMessageId}`). |
| `infrastructure/channels/` | `channelSenders` registry: `Conversation.channel` → send function. |
| `infrastructure/sheets/` | Google Sheets reader (rows keyed by header). |
| `infrastructure/ai/` | Empty — AI provider clients go here. |
| `infrastructure/realtime/` | Empty — Socket.IO goes here. |
| `config/env.js` | The only module that reads `process.env`. |

## Schema (`backend/prisma/schema.prisma`)
- **Lead** — name?, phoneNumber (unique, E.164), stage `LeadStage`, source?, campaignId?
- **Conversation** — one per lead (`leadId` unique), `humanTakeover` bool, `channel` (WHATSAPP)
- **Message** — conversationId, sender `LEAD|AI|HUMAN`, content, whatsappMessageId? (unique, dedupes webhook retries)
- **Campaign** — name, source?, status `ACTIVE|PAUSED`, googleSheetId?, googleSheetTabName?, defaultRegion?
- **BusinessProfile** — single row: name, context, salesInstructions? (Text)
- `LeadStage`: NEW, CONTACTED, INTERESTED, QUALIFIED, CONVERTED, LOST

## Built vs not built
**Built**
- CRUD + filters/stats for leads, campaigns, conversations, messages
- Google Sheets → leads sync (per-campaign region, only updates leads still at NEW)
- Inbound webhook: verify, parse first text message, dedupe, auto-create lead + conversation, save message
- Outbound sending for AI/HUMAN messages via channel registry; first outbound moves NEW → CONTACTED
- Campaign `send-batch` (hardcoded greeting text, not a WhatsApp template)
- BusinessProfile: `GET` + `PUT /api/business-profile` with partial updates (omitted fields unchanged;
  `salesInstructions` null/empty/whitespace → null; `name` + `context` required only when creating)
- node:test suite (`npm test`) — currently covers BusinessProfile only

**Not built**
- AI reply generation (`infrastructure/ai/` empty, no `generateReply`)
- Anything that reads `humanTakeover`
- WhatsApp template messages (required for first contact / outside the 24h window)
- Non-text inbound (voice notes, media); multi-message webhook batches
- Socket.IO realtime
- Auth on any endpoint; webhook `X-Hub-Signature-256` verification
- Tests for anything other than BusinessProfile

**Planned, not built — AI stage suggestions**
- `Lead.aiSuggestedStage` (nullable `LeadStage`) and `Lead.aiSuggestionReason` (nullable) store the AI's latest suggestion.
- Review queue = `GET /api/leads?aiSuggestedStage=X` — a filter on the existing endpoint, not a new endpoint.
- `PATCH /api/leads/:id/stage` clears both suggestion fields when a human acts.

## Locked rules
### Code
- **All `process.env` access goes through `src/config/env.js`.** Everything else imports from it.
  (Exception: `prisma.config.ts`, which is Prisma CLI config.)
- CommonJS only (`require` / `module.exports`).
- Prisma 7: generator `prisma-client-js`, import from `@prisma/client`, `PrismaClient` must get the
  `PrismaMariaDb` adapter. Do not switch to the `prisma-client` generator or a custom `output` path.
- Keep the layering: controllers never import repositories for business actions; use cases never touch `req`/`res`.

### Workflow
- **Design decisions are made in the mentor chat.** For every task, propose a plan and wait for approval
  before editing. Don't redesign locked decisions. If something conflicts with this file, stop and ask.
- **One task = one small change = one commit.** Never touch files outside the task.
- Windows: **stop the dev server before any `npx prisma migrate` / `npx prisma generate`**, then fully
  restart it. nodemon ignores `node_modules`, so it will not pick up a regenerated client.
- Windows: use `curl.exe`, not `curl` (PowerShell aliases `curl` to `Invoke-WebRequest`).

### Testing workflow (standing rules)
- Every code change includes tests. Run `npm test` before reporting a task done, and report the full
  results, changed files and final diff.
- Tests use `node:test` with zero extra dependencies. Files live in `backend/test/**/*.test.js`.
  Never run `test-send-whatsapp.js` (it sends a real WhatsApp message).
- All external services are mocked: WhatsApp, Gemini, Groq, Google Sheets. The fetch guard in
  `test/setup.js` and the fake values in `test/test.env` must stay in place.
- Whenever a new key is added to `src/config/env.js`, add a fake value for it to `test/test.env` and
  extend `test/safety.test.js` in the same task.
- Never modify real dev or production data in tests. Integration tests against a database are not
  allowed until a separate isolated test database is approved.
- If an implementation failure appears, show the failure and the proposed fix before changing
  application code.
- Do not install dependencies, commit or push without approval.

Test layout: `test/test.env` (fake env, loaded via `--env-file`), `test/setup.js` (blocks non-local
`fetch`), `test/helpers/startApp.js` (mounts routers under `/api` on a random port),
`test/safety.test.js` (canary — if it fails, stop), `test/useCases/`, `test/routes/`.
Mock with `mock.method(moduleObject, 'fn')` and always `mock.restoreAll()` in `afterEach`.

**Known limits**
- `syncCampaignFromSheet` destructures `getSheetRows` at require time, so it can't be mocked yet.
- `server.js` creates the app and calls `listen()` in one file, so tests can't import it; route tests
  use `startApp` instead.

### AI providers
- **Gemini** (primary): SDK is `@google/genai` — NOT the legacy `@google/generative-ai`. Model `gemini-3.5-flash`.
- **Groq** (fallback): `groq-sdk`, model `openai/gpt-oss-20b` (`llama-3.3-70b-versatile` is deprecated),
  called with `chat.completions.create()`.
- Neither provider keeps memory between calls. The **Context Builder** rebuilds the full prompt from the DB
  on every request, and is a separate function from the provider-calling code.

### AI reply pipeline (design — not yet implemented)
Order for an inbound message:
1. Save the inbound message.
2. Check `conversation.humanTakeover` — if true, stop.
3. Call `generateReply`.
4. **Re-check `humanTakeover`** just before sending — if a human took over meanwhile, do not send.
5. Send and save the AI message.
6. If `requiresHuman` was true, set `humanTakeover = true` now — **after** the reply has been sent
   (that reply is typically "I'll connect you with the team"), never before.

`generateReply`:
- Exactly **one** model call, returning `{ reply, suggestedStage, reason, requiresHuman }`.
- Gemini first; fall back to Groq **only** on a real 429 / quota error, not on other failures.
- `suggestedStage` is advisory — **AI never changes `Lead.stage` automatically.**

Prompt has 3 layers, in this order:
1. Fixed engine rules (in code, not editable by users)
2. `BusinessProfile.salesInstructions` (how to sell)
3. `BusinessProfile.context` (what the business is)
