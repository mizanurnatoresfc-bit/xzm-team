# Android app (Capacitor)

The Android app is the same React app as the website, packed into an Android shell with
[Capacitor](https://capacitorjs.com). Same login, same database, same permissions.

## One-time setup on the PC
1. **Node.js** (LTS) — https://nodejs.org (already installed if `save-to-git.bat`/Netlify deploy worked).
2. **Android Studio** — https://developer.android.com/studio . Install, open it once and finish the
   setup wizard (it downloads the Android SDK into `%LOCALAPPDATA%\Android\Sdk`).
3. `web\.env.local` must exist (`web\create-env.bat`).

## Build the APK
Double-click `make-android.bat` in the project folder. First run: 10–20 minutes (downloads).
Result: `XZM-TEAM.apk` in the project folder. Send it to a phone (WhatsApp / Drive / USB) and open it;
Android asks to allow "install unknown apps" once.

## Updates from inside the app (since 16 Nov 2026)
The app loads the live site (`server.url` = https://xzmteam.com in `web/capacitor.config.json`), so a website update is an app
update too: install the APK **once**. When a newer build is live, the app shows "নতুন আপডেট এসেছে — আপডেট করুন" (it compares its
build id with `/version.json`); tapping reloads into the new pages. Settings → "অ্যাপ ও আপডেট" shows the version and checks now.

A new APK is needed only when the phone side changes (a new native plugin, permissions, icon). Build it with Actions → "Android APK
and site build" → Run workflow: the APK is numbered with the run number and published at `/download/XZM-TEAM.apk` with
`/download/apk.json`; installed apps then show "অ্যাপের নতুন ভার্সন — ডাউনলোড করুন". Ordinary pushes keep the published APK.
Without internet the app shows `offline.html` with a retry button.

## Signing key (so each APK installs over the last)
The APK is signed with the app's permanent key, kept as repository secrets: `ANDROID_KEYSTORE_BASE64` (the .jks file, base64),
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`xzmteam`), `ANDROID_KEY_PASSWORD`. Created 16 Nov 2026, SHA-256 fingerprint
`AF:73:08:29:44:FA:40:86:70:C2:15:75:32:B7:26:F5:0C:43:D1:8D:15:CE:CF:A9:8E:E5:6F:52:45:C2:61:68`. The owner keeps the key file
and passwords safe outside git: losing them means installed apps cannot be updated (everyone reinstalls). Without the secrets
the workflow makes a debug build and warns. The first signed APK replaces a debug one only after uninstalling the debug one.

## What the script does
`npm install` → `npm run build` → `npx cap add android` (first time only, creates `web/android/`)
→ icons/splash from `web/assets/` (`@capacitor/assets`) → `npx cap sync android` → `gradlew assembleDebug`.

## App details
- App id `com.xzmteam.erp`, name `XZM-TEAM` (`web/capacitor.config.json`).
- Starts at the staff login (the public home page is website-only).
- Android back button: closes an open dialog/menu first, then goes back; on the dashboard it sends the
  app to the background (`web/src/lib/native.ts`).
- The app's web origin is `https://localhost`; the Edge Functions `auth-login` and `admin-users`
  allow it (CORS). **They must be redeployed once with this change before the app can sign in.**

## Play Store (later)
The script builds a *debug* APK for direct install. For Google Play you need a Google Play Developer
account (one-time US$25), a signing key (keep it safe — losing it means you cannot update the app),
and a release bundle: Android Studio → Build → Generate Signed App Bundle.

## Camera (for the barcode scanner, later)
When the scanner page is built, add `<uses-permission android:name="android.permission.CAMERA" />`
to `web/android/app/src/main/AndroidManifest.xml`.

## Build online (GitHub Actions) — no Android Studio needed
`.github/workflows/android-apk.yml` builds the same APK on GitHub's servers.
1. The project is in a private GitHub repository (`xzm-team-erp`).
2. Supabase settings come from `web/.env.production` (public URL + publishable key — never a secret key).
   Repository variables `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` override them if set.
3. Every push that changes `web/` builds a new APK (or Actions → "Android APK" → Run workflow).
4. Open the finished run → **Artifacts** → `XZM-TEAM-apk` → unzip → `XZM-TEAM.apk`.

## Publishing the website from GitHub (no Netlify build credits)
Netlify's free plan limits builds run on Netlify's own servers ("account credit usage
exceeded"). The workflow therefore builds the site on GitHub and uploads the finished files:
- Add a repository secret `NETLIFY_AUTH_TOKEN` (Netlify → User settings → Applications →
  New access token; GitHub → repo Settings → Secrets and variables → Actions). Every push
  then publishes the site automatically, with no build on Netlify's side.
- Without the secret, download the run's `site-dist` artifact and drop that zip on
  https://app.netlify.com/projects/xzm-team-erp/deploys instead.
