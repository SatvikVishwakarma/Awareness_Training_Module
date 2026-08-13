# Awareness Training Module

Cybersecurity and privacy awareness training workspace with:

- a legacy all-in-one portal at `/`
- a newer React portal shell at `/react`
- an Express + SQLite backend for admin controls, portal state, and employee record capture
- packaged HTML training modules served as static content

## What this repo contains

This repository is not a single app. It is a training portal workspace made of three main parts:

1. `backend/`
   Express server that:
   - serves the training HTML files and shared assets
   - exposes admin and public APIs
   - stores employee submissions and portal settings in SQLite
   - hosts the admin dashboard at `/admin/submissions.html`
   - hosts the built React app at `/react`

2. `frontend-react/`
   React + Vite portal shell that:
   - fetches portal state from `GET /api/v1/public-state`
   - renders the module list in a sidebar
   - loads the selected training module in an `iframe`
   - respects admin-driven module enable/disable state and global portal lock state

3. Root static portal (`index.html`)
   Legacy portal that:
   - collects employee name, department, and email before training starts
   - saves progress in `localStorage`
   - calls the backend to save employee details
   - reads public portal state from the backend
   - generates a printable completion certificate when all enabled modules are complete

## Included training modules

The backend seeds these modules by default:

- `phishing` -> `phishing-smishing-vishing-training/enhanced-interactive-training.html`
- `ceo` -> `ceo-executive-fraud-training/enhanced-interactive-training.html`
- `watering` -> `watering-hole-attacks-training/enhanced-interactive-training.html`
- `general` -> `general-cybersecurity-training/enhanced-interactive-training.html`
- `password-mfa` -> `Password-mfa-training/password-mfa-training.html`
- `incident-response` -> `incident-response training/incident-response-training.html`
- `privacy` -> `privacy-awareness-training/enhanced-interactive-training.html`
- `secure-coding` -> `secure-coding-training/enhanced-interactive-training.html`
- `ssdlc` -> `SSDLC-Training/ssdlc-training-module.html`

Each module is a standalone HTML file with its own embedded CSS and JavaScript.

## Verified repo structure

```text
.
+-- assets/
|   `-- modern-theme.css
+-- backend/
|   +-- data/
|   |   `-- employee_details.db
|   +-- public/
|   |   +-- index.html
|   |   `-- submissions.html
|   +-- sql/
|   |   `-- init.sql
|   +-- src/
|   |   +-- db.js
|   |   `-- server.js
|   +-- .env
|   +-- package.json
|   `-- README.md
+-- frontend-react/
|   +-- src/
|   |   +-- api/portalApi.js
|   |   +-- components/Sidebar.jsx
|   |   +-- store/usePortalStore.js
|   |   +-- App.jsx
|   |   +-- main.jsx
|   |   `-- styles.css
|   +-- dist/
|   +-- index.html
|   +-- package.json
|   `-- vite.config.js
+-- index.html
+-- ceo-executive-fraud-training/
+-- general-cybersecurity-training/
+-- incident-response training/
+-- Password-mfa-training/
+-- phishing-smishing-vishing-training/
+-- privacy-awareness-training/
+-- secure-coding-training/
+-- SSDLC-Training/
`-- watering-hole-attacks-training/
```

There is also a nested `Awareness_Training_Module/` directory containing only Git metadata files, not application code.

## How the system works

### Backend

`backend/src/server.js` is the runtime center of the project.

It:

- listens on `PORT` or `3001`
- serves the entire repo root as static content
- serves `backend/public` under `/admin`
- serves the built React app from `frontend-react/dist` under `/react`
- exposes public and admin APIs
- enforces a global portal lock for HTML requests
- manages in-memory admin sessions and CSRF tokens

`backend/src/db.js` stores two kinds of data in SQLite:

- `employee_submissions`
  Fields: `name`, `department`, `email`, `ip_address`, `submitted_at`
- `app_settings`
  JSON-backed settings for:
  - module registry
  - module availability
  - portal lock state

### React portal

The React app is a lightweight shell, not the training content itself.

It:

- loads portal state from `/api/v1/public-state`
- shows all registered modules in a collapsible sidebar
- disables module buttons when admins turn a module off
- shows a lock card when the portal is locked
- embeds the selected module HTML in an `iframe`

When running Vite in development on port `5173`, it points module URLs at `http://localhost:3001` and proxies `/api` to the backend.

### Legacy root portal

The root `index.html` is a richer standalone training experience than the React shell.

It includes:

- welcome screen
- employee details form
- module launcher and progress tracking
- admin-controlled enable/disable behavior through `/api/v1/public-state`
- offline-tolerant employee submission flow
- certificate generation after all enabled modules are completed

If the backend save fails, the page can still continue in local mode and preserve pending employee details in `localStorage`.

## Local setup

### Prerequisites

- Node.js 18+ is the safe baseline for both apps
- npm

