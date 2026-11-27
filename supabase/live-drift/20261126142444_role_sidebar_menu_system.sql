-- RECORDED FROM LIVE (drift sync, System Control Center Phase 0).
-- This migration was applied to the live Supabase project as version 20261126142444 (role_sidebar_menu_system) but its source was never committed.
-- The statements below are copied unchanged from supabase_migrations.schema_migrations on live; nothing is applied to live by adding this file.


-- Role/designation-based sidebar menu configuration for XZM TEAM
-- Keyed by positions (designation / পদবি) to match staff dashboard model

-- 1. menu catalog
create table if not exists public.menu_items (
  id            uuid primary key default gen_random_uuid(),
  key           text unique not null,
  label_bn      text not null,
  label_en      text,
  icon          text,
  route         text,
  parent_key    text references public.menu_items(key) on delete cascade,
  section       text,
  sort_order    int  not null default 100,
  is_active     bool not null default true,
  requires_permission text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_menu_items_parent  on public.menu_items(parent_key);
create index if not exists idx_menu_items_section on public.menu_items(section);

-- 2. position (designation) -> menu access mapping
create table if not exists public.position_menu_access (
  id                uuid primary key default gen_random_uuid(),
  position_id       uuid not null references public.positions(id) on delete cascade,
  menu_key          text not null references public.menu_items(key) on delete cascade,
  is_visible        bool not null default true,
  sort_order        int,
  default_expanded  bool not null default false,
  badge_source      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique(position_id, menu_key)
);
create index if not exists idx_pma_position on public.position_menu_access(position_id);

-- 3. append-only audit history
create table if not exists public.menu_access_history (
  id            bigserial primary key,
  changed_at    timestamptz not null default now(),
  changed_by    uuid,
  action        text not null,
  position_id   uuid not null,
  menu_key      text not null,
  old_value     jsonb,
  new_value     jsonb,
  reason        text
);
create index if not exists idx_mah_pos_menu on public.menu_access_history(position_id, menu_key);

alter table public.menu_access_history enable row level security;

drop trigger if exists trg_mah_prevent_delete on public.menu_access_history;
create trigger trg_mah_prevent_delete
  before delete or update on public.menu_access_history
  for each row execute function private.prevent_delete();

-- auto-log any change to position_menu_access
create or replace function public.log_position_menu_change()
returns trigger
language plpgsql
security definer
as $fn$
begin
  if tg_op = 'INSERT' then
    insert into public.menu_access_history(changed_by, action, position_id, menu_key, new_value)
    values (auth.uid(), 'insert', new.position_id, new.menu_key, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.menu_access_history(changed_by, action, position_id, menu_key, old_value, new_value)
    values (auth.uid(), 'update', new.position_id, new.menu_key, to_jsonb(old), to_jsonb(new));
    new.updated_at := now();
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.menu_access_history(changed_by, action, position_id, menu_key, old_value)
    values (auth.uid(), 'delete', old.position_id, old.menu_key, to_jsonb(old));
    return old;
  end if;
  return null;
end;
$fn$;

drop trigger if exists trg_pma_log on public.position_menu_access;
create trigger trg_pma_log
  after insert or update or delete on public.position_menu_access
  for each row execute function public.log_position_menu_change();

-- RLS
alter table public.menu_items          enable row level security;
alter table public.position_menu_access enable row level security;

drop policy if exists "menu_items_read_all" on public.menu_items;
create policy "menu_items_read_all" on public.menu_items
  for select to authenticated using (true);

drop policy if exists "pma_read_all" on public.position_menu_access;
create policy "pma_read_all" on public.position_menu_access
  for select to authenticated using (true);

-- Writes: Zonal Manager position OR super_admin role
create or replace function public.is_menu_admin()
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1
    from public.employees e
    join public.positions p on p.id = e.position_id
    where e.profile_id = auth.uid()
      and e.status = 'Active'
      and p.name = 'Zonal Manager'
  ) or exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and r.is_super = true
      and ur.revoked_at is null
  );
$$;

drop policy if exists "menu_items_admin_write" on public.menu_items;
create policy "menu_items_admin_write" on public.menu_items
  for all to authenticated
  using (public.is_menu_admin())
  with check (public.is_menu_admin());

drop policy if exists "pma_admin_write" on public.position_menu_access;
create policy "pma_admin_write" on public.position_menu_access
  for all to authenticated
  using (public.is_menu_admin())
  with check (public.is_menu_admin());

-- Convenience view: resolved sidebar for the current user
create or replace view public.v_user_sidebar as
select
  e.profile_id                             as user_id,
  e.position_id,
  p.name                                   as position_name,
  p.name_bn                                as position_name_bn,
  mi.key,
  mi.label_bn,
  mi.label_en,
  mi.icon,
  mi.route,
  mi.parent_key,
  mi.section,
  coalesce(pma.sort_order, mi.sort_order)  as sort_order,
  pma.default_expanded,
  pma.badge_source,
  mi.requires_permission
from public.employees e
join public.positions p             on p.id = e.position_id
join public.position_menu_access pma on pma.position_id = e.position_id
join public.menu_items mi           on mi.key = pma.menu_key
where e.status = 'Active'
  and mi.is_active = true
  and pma.is_visible = true;
