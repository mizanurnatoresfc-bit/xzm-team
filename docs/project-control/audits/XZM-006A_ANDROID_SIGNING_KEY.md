# XZM-006A — Android Signing Key: Original Backup + Match Verification + Encrypted Storage

**Status:** UNDER_REVIEW — read-only verification pass complete 2026-11-27
**Parent:** XZM-006 (merged in PR #214, commit `b94e5d1`)
**Mode:** Read-only — no keystore extracted, no secret printed, no GitHub Actions secret read, no production change.
**Priority:** P0 (CRITICAL) — Risk R-001

> If the signing key is lost, no future update can upgrade existing installs; users would have to uninstall + reinstall a newly-signed APK. This file documents (a) how the Owner locates the original keystore, (b) how Claude/Owner verifies any found file matches the current live APK, and (c) how the verified keystore is stored off-GitHub in encrypted form.

---

## 1. What is already VERIFIED about the current signing chain

Facts drawn only from source already in the repo on `main` (`b94e5d1`) — no secret read:

| Fact | Source | Value |
|---|---|---|
| Keystore secret name | `.github/workflows/android-apk.yml` line 115 | `ANDROID_KEYSTORE_BASE64` (base64-encoded keystore) |
| Keystore password secret | same, line 116 | `ANDROID_KEYSTORE_PASSWORD` |
| Key alias secret | same, line 120 | `ANDROID_KEY_ALIAS` |
| Key password secret | same, line 120 | `ANDROID_KEY_PASSWORD` |
| Signer tool | same, line 133 | `apksigner` from latest Android `build-tools` |
| APK sign call | same, line 138–139 | `apksigner sign --ks "$keystore" --ks-key-alias "$KEY_ALIAS" --ks-pass env:KEYSTORE_PASSWORD --key-pass env:KEY_PASSWORD` |
| Signer-match guard (line 171–196) | same workflow | Downloads the current live APK, extracts SHA-256 signer digests via `apksigner verify --print-certs`, compares against the newly-built APK. If the two digests differ, the workflow fails with `::error::The APK signer differs from the published APK. Use the established signing key.` |
| appId | `wrangler.jsonc` + `make-android.bat` | `com.xzmteam.erp` (legacy name preserved to keep existing installs upgradable) |
| Live APK location | `https://xzmteam.com/download/XZM-TEAM.apk` + `/download/apk.json` | Public artifact |
| Keystore persistence in CI | workflow line 127–128 | `mktemp` + `trap 'rm -f' EXIT` — keystore file is wiped at job end; never persisted to any artifact or cache |

**Implication:** the production signing-certificate SHA-256 fingerprint is observable to anyone (it is embedded in every published APK — a public artifact). Extracting it is a verification step, not a secret exposure.

---

## 2. Finding the original keystore — Owner checklist

GitHub Actions secrets are **write-only** after creation. The source of truth for recovery is wherever the Owner first stored the keystore file before uploading its base64 copy to GitHub.

Search these places, in order of likelihood:

1. **Development machine — the `android/app/` folder of the local XZM TEAM project clone** (path kept in Owner's private records / `PROJECT_CONNECTIONS.md`): look for `*.jks`, `*.keystore`, and `keystore.properties`. If a `keystore.properties` sits next to the keystore it usually names the alias.
2. **A separate "keys" / "signing" directory** on the same machine, outside the project tree (many developers keep keystores off-repo on purpose).
3. **Password-manager vault** (Bitwarden, 1Password, KeePass, etc.): look for an attachment `*.jks` or `*.keystore`, plus three stored passwords (store password, key alias, key password).
4. **Offline media** (external drive, USB, SD card) used around first signed-build day (which is before the earliest Android APK workflow run — check GitHub Actions history for the first green `android-apk.yml` run date).
5. **Backup drive / personal cloud storage** (OneDrive, Google Drive, Dropbox): filename search `*.jks` OR `*.keystore` across the whole personal drive.
6. **Email**: search Owner's own inbox/outbox for an attachment with those extensions, or a self-mail labelled `xzm`, `keystore`, `signing`.

If NONE of 1–6 turns up the file, Section 5 of this doc describes the downstream consequences and the only remaining option.

---

## 3. Fingerprint extraction — how the current live-APK signing certificate is read

**Where this is run:** on the Owner's machine (or in a throwaway sandbox Claude cannot write to from here). The command reads only the live public APK; it prints no secret.

Prerequisites: Android SDK `build-tools` (`apksigner`, `keytool`), or `openssl` + `unzip` as a fallback.

### 3.1 Method A — `apksigner` (preferred; same as `android-apk.yml`)

```bash
# Download the current live APK (public URL)
curl -L -o live.apk https://xzmteam.com/download/XZM-TEAM.apk

# Print signer certificate details including SHA-256 digest
apksigner verify --print-certs live.apk
```

Expected output lines include:

```
Signer #1 certificate DN: CN=…, OU=…, O=…, L=…, ST=…, C=…
Signer #1 certificate SHA-256 digest: <64-hex-character fingerprint>
Signer #1 certificate SHA-1 digest:   <40-hex-character fingerprint>
Signer #1 certificate MD5 digest:     <32-hex-character fingerprint>
```

The workflow uses exactly these SHA-256 digests to gate every new build (line 174–195 of `android-apk.yml`). **The SHA-256 digest is the production fingerprint. Record it.**

### 3.2 Method B — `keytool` on the extracted cert (fallback if `apksigner` is unavailable)

```bash
# The APK is a zip; the signer cert is in META-INF/*.RSA (or *.EC, *.DSA)
unzip -j live.apk 'META-INF/*.RSA' 'META-INF/*.EC' 'META-INF/*.DSA' -d apk-sig/
# For each extracted file:
keytool -printcert -file apk-sig/<certfile>
# Among the output lines: "SHA256: XX:XX:..." — remove the colons to match apksigner's format.
```

### 3.3 Where to record the fingerprint

Owner writes the 64-hex SHA-256 fingerprint into **`docs/project-control/PROJECT_CONNECTIONS.md`** under a new §11 "Android signing fingerprint (public)" subsection. This value is NOT a secret — it is the public identity of the app's signer, printed in every APK and visible to any installer.

---

## 4. Matching a found keystore against the live fingerprint

Once the Owner has located a candidate `.jks` / `.keystore` file (§2), the verification runs locally — no upload, no copy off the Owner's machine.

```bash
# List the certificate in the candidate keystore
keytool -list -v -keystore <candidate.jks> -alias <alias from keystore.properties or workflow secret>
# Prompts for the store password; enter it locally.
# In the output, find: "SHA256: XX:XX:..."
# Remove the colons → compare byte-for-byte to the fingerprint recorded in §3.3.
```

Interpretation:

- **Match → this IS the production keystore.** Proceed to §5 (encrypted backup).
- **No match →** this is a different key. Do NOT upload it; keep searching per §2. (A mismatched key is useless for upgrading existing installs even if it signs a valid APK.)
- **Password rejected →** candidate may still be the right file; try the other passwords the Owner has stored. Do not guess; three wrong attempts does not lock a local keystore, but it wastes time.

Two helper scripts the Owner may add to the repo later (NOT in this PR):

- `scripts/verify-apk-signer.sh` — downloads live APK and prints SHA-256 fingerprint.
- `scripts/verify-local-keystore.sh` — given a `.jks` path + alias, prints its SHA-256 and compares against the fingerprint recorded in `PROJECT_CONNECTIONS.md`.

These are opened under XZM-006A-impl (follow-up implementation PR), not this docs PR.

---

## 5. Encrypted off-GitHub backup — storage procedure

Once a matching keystore is in hand, the Owner must store it in **at least two independent locations** so that the loss of any single one leaves the other intact.

### 5.1 Minimum encrypted-backup bundle

The bundle consists of three items. Keep them in the same encrypted envelope so that restoring one restores all three:

1. The keystore file itself (`xzm-team.jks`).
2. `keystore.properties` with four fields:
   - `storeFile=xzm-team.jks`
   - `storePassword=<value>`
   - `keyAlias=<value>`
   - `keyPassword=<value>`
3. A short `README.txt` with:
   - The public SHA-256 fingerprint (same value as in `PROJECT_CONNECTIONS.md`).
   - The appId: `com.xzmteam.erp`.
   - The date of first use.
   - A one-line note: "Loss of this bundle breaks the Android update channel. Treat like a long-lived API key."

### 5.2 Encryption method (any one of these; prefer A)

**A — GPG symmetric (recommended, no key infrastructure needed):**

```bash
tar -cf xzm-keystore-bundle.tar xzm-team.jks keystore.properties README.txt
gpg --symmetric --cipher-algo AES256 --output xzm-keystore-bundle.tar.gpg xzm-keystore-bundle.tar
shred -u xzm-keystore-bundle.tar          # wipe the unencrypted intermediate
```

The GPG passphrase itself is stored in the Owner's password manager, under its own entry (NOT in the same vault entry as the file attachment — a separation lets the attachment travel safely while the passphrase stays in the vault).

**B — age (modern alternative):** `age -p -o xzm-keystore-bundle.tar.age xzm-keystore-bundle.tar`.

**C — 7-Zip with AES-256 + encrypted headers:** `7z a -p -mhe=on xzm-keystore-bundle.7z xzm-team.jks keystore.properties README.txt`.

### 5.3 Where the encrypted bundle lives (two + one)

- **Location 1 — password-manager vault** (Bitwarden, 1Password, KeePass): attach `xzm-keystore-bundle.tar.gpg`. Vault entry title: `XZM TEAM — Android signing (encrypted)`. In the notes field put the SHA-256 fingerprint and the date. The decryption passphrase lives in a **separate** vault entry: `XZM TEAM — Android signing passphrase`.
- **Location 2 — offline media** (encrypted USB or external drive kept in a physically separate place): the same `.tar.gpg` file in a directory named `xzm-team/android-signing/`. A paper copy of the SHA-256 fingerprint and the appId can live beside it. Do NOT write the GPG passphrase on the paper.
- **Location 3 (optional) — Cloudflare R2 or similar private object storage** owned by the Owner, in a bucket with no public read, locked by the Owner's account. This is convenient but not required.

**What NOT to do:**

- Do not upload the plaintext keystore to any Git repository, public or private.
- Do not commit `keystore.properties` with real values to the repo.
- Do not store the encryption passphrase in the same place as the encrypted bundle.
- Do not share the bundle over unencrypted email, chat or SMS.
- Do not rely on GitHub Actions secrets as the only copy — they are write-only and cannot be exported.

### 5.4 Rotation / renewal

An Android signing key does not expire until its certificate's validity date. The current certificate's validity window is readable in the output of `apksigner verify --print-certs` (line "Valid from … until …"). Owner notes the "until" date in `PROJECT_CONNECTIONS.md`. If the certificate has, say, a 25-year validity, rotation is a non-issue for the foreseeable future; if it has a shorter validity, open a calendar reminder one year before expiry.

### 5.5 If no keystore can be found anywhere

This is the irrecoverable case. The only paths forward:

1. Accept a new signing chain → every existing installed instance of XZM TEAM is detached (Play Store / sideloaded both). Users must uninstall + reinstall the new APK; they lose any cached local state. Announce on the login screen and in-app notice two weeks ahead.
2. Enroll the production app in **Play App Signing** on first future publish. This transfers the signing authority to Google; the Owner then holds only an upload key. For a sideloaded distribution (direct download from xzmteam.com) this is not available.

Risk status does not change by writing this doc: R-001 stays OPEN until §2 produces a file that §4 matches.

---

## 6. Compliance

- ✅ No keystore extracted or decoded in this session.
- ✅ No GitHub Actions secret read, printed or exported.
- ✅ No live APK downloaded from this Claude session (the fingerprint-extraction steps run on the Owner's machine; the session's network allowlist does not permit a direct download to `xzmteam.com`).
- ✅ No change to workflow, repo code, or production configuration.
- ✅ No `wrangler.jsonc` / `netlify.toml` / secret rotation performed.

---

## 7. Owner action items (gated on §2)

| # | Action | Blocks |
|---|---|---|
| 1 | Perform §2 checks 1–6 until a candidate `.jks` / `.keystore` is found | R-001 mitigation |
| 2 | Run §3.1 Method A on the Owner's machine; record the SHA-256 fingerprint in `PROJECT_CONNECTIONS.md` §11 | §4 verification |
| 3 | Run §4 against the candidate; confirm match | §5 backup |
| 4 | Build the encrypted bundle per §5.1–§5.2 and store it per §5.3 in two separate locations | R-001 MITIGATED |
| 5 | After backup is confirmed in two locations, close XZM-006A and move R-001 OPEN → MITIGATED | — |

---

## 8. What the follow-up implementation PR will add

(Not in this PR; opened as **XZM-006A-impl** once §7 steps 1–3 are done.)

- `scripts/verify-apk-signer.sh` — downloads live APK, prints SHA-256.
- `scripts/verify-local-keystore.sh` — compares a local `.jks` against the recorded fingerprint.
- `PROJECT_CONNECTIONS.md` §11 — the public fingerprint value and validity "until" date.
- Updated RISK_REGISTER R-001 → MITIGATED, with the backup-location summary (no secret, just a count: "two encrypted copies on Owner-controlled media").