### Backend

From the repo root:

```powershell
cd backend
npm install
npm start
```

Backend default URL:

```text
http://localhost:3001
```

Useful routes:

- `/` -> legacy portal
- `/admin/submissions.html` -> admin dashboard
- `/react` -> built React portal
- `/health` -> health check

### React development

In a second terminal:

```powershell
cd frontend-react
npm install
npm run dev
```

React dev URL:

```text
http://localhost:5173/react/
```

Notes:

- `vite.config.js` sets `base: '/react/'`
- `/api` calls are proxied to `http://localhost:3001`
- module iframes in dev mode are loaded from `http://localhost:3001/<entryPath>`

### Build React for backend hosting

```powershell
cd frontend-react
npm run build
```

Then open:

```text
http://localhost:3001/react
```

## Configuration

Current `backend/.env` supports these values:

| Variable | Purpose |
| --- | --- |
| `PORT` | Backend port. Defaults to `3001`. |
| `SQLITE_PATH` | SQLite file path. Defaults to `./data/employee_details.db`. |
| `ALLOWED_ORIGINS` | Optional comma-separated CORS allowlist. Empty means permissive CORS. |
| `ADMIN_PASSWORD_HASH` | Required bcrypt hash for the admin dashboard password. Use this instead of storing a plaintext password. The dashboard can later update the stored hash in SQLite. |
| `ADMIN_SESSION_TTL_MS` | Admin session lifetime. Defaults to 8 hours. |
| `ADMIN_LOGIN_WINDOW_MS` | Login attempt tracking window. Defaults to 15 minutes. |
| `ADMIN_LOGIN_MAX_ATTEMPTS` | Max failed attempts before temporary lockout. Defaults to 5. |
| `ADMIN_LOGIN_LOCK_MS` | Temporary login lock duration. Defaults to 15 minutes. |

Important:

- The checked-in `backend/.env` now stores a bcrypt hash instead of a plaintext password.
- If you change the admin password, generate a fresh bcrypt hash and replace `ADMIN_PASSWORD_HASH`.
- You can also change the admin password from the admin dashboard. That writes a new bcrypt hash into the SQLite settings store and rotates the active admin session.

Generate a new hash with:

```powershell
cd backend
node -e "const bcrypt=require('bcryptjs'); console.log(bcrypt.hashSync('your-new-password', 10));"
```

## Admin dashboard

Open:

```text
http://localhost:3001/admin/submissions.html
```

Capabilities verified from source:

- sign in with admin password
- resume an authenticated session from the session cookie
- enable or disable individual modules
- register an existing packaged HTML module by `id`, `title`, and `entryPath`
- lock or unlock the whole portal with a custom message
- view employee records
- auto-refresh records every 30 seconds
- print employee records
- delete all employee records after password confirmation

Module registration rules enforced by the backend:

- `id`, `title`, and `entryPath` are required
- `entryPath` must end in `.html`
- `entryPath` must resolve inside this workspace
- `entryPath` must already exist on disk
- duplicate module IDs are rejected

## API summary

### Public

- `GET /health`
- `GET /api/v1/public-state`
- `POST /api/v1/employee-details`

`POST /api/v1/employee-details` expects:

```json
{
  "name": "Alice",
  "department": "Engineering",
  "email": "alice@example.com"
}
```

### Admin

- `POST /api/v1/admin/login`
- `GET /api/v1/admin/session`
- `POST /api/v1/admin/logout`
- `GET /api/v1/admin/settings`
- `PUT /api/v1/admin/settings/module/:moduleId`
- `POST /api/v1/admin/modules`
- `PUT /api/v1/admin/settings/site-lock`
- `GET /api/v1/employee-details?page=1&pageSize=500`
- `DELETE /api/v1/admin/employee-details`

Admin authentication behavior:

- login creates an in-memory session and `admin_session` cookie
- admin state-changing requests require a valid CSRF token
- `x-admin-token` is also accepted when `ADMIN_TOKEN` is configured

## Data and persistence

- Employee submissions are stored in SQLite.
- Module registry, module availability, and site lock state are also persisted in SQLite.
- Admin sessions are not persisted. They live only in server memory and are lost on server restart.
- Legacy portal progress is stored in the browser via `localStorage`.

## Development notes

- The backend serves the entire repo root with `express.static(appRoot)`, so the training HTML folders are directly web-accessible while the server is running.
- The React app depends on a built `frontend-react/dist` folder for backend-hosted mode.
- The legacy portal is the only frontend here that captures employee details and generates completion certificates.
- As of May 18, 2026, no automated test scripts or lint scripts are defined in `backend/package.json` or `frontend-react/package.json`.

## Recommended start path

For day-to-day use:

- start the backend first
- use `http://localhost:3001/` for the legacy full portal
- use `http://localhost:3001/react` for the newer React shell
- use `http://localhost:3001/admin/submissions.html` for administration
