begin;

create table private.route_plan_publications (
  plan_id uuid not null references public.route_day_plans(id),
  version integer not null,
  morning_revision integer not null,
  approved_at timestamptz not null default statement_timestamp(),
  plan jsonb not null,
  riders jsonb not null,
  primary key (plan_id, version)
);

create table private.route_plan_deliveries (
  plan_id uuid not null,
  version integer not null,
  request_id uuid not null,
  notifications integer not null,
  primary key (plan_id, version, request_id),
  foreign key (plan_id, version) references private.route_plan_publications(plan_id, version)
);
alter table private.route_plan_publications enable row level security;
alter table private.route_plan_deliveries enable row level security;
revoke all on private.route_plan_publications, private.route_plan_deliveries from public, anon, authenticated, service_role;

create function private.route_plan_decide_base(p_plan uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.route_day_plans; v_name text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into v from public.route_day_plans where id = p_plan and archived_at is null for update;
  if v.id is null or not private.has_permission('ops.route_plan.approve', v.zone_id, v.hub_id) then
    raise exception 'Not authorised to decide this plan.' using errcode = '42501';
  end if;
  if v.status = 'approved' then raise exception 'This plan is already approved.' using errcode = '22023'; end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'The note is too long (500 letters at most).' using errcode = '22023'; end if;
  select coalesce(pr.full_name, 'user') into v_name from public.profiles pr where pr.id = auth.uid();
  if p_ok then
    if not exists (select 1 from public.route_day_riders l where l.plan_id = v.id and l.removed_at is null and (l.parcels > 0 or l.pickups > 0)) then
      raise exception 'Nobody has parcels on this plan yet.' using errcode = '22023';
    end if;
    update public.route_day_plans set status = 'approved', decided_by = auth.uid(), decided_by_name = v_name, decided_at = now(),
      decide_note = nullif(trim(p_note), '') where id = v.id;
  else
    if v.status <> 'sent' then raise exception 'Only a sent plan can be sent back.' using errcode = '22023'; end if;
    if length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Write why the plan goes back.' using errcode = '22023'; end if;
    update public.route_day_plans set status = 'draft', decided_by = auth.uid(), decided_by_name = v_name, decided_at = now(),
      decide_note = trim(p_note) where id = v.id;
  end if;
end $$;


-- The legacy approval path remains for plans without a morning workflow.
create or replace function public.route_plan_decide(p_plan uuid, p_ok boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.route_day_plans;
begin
  select * into v from public.route_day_plans where id = p_plan and archived_at is null for update;
  if v.id is null or not private.has_permission('ops.route_plan.approve', v.zone_id, v.hub_id) then
    raise exception 'Not authorised to decide this plan.' using errcode = '42501';
  end if;
  if p_ok then
    perform private.wf_morning_lock(v.hub_id, v.plan_date);
    if exists (select 1 from private.wf_morning_rounds r where r.hub_id = v.hub_id and r.work_date = v.plan_date) then
      raise exception 'Use route_plan_publish with the reviewed morning revision' using errcode = 'P0001';
    end if;
  end if;
  perform private.route_plan_decide_base(p_plan, p_ok, p_note);
end $$;

create function private.route_plan_deliver(
  p_plan public.route_day_plans, p_publication private.route_plan_publications, p_request uuid, p_cancelled jsonb)
returns integer language plpgsql set search_path = '' as $$
declare n integer;
begin
  select d.notifications into n from private.route_plan_deliveries d
  where d.plan_id = p_plan.id and d.version = p_publication.version and d.request_id = p_request;
  if found then return n; end if;

  insert into public.notifications (profile_id, title, body, link, kind)
  select distinct recipient.profile_id, recipient.title,
    coalesce(private.hub_name(p_plan.hub_id), '') || ' · ' || to_char(p_plan.plan_date, 'DD-MM-YYYY') ||
    ' · সংস্করণ ' || p_publication.version,
    recipient.link, 'route_plan'
  from (
    select m.profile_id, 'হাবের রুট পরিকল্পনা অনুমোদিত'::text as title, '/app/routes/plan'::text as link
    from private.wf_hub_managers(p_plan.hub_id) m(profile_id)
    where m.profile_id is distinct from auth.uid()
    union
    select e.profile_id, 'আজকের রুট বরাদ্দ হয়েছে', '/app/staff'
    from jsonb_object_keys(p_publication.riders) k(employee)
    join public.employees e on e.id::text = k.employee
    join public.profiles p on p.id = e.profile_id and p.status = 'active' and p.archived_at is null
    where e.status = 'active' and e.archived_at is null and e.hub_id = p_plan.hub_id
    union
    select e.profile_id, 'আগের রুট বরাদ্দ বাতিল হয়েছে', '/app/staff'
    from jsonb_object_keys(p_cancelled) k(employee)
    join public.employees e on e.id::text = k.employee
    join public.profiles p on p.id = e.profile_id and p.status = 'active' and p.archived_at is null
    where not (p_publication.riders ? k.employee)
  ) recipient;
  get diagnostics n = row_count;
  insert into private.route_plan_deliveries values (p_plan.id, p_publication.version, p_request, n);
  return n;
end $$;

create function public.route_plan_publish(p_plan uuid, p_version integer, p_morning_revision integer, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.route_day_plans;
  m private.wf_morning_rounds;
  pub private.route_plan_publications;
  prior jsonb;
  payload jsonb;
  n integer;
begin
  select * into p from public.route_day_plans where id = p_plan and archived_at is null for update;
  if p.id is null or not private.has_permission('ops.route_plan.approve', p.zone_id, p.hub_id)
      or not private.has_permission('hr.morning_attendance.approve', p.zone_id, p.hub_id) then
    raise exception 'Not authorised to publish this plan.' using errcode = '42501';
  end if;
  if p.plan_date is distinct from private.wf_today() or p.version is distinct from p_version or p_morning_revision is null then
    raise exception 'Reload today''s route plan before publishing' using errcode = '22023';
  end if;

  select * into pub from private.route_plan_publications x where x.plan_id = p.id and x.version = p.version;
  if found then
    if pub.morning_revision is distinct from p_morning_revision then
      raise exception 'This plan version was published with a different morning revision' using errcode = 'P0001';
    end if;
    return jsonb_build_object('plan_id', p.id, 'version', pub.version, 'morning_revision', pub.morning_revision, 'already_published', true);
  end if;

  perform private.wf_morning_lock(p.hub_id, p.plan_date);
  select * into m from private.wf_morning_rounds r
    where r.hub_id = p.hub_id and r.work_date = p.plan_date order by revision desc limit 1;
  if m.submitted_at is null or m.revision is distinct from p_morning_revision then
    raise exception 'Review the latest submitted morning revision' using errcode = 'P0001';
  end if;

  -- Serialize linked publications for the work date so competing plans cannot assign a person twice.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('route_publish:' || (p.plan_date - date '2000-01-01')::text, 0));
  if exists (
    select 1 from public.route_day_riders l
    left join private.wf_morning_roster(p.hub_id, p.plan_date) e on e.id = l.employee_id
    where l.plan_id = p.id and l.removed_at is null and (l.parcels > 0 or l.pickups > 0)
      and (e.id is null or e.on_leave
        or (l.kind = 'rider' and not coalesce((
          select private.is_rider_post(staff.position_id) from public.employees staff where staff.id = l.employee_id
        ), false))
        or (l.kind = 'helper' and not exists (
          select 1 from public.route_staff_load ls where ls.employee_id = l.employee_id and ls.hub_id = p.hub_id and ls.helper
        ))
        or m.marks ->> l.employee_id::text is distinct from 'present'
        or exists (
          select 1 from public.route_day_plans q
          join lateral (select x.riders from private.route_plan_publications x where x.plan_id = q.id
            order by x.version desc limit 1) pub_other on true
          where q.id <> p.id and q.plan_date = p.plan_date and q.archived_at is null and pub_other.riders ? l.employee_id::text
        ))
  ) then
    raise exception 'An assigned employee is unavailable, ineligible, or already allocated on another published plan' using errcode = '22023';
  end if;

  perform private.route_plan_decide_base(p.id, true, p_note);
  select x.riders into prior from private.route_plan_publications x where x.plan_id = p.id order by x.version desc limit 1;
  select coalesce(jsonb_object_agg(l.employee_id::text, jsonb_build_object(
    'date', p.plan_date, 'hub', private.hub_name(p.hub_id), 'parcels', l.parcels, 'pickups', l.pickups,
    'kind', l.kind, 'note', l.note, 'version', p.version, 'detail', coalesce((
      select jsonb_agg(jsonb_build_object('parcels', (d.value ->> 'parcels')::integer,
        'route', r.code || ' · ' || r.name, 'for', e.full_name) order by d.ordinality)
      from jsonb_array_elements(l.detail) with ordinality d
      left join public.hub_routes r on r.id::text = d.value ->> 'route_id'
      left join public.employees e on e.id::text = d.value ->> 'for'
    ), '[]'::jsonb))), '{}'::jsonb) into payload
  from public.route_day_riders l where l.plan_id = p.id and l.removed_at is null and (l.parcels > 0 or l.pickups > 0);

  insert into private.route_plan_publications (plan_id, version, morning_revision, plan, riders)
  values (p.id, p.version, m.revision, private.route_plan_json(p.id), payload) returning * into pub;
  n := private.route_plan_deliver(p, pub, gen_random_uuid(), coalesce(prior, '{}'::jsonb));
  return jsonb_build_object('plan_id', p.id, 'version', p.version, 'morning_revision', m.revision, 'notifications', n);
end $$;

create function public.route_plan_resend(p_plan uuid, p_version integer, p_request_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare p public.route_day_plans; pub private.route_plan_publications;
begin
  select * into p from public.route_day_plans where id = p_plan and archived_at is null for update;
  if p.id is null or not private.has_permission('ops.route_plan.approve', p.zone_id, p.hub_id)
      or not private.has_permission('hr.morning_attendance.approve', p.zone_id, p.hub_id) then
    raise exception 'Not authorised to resend this plan.' using errcode = '42501';
  end if;
  select * into pub from private.route_plan_publications x where x.plan_id = p.id order by x.version desc limit 1;
  if p.plan_date is distinct from private.wf_today() or pub.version is null or pub.version is distinct from p_version or p_request_id is null then
    raise exception 'Resend the latest published version of today''s plan' using errcode = '22023';
  end if;
  return private.route_plan_deliver(p, pub, p_request_id, '{}'::jsonb);
end $$;

create function public.route_plan_published(p_hub uuid, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare z uuid := private.wf_morning_zone(p_hub);
begin
  if z is null or not private.has_permission('ops.route_plan.view', z, p_hub) then
    raise exception 'Not authorised to see this hub''s approved plan' using errcode = '42501';
  end if;
  return (select x.plan || jsonb_build_object('morning_revision', x.morning_revision, 'published_at', x.approved_at)
    from private.route_plan_publications x join public.route_day_plans p on p.id = x.plan_id
    where p.hub_id = p_hub and p.plan_date = coalesce(p_date, private.wf_today()) and p.archived_at is null
    order by x.version desc limit 1);
end $$;

create or replace function public.route_plan_mine() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := private.my_employee_id();
begin
  if v_emp is null then return null; end if;
  return coalesce((
    select pub.riders -> v_emp::text
    from private.route_plan_publications pub
    join public.route_day_plans p on p.id = pub.plan_id
    where p.archived_at is null and p.plan_date = private.wf_today()
      and pub.version = (select max(x.version) from private.route_plan_publications x where x.plan_id = p.id)
      and pub.riders ? v_emp::text
      and (private.route_plan_rules(p.zone_id) ->> 'show_rider')::boolean
      and private.has_permission('ops.route_plan_own.view', p.zone_id, p.hub_id)
    limit 1
  ), (select jsonb_build_object('date', p.plan_date, 'hub', h.name, 'parcels', l.parcels, 'pickups', l.pickups, 'kind', l.kind, 'note', l.note,
      'detail', coalesce((select jsonb_agg(jsonb_build_object('parcels', (d ->> 'parcels')::integer,
                   'route', (select r.code || ' · ' || r.name from public.hub_routes r where r.id = nullif(d ->> 'route_id', '')::uuid),
                   'for', (select e.full_name from public.employees e where e.id = nullif(d ->> 'for', '')::uuid)))
                 from jsonb_array_elements(l.detail) d), '[]'::jsonb))
    from public.route_day_riders l join public.route_day_plans p on p.id = l.plan_id join public.hubs h on h.id = p.hub_id
   where l.employee_id = v_emp and l.removed_at is null and p.plan_date = current_date and p.archived_at is null and p.status = 'approved'
     and (l.parcels > 0 or l.pickups > 0)
     and (private.route_plan_rules(p.zone_id) ->> 'show_rider')::boolean
     and private.has_permission('ops.route_plan_own.view', p.zone_id, p.hub_id)
     and not exists (select 1 from private.route_plan_publications pub where pub.plan_id = p.id)
   limit 1));
end $$;


revoke all on function private.route_plan_decide_base(uuid, boolean, text),
  private.route_plan_deliver(public.route_day_plans, private.route_plan_publications, uuid, jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.route_plan_publish(uuid, integer, integer, text),
  public.route_plan_resend(uuid, integer, uuid), public.route_plan_published(uuid, date)
from public, anon, authenticated, service_role;
grant execute on function public.route_plan_publish(uuid, integer, integer, text),
  public.route_plan_resend(uuid, integer, uuid), public.route_plan_published(uuid, date) to authenticated;

commit;
