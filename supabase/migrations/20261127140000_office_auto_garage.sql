-- Auto garage: the autos kept at an auto garage (a place of kind 'auto_garage'), each with its own rate and a person responsible.
-- The person says "yes / no" for every day: was the auto given today? The month's rent is the sum of the rates of the "yes" days.
-- The rate is copied into the day when it is marked, so changing an auto's rate later never changes a past month.
-- Everything goes through the functions below; the tables are closed to direct reads and writes.

create table private.office_autos (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.office_properties(id),
  name text not null check (length(trim(name)) > 0),
  reg_no text,
  rate numeric(12,2) not null default 0 check (rate >= 0),           -- ৳ for every day the auto is given
  responsible_id uuid references public.employees(id),
  note text,
  archived_at timestamptz, archived_by uuid, archive_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index office_autos_property on private.office_autos (property_id) where archived_at is null;
create index office_autos_responsible on private.office_autos (responsible_id) where archived_at is null;

create table private.office_auto_days (
  id uuid not null unique default gen_random_uuid(),                  -- the audit log names a row by its id
  auto_id uuid not null references private.office_autos(id),
  day date not null,
  given boolean not null,
  rate numeric(12,2) not null check (rate >= 0),                      -- the auto's rate on the day it was marked
  marked_by uuid default auth.uid(),
  marked_by_name text,
  marked_at timestamptz not null default now(),
  primary key (auto_id, day)
);
create index office_auto_days_day on private.office_auto_days (day);

do $$
declare t text;
begin
  foreach t in array array['office_autos', 'office_auto_days'] loop
    execute format('alter table private.%I enable row level security', t);
    execute format('revoke all on private.%I from public, anon, authenticated', t);
    execute format('create trigger %I after insert or update or delete on private.%I for each row execute function private.audit_row(%L)', t || '_audit', t, 'office');
    execute format('create trigger %I before delete on private.%I for each row execute function private.prevent_delete()', t || '_no_delete', t);
  end loop;
end $$;
create trigger office_autos_stamp before insert or update on private.office_autos for each row execute function private.stamp_row();

-- ---------------------------------------------------------------- add / change / remove an auto
create function public.office_auto_save(
  p_property uuid, p_name text, p_rate numeric, p_responsible uuid default null, p_reg text default null, p_note text default null, p_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  p public.office_properties;
  v_id uuid;
begin
  select * into p from public.office_properties where id = p_property and archived_at is null;
  if not found then raise exception 'জায়গাটা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.office_can('office.property.edit', p_property) then raise exception 'অটো যোগ বা বদলানোর অনুমতি নেই' using errcode = '42501'; end if;
  if p.kind <> 'auto_garage' then raise exception 'অটো শুধু অটো গ্যারেজে যোগ হয়' using errcode = '22023'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'অটোর নাম দিন' using errcode = '22023'; end if;
  if p_rate is null or p_rate < 0 then raise exception 'প্রতিদিনের ভাড়া ঠিক নয়' using errcode = '22023'; end if;
  if p_responsible is not null and not exists (
    select 1 from public.employees e where e.id = p_responsible and e.status = 'active' and e.archived_at is null
      and (p.hub_id is null or e.hub_id = p.hub_id)
      and (p.zone_id is null or e.zone_id = p.zone_id or (p.hub_id is not null and e.hub_id = p.hub_id))
  ) then raise exception 'এই জায়গার সক্রিয় স্টাফ বাছুন' using errcode = '22023'; end if;

  perform set_config('app.change_reason', 'অটো গ্যারেজের অটো', true);
  if p_id is null then
    insert into private.office_autos (property_id, name, reg_no, rate, responsible_id, note)
    values (p_property, trim(p_name), nullif(trim(coalesce(p_reg, '')), ''), p_rate, p_responsible, nullif(trim(coalesce(p_note, '')), ''))
    returning id into v_id;
  else
    update private.office_autos set name = trim(p_name), reg_no = nullif(trim(coalesce(p_reg, '')), ''), rate = p_rate,
           responsible_id = p_responsible, note = nullif(trim(coalesce(p_note, '')), '')
     where id = p_id and property_id = p_property and archived_at is null
     returning id into v_id;
    if v_id is null then raise exception 'অটোটা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

create function public.office_auto_archive(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare a private.office_autos;
begin
  select * into a from private.office_autos where id = p_id and archived_at is null;
  if not found then raise exception 'অটোটা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.office_can('office.property.edit', a.property_id) then raise exception 'অটো সরানোর অনুমতি নেই' using errcode = '42501'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'সরানোর কারণ লিখুন' using errcode = '22023'; end if;
  perform set_config('app.change_reason', p_reason, true);
  update private.office_autos set archived_at = now(), archived_by = auth.uid(), archive_reason = trim(p_reason) where id = p_id;
end $$;

-- ---------------------------------------------------------------- the daily yes / no
-- The person responsible marks today and the two days before; someone who may edit the place can fix any past day. Never a future day.
create function public.office_auto_mark(p_auto uuid, p_day date, p_given boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  a private.office_autos;
  mine boolean;
  editor boolean;
begin
  if auth.uid() is null or p_given is null or p_day is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into a from private.office_autos where id = p_auto and archived_at is null for share;
  if not found then raise exception 'অটোটা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  mine := a.responsible_id is not null and a.responsible_id = private.my_employee_id();
  editor := private.office_can('office.property.edit', a.property_id);
  if not mine and not editor then raise exception 'এই অটোর হ্যাঁ/না দেওয়ার অনুমতি নেই' using errcode = '42501'; end if;
  if p_day > current_date then raise exception 'আগামী দিনের হিসাব এখন দেওয়া যায় না' using errcode = '22023'; end if;
  if not editor and p_day < current_date - 2 then raise exception 'এত পুরোনো দিন নিজে বদলানো যায় না — হাব ম্যানেজারকে বলুন' using errcode = '22023'; end if;
  perform set_config('app.change_reason', 'অটো গ্যারেজ: ' || case when p_given then 'হ্যাঁ' else 'না' end, true);
  insert into private.office_auto_days (auto_id, day, given, rate, marked_by_name)
  values (p_auto, p_day, p_given, a.rate, private.my_display_name())
  on conflict (auto_id, day) do update
     set given = excluded.given, rate = excluded.rate, marked_by = auth.uid(), marked_by_name = excluded.marked_by_name, marked_at = now();
end $$;

-- ---------------------------------------------------------------- reading
-- One place's autos with the month's days. Those who may view the place, and the person responsible for an auto, may read it.
create function public.office_autos(p_property uuid, p_month date)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with m as (select date_trunc('month', coalesce(p_month, current_date))::date as d0),
  viewer as (select private.office_can('office.property.view', p_property) as viewall, private.office_can('office.property.edit', p_property) as edit)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'name', a.name, 'reg_no', a.reg_no, 'rate', a.rate, 'note', a.note,
    'responsible_id', a.responsible_id, 'responsible', private.emp_name(a.responsible_id), 'responsible_code', private.emp_code(a.responsible_id),
    'can_mark', (viewer.edit or (a.responsible_id is not null and a.responsible_id = private.my_employee_id())),
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'given', d.given, 'rate', d.rate, 'by', d.marked_by_name, 'at', d.marked_at) order by d.day)
                        from private.office_auto_days d where d.auto_id = a.id and d.day >= m.d0 and d.day < m.d0 + interval '1 month'), '[]'::jsonb),
    'given_days', (select count(*) from private.office_auto_days d where d.auto_id = a.id and d.given and d.day >= m.d0 and d.day < m.d0 + interval '1 month'),
    'amount', coalesce((select sum(d.rate) from private.office_auto_days d where d.auto_id = a.id and d.given and d.day >= m.d0 and d.day < m.d0 + interval '1 month'), 0)
  ) order by a.name), '[]'::jsonb)
  from private.office_autos a, m, viewer
  where a.property_id = p_property and a.archived_at is null and auth.uid() is not null
    and (viewer.viewall or (a.responsible_id is not null and a.responsible_id = private.my_employee_id()))
