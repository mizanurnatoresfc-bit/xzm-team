#!/usr/bin/env bash
# Builds the STAGING database: every file in supabase/migrations/ plus the recorded live changes in supabase/live-drift/,
# in one timestamp order, so Staging has the same structure as live.
# Usage: STAGING_DB_URL='postgresql://...' scripts/system-control/staging-bootstrap.sh
# Safety: refuses to run against the live project, and only against a database that has no XZM TEAM tables yet.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LIVE_REF="ndgnhvbpmtxrpplgsslz"
STAGING_REF="mbpjvqeizwjjsvnbjerb"
URL="${STAGING_DB_URL:?Set STAGING_DB_URL to the Staging database connection string}"

if [[ "$URL" == *"$LIVE_REF"* ]]; then echo "REFUSED: this is the LIVE project."; exit 2; fi
if [[ "$URL" != *"$STAGING_REF"* ]]; then echo "REFUSED: the connection string is not the Staging project ($STAGING_REF)."; exit 2; fi

PSQL=(psql "$URL" -X -v ON_ERROR_STOP=1 -q)
existing=$("${PSQL[@]}" -tAc "select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'audit_logs'")
if [[ "$existing" != "0" ]]; then echo "REFUSED: Staging already has XZM TEAM tables. Nothing was changed."; exit 3; fi

files=$( (ls "$ROOT"/supabase/migrations/*.sql "$ROOT"/supabase/live-drift/*.sql) | awk -F/ '{print $NF" "$0}' | sort | awk '{print $2}')
n=0
for f in $files; do
  echo "apply: $(basename "$f")"
  "${PSQL[@]}" -f "$f" >/dev/null
  n=$((n + 1))
done
echo "Staging built from $n files."
