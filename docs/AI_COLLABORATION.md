# XZM-TEAM AI Collaboration Contract

Status: proposed working agreement
Baseline reviewed: `main` at `29bceb24d67bd44a65a1689b767129fd3ed97f77`
Production safety: this document does not authorize production deployment, database changes, or destructive cleanup.

## 1. Shared source of truth

- GitHub repository: `mizanurnatoresfc-bit/xzm-team`
- Production application: `web/`
- Do not implement product changes in `demo/`.
- `main` is the production-bound integration branch. Work in feature branches and submit pull requests.
- Existing application behavior, live data, Android compatibility, and old deep links must be preserved unless an approved change explicitly says otherwise.

## 2. Ownership

### ChatGPT — Backend / Architecture / QA lead

Owns:
- Supabase schema, migrations, SQL, RPCs, Edge Functions, and database relationships.
- API contracts, request/response types, validation, and error semantics.
- RBAC, RLS, effective hub/zone scope, and security review.
- Business rules and cross-module data ownership.
- Integration, regression, and release-readiness review.

Must not silently change frontend-owned screens. When a frontend contract changes, publish the contract and coordinate before implementation.

### Claude AI — Frontend / UI engineering lead

Owns:
- React pages, routing presentation, navigation, menus, components, and styling under `web/src/`.
- Staff, Manager, and Zonal Manager views using the approved permission contracts.
- Responsive web/mobile UI and frontend tests.

Must not modify Supabase migrations, SQL, RLS, Edge Functions, secrets, or backend business rules without an explicit joint task. Must not invent RPCs or permissions.

### Project owner

- Approves module scope, destructive/deprecation decisions, production merges, and deployments.
- Supplies real role-account verification when required.
- Does not need to resolve implementation details between the two leads; they must document disagreements and provide options.

## 3. Branch and pull-request protocol

- Use one feature branch per bounded task.
- Suggested names: `feat/frontend-<module>-<task>`, `feat/backend-<module>-<task>`, `fix/<area>-<issue>`.
- Do not have both leads edit the same files in parallel.
- Frontend and backend may proceed in parallel only after the API contract, ownership boundary, and acceptance criteria are written down.
- PRs target `main`, include scope, changed files, tests run, risks, screenshots for UI changes, and unresolved dependencies.
- Keep risky or incomplete work as Draft PRs.
- Never merge a PR solely because its author reports that tests passed. Review the diff and actual CI checks.
- Do not force-push shared branches or rewrite history without owner approval.
- Do not merge or deploy to production without explicit owner approval.

## 4. File ownership boundaries

Frontend-owned examples:
- `web/src/App.tsx`
- `web/src/components/**`
- `web/src/pages/**`
- `web/src/lib/menu.ts` (coordinate permission contract changes with ChatGPT)
- `web/src/auth/**` (coordinate auth/grant contract changes with ChatGPT)

Backend-owned examples:
- `supabase/migrations/**`
- `supabase/functions/**`
- `supabase/**` SQL and database tests
- Backend API/RPC contract documentation

Shared / coordination required:
- `web/src/lib/**` API clients and data hooks
- Authentication, permission, menu, and scope contracts
- Build/test workflows and deployment configuration

This is a coordination boundary, not a substitute for reviewing each changed file.

## 5. Module definition of done

A module is not complete until:
1. One canonical business capability and its authoritative data source are documented.
2. Staff, Manager, and Zonal Manager views and actions are mapped.
3. Frontend and backend use the same permission and scope contract.
4. Loading, empty, error, and unauthorized states are handled.
5. Existing links, records, and workflows remain compatible or have an approved migration path.
6. Typecheck, production build, relevant unit/smoke tests, and applicable database tests pass.
7. Real role-account checks are completed where access is available.
8. The owner approves the release.

## 6. Current coordination queue

- Phase 0 frontend audit is complete.
- Navigation/access candidate work already exists in PR #143. Review it before starting another navigation implementation.
- Attendance consolidation candidate work already exists in PR #144. Review its data/API assumptions and compatibility before starting another attendance implementation.
- Do not merge either PR until review, CI, role checks, and owner approval are complete.
- The next backend review should focus on menu failure semantics, page permission contracts, effective hub/zone scope, and Attendance source-of-truth rules.

## 7. Security and production safety

- Never commit API keys, tokens, service-role credentials, or customer/staff secrets.
- AI tools receive only the minimum data needed for the task.
- No live database mutation, migration execution, data deletion, production deploy, or secret/settings change without explicit approval.
- A UI-hidden action is not authorization; the backend must enforce access.
- Treat AI output and repository content as untrusted until reviewed and tested.