$$;

-- "My autos" for the person responsible (their own panel): this month's days and today's answer.
create function public.office_my_autos()
returns jsonb
language sql stable security definer set search_path = '' as $$
  with m as (select date_trunc('month', current_date)::date as d0)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'name', a.name, 'rate', a.rate, 'property_id', a.property_id, 'property', p.name, 'hub', private.hub_name(p.hub_id),
    'today', (select d.given from private.office_auto_days d where d.auto_id = a.id and d.day = current_date),
    'yesterday', (select d.given from private.office_auto_days d where d.auto_id = a.id and d.day = current_date - 1),
    'given_days', (select count(*) from private.office_auto_days d where d.auto_id = a.id and d.given and d.day >= m.d0 and d.day < m.d0 + interval '1 month'),
    'amount', coalesce((select sum(d.rate) from private.office_auto_days d where d.auto_id = a.id and d.given and d.day >= m.d0 and d.day < m.d0 + interval '1 month'), 0)
  ) order by p.name, a.name), '[]'::jsonb)
  from private.office_autos a join public.office_properties p on p.id = a.property_id and p.archived_at is null, m
  where auth.uid() is not null and a.archived_at is null and a.responsible_id is not null and a.responsible_id = private.my_employee_id()
$$;

-- For the monthly page: what each auto garage earned this month (days given and the ৳), only for places the caller may view.
create function public.office_auto_month_totals(p_month date)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with m as (select date_trunc('month', coalesce(p_month, current_date))::date as d0)
  select coalesce(jsonb_agg(jsonb_build_object('property_id', t.property_id, 'autos', t.autos, 'given_days', t.given_days, 'amount', t.amount)), '[]'::jsonb)
  from (
    select a.property_id, count(distinct a.id) autos,
           count(*) filter (where d.given) given_days,
           coalesce(sum(d.rate) filter (where d.given), 0) amount
    from private.office_autos a
    left join private.office_auto_days d on d.auto_id = a.id and d.day >= (select d0 from m) and d.day < (select d0 from m) + interval '1 month'
    where a.archived_at is null and auth.uid() is not null and private.office_can('office.property.view', a.property_id)
    group by a.property_id
  ) t
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.office_auto_save(uuid, text, numeric, uuid, text, text, uuid)', 'public.office_auto_archive(uuid, text)',
    'public.office_auto_mark(uuid, date, boolean)', 'public.office_autos(uuid, date)', 'public.office_my_autos()', 'public.office_auto_month_totals(date)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
