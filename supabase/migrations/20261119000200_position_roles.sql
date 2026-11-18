-- =====================================================================
--  Phase 1 — পদবি অনুযায়ী রোল / A role for every post, kept in step by itself
--
--  1. Five new "own work" roles: sorting_loader, data_entry, hub_cc, fleet, guard.
--     Each has a home dashboard and page list copied from "staff" (the owner's own choice
--     of what staff see), plus the pages of its own work.
--  2. positions.default_role_id is pointed at them (only where the post still has the
--     role the 15 Nov launch gave it, so a role the owner chose by hand is kept).
--     A post with no role gets "staff". A new post starts with "staff".
--  3. A hub may now make logins with any of these own-work roles (before: rider / staff only).
--  4. user_roles.granted_via: 'position' = this role came from the person's post;
--     'manual' = given by hand (every row before this file). Only 'position' rows are ever
--     changed automatically; a role given by hand is never touched.
--  5. When a person with a login changes post, hub or zone, is linked to a login, leaves,
--     or their post's role is changed, the role of their post follows by itself:
--       * the old post role is ended (revoked with a reason, never deleted);
--       * the new one is given, if it is an own-work role, or if the person making the
--         change may hand out that role. Otherwise (for example a hub manager role given
--         by someone without that right) it waits in position_role_gaps() for an admin.
--     Super Admin accounts and one's own account are never changed this way.
--  6. position_role_gaps() / position_role_apply(): the admin's list of people whose
--     post role is missing, and the button that gives it.
--
--  Rollback: drop the triggers employees_position_role, positions_role_changed, positions_default_role
--  and the functions position_role_*, is_super_user, position_default_role, positions_role_changed, employees_position_role; set
--  private.hub_login_role and private.guard_user_role back to the versions in
--  20261116000400_hub_logins_and_profile.sql; the new roles, the granted_via column and the
--  positions' role choices may stay (they grant nothing on their own). Roles given by this
--  file are revoked with: update user_roles set revoked_at = now(), revoke_reason = '…'
--  where granted_via = 'position' and created_at >= '<apply time>'.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Where a role came from
-- ---------------------------------------------------------------------
alter table public.user_roles add column if not exists granted_via text not null default 'manual';
alter table public.user_roles drop constraint if exists user_roles_granted_via_chk;
alter table public.user_roles add constraint user_roles_granted_via_chk check (granted_via in ('manual', 'position'));
comment on column public.user_roles.granted_via is
  'manual = given by hand; position = the role of the person''s post, changed automatically when the post changes';

-- Roles that already are exactly the role of the holder's post came from the post
-- (the hub login screens give a login the role of its post). Done before the posts are re-pointed below.
select set_config('app.change_reason', 'পদবি অনুযায়ী রোল চিহ্নিত / Marked as the role of the post', true);
update public.user_roles ur set granted_via = 'position'
  from public.employees e
  join public.positions p on p.id = e.position_id
 where e.profile_id = ur.user_id and ur.revoked_at is null and ur.granted_via = 'manual'
   and ur.role_id = p.default_role_id
   and ((ur.scope_type = 'hub' and ur.hub_id = e.hub_id) or (ur.scope_type = 'zone' and ur.zone_id = e.zone_id));

