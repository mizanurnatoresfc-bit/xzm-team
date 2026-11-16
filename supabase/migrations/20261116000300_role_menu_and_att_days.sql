-- =====================================================================
--  1. Pages a role sees ("শুধু এই কয়টা পাতা")
--     role_dashboards.menu: null = every page the permissions allow; a list
--     = only these pages are in the menu and can be opened. A person with
--     several roles sees the pages of all of them; a Super Admin, or anyone
--     holding a role without a list, is not limited. This only hides pages:
--     what data a person may read or change is still decided by permissions.
--
--  2. Attendance days to compare: for each person and period, the days on
--     the online system and the days in the hub's own register, written by
--     the hub. The site's own count is shown beside them.
--
--  Additive only. Rollback: drop my_menu, role_menu_list, role_menu_save,
--  att_days_list, att_days_save and the table attendance_day_counts; the
--  column role_dashboards.menu may stay (null everywhere = no limit).
-- =====================================================================

alter table public.role_dashboards add column if not exists menu jsonb;
alter table public.role_dashboards drop constraint if exists role_dashboards_menu_chk;
alter table public.role_dashboards add constraint role_dashboards_menu_chk
  check (menu is null or (jsonb_typeof(menu) = 'array' and jsonb_array_length(menu) <= 150));

create or replace function public.my_menu() returns jsonb
language sql stable security definer set search_path = '' as $$
  with mine as (
    select r.is_super, d.menu
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id and r.archived_at is null
    left join public.role_dashboards d on d.role_id = r.id
    where ur.user_id = auth.uid() and ur.revoked_at is null
      and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date))
  select case
    when auth.uid() is null or not exists (select 1 from mine) then null
    when exists (select 1 from mine where is_super or menu is null) then null
    else (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from mine, jsonb_array_elements_text(mine.menu) x)
  end
$$;

create or replace function public.role_menu_list()
returns table (role_id uuid, code text, name text, name_bn text, is_super boolean, menu jsonb, user_count integer)
language sql stable security definer set search_path = '' as $$
  select r.id, r.code::text, r.name, r.name_bn, r.is_super, d.menu,
         (select count(*)::int from public.user_roles ur where ur.role_id = r.id and ur.revoked_at is null)
  from public.roles r
  left join public.role_dashboards d on d.role_id = r.id
  where r.archived_at is null and private.is_super_admin()
  order by r.is_super desc, r.name
$$;

