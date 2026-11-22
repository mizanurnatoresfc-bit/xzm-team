#!/usr/bin/env bash
# Run after "npm run build" when Netlify itself builds the site (netlify.toml), i.e. when the GitHub workflow
# "Android APK and site build" did not publish it. Copies the Android app that is live now into dist/download,
# so a site update never takes the app download away. Usage: keep-live-apk.sh <dist folder>
#  - no app published yet (apk.json answers 404): nothing to keep, the build goes on;
#  - an app is live but cannot be copied whole: the build stops, and the live site stays as it is.
set -euo pipefail
DIST="${1:-dist}"
SITE="${LIVE_SITE:-https://xzmteam.com}"
if [ -s "$DIST/download/XZM-TEAM.apk" ] && [ -s "$DIST/download/apk.json" ]; then echo "keep-live-apk: the build already has an app"; exit 0; fi
tmp="$(mktemp -d)"
code="$(curl -sSL -o "$tmp/apk.json" -w '%{http_code}' "$SITE/download/apk.json" || true)"
# The site answers every unknown address with the app page (status 200), so the file must really be the app's JSON.
if [ "$code" = "404" ] || { [ "$code" = "200" ] && ! node -e "const j=JSON.parse(require('fs').readFileSync('$tmp/apk.json','utf8')); if(!(j.build>0)) process.exit(1)" 2>/dev/null; }; then
  echo "keep-live-apk: no app is published on $SITE yet"; exit 0
fi
if [ "$code" != "200" ]; then echo "keep-live-apk: $SITE/download/apk.json answered $code - stopping so the live app download is not lost" >&2; exit 1; fi
curl -fsSL "$SITE/download/XZM-TEAM.apk" -o "$tmp/app.apk"
if [ "$(head -c 2 "$tmp/app.apk")" != "PK" ]; then echo "keep-live-apk: the live app file is not an APK - stopping" >&2; exit 1; fi
mkdir -p "$DIST/download"
cp "$tmp/apk.json" "$DIST/download/apk.json"; cp "$tmp/app.apk" "$DIST/download/XZM-TEAM.apk"
echo "keep-live-apk: kept the live app ($(wc -c < "$tmp/app.apk") bytes)"
