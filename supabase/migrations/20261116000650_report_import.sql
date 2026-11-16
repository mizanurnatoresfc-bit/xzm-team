-- Brought into the repository on 2026-11-17 from the live database (applied live as 20261116213632 report_import).
-- The text below is exactly what ran on the live database.

insert into public.permissions (code, module, resource, action, description) values
  ('da.import.create', 'da', 'import', 'create', 'Upload the courier panel''s daily Update Report for a hub')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'da.import.create'
 where r.code in ('admin', 'accounts_manager', 'accountant', 'zonal_manager', 'hub_manager')
on conflict do nothing;

create table public.da_import_reports (
  id               uuid primary key default gen_random_uuid(),
  no               bigint generated always as identity unique,
  report_no        bigint not null unique check (report_no > 0),
  hub_id           uuid not null references public.hubs(id),
  zone_id          uuid not null references public.zones(id),
  account_date     date not null,
  manager_code     text not null check (manager_code ~ '^[0-9]{1,12}$'),
  manager_name     text,
  hub_text         text,
  reported_at      timestamp not null,
  collected        numeric(14,2) not null check (collected >= 0),
  delivery_charge  numeric(14,2) not null check (delivery_charge >= 0),
  declared_lists   integer not null check (declared_lists >= 0),
  declared_parcels integer not null check (declared_parcels >= 0),
  lists_amount     numeric(14,2) not null,
  raw_text         text not null,
  upload_count     integer not null default 1,
  uploaded_by      uuid,
  uploaded_by_name text,
  uploaded_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(), created_by uuid,
  updated_at       timestamptz not null default now(), updated_by uuid
);
create index da_import_reports_day_idx on public.da_import_reports (account_date, hub_id);
create index da_import_reports_hub_fk_idx on public.da_import_reports (hub_id);
create index da_import_reports_zone_fk_idx on public.da_import_reports (zone_id);

create table public.da_import_lists (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.da_import_reports(id),
  hub_id      uuid not null references public.hubs(id),
  zone_id     uuid not null references public.zones(id),
  list_no     bigint not null check (list_no between 10000000 and 99999999),
  point       boolean not null default false,
  rider_code  text check (rider_code ~ '^[0-9]{1,12}$'),
  rider_name  text,
  parcels     integer not null check (parcels >= 0),
  amount      numeric(14,2) not null check (amount >= 0),
  removed_at  timestamptz,
  created_at  timestamptz not null default now(), created_by uuid,
  updated_at  timestamptz not null default now(), updated_by uuid,
  unique (report_id, list_no),
  constraint da_import_lists_rider_chk check (point = (rider_code is null))
);
create index da_import_lists_list_idx on public.da_import_lists (list_no) where removed_at is null;
create index da_import_lists_hub_fk_idx on public.da_import_lists (hub_id);
create index da_import_lists_zone_fk_idx on public.da_import_lists (zone_id);

create table public.da_import_rider_map (
  rider_code     text primary key check (rider_code ~ '^[0-9]{1,12}$'),
  employee_id    uuid not null references public.employees(id),
  mapped_by_name text,
  created_at     timestamptz not null default now(), created_by uuid,
  updated_at     timestamptz not null default now(), updated_by uuid
);
create index da_import_rider_map_employee_fk_idx on public.da_import_rider_map (employee_id);

do $$
declare t text;
begin
  foreach t in array array['da_import_reports','da_import_lists','da_import_rider_map'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t||'_stamp', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(''da'')', t||'_audit', t);
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t||'_no_delete', t);
  end loop;
end $$;

create or replace function private.da_import_can_see(p_zone uuid, p_hub uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_permission('da.sheet.view', p_zone, p_hub) or private.has_permission('da.import.create', p_zone, p_hub)
$$;

create or replace function private.da_import_emp(p_code text) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select m.employee_id from public.da_import_rider_map m where m.rider_code = p_code),
    (select e.id from public.employees e where e.employee_code::text = p_code and e.archived_at is null limit 1))
$$;

alter table public.da_import_reports enable row level security;
alter table public.da_import_lists enable row level security;
alter table public.da_import_rider_map enable row level security;
revoke all on public.da_import_reports, public.da_import_lists, public.da_import_rider_map from anon, authenticated;
grant select on public.da_import_reports, public.da_import_lists, public.da_import_rider_map to authenticated;
create policy da_import_reports_read on public.da_import_reports for select to authenticated
  using ((select private.da_import_can_see(zone_id, hub_id)));
