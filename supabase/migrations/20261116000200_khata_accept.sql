-- =====================================================================
--  হিসাব খাতা: নিজের খাতা -> সাবমিট -> হাবের খাতায় Accept -> ডেইলি হিসাবের খাতা
--
--  Each person's part of a hub's sheet is their own "khata". After it is
--  submitted, someone who may write on the hub's sheet accepts it (several
--  at once is fine; one's own too). "Open the daily sheet" (da_check) now adds
--  up only the accepted khatas: with fewer accepted than the hub needs, or a
--  khata left out, a reason must be written and the names left out are kept.
--  The day is then closed through the bank deposit (da_bank_done, as before).
--
--  Additive: three columns on da_sheet_collectors and one on da_sessions, one
--  trigger, one new function; da_collectors, da_check and da_flow_list are
--  re-created.
--
--  Rollback: drop da_parts_accept and the trigger da_collectors_unaccept with
--  its function; re-run da_collectors, da_check and da_flow_list from
--  20261116000100_sheet_check_flow.sql; the new columns may stay.
-- =====================================================================

alter table public.da_sheet_collectors add column if not exists accepted_at timestamptz;
alter table public.da_sheet_collectors add column if not exists accepted_by uuid;
alter table public.da_sheet_collectors add column if not exists accepted_by_name text;
alter table public.da_sessions add column if not exists check_left text;

-- A khata that goes back to draft (its person writes again, or it is reopened) is no longer accepted.
create or replace function private.da_collectors_unaccept() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.closed_at is null then
    new.accepted_at := null; new.accepted_by := null; new.accepted_by_name := null;
  end if;
  return new;
end $$;
drop trigger if exists da_collectors_unaccept on public.da_sheet_collectors;
create trigger da_collectors_unaccept before update on public.da_sheet_collectors
  for each row execute function private.da_collectors_unaccept();

drop function if exists public.da_collectors(uuid);
create or replace function public.da_collectors(p_session uuid)
returns table (user_id uuid, name text, code text, closed_at timestamptz, note text, created_at timestamptz,
               riders integer, payments integer, expenses integer, amount numeric, closed_by uuid, closed_by_name text,
               accepted_at timestamptz, accepted_by uuid, accepted_by_name text, expense_amount numeric, payment_amount numeric)
language sql stable security invoker set search_path = '' as $$
  select c.user_id, c.name, c.code, c.closed_at, c.note, c.created_at,
         (select count(*)::int from public.da_rider_lines r where r.session_id = c.session_id and r.created_by = c.user_id and r.removed_at is null),
         (select count(*)::int from public.da_merchant_payments m where m.session_id = c.session_id and m.created_by = c.user_id and m.removed_at is null),
         (select count(*)::int from public.da_expenses x where x.session_id = c.session_id and x.created_by = c.user_id and x.removed_at is null),
         coalesce((select sum(r.amount) from public.da_rider_lines r where r.session_id = c.session_id and r.created_by = c.user_id and r.removed_at is null), 0),
         c.closed_by, c.closed_by_name, c.accepted_at, c.accepted_by, c.accepted_by_name,
         coalesce((select sum(x.amount) from public.da_expenses x where x.session_id = c.session_id and x.created_by = c.user_id and x.removed_at is null), 0),
         coalesce((select sum(m.amount) from public.da_merchant_payments m where m.session_id = c.session_id and m.created_by = c.user_id and m.removed_at is null), 0)
  from public.da_sheet_collectors c
  where c.session_id = p_session
  order by c.closed_at nulls first, c.created_at
$$;

-- Accept (or take back the acceptance of) submitted khatas, several at once.
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