-- ---------------------------------------------------------------------
-- 2. The own-work roles
-- ---------------------------------------------------------------------
insert into public.roles (code, name, name_bn, description, is_system, is_super) values
  ('sorting_loader', 'Sorting & Loader', 'সর্টিং ও লোডার',
   'Own work: loading list, scan to sort or load, hub-to-sorting transfer, wrong and damaged reports, own attendance', true, false),
  ('data_entry', 'Data Entry', 'ডাটা এন্ট্রি',
   'Own work: parcel entry, bulk upload, today''s count, duplicate warning, own attendance', true, false),
  ('hub_cc', 'Hub CC', 'হাব সিসি (কল সেন্টার)',
   'Own work: call queue, failed delivery follow-up, reschedule, complaints, own attendance', true, false),
  ('fleet', 'Fleet (driver, auto driver, helper)', 'গাড়ি (ড্রাইভার, অটো ড্রাইভার, হেল্পার)',
   'Own work: my vehicle, duties, fuel slip, driver report, auto module, own attendance', true, false),
  ('guard', 'Security Guard', 'সিকিউরিটি গার্ড',
   'Own work: own attendance, vehicle entry and exit log', true, false)
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from (values
  ('sorting_loader', 'org.hub.view'), ('sorting_loader', 'org.organization.view'),
  ('sorting_loader', 'sorting.center.view'), ('sorting_loader', 'sorting.parcel.view'), ('sorting_loader', 'sorting.parcel.create'),
  ('sorting_loader', 'issue.issue.create'),
  ('data_entry', 'org.hub.view'), ('data_entry', 'org.organization.view'),
  ('data_entry', 'ops.parcel.view'), ('data_entry', 'ops.parcel.create'), ('data_entry', 'ops.merchant.view'),
  ('data_entry', 'da.sheet.view'), ('data_entry', 'da.sheet.create'),
  ('data_entry', 'issue.issue.create'),
  ('hub_cc', 'org.hub.view'), ('hub_cc', 'org.organization.view'),
  ('hub_cc', 'ops.parcel.view'), ('hub_cc', 'ops.delivery.view'), ('hub_cc', 'ops.merchant.view'),
  ('hub_cc', 'ops.issue.view'), ('hub_cc', 'ops.issue.create'), ('hub_cc', 'ops.issue.edit'),
  ('hub_cc', 'issue.issue.view'), ('hub_cc', 'issue.issue.create'),
  ('hub_cc', 'da.sheet.view'), ('hub_cc', 'da.sheet.create'),
  ('fleet', 'org.hub.view'), ('fleet', 'org.organization.view'),
  ('fleet', 'vehicle.vehicle.view'), ('fleet', 'vehicle.log.view'), ('fleet', 'vehicle.log.create'),
  ('fleet', 'vehicle.requisition.view'), ('fleet', 'vehicle.requisition.create'), ('fleet', 'sorting.fuel.create'),
  ('fleet', 'issue.issue.create'),
  ('guard', 'org.hub.view'), ('guard', 'org.organization.view'),
  ('guard', 'vehicle.vehicle.view'), ('guard', 'vehicle.log.view'), ('guard', 'vehicle.log.create')
) v(role_code, perm_code)
join public.roles r on r.code = v.role_code
join public.permissions p on p.code = v.perm_code
on conflict do nothing;

-- Home page and page list: the same as "staff", plus each role's own pages.
insert into public.role_dashboards (role_id, panels, default_view, menu)
select r.id, coalesce(d.panels, '["my_day", "my_requests", "my_work", "quick_links"]'::jsonb), coalesce(d.default_view, 'self'),
       case when d.menu is null then null
            else (select coalesce(jsonb_agg(distinct x), '[]'::jsonb)
                  from (select jsonb_array_elements_text(d.menu) x
                        union select jsonb_array_elements_text(e.extra)) m) end
from public.roles r
join (values
  ('sorting_loader', '["/app/sorting", "/app/issues"]'::jsonb),
  ('data_entry',     '["/app/accounts/daily", "/app/issues"]'::jsonb),
  ('hub_cc',         '["/app/accounts/daily", "/app/issues"]'::jsonb),
  ('fleet',          '["/app/issues"]'::jsonb),
  ('guard',          '[]'::jsonb)
) e(code, extra) on e.code = r.code
left join public.roles s on s.code = 'staff'
left join public.role_dashboards d on d.role_id = s.id
on conflict (role_id) do nothing;

