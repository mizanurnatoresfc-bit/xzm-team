-- =====================================================================
-- XZM-TEAM ERP — Migration 0020: role-based dashboard
--
-- The home page is built from "panels". Which panels a person sees comes from
-- their roles: a Super Admin decides, role by role, what that role's dashboard
-- holds (role_dashboards). A panel is still only shown if the person's
-- permissions allow its contents, and every number is read as the person
-- themselves (security invoker + RLS), so nobody sees past their own scope.
--
--   dashboard_home()            -> panels + the numbers for them, in one call
--   role_dashboard_list()       -> every role with its panels (Super Admin)
--   role_dashboard_save()       -> set one role's panels (Super Admin)
--   private.dashboard_catalogue -> the panels that exist, and what each needs
-- =====================================================================

-- ---------------------------------------------------------------------
-- The catalogue of panels
-- ---------------------------------------------------------------------
create or replace function private.dashboard_catalogue()
returns table (panel text, needs text[])
language sql immutable set search_path = '' as $$
  values
    ('my_work',        array[]::text[]),                                       -- anyone with a login
    ('hr_overview',    array['hr.employee.view']),
    ('hr_pending',     array['hr.application.view','hr.leave.approve','hr.compensation.approve','hr.document.verify']),
    ('hub_staff',      array['hr.employee.view']),
    ('ops_today',      array['ops.report.view','ops.parcel.view','ops.pickup.view','ops.delivery.view']),
    ('cash_today',     array['ops.cash.view','ops.rider_handover.approve','ops.expense.approve','ops.reconciliation.view']),
    ('accounts_today', array['da.sheet.view','da.report.view']),
    ('zonal_overview', array['zonal.dashboard.view','zonal.report.view']),
    ('quick_links',    array[]::text[])
$$;

create or replace function private.dashboard_panel_ok(p_panel text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from private.dashboard_catalogue() c where c.panel = p_panel)
$$;

-- Does the caller have at least one of the permissions a panel needs?
create or replace function private.dashboard_panel_allowed(p_panel text) returns boolean
language sql stable set search_path = '' as $$
  select case
    when coalesce(array_length((select c.needs from private.dashboard_catalogue() c where c.panel = p_panel), 1), 0) = 0
      then true
    else exists (
      select 1 from private.dashboard_catalogue() c, private.my_grants() g
       where c.panel = p_panel and (g.is_super or g.permission_code = any (c.needs)))
  end
$$;

-- ---------------------------------------------------------------------
-- What each role's dashboard holds
-- ---------------------------------------------------------------------
create table public.role_dashboards (
  role_id    uuid primary key references public.roles(id),
  panels     jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  constraint role_dashboards_panels_chk check (jsonb_typeof(panels) = 'array' and jsonb_array_length(panels) <= 20)
);

create or replace function private.role_dashboard_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p text;
begin
  for p in select jsonb_array_elements_text(new.panels) loop
    if not private.dashboard_panel_ok(p) then
      raise exception 'Unknown dashboard panel: %.', p using errcode = '22023';
    end if;
  end loop;
  if (select count(distinct x) from jsonb_array_elements_text(new.panels) x) <> jsonb_array_length(new.panels) then
    raise exception 'The same panel is listed twice.' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger role_dashboards_guard before insert or update on public.role_dashboards
  for each row execute function private.role_dashboard_guard();
create trigger role_dashboards_stamp before insert or update on public.role_dashboards
  for each row execute function private.stamp_row();
create trigger role_dashboards_audit after insert or update or delete on public.role_dashboards
  for each row execute function private.audit_row('system');

alter table public.role_dashboards enable row level security;
revoke all on public.role_dashboards from anon;
grant select, insert, update on public.role_dashboards to authenticated;

-- Everyone with a role may read the layouts (their own dashboard is built from them).
create policy role_dashboards_read on public.role_dashboards for select to authenticated
  using (exists (select 1 from private.my_grants()));
create policy role_dashboards_insert on public.role_dashboards for insert to authenticated
  with check (private.is_super_admin());
create policy role_dashboards_update on public.role_dashboards for update to authenticated
  using (private.is_super_admin()) with check (private.is_super_admin());

-- Starting layouts for the roles that ship with the system. A Super Admin can
-- change any of these, and a role with no row falls back to its permissions.
insert into public.role_dashboards (role_id, panels)
select r.id, d.panels::jsonb
from public.roles r
join (values
  ('super_admin',        '["hr_overview","hub_staff","ops_today","cash_today","accounts_today","zonal_overview","my_work","quick_links"]'),
  ('admin',              '["hr_overview","hr_pending","ops_today","accounts_today","my_work","quick_links"]'),
  ('head_office_manager','["zonal_overview","hr_overview","ops_today","cash_today","accounts_today","quick_links"]'),
  ('zonal_manager',      '["zonal_overview","hub_staff","hr_pending","ops_today","accounts_today","my_work","quick_links"]'),
  ('hr_manager',         '["hr_overview","hr_pending","hub_staff","my_work","quick_links"]'),
  ('hub_manager',        '["ops_today","cash_today","hub_staff","accounts_today","my_work","quick_links"]'),
  ('operations_manager', '["ops_today","cash_today","hub_staff","my_work","quick_links"]'),
  ('delivery_manager',   '["ops_today","cash_today","my_work","quick_links"]'),
  ('pickup_manager',     '["ops_today","my_work","quick_links"]'),
  ('accounts_manager',   '["accounts_today","cash_today","my_work","quick_links"]'),
  ('accountant',         '["accounts_today","my_work","quick_links"]'),
  ('auditor',            '["hr_overview","accounts_today","ops_today","quick_links"]'),
  ('rider',              '["my_work","quick_links"]')
) as d(code, panels) on d.code = r.code::text
on conflict (role_id) do nothing;

