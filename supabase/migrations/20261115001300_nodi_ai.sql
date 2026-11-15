-- =====================================================================
--  নদী AI — settings, the daily limit and the usage log.
--  The Anthropic API key is NEVER stored here: it lives only in the Edge Function
--  secret ANTHROPIC_API_KEY. This migration holds who may use the assistant, which
--  model it uses, how much one person may use per day, and what was used.
-- =====================================================================
insert into public.permissions (code, module, resource, action, description) values
  ('nodi.assistant.view',     'nodi', 'assistant', 'view',      'Talk to নদী AI'),
  ('nodi.settings.configure', 'nodi', 'settings',  'configure', 'Model, daily limit, on/off and usage of নদী AI')
on conflict (code) do nothing;
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on (
     (r.code in ('admin', 'head_office_manager') and p.code like 'nodi.%')
  or (r.code in ('operations_manager', 'zonal_manager', 'hub_manager', 'pickup_manager', 'delivery_manager', 'hr_manager', 'accounts_manager') and p.code = 'nodi.assistant.view')
) on conflict do nothing;

insert into public.system_settings (key, value, description) values
  ('nodi.enabled',            'true'::jsonb,               'নদী AI চালু আছে কি'),
  ('nodi.model',              '"claude-sonnet-5-5"'::jsonb, 'Claude model used by নদী AI'),
  ('nodi.daily_limit',        '50'::jsonb,                 'Requests one person may send per day (Dhaka time)'),
  ('nodi.max_tokens',         '1024'::jsonb,               'Longest answer, in tokens')
on conflict (key) do nothing;

create table public.nodi_usage (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null,
  at            timestamptz not null default now(),
  day           date not null default (now() at time zone 'Asia/Dhaka')::date,
  model         text,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  ok            boolean not null default true,
  note          text
);
create index nodi_usage_profile_day_idx on public.nodi_usage (profile_id, day);
create index nodi_usage_day_idx on public.nodi_usage (day);
create trigger nodi_usage_no_delete before delete on public.nodi_usage for each row execute function private.prevent_delete();
alter table public.nodi_usage enable row level security;
revoke all on public.nodi_usage from anon;
create policy nodi_usage_read on public.nodi_usage for select to authenticated
  using (profile_id = auth.uid() or private.has_permission('nodi.settings.configure'));
grant select on public.nodi_usage to authenticated;

-- Called by the Edge Function AS THE CALLER, before it spends money.
create or replace function public.nodi_gate()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_limit integer; v_used integer;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  if not exists (select 1 from private.my_grants() g where g.permission_code in ('nodi.assistant.view', 'nodi.settings.configure')) then raise exception 'নদী AI ব্যবহারের অনুমতি নেই' using errcode = '42501'; end if;
  if coalesce(private.setting_text('nodi.enabled'), 'true') <> 'true' then raise exception 'নদী AI এখন বন্ধ আছে' using errcode = 'P0001'; end if;
  v_limit := coalesce(private.setting_text('nodi.daily_limit')::integer, 50);
  select count(*) into v_used from public.nodi_usage where profile_id = auth.uid() and day = (now() at time zone 'Asia/Dhaka')::date;
  if v_used >= v_limit then raise exception 'আজকের সীমা (% বার) শেষ — কাল আবার চেষ্টা করুন', v_limit using errcode = 'P0001'; end if;
  return jsonb_build_object('model', coalesce(private.setting_text('nodi.model'), 'claude-sonnet-5-5'),
    'max_tokens', coalesce(private.setting_text('nodi.max_tokens')::integer, 1024), 'used', v_used, 'limit', v_limit, 'user', auth.uid());
end $$;

-- Written by the Edge Function with the service key only.
create or replace function public.nodi_log(p_profile uuid, p_model text, p_in integer, p_out integer, p_ok boolean, p_note text default null)
returns void
language sql security definer set search_path = '' as $$
  insert into public.nodi_usage (profile_id, model, input_tokens, output_tokens, ok, note) values (p_profile, p_model, coalesce(p_in, 0), coalesce(p_out, 0), p_ok, left(p_note, 300))
$$;

create or replace function public.nodi_settings()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_permission('nodi.settings.configure') then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
  return jsonb_build_object(
    'enabled', coalesce(private.setting_text('nodi.enabled'), 'true') = 'true',
    'model', private.setting_text('nodi.model'),
    'daily_limit', private.setting_text('nodi.daily_limit')::integer,
    'max_tokens', private.setting_text('nodi.max_tokens')::integer);
end $$;

create or replace function public.nodi_configure(p_enabled boolean, p_model text, p_daily_limit integer, p_max_tokens integer)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission('nodi.settings.configure') then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
  if p_model !~ '^claude-[a-z0-9.-]{3,60}$' then raise exception 'মডেলের নাম ঠিক নয়' using errcode = '22023'; end if;
  if p_daily_limit is null or p_daily_limit < 1 or p_daily_limit > 5000 then raise exception 'দৈনিক সীমা ১ থেকে ৫০০০ এর মধ্যে দিন' using errcode = '22023'; end if;
  if p_max_tokens is null or p_max_tokens < 100 or p_max_tokens > 8000 then raise exception 'উত্তরের দৈর্ঘ্য ১০০ থেকে ৮০০০ এর মধ্যে দিন' using errcode = '22023'; end if;
  perform set_config('app.change_reason', 'নদী AI সেটিং', true);
  update public.system_settings set value = to_jsonb(p_enabled) where key = 'nodi.enabled';
  update public.system_settings set value = to_jsonb(p_model) where key = 'nodi.model';
  update public.system_settings set value = to_jsonb(p_daily_limit) where key = 'nodi.daily_limit';
  update public.system_settings set value = to_jsonb(p_max_tokens) where key = 'nodi.max_tokens';
end $$;

-- Usage per day and per person (last p_days days)
create or replace function public.nodi_usage_summary(p_days integer default 14)
returns table (day date, full_name text, requests integer, failed integer, input_tokens bigint, output_tokens bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_permission('nodi.settings.configure') then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
  return query
  select u.day, coalesce(e.full_name, p.full_name, '—'), count(*)::int, count(*) filter (where not u.ok)::int, sum(u.input_tokens)::bigint, sum(u.output_tokens)::bigint
  from public.nodi_usage u left join public.profiles p on p.id = u.profile_id left join public.employees e on e.profile_id = u.profile_id and e.archived_at is null
  where u.day >= (now() at time zone 'Asia/Dhaka')::date - greatest(p_days, 1)
  group by u.day, 2 order by u.day desc, 3 desc;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.nodi_gate()', 'public.nodi_settings()', 'public.nodi_configure(boolean, text, integer, integer)', 'public.nodi_usage_summary(integer)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function public.nodi_log(uuid, text, integer, integer, boolean, text) from public, anon, authenticated;
grant execute on function public.nodi_log(uuid, text, integer, integer, boolean, text) to service_role;