-- ---------------------------------------------------------------------
-- 3. The role of each post
-- ---------------------------------------------------------------------
select set_config('app.change_reason', 'পদবি অনুযায়ী রোল / Role of the post', true);
with m(pat, old_codes, new_code) as (values
  ('sort|loader',          array['staff'],                  'sorting_loader'),
  ('data[[:space:]]*entry', array['staff', 'manager_hisab'], 'data_entry'),
  ('hub[[:space:]]*cc',     array['staff', 'manager_hisab'], 'hub_cc'),
  ('driver|helper',         array['staff'],                  'fleet'),
  ('guard|security',        array['staff'],                  'guard'))
update public.positions p set default_role_id = nr.id, updated_at = now()
  from m join public.roles nr on nr.code = m.new_code
 where p.archived_at is null and p.name ~* m.pat
   and (p.default_role_id is null
        or p.default_role_id in (select r.id from public.roles r where r.code::text = any (m.old_codes)));

-- Anyone without a mapped post role gets the standard staff profile.
update public.positions set default_role_id = (select id from public.roles where code = 'staff'), updated_at = now()
 where default_role_id is null;

create or replace function private.position_default_role() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.default_role_id is null then
    new.default_role_id := (select r.id from public.roles r where r.code = 'staff' and r.archived_at is null);
  end if;
  return new;
end $$;
drop trigger if exists positions_default_role on public.positions;
create trigger positions_default_role before insert on public.positions
  for each row execute function private.position_default_role();

-- ---------------------------------------------------------------------
-- 4. The roles a hub may give with a login: own work only
-- ---------------------------------------------------------------------
create or replace function private.hub_login_role(p_role uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.roles r where r.id = p_role
                   and r.code::text in ('rider', 'staff', 'sorting_loader', 'data_entry', 'hub_cc', 'fleet', 'guard')
                   and r.status = 'active' and r.archived_at is null and not r.is_super)
$$;

-- ---------------------------------------------------------------------
-- 5. The role a person's post gives, and where
-- ---------------------------------------------------------------------
-- One row for a linked, active, not archived person: the post's role (staff when the post has none),
-- at the person's hub, or at their zone for a zone-level post.
create or replace function private.position_role_of(p_user uuid)
returns table (employee_id uuid, role_id uuid, scope_type text, zone_id uuid, hub_id uuid)
language sql stable security definer set search_path = '' as $$
  select e.id,
         coalesce(p.default_role_id, (select r.id from public.roles r where r.code = 'staff')),
         case when p.level = 'zone' then 'zone' else 'hub' end,
         case when p.level = 'zone' then e.zone_id end,
         case when p.level = 'zone' then null else e.hub_id end
  from public.employees e
  left join public.positions p on p.id = e.position_id
  where e.profile_id = p_user and e.status = 'active' and e.archived_at is null
  limit 1
$$;

create or replace function private.is_super_user(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                 where ur.user_id = p_user and r.is_super and ur.revoked_at is null)
$$;

-- Ends the post roles of a login that no longer fit, and gives the one that does.
-- Returns: ok (already right) | granted | ended | needs_admin | no_place | skipped
create or replace function private.position_role_sync_do(p_user uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  t record;
  v_existing uuid;
begin
  if p_user is null then return 'skipped'; end if;
  -- the owner's own Super Admin account, and the caller's own account, are left to a person
  if private.is_super_user(p_user) or p_user = auth.uid() then return 'skipped'; end if;

  select * into t from private.position_role_of(p_user);
  perform set_config('app.change_reason', 'পদবি অনুযায়ী রোল / Role of the post', true);

  update public.user_roles ur
     set revoked_at = now(), revoked_by = auth.uid(),
         revoke_reason = case when t.employee_id is null then 'কর্মী আর সক্রিয় নন / No longer an active employee'
                              else 'পদবি বা হাব বদলেছে / Post or hub changed' end
   where ur.user_id = p_user and ur.granted_via = 'position' and ur.revoked_at is null
     and (t.employee_id is null or t.role_id is null
          or not (ur.role_id = t.role_id and ur.scope_type = t.scope_type
                  and ur.zone_id is not distinct from t.zone_id and ur.hub_id is not distinct from t.hub_id));

  if t.employee_id is null then return 'ended'; end if;
  if t.role_id is null or (t.scope_type = 'hub' and t.hub_id is null) or (t.scope_type = 'zone' and t.zone_id is null) then
    return 'no_place';
  end if;

  select ur.id into v_existing from public.user_roles ur
   where ur.user_id = p_user and ur.role_id = t.role_id and ur.scope_type = t.scope_type
     and ur.zone_id is not distinct from t.zone_id and ur.hub_id is not distinct from t.hub_id
     and ur.revoked_at is null and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date)
   limit 1;
  if v_existing is not null then
    update public.user_roles set granted_via = 'position' where id = v_existing and granted_via <> 'position';
    return 'ok';
  end if;

  -- own-work roles follow the post by themselves; any other role only when the person making the change may give it
  if not (auth.uid() is null or private.hub_login_role(t.role_id)
          or private.can_assign_role(t.role_id, t.scope_type, t.zone_id, t.hub_id)) then
    return 'needs_admin';
  end if;

  insert into public.user_roles (user_id, role_id, scope_type, zone_id, hub_id, granted_via)
  values (p_user, t.role_id, t.scope_type, t.zone_id, t.hub_id, 'position');
  return 'granted';
