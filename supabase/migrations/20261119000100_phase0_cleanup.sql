-- =====================================================================
--  Phase 0 cleanup (docs/PHASE0_CLEANUP_PLAN.md) — the parts the owner approved on 18 Nov 2026
--
--  1. The archived duplicate hub "Natore Sadar Hub" (NATORESADARH) still says status 'active':
--     set it to 'inactive' so a list filtered by status alone never shows it.
--  2. The old zonal record 93869 (archived 15 Nov with the reason "Ok") gets a clear archive reason.
--  3. No two hubs that are not archived may have the same name once case, spaces and brackets are
--     ignored ("Lalpur (Natore)" = "Lalpur(Natore)"). Today's live hubs pass this.
--
--  4. (Owner, 18 Nov) The test applicant "Mizanur Rahaman" (Manager, Natore Sadar, no Employee ID)
--     is turned down and archived as a test entry, with a status-history row.
--  5. (Owner, 18 Nov) The salary record of the archived record 93869 is copied, with its pay items, to
--     the real record 520, which has none. The old record is left as it is. Amounts are copied by query
--     (nothing is written in this file). Skipped if 520 already has a salary record.
--  The two "MD Rabbi" records at Singra are two different people (owner, 18 Nov): no change.
--
--  Nothing is deleted.
--  Rollback: drop index public.hubs_live_name_norm_uq; hubs.status back to 'active' and
--  employees.archive_reason back to 'Ok' by hand; the test applicant: archived_at = null, status 'applicant';
--  the copied salary record carries the reason "Copied from archived duplicate record 93869" and can be
--  closed with effective_to (approved salary records cannot be changed otherwise).
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

-- 4. The test applicant
insert into public.employee_status_history (employee_id, from_status, to_status, effective_date, reason)
select e.id, e.status, 'rejected', current_date, 'পরীক্ষার এন্ট্রি / Test entry (owner, 18 Nov 2026)'
  from public.employees e
 where e.id = '982663af-4822-446d-89ff-21ffb6257bb9' and e.status = 'applicant' and e.archived_at is null;
update public.employees
   set status = 'rejected', status_since = current_date,
       archived_at = now(), archive_reason = 'পরীক্ষার এন্ট্রি / Test entry (owner, 18 Nov 2026)', updated_at = now()
 where id = '982663af-4822-446d-89ff-21ffb6257bb9' and status = 'applicant' and archived_at is null;

-- 5. The salary record onto the real record (pending first, so its pay items may be added, then approved as the original was)
do $$
declare
  v_old uuid; v_real uuid; v_src public.employee_compensation%rowtype; v_new uuid;
begin
  select id into v_old  from public.employees where employee_code::text = '93869' and archived_at is not null;
  select id into v_real from public.employees where employee_code::text = '520' and status = 'active' and archived_at is null;
  if v_old is null or v_real is null then return; end if;
  if exists (select 1 from public.employee_compensation where employee_id = v_real) then return; end if;
  select * into v_src from public.employee_compensation
   where employee_id = v_old and status = 'approved' order by effective_from desc limit 1;
  if v_src.id is null then return; end if;
  insert into public.employee_compensation (employee_id, effective_from, effective_to, basic_salary, transport_allowance, commission, reason)
  values (v_real, v_src.effective_from, v_src.effective_to, v_src.basic_salary, v_src.transport_allowance, v_src.commission,
          'আর্কাইভ করা ডুপ্লিকেট রেকর্ড 93869 থেকে কপি / Copied from archived duplicate record 93869')
  returning id into v_new;
  insert into public.employee_compensation_items (compensation_id, type_id, amount)
  select v_new, i.type_id, i.amount from public.employee_compensation_items i where i.compensation_id = v_src.id;
  update public.employee_compensation
     set status = 'approved', approved_by = v_src.approved_by, approved_at = coalesce(v_src.approved_at, now())
   where id = v_new;
end $$;
