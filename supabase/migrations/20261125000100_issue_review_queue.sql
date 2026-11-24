create or replace function public.issue_panels()
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with me as (select auth.uid() uid, private.my_employee_id() emp),
  v as (
    select i.id, i.issue_no, i.title, i.kind, i.priority, i.status, i.hub_id, private.hub_name(i.hub_id) hub, i.parcel_ref, i.due_at, i.created_at, i.solved_at,
           i.reopen_count, i.assigned_by_name, i.assigned_by_nodi, private.emp_name(i.assignee_id) assignee, private.emp_code(i.assignee_id) assignee_code,
           (i.assignee_id = me.emp) is_mine, (i.assigned_by = me.uid or i.created_by = me.uid) is_giver,
           coalesce((i.assigned_by = auth.uid() or i.created_by = auth.uid() or (i.kind not in ('store', 'it') and private.has_permission('issue.issue.approve', i.zone_id, i.hub_id))), false) can_review,
           (i.due_at is not null and i.due_at < now() and i.status in ('open', 'in_progress')) overdue
    from public.issues i, me
    where i.status in ('open', 'in_progress', 'solved'))
  select jsonb_build_object(
    'mine',     coalesce((select jsonb_agg(to_jsonb(v) order by v.overdue desc, v.created_at) from v where is_mine and status in ('open', 'in_progress')), '[]'::jsonb),
    'to_check', coalesce((select jsonb_agg(to_jsonb(v) order by v.solved_at) from v where can_review and status = 'solved'), '[]'::jsonb),
    'given',    coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at) from v where is_giver and status in ('open', 'in_progress')), '[]'::jsonb),
    'waiting_for_check_of_mine', coalesce((select jsonb_agg(to_jsonb(v) order by v.solved_at) from v where is_mine and status = 'solved'), '[]'::jsonb),
    'hub',      coalesce((select jsonb_agg(to_jsonb(v) order by v.overdue desc, v.created_at) from v where not is_mine and not is_giver), '[]'::jsonb))
$$;

create or replace function public.issue_detail(p_id uuid)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'issue', to_jsonb(i) || jsonb_build_object('hub', private.hub_name(i.hub_id), 'assignee', private.emp_name(i.assignee_id), 'assignee_code', private.emp_code(i.assignee_id),
        'can_review', coalesce((i.assigned_by = auth.uid() or i.created_by = auth.uid() or (i.kind not in ('store', 'it') and private.has_permission('issue.issue.approve', i.zone_id, i.hub_id))), false),
        'status_bn', private.issue_status_label(i.status)),
    'events', coalesce((select jsonb_agg(to_jsonb(x) order by x.at) from public.issue_events x where x.issue_id = i.id), '[]'::jsonb),
    'parcel', (select to_jsonb(p) - 'created_by' - 'updated_by' from public.parcels p where p.id = i.parcel_id))
  from public.issues i
  where i.id = p_id
$$;
