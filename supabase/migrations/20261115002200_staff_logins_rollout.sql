-- =====================================================================
--  Launch: a login for every staff member, roles by post, step-by-step roll-out
--
--  1. Role "staff" (সাধারণ স্টাফ): own work only — for loaders, drivers, helpers, guards.
--  2. positions.default_role_id: the role a post gets when its login is made
--     (the Super Admin can change it on the "logins for all staff" screen).
--  3. my_mobile_set(): a person records their own mobile number; from then on
--     the number also works as their login (login_resolve already reads it).
--  4. rollout_progress() / rollout_people(): per hub, who has a login, who has
--     signed in, who has set their own password, who has given a mobile number.
--
--  Sign-in by Employee ID or mobile already exists (auth-login + login_resolve).
--  Additive only. Rollback: drop the three functions, the column and its index;
--  the role can stay (it grants nothing beyond two read permissions).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Plain staff role: the pages that need no permission (my profile, my
--    accounts, my vehicle, issues and orders given to me, HR requests), plus
--    the names of hubs. Dashboard: the same "my own day" panels as a rider.
-- ---------------------------------------------------------------------
insert into public.roles (code, name, name_bn, description, is_system, is_super) values
  ('staff', 'Staff', 'সাধারণ স্টাফ', 'Own work only: own profile, own accounts, own vehicle, issues and orders given to them', true, false)
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code in ('org.hub.view', 'org.organization.view')
where r.code = 'staff'
on conflict do nothing;

insert into public.role_dashboards (role_id, panels, default_view)
select s.id, d.panels, d.default_view
from public.roles s
join public.roles r on r.code = 'rider'
join public.role_dashboards d on d.role_id = r.id
where s.code = 'staff'
on conflict (role_id) do nothing;

-- ---------------------------------------------------------------------
-- 2. The role of a post
-- ---------------------------------------------------------------------
alter table public.positions add column if not exists default_role_id uuid references public.roles(id);
create index if not exists positions_default_role_id_fk_idx on public.positions (default_role_id);

-- Starting choices (the owner's): managers and assistants run their hub; data entry and
-- hub CC keep the daily accounts; riders are riders; everyone else is plain staff.
update public.positions p set default_role_id = r.id
from public.roles r
where p.default_role_id is null and r.archived_at is null
  and r.code = case
        when p.name ~* 'zonal' then 'zonal_manager'
        when p.name ~* '^(assistant|asst\.?)?\s*manager$' then 'hub_manager'
        when p.name ~* 'data entry|hub cc' then 'manager_hisab'
        when p.name ~* 'rider' then 'rider'
        else 'staff' end;

-- ---------------------------------------------------------------------
-- 3. My own mobile number
-- ---------------------------------------------------------------------
create or replace function public.my_mobile_set(p_mobile text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_id();
  v text := regexp_replace(translate(coalesce(p_mobile, ''), '০১২৩৪৫৬৭৮৯', '0123456789'), '[^0-9]', '', 'g');
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  if v like '88%' and length(v) = 13 then v := substr(v, 3); end if;
  if v !~ '^01[3-9][0-9]{8}$' then
    raise exception 'সঠিক মোবাইল নম্বর দিন — ১১ সংখ্যা, যেমন 01711000000' using errcode = '22023'; end if;
  -- One number, one person: otherwise nobody could sign in with it.
  if exists (select 1 from public.employees e where e.mobile = v and e.archived_at is null and e.status <> 'rejected' and e.id is distinct from v_emp)
     or exists (select 1 from public.profiles p where p.id <> auth.uid() and p.archived_at is null
                and regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g') in (v, '88' || v)) then
    raise exception 'এই নম্বরটি অন্য একজনের নামে আছে' using errcode = '23505'; end if;
  perform set_config('app.change_reason', 'নিজের মোবাইল নম্বর', true);
  if v_emp is not null then update public.employees set mobile = v where id = v_emp; end if;
  update public.profiles set phone = v where id = auth.uid();
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 4. Roll-out progress, hub by hub (only hubs whose staff the caller may see)
-- ---------------------------------------------------------------------
create or replace function public.rollout_progress(p_zone uuid default null)
returns table (hub_id uuid, hub_name text, zone_id uuid, staff integer, with_login integer, signed_in integer, password_set integer, with_mobile integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  return query
  select h.id, h.name, h.zone_id,
         count(e.id)::integer,
         (count(e.id) filter (where p.id is not null))::integer,
         (count(e.id) filter (where p.last_login_at is not null))::integer,
         (count(e.id) filter (where p.last_login_at is not null and not p.must_change_password))::integer,
         (count(e.id) filter (where e.mobile is not null))::integer
  from public.hubs h
  left join public.employees e on e.hub_id = h.id and e.status = 'active' and e.archived_at is null
  left join public.profiles p on p.id = e.profile_id and p.archived_at is null
  where h.archived_at is null and (p_zone is null or h.zone_id = p_zone)
    and private.has_permission('hr.employee.view', h.zone_id, h.id)
  group by h.id, h.name, h.zone_id
  order by h.name;
end $$;

create or replace function public.rollout_people(p_hub uuid)
returns table (employee_id uuid, employee_code text, full_name text, position_name text, role_name text,
               has_login boolean, signed_in_at timestamptz, password_set boolean, mobile text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.has_permission('hr.employee.view', private.hub_zone(p_hub), p_hub) then
    raise exception 'এই হাবের কর্মী দেখার অনুমতি নেই' using errcode = '42501'; end if;
  return query
  select e.id, e.employee_code::text, e.full_name, po.name,
         (select string_agg(coalesce(r.name_bn, r.name), ', ' order by r.name)
          from public.user_roles ur join public.roles r on r.id = ur.role_id
          where ur.user_id = e.profile_id and ur.revoked_at is null),
         p.id is not null, p.last_login_at,
         (p.last_login_at is not null and not p.must_change_password), e.mobile
  from public.employees e
  left join public.positions po on po.id = e.position_id
  left join public.profiles p on p.id = e.profile_id and p.archived_at is null
  where e.hub_id = p_hub and e.status = 'active' and e.archived_at is null
  order by e.full_name;
end $$;

revoke all on function public.my_mobile_set(text), public.rollout_progress(uuid), public.rollout_people(uuid) from public, anon;
grant execute on function public.my_mobile_set(text), public.rollout_progress(uuid), public.rollout_people(uuid) to authenticated;