end $$;

-- The same, keeping the caller's reason for their own change (the HR transfer reason) for the rows written after it.
create or replace function private.position_role_sync_user(p_user uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := current_setting('app.change_reason', true);
  v text;
begin
  v := private.position_role_sync_do(p_user);
  perform set_config('app.change_reason', coalesce(v_reason, ''), true);
  return v;
end $$;

-- The guard on role assignments also lets through the role of a person's own post, exactly as their post gives it
-- (only reached from the functions above: a direct API insert is still stopped by the row policy).
create or replace function private.guard_user_role() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    -- Only revocation / end-dating is allowed after creation (keeps history honest).
    if (new.user_id, new.role_id, new.scope_type, new.zone_id, new.hub_id, new.valid_from)
       is distinct from
       (old.user_id, old.role_id, old.scope_type, old.zone_id, old.hub_id, old.valid_from) then
      raise exception 'Role assignments cannot be re-pointed; revoke and create a new one.'
        using errcode = 'P0001';
    end if;
    if old.revoked_at is not null then
      raise exception 'A revoked assignment cannot be changed.' using errcode = 'P0001';
    end if;
    if auth.uid() is not null and new.revoked_at is not null and new.user_id = auth.uid()
       and not private.is_super_admin() then
      raise exception 'You cannot revoke your own role assignments.' using errcode = '42501';
    end if;
    if new.revoked_at is not null then
      new.revoked_by := coalesce(new.revoked_by, auth.uid());
    end if;
    return new;
  end if;

  if auth.uid() is not null and not private.can_assign_role(new.role_id, new.scope_type, new.zone_id, new.hub_id)
     and not (new.scope_type = 'hub' and new.valid_to is null and private.hub_login_role(new.role_id)
              and private.hub_login_fresh(new.user_id, new.hub_id)
              and not exists (select 1 from public.user_roles ur where ur.user_id = new.user_id and ur.revoked_at is null))
     and not (new.granted_via = 'position' and new.valid_to is null and private.hub_login_role(new.role_id)
              and new.user_id <> auth.uid()
              and exists (select 1 from private.position_role_of(new.user_id) t
                          where t.role_id = new.role_id and t.scope_type = new.scope_type
                            and t.zone_id is not distinct from new.zone_id and t.hub_id is not distinct from new.hub_id)) then
    raise exception 'Not authorised to assign this role at this scope.' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 6. Keeping it in step
-- ---------------------------------------------------------------------
create or replace function private.employees_position_role() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.profile_id is not null and old.profile_id is distinct from new.profile_id then
    perform private.position_role_sync_user(old.profile_id);
  end if;
  if new.profile_id is not null then
    perform private.position_role_sync_user(new.profile_id);
  end if;
  return null;
end $$;
drop trigger if exists employees_position_role on public.employees;
create trigger employees_position_role
  after insert or update of position_id, hub_id, zone_id, profile_id, status, archived_at on public.employees
  for each row execute function private.employees_position_role();

create or replace function private.positions_role_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.position_role_sync_user(e.profile_id)
     from public.employees e
    where e.position_id = new.id and e.profile_id is not null and e.status = 'active' and e.archived_at is null;
  return null;
end $$;
drop trigger if exists positions_role_changed on public.positions;
create trigger positions_role_changed after update of default_role_id, level on public.positions
  for each row when (old.default_role_id is distinct from new.default_role_id or old.level is distinct from new.level)
  execute function private.positions_role_changed();

-- ---------------------------------------------------------------------
-- 7. The admin's list and button
-- ---------------------------------------------------------------------
-- People with a login whose post's role is not held (in the caller's scope).
create or replace function public.position_role_gaps()
returns table (employee_id uuid, employee_code text, full_name text, hub_id uuid, hub_name text,
               position_name text, position_name_bn text, role_id uuid, role_code text, role_name_bn text, scope_type text)
