# Warden Dashboard

Independent Next.js dashboard application for aggregate Warden protection data.

The sync API accepts only aggregate category counts, pseudonymous repository
and session labels, timestamps, and one-way hashes. It rejects source code,
plaintext identifiers, comments, file contents, and unknown fields.

```bash
npm install
npm run dev
```

For a deployable standalone build:

```bash
npm run build
PORT=3000 WARDEN_ORG_TOKEN=<org-token> npm start
```

The API endpoint is `POST /api/sync` and requires
`Authorization: Bearer <org-token>`. SQLite data is stored at
`WARDEN_DASHBOARD_DB_PATH` or `data/warden-dashboard.db` during local
development.

Hosted deployments must set `DATABASE_URL` to a persistent Postgres database.
When it is present, the dashboard creates and uses its aggregate-only table in
Postgres instead of the local SQLite fallback.
