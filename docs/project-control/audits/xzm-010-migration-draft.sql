-- Review draft. Approval of assignment and distinct-approver rules is required before promotion.
-- Compare current function definitions and grants with the rollback snapshot before applying.
begin;

create function private.issue_assignment_in_scope(p_issue_hub uuid, p_employee_hub uuid)
returns boolean
language sql stable security invoker set search_path = '' as $$
  select auth.uid() is not null and p_employee_hub is not null and (
    p_employee_hub = p_issue_hub
    or private.has_permission('issue.issue.approve', private.hub_zone(p_employee_hub), p_employee_hub)
  )
$$;
revoke all on function private.issue_assignment_in_scope(uuid, uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.issue_assign(p_id uuid, p_assignee uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare i public.issues; v_ass public.employees;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  select * into i from public.issues where id = p_id for update;
  if not found then raise exception 'ইস্যু পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not coalesce(i.assigned_by = auth.uid() or i.created_by = auth.uid() or private.has_permission('issue.issue.approve', i.zone_id, i.hub_id), false) then
    raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
  if i.status in ('approved', 'cancelled') then raise exception 'এই ইস্যু শেষ হয়ে গেছে' using errcode = 'P0001'; end if;
  select * into v_ass from public.employees where id = p_assignee and archived_at is null and status = 'active';
  if not found then raise exception 'ব্যক্তিকে পাওয়া যায়নি বা সক্রিয় নয়' using errcode = 'P0002'; end if;
  if not private.issue_assignment_in_scope(i.hub_id, v_ass.hub_id)
     and (i.kind not in ('store', 'it') or v_ass.id is distinct from private.issue_order_assignee(i.kind)) then
    raise exception 'এই কর্মীর হাবে দায়িত্ব দেওয়ার অনুমতি নেই' using errcode = '42501';
  end if;
  perform set_config('app.change_reason', 'ইস্যু নতুন করে দেওয়া', true);
  update public.issues set assignee_id = p_assignee, assigned_by = auth.uid(), assigned_by_name = private.my_display_name(),
         assigned_by_nodi = false, status = 'open', last_nudge_at = null,
         solved_at = null, solved_note = null, solve_photo = null,
         approved_at = null, approved_by = null, approve_note = null where id = p_id;
  perform private.issue_log(p_id, 'assigned', v_ass.full_name || coalesce(' (' || v_ass.employee_code || ')', '') || coalesce(' — ' || nullif(trim(coalesce(p_note, '')), ''), ''));
  perform private.hub_post_add(i.hub_id, 'issue', 'কাজ দেওয়া হলো: ' || v_ass.full_name, p_id);
  perform private.notify(v_ass.profile_id, 'আপনাকে একটি কাজ দেওয়া হয়েছে', i.issue_no || ' · ' || i.title, '/app/issues?id=' || p_id, 'issue');
end $function$;

CREATE OR REPLACE FUNCTION public.issue_create(p_hub uuid, p_title text, p_body text DEFAULT NULL::text, p_kind text DEFAULT 'parcel'::text, p_parcel_ref text DEFAULT NULL::text, p_photo text DEFAULT NULL::text, p_assignee uuid DEFAULT NULL::uuid, p_due timestamp with time zone DEFAULT NULL::timestamp with time zone, p_priority text DEFAULT 'normal'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    if not private.issue_assignment_in_scope(p_hub, v_ass.hub_id)
       and (not v_order or v_ass.id is distinct from private.issue_order_assignee(p_kind)) then
      raise exception 'এই কর্মীর হাবে দায়িত্ব দেওয়ার অনুমতি নেই' using errcode = '42501';
    end if;
  elsif v_order then
    select * into v_ass from public.employees where id = private.issue_order_assignee(p_kind);
  elsif v_parcel.assigned_rider_id is not null then
    select * into v_ass from public.employees where id = v_parcel.assigned_rider_id and archived_at is null and status = 'active'
      and private.issue_assignment_in_scope(p_hub, hub_id);
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
end $function$;

CREATE OR REPLACE FUNCTION public.issue_act(p_id uuid, p_action text, p_note text DEFAULT NULL::text, p_photo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  i public.issues;
  v_me uuid := private.my_employee_id();
  v_is_assignee boolean; v_is_giver boolean; v_can_review boolean; v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_ass_profile uuid;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  select * into i from public.issues where id = p_id for update;
  if not found then raise exception 'ইস্যু পাওয়া যায়নি' using errcode = 'P0002'; end if;
  v_is_assignee := coalesce(i.assignee_id = v_me, false);
  v_is_giver := coalesce(i.assigned_by = auth.uid() or i.created_by = auth.uid() or private.has_permission('issue.issue.approve', i.zone_id, i.hub_id), false);
  v_can_review := coalesce(i.assigned_by = auth.uid() or i.created_by = auth.uid()
    or (i.kind not in ('store', 'it') and private.has_permission('issue.issue.approve', i.zone_id, i.hub_id)), false);
  if i.status in ('approved', 'cancelled') then raise exception 'এই ইস্যু শেষ হয়ে গেছে' using errcode = 'P0001'; end if;
  select profile_id into v_ass_profile from public.employees where id = i.assignee_id;

  perform set_config('app.change_reason', 'ইস্যু: ' || p_action, true);
  if p_action = 'start' then
    if not v_is_assignee then raise exception 'শুধু যাকে কাজটি দেওয়া হয়েছে সে শুরু করতে পারবে' using errcode = '42501'; end if;
    if i.status <> 'open' then raise exception 'কাজ আগেই শুরু হয়েছে' using errcode = 'P0001'; end if;
    update public.issues set status = 'in_progress' where id = p_id;
    perform private.issue_log(p_id, 'started', v_note);
    perform private.hub_post_add(i.hub_id, 'issue', 'কাজ শুরু করেছে', p_id);
    perform private.notify(i.assigned_by, 'কাজ শুরু হয়েছে', i.issue_no || ' · ' || i.title, '/app/issues?id=' || p_id, 'issue');

  elsif p_action = 'solve' then
    if not v_is_assignee then raise exception 'শুধু যাকে কাজটি দেওয়া হয়েছে সে সমাধান জানাতে পারবে' using errcode = '42501'; end if;
    if i.status not in ('open', 'in_progress') then raise exception 'সমাধান ইতিমধ্যে জমা হয়েছে' using errcode = 'P0001'; end if;
    if v_note is null and p_photo is null then raise exception 'কী করা হয়েছে লিখুন বা ছবি দিন' using errcode = '22023'; end if;
    update public.issues set status = 'solved', solved_at = now(), solved_note = v_note, solve_photo = p_photo where id = p_id;
    perform private.issue_log(p_id, 'solved', v_note);
    perform private.hub_post_add(i.hub_id, 'issue', 'সমাধান হয়েছে — যিনি কাজ দিয়েছেন তার চেক বাকি' || coalesce(': ' || v_note, ''), p_id, false, p_photo);
    perform private.notify(i.assigned_by, 'সমাধান হয়েছে — চেক করে অনুমোদন দিন', i.issue_no || ' · ' || i.title, '/app/issues?id=' || p_id, 'issue');

  elsif p_action = 'approve' then
    if not v_can_review or v_is_assignee then raise exception 'অন্য অনুমোদিত ব্যক্তি যাচাই করবেন' using errcode = '42501'; end if;
    if i.status <> 'solved' then raise exception 'আগে সমাধান জানাতে হবে' using errcode = 'P0001'; end if;
    update public.issues set status = 'approved', approved_at = now(), approved_by = auth.uid(), approve_note = v_note where id = p_id;
    perform private.issue_log(p_id, 'approved', v_note);
    perform private.hub_post_add(i.hub_id, 'issue', 'চেক করে অনুমোদন দেওয়া হয়েছে ✔', p_id);
    perform private.notify(v_ass_profile, 'আপনার কাজ অনুমোদিত হয়েছে', i.issue_no || ' · ' || i.title, '/app/issues?id=' || p_id, 'issue');

  elsif p_action = 'reopen' then
    if not v_can_review or v_is_assignee then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
    if i.status <> 'solved' then raise exception 'শুধু সমাধান হয়েছে এমন ইস্যু ফেরত পাঠানো যায়' using errcode = 'P0001'; end if;
    if v_note is null then raise exception 'ফেরত পাঠানোর কারণ লিখুন' using errcode = '22023'; end if;
    update public.issues set status = 'in_progress', reopen_count = reopen_count + 1, solved_at = null, solved_note = null, solve_photo = null, last_nudge_at = null where id = p_id;
    perform private.issue_log(p_id, 'reopened', v_note);
    perform private.hub_post_add(i.hub_id, 'issue', 'ঠিক হয়নি — আবার করতে বলা হলো: ' || v_note, p_id);
    perform private.notify(v_ass_profile, 'কাজটি আবার করতে বলা হয়েছে', i.issue_no || ' · ' || v_note, '/app/issues?id=' || p_id, 'issue');

  elsif p_action = 'cancel' then
    if not v_is_giver then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
    if v_note is null then raise exception 'বাতিলের কারণ লিখুন' using errcode = '22023'; end if;
    update public.issues set status = 'cancelled' where id = p_id;
    perform private.issue_log(p_id, 'cancelled', v_note);
    perform private.hub_post_add(i.hub_id, 'issue', 'ইস্যু বাতিল: ' || v_note, p_id);
    perform private.notify(v_ass_profile, 'ইস্যু বাতিল হয়েছে', i.issue_no || ' · ' || v_note, '/app/issues?id=' || p_id, 'issue');

  else
    raise exception 'ভুল কাজ' using errcode = '22023';
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.issue_panels()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with me as (select auth.uid() uid, private.my_employee_id() emp),
  v as (
    select i.id, i.issue_no, i.title, i.kind, i.priority, i.status, i.hub_id, private.hub_name(i.hub_id) hub, i.parcel_ref, i.due_at, i.created_at, i.solved_at,
           i.reopen_count, i.assigned_by_name, i.assigned_by_nodi, private.emp_name(i.assignee_id) assignee, private.emp_code(i.assignee_id) assignee_code,
           coalesce(i.assignee_id = me.emp, false) is_mine, coalesce(i.assigned_by = me.uid or i.created_by = me.uid, false) is_giver,
           not coalesce(i.assignee_id = me.emp, false) and coalesce((i.assigned_by = auth.uid() or i.created_by = auth.uid() or (i.kind not in ('store', 'it') and private.has_permission('issue.issue.approve', i.zone_id, i.hub_id))), false) can_review,
           (i.due_at is not null and i.due_at < now() and i.status in ('open', 'in_progress')) overdue
    from public.issues i, me
    where i.status in ('open', 'in_progress', 'solved'))
  select jsonb_build_object(
    'mine',     coalesce((select jsonb_agg(to_jsonb(v) order by v.overdue desc, v.created_at) from v where is_mine and status in ('open', 'in_progress')), '[]'::jsonb),
    'to_check', coalesce((select jsonb_agg(to_jsonb(v) order by v.solved_at) from v where can_review and not is_mine and status = 'solved'), '[]'::jsonb),
    'given',    coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at) from v where is_giver and status in ('open', 'in_progress')), '[]'::jsonb),
    'waiting_for_check_of_mine', coalesce((select jsonb_agg(to_jsonb(v) order by v.solved_at) from v where is_mine and status = 'solved'), '[]'::jsonb),
    'hub',      coalesce((select jsonb_agg(to_jsonb(v) order by v.overdue desc, v.created_at) from v where not is_mine and not is_giver), '[]'::jsonb))
$function$;

CREATE OR REPLACE FUNCTION public.issue_detail(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'issue', to_jsonb(i) || jsonb_build_object('hub', private.hub_name(i.hub_id), 'assignee', private.emp_name(i.assignee_id), 'assignee_code', private.emp_code(i.assignee_id),
        'is_mine', coalesce(i.assignee_id = private.my_employee_id(), false),
        'is_giver', coalesce(i.assigned_by = auth.uid() or i.created_by = auth.uid(), false),
        'can_review', not coalesce(i.assignee_id = private.my_employee_id(), false) and coalesce((i.assigned_by = auth.uid() or i.created_by = auth.uid() or (i.kind not in ('store', 'it') and private.has_permission('issue.issue.approve', i.zone_id, i.hub_id))), false),
        'status_bn', private.issue_status_label(i.status)),
    'events', coalesce((select jsonb_agg(to_jsonb(x) order by x.at) from public.issue_events x where x.issue_id = i.id), '[]'::jsonb),
    'parcel', (select to_jsonb(p) - 'created_by' - 'updated_by' from public.parcels p where p.id = i.parcel_id))
  from public.issues i
  where i.id = p_id
$function$;

commit;
