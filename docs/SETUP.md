# LeadPilot — new machine setup (instructions for the setup agent)

You are an AI coding agent setting up LeadPilot on a new Windows laptop. The person you work with is the
project owner. Follow this file from top to bottom. It is written for **Windows + PowerShell**.

LeadPilot is a WhatsApp lead CRM (Node.js / Express / Prisma / MySQL via XAMPP). WhatsApp messages go through
**OpenWA**, a separate open-source WhatsApp gateway that runs in Docker on the same machine.

---

## 0. Rules you must follow the whole time

1. **Never read, print or copy the contents of any `.env` file**, and never paste API keys, secrets or
   passwords into the chat. When a value is needed, tell the owner exactly where to put it and let them do it.
2. **Never commit or push anything** in either repository. This is a setup, not a code change.
3. **Do not change any code** in either repository. Only create the files this guide names.
4. **Ask before installing software** (Step 1) and before any command that needs administrator rights.
5. **Stop at every `STOP — owner action` box** and wait until the owner says it is done.
6. Use `curl.exe`, never `curl` (in PowerShell `curl` is a different command).
7. Never send a real WhatsApp message yourself. The owner does the final message test.
8. If a step fails, show the owner the exact error output and your proposed fix, then wait.

---

## 1. Check and install the tools

Run these and report which are missing:

```powershell
git --version
node --version          # needs v26 or newer (the old laptop used v26.5.0)
npm --version
docker --version        # Docker Desktop
Test-Path C:\xampp\mysql\bin\mysql.exe    # XAMPP's MySQL (MariaDB) client
```

The database is **XAMPP's MySQL** (it is MariaDB; the old laptop ran MariaDB 10.4.32 from XAMPP).
**Do not install a separate MySQL server**: two database servers would fight over port 3306.

If something is missing, **ask the owner first**, then install with winget:

| Tool | Command |
|---|---|
| Git | `winget install --id Git.Git -e` |
| Node.js (current) | `winget install --id OpenJS.NodeJS -e` |
| Docker Desktop | `winget install --id Docker.DockerDesktop -e` |
| XAMPP (for MySQL/MariaDB) | `winget install --id ApacheFriends.Xampp.8.2 -e`, or the owner downloads it from apachefriends.org. Install it to `C:\xampp`. |

> **STOP — owner action:** Docker Desktop needs WSL 2 and usually a **restart**. After installing, the owner
> must restart Windows, open Docker Desktop once, accept its terms and wait until it says "Engine running".
> XAMPP: the owner opens the **XAMPP Control Panel** and clicks **Start** next to **MySQL** (Apache is not
> needed). MySQL must be running for Steps 4–9, and again every time the owner works on the project.

After installing, open a **new** terminal so the new commands are found, and run the checks again.

---

## 2. Clone both repositories into this folder

The owner created an empty workspace folder and put this file in it. Clone both repos **inside that folder**:

```powershell
git clone https://github.com/developertaimur/leadpilot.git
git clone https://github.com/rmyndharis/OpenWA.git
```

Result:

```
<workspace>\
  SETUP.md            (this file)
  leadpilot\          (the CRM: backend\ is the Node app)
  OpenWA\             (the WhatsApp gateway, runs in Docker)
```

OpenWA is used **unmodified**. The old laptop ran commit `0fb74b28` on `main`; the latest `main` is fine.

---

## 3. Set up OpenWA (Docker)

### 3.1 Create OpenWA's `.env`

