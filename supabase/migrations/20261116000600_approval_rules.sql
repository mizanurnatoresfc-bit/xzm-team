-- =====================================================================
--  কোন কাজে কার অনুমোদন: approval rules a Zonal Manager sets
--
--  Work goes up: staff input -> manager -> zonal manager. For each kind of
--  input, a rule says what happens when it is submitted:
--    approve  it waits until someone above accepts it (how everything works today)
--    auto     it is accepted the moment it is submitted; the manager still sees
--             it and may take the acceptance back
--    view     it is accepted the moment it is submitted and cannot be taken
--             back from above; the manager only looks
--  A rule is for all zones (zone_id null) or for one zone, which wins.
--  With no rule the answer is "approve", so nothing changes until someone
--  sets a rule.
--
--  Wired in this migration: the hisab khata (a person's part of a hub's daily
--  sheet). The other kinds are listed so the page can show what comes next,
--  but a rule cannot be saved for them yet.
--
--  Additive: one table, one permission, five functions; the trigger function
--  private.da_collectors_unaccept and public.da_parts_accept are re-created.
--
--  Rollback: delete from public.approval_rules (everything is "approve" again);
--  to remove fully, re-run private.da_collectors_unaccept and da_parts_accept
--  from 20261116000200_khata_accept.sql (and re-create the trigger as
--  "before update"), drop the functions below, the table and the permission.
-- =====================================================================

create table if not exists public.approval_rules (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null,
  zone_id         uuid references public.zones(id),
  mode            text not null check (mode in ('approve', 'auto', 'view')),
  set_by_name     text,
  created_at      timestamptz not null default now(), created_by uuid,
  updated_at      timestamptz not null default now(), updated_by uuid
);
create index if not exists approval_rules_zone_idx on public.approval_rules (zone_id);
create unique index if not exists approval_rules_one on public.approval_rules (kind, coalesce(zone_id, '00000000-0000-0000-0000-000000000000'::uuid));

drop trigger if exists approval_rules_stamp on public.approval_rules;
create trigger approval_rules_stamp before insert or update on public.approval_rules
  for each row execute function private.stamp_row();
drop trigger if exists approval_rules_audit on public.approval_rules;
create trigger approval_rules_audit after insert or update or delete on public.approval_rules
  for each row execute function private.audit_row('system');

alter table public.approval_rules enable row level security;
revoke all on public.approval_rules from anon, authenticated;
grant select on public.approval_rules to authenticated;
-- The rules are not secret: everyone with a role may read them. They are written only through approval_rule_save().
drop policy if exists approval_rules_read on public.approval_rules;
create policy approval_rules_read on public.approval_rules for select to authenticated
  using (exists (select 1 from private.my_grants()));

insert into public.permissions (code, module, resource, action, description) values
  ('system.approval_rule.configure', 'system', 'approval_rule', 'configure', 'Set which inputs need approval, are accepted automatically, or are only viewed')
on conflict (code) do nothing;

-- The zonal manager gets it. So does every role that may hand out roles (a role can only be given by someone who holds everything in it).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'system.approval_rule.configure'
where not r.is_super and (r.code = 'zonal_manager' or exists (
  select 1 from public.role_permissions rp join public.permissions q on q.id = rp.permission_id
  where rp.role_id = r.id and q.code = 'system.user_role.create'))
on conflict do nothing;

-- Every kind of input, in the order the page shows them. "wired" = the rule is obeyed today.
create or replace function private.approval_kinds()
returns table (kind text, ord integer, wired boolean)
language sql immutable set search_path = '' as $$
  values ('khata', 1, true), ('leave', 2, false), ('hr_request', 3, false), ('id_application', 4, false),
         ('manpower', 5, false), ('expense', 6, false), ('profile', 7, false)
$$;

