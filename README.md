# NextQ

Production event queue for MEGABOX Hong Kong, built with Node.js 22, Express, TypeScript, React/Vite, SQLite and SSE.

## Actor model

- **Vendor Admin**: creates, edits, views, audits, archives and restores events through `/super-admin`.
- **Staff Admin**: signs in on `/` with an Event ID and password, then operates that event's live queue. Staff Admin cannot create, edit or archive events.
- **Customer**: joins from the event QR/link and receives the `queue.called` notification when called.

Public self-service event creation is disabled.

## Backend architecture

`server/app.ts` is the Express composition root. HTTP concerns are separated by responsibility:

- `schemas.ts`: strict Zod request DTOs; unknown body fields are rejected.
- `http.ts`: reusable body/params validation middleware and typed actor/DTO access.
- `security.ts`: credential hashing, opaque tokens, signed sessions and cookie parsing.
- `runtime.ts`: SQLite setup/migrations, queue lifecycle operations, audit writes and customer-scoped SSE clients.
- `access-guards.ts`: actor authentication and event/ticket ownership boundaries.
- `routes/vendor-admin.ts`: global event lifecycle management.
- `routes/staff-admin.ts`: event-bound live queue operations.
- `routes/customer.ts`: ticket-bound join, status, leave and SSE operations.

Protected route middleware is ordered as `actor guard -> DTO validation -> handler`, so anonymous requests cannot use validation responses to probe protected operations. Staff Admin sessions are bound to one event, and customer tokens are looked up within one event.

## Frontend localization

- Supported locales: `en-US` and `zh-TW` via `i18next` and `react-i18next`.
- The selected locale is stored in browser local storage under `nextq-locale`; first visit falls back to the browser language.
- Event names, customer names/messages and other database-backed content are displayed without translation.

## Notification contract

The only call notification is:

```text
event: queue.called
現正輪到你，請於5分鐘到回到活動場地入場
```

## Local checks

```bash
npm ci
npm test
npm run lint
npm run build
```

## Environment

Copy `.env.example` to `.env`. Required:

- `SESSION_SECRET`: random 32+ character value
- `SUPER_ADMIN_KEY`: Vendor Admin key
- `QUEUEFLOW_SEED_EMAIL`: optional legacy initial Staff Admin credential
- `QUEUEFLOW_SEED_PHONE`: optional legacy initial Staff Admin credential

Credentials are scrypt-hashed before SQLite storage. New events require a Staff Admin password; email/phone verification remains read-only compatibility for existing legacy events. `.env` is gitignored and must stay mode 600.

## Start or update

```bash
docker compose build queueflow
docker compose up -d --no-deps --force-recreate queueflow
curl -fsS http://127.0.0.1:8088/health
```

The app binds only to `127.0.0.1:8088`; Nginx is the public entry point.

## Backup

Use SQLite online backup against the live database before deployment:

```bash
docker exec queueflow node -e "const D=require('better-sqlite3');const db=new D('/app/data/queueflow.sqlite');db.backup('/app/data/queueflow-backup.sqlite').then(()=>db.close())"
docker cp queueflow:/app/data/queueflow-backup.sqlite "backups/queueflow-$(date +%Y%m%d-%H%M%S).sqlite"
```

## Routes

- `/`: Staff Admin login with Event ID and password; no Vendor Admin navigation
- `/super-admin/*`: Vendor Admin workspace
- `/vendor/:queueId`: Staff Admin dashboard with the customer public URL and QR code
- `/q/:queueId`: customer public join and ticket status
- `/health`: service health
- `/api/queues/:queueId/events`: authenticated customer SSE