-- "Open the daily sheet": the accepted khatas are added up and kept.
create or replace function public.da_check(p_session uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.da_sessions := private.da_require_edit(p_session);
  v_needed integer := private.da_collectors_needed(s.hub_id);
  v_done integer; v_open integer; v_left text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_tot jsonb;
begin
  select count(*) filter (where accepted_at is not null), count(*) filter (where accepted_at is null),
         string_agg(coalesce(name, '—'), ', ') filter (where accepted_at is null)
    into v_done, v_open, v_left from public.da_sheet_collectors where session_id = s.id;
  if v_done = 0 then raise exception 'আগে অন্তত একটি খাতা Accept করুন।' using errcode = '22023'; end if;
  if v_open > 0 and coalesce(private.setting_text('da.close_needs_all'), 'false') = 'true' then
    raise exception 'সব খাতা Accept না হলে ডেইলি হিসাবের খাতা খোলা যাবে না (বাকি: %)।', v_left using errcode = '22023';
  end if;
  if (v_done < v_needed or v_open > 0) and v_note is null then
    raise exception 'এই হাবে % জনের খাতা লাগে, Accept হয়েছে % জনের%। কারণ লিখে খুলুন।',
      v_needed, v_done, case when v_open > 0 then ' (বাদ পড়ছে: ' || v_left || ')' else '' end using errcode = '22023';
  end if;
  with ok as (select user_id from public.da_sheet_collectors where session_id = s.id and accepted_at is not null),
       r as (select * from public.da_rider_lines where session_id = s.id and removed_at is null and created_by in (select user_id from ok)),
       m as (select * from public.da_merchant_payments where session_id = s.id and removed_at is null and created_by in (select user_id from ok)),
       x as (select * from public.da_expenses where session_id = s.id and removed_at is null and created_by in (select user_id from ok))
  select jsonb_build_object(
    'riders', (select count(*) from r), 'rider_amount', coalesce((select sum(amount) from r), 0),
    'collected', coalesce((select sum(paid_amount) from r), 0), 'due', coalesce((select sum(due) from r), 0),
    'mobile_banking', coalesce((select sum(mobile_banking) from r), 0),
    'delivery', coalesce((select sum(delivery_qty) from r), 0), 'pickup', coalesce((select sum(pickup_qty) from r), 0),
    'payments', (select count(*) from m), 'payment_amount', coalesce((select sum(amount) from m), 0),
    'expenses', (select count(*) from x), 'expense_amount', coalesce((select sum(amount) from x), 0),
    'notes_in', coalesce((select sum(amount) from public.da_cash_notes where session_id = s.id and removed_at is null), 0),
    'khatas', v_done)
    into v_tot;
  update public.da_sessions
     set closed_at = now(), closed_by = auth.uid(), closed_totals = v_tot,
         check_note = v_note, check_done = v_done, check_needed = v_needed, check_left = v_left,
         report_ok_at = null, report_ok_by = null, report_ok_by_name = null, report_total = null, report_diff = null, report_note = null
   where id = s.id;
  perform private.da_event(s.id, 'note', 'Daily sheet opened from ' || v_done || ' khata'
    || coalesce(' (left out: ' || v_left || ' — ' || v_note || ')', coalesce(': ' || v_note, '')), true);
  return v_tot || jsonb_build_object('needed', v_needed, 'done', v_done, 'open', v_open);
end $$;

drop function if exists public.da_flow_list(date, date, uuid);
create or replace function public.da_flow_list(p_from date, p_to date, p_hub uuid default null)
returns table (session_id uuid, hub_id uuid, needed integer, people integer, submitted integer, accepted integer,
               checked_at timestamptz, report_ok_at timestamptz, report_diff numeric, bank_done_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select s.id, s.hub_id, private.da_collectors_needed(s.hub_id),
         (select count(*)::int from public.da_sheet_collectors c where c.session_id = s.id),
         (select count(*)::int from public.da_sheet_collectors c where c.session_id = s.id and c.closed_at is not null),
         (select count(*)::int from public.da_sheet_collectors c where c.session_id = s.id and c.accepted_at is not null),
         s.closed_at, s.report_ok_at, s.report_diff, s.bank_done_at
  from public.da_sessions s
  where s.account_date between p_from and p_to and (p_hub is null or s.hub_id = p_hub)
    and private.has_permission('da.sheet.view', s.zone_id, s.hub_id)
$$;

revoke all on function private.da_collectors_unaccept() from public, anon, authenticated;
revoke all on function public.da_collectors(uuid), public.da_parts_accept(uuid, uuid[], boolean), public.da_check(uuid, text),
  public.da_flow_list(date, date, uuid) from public, anon;
grant execute on function public.da_collectors(uuid), public.da_parts_accept(uuid, uuid[], boolean), public.da_check(uuid, text),
  public.da_flow_list(date, date, uuid) to authenticated;
