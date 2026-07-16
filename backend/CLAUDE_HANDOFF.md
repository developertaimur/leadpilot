# LeadPilot Backend — Claude Handoff (Prisma / Server Setup)

**Date:** 2026-07-16  
**Project:** LeadPilot backend (`D:\leadpilot\backend`)  
**Stack:** Node.js (CommonJS), Express 5, Prisma 7.8.0, MySQL  
**Purpose:** Context for Claude so it can continue the next backend steps without repeating fixed mistakes.

---

## 1. Current status (as of this handoff)

- Prisma client import/generation issues are **resolved**.
- `PrismaClient` now uses the **MariaDB adapter** (required by Prisma 7).
- Server **starts successfully** and logs:
  - `LeadPilot backend running on port 5000`
- Known quirk: in Cursor’s terminal, nodemon sometimes shows
  - `[nodemon] clean exit - waiting for changes before restart`
  after start. This is often because the same app was also started in VS Code (separate terminal/process). Use **one IDE terminal only**; don’t run `npm run dev` in both Cursor and VS Code at once.

**Do not “fix” by regenerating into `src/generated/prisma` again** unless we deliberately migrate back to the new `prisma-client` TS generator.

---

## 2. Errors we hit (in order) and what they meant

### Error A — Missing generated module

```
Error: Cannot find module '../../generated/prisma'
```

**Cause:** `prismaClient.js` required a custom path, but the Prisma client folder either didn’t exist yet, or Prisma 7’s new generator only output `.ts` files that plain Node `require()` cannot load.

### Error B — Generate succeeded but require still failed

```
✔ Generated Prisma Client (7.8.0) to .\src\generated\prisma
```

…but Node still could not load it.

**Cause:** Generator was:

```prisma
provider = "prisma-client"
output   = "../src/generated/prisma"
```

That outputs TypeScript source (e.g. `client.ts`), not a CommonJS `index.js`. This backend is plain JS (`"type": "commonjs"`, `node server.js`), so that path/format is incompatible without TypeScript/tsx build tooling.

### Error C — Empty PrismaClient options (Prisma 7)

```
PrismaClientInitializationError: `PrismaClient` needs to be constructed with a non-empty, valid `PrismaClientOptions`
```

**Cause:** In Prisma 7, `new PrismaClient()` with no options is invalid. A driver adapter (or accelerate URL) is required.

### Resolution chosen: Option A (plain JS-friendly)

1. Switch generator to legacy JS client: `prisma-client-js`
2. Import from `@prisma/client`
3. Pass MySQL/MariaDB adapter into `PrismaClient`

---

## 3. Code / config changes made

### 3.1 `prisma/schema.prisma` — generator block

**Before:**

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}
```

**After (current):**

```prisma
generator client {
  provider = "prisma-client-js"
}
```

Datasource stays MySQL:

```prisma
datasource db {
  provider = "mysql"
}
```

Models present: `Lead`, `Conversation`, `Message`, `Campaign` + enums `LeadStage`, `MessageSender`.

### 3.2 `src/infrastructure/database/prismaClient.js`

**Before (broken):**

```js
const { PrismaClient } = require('../../generated/prisma');
const prisma = new PrismaClient();
module.exports = prisma;
```

**After (current):**

```js
const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');

