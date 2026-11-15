-- =====================================================================
--  স্টোর / আইটি অর্ডার (orders to Store or IT)
--  An order is an issue of kind 'store' or 'it': a hub writes what it needs,
--  the Store / IT in-charge gets it as a job, marks it sent ("solved"), and
--  the person who ordered confirms it arrived ("approved"). There is no
--  approval step before sending (to be decided later).
--
--  Who the in-charge is: system_settings 'issue.store_assignee' and
--  'issue.it_assignee' hold an employee id, set by someone with
--  system.settings.configure.
--
--  Additive only: one check is widened, issue_create learns the two kinds,
--  two new functions, and the person a job was given to may see / add its
--  pictures even when they are posted at another hub. No existing row changes.
--
--  Rollback: re-run issue_create from 20261115001200_hub_issues.sql, drop the
--  two issue_order_* functions and the two private.issue_photo_* helpers,
--  restore the two storage policies from that file, and put the old list
--  back on issues_kind_check (only once no row uses 'store' / 'it').
-- =====================================================================

alter table public.issues drop constraint issues_kind_check;
alter table public.issues add constraint issues_kind_check
  check (kind in ('parcel', 'vehicle', 'staff', 'cash', 'other', 'store', 'it'));

-- The in-charge of a kind of order, when one is set and still active.
create or replace function private.issue_order_assignee(p_kind text) returns uuid
language sql stable security definer set search_path = '' as $$
  select e.id
  from public.system_settings s
  join public.employees e on e.id::text = (s.value #>> '{}')
  where s.key = 'issue.' || p_kind || '_assignee' and e.archived_at is null and e.status = 'active'
$$;

-- ---------------------------------------------------------------------
--  Raise an issue / give a job / place an order
--  (same as before, plus: kinds 'store' and 'it' go to their in-charge)
-- ---------------------------------------------------------------------
create or replace function public.issue_create(
  p_hub uuid, p_title text, p_body text default null, p_kind text default 'parcel',
  p_parcel_ref text default null, p_photo text default null, p_assignee uuid default null,
  p_due timestamptz default null, p_priority text default 'normal')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_zone uuid := private.hub_zone(p_hub);
  v_parcel public.parcels;
  v_ass public.employees;
  v_ref text := nullif(trim(coalesce(p_parcel_ref, '')), '');
  v_id uuid; v_no text; v_auto boolean := false; v_label text;
  v_order boolean := p_kind in ('store', 'it');
  v_what text := case p_kind when 'store' then 'স্টোর অর্ডার' when 'it' then 'আইটি অর্ডার' end;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  if v_zone is null then raise exception 'হাব বেছে নিন' using errcode = '22023'; end if;
  if not private.in_hub_group(p_hub) then raise exception 'এই হাবের ইস্যু দেওয়ার অনুমতি নেই' using errcode = '42501'; end if;
  if p_kind not in ('parcel', 'vehicle', 'staff', 'cash', 'other', 'store', 'it') or p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'ধরন বা গুরুত্ব ঠিক নয়' using errcode = '22023'; end if;
  if v_order then
    if coalesce(trim(p_title), '') = '' and coalesce(trim(p_body), '') = '' then raise exception 'কী কী লাগবে লিখুন' using errcode = '22023'; end if;
  elsif coalesce(trim(p_title), '') = '' and v_ref is null and p_photo is null then
    raise exception 'কী সমস্যা তা লিখুন, পার্সেল আইডি দিন বা ছবি দিন' using errcode = '22023';
  end if;

  if v_ref is not null then
    select * into v_parcel from public.parcels where tracking_no = v_ref and hub_id = p_hub;
  end if;
  if p_assignee is not null then
    select * into v_ass from public.employees where id = p_assignee and archived_at is null and status = 'active';
    if not found then raise exception 'যাকে দেওয়া হচ্ছে তাকে পাওয়া যায়নি বা সে সক্রিয় নয়' using errcode = 'P0002'; end if;
  elsif v_order then
    select * into v_ass from public.employees where id = private.issue_order_assignee(p_kind);
  elsif v_parcel.assigned_rider_id is not null then
    select * into v_ass from public.employees where id = v_parcel.assigned_rider_id and archived_at is null;
    v_auto := found;
  end if;

  perform set_config('app.change_reason', case when v_order then v_what else 'ইস্যু তৈরি' end, true);
  insert into public.issues (hub_id, zone_id, kind, title, body, priority, parcel_ref, parcel_id, photo_path,
                             assignee_id, assigned_by, assigned_by_name, assigned_by_nodi, due_at)
  values (p_hub, v_zone, p_kind,
          coalesce(nullif(trim(coalesce(p_title, '')), ''),
                   case when v_order then v_what when v_ref is not null then 'পার্সেল ' || v_ref else 'ছবি থেকে ইস্যু' end),
          nullif(trim(coalesce(p_body, '')), ''), p_priority, v_ref, v_parcel.id, p_photo,
          v_ass.id, auth.uid(), private.my_display_name(), v_auto, p_due)
  returning id, issue_no into v_id, v_no;
  perform private.issue_log(v_id, 'created', coalesce(p_body, p_title));
  if v_ass.id is not null then
    perform private.issue_log(v_id, case when v_auto then 'assigned_by_nodi' else 'assigned' end, v_ass.full_name || coalesce(' (' || v_ass.employee_code || ')', ''));
  end if;

  v_label := v_no || ' · ' || (select title from public.issues where id = v_id);
  perform private.hub_post_add(p_hub, 'issue',
    case when v_order and v_ass.id is null then 'নতুন ' || v_what || ' — দায়িত্বে কাউকে ঠিক করা নেই'
         when v_order then v_what || ' দেওয়া হলো: ' || v_ass.full_name
         when v_ass.id is null then 'নতুন ইস্যু — এখনো কাউকে দেওয়া হয়নি'
         when v_auto then 'নদী AI পার্সেলের রাইডার দেখে কাজটি দিল: ' || v_ass.full_name
         else 'কাজ দেওয়া হলো: ' || v_ass.full_name end,
    v_id, v_auto, p_photo);
  perform private.notify(v_ass.profile_id,
    case when v_order then 'আপনার কাছে একটি ' || v_what || ' এসেছে' else 'আপনাকে একটি কাজ দেওয়া হয়েছে' end,
    v_label, '/app/issues?id=' || v_id, 'issue');
  return v_id;
end $$;

-- ---------------------------------------------------------------------
--  Who receives Store / IT orders: read (any signed-in person) and set
-- ---------------------------------------------------------------------
create or replace function public.issue_order_incharge()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null then null else (
    select jsonb_object_agg(k, (
      select jsonb_build_object('id', e.id, 'name', e.full_name, 'code', e.employee_code, 'hub', private.hub_name(e.hub_id), 'has_login', e.profile_id is not null)
      from public.employees e where e.id = private.issue_order_assignee(k)))
    from unnest(array['store', 'it']) k) end
$$;

create or replace function public.issue_order_incharge_set(p_kind text, p_employee uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission('system.settings.configure') then
    raise exception 'অর্ডার কে পাবেন তা ঠিক করার অনুমতি নেই' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('store', 'it') then raise exception 'ধরন ঠিক নয়' using errcode = '22023'; end if;
  if p_employee is not null and not exists (select 1 from public.employees where id = p_employee and archived_at is null and status = 'active') then
    raise exception 'কর্মীকে পাওয়া যায়নি বা সক্রিয় নয়' using errcode = 'P0002'; end if;
  perform set_config('app.change_reason', 'অর্ডারের দায়িত্ব বদল', true);
  insert into public.system_settings (key, value, description, is_public)
  values ('issue.' || p_kind || '_assignee', coalesce(to_jsonb(p_employee::text), 'null'::jsonb),
          'Employee who receives ' || p_kind || ' orders', false)
  on conflict (key) do update set value = excluded.value;
end $$;

-- ---------------------------------------------------------------------
--  Pictures: the person a job was given to may be posted at another hub
--  (the Store / IT in-charge always is). They may see the pictures of their
--  own jobs, and add one while the job is still theirs to finish.
-- ---------------------------------------------------------------------
create or replace function private.issue_photo_readable(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.in_hub_group(private.issue_object_hub(p_name))
      or exists (select 1 from public.issues i
                 where (i.photo_path = p_name or i.solve_photo = p_name) and i.assignee_id = private.my_employee_id())
$$;
create or replace function private.issue_photo_writable(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.in_hub_group(private.issue_object_hub(p_name))
      or exists (select 1 from public.issues i
                 where i.hub_id = private.issue_object_hub(p_name) and i.assignee_id = private.my_employee_id()
                   and i.status in ('open', 'in_progress'))
$$;
drop policy if exists issue_photos_read on storage.objects;
create policy issue_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'issue-photos' and private.issue_photo_readable(name));
drop policy if exists issue_photos_write on storage.objects;
create policy issue_photos_write on storage.objects for insert to authenticated
  with check (bucket_id = 'issue-photos' and private.issue_photo_writable(name));

-- ---------------------------------------------------------------------
revoke all on function public.issue_create(uuid, text, text, text, text, text, uuid, timestamptz, text) from public, anon;
grant execute on function public.issue_create(uuid, text, text, text, text, text, uuid, timestamptz, text) to authenticated;
revoke all on function public.issue_order_incharge(), public.issue_order_incharge_set(text, uuid) from public, anon;
grant execute on function public.issue_order_incharge(), public.issue_order_incharge_set(text, uuid) to authenticated;
revoke all on function private.issue_order_assignee(text), private.issue_photo_readable(text), private.issue_photo_writable(text) from public, anon;
grant execute on function private.issue_photo_readable(text), private.issue_photo_writable(text) to authenticated;
revoke all on function private.issue_order_assignee(text) from authenticated;