language sql stable security definer set search_path = '' as $$
  select e.id, e.employee_code::text, e.full_name, e.hub_id, h.name, p.name, p.name_bn,
         t.role_id, r.code::text, r.name_bn, t.scope_type
  from public.employees e
  cross join lateral private.position_role_of(e.profile_id) t
  join public.roles r on r.id = t.role_id
  left join public.positions p on p.id = e.position_id
  left join public.hubs h on h.id = e.hub_id
  where e.profile_id is not null and e.status = 'active' and e.archived_at is null
    and not private.is_super_user(e.profile_id)
    and private.has_permission('system.user_role.view', e.zone_id, e.hub_id)
    and not exists (select 1 from public.user_roles ur
                    where ur.user_id = e.profile_id and ur.role_id = t.role_id and ur.scope_type = t.scope_type
                      and ur.zone_id is not distinct from t.zone_id and ur.hub_id is not distinct from t.hub_id
                      and ur.revoked_at is null and (ur.valid_to is null or ur.valid_to >= current_date))
  order by h.name nulls last, e.full_name
$$;

-- Gives one person the role of their post (the caller must be allowed to give that role there).
create or replace function public.position_role_apply(p_employee uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  t record;
  v text;
begin
  select e.profile_id into v_user from public.employees e
   where e.id = p_employee and e.status = 'active' and e.archived_at is null;
  if v_user is null then raise exception 'এই কর্মীর সক্রিয় লগইন নেই। / This employee has no active login.' using errcode = 'P0001'; end if;
  select * into t from private.position_role_of(v_user);
  if t.role_id is null or not private.can_assign_role(t.role_id, t.scope_type, t.zone_id, t.hub_id) then
    raise exception 'এই রোল দেওয়ার অনুমতি আপনার নেই। / Not authorised to give this role.' using errcode = '42501';
  end if;
  v := private.position_role_sync_user(v_user);
  if v = 'skipped' then
    raise exception 'নিজের বা সুপার অ্যাডমিনের রোল এভাবে বদলানো যায় না। / Own and Super Admin accounts are changed by hand.' using errcode = '42501';
  end if;
  return v;
end $$;

revoke execute on function public.position_role_gaps() from public, anon;
revoke execute on function public.position_role_apply(uuid) from public, anon;
grant execute on function public.position_role_gaps() to authenticated;
grant execute on function public.position_role_apply(uuid) to authenticated;
revoke execute on function private.position_role_of(uuid) from public, anon, authenticated;
revoke execute on function private.position_role_sync_user(uuid) from public, anon, authenticated;
revoke execute on function private.position_role_sync_do(uuid) from public, anon, authenticated;
revoke execute on function private.is_super_user(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Bring the logins of today in step (Super Admin accounts are skipped)
-- ---------------------------------------------------------------------
select private.position_role_sync_user(e.profile_id)
  from public.employees e
 where e.profile_id is not null and e.status = 'active' and e.archived_at is null;
