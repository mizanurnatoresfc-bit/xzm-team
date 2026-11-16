#!/usr/bin/env bash
# Runs all database migrations + SQL tests against a THROWAWAY database.
# Usage:
#   PGHOST=/tmp PGPORT=54322 PGUSER=postgres scripts/test-db.sh            # plain local Postgres
#   With Supabase CLI:  supabase start  then  PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres PGPASSWORD=postgres scripts/test-db.sh --supabase
# Never point this at production.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${TEST_DB:-xzm_team_test}"
SUPABASE_MODE=0
[[ "${1:-}" == "--supabase" ]] && SUPABASE_MODE=1

PSQL=(psql -X -v ON_ERROR_STOP=1 -q)

if [[ $SUPABASE_MODE -eq 0 ]]; then
  "${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
  # Start in UTC like a Supabase project, so tests prove the time zone migration works.
  "${PSQL[@]}" -d postgres -c "alter database $DB set timezone to 'UTC'" >/dev/null
  "${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/tests/local_supabase_shim.sql" >/dev/null
  for f in "$ROOT"/supabase/migrations/*.sql; do
    echo "migrate: $(basename "$f")"
    "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null
  done
else
  DB=postgres   # supabase start already applied migrations
fi

"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/tests/00_helpers.sql" >/dev/null

pass=0; fail=0
for f in "$ROOT"/supabase/tests/[1-9]*.sql; do
  out=$("${PSQL[@]}" -d "$DB" -f "$f" 2>&1) && status=0 || status=$?
  n=$(grep -c 'PASS:' <<<"$out" || true)
  pass=$((pass + n))
  if [[ $status -ne 0 ]]; then
    fail=$((fail + 1))
    echo "FAILED  $(basename "$f")  ($n passed before failure)"
    grep -E 'ERROR|FAIL' <<<"$out" | head -5
  else
    echo "ok      $(basename "$f")  ($n assertions)"
  fi
done
echo "----"
echo "assertions passed: $pass   failing files: $fail"
[[ $fail -eq 0 ]]