-- What happens to an input of this kind in this zone: the zone's own rule, else the rule for all zones, else "approve".
create or replace function private.approval_mode(p_kind text, p_zone uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when not coalesce((select k.wired from private.approval_kinds() k where k.kind = p_kind), false) then 'approve'
    else coalesce((select r.mode from public.approval_rules r where r.kind = p_kind and r.zone_id = p_zone),
                  (select r.mode from public.approval_rules r where r.kind = p_kind and r.zone_id is null), 'approve') end
$$;

-- For the pages: what applies at this hub (so a button that would be refused is not shown).
create or replace function public.approval_mode_at(p_kind text, p_hub uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null then 'approve' else private.approval_mode(p_kind, private.hub_zone(p_hub)) end
$$;

-- The settings page: every kind with the rule for all zones and, when a zone is given, that zone's own rule.
create or replace function public.approval_rules_list(p_zone uuid default null)
returns table (kind text, wired boolean, all_mode text, zone_mode text, mode text, set_by_name text, set_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.has_permission('system.approval_rule.configure', p_zone, null) or private.has_permission('system.approval_rule.configure', null, null)) then
    raise exception 'অনুমোদনের নিয়ম দেখার অনুমতি নেই।' using errcode = '42501';
  end if;
  return query
    select k.kind, k.wired, coalesce(g.mode, 'approve'), z.mode, private.approval_mode(k.kind, p_zone),
           coalesce(z.set_by_name, g.set_by_name), coalesce(z.updated_at, g.updated_at)
    from private.approval_kinds() k
    left join public.approval_rules g on g.kind = k.kind and g.zone_id is null
    left join public.approval_rules z on z.kind = k.kind and z.zone_id = p_zone
    order by k.ord;
end $$;

-- Save one rule. p_zone null = for all zones (needs the permission without a zone limit). p_mode null on a zone = follow "all zones" again.
create or replace function public.approval_rule_save(p_kind text, p_zone uuid, p_mode text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_wired boolean;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  select k.wired into v_wired from private.approval_kinds() k where k.kind = p_kind;
  if v_wired is null then raise exception 'এই ধরনের কাজ চেনা যায়নি।' using errcode = '22023'; end if;
  if not v_wired then raise exception 'এই কাজের নিয়ম এখনো চালু হয়নি — আপাতত অনুমোদন লাগবে।' using errcode = '22023'; end if;
  if p_mode is not null and p_mode not in ('approve', 'auto', 'view') then raise exception 'নিয়মটি ঠিক নয়।' using errcode = '22023'; end if;
  if p_zone is null then
    if not private.has_permission('system.approval_rule.configure', null, null) then
      raise exception 'সব জোনের নিয়ম শুধু তিনিই বদলাতে পারেন যাঁর অনুমতি সব জোনের জন্য।' using errcode = '42501';
    end if;
    if p_mode is null then raise exception 'সব জোনের জন্য একটি নিয়ম বেছে নিন।' using errcode = '22023'; end if;
  else
    if not exists (select 1 from public.zones z where z.id = p_zone) then raise exception 'জোন পাওয়া যায়নি।' using errcode = 'P0002'; end if;
    if not private.has_permission('system.approval_rule.configure', p_zone, null) then
      raise exception 'এই জোনের নিয়ম বদলানোর অনুমতি নেই।' using errcode = '42501';
    end if;
  end if;
  perform set_config('app.change_reason', 'Approval rule: ' || p_kind, true);
  if p_mode is null then
    delete from public.approval_rules r where r.kind = p_kind and r.zone_id = p_zone;
    return;
  end if;
  update public.approval_rules r set mode = p_mode, set_by_name = private.da_my_name()
   where r.kind = p_kind and r.zone_id is not distinct from p_zone;
  if not found then
    insert into public.approval_rules (kind, zone_id, mode, set_by_name) values (p_kind, p_zone, p_mode, private.da_my_name());
  end if;
end $$;

-- ---------------------------------------------------------------------
--  Hisab khata: obey the rule
-- ---------------------------------------------------------------------
-- A khata that goes back to draft is no longer accepted (as before). A khata that is submitted where the rule is
-- "auto" or "view" is accepted on the spot; accepted_by stays empty and the name says how it was accepted.
create or replace function private.da_collectors_unaccept() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_mode text;
begin
  if new.closed_at is null then
    new.accepted_at := null; new.accepted_by := null; new.accepted_by_name := null;
  elsif (tg_op = 'INSERT' or old.closed_at is null) and new.accepted_at is null then
    v_mode := private.approval_mode('khata', (select s.zone_id from public.da_sessions s where s.id = new.session_id));
    if v_mode in ('auto', 'view') then
      new.accepted_at := now(); new.accepted_by := null;
      new.accepted_by_name := case v_mode when 'auto' then 'অটো গ্রহণ' else 'সরাসরি গৃহীত' end;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists da_collectors_unaccept on public.da_sheet_collectors;
create trigger da_collectors_unaccept before insert or update on public.da_sheet_collectors
  for each row execute function private.da_collectors_unaccept();

-- Accept (or take back the acceptance of) submitted khatas, several at once. Where the rule is "view", an acceptance cannot be taken back.
create or replace function public.da_parts_accept(p_session uuid, p_users uuid[], p_accept boolean default true) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s public.da_sessions := private.da_require_edit(p_session);
  v_n integer; v_bad text;
begin
  if coalesce(array_length(p_users, 1), 0) = 0 then raise exception 'কোন খাতা, তা বেছে নিন।' using errcode = '22023'; end if;
  if s.closed_at is not null then
    raise exception 'ডেইলি হিসাবের খাতা খোলা হয়ে গেছে। আগে সেটি ফিরিয়ে নিন, তারপর বদলান।' using errcode = '22023';
  end if;
  if p_accept then
    select string_agg(coalesce(c.name, '—'), ', ') into v_bad from public.da_sheet_collectors c
     where c.session_id = s.id and c.user_id = any(p_users) and c.closed_at is null;
    if v_bad is not null then raise exception 'এই খাতাগুলো এখনো সাবমিট হয়নি: %', v_bad using errcode = '22023'; end if;
  elsif private.approval_mode('khata', s.zone_id) = 'view' then
    raise exception 'এই জোনে খাতা জমা দিলেই গৃহীত হয় — উপর থেকে ফিরিয়ে নেওয়া যায় না। ভুল থাকলে যাঁর খাতা তিনি আবার খুলে ঠিক করবেন।' using errcode = '22023';
  end if;
  update public.da_sheet_collectors c
     set accepted_at = case when p_accept then now() end,
         accepted_by = case when p_accept then auth.uid() end,
         accepted_by_name = case when p_accept then private.da_my_name() end,
         updated_at = now(), updated_by = auth.uid()
   where c.session_id = s.id and c.user_id = any(p_users) and c.closed_at is not null
     and (c.accepted_at is null) = p_accept;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform private.da_event(s.id, 'note', v_n || case when p_accept then ' khata accepted by ' else ' khata acceptance taken back by ' end
      || coalesce(private.da_my_name(), 'someone'), false);
  end if;
  return v_n;
end $$;

revoke all on function private.approval_kinds(), private.approval_mode(text, uuid) from public, anon;
grant execute on function private.approval_kinds(), private.approval_mode(text, uuid) to authenticated;
revoke all on function private.da_collectors_unaccept() from public, anon, authenticated;
revoke all on function public.approval_mode_at(text, uuid), public.approval_rules_list(uuid), public.approval_rule_save(text, uuid, text),
  public.da_parts_accept(uuid, uuid[], boolean) from public, anon;
grant execute on function public.approval_mode_at(text, uuid), public.approval_rules_list(uuid), public.approval_rule_save(text, uuid, text),
  public.da_parts_accept(uuid, uuid[], boolean) to authenticated;