const adapter = new PrismaMariaDb(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

module.exports = prisma;
```

### 3.3 Packages installed

Already had: `@prisma/client`, `prisma`, `express`, `dotenv`, `socket.io`, `nodemon`

**Added for Prisma 7 MySQL:**

```bash
npm install @prisma/adapter-mariadb mariadb
```

Current relevant `package.json` deps:

- `@prisma/client`: ^7.8.0
- `@prisma/adapter-mariadb`: ^7.8.0
- `mariadb`: ^3.5.3
- `prisma` (dev): ^7.8.0
- `"type": "commonjs"`
- `"dev": "nodemon server.js"`

### 3.4 Commands that worked

```bash
cd D:\leadpilot\backend
npx prisma generate
# → Generated Prisma Client (v7.8.0) to .\node_modules\@prisma\client

npm run dev
# → LeadPilot backend running on port 5000
```

### 3.5 Env / Prisma config

- `.env` exists (gitignored). Must include at least:
  - `DATABASE_URL="mysql://USER:PASSWORD@HOST:3306/DB_NAME"`
  - `PORT` optional (defaults to 5000 via `src/config/env.js`)
- `prisma.config.ts` loads `DATABASE_URL` for Prisma CLI (migrations/generate tooling).

### 3.6 `.gitignore`

Still ignores `/src/generated/prisma` (leftover from the old custom-output approach). Harmless with current `prisma-client-js` setup. Old `src/generated/prisma` folder (if still present) is unused now.

---

## 4. Current backend architecture (what already exists)

Clean architecture-ish layers for leads:

```
server.js
  └─ /api → health.routes + lead.routes
       lead.routes → POST /leads → lead.controller
         → createLead.useCase
           → lead.repository
             → prismaClient (Prisma + MariaDB adapter)
```

### Key files

| File | Role |
|------|------|
| `server.js` | Express app, JSON body, mounts `/api` routes, listens on `port` |
| `src/config/env.js` | `dotenv` + exports `port` |
| `src/api/routes/health.routes.js` | Health route |
| `src/api/routes/lead.routes.js` | `POST /leads` |
| `src/api/controllers/lead.controller.js` | HTTP ↔ use case |
| `src/application/useCases/createLead.useCase.js` | Validates phone, checks duplicate, creates lead |
| `src/infrastructure/database/lead.repository.js` | Prisma `lead.create` / `findUnique` by phone |
| `src/infrastructure/database/prismaClient.js` | Shared Prisma singleton with adapter |
| `prisma/schema.prisma` | DB models |
| `prisma.config.ts` | Prisma 7 config (schema path, migrations, datasource URL) |

### Create lead behavior (already implemented)

- Requires `phoneNumber`
- Rejects duplicate phone (`findLeadByPhone`)
- Creates with `{ name, phoneNumber, source }`
- Returns 201 JSON or 400 `{ error }`

---

## 5. Important constraints for Claude (do not break)

1. **Keep CommonJS** (`require` / `module.exports`) unless the whole project is intentionally migrated to ESM/TS.
2. **Prisma 7 requires an adapter** for MySQL — keep `PrismaMariaDb` + `DATABASE_URL` wiring.
3. Prefer **`prisma-client-js` + `@prisma/client`** for this JS backend. Do **not** switch back to `provider = "prisma-client"` + custom `output` unless also adding TypeScript/tsx and updating imports/adapters.
4. Don’t invent a hand-written “Prisma client” under `infrastructure/database`; only the thin wrapper `prismaClient.js` should exist there.
5. Run Prisma from `backend/`:
   - `npx prisma generate` after schema changes
   - `npx prisma db push` or `npx prisma migrate dev` when tables need syncing
6. Only one `npm run dev` at a time (Cursor **or** VS Code).

---

## 6. Likely next steps (for Claude to continue)

Suggested order (adjust to the product plan):

1. **Verify DB schema applied** — if tables don’t exist yet:
   ```bash
   npx prisma db push
   # or
   npx prisma migrate dev --name init
   ```
2. **Smoke-test API**
   - `GET /api/health` (or whatever health path exists)
   - `POST /api/leads` with `{ "name", "phoneNumber", "source" }`
3. Continue feature work (list leads, update stage, conversations/messages, campaigns, Socket.io, etc.) following the same layers: routes → controllers → use cases → repositories → prisma.

---

## 7. Quick mental model for future debugging

| Symptom | Likely cause |
|---------|--------------|
| `Cannot find module '.../generated/prisma'` | Wrong import path / old generator; use `@prisma/client` |
| Empty `PrismaClientOptions` error | Missing `{ adapter }` |
| Adapter / provider mismatch | MySQL schema needs MariaDB adapter |
| `Can't reach database server` | MySQL down or bad `DATABASE_URL` |
| Table does not exist | Need `db push` / migrate |
| Port in use / clean exit in one IDE | Second `npm run dev` already running elsewhere |

---

## 8. Current `server.js` (reference)

```js
const express = require('express');
const { port } = require('./src/config/env');
const healthRoutes = require('./src/api/routes/health.routes');
const leadRoutes = require('./src/api/routes/lead.routes');

const app = express();
app.use(express.json());
app.use('/api', healthRoutes);
app.use('/api', leadRoutes);

app.listen(port, () => {
  console.log(`LeadPilot backend running on port ${port}`);
});
```

---

**End of handoff.** Continue from section 6; treat sections 2–5 as settled decisions unless explicitly revisiting architecture.
