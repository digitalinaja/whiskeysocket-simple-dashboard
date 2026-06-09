# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WhatsApp CRM dashboard built on Express + Socket.IO + @whiskeysockets/baileys. Designed for boarding school management (Webaloka CRM). Uses TiDB Cloud (MySQL-compatible) for persistence and supports Google/Microsoft contact sync.

## Commands

```bash
npm start                # Start server (src/index.js)
npm run dev              # Build CSS + start server
npm run build:css        # Tailwind CSS dev build with watch
npm run build:css:prod   # Tailwind CSS production build (minified)
npm run db:migrate       # Run database schema migration
npm run db:validate      # Validate database schema
npm run db:backup        # Backup database tables
npm run db:force-migrate # Force migration (drops extra columns)
```

No test suite is configured.

## Architecture

**Entry point:** `src/index.js` — Express app, HTTP server, Socket.IO, session management, broadcast job engine, and all API route definitions (except CRM and analytics which are in separate routers).

**Backend modules (`src/`):**
- `baileys.js` — WhatsApp connection via Baileys library. Handles QR generation, connection lifecycle, auto-reconnect with exponential backoff, credential cloud sync on `creds.update`, and message/history event forwarding.
- `socket.js` — Socket.IO server initialization with CORS.
- `database.js` — MySQL connection pool (TiDB Cloud), schema auto-migration on startup, default lead statuses and activity types seeding.
- `schemaDefinitions.js` — Declarative table schemas (version `1.5.0`). Tables: contacts, messages, whatsapp_groups, group_participants, activities, lead_statuses, activity_types, external_students, and more.
- `schemaValidation.js` / `migrationSystem.js` — Schema comparison, column detection, and migration execution.
- `chatHandlers.js` — Incoming message processing, media download, contact upsert, message storage, WhatsApp contact sync.
- `groupHandlers.js` — WhatsApp group metadata upsert, participant tracking.
- `crmRoutes.js` — Express router mounted at `/api`. CRUD for contacts, messages, lead statuses, activities, media uploads (multer), groups, chat sending.
- `analyticsRoutes.js` — Express router at `/api`. Funnel and reporting endpoints.
- `authMiddleware.js` — JWT authentication from httpOnly cookies (`sso_token` by default). `authenticateToken` blocks unauthenticated requests; `checkAuthStatus` is non-blocking.
- `sessionStorage.js` — AES-256-CBC encrypted session credential storage to cloud DB (`whatsapp_sessions` table).
- `googleContacts.js` / `outlookContacts.js` — OAuth2 flows and contact sync from Google/Microsoft.
- `activityRoutes.js` / `externalAppRoutes.js` / `externalAppSync.js` — Activity logging and external system integration (student DB, payment, ticketing).
- `scripts/` — CLI tools: `dbMigrate.js`, `dbBackup.js`, `dbValidate.js`, `fixActivityTypeDuplicates.js`.

**Frontend (`public/`):**
- Single-page app: `index.html` loads modular JS files from `public/js/` (app.js, state.js, ui.js, navigation.js, chat.js, sessions.js, crm.js, groups.js, broadcast.js, analytics.js, activities.js, externalApps.js, prospects.js, jobs.js, utils.js).
- Tailwind CSS v4 with `public/css/style.css` → `public/css/output.css`.

**Key data flows:**
1. WhatsApp events (messages, QR, connection) → Baileys → Socket.IO → frontend real-time updates
2. API requests → JWT auth middleware → route handlers → MySQL via connection pool
3. Broadcast jobs: created via API → run async with delay/cooldown → persisted to `jobs/*.json` → resumable on restart
4. Session credentials: saved locally in `auth/<sessionId>/` → synced encrypted to `whatsapp_sessions` DB table

**Database:** TiDB Cloud (MySQL wire protocol). Connection configured via `TIDB_HOST`, `TIDB_USER`, `TIDB_PASSWORD` env vars. SSL enabled by default. Schema auto-migrates on server startup.

## Environment Configuration

Copy `.env.example` to `.env`. Key variables: `PORT`, `JWT_SECRET`, `JWT_COOKIE_NAME`, `TIDB_*` (database), `GOOGLE_CLIENT_ID`/`SECRET`, `MICROSOFT_CLIENT_ID`/`SECRET`, `SESSION_SECRET`.

## Docker

CI builds multi-arch Docker images (amd64/arm64) on push to `main` via `.github/workflows/docker.yml`. Images pushed to ghcr.io.

## ES Modules

The project uses `"type": "module"` in package.json. All imports use ESM syntax.
