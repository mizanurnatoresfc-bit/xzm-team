-- =====================================================================
--  Phase 0 cleanup (docs/PHASE0_CLEANUP_PLAN.md) — only the parts that need no owner decision
--
--  1. The archived duplicate hub "Natore Sadar Hub" (NATORESADARH) still says status 'active':
--     set it to 'inactive' so a list filtered by status alone never shows it.
--  2. The old zonal record 93869 (archived 15 Nov with the reason "Ok") gets a clear archive reason.
--  3. No two hubs that are not archived may have the same name once case, spaces and brackets are
--     ignored ("Lalpur (Natore)" = "Lalpur(Natore)"). Today's live hubs pass this.
--
--  Not here (waiting for the owner): archiving the test applicant "Mizanur Rahaman", copying the
--  salary row from 93869 to 520, and the two "MD Rabbi" records at Singra.
--
--  Nothing is deleted. Updates only touch rows that are already archived.
--  Rollback: drop index public.hubs_live_name_norm_uq; the two updated rows can be set back by hand
--  (old values: hubs.status = 'active'; employees.archive_reason = 'Ok').
-- =====================================================================

select set_config('app.change_reason', 'Phase 0 cleanup (owner plan of 18 Nov 2026)', true);

update public.hubs
   set status = 'inactive', updated_at = now()
 where code = 'NATORESADARH' and archived_at is not null and status = 'active';

update public.employees
   set archive_reason = 'ডুপ্লিকেট রেকর্ড — আসল রেকর্ড 520 / Duplicate record; the real record is 520', updated_at = now()
 where employee_code::text = '93869' and archived_at is not null and archive_reason = 'Ok';

create unique index if not exists hubs_live_name_norm_uq
  on public.hubs (lower(regexp_replace(name, '[[:space:]()]', '', 'g')))
  where archived_at is null;
