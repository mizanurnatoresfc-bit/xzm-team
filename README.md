# XZM-TEAM — Management + Accounts ERP

Enterprise management ERP for Head Office, Zones, Hubs, HR and courier operations, with Accounts (Daily Accounts module done in the database and React) growing in later releases.

**Approved architecture:** React + TypeScript + Vite + Supabase (Auth, PostgreSQL, RLS, Storage, RPC and Edge Functions).

**Release strategy:** phased. Release 1 targets HR & Management. Accounts and live Courier workflows are later releases. The existing HTML demo is for demonstration only and is not production-connected.

## Repository layout

```text
docs/                    Architecture, implementation plan, progress, production roadmap
web/                     Initial React + Supabase frontend scaffold
supabase/migrations/     Database schema, rules and RLS (apply in filename order)
supabase/tests/          SQL tests for RLS, permissions, HR, zonal and courier workflows
demo/                    Non-production HTML/JavaScript demo only
scripts/                 Local database test runners
```

## Version control

Double-click `save-to-git.bat` to create the git repository (first run) or save a new snapshot (later runs). It refuses to save `.env` files or anything that looks like a secret key, and can optionally keep a private copy on GitHub.

## Frontend setup

```bash
cd web
cp .env.example .env.local
# Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local
npm install
npm run typecheck
npm run build
npm run dev
```

Only the public Supabase anon/publishable key belongs in browser environment variables. Never put the service-role key, database password, SMTP password or third-party secret in `web/`.

## Database

Apply migrations to a disposable development Supabase project first, in filename order. Run the SQL test suite against a real Supabase local/cloud environment and verify Storage policies before production. The 526 assertions documented in `docs/PROGRESS.md` were run against PostgreSQL with a local Supabase shim, not against a real Supabase project.

```bash
supabase link --project-ref <your-dev-project-ref>
supabase db push
```

Do not run `supabase/tests/local_supabase_shim.sql` on a real Supabase project.

## Go-live decision

**Not production-ready.** The React app is an initial scaffold only. Authentication hardening, full UI, real Supabase verification, Storage policy tests, SMTP, backup/restore, role-based E2E tests and deployment review are still required. See `docs/PRODUCTION_ROADMAP.md`.
