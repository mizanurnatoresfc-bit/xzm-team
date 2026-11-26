-- Operations collection is exposed only through scoped RPCs.
create table private.operation_baselines (
  id bigint generated always as identity primary key,
  hub_id uuid not null references public.hubs(id),
  pickup integer not null check (pickup >= 0),
  delivery integer not null check (delivery >= 0),
  received integer not null check (received >= 0),
  changed_by uuid not null,
  changed_at timestamptz not null default now()
);
create index operation_baselines_hub on private.operation_baselines(hub_id, id desc);

create table private.operation_questions (
  id uuid primary key default gen_random_uuid(),
  hub_id uuid not null references public.hubs(id),
  recipient uuid not null,
  sender uuid not null,
  metric text not null check (metric in ('delivery_pending','pickup_pending','sorting_pending','spare_capacity','backup_needed')),
  prompt text not null check (length(btrim(prompt)) between 1 and 300),
  question_date date not null default private.wf_today(),
  created_at timestamptz not null default now()
);
create index operation_questions_recipient on private.operation_questions(recipient, question_date);
create index operation_questions_hub on private.operation_questions(hub_id, question_date);
create table private.operation_answers (
  id bigint generated always as identity primary key,
  question_id uuid not null references private.operation_questions(id),
  value integer not null check (value >= 0),
  answered_at timestamptz not null default now()
);
create index operation_answers_latest on private.operation_answers(question_id, id desc);

create function public.operation_collection(p_zone uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', h.id, 'name', h.name,
    'can_edit', private.has_permission('zonal.hub_ops.configure', null, h.id),
    'can_send', private.has_permission('zonal.hub_ops.create', null, h.id),
    'baseline', case when b.id is not null then jsonb_build_object(
      'pickup', b.pickup, 'delivery', b.delivery, 'received', b.received) end,
    'actual', jsonb_build_object('pickup', m.pickup_count, 'delivery', m.delivery_count,
      'received', r.total_parcels)
  ) order by h.name), '[]'::jsonb)
  from public.hubs h
  left join lateral (select x.* from private.operation_baselines x
    where x.hub_id = h.id order by x.id desc limit 1) b on true
  left join public.hub_daily_metrics m on m.hub_id = h.id and m.metric_date = private.wf_today()
    and m.status::text = 'approved'
  left join public.hub_ops_reports r on r.hub_id = h.id and r.report_date = private.wf_today()
    and r.status in ('submitted', 'reviewed')
  where auth.uid() is not null and h.zone_id = p_zone and h.status = 'active' and h.archived_at is null
    and private.has_permission('zonal.hub_ops.view', null, h.id)
$$;

create function public.operation_baseline_save(p_hub uuid, p_pickup integer, p_delivery integer, p_received integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not coalesce(private.has_permission('zonal.hub_ops.configure', null, p_hub), false)
     or not exists (select 1 from public.hubs where id = p_hub and status = 'active' and archived_at is null) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  insert into private.operation_baselines(hub_id, pickup, delivery, received, changed_by)
    values (p_hub, p_pickup, p_delivery, p_received, auth.uid());
end;
$$;

create function public.operation_recipients(p_hub uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.full_name,
    'code', e.employee_code, 'position', coalesce(p.name_bn, p.name)) order by e.full_name), '[]'::jsonb)
  from public.employees e left join public.positions p on p.id = e.position_id
  where p_hub is not null and auth.uid() is not null and private.has_permission('zonal.hub_ops.create', null, p_hub)
    and e.hub_id = p_hub and e.status = 'active' and e.archived_at is null and e.profile_id is not null
$$;

create function public.operation_question_send(p_hub uuid, p_employee uuid, p_metric text, p_prompt text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_recipient uuid; v_id uuid;
begin
  if auth.uid() is null or not coalesce(private.has_permission('zonal.hub_ops.create', null, p_hub), false)
     or not exists (select 1 from public.hubs where id = p_hub and status = 'active' and archived_at is null) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select e.profile_id into v_recipient from public.employees e where e.id = p_employee
    and e.hub_id = p_hub and e.status = 'active' and e.archived_at is null;
  if v_recipient is null then raise exception 'Choose an active hub employee with a login'; end if;
  insert into private.operation_questions(hub_id, recipient, sender, metric, prompt)
    values (p_hub, v_recipient, auth.uid(), p_metric, btrim(p_prompt)) returning id into v_id;
  return v_id;
end;
$$;

create function public.operation_questions_today(p_hub uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'prompt', q.prompt, 'metric', q.metric, 'hub', h.name,
    'recipient', case when p_hub is not null then e.full_name end, 'value', a.value,
    'answered_at', a.answered_at
  ) order by q.created_at desc), '[]'::jsonb)
  from private.operation_questions q
  join public.hubs h on h.id = q.hub_id
  left join lateral (select x.value, x.answered_at from private.operation_answers x
    where x.question_id = q.id order by x.id desc limit 1) a on true
  left join lateral (select x.full_name from public.employees x
    where p_hub is not null and x.profile_id = q.recipient and x.hub_id = q.hub_id
      and x.archived_at is null order by x.id limit 1) e on true
  where auth.uid() is not null and q.question_date = private.wf_today()
    and ((p_hub is null and q.recipient = auth.uid()) or
      (q.hub_id = p_hub and private.has_permission('zonal.hub_ops.view', null, p_hub)))
$$;

create function public.operation_question_answer(p_question uuid, p_value integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from private.operation_questions where id = p_question
    and recipient = auth.uid() and question_date = private.wf_today() for update;
  if not found then raise exception 'Question unavailable' using errcode = '42501'; end if;
  insert into private.operation_answers(question_id, value) values (p_question, p_value);
end;
$$;

alter table private.operation_baselines enable row level security;
alter table private.operation_questions enable row level security;
alter table private.operation_answers enable row level security;

revoke all on private.operation_baselines, private.operation_questions, private.operation_answers from public, anon, authenticated;
revoke all on function public.operation_collection(uuid), public.operation_baseline_save(uuid,integer,integer,integer),
  public.operation_recipients(uuid), public.operation_question_send(uuid,uuid,text,text),
  public.operation_questions_today(uuid), public.operation_question_answer(uuid,integer) from public, anon;
grant execute on function public.operation_collection(uuid), public.operation_baseline_save(uuid,integer,integer,integer),
  public.operation_recipients(uuid), public.operation_question_send(uuid,uuid,text,text),
  public.operation_questions_today(uuid), public.operation_question_answer(uuid,integer) to authenticated;