In `OpenWA\`, copy the example file and then set these settings. They are **not secrets**, so you may write
them yourself. Keep every other line of `.env.example` as it is.

```powershell
cd OpenWA
Copy-Item .env.example .env
```

Then make sure `OpenWA\.env` contains exactly these values (edit the existing lines, add missing ones):

```
AUTO_START_SESSIONS=true
PORT=2785
API_PORT=2785
BIND_HOST=127.0.0.1
NODE_ENV=development
DATABASE_TYPE=sqlite
DATABASE_NAME=./data/openwa.sqlite
ENGINE_TYPE=baileys
SESSION_DATA_PATH=./data/sessions
PUPPETEER_HEADLESS=true
STORAGE_TYPE=local
REDIS_ENABLED=false
QUEUE_ENABLED=false
CACHE_ENABLED=false
STATUS_SEED_ON_READY=false
SSRF_ALLOWED_HOSTS=host.docker.internal
RESOLVE_LID_TO_PHONE=true
WEBHOOK_MEDIA_INLINE_MAX_BYTES=0
```

Why the important ones matter:
- `SSRF_ALLOWED_HOSTS=host.docker.internal` lets OpenWA (inside Docker) call the LeadPilot webhook on the
  laptop. Without it, webhooks are refused.
- `RESOLVE_LID_TO_PHONE=true` makes OpenWA send real phone numbers instead of private "@lid" ids.
- `BIND_HOST=127.0.0.1` keeps OpenWA reachable only from this laptop.

### 3.2 Start OpenWA

```powershell
docker compose -f docker-compose.dev.yml up -d --build
docker ps --format "{{.Names}} | {{.Status}} | {{.Ports}}"
```

Wait until the container `openwa-api` shows `(healthy)` (the first build can take several minutes). Check:

```powershell
curl.exe http://localhost:2785/api/health/ready
```

### 3.3 The OpenWA API key

On first start, OpenWA creates an admin API key and stores it in the file `OpenWA\data\.api-key`.

> **STOP — owner action:** Tell the owner the key is in `OpenWA\data\.api-key`. **Do not print it.**
> The owner opens that file and keeps the key for Step 5 (`OPENWA_API_KEY`).

### 3.4 Connect WhatsApp (QR code)

The OpenWA dashboard is at **http://localhost:2785** (log in with the API key from 3.3).

> **STOP — owner action:** In the dashboard, the owner creates a session (the old one was for the business
> WhatsApp number), opens its QR code, and scans it with WhatsApp on the phone
> (WhatsApp → Settings → Linked devices → Link a device). When the session shows **ready/connected**, the
> owner copies the **session id (a UUID)** for Step 5 (`OPENWA_SESSION_ID`).
> Tip: in WhatsApp → Linked devices, the owner can remove the old laptop's device.

OpenWA's own API reference is in `OpenWA\docs\07-api-collection.md` if you need it (sessions, QR, webhooks).

---

## 4. The database (XAMPP MySQL)

The owner has a backup file **`leadpilot.sql`** from the old laptop. It contains real customer data (names,
phone numbers, messages): **never copy it into either repository folder, never commit it, never print it.**

> **STOP — owner action:** Make sure MySQL is **started** in the XAMPP Control Panel, then ask the owner for
> the full path of `leadpilot.sql` (it should be outside the repos, for example on the Desktop).

XAMPP's client is not on the PATH, so use its full path. In a fresh XAMPP, `root` has **no password**
(just press Enter when asked). If the owner has set a password, they type it.

```powershell
$mysql = 'C:\xampp\mysql\bin\mysql.exe'
& $mysql -u root -p -e "CREATE DATABASE leadpilot CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
cmd /c """C:\xampp\mysql\bin\mysql.exe"" -u root -p leadpilot < ""C:\path\to\leadpilot.sql"""
```

(PowerShell has no `<` redirection, which is why the import runs through `cmd /c`.) If the database
`leadpilot` already exists, **stop and ask the owner** before importing into it. Then check, without
printing any data:

```powershell
& $mysql -u root -p -e "USE leadpilot; SHOW TABLES; SELECT COUNT(*) AS leads FROM lead;"
```

Expected tables include `lead`, `conversation`, `message`, `campaign`, `businessprofile` and
`_prisma_migrations` (MySQL on Windows stores table names in lowercase; that is normal).

---

## 5. Backend settings (`leadpilot\backend\.env`)

> **STOP — owner action:** The owner copies their saved `.env` file into `leadpilot\backend\.env`
> (it is ignored by git and must never be committed). Then the owner checks and updates these lines
> themselves — **you never open this file**:
>
> | Setting | What it must be on the new laptop |
> |---|---|
> | `DATABASE_URL` | `mysql://root:<password>@localhost:3306/leadpilot` (XAMPP default: `mysql://root@localhost:3306/leadpilot`, no password); usually the old value already works |
> | `OPENWA_BASE_URL` | `http://127.0.0.1:2785` |
> | `OPENWA_API_KEY` | the key from Step 3.3 |
> | `OPENWA_SESSION_ID` | the new session id from Step 3.4 |
> | `OPENWA_WEBHOOK_SECRET` | keep the old value (any long random string; it must match Step 8) |
> | `GEMINI_API_KEY`, `GROQ_API_KEY` | keep the old values |
> | `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | keep; the JSON file must exist there (see below) |
> | `AI_AUTO_REPLY_ENABLED` | `false` for now (the owner turns it on later on purpose) |
>
> If they use the Google Sheets import, the owner also copies the Google service-account JSON file
> to the path in `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` (normally `backend\credentials\...`, also not in git).
>
> The list of all setting names is in `leadpilot\backend\.env.example`.

---

## 6. Install and check the backend

```powershell
cd leadpilot\backend
npm install
npx prisma generate
npx prisma migrate status
```

- Prisma prints a "Datasource" line that contains the database address. **Do not repeat that line** to the
  owner; just say whether the command succeeded.
- `migrate status` should say the database schema is **up to date** (the backup already has every table).
  If it lists pending migrations, show the list to the owner and, **only after they agree**, run
  `npx prisma migrate deploy`.
- Rule: the dev server must be **stopped** while running any `npx prisma ...` command, and fully restarted
  afterwards.

Run the tests (they use fake settings from `test/test.env` and never touch the real database, OpenWA or AI):

```powershell
npm test
```

Expected: **263 or more passing, 0 failing**. Never run `test-send-whatsapp.js` (it sends a real message).

---

## 7. Start the backend and check it

```powershell
npm run dev
```

In a second terminal:

```powershell
curl.exe http://localhost:5000/api/health
curl.exe http://localhost:5000/api/whatsapp/status
```

The status must show `"ready": true`. If it does not, check that the session from Step 3.4 is connected
and that `OPENWA_API_KEY` / `OPENWA_SESSION_ID` in the backend `.env` match (the owner checks the file).

---

## 8. Register the webhook (OpenWA → LeadPilot)

OpenWA must send incoming WhatsApp messages to the backend. From inside Docker, the laptop is
`host.docker.internal`, so the webhook URL is:

```
http://host.docker.internal:5000/api/whatsapp/webhook
```

> **STOP — owner action:** Because this command contains the API key and the webhook secret, the **owner**
> runs it (fill in the three values; the secret must be exactly `OPENWA_WEBHOOK_SECRET` from the backend
> `.env`):
>
> ```powershell
> $key = '<OPENWA API KEY>'; $session = '<SESSION ID>'; $secret = '<OPENWA_WEBHOOK_SECRET>'
> $body = @{ url = 'http://host.docker.internal:5000/api/whatsapp/webhook'; events = @('message.received'); secret = $secret } | ConvertTo-Json
> Invoke-RestMethod -Method Post -Uri "http://localhost:2785/api/sessions/$session/webhooks" -Headers @{ 'X-API-Key' = $key } -ContentType 'application/json' -Body $body
> ```
>
> A different secret makes every webhook fail with **401** in the backend log.

---

## 9. Final test (owner)

> **STOP — owner action:** From a **personal test phone**, send a short WhatsApp message to the business
> number. In the backend terminal there should be **no** error line; then:
>
> ```powershell
> curl.exe http://localhost:5000/api/conversations
> ```
>
> shows the conversation. With `AI_AUTO_REPLY_ENABLED=false`, no AI reply is sent (that is expected).

When the owner wants AI replies: set `AI_AUTO_REPLY_ENABLED=true` in the backend `.env` and fully restart
`npm run dev`. Log lines then look like `AI pipeline conversation 8 lead 15: replied via gemini`.

---

## 10. Report to the owner

Give a short summary: tools installed, both repos cloned, OpenWA healthy, database imported (number of
leads only), `npm test` result, `/api/whatsapp/status` result, webhook registered, final test result,
and anything that failed or still needs the owner.

After setup, the project's working rules and full context are in **`leadpilot\CLAUDE.md`**. Read it before
doing any development work.

---

## Quick reference

| Thing | Value |
|---|---|
| LeadPilot repo | https://github.com/developertaimur/leadpilot.git |
| OpenWA repo | https://github.com/rmyndharis/OpenWA.git |
| OpenWA API / dashboard | http://localhost:2785 (container `openwa-api`) |
| OpenWA start | `docker compose -f docker-compose.dev.yml up -d` (in `OpenWA\`) |
| OpenWA admin key file | `OpenWA\data\.api-key` |
| Backend | http://localhost:5000, all routes under `/api` |
| Webhook URL (from Docker) | `http://host.docker.internal:5000/api/whatsapp/webhook` |
| Backend commands (in `leadpilot\backend`) | `npm run dev`, `npm test` |
| Database | XAMPP MySQL (MariaDB), `C:\xampp\mysql\bin\mysql.exe`, database `leadpilot`, port 3306; start it in the XAMPP Control Panel |
| Secrets (never in git or chat) | `backend\.env`, `OpenWA\.env`, `OpenWA\data\`, Google JSON, `leadpilot.sql` |
