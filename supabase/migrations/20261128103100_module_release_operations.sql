-- Operations already serves zonal collection and employee questions in production.
insert into private.release_module (id, parent) values ('operation', null);
update private.release_module set legacy_live = true where id = 'operation';

-- Collection and inbox results can span hubs. Evaluate release rules per resource row.
create or replace function public.operation_collection(p_zone uuid) returns jsonb
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
    and private.release_api_allowed('operation', h.id)
$$;

create or replace function public.operation_baseline_save(p_hub uuid, p_pickup integer, p_delivery integer, p_received integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not coalesce(private.has_permission('zonal.hub_ops.configure', null, p_hub), false)
     or not exists (select 1 from public.hubs where id = p_hub and status = 'active' and archived_at is null) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  perform public.module_release_require('operation', p_hub);
  insert into private.operation_baselines(hub_id, pickup, delivery, received, changed_by)
    values (p_hub, p_pickup, p_delivery, p_received, auth.uid());
end;
$$;

create or replace function public.operation_recipients(p_hub uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.full_name,
    'code', e.employee_code, 'position', coalesce(p.name_bn, p.name)) order by e.full_name), '[]'::jsonb)
  from public.employees e left join public.positions p on p.id = e.position_id
  where p_hub is not null and auth.uid() is not null and private.has_permission('zonal.hub_ops.create', null, p_hub)
    and private.release_api_allowed('operation', p_hub)
    and e.hub_id = p_hub and e.status = 'active' and e.archived_at is null and e.profile_id is not null
$$;

create or replace function public.operation_question_send(p_hub uuid, p_employee uuid, p_metric text, p_prompt text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_recipient uuid; v_id uuid;
begin
  if auth.uid() is null or not coalesce(private.has_permission('zonal.hub_ops.create', null, p_hub), false)
     or not exists (select 1 from public.hubs where id = p_hub and status = 'active' and archived_at is null) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  perform public.module_release_require('operation', p_hub);
  select e.profile_id into v_recipient from public.employees e where e.id = p_employee
    and e.hub_id = p_hub and e.status = 'active' and e.archived_at is null;
  if v_recipient is null then raise exception 'Choose an active hub employee with a login'; end if;
  insert into private.operation_questions(hub_id, recipient, sender, metric, prompt)
    values (p_hub, v_recipient, auth.uid(), p_metric, btrim(p_prompt)) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.operation_questions_today(p_hub uuid default null) returns jsonb
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
    and private.release_api_allowed('operation', q.hub_id)
    and ((p_hub is null and q.recipient = auth.uid()) or
      (q.hub_id = p_hub and private.has_permission('zonal.hub_ops.view', null, p_hub)))
$$;

create or replace function public.operation_question_answer(p_question uuid, p_value integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_hub uuid;
begin
  select hub_id into v_hub from private.operation_questions where id = p_question
    and recipient = auth.uid() and question_date = private.wf_today() for update;
  if not found then raise exception 'Question unavailable' using errcode = '42501'; end if;
  perform public.module_release_require('operation', v_hub);
  insert into private.operation_answers(question_id, value) values (p_question, p_value);
end;
$$;
