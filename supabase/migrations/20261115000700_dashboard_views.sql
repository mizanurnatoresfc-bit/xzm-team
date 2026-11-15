-- =====================================================================
--  Dashboard views: "আমি" (self) | "হাব" (hub) | "জোন" (zone)
--  * New panels: my_day, my_requests, hub_today, approvals, network.
--  * role_dashboards.default_view: which view a role opens on.
--  * dashboard_default_view(): the caller's default (zone > hub > self).
--  * role_dashboard_set_view(): Super Admin sets a role's default view.
-- =====================================================================

create or replace function private.dashboard_catalogue()
returns table (panel text, needs text[])
language sql immutable set search_path = '' as $$
  values
    ('my_work',        array[]::text[]),
    ('hr_overview',    array['hr.employee.view']),
    ('hr_pending',     array['hr.application.view','hr.leave.approve','hr.compensation.approve','hr.document.verify']),
    ('hub_staff',      array['hr.employee.view']),
    ('ops_today',      array['ops.report.view','ops.parcel.view','ops.pickup.view','ops.delivery.view']),
    ('cash_today',     array['ops.cash.view','ops.rider_handover.approve','ops.expense.approve','ops.reconciliation.view']),
    ('accounts_today', array['da.sheet.view','da.report.view']),
    ('zonal_overview', array['zonal.dashboard.view','zonal.report.view']),
    ('quick_links',    array[]::text[]),
    ('my_day',         array[]::text[]),
    ('my_requests',    array[]::text[]),
    ('hub_today',      array['hr.attendance.view','hr.employee.view','da.sheet.view','ops.pickup.view']),
    ('approvals',      array['hr.application.approve','hr.leave.approve','da.sheet.approve','hr.request.approve']),
    ('network',        array['org.hub.view'])
$$;

alter table public.role_dashboards add column if not exists default_view text
  check (default_view is null or default_view in ('self','hub','zone'));

-- New panels on the starting layouts (kept under the 20-panel limit, no duplicates).
update public.role_dashboards rd set panels = (
  select coalesce(jsonb_agg(p order by ord), '[]'::jsonb) from (select p, ord from (
    select p, min(ord) ord from (
      select x p, o ord from jsonb_array_elements_text(rd.panels) with ordinality t(x, o)
      union all
      select x, 100 + o from unnest(
        case r.code::text
          when 'super_admin'        then array['network','approvals','hub_today','my_requests','my_day']
          when 'admin'              then array['network','approvals','hub_today','my_requests','my_day']
          when 'head_office_manager' then array['network','approvals','my_requests','my_day']
          when 'zonal_manager'      then array['network','approvals','hub_today','my_requests','my_day']
          when 'hr_manager'         then array['approvals','my_requests','my_day']
          when 'hub_manager'        then array['hub_today','approvals','my_requests','my_day']
          when 'operations_manager' then array['hub_today','approvals','my_requests','my_day']
          when 'accounts_manager'   then array['hub_today','approvals','my_requests','my_day']
          else array['my_day','my_requests']
        end) with ordinality u(x, o)
    ) a group by p
  ) b order by ord limit 20) c)
from public.roles r where r.id = rd.role_id;

update public.role_dashboards rd set default_view = case r.code::text
    when 'super_admin' then 'zone' when 'admin' then 'zone' when 'head_office_manager' then 'zone'
    when 'zonal_manager' then 'zone' when 'hr_manager' then 'zone' when 'auditor' then 'zone'
    when 'hub_manager' then 'hub' when 'operations_manager' then 'hub' when 'delivery_manager' then 'hub'
    when 'pickup_manager' then 'hub' when 'accounts_manager' then 'hub' when 'accountant' then 'hub' when 'manager_hisab' then 'hub'
    else 'self' end
from public.roles r where r.id = rd.role_id and rd.default_view is null;

-- Roles with no layout yet get one row so a default view can be set for them.
insert into public.role_dashboards (role_id, panels, default_view)
select r.id, '["my_day","my_requests","my_work","quick_links"]'::jsonb, 'self'
from public.roles r where not exists (select 1 from public.role_dashboards x where x.role_id = r.id)
on conflict (role_id) do nothing;

create or replace function public.dashboard_default_view()
returns text
language sql stable security definer set search_path = '' as $$
  select rd.default_view
  from public.user_roles ur join public.role_dashboards rd on rd.role_id = ur.role_id
  where ur.user_id = auth.uid() and ur.revoked_at is null
    and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date)
    and rd.default_view is not null
  order by case rd.default_view when 'zone' then 1 when 'hub' then 2 else 3 end
  limit 1
$$;

create or replace function public.role_dashboard_set_view(p_role uuid, p_view text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_super_admin() then
    raise exception 'Only a Super Admin can change role dashboards.' using errcode = '42501';
  end if;
  if p_view is not null and p_view not in ('self','hub','zone') then raise exception 'Unknown view' using errcode = '22023'; end if;
  insert into public.role_dashboards (role_id, panels, default_view) values (p_role, '[]'::jsonb, p_view)
  on conflict (role_id) do update set default_view = excluded.default_view;
end $$;

revoke all on function public.dashboard_default_view() from public, anon;
revoke all on function public.role_dashboard_set_view(uuid, text) from public, anon;
grant execute on function public.dashboard_default_view() to authenticated;
grant execute on function public.role_dashboard_set_view(uuid, text) to authenticated;