-- p_menu null = no limit.
create or replace function public.role_menu_save(p_role uuid, p_menu text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare m text;
begin
  if not private.is_super_admin() then
    raise exception 'Only a Super Admin can set which pages a role sees.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.roles r where r.id = p_role and r.archived_at is null) then
    raise exception 'Role not found.' using errcode = '22023';
  end if;
  if p_menu is not null and exists (select 1 from public.roles r where r.id = p_role and r.is_super) then
    raise exception 'সুপার অ্যাডমিনের পাতা সীমিত করা যায় না।' using errcode = '22023';
  end if;
  foreach m in array coalesce(p_menu, '{}') loop
    if m !~ '^/app(/[a-z0-9?=_/-]*)?$' or length(m) > 80 then
      raise exception 'Unknown page: %.', m using errcode = '22023';
    end if;
  end loop;
  perform set_config('app.change_reason', 'রোল কোন পাতা দেখবে', true);
  insert into public.role_dashboards (role_id, menu) values (p_role, case when p_menu is null then null else to_jsonb(p_menu) end)
  on conflict (role_id) do update set menu = excluded.menu, updated_at = now(), updated_by = auth.uid();
end $$;

-- ---------------------------------------------------------------------
create table if not exists public.attendance_day_counts (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.employees(id),
  hub_id          uuid not null references public.hubs(id),
  zone_id         uuid,
  period_from     date not null,
  period_to       date not null,
  online_days     integer not null check (online_days between 0 and 31),
  register_days   integer not null check (register_days between 0 and 31),
  note            text,
  submitted_by    uuid,
  submitted_by_name text,
  submitted_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (employee_id, period_from, period_to),
  constraint att_days_period check (period_to >= period_from and period_to - period_from <= 31)
);
create index if not exists att_days_hub_idx on public.attendance_day_counts (hub_id, period_from);
alter table public.attendance_day_counts enable row level security;
revoke all on public.attendance_day_counts from anon, authenticated;
grant select on public.attendance_day_counts to authenticated;
drop policy if exists att_days_read on public.attendance_day_counts;
create policy att_days_read on public.attendance_day_counts for select to authenticated
  using (private.has_permission('hr.attendance.view', zone_id, hub_id));

-- Everyone working at the hub, with the three counts for the period.
create or replace function public.att_days_list(p_hub uuid, p_from date, p_to date)
returns table (employee_id uuid, employee_code text, full_name text, position_name text, site_days integer,
               online_days integer, register_days integer, note text, submitted_by_name text, submitted_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_permission('hr.attendance.view', private.hub_zone(p_hub), p_hub) then
    raise exception 'এই হাবের হাজিরা দেখার অনুমতি নেই।' using errcode = '42501';
  end if;
  return query
  select e.id, e.employee_code::text, e.full_name, p.name,
         (select count(*)::int from public.attendance_records a
           where a.employee_id = e.id and a.work_date between p_from and p_to and a.status in ('present', 'late', 'half_day')),
         c.online_days, c.register_days, c.note, c.submitted_by_name, c.submitted_at
  from public.employees e
  left join public.positions p on p.id = e.position_id
  left join public.attendance_day_counts c on c.employee_id = e.id and c.period_from = p_from and c.period_to = p_to
  where e.hub_id = p_hub and e.archived_at is null and e.status = 'active'
  order by p.name nulls last, e.full_name;
end $$;

-- p_rows: [{ "employee_id": "...", "online_days": 15, "register_days": 15, "note": "..." }, ...]
create or replace function public.att_days_save(p_hub uuid, p_from date, p_to date, p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_zone uuid := private.hub_zone(p_hub);
  r jsonb; v_emp uuid; v_on integer; v_reg integer; v_n integer := 0;
  v_days integer;
begin
  if not private.has_permission('hr.attendance.create', v_zone, p_hub) then
    raise exception 'এই হাবের হাজিরার হিসাব জমা দেওয়ার অনুমতি নেই।' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 31 then
    raise exception 'সময়টি ঠিক নয় — সর্বোচ্চ এক মাস।' using errcode = '22023';
  end if;
  if p_from > (now() at time zone 'Asia/Dhaka')::date then raise exception 'সামনের দিনের হিসাব দেওয়া যায় না।' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'অন্তত একজনের সংখ্যা লিখুন।' using errcode = '22023';
  end if;
  v_days := p_to - p_from + 1;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_emp := (r ->> 'employee_id')::uuid;
    v_on := (r ->> 'online_days')::integer; v_reg := (r ->> 'register_days')::integer;
    if v_on is null or v_reg is null or v_on < 0 or v_reg < 0 or v_on > v_days or v_reg > v_days then
      raise exception 'দিনের সংখ্যা ০ থেকে %-এর মধ্যে দিন।', v_days using errcode = '22023';
    end if;
    if not exists (select 1 from public.employees e where e.id = v_emp and e.hub_id = p_hub and e.archived_at is null) then
      raise exception 'একজন কর্মী এই হাবের নন।' using errcode = '22023';
    end if;
    insert into public.attendance_day_counts (employee_id, hub_id, zone_id, period_from, period_to, online_days, register_days, note, submitted_by, submitted_by_name)
    values (v_emp, p_hub, v_zone, p_from, p_to, v_on, v_reg, nullif(trim(coalesce(r ->> 'note', '')), ''), auth.uid(), private.da_my_name())
    on conflict (employee_id, period_from, period_to) do update
      set online_days = excluded.online_days, register_days = excluded.register_days, note = excluded.note,
          submitted_by = excluded.submitted_by, submitted_by_name = excluded.submitted_by_name, submitted_at = now(), updated_at = now();
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke all on function public.my_menu(), public.role_menu_list(), public.role_menu_save(uuid, text[]),
  public.att_days_list(uuid, date, date), public.att_days_save(uuid, date, date, jsonb) from public, anon;
grant execute on function public.my_menu(), public.role_menu_list(), public.role_menu_save(uuid, text[]),
  public.att_days_list(uuid, date, date), public.att_days_save(uuid, date, date, jsonb) to authenticated;
