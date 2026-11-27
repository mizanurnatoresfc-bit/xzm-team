#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${SUPABASE_DB_URL:?}" "${SUPABASE_S3_ACCESS_KEY_ID:?}" "${SUPABASE_S3_SECRET_ACCESS_KEY:?}"
: "${R2_ENDPOINT:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}" "${BACKUP_PASSPHRASE:?}"

project_ref=ndgnhvbpmtxrpplgsslz
bucket=xzm-team-supabase-backups
export BACKUP_PROJECT_REF="$project_ref"
python3 - <<'PY'
import os
from urllib.parse import urlsplit
ref = os.environ["BACKUP_PROJECT_REF"]
db = urlsplit(os.environ["SUPABASE_DB_URL"])
host = db.hostname or ""
direct = host == f"db.{ref}.supabase.co" and db.port in (None, 5432)
pooled = host.endswith(".pooler.supabase.com") and db.port in (None, 5432) and (db.username or "").endswith(f".{ref}")
if db.scheme not in ("postgresql", "postgres") or not (direct or pooled):
    raise SystemExit("Database URL must use the expected project and a direct or session connection.")
r2 = urlsplit(os.environ["R2_ENDPOINT"])
if r2.scheme != "https" or r2.hostname != "80d49a409ddcfa2db3c7289621ce19ba.r2.cloudflarestorage.com" or r2.path not in ("", "/") or r2.username or r2.query or r2.fragment:
    raise SystemExit("Unexpected R2 endpoint.")
PY

work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
cd "$work"
mkdir database storage

supabase db dump --db-url "$SUPABASE_DB_URL" --role-only --file database/roles.sql
supabase db dump --db-url "$SUPABASE_DB_URL" --file database/schema.sql
supabase db dump --db-url "$SUPABASE_DB_URL" --data-only --use-copy --file database/data.sql
for dump in database/{roles,schema,data}.sql; do
  test -s "$dump"
done
grep -q '^COPY ' database/data.sql
grep -Eq '^CREATE (TABLE|SCHEMA|FUNCTION)' database/schema.sql

source_s3() {
  AWS_ACCESS_KEY_ID="$SUPABASE_S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$SUPABASE_S3_SECRET_ACCESS_KEY" \
    aws --region ap-southeast-1 --endpoint-url "https://$project_ref.storage.supabase.co/storage/v1/s3" "$@"
}
target_s3() {
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    aws --region auto --endpoint-url "$R2_ENDPOINT" "$@"
}

source_s3 s3api list-buckets --output json > storage/buckets.json
python3 - <<'PY' > bucket-names
import json
import re
with open("storage/buckets.json") as source:
    buckets = json.load(source)["Buckets"]
if not buckets:
    raise SystemExit("No source buckets found.")
for bucket in buckets:
    name = bucket["Name"]
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", name):
        raise SystemExit("Unexpected source bucket name.")
    print(name)
PY

while IFS= read -r name; do
  mkdir -p "storage/objects/$name"
  source_s3 s3api list-objects-v2 --bucket "$name" --output json > "storage/$name.objects.json"
  export BACKUP_BUCKET_NAME="$name"
  python3 - <<'PY'
import hashlib
import json
import os
from pathlib import Path
import subprocess

name = os.environ["BACKUP_BUCKET_NAME"]
ref = os.environ["BACKUP_PROJECT_REF"]
manifest = Path(f"storage/{name}.objects.json")
listing = json.loads(manifest.read_text())
env = dict(os.environ, AWS_ACCESS_KEY_ID=os.environ["SUPABASE_S3_ACCESS_KEY_ID"],
           AWS_SECRET_ACCESS_KEY=os.environ["SUPABASE_S3_SECRET_ACCESS_KEY"])
for obj in listing.get("Contents", []):
    key = obj["Key"]
    filename = hashlib.sha256(key.encode("utf-8")).hexdigest()
    path = Path("storage/objects") / name / filename
    response = subprocess.run([
        "aws", "--region", "ap-southeast-1",
        "--endpoint-url", f"https://{ref}.storage.supabase.co/storage/v1/s3",
        "s3api", "get-object", "--bucket", name, "--key", key,
        "--output", "json", str(path),
    ], env=env, capture_output=True, text=True)
    if response.returncode:
        raise SystemExit("Storage object download failed.")
    metadata = json.loads(response.stdout)
    if metadata.get("ETag") != obj["ETag"] or path.stat().st_size != obj["Size"]:
        raise SystemExit("Storage object changed during backup.")
    obj["BackupFilename"] = filename
    obj["BackupMetadata"] = metadata
manifest.write_text(json.dumps(listing, ensure_ascii=False))
PY
done < bucket-names

printf '%s\n' "$BACKUP_PASSPHRASE" > passphrase
for payload in database storage; do
  tar -czf "$payload.tar.gz" "$payload"
  gpg --batch --pinentry-mode loopback --passphrase-file passphrase --cipher-algo AES256 \
    --output "$payload.tar.gz.gpg" --symmetric "$payload.tar.gz"
done

prefix="s3://$bucket/manual/$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
mkdir downloaded
for payload in database storage; do
  artifact="$payload.tar.gz.gpg"
  sha256sum "$artifact" > "$artifact.sha256"
  target_s3 s3 cp "$artifact" "$prefix/$artifact" --only-show-errors
  target_s3 s3 cp "$artifact.sha256" "$prefix/$artifact.sha256" --only-show-errors
  target_s3 s3 cp "$prefix/$artifact" "downloaded/$artifact" --only-show-errors
  target_s3 s3 cp "$prefix/$artifact.sha256" "downloaded/$artifact.sha256" --only-show-errors
  (cd downloaded && sha256sum --check "$artifact.sha256")
  gpg --batch --pinentry-mode loopback --passphrase-file passphrase --decrypt "downloaded/$artifact" \
    | tar -dzf - "$payload"
done

date -u +%FT%TZ > verified.txt
target_s3 s3 cp verified.txt "$prefix/verified.txt" --only-show-errors
