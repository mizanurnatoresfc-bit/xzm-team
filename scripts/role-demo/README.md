# Role demo walk

Opens **every page a role can reach** in a real browser, with the app's database requests answered by a local
throwaway PostgreSQL database that has all the migrations — so the real RLS policies and functions decide what each
role sees. It reports pages that crash, database calls that are refused or fail, and pages wider than the screen.
Nothing here touches the live Supabase project.

`gw.mjs` is a small test-only stand-in for the Supabase REST API (tables, filters, embeds, RPC). If the app uses a
query shape it does not know, the run lists it under "SHIM unsupported" instead of reporting it as an app fault.

```bash
# 1. a throwaway database with everything in it (same as scripts/test-db.sh, but kept)
export PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=xzm_demo
psql -d postgres -c "drop database if exists xzm_demo" -c "create database xzm_demo"
psql -q -f supabase/tests/local_supabase_shim.sql
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -f "$f"; done
psql -q -f supabase/tests/00_helpers.sql
psql -q -f scripts/role-demo/seed.sql

# 2. a copy of the site that talks to a made-up address (every request is answered locally)
cd web && npm ci && npm i --no-save pg
VITE_SUPABASE_URL=https://xzmdemo.supabase.co VITE_SUPABASE_ANON_KEY=demo npx vite build --outDir dist-demo

# 3. walk it: staff, hub manager, zonal manager, at PC and phone size
node ../scripts/role-demo/walk.mjs          # ROLES=hub_mgr SIZES=phone to narrow; CHROME=/path/to/chrome to use an installed browser
```

Screenshots and `walk-report.json` land in `web/role-demo-out/`.
Result of 22 Nov 2026: 227 pages × 2 sizes, 0 crashes, 0 failed database calls (see `docs/GO_LIVE_ROADMAP.md`).
