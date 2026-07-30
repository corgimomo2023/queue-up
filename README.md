# Easy Queue

Production event queue for MEGABOX Hong Kong, implemented as an npm-workspaces monorepo with Node.js 22.22+, Express, TypeScript, React/Vite, TypeORM, SQLite and SSE.

## Repository structure

```text
apps/
  frontend/  React/Vite application, UI tests, Nginx image
  backend/   Express API, SQLite runtime, API tests
package.json         Root workspace commands
package-lock.json    Shared dependency lockfile
docker-compose.yml   Local production topology
```

The applications have independent package manifests, builds, and Docker images. The root workspace provides one install and coordinated commands.

## Actor model

- **Vendor Admin**: creates, edits, views, audits, archives and restores events through `/super-admin`.
- **Staff Admin**: signs in on `/` with an Event ID and password, then operates that event's live queue.
- **Customer**: joins from the event QR/link and receives the `queue.called` notification when called.

Public self-service event creation is disabled.

## Local development

Create or repair the local `.env`, then run:

```bash
npm run env:init
npm ci
npm run dev
```

The frontend runs on `http://localhost:5173` and proxies API, health, and event-asset requests to the backend on `http://localhost:8088`.

Useful workspace commands:

```bash
npm run dev --workspace=@nextq/frontend
npm run dev --workspace=@nextq/backend
npm run test --workspace=@nextq/frontend
npm run test --workspace=@nextq/backend
```

## Checks

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

## Environment

Required backend values:

- `SESSION_SECRET`: random 32+ character value
- `SUPER_ADMIN_KEY`: independent random 32+ character Vendor Admin key
- `PUBLIC_ORIGIN`: trusted public HTTP(S) origin, for example `https://queue.example.com`; paths, query strings, fragments and credentials are rejected
- `QUEUEFLOW_SEED_EMAIL`: optional legacy initial Staff Admin credential
- `QUEUEFLOW_SEED_PHONE`: optional legacy initial Staff Admin credential
- `PORT`: backend port, normally `8088`
- `DATA_DIR`: SQLite and event-asset directory

Credentials are scrypt-hashed before SQLite storage. `.env` is gitignored and should remain mode 600.

## Docker Compose

```bash
npm run env:init
docker compose build
docker compose up -d
curl -fsS http://127.0.0.1:8088/health
```

Compose starts two services:

- `frontend`: Nginx serves the compiled SPA on `127.0.0.1:8088` and proxies backend routes. Its upstream is configurable through `BACKEND_URL`.
- `backend`: Express serves the API and owns the persistent `nextq_data` volume.

Keeping browser traffic same-origin preserves the secure session-cookie model. The two images can later be deployed on different hosts as long as a gateway routes `/api`, `/health`, `/event-assets`, and `/q` from the frontend origin to the backend.

## Backend architecture

`apps/backend/src/app.ts` is the Express composition root. The backend uses pragmatic DDD boundaries:

- `domain/`: lifecycle rules and typed business constants, with no Express or database dependency.
- `application/`: event use cases and transaction orchestration.
- `infrastructure/database/`: TypeORM `DataSource`, entity schemas and explicit migrations (`synchronize` stays disabled).
- `infrastructure/repositories/`: TypeORM persistence for queue, customer and audit aggregates.
- `infrastructure/read-models/`: query-builder projections for admin reports and history.
- `routes/`: thin Express controllers grouped by actor and feature.
- `shared/`: dependency-free cross-cutting utilities such as date/time helpers.
- `config/`: HTTP, session, rate-limit and realtime constants.

`runtime.ts` wires repositories and services and owns only process-level concerns such as SSE clients. Multi-write commands run in application services, and every repository inside a transaction is created from TypeORM's transactional entity manager so state changes and audit records commit or roll back together. Direct SQLite access remains isolated to event-asset compare-and-swap/file reconciliation and legacy compatibility tests.

`config/env.ts` is the only module that reads `process.env`. It validates and converts all runtime configuration with Zod during startup; other modules import the typed `env` object or receive configuration through dependency injection.

## Frontend localization

- Supported locales: `en-US` and `zh-HK` via `i18next` and `react-i18next`.
- The locale is stored under `nextq-locale`; the legacy storage key is intentionally retained so existing visitors keep their language setting.
- A saved `zh-TW` value is migrated to `zh-HK`; first visit otherwise falls back to the browser language.
- Database-backed event and customer content is displayed without translation.

## Install manifest and link previews

- `/manifest.webmanifest` describes the default Easy Queue application.
- Every public customer link at `/q/:queueId` is served with event-specific Open Graph and Twitter metadata in the initial HTML response. WhatsApp, Signal and other preview crawlers therefore receive the event name, description and uploaded logo without executing JavaScript.
- `/q/:queueId/manifest.webmanifest` uses the same event name and description for installation.
- The frontend Nginx proxy sends `/q/*` to the backend, which injects event metadata into the same built SPA shell used by the browser.
- Archived or unknown events return `404` without exposing their metadata.

## Notification contract

The call notification is:

```text
event: queue.called
現正輪到你，請於5分鐘到回到活動場地入場
```

## Backup

Use SQLite online backup against the backend container before deployment:

```bash
docker exec nextq-backend node -e "const D=require('better-sqlite3');const db=new D('/app/data/queueflow.sqlite');db.backup('/app/data/queueflow-backup.sqlite').then(()=>db.close())"
docker cp nextq-backend:/app/data/queueflow-backup.sqlite "backups/queueflow-$(date +%Y%m%d-%H%M%S).sqlite"
```

## Routes

- `/`: Staff Admin login
- `/super-admin/*`: Vendor Admin workspace
- `/vendor/:queueId`: Staff Admin dashboard
- `/q/:queueId`: customer join and ticket status
- `/health`: backend health
- `/api/queues/:queueId/events`: authenticated customer SSE