create policy da_import_lists_read on public.da_import_lists for select to authenticated
  using ((select private.da_import_can_see(zone_id, hub_id)));
create policy da_import_rider_map_read on public.da_import_rider_map for select to authenticated
  using (exists (select 1 from private.my_grants() g where g.is_super or g.permission_code in ('da.sheet.view', 'da.import.create')));

create or replace function public.da_import_save(p_hub uuid, p_date date, p_raw text, p_report jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_zone uuid; v_old public.da_import_reports; v_id uuid; v_new boolean;
  v_no bigint; v_mgr text; v_at timestamp;
  v_collected numeric; v_charge numeric; v_dl integer; v_dp integer;
  v_n integer; v_distinct integer; v_bad integer; v_parcels bigint; v_sum numeric;
  v_fail text[] := '{}'; v_shared integer;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select h.zone_id into v_zone from public.hubs h where h.id = p_hub and h.archived_at is null;
  if v_zone is null or not private.has_permission('da.import.create', v_zone, p_hub) then
    raise exception 'এই হাবের রিপোর্ট আপলোড করার অনুমতি আপনার নেই।' using errcode = '42501';
  end if;
  if p_date is null then raise exception 'খাতার তারিখ বেছে নিন।' using errcode = '22023'; end if;
  if p_date > private.da_today() then raise exception 'আগামী দিনের তারিখে রিপোর্ট তোলা যায় না।' using errcode = '22023'; end if;
  if length(trim(coalesce(p_raw, ''))) < 20 or length(p_raw) > 200000 then
    raise exception 'রিপোর্টের আসল লেখা নেই বা খুব বড়।' using errcode = '22023';
  end if;
  if coalesce(p_report ->> 'report_no', '') !~ '^[0-9]{1,15}$' or coalesce(p_report ->> 'manager_code', '') !~ '^[0-9]{1,12}$'
     or p_report ->> 'reported_at' is null or jsonb_typeof(p_report -> 'lists') is distinct from 'array' then
    raise exception 'রিপোর্ট পড়া যায়নি (রিপোর্ট আইডি, ম্যানেজার আইডি, তারিখ বা লিস্ট নেই)।' using errcode = '22023';
  end if;
  v_no := (p_report ->> 'report_no')::bigint;
  v_mgr := p_report ->> 'manager_code';
  v_at := (p_report ->> 'reported_at')::timestamp;
  v_collected := round((p_report ->> 'collected')::numeric, 2);
  v_charge := round((p_report ->> 'delivery_charge')::numeric, 2);
  v_dl := (p_report ->> 'declared_lists')::integer;
  v_dp := (p_report ->> 'declared_parcels')::integer;
  if v_collected is null or v_charge is null or v_dl is null or v_dp is null or v_collected < 0 or v_charge < 0 then
    raise exception 'রিপোর্ট পড়া যায়নি (Collected, ডেলিভারি চার্জ বা ঘোষিত সংখ্যা নেই)।' using errcode = '22023';
  end if;

  select count(*), count(distinct l.list_no), coalesce(sum(l.parcels), 0), coalesce(sum(round(l.amount, 2)), 0),
         count(*) filter (where coalesce(l.list_no, '') !~ '^[1-9][0-9]{7}$' or l.parcels is null or l.parcels < 0 or l.amount is null or l.amount < 0
                             or coalesce(l.point, false) = (coalesce(l.rider_code, '') ~ '^[0-9]{1,12}$')
                             or (not coalesce(l.point, false) and coalesce(l.rider_code, '') !~ '^[0-9]{1,12}$'))
    into v_n, v_distinct, v_parcels, v_sum, v_bad
    from jsonb_to_recordset(p_report -> 'lists') as l(list_no text, point boolean, rider_code text, rider_name text, parcels integer, amount numeric);
  if v_bad > 0 or v_distinct <> v_n then
    raise exception 'রিপোর্ট সেভ হয়নি — %টি লিস্ট ঠিকমতো পড়া যায়নি বা একই লিস্ট দুইবার আছে।', greatest(v_bad, v_n - v_distinct) using errcode = '22023';
  end if;

  if v_sum + v_charge <> v_collected then
    v_fail := v_fail || format('টাকা: লিস্টের যোগফল %s + ডেলিভারি চার্জ %s = %s, কিন্তু Collected %s', v_sum, v_charge, v_sum + v_charge, v_collected);
  end if;
  if v_parcels <> v_dp then v_fail := v_fail || format('পার্সেল: লিস্টে মোট %s, ঘোষিত %s', v_parcels, v_dp); end if;
  if v_n <> v_dl then v_fail := v_fail || format('লিস্ট সংখ্যা: পাওয়া গেছে %s, ঘোষিত %s', v_n, v_dl); end if;
  if array_length(v_fail, 1) > 0 then
    raise exception 'রিপোর্ট সেভ হয়নি — মেলেনি: %', array_to_string(v_fail, '; ') using errcode = '22023';
  end if;

  select * into v_old from public.da_import_reports r where r.report_no = v_no for update;
  v_new := v_old.id is null;
  if v_new then
    insert into public.da_import_reports (report_no, hub_id, zone_id, account_date, manager_code, manager_name, hub_text, reported_at,
           collected, delivery_charge, declared_lists, declared_parcels, lists_amount, raw_text, uploaded_by, uploaded_by_name)
    values (v_no, p_hub, v_zone, p_date, v_mgr, nullif(trim(p_report ->> 'manager_name'), ''), nullif(trim(p_report ->> 'hub_text'), ''), v_at,
            v_collected, v_charge, v_dl, v_dp, v_sum, p_raw, auth.uid(), private.da_my_name())
    returning id into v_id;
  else
    if not private.has_permission('da.import.create', v_old.zone_id, v_old.hub_id) then
      raise exception 'এই রিপোর্ট আইডি আগে অন্য হাবে তোলা হয়েছে; সেটি বদলানোর অনুমতি আপনার নেই।' using errcode = '42501';
    end if;
    v_id := v_old.id;
    update public.da_import_reports
       set hub_id = p_hub, zone_id = v_zone, account_date = p_date, manager_code = v_mgr,
           manager_name = nullif(trim(p_report ->> 'manager_name'), ''), hub_text = nullif(trim(p_report ->> 'hub_text'), ''), reported_at = v_at,
           collected = v_collected, delivery_charge = v_charge, declared_lists = v_dl, declared_parcels = v_dp, lists_amount = v_sum,
           raw_text = p_raw, upload_count = upload_count + 1, uploaded_by = auth.uid(), uploaded_by_name = private.da_my_name(), uploaded_at = now()
     where id = v_id;
    update public.da_import_lists x set removed_at = now()
     where x.report_id = v_id and x.removed_at is null
       and x.list_no not in (select (e ->> 'list_no')::bigint from jsonb_array_elements(p_report -> 'lists') e);
  end if;

  insert into public.da_import_lists (report_id, hub_id, zone_id, list_no, point, rider_code, rider_name, parcels, amount)
  select v_id, p_hub, v_zone, l.list_no::bigint, coalesce(l.point, false),
         case when coalesce(l.point, false) then null else l.rider_code end,
         case when coalesce(l.point, false) then null else nullif(trim(l.rider_name), '') end, l.parcels, round(l.amount, 2)
    from jsonb_to_recordset(p_report -> 'lists') as l(list_no text, point boolean, rider_code text, rider_name text, parcels integer, amount numeric)
  on conflict (report_id, list_no) do update
     set hub_id = excluded.hub_id, zone_id = excluded.zone_id, point = excluded.point, rider_code = excluded.rider_code,
         rider_name = excluded.rider_name, parcels = excluded.parcels, amount = excluded.amount, removed_at = null;

  select count(distinct x.list_no) into v_shared from public.da_import_lists x
   where x.removed_at is null and x.report_id <> v_id
     and x.list_no in (select y.list_no from public.da_import_lists y where y.report_id = v_id and y.removed_at is null);
  return jsonb_build_object('report_id', v_id, 'report_no', v_no, 'created', v_new, 'lists', v_n, 'in_other_reports', v_shared);
end $$;

create or replace function private.da_import_counted(p_date date)
returns table (list_no bigint, report_id uuid, report_no bigint, hub_id uuid, zone_id uuid, manager_code text,
               point boolean, rider_code text, rider_name text, parcels integer, amount numeric)
language sql stable security definer set search_path = '' as $$
  select w.list_no, w.report_id, w.report_no, w.hub_id, w.zone_id, w.manager_code, w.point, w.rider_code, w.rider_name, w.parcels, w.amount
  from (select distinct on (l.list_no) l.list_no, l.report_id, r.report_no, r.hub_id, r.zone_id, r.manager_code, r.account_date,
               l.point, l.rider_code, l.rider_name, l.parcels, l.amount
          from public.da_import_lists l join public.da_import_reports r on r.id = l.report_id
         where l.removed_at is null
           and l.list_no in (select l2.list_no from public.da_import_lists l2 join public.da_import_reports r2 on r2.id = l2.report_id
                              where r2.account_date = p_date and l2.removed_at is null)
         order by l.list_no, r.reported_at desc, r.uploaded_at desc) w
  where w.account_date = p_date
$$;

create or replace function public.da_import_day(p_date date, p_hub uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  with reps as (
    select r.* from public.da_import_reports r
     where r.account_date = p_date and (p_hub is null or r.hub_id = p_hub) and private.da_import_can_see(r.zone_id, r.hub_id)),
  cnt as (
    select c.*, case when c.point then null else private.da_import_emp(c.rider_code) end as employee_id
      from private.da_import_counted(p_date) c where c.report_id in (select id from reps)),
  riders as (
    select c.hub_id, c.manager_code, c.rider_code, max(c.rider_name) as rider_name, (array_agg(c.employee_id))[1] as employee_id,
           sum(c.parcels) as parcels, sum(c.amount) as amount,
           jsonb_agg(jsonb_build_object('list_no', c.list_no, 'report_no', c.report_no, 'parcels', c.parcels, 'amount', c.amount) order by c.list_no) as lists
      from cnt c where not c.point group by c.hub_id, c.manager_code, c.rider_code),
  points as (
    select c.hub_id, c.manager_code, sum(c.parcels) as parcels, sum(c.amount) as amount,
           jsonb_agg(jsonb_build_object('list_no', c.list_no, 'report_no', c.report_no, 'parcels', c.parcels, 'amount', c.amount) order by c.list_no) as lists
      from cnt c where c.point group by c.hub_id, c.manager_code),
  khata as (
    select r.hub_id, r.manager_code, max(r.manager_name) as manager_name, private.da_import_emp(r.manager_code) as manager_employee,
           sum(r.delivery_charge) as delivery_charge, sum(r.collected) as reports_collected, max(r.uploaded_at) as last_at,
           jsonb_agg(jsonb_build_object('id', r.id, 'report_no', r.report_no, 'reported_at', r.reported_at, 'collected', r.collected,
             'delivery_charge', r.delivery_charge, 'declared_lists', r.declared_lists, 'declared_parcels', r.declared_parcels,
             'upload_count', r.upload_count, 'uploaded_by_name', r.uploaded_by_name, 'uploaded_at', r.uploaded_at,
             'counted_lists', (select count(*) from cnt c where c.report_id = r.id)) order by r.reported_at) as reports
      from reps r group by r.hub_id, r.manager_code)
  select coalesce(jsonb_agg(jsonb_build_object(
      'hub_id', k.hub_id, 'hub_name', h.name, 'manager_code', k.manager_code, 'manager_name', coalesce(me.full_name, k.manager_name),
      'manager_known', k.manager_employee is not null,
      'delivery_charge', k.delivery_charge, 'last_at', k.last_at, 'reports', k.reports,
      'riders', coalesce((select jsonb_agg(jsonb_build_object('rider_code', x.rider_code, 'report_name', x.rider_name,
                   'employee_id', x.employee_id, 'name', coalesce(e.full_name, x.rider_name), 'known', x.employee_id is not null,
                   'parcels', x.parcels, 'amount', x.amount, 'lists', x.lists) order by x.amount desc, x.rider_code)
                 from riders x left join public.employees e on e.id = x.employee_id
                where x.hub_id = k.hub_id and x.manager_code = k.manager_code), '[]'::jsonb),
      'point', (select jsonb_build_object('parcels', p.parcels, 'amount', p.amount, 'lists', p.lists)
                  from points p where p.hub_id = k.hub_id and p.manager_code = k.manager_code),
      'lists', (select count(*) from cnt c where c.hub_id = k.hub_id and c.manager_code = k.manager_code),
      'parcels', coalesce((select sum(c.parcels) from cnt c where c.hub_id = k.hub_id and c.manager_code = k.manager_code), 0),
      'lists_amount', coalesce((select sum(c.amount) from cnt c where c.hub_id = k.hub_id and c.manager_code = k.manager_code), 0),
      'total', coalesce((select sum(c.amount) from cnt c where c.hub_id = k.hub_id and c.manager_code = k.manager_code), 0) + k.delivery_charge
    ) order by h.name, k.manager_code), '[]'::jsonb)
    into v
    from khata k join public.hubs h on h.id = k.hub_id left join public.employees me on me.id = k.manager_employee;
  return v;
end $$;

create or replace function public.da_import_status(p_date date, p_zone uuid default null)
returns table (hub_id uuid, hub_name text, zone_id uuid, zone_name text, can_upload boolean, reports integer, managers integer,
               lists integer, parcels integer, amount numeric, delivery_charge numeric, unknown_riders integer, last_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with hubs as (
    select h.id, h.name, z.id as zid, z.name as zname, private.has_permission('da.import.create', z.id, h.id) as can_upload
      from public.hubs h join public.zones z on z.id = h.zone_id
     where h.archived_at is null and (p_zone is null or z.id = p_zone) and auth.uid() is not null
       and private.da_import_can_see(z.id, h.id)),
  cnt as (select c.* from private.da_import_counted(p_date) c where c.hub_id in (select id from hubs))
  select h.id, h.name, h.zid, h.zname, h.can_upload,
         (select count(*)::int from public.da_import_reports r where r.hub_id = h.id and r.account_date = p_date),
         (select count(distinct r.manager_code)::int from public.da_import_reports r where r.hub_id = h.id and r.account_date = p_date),
         (select count(*)::int from cnt c where c.hub_id = h.id),
         coalesce((select sum(c.parcels)::int from cnt c where c.hub_id = h.id), 0),
         coalesce((select sum(c.amount) from cnt c where c.hub_id = h.id), 0),
         coalesce((select sum(r.delivery_charge) from public.da_import_reports r where r.hub_id = h.id and r.account_date = p_date), 0),
         (select count(distinct c.rider_code)::int from cnt c where c.hub_id = h.id and not c.point and private.da_import_emp(c.rider_code) is null),
         (select max(r.uploaded_at) from public.da_import_reports r where r.hub_id = h.id and r.account_date = p_date)
    from hubs h order by h.zname, h.name
$$;

create or replace function public.da_import_map_rider(p_code text, p_employee uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.employees; v_code text := trim(coalesce(p_code, ''));
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if v_code !~ '^[0-9]{1,12}$' then raise exception 'রাইডার আইডি ঠিক নয়।' using errcode = '22023'; end if;
  select * into e from public.employees x where x.id = p_employee and x.archived_at is null;
  if e.id is null then raise exception 'কর্মী পাওয়া যায়নি।' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.da_import_lists l where l.rider_code = v_code and l.removed_at is null
                    and private.has_permission('da.import.create', l.zone_id, l.hub_id))
     and not exists (select 1 from public.da_import_reports r where r.manager_code = v_code
                    and private.has_permission('da.import.create', r.zone_id, r.hub_id)) then
    raise exception 'এই আইডি ম্যাপ করার অনুমতি আপনার নেই।' using errcode = '42501';
  end if;
  insert into public.da_import_rider_map (rider_code, employee_id, mapped_by_name)
  values (v_code, e.id, private.da_my_name())
  on conflict (rider_code) do update set employee_id = excluded.employee_id, mapped_by_name = excluded.mapped_by_name;
end $$;

revoke all on function private.da_import_can_see(uuid, uuid) from public, anon;
grant execute on function private.da_import_can_see(uuid, uuid) to authenticated;
revoke all on function private.da_import_emp(text), private.da_import_counted(date) from public, anon, authenticated;
revoke all on function public.da_import_save(uuid, date, text, jsonb), public.da_import_day(date, uuid),
  public.da_import_status(date, uuid), public.da_import_map_rider(text, uuid) from public, anon;
grant execute on function public.da_import_save(uuid, date, text, jsonb), public.da_import_day(date, uuid),
  public.da_import_status(date, uuid), public.da_import_map_rider(text, uuid) to authenticated;
