-- =====================================================================
--  হিসাব খাতা: ড্রাফট -> সাবমিট -> হিসাব চেক -> Steadfast রিপোর্ট ওকে -> মেইন শীট
--
--  One sheet per hub per day stays as it is. Each person taking the accounts
--  has a "part" on it: a draft until it is submitted (closed). A hub has a
--  number of people who should take the accounts (settings).
--    1. A part is submitted by its own person, or by someone who may write
--       on the hub's sheet (the manager) on their behalf.
--    2. "Check the accounts" closes the day (the totals are kept). With fewer
--       submitted parts than the hub's number, or a part still in draft, a
--       reason must be written.
--    3. The main site's daily report (ID + amount, already kept as report IDs)
--       is confirmed: when its total differs from the sheet's total a reason
--       must be written. After that the main sheet is ready.
--
--  Additive only: new settings, new columns, new functions; da_collectors and
--  da_reopen_day are re-created with one more column / one more reset.
--
--  Rollback: drop the functions da_hub_collectors_set, da_close_part_for,
--  da_check, da_report_ok, da_report_ok_undo, da_flow_list and
--  private.da_collectors_needed; re-run da_collectors and da_reopen_day from
--  20261113002500_sheet_made_easy.sql; the new columns and the two settings
--  may stay (nothing else reads them).
-- =====================================================================

insert into public.system_settings (key, value, description) values
  ('da.hub_collectors', '{}',
   'Daily accounts: how many people take the accounts at each hub (hub id -> number)'),
  ('da.collectors_default', '1',
   'Daily accounts: how many people take the accounts at a hub that has no number of its own')
on conflict (key) do nothing;

alter table public.da_sheet_collectors add column if not exists closed_by uuid;
alter table public.da_sheet_collectors add column if not exists closed_by_name text;

alter table public.da_sessions add column if not exists check_note text;
alter table public.da_sessions add column if not exists check_done integer;
alter table public.da_sessions add column if not exists check_needed integer;
alter table public.da_sessions add column if not exists report_ok_at timestamptz;
alter table public.da_sessions add column if not exists report_ok_by uuid;
alter table public.da_sessions add column if not exists report_ok_by_name text;
alter table public.da_sessions add column if not exists report_total numeric(14,2);
alter table public.da_sessions add column if not exists report_diff numeric(14,2);
alter table public.da_sessions add column if not exists report_note text;

