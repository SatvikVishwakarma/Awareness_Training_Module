# Employee Details API

This backend stores employee submissions from the training form into a local SQLite database file.

## Captured fields

- `name`
- `department`
- `email`
- `ip_address`
- `submitted_at` (timestamp)

## Setup

1. Copy `.env.example` to `.env` and set values.
2. Install dependencies:

```bash
npm install
```

3. Start server:

```bash
npm start
```

The API runs on `http://localhost:3001` by default.
Data is stored at `./data/employee_details.db` by default (`SQLITE_PATH` in `.env`).

## Endpoints

- `POST /api/v1/employee-details`  
  Request body:
  ```json
  {
    "name": "Alice",
    "department": "Engineering",
    "email": "alice@example.com"
  }
  ```

- `GET /api/v1/employee-details?page=1&pageSize=50`  
  Returns paginated submissions.  
  If `ADMIN_TOKEN` is set, pass header `x-admin-token`.

- `POST /api/v1/admin/login`
  Request body:
  ```json
  {
    "password": "your-admin-password"
  }
  ```
  Returns an admin session token used as header `x-admin-session`.

- `GET /api/v1/admin/settings`
  Returns module registry, module availability, and portal lock state (admin auth required).

- `POST /api/v1/admin/modules`
  Register a packaged training module (admin auth + CSRF required).
  Request body:
  ```json
  {
    "id": "cloud-security",
    "title": "Cloud Security Essentials",
    "entryPath": "cloud-security-training/module.html"
  }
  ```
  Notes:
  - `entryPath` must resolve to an existing `.html` file in this workspace.
  - Raw HTML upload is not supported; modules are registered by package path.

- `PUT /api/v1/admin/settings/module/:moduleId`
  Request body:
  ```json
  {
    "enabled": true
  }
  ```

- `PUT /api/v1/admin/settings/site-lock`
  Request body:
  ```json
  {
    "locked": true,
    "reason": "Training portal is temporarily unavailable."
  }
  ```

- `GET /api/v1/public-state`
  Public endpoint used by the training front end to enforce module enable/disable and lock state.
  Also returns the registered module catalog.

- `GET /health`

## Admin list page

Open:

`http://localhost:3001/admin/submissions.html`

This admin dashboard allows you to:

- Sign in with a password (`ADMIN_PASSWORD` in `.env`, or `ADMIN_TOKEN` as fallback)
- Enable/disable specific training modules
- Lock/unlock the training portal globally
- View employee records with live refresh
- Print records

## React migration (new frontend shell)

A new React app lives in `../frontend-react` and consumes `GET /api/v1/public-state`.

Run in development:

```bash
cd ../frontend-react
npm install
npm run dev
```

Build for backend hosting:

```bash
cd ../frontend-react
npm run build
```

After build, open `http://localhost:3001/react`.