-- ---------------------------------------------------------------------
-- The panels this person should see
-- ---------------------------------------------------------------------
create or replace function public.dashboard_panels()
returns text[]
language plpgsql stable security invoker set search_path = '' as $$
declare v_panels text[];
begin
  -- the panels their roles ask for, in catalogue order
  select array_agg(c.panel order by c.ord) into v_panels
  from (select c.panel, row_number() over () ord from private.dashboard_catalogue() c) c
  where private.dashboard_panel_allowed(c.panel)
    and exists (
      select 1 from public.user_roles ur
      join public.role_dashboards rd on rd.role_id = ur.role_id
      where ur.user_id = auth.uid() and ur.revoked_at is null
        and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date)
        and rd.panels ? c.panel);

  -- a role with no layout of its own: fall back to whatever their permissions allow
  if coalesce(array_length(v_panels, 1), 0) = 0 then
    select array_agg(c.panel order by c.ord) into v_panels
    from (select c.panel, row_number() over () ord from private.dashboard_catalogue() c) c
    where private.dashboard_panel_allowed(c.panel);
  end if;
  return coalesce(v_panels, array['my_work','quick_links']);
end $$;

-- ---------------------------------------------------------------------
-- The dashboard itself: only the panels this person has, with their numbers.
-- security invoker — every count is read as the person, under RLS.
-- ---------------------------------------------------------------------
create or replace function public.dashboard_home()
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_panels text[] := public.dashboard_panels();
  v_me     uuid   := private.my_employee_id();
  v_today  date   := (now() at time zone private.setting_text('system.timezone'))::date;
  v_out    jsonb  := jsonb_build_object('panels', to_jsonb(v_panels), 'today', v_today);
