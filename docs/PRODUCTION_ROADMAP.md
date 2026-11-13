# XZM-TEAM ERP — Approved Production Roadmap

**Owner decision (2026-11-13):** React + Supabase; phased release.

## Architecture decision

- Frontend: React + TypeScript + Vite.
- Backend platform: Supabase Auth + PostgreSQL + RLS + RPC + Storage + Edge Functions where privileged server-side work is required.
- Browser credentials: `VITE_SUPABASE_URL` and the public anon/publishable key only.
- Never expose `service_role`, database passwords, SMTP credentials, or AI/OCR keys in browser code or Git.
- PostgreSQL RLS and workflow functions remain the security boundary. Frontend permission checks are presentation only.
- A separate Node.js API is not part of this selected architecture. Add Edge Functions for privileged workflows, secrets, scheduled work and integrations.

## Release 1 — HR & Management (first live release)

Included:
1. Public company landing page and staff login.
2. Supabase Auth session, password reset, logout, idle timeout and inactive/locked account handling.
3. Organization, zones, hubs, departments and positions.
4. User profiles, role creation, permission matrix, multiple role assignments and global/zone/hub scopes.
5. Employee applications, approval and HR-entered Employee ID.
6. Employee profile, employment history, transfer, promotion, resignation and termination workflows.
7. Attendance, leave, compensation proposals and salary-sheet preparation (not payment posting).
8. Employee document storage with private buckets and audited sensitive-data reveal.
9. Audit log, login history, scoped HR dashboards and essential exports.

Excluded from Release 1:
- Accounts ledger, vouchers, journal posting, payroll payment and bank reconciliation.
- Live courier transactions, rider cash settlement and merchant payments.
- AI/OCR automation and public self-registration.

The courier and zonal database migrations already exist, but do not expose their workflows in Release 1 until real Supabase compatibility and UI tests pass. Accounts remains a later release.

## Release gates

### Gate A — Supabase project readiness
- Create a dedicated non-production Supabase project (Singapore region is the current suggested default).
- Apply all migrations in filename order to a disposable project first.
- Run the full SQL/RLS suite against actual Supabase, not only the local PostgreSQL shim.
- Verify Storage bucket policies and Auth user/profile trigger behavior.
- Confirm no service-role or database secret is present in frontend bundles or repository.

### Gate B — Frontend readiness
- Complete login, password reset, session restoration, logout, idle timeout and locked/inactive user behavior.
- Implement profile + `my_permissions()` loading and scope-aware navigation.
- Every screen must have loading, empty, error, no-permission and success states.
- All writes must call the intended audited workflow RPC; do not directly update workflow-controlled tables from the browser.
- Add Vitest component tests and Playwright role-based tests at 375, 768 and 1280 px.

### Gate C — HR acceptance
- Test Super Admin, HR Manager, Zone Manager, Hub Manager and employee self-service separately.
- Prove Zone A cannot read or change Zone B records, including Storage objects and exports.
- Prove sensitive identity data is masked and reveal is audited.
- Prove application approval, Employee ID uniqueness, transfer history, leave approval and salary-sheet maker/checker controls.
- Test import duplicate handling and second-person verification.

### Gate D — Live approval
- Production SMTP configured and password reset tested.
- Backups enabled and a restore drill completed.
- Domain, HTTPS, security headers, environment variables and deployment rollback verified.
- Seed/bootstrap the first Super Admin securely; remove demo accounts and demo routes from production.
- No go-live while any critical/high security test fails.

## Known blockers to close before Release 1

1. The current repository contains a sample HTML/JavaScript demo backed by browser/local demo data; it is not the production app and must not be deployed as the ERP.
2. The initial React scaffold is now under `web/`; dependency installation and a production build have not yet been run in this environment.
3. The architecture document describes an `auth-login` Edge Function and lockout-aware login flow, but no Edge Function implementation is present in this ZIP. Implement and test it, or formally replace that flow with a verified Supabase Auth rate-limit/lockout design before go-live.
4. Real Supabase migration/RLS/Storage/Auth testing is outstanding. The reported 427 SQL assertions passed only against PostgreSQL with a local Supabase shim.
5. SMTP, project URL/key, hosting and domain configuration are not present. Do not paste secrets into chat.
6. Confirm final business rules for leave cancellation, salary proration and the unresolved Loan/Savings conflict in the older progress notes. Current roadmap excludes Loan/Savings.

## Immediate next tasks

1. Create a separate Supabase development project and keep production separate.
2. Apply migrations to development and run SQL/RLS + Storage tests.
3. Install frontend dependencies and make `web/` typecheck/build cleanly.
4. Complete auth lifecycle + permission/scope loader + admin shell.
5. Build organization/RBAC screens, then HR screens.
6. Complete Release 1 acceptance matrix before production deployment.

## Current status

- Architecture choice: approved.
- Phased release strategy: approved.
- Database schema and local-shim tests: present; reported 427 assertions pass.
- React app: initial scaffold created; not yet built or connected to a Supabase project.
- Production readiness: **not approved**.