-- How many people should take the accounts at a hub.
create or replace function private.da_collectors_needed(p_hub uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select greatest(1, least(50, coalesce(
    nullif((select value ->> p_hub::text from public.system_settings where key = 'da.hub_collectors'), '')::integer,
    nullif(private.setting_text('da.collectors_default'), '')::integer, 1)))
$$;

-- Settings: the number for one hub (null = use the default again).
create or replace function public.da_hub_collectors_set(p_hub uuid, p_count integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission('da.settings.configure') then
    raise exception 'Not authorised to change daily account settings.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.hubs where id = p_hub) then
    raise exception 'হাব পাওয়া যায়নি।' using errcode = 'P0002';
  end if;
  if p_count is not null and p_count not between 1 and 50 then
    raise exception 'সংখ্যাটি ১ থেকে ৫০-এর মধ্যে দিন।' using errcode = '22023';
  end if;
  perform set_config('app.change_reason', 'হাবে কতজন হিসাব নেবেন', true);
  update public.system_settings
     set value = case when p_count is null then value - p_hub::text
                      else value || jsonb_build_object(p_hub::text, p_count) end
   where key = 'da.hub_collectors';
end $$;

-- The people on a sheet, now also with who submitted each part.
drop function if exists public.da_collectors(uuid);
create or replace function public.da_collectors(p_session uuid)
returns table (user_id uuid, name text, code text, closed_at timestamptz, note text, created_at timestamptz,
               riders integer, payments integer, expenses integer, amount numeric, closed_by uuid, closed_by_name text)
language sql stable security invoker set search_path = '' as $$
  select c.user_id, c.name, c.code, c.closed_at, c.note, c.created_at,
         (select count(*)::int from public.da_rider_lines r where r.session_id = c.session_id and r.created_by = c.user_id and r.removed_at is null),
         (select count(*)::int from public.da_merchant_payments m where m.session_id = c.session_id and m.created_by = c.user_id and m.removed_at is null),
         (select count(*)::int from public.da_expenses x where x.session_id = c.session_id and x.created_by = c.user_id and x.removed_at is null),
         coalesce((select sum(r.amount) from public.da_rider_lines r where r.session_id = c.session_id and r.created_by = c.user_id and r.removed_at is null), 0),
         c.closed_by, c.closed_by_name
  from public.da_sheet_collectors c
  where c.session_id = p_session
  order by c.closed_at nulls first, c.created_at
$$;

-- Submit (or take back) the part of someone else on the sheet.
create or replace function public.da_close_part_for(p_session uuid, p_user uuid, p_done boolean default true, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.da_sessions := private.da_require_edit(p_session);
  c public.da_sheet_collectors;
begin
  select * into c from public.da_sheet_collectors where session_id = s.id and user_id = p_user for update;
  if c.id is null then raise exception 'এই ব্যক্তির কোনো ড্রাফট এই খাতায় নেই।' using errcode = 'P0002'; end if;
  update public.da_sheet_collectors
     set closed_at = case when p_done then now() end,
         closed_by = case when p_done then auth.uid() end,
         closed_by_name = case when p_done then private.da_my_name() end,
         note = coalesce(nullif(trim(p_note), ''), note), updated_at = now(), updated_by = auth.uid()
   where id = c.id;
  perform private.da_event(s.id, 'note',
    case when p_done then 'Part of ' else 'Part reopened: ' end || coalesce(c.name, 'someone')
    || case when p_done then ' submitted by ' || coalesce(private.da_my_name(), 'someone') else '' end, false);
end $$;

-- "Check the accounts": the day is closed and its totals kept.
create or replace function public.da_check(p_session uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.da_sessions := private.da_require_edit(p_session);
  v_needed integer := private.da_collectors_needed(s.hub_id);
  v_done integer; v_open integer;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_tot jsonb;
begin
  select count(*) filter (where closed_at is not null), count(*) filter (where closed_at is null)
    into v_done, v_open from public.da_sheet_collectors where session_id = s.id;
  if (v_done < v_needed or v_open > 0) and v_note is null then
    raise exception 'এই হাবে % জনের হিসাব সাবমিট হওয়ার কথা, হয়েছে % জনের%। কারণ লিখে চেক করুন।',
      v_needed, v_done, case when v_open > 0 then ' (ড্রাফটে আছে ' || v_open || ' জন)' else '' end using errcode = '22023';
  end if;
  v_tot := public.da_close_day(s.id, coalesce('Accounts checked: ' || v_note, 'Accounts checked'));
  update public.da_sessions
     set check_note = v_note, check_done = v_done, check_needed = v_needed,
         report_ok_at = null, report_ok_by = null, report_ok_by_name = null, report_total = null, report_diff = null, report_note = null
   where id = s.id;
  return v_tot || jsonb_build_object('needed', v_needed, 'done', v_done, 'open', v_open);
end $$;

-- Reopening the day also takes back the report confirmation.
create or replace function public.da_reopen_day(p_session uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions := private.da_require_edit(p_session);
begin
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Write why.' using errcode = '22023'; end if;
  update public.da_sessions
     set closed_at = null, closed_by = null, check_note = null, check_done = null, check_needed = null,
         report_ok_at = null, report_ok_by = null, report_ok_by_name = null, report_total = null, report_diff = null, report_note = null
   where id = s.id;
  perform private.da_event(s.id, 'note', 'Day reopened: ' || trim(p_reason), false);
end $$;

-- Confirm the main site's daily report against the checked sheet.
create or replace function public.da_report_ok(p_session uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.da_sessions;
  v_total numeric; v_n integer; v_base numeric; v_diff numeric;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into s from public.da_sessions where id = p_session for update;
  if s.id is null then raise exception 'Daily account sheet not found.' using errcode = 'P0002'; end if;
  if not (private.has_permission('da.sheet.create', s.zone_id, s.hub_id) or private.has_permission('da.sheet.approve', s.zone_id, s.hub_id)) then
    raise exception 'Not authorised to change daily accounts of this hub.' using errcode = '42501';
  end if;
  if s.closed_at is null then raise exception 'আগে “হিসাব চেক” করুন।' using errcode = '22023'; end if;
  select count(*), coalesce(sum(amount), 0) into v_n, v_total
    from public.da_report_ids where session_id = s.id and removed_at is null;
  if v_n = 0 then raise exception 'আগে মেইন সাইটের রিপোর্ট আইডি ও টাকা বসান।' using errcode = '22023'; end if;
  v_base := coalesce((s.closed_totals ->> 'rider_amount')::numeric, 0);
  v_diff := v_total - v_base;
  if v_diff <> 0 and v_note is null then
    raise exception 'রিপোর্টের টাকা % আর খাতার টাকা % মিলছে না (পার্থক্য %)। কারণ লিখে ওকে করুন।', v_total, v_base, v_diff using errcode = '22023';
  end if;
  update public.da_sessions
     set report_ok_at = now(), report_ok_by = auth.uid(), report_ok_by_name = private.da_my_name(),
         report_total = v_total, report_diff = v_diff, report_note = v_note
   where id = s.id;
  perform private.da_event(s.id, 'note', 'Report confirmed: ' || v_total || case when v_diff <> 0 then ' (difference ' || v_diff || ': ' || v_note || ')' else '' end, true);
  return jsonb_build_object('total', v_total, 'sheet', v_base, 'diff', v_diff);
end $$;

create or replace function public.da_report_ok_undo(p_session uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions;
begin
  select * into s from public.da_sessions where id = p_session for update;
  if s.id is null then raise exception 'Daily account sheet not found.' using errcode = 'P0002'; end if;
  if not (private.has_permission('da.sheet.create', s.zone_id, s.hub_id) or private.has_permission('da.sheet.approve', s.zone_id, s.hub_id)) then
    raise exception 'Not authorised to change daily accounts of this hub.' using errcode = '42501';
  end if;
  if s.status = 'approved' then raise exception 'This sheet is approved and final. It cannot be changed.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Write why.' using errcode = '22023'; end if;
  update public.da_sessions
     set report_ok_at = null, report_ok_by = null, report_ok_by_name = null, report_total = null, report_diff = null, report_note = null
   where id = s.id;
  perform private.da_event(s.id, 'note', 'Report confirmation taken back: ' || trim(p_reason), false);
end $$;

-- For the list of sheets: where each one stands in the flow.
create or replace function public.da_flow_list(p_from date, p_to date, p_hub uuid default null)
returns table (session_id uuid, hub_id uuid, needed integer, people integer, submitted integer,
               checked_at timestamptz, report_ok_at timestamptz, report_diff numeric)
language sql stable security invoker set search_path = '' as $$
  select s.id, s.hub_id, private.da_collectors_needed(s.hub_id),
         (select count(*)::int from public.da_sheet_collectors c where c.session_id = s.id),
         (select count(*)::int from public.da_sheet_collectors c where c.session_id = s.id and c.closed_at is not null),
         s.closed_at, s.report_ok_at, s.report_diff
  from public.da_sessions s
  where s.account_date between p_from and p_to and (p_hub is null or s.hub_id = p_hub)
    and private.has_permission('da.sheet.view', s.zone_id, s.hub_id)
$$;

revoke all on function private.da_collectors_needed(uuid) from public, anon;
grant execute on function private.da_collectors_needed(uuid) to authenticated;
revoke all on function public.da_hub_collectors_set(uuid, integer), public.da_collectors(uuid), public.da_close_part_for(uuid, uuid, boolean, text),
  public.da_check(uuid, text), public.da_reopen_day(uuid, text), public.da_report_ok(uuid, text), public.da_report_ok_undo(uuid, text),
  public.da_flow_list(date, date, uuid) from public, anon;
grant execute on function public.da_hub_collectors_set(uuid, integer), public.da_collectors(uuid), public.da_close_part_for(uuid, uuid, boolean, text),
  public.da_check(uuid, text), public.da_reopen_day(uuid, text), public.da_report_ok(uuid, text), public.da_report_ok_undo(uuid, text),
  public.da_flow_list(date, date, uuid) to authenticated;
