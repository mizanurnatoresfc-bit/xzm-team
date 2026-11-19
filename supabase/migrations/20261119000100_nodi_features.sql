-- =====================================================================
--  নদী AI — one on/off switch for each part, set on the নদী AI settings page.
--    chat     চ্যাট অ্যাসিস্ট্যান্ট ও ভাসমান বোতাম        (AI, needs the key)
--    teach    হিসাব শিক্ষক                               (AI, needs the key)
--    office   অফিসের AI পরামর্শ (চুক্তি, বিদ্যুৎ, অপারেশন) (AI, needs the key)
--    gaps     "নদী জিজ্ঞেস করছে" — হাজিরা নেই এমন দিনের প্রশ্ন (no AI)
--    followup ইস্যুর ঘণ্টায় ঘণ্টায় মনে করানো               (no AI)
--  The main switch nodi.enabled still turns off every AI part at once; gaps and followup have only their own switch.
--  Every part starts ON, so nothing changes until someone switches a part off.
-- =====================================================================
insert into public.system_settings (key, value, description) values
  ('nodi.features', '{"chat": true, "teach": true, "office": true, "gaps": true, "followup": true}'::jsonb, 'নদী AI-র কোন অংশ চালু')
on conflict (key) do nothing;

create or replace function private.nodi_feature_on(p_feature text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (s.value ->> p_feature) <> 'false' from public.system_settings s where s.key = 'nodi.features'), true)
     and (p_feature in ('gaps', 'followup') or coalesce(private.setting_text('nodi.enabled'), 'true') = 'true')
$$;

-- What the app may show: any signed-in person may read it (it holds no secret).
create or replace function public.nodi_features()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  return jsonb_build_object('chat', private.nodi_feature_on('chat'), 'teach', private.nodi_feature_on('teach'), 'office', private.nodi_feature_on('office'),
    'gaps', private.nodi_feature_on('gaps'), 'followup', private.nodi_feature_on('followup'));
end $$;

-- The switches as set (not counting the main switch), for the settings page.
create or replace function public.nodi_features_configure(p_features jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare k text; v_new jsonb;
begin
  if not private.has_permission('nodi.settings.configure') then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
  if p_features is null or jsonb_typeof(p_features) <> 'object' then raise exception 'সুইচগুলো ঠিকভাবে পাঠানো হয়নি' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_features) loop
    if k not in ('chat', 'teach', 'office', 'gaps', 'followup') then raise exception 'অজানা অংশ: %', k using errcode = '22023'; end if;
    if jsonb_typeof(p_features -> k) <> 'boolean' then raise exception '% — চালু বা বন্ধ দিন', k using errcode = '22023'; end if;
  end loop;
  select coalesce((select value from public.system_settings where key = 'nodi.features'), '{}'::jsonb) || p_features into v_new;
  perform set_config('app.change_reason', 'নদী AI অংশ চালু/বন্ধ', true);
  insert into public.system_settings (key, value, description) values ('nodi.features', v_new, 'নদী AI-র কোন অংশ চালু')
  on conflict (key) do update set value = excluded.value;
end $$;

create or replace function public.nodi_settings()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_permission('nodi.settings.configure') then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
  return jsonb_build_object(
    'enabled', coalesce(private.setting_text('nodi.enabled'), 'true') = 'true',
    'model', private.setting_text('nodi.model'),
    'daily_limit', private.setting_text('nodi.daily_limit')::integer,
    'max_tokens', private.setting_text('nodi.max_tokens')::integer,
    'features', (select jsonb_build_object('chat', coalesce(f ->> 'chat', 'true') = 'true', 'teach', coalesce(f ->> 'teach', 'true') = 'true',
                   'office', coalesce(f ->> 'office', 'true') = 'true', 'gaps', coalesce(f ->> 'gaps', 'true') = 'true', 'followup', coalesce(f ->> 'followup', 'true') = 'true')
                 from (select coalesce((select value from public.system_settings where key = 'nodi.features'), '{}'::jsonb) f) x));
end $$;

