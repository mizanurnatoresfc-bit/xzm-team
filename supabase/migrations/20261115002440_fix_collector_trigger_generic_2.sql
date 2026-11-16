-- Brought into the repository on 2026-11-17 from the live database (applied live as 20261115200709 fix_collector_trigger_generic_2).
-- The text below is exactly what ran on the live database.

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
  on conflict (session_id, user_id) do update set updated_at = now();
  return new;
end $$;