begin
  if auth.uid() is null then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;

  v_out := v_out || jsonb_build_object('me', (
    select jsonb_build_object('employee_code', e.employee_code::text, 'name', e.full_name,
                              'hub', h.name, 'zone', z.name, 'position', p.name)
      from public.employees e
      left join public.hubs h on h.id = e.hub_id
      left join public.zones z on z.id = e.zone_id
      left join public.positions p on p.id = e.position_id
     where e.id = v_me));

  if 'my_work' = any (v_panels) then
    v_out := v_out || jsonb_build_object('my_work', jsonb_build_object(
      'tasks_open',     (select count(*) from public.tasks t
                          where t.assigned_to = auth.uid() and t.status in ('assigned','in_progress')),
      'tasks_due',      (select count(*) from public.tasks t
                          where t.assigned_to = auth.uid() and t.status in ('assigned','in_progress') and t.due_date <= v_today),
      'tasks_to_check', (select count(*) from public.tasks t
                          where t.accountable_manager_id = auth.uid() and t.status = 'submitted'),
      'leave_pending',  (select count(*) from public.leave_requests l where l.employee_id = v_me and l.status = 'pending'),
      'marked_today',   (select exists (select 1 from public.attendance_records a
                                         where a.employee_id = v_me and a.work_date = v_today))));
  end if;

  if 'hr_overview' = any (v_panels) then
    v_out := v_out || jsonb_build_object('hr_overview', (
      select jsonb_build_object(
        'total',      count(*) filter (where e.status in ('active','inactive')),
        'active',     count(*) filter (where e.status = 'active'),
        'inactive',   count(*) filter (where e.status = 'inactive'),
        'applicant',  count(*) filter (where e.status = 'applicant'),
        'joined_30d', count(*) filter (where e.joining_date >= v_today - 30 and e.status <> 'applicant'),
        'left_30d',   count(*) filter (where e.status in ('resigned','terminated') and e.status_since >= v_today - 30))
      from public.employees e where e.archived_at is null));
  end if;

  if 'hr_pending' = any (v_panels) then
    v_out := v_out || jsonb_build_object('hr_pending', jsonb_build_object(
      'applications', (select count(*) from public.employee_applications a where a.status = 'submitted'),
      'leave',        (select count(*) from public.leave_requests l where l.status = 'pending'),
      'salary',       (select count(*) from public.employee_compensation c where c.status = 'pending'),
      'documents',    (select count(*) from public.employee_documents d where d.verified_at is null and d.archived_at is null)));
  end if;

  if 'hub_staff' = any (v_panels) then
    v_out := v_out || jsonb_build_object('hub_staff', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'hub_id', s.hub_id, 'hub', s.hub_name, 'zone', s.zone_name, 'total', s.total,
               'active', s.active, 'inactive', s.inactive, 'applicant', s.applicant)
             order by s.zone_name, s.hub_name), '[]'::jsonb)
      from public.hr_hub_staff_summary() s));
  end if;

  if 'ops_today' = any (v_panels) then
    v_out := v_out || jsonb_build_object('ops_today', jsonb_build_object(
      'at_hub',            (select count(*) from public.parcels p where p.status = 'at_hub'),
      'out_for_delivery',  (select count(*) from public.parcels p where p.status = 'out_for_delivery'),
      'received_today',    (select count(*) from public.parcels p where p.received_date = v_today),
      'pickups_waiting',   (select count(*) from public.pickup_submissions s where s.status in ('submitted','verified')),
      'deliveries_waiting',(select count(*) from public.delivery_records d where d.status = 'pending'),
      'issues_open',       (select count(*) from public.parcel_issues i where i.status in ('open','assigned'))));
  end if;

  if 'cash_today' = any (v_panels) then
    v_out := v_out || jsonb_build_object('cash_today', jsonb_build_object(
      'handovers_waiting',  (select count(*) from public.cash_handovers h where h.status = 'submitted'),
      'expenses_waiting',   (select count(*) from public.operational_expenses e where e.status = 'pending'),
      'payments_waiting',   (select count(*) from public.merchant_payments m where m.status = 'pending'),
      'recons_waiting',     (select count(*) from public.cash_reconciliations r where r.status = 'submitted'),
      'collected_today',    (select coalesce(sum(d.cod_collected), 0) from public.delivery_records d
                              where d.delivery_date = v_today and d.status = 'approved')));
  end if;

  if 'accounts_today' = any (v_panels) then
    v_out := v_out || jsonb_build_object('accounts_today', (
      select jsonb_build_object(
        'open',       count(*) filter (where s.status = 'open'),
        'submitted',  count(*) filter (where s.status = 'submitted'),
        'correction', count(*) filter (where s.status = 'correction'),
        'approved',   count(*) filter (where s.status = 'approved'),
        'hubs',       count(distinct s.hub_id))
      from public.da_sessions s where s.account_date = v_today));
  end if;

  if 'zonal_overview' = any (v_panels) then
    v_out := v_out || jsonb_build_object('zonal_overview', jsonb_build_object(
      'zones',          (select count(*) from public.zones z where z.archived_at is null),
      'hubs',           (select count(*) from public.hubs h where h.archived_at is null),
      'staff',          (select count(*) from public.employees e where e.archived_at is null and e.status = 'active'),
      'tasks_open',     (select count(*) from public.tasks t where t.status in ('assigned','in_progress')),
      'tasks_overdue',  (select count(*) from public.tasks t where t.status in ('assigned','in_progress') and t.due_date < v_today),
      'claims_waiting', (select count(*) from public.travel_claims c where c.status = 'submitted'),
      'metrics_waiting',(select count(*) from public.hub_daily_metrics m where m.status = 'submitted')));
  end if;

  return v_out;
end $$;

-- ---------------------------------------------------------------------
-- Setting the layouts (Super Admin)
-- ---------------------------------------------------------------------
create or replace function public.role_dashboard_list()
returns table (role_id uuid, code text, name text, name_bn text, is_super boolean, panels jsonb, user_count integer)
language sql stable security definer set search_path = '' as $$
  select r.id, r.code::text, r.name, r.name_bn, r.is_super,
         coalesce(d.panels, '[]'::jsonb),
         (select count(*)::int from public.user_roles ur where ur.role_id = r.id and ur.revoked_at is null)
  from public.roles r
  left join public.role_dashboards d on d.role_id = r.id
  where r.archived_at is null and private.is_super_admin()
  order by r.is_super desc, r.name
$$;

create or replace function public.role_dashboard_save(p_role uuid, p_panels text[])
returns void
language plpgsql security definer set search_path = '' as $$
declare p text;
begin
  if not private.is_super_admin() then
    raise exception 'Only a Super Admin can set what a role sees on its dashboard.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.roles r where r.id = p_role and r.archived_at is null) then
    raise exception 'Role not found.' using errcode = '22023';
  end if;
  foreach p in array coalesce(p_panels, '{}') loop
    if not private.dashboard_panel_ok(p) then
      raise exception 'Unknown dashboard panel: %.', p using errcode = '22023';
    end if;
  end loop;
  insert into public.role_dashboards (role_id, panels)
  values (p_role, to_jsonb(coalesce(p_panels, '{}')))
  on conflict (role_id) do update set panels = excluded.panels;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.dashboard_home()', 'public.dashboard_panels()',
                           'public.role_dashboard_list()', 'public.role_dashboard_save(uuid, text[])']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.dashboard_catalogue(), private.dashboard_panel_ok(text),
                      private.dashboard_panel_allowed(text) from public, anon;
grant execute on function private.dashboard_catalogue(), private.dashboard_panel_ok(text),
                         private.dashboard_panel_allowed(text) to authenticated;