-- The gate now also takes the part being used. Called with no argument (an older Edge Function) it checks only the main switch, as before.
drop function if exists public.nodi_gate();
create or replace function public.nodi_gate(p_feature text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_limit integer; v_used integer;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  if not exists (select 1 from private.my_grants() g where g.permission_code in ('nodi.assistant.view', 'nodi.settings.configure')) then raise exception 'নদী AI ব্যবহারের অনুমতি নেই' using errcode = '42501'; end if;
  if coalesce(private.setting_text('nodi.enabled'), 'true') <> 'true' then raise exception 'নদী AI এখন বন্ধ আছে' using errcode = 'P0001'; end if;
  if p_feature is not null and not private.nodi_feature_on(p_feature) then
    raise exception '%', case p_feature when 'chat' then 'নদী AI চ্যাট এখন বন্ধ আছে' when 'teach' then 'নদী AI হিসাব শিক্ষক এখন বন্ধ আছে'
      when 'office' then 'অফিসের নদী AI পরামর্শ এখন বন্ধ আছে' else 'নদী AI-র এই অংশ এখন বন্ধ আছে' end using errcode = 'P0001';
  end if;
  v_limit := coalesce(private.setting_text('nodi.daily_limit')::integer, 50);
  select count(*) into v_used from public.nodi_usage where profile_id = auth.uid() and day = (now() at time zone 'Asia/Dhaka')::date;
  if v_used >= v_limit then raise exception 'আজকের সীমা (% বার) শেষ — কাল আবার চেষ্টা করুন', v_limit using errcode = 'P0001'; end if;
  return jsonb_build_object('model', coalesce(private.setting_text('nodi.model'), 'claude-sonnet-5-5'),
    'max_tokens', coalesce(private.setting_text('nodi.max_tokens')::integer, 1024), 'used', v_used, 'limit', v_limit, 'user', auth.uid());
end $$;

-- "নদী জিজ্ঞেস করছে": switched off, nobody is asked about their gap days.
create or replace function public.my_att_gaps()
returns table (work_date date, answer_id uuid, kind text, note text, status text, leave_status text, check_note text)
language sql stable security definer set search_path = '' as $$
  select g.work_date, a.id, a.kind, a.note, coalesce(a.status, 'waiting'), l.status, a.check_note
  from private.attendance_gap_days((date_trunc('month', current_date) - interval '1 month')::date, current_date, private.my_employee_id()) g
  left join public.attendance_gap_answers a on a.employee_id = g.employee_id and a.work_date = g.work_date
  left join public.leave_requests l on l.id = a.leave_request_id
  where private.my_employee_id() is not null and private.nodi_feature_on('gaps')
  order by g.work_date
$$;

create or replace function public.att_gap_remind(p_from date, p_to date, p_hub uuid default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  if not private.nodi_feature_on('gaps') then raise exception 'হাজিরার প্রশ্ন ("নদী জিজ্ঞেস করছে") এখন বন্ধ — নদী AI সেটিংস থেকে চালু করুন' using errcode = 'P0001'; end if;
  for r in
    select e.profile_id, count(*) days, string_agg(to_char(g.work_date, 'DD'), ', ' order by g.work_date) dates
    from private.attendance_gap_days(p_from, p_to) g
    join public.employees e on e.id = g.employee_id
    left join public.attendance_gap_answers a on a.employee_id = g.employee_id and a.work_date = g.work_date
    where (p_hub is null or e.hub_id = p_hub) and e.profile_id is not null
      and (a.id is null or a.status = 'returned')
      and private.has_permission('hr.attendance_gap.approve', e.zone_id, e.hub_id)
    group by e.profile_id
  loop
    perform private.notify(r.profile_id, 'আপনার ' || r.days || ' দিনের হাজিরা নেই',
      'তারিখ: ' || r.dates || ' — কারণ জানান (ছুটি হলে এখান থেকেই আবেদন দিন)', '/app', 'attendance_gap');
    n := n + 1;
  end loop;
  return n;
end $$;

-- Hourly issue reminders follow their switch (same job name, so the old job is replaced).
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('nodi-issue-followup', '7 * * * *', $$select public.issue_nudge_due(6) where private.nodi_feature_on('followup')$$);
  end if;
end $do$;

revoke all on function private.nodi_feature_on(text) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['public.nodi_gate(text)', 'public.nodi_settings()', 'public.nodi_features()', 'public.nodi_features_configure(jsonb)',
                           'public.my_att_gaps()', 'public.att_gap_remind(date, date, uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
