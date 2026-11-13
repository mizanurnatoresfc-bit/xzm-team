# Credentials & external services

**Never paste secret keys into chat, code, screenshots or documents.** Secrets go into Supabase Edge Function secrets (`supabase secrets set ...`) or your hosting provider's environment settings.

| # | Item | Needed for | Where it goes | Secret? | When |
|---|---|---|---|---|---|
| 1 | Supabase project (suggest region **Singapore** — closest to Bangladesh) | Everything | — | — | Phase 1 |
| 2 | `VITE_SUPABASE_URL` | Frontend | `.env.local` / hosting env | No | Phase 1 |
| 3 | `VITE_SUPABASE_ANON_KEY` | Frontend | `.env.local` / hosting env | No (public by design; RLS protects data) | Phase 1 |
| 4 | `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions only (login recorder, user invite) | Edge Function secrets — set automatically by Supabase | **Yes** | Phase 1 |
| 5 | Database password / Supabase access token | Running `supabase db push` (migrations) | Your machine only | **Yes** | Phase 1 |
| 6 | SMTP (e.g. company mail, Brevo, SES) | Password-reset & invite emails (Supabase's built-in mailer is rate-limited, not for production) | Supabase → Auth → SMTP settings | **Yes** | Before go-live |
| 7 | OCR provider key (e.g. Google Cloud Vision / Azure Document Intelligence) | Salary sheet & bank slip OCR | Edge Function secrets | **Yes** | Phase 4 (optional) |
| 8 | AI API key (e.g. Anthropic) | AI assistant | Edge Function secrets | **Yes** | Phase 7 (optional) |
| 9 | Hosting (Vercel / Netlify / Cloudflare Pages) + domain DNS | Deployment | Hosting dashboard | Account access | Phase 8 |

## What can be built without any credentials
* The whole database layer (tables, rules, RLS, workflows, accounting engine) — tested against a local PostgreSQL.
* The whole frontend code — runs against a local Supabase (`supabase start`, needs Docker) on your PC.

## What cannot be finished without them
* Real sign-in / email (needs #1–#3, #6), OCR (#7), AI assistant (#8), public deployment (#9).

## First admin (after migrations are applied)
1. Supabase dashboard → Authentication → Users → **Add user** (your email, strong password).
2. SQL editor: `select private.bootstrap_super_admin('your@email');` — works only once, while no Super Admin exists.
3. Sign in at `/secure-control`; create other admins from the app (each grant is audited).
