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

After any change to the web code, run `make-android.bat` again and reinstall the APK.

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
