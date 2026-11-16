-- XZM-TEAM ERP — fixes for the hisab khata, found when the live-only migrations of 15 Nov were brought into the repository.
--
-- 1. A rider line's "whose khata" (collector_user) was set inside an AFTER INSERT trigger, where changing NEW does nothing,
--    so every line a manager wrote had no collector: it did not show in that manager's own khata or its totals.
--    Now a BEFORE INSERT trigger sets it, and the lines already written get their writer as the collector.
-- 2. Writing again on one's own closed khata did not open it again (the 15 Nov rewrite dropped "closed_at = null"),
--    so an accepted khata could change and stay accepted. Writing on one's own khata opens it again, which also
--    takes the acceptance away (trigger da_collectors_unaccept). A rider sending a line to a manager does not
--    reopen that manager's khata (da_rider_submit refuses a closed khata anyway).
-- 3. Foreign keys added on 15 Nov had no index.

create or replace function private.da_set_line_collector() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.collector_user is null then new.collector_user := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists da_rider_line_collector_set on public.da_rider_lines;
create trigger da_rider_line_collector_set before insert on public.da_rider_lines
  for each row execute function private.da_set_line_collector();
revoke all on function private.da_set_line_collector() from public, anon, authenticated;

update public.da_rider_lines set collector_user = created_by where collector_user is null and created_by is not null;

create or replace function private.da_note_collector() returns trigger
language plpgsql security definer set search_path = public, private, pg_temp as $$
declare s public.da_sessions; v_user uuid; v_emp uuid; v_name text; v_code text;
begin
  v_user := coalesce((to_jsonb(new) ->> 'collector_user')::uuid, auth.uid());
  if v_user is null then return new; end if;
  if tg_table_name in ('da_rider_lines','da_cash_payments') and (to_jsonb(new) ->> 'collector_user') is null then
    new := jsonb_populate_record(new, jsonb_build_object('collector_user', v_user));
  end if;
  select * into s from public.da_sessions where id = new.session_id;
  if s.id is null then return new; end if;
  select e.id, e.full_name, e.employee_code::text into v_emp, v_name, v_code
    from public.employees e where e.profile_id = v_user and e.archived_at is null limit 1;
  if v_name is null then select nullif(p.full_name,''), null into v_name, v_code from public.profiles p where p.id = v_user; end if;
  insert into public.da_sheet_collectors (session_id, user_id, employee_id, name, code)
  values (new.session_id, v_user, v_emp, v_name, v_code)
  on conflict (session_id, user_id) do update
    set updated_at = now(),
        closed_at = case when v_user = auth.uid() then null else public.da_sheet_collectors.closed_at end;
  return new;
end $$;

create index if not exists da_rider_lines_collector_user_idx on public.da_rider_lines (collector_user);
create index if not exists da_rider_lines_accepted_by_idx on public.da_rider_lines (accepted_by);
create index if not exists da_payees_hub_idx on public.da_payees (hub_id);
create index if not exists da_cash_payments_zone_idx on public.da_cash_payments (zone_id);
create index if not exists da_cash_payments_collector_idx on public.da_cash_payments (collector_user);
create index if not exists da_cash_payments_payee_idx on public.da_cash_payments (payee_id);
create index if not exists da_reference_people_zone_idx on public.da_reference_people (zone_id);
create index if not exists da_reference_people_hub_idx on public.da_reference_people (hub_id);
create index if not exists da_reference_people_profile_idx on public.da_reference_people (profile_id);
create index if not exists da_reference_people_employee_idx on public.da_reference_people (employee_id);
create index if not exists da_expenses_reference_person_idx on public.da_expenses (reference_person_id);
create index if not exists da_expenses_approved_by_idx on public.da_expenses (approved_by);
create index if not exists da_approval_rules_zone_idx on public.da_approval_rules (zone_id);
create index if not exists da_approval_rules_hub_idx on public.da_approval_rules (hub_id);
create index if not exists da_approval_rules_user_idx on public.da_approval_rules (user_id);
create index if not exists da_approval_rules_position_idx on public.da_approval_rules (position_id);
create index if not exists da_expense_claims_to_user_idx on public.da_expense_claims (to_user);
