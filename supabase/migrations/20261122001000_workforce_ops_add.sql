-- =====================================================================
-- আজকের কাজের হিসাব: এক ক্লিকে যোগ / The four daily numbers: one tap adds, every tap counts
--
-- Owner (19 Nov 2026): "এক ক্লিক এ সাবমিট দিবে, যত বার দিবে তত বার কাউন্ট করবে! সাবমিট কত বার আর মোট কত?"
--
--  * wf_ops_add(pickup, pickup_return, delivery, delivery_return, note, date): ADDS the numbers to the person's row for that
--    date (one row per person per date stays the rule; the row is the day's total). Every tap is one history line:
--    the first one 'submitted', each later one 'added' (from = total before, to = total after, so the tap = to − from).
--    An empty box is sent as 0. A tap with all four zero is refused once the day already has numbers (nothing to add);
--    the first tap of a day may be all zero ("আজ কাজ নেই").
--    The day total of each number may not pass 100000. Same date rules and manager-correction lock as wf_ops_submit.
--  * wf_ops_taps(date): the person's own taps for one date: count, the total, and each tap (newest first).
--  * wf_ops_history.action may now also be 'added'.
--  * wf_ops_submit (replace the numbers) is unchanged; the staff card now calls wf_ops_add.
--
-- Rollback: drop function public.wf_ops_add(integer, integer, integer, integer, text, date), public.wf_ops_taps(date);
--           the 'added' history lines can stay (the old check is only needed again if they are removed).
-- =====================================================================

do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.wf_ops_history'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%action%';
  if c is not null and c <> 'wf_ops_history_action_check2' then
    execute format('alter table public.wf_ops_history drop constraint %I', c);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wf_ops_history_action_check2') then
    alter table public.wf_ops_history add constraint wf_ops_history_action_check2 check (action in ('submitted', 'edited', 'corrected', 'added'));
  end if;
end $$;

-- One tap: add the four numbers to the day's total.
create or replace function public.wf_ops_add(p_pickup integer, p_pickup_return integer, p_delivery integer, p_delivery_return integer,
  p_note text default null, p_date date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees; v_today date := private.wf_today(); v_date date := coalesce(p_date, private.wf_today()); v_note text := private.wf_clean(p_note);
  o public.wf_daily_ops; v_id uuid;
  a integer := coalesce(p_pickup, 0); b integer := coalesce(p_pickup_return, 0); c integer := coalesce(p_delivery, 0); d integer := coalesce(p_delivery_return, 0);
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  e := private.wf_me();
  if e.id is null then raise exception 'No active staff profile is linked to your login — আপনার লগইনের সাথে সক্রিয় কর্মী প্রোফাইল যুক্ত নেই' using errcode = '42501'; end if;
  if least(a, b, c, d) < 0 then raise exception 'The numbers must be non-negative — সংখ্যা ০ বা তার বেশি হতে হবে' using errcode = '22023'; end if;
  if greatest(a, b, c, d) > 100000 then raise exception 'The numbers must be at most 100000' using errcode = '22023'; end if;
  if v_date > v_today then raise exception 'A future date cannot be filled yet — আগামী তারিখ' using errcode = '22023'; end if;
  if v_date < v_today - private.wf_backdate() then
    raise exception 'You may not change an older day — ask your manager to correct it (পুরোনো দিনের সংখ্যা ম্যানেজার সংশোধন করবেন)' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('wf:' || e.id::text, 0));
  select * into o from public.wf_daily_ops x where x.employee_id = e.id and x.work_date = v_date;
  if o.id is not null and exists (select 1 from public.wf_ops_history h where h.entry_id = o.id and h.action = 'corrected') then
    raise exception 'You may not change these numbers: your manager corrected them (ম্যানেজার সংশোধন করেছেন — আবার বদলাতে ম্যানেজারকে বলুন)' using errcode = '42501';
  end if;

  if o.id is null then
    insert into public.wf_daily_ops (employee_id, hub_id, zone_id, work_date, pickup, pickup_return, delivery, delivery_return, note)
    values (e.id, e.hub_id, private.hub_zone(e.hub_id), v_date, a, b, c, d, v_note)
    returning id into v_id;
  else
    if a = 0 and b = 0 and c = 0 and d = 0 then
      raise exception 'Nothing to add: write at least one number — যোগ করার কিছু নেই, অন্তত একটা ঘরে সংখ্যা লিখুন' using errcode = '22023';
    end if;
    if greatest(o.pickup + a, o.pickup_return + b, o.delivery + c, o.delivery_return + d) > 100000 then
      raise exception 'The day total cannot pass 100000 — দিনের মোট ১,০০,০০০ এর বেশি হতে পারে না' using errcode = '22023';
    end if;
    perform set_config('app.wf_action', 'added', true);
    perform set_config('app.wf_note', coalesce(v_note, ''), true);
    update public.wf_daily_ops x
       set pickup = x.pickup + a, pickup_return = x.pickup_return + b, delivery = x.delivery + c, delivery_return = x.delivery_return + d,
           note = coalesce(v_note, x.note), hub_id = e.hub_id, zone_id = private.hub_zone(e.hub_id)
     where x.id = o.id;
    v_id := o.id;
    perform set_config('app.wf_action', '', true);
    perform set_config('app.wf_note', '', true);
  end if;
  return (select private.wf_ops_json(x) from public.wf_daily_ops x where x.id = v_id);
end $$;

-- The person's own taps for one date: how many, the total, and each tap.
create or replace function public.wf_ops_taps(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.employees; v_date date := coalesce(p_date, private.wf_today()); o public.wf_daily_ops; v_taps jsonb;
begin
  if auth.uid() is null then return null; end if;
  e := private.wf_me();
  if e.id is null then return null; end if;
  select * into o from public.wf_daily_ops x where x.employee_id = e.id and x.work_date = v_date;
  if o.id is null then
    return jsonb_build_object('date', v_date, 'count', 0, 'total', null, 'taps', '[]'::jsonb);
  end if;
  -- a tap = one 'submitted' or 'added' line; its numbers are to − from. A manager's or an old "change" line is not a tap.
  select coalesce(jsonb_agg(jsonb_build_object(
           'at', h.at, 'note', h.note,
           'pickup', (h.to_vals ->> 'pickup')::integer - coalesce((h.from_vals ->> 'pickup')::integer, 0),
           'pickup_return', (h.to_vals ->> 'pickup_return')::integer - coalesce((h.from_vals ->> 'pickup_return')::integer, 0),
           'delivery', (h.to_vals ->> 'delivery')::integer - coalesce((h.from_vals ->> 'delivery')::integer, 0),
           'delivery_return', (h.to_vals ->> 'delivery_return')::integer - coalesce((h.from_vals ->> 'delivery_return')::integer, 0))
         order by h.at desc), '[]'::jsonb)
    into v_taps
    from public.wf_ops_history h where h.entry_id = o.id and h.action in ('submitted', 'added');
  return jsonb_build_object('date', v_date, 'count', jsonb_array_length(v_taps),
    'total', jsonb_build_object('pickup', o.pickup, 'pickup_return', o.pickup_return, 'delivery', o.delivery, 'delivery_return', o.delivery_return),
    'taps', v_taps);
end $$;

revoke all on function public.wf_ops_add(integer, integer, integer, integer, text, date) from public, anon;
grant execute on function public.wf_ops_add(integer, integer, integer, integer, text, date) to authenticated, service_role;
revoke all on function public.wf_ops_taps(date) from public, anon;
grant execute on function public.wf_ops_taps(date) to authenticated, service_role;
