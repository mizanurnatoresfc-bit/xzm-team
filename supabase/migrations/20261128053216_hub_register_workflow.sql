-- Hub registers reuse operational records and keep their own reviewed, versioned snapshots.
insert into public.permissions (code, module, resource, action, description) values
 ('ops.hub_register.edit', 'ops', 'hub_register', 'edit', 'Review and submit hub registers'),
 ('ops.hub_register.configure', 'ops', 'hub_register', 'configure', 'Assign and reopen hub registers')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where (p.code = 'ops.hub_register.edit' and r.code in ('admin','manager','hub_manager','zonal_manager'))
   or (p.code = 'ops.hub_register.configure' and r.code in ('admin','zonal_manager'))
on conflict do nothing;

create table private.hub_register_rules (
  rule_id bigint generated always as identity primary key,
  hub_id uuid not null references public.hubs(id),
  book text not null check (book in ('attendance','pickup','pending','delivery','expense')),
  position_id uuid references public.positions(id),
  employee_id uuid references public.employees(id),
  required boolean not null,
  duty text not null check (length(btrim(duty)) between 1 and 120),
  due_at time not null,
  unique nulls not distinct (hub_id, book, position_id, employee_id)
);

create table private.hub_register_entries (
  hub_id uuid not null references public.hubs(id),
  work_date date not null,
  book text not null check (book in ('attendance','pickup','pending','delivery','expense')),
  employee_id uuid not null references public.employees(id),
  payload jsonb not null,
  actor uuid not null,
  reason text,
  primary key (hub_id, work_date, book, employee_id)
);

create table private.hub_register_reviews (
  hub_id uuid not null references public.hubs(id),
  work_date date not null,
  book text not null,
  -- Zero UUID denotes the unattributed expenses row.
  employee_id uuid not null,
  reviewed jsonb not null,
  primary key (hub_id, work_date, book, employee_id)
);

create table private.hub_register_events (
  id bigint generated always as identity primary key,
  hub_id uuid not null references public.hubs(id),
  work_date date not null,
  book text not null,
  action text not null,
  actor uuid not null,
  happened_at timestamptz not null default clock_timestamp(),
  data jsonb not null
);
create index hub_register_events_lookup on private.hub_register_events (hub_id, work_date, book, id desc);

alter table private.hub_register_rules enable row level security;
alter table private.hub_register_entries enable row level security;
alter table private.hub_register_reviews enable row level security;
alter table private.hub_register_events enable row level security;
revoke all on private.hub_register_rules, private.hub_register_entries, private.hub_register_reviews,
  private.hub_register_events from public, anon, authenticated;

create function private.hub_register_source(p_hub uuid, p_date date, p_book text, p_employee uuid)
returns jsonb language sql stable set search_path = '' as $$
  select case p_book
    when 'attendance' then coalesce(
      (select jsonb_strip_nulls(jsonb_build_object('status', l.final_status, 'application_date', coalesce(l.leave_applied_on,l.absence_app_date)))
       from public.att_day_sheets s join public.att_day_lines l on l.sheet_id = s.id
       where s.hub_id = p_hub and s.work_date = p_date and l.employee_id = p_employee
         and l.final_status not in ('unchecked','pending_leave')),
      (select jsonb_build_object('status',coalesce(m.decided_as,m.kind))
       from public.attendance_self_marks m where m.employee_id = p_employee and m.hub_id = p_hub
         and m.work_date = p_date and m.status in ('waiting','approved') limit 1))
    when 'pickup' then
      (select jsonb_build_object('pickup', o.pickup, 'merchant_return', o.pickup_return)
       from public.wf_daily_ops o where o.hub_id = p_hub and o.work_date = p_date and o.employee_id = p_employee)
    when 'pending' then
      (select case when a.return_reason is null and s.hub_id = p_hub then
         jsonb_build_object('pending', s.pending_count, 'return', coalesce(o.delivery_return, 0)) end
       from public.wf_pending_snapshots s left join public.wf_pending_approvals a on a.snapshot_id = s.id
       left join public.wf_daily_ops o on o.employee_id = s.employee_id and o.work_date = s.work_date and o.hub_id = s.hub_id
       where s.employee_id = p_employee and s.work_date = p_date order by s.id desc limit 1)
    when 'delivery' then
      (select jsonb_build_object('delivery', sum(l.delivery_qty), 'cash', sum(l.paid_amount), 'mobile', sum(l.mobile_banking), 'due', sum(l.due))
       from public.da_sessions s join public.da_rider_lines l on l.session_id = s.id
       where s.hub_id = p_hub and s.account_date = p_date and l.employee_id = p_employee and l.removed_at is null
       having count(*) > 0)
    when 'expense' then
      (select jsonb_build_object('expense', sum(z.amount), 'bills', count(*))
       from (
         select l.amount from public.da_sessions s join public.da_expenses l on l.session_id = s.id
         left join public.da_expense_claims c on c.id = l.claim_id
         where s.hub_id = p_hub and coalesce(c.bill_date,l.bill_date) = p_date and l.removed_at is null
           and coalesce(c.employee_id,l.employee_id,l.paid_by_employee) is not distinct from p_employee
         union all
         select c.amount from public.da_expense_claims c
         where c.hub_id = p_hub and c.bill_date = p_date and c.employee_id = p_employee and c.status = 'submitted'
           and not exists (select 1 from public.da_expenses l where l.claim_id = c.id and l.removed_at is null)
       ) z having count(*) > 0)
  end
$$;

create function private.hub_register_rows(p_hub uuid, p_date date, p_book text)
returns table (employee_id uuid, profile_id uuid, position_id uuid, name text, position_name text,
  duty text, due timestamptz, payload jsonb, source text, reviewed boolean)
language sql stable set search_path = '' as $$
  select e.id, e.profile_id, e.position_id, e.full_name, coalesce(nullif(po.name_bn,''),po.name),
    coalesce(rule.duty, p_book),
    (p_date + coalesce(rule.due_at, time '23:59')) at time zone 'Asia/Dhaka',
    v.payload, v.source, coalesce(r.reviewed = jsonb_build_array(v.source,v.payload),false) and v.payload is not null
  from public.employees e
  left join public.positions po on po.id = e.position_id
  left join lateral (
    select a.required, a.duty, a.due_at from private.hub_register_rules a
    where a.hub_id = p_hub and a.book = p_book and (a.employee_id is null or a.employee_id = e.id)
      and (a.position_id is null or a.position_id = e.position_id)
    order by (a.employee_id is not null) desc, (a.position_id is not null) desc limit 1
  ) rule on true
  left join private.hub_register_entries x on (x.hub_id,x.work_date,x.book,x.employee_id) = (p_hub,p_date,p_book,e.id)
  cross join lateral (select private.hub_register_source(p_hub,p_date,p_book,e.id) as payload) s
  cross join lateral (select coalesce(s.payload,x.payload) as payload,
    case when s.payload is not null then 'existing' when x.reason is not null then 'proxy'
      when x.payload is not null then 'self' end as source) v
  left join private.hub_register_reviews r on (r.hub_id,r.work_date,r.book,r.employee_id) = (p_hub,p_date,p_book,e.id)
  where (
    e.hub_id = p_hub and e.status = 'active' and e.archived_at is null
      and (e.joining_date is null or e.joining_date <= p_date)
      and coalesce(rule.required,true)
  ) or x.employee_id is not null
  union all
  select null,null,null,'Hub expenses',null,'expense',
    (p_date + time '23:59') at time zone 'Asia/Dhaka', s.payload,'existing',
    exists (select 1 from private.hub_register_reviews r
      where (r.hub_id,r.work_date,r.book,r.employee_id) = (p_hub,p_date,p_book,'00000000-0000-0000-0000-000000000000'::uuid)
        and r.reviewed = jsonb_build_array('existing',s.payload))
  from (select private.hub_register_source(p_hub,p_date,'expense',null) as payload) s
  where p_book = 'expense' and s.payload is not null
$$;


create function private.hub_register_check(p_book text, p_data jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare
  k text;
  value numeric;
  keys text[];
begin
  if jsonb_typeof(p_data) is distinct from 'object' then
    raise exception 'Enter the required register fields' using errcode = '22023';
  end if;
  if p_book = 'attendance' then
    if p_data - array['status','application_date'] <> '{}'::jsonb
      or coalesce(p_data->>'status','') not in ('present','absent','late','half_day','leave','holiday','weekly_off')
      or (p_data->>'status' = 'leave' and not p_data ? 'application_date')
      or (p_data ? 'application_date' and
        (coalesce(p_data->>'application_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         or p_data->>'status' not in ('leave','absent'))) then
      raise exception 'Enter an attendance status and the external application date for leave' using errcode = '22023';
    end if;
    perform (p_data->>'application_date')::date;
    return;
  end if;
  keys := case p_book when 'pickup' then array['pickup','merchant_return']
    when 'pending' then array['pending','return'] when 'delivery' then array['delivery','cash','mobile','due']
    when 'expense' then array['expense','bills'] end;
  if not (p_data ?& keys) or p_data - keys <> '{}'::jsonb then
    raise exception 'Enter all register fields' using errcode = '22023';
  end if;
  foreach k in array keys loop
    if jsonb_typeof(p_data->k) is distinct from 'number' then
      raise exception 'Enter numbers in each field' using errcode = '22023';
    end if;
    value := (p_data->>k)::numeric;
    if value < 0 or (case when k in ('cash','mobile','due','expense')
      then value > 999999999999.99 or value <> round(value,2)
      else value > 100000 or value <> trunc(value) end) then
      raise exception 'Invalid register count or amount' using errcode = '22023';
    end if;
  end loop;
end
$$;

create function private.hub_register_totals(p_rows jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(field, total),'{}'::jsonb)
  from (
    select case when x.key = 'status' then x.value #>> '{}' else x.key end as field,
      sum(case when x.key = 'status' then 1 else (x.value #>> '{}')::numeric end) as total
    from jsonb_array_elements(p_rows) r
    cross join lateral jsonb_each(case when jsonb_typeof(r->'payload') = 'object' then r->'payload' else '{}'::jsonb end) x
    where x.key = 'status' or jsonb_typeof(x.value) = 'number'
    group by 1
  ) sums
$$;

create function public.hub_register_read(p_hub uuid default null, p_date date default null, p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.employees := private.wf_me();
  hub uuid := coalesce(p_hub,me.hub_id);
  day date := coalesce(p_date,private.wf_today());
  can_manage boolean;
  can_configure boolean;
  options jsonb;
  books jsonb;
  month_report jsonb;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active' and p.archived_at is null) then
    raise exception 'An active account is required' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'name',coalesce(nullif(h.name_bn,''),h.name)) order by h.name,h.id),'[]')
    into options from private.wf_hubs('ops.hub_register.edit') x join public.hubs h on h.id = x.hub_id;
  if p_hub is null and jsonb_array_length(options) > 0 and not exists (
    select 1 from jsonb_array_elements(options) x where x->>'id' = hub::text
  ) then
    hub := (options->0->>'id')::uuid;
  end if;
  if hub is null then return jsonb_build_object('hubs',options,'books','[]'::jsonb,'day',day); end if;
  can_manage := coalesce(private.has_permission('ops.hub_register.edit',private.hub_zone(hub),hub),false);
  can_configure := can_manage and coalesce(private.has_permission('ops.hub_register.configure',private.hub_zone(hub),hub),false);
  if (not can_manage and hub is distinct from me.hub_id)
    or not exists(select 1 from public.hubs h where h.id = hub and h.archived_at is null) then
    raise exception 'Hub access is required' using errcode = '42501';
  end if;
  if day > private.wf_today() or day < date '2000-01-01' then
    raise exception 'Choose a valid register day' using errcode = '22023';
  end if;

  select jsonb_agg(jsonb_build_object('id', b.book, 'locked', coalesce(e.action = 'submit',false),
    'reopened', coalesce(e.action = 'reopen',false),
    'rows', q.rows, 'totals', private.hub_register_totals(q.rows),
    'history', case when can_manage then (
      select coalesce(jsonb_agg(to_jsonb(hist) order by hist.id desc),'[]')
      from (select j.id,j.action,j.happened_at,j.actor,
        case when j.action = 'submit' then jsonb_build_object('totals',j.data->'totals','rows',j.data->'rows') else j.data end as data
        from private.hub_register_events j where (j.hub_id,j.work_date,j.book) = (hub,day,b.book)
        order by j.id desc) hist) else '[]'::jsonb end) order by b.seq)
  into books
  from unnest(array['attendance','pickup','pending','delivery','expense']) with ordinality b(book,seq)
  left join lateral (
    select j.action,j.data from private.hub_register_events j
    where (j.hub_id,j.work_date,j.book) = (hub,day,b.book) and j.action in ('submit','reopen')
    order by j.id desc limit 1
  ) e on true
  cross join lateral (
    select coalesce(jsonb_agg(r.row_data - 'profile_id' order by r.row_data->>'name',r.row_data->>'employee_id'),'[]') as rows
    from (
      select x as row_data from jsonb_array_elements(e.data->'rows') x where e.action = 'submit'
      union all
      select to_jsonb(l) from private.hub_register_rows(hub,day,b.book) l where e.action is distinct from 'submit'
    ) r where can_manage or r.row_data->>'employee_id' = me.id::text
  ) q;

  if p_month is not null then
    if not can_manage then raise exception 'Manager access is required' using errcode = '42501'; end if;
    with latest as (
      select distinct on (j.work_date,j.book) j.work_date,j.book,j.action,j.data
      from private.hub_register_events j
      where j.hub_id = hub and j.work_date >= date_trunc('month',p_month)::date
        and j.work_date < date_trunc('month',p_month) + interval '1 month' and j.action in ('submit','reopen')
      order by j.work_date,j.book,j.id desc
    )
    select coalesce(jsonb_agg(jsonb_build_object('day',work_date,'book',book,'totals',data->'totals')
      order by work_date,book),'[]') into month_report from latest where action = 'submit';
  end if;

  return jsonb_build_object('hub',hub,'hubs',options,'day',day,'manage',can_manage,'configure',can_configure,
    'me',me.id,'books',books,'month',month_report,
    'positions', case when can_configure then (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(nullif(p.name_bn,''),p.name))
      order by p.name,p.id),'[]') from public.positions p where p.archived_at is null) end,
    'people', case when can_configure then (select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name)
      order by e.full_name,e.id),'[]') from public.employees e where e.hub_id = hub and e.status = 'active' and e.archived_at is null) end,
    'rules', case when can_configure then (select coalesce(jsonb_agg(to_jsonb(r) order by r.book,r.rule_id),'[]')
      from private.hub_register_rules r where r.hub_id = hub) end);
end
$$;

create function public.hub_register_write(p_hub uuid, p_date date, p_book text, p_action text,
  p_employee uuid default null, p_data jsonb default null, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.employees := private.wf_me();
  can_manage boolean;
  can_configure boolean;
  reason text := nullif(btrim(p_reason),'');
  target record;
  previous jsonb;
  rows jsonb;
  last_action text;
  employee uuid := coalesce(p_employee,'00000000-0000-0000-0000-000000000000');
  position uuid;
  employee_position uuid;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active' and p.archived_at is null) then
    raise exception 'An active account is required' using errcode = '42501';
  end if;
  if p_book is null or p_book not in ('attendance','pickup','pending','delivery','expense')
     or p_action is null or p_action not in ('save','review','submit','reopen','rule','remove_rule')
     or p_date is null or p_date > private.wf_today() or p_date < date '2000-01-01'
     or length(reason) > 500 then
    raise exception 'Invalid register request' using errcode = '22023';
  end if;
  if not exists (select 1 from public.hubs h where h.id = p_hub and h.archived_at is null) then
    raise exception 'Hub access is required' using errcode = '42501';
  end if;
  can_manage := coalesce(private.has_permission('ops.hub_register.edit',private.hub_zone(p_hub),p_hub),false);
  can_configure := can_manage and coalesce(private.has_permission('ops.hub_register.configure',private.hub_zone(p_hub),p_hub),false);
  if (p_action in ('rule','remove_rule','reopen') and not can_configure)
    or (p_action in ('review','submit') and not can_manage)
    or (p_action = 'save' and (p_employee is null or (not can_manage and
      ((p_hub,p_employee) is distinct from (me.hub_id,me.id) or p_date <> private.wf_today())))) then
    raise exception 'Register action is outside your scope' using errcode = '42501';
  end if;

  -- Assignment changes and submissions use the same hub/book lock.
  perform pg_advisory_xact_lock(hashtextextended('hub_register:' || p_hub || ':' || p_book,0));
  if p_action in ('rule','remove_rule') then
    position := nullif(p_data->>'position_id','')::uuid;
    if p_action = 'rule' and p_employee is not null then
      select e.position_id into employee_position from public.employees e
      where e.id = p_employee and e.hub_id = p_hub and e.archived_at is null and e.status = 'active';
      if not found or (position is not null and employee_position is distinct from position) then
        raise exception 'Employee and position must match the selected hub' using errcode = '22023';
      end if;
    end if;
    if p_action = 'remove_rule' then
      delete from private.hub_register_rules r where (r.hub_id,r.book) = (p_hub,p_book)
        and (r.position_id,r.employee_id) is not distinct from (position,p_employee);
    else
      insert into private.hub_register_rules (hub_id,book,position_id,employee_id,required,duty,due_at)
      values (p_hub,p_book,position,p_employee,(p_data->>'required')::boolean,btrim(p_data->>'duty'),(p_data->>'due_at')::time)
      on conflict (hub_id,book,position_id,employee_id) do update
      set required = excluded.required,duty = excluded.duty,due_at = excluded.due_at;
    end if;
    return;
  end if;

  select j.action into last_action from private.hub_register_events j
  where (j.hub_id,j.work_date,j.book) = (p_hub,p_date,p_book) and j.action in ('submit','reopen')
  order by id desc limit 1;

  if p_action = 'reopen' then
    if last_action is distinct from 'submit' or reason is null then
      raise exception 'Choose a locked register and enter a reason' using errcode = '22023';
    end if;
    p_data := jsonb_build_object('reason',reason);
  elsif last_action = 'submit' then
    if p_action = 'submit' then return; end if;
    raise exception 'This register is locked' using errcode = '55000';
  elsif p_action = 'submit' then
    select coalesce(jsonb_agg(to_jsonb(r) - 'profile_id' order by r.employee_id),'[]') into rows
    from private.hub_register_rows(p_hub,p_date,p_book) r;
    if exists (select 1 from jsonb_array_elements(rows) r where not (r->>'reviewed')::boolean) then
      raise exception 'Complete and review all required entries before submitting' using errcode = '22023';
    end if;
    p_data := jsonb_build_object('rows',rows,'totals',private.hub_register_totals(rows));
  else
    select * into target from private.hub_register_rows(p_hub,p_date,p_book) r
    where r.employee_id is not distinct from p_employee;
    if not found then raise exception 'Employee is not assigned to this register' using errcode = '42501'; end if;

    if p_action = 'review' then
      if target.payload is null or p_data is distinct from jsonb_build_array(target.source,target.payload) then
        raise exception 'The entry changed. Reload before reviewing' using errcode = '40001';
      end if;
      if target.reviewed then return; end if;
      insert into private.hub_register_reviews values (p_hub,p_date,p_book,employee,p_data)
      on conflict (hub_id,work_date,book,employee_id) do update set reviewed = excluded.reviewed;
      p_data := jsonb_build_object('employee_id',p_employee,'value',target.payload);
    else
      if p_employee is distinct from me.id and reason is null then
        raise exception 'Give the reason for entering on behalf of the employee' using errcode = '22023';
      end if;
      if target.source = 'existing' or (p_employee is distinct from me.id and target.source = 'self')
        or (target.reviewed and last_action is distinct from 'reopen') then
        raise exception 'Use the original entry or reopen the reviewed register' using errcode = '55000';
      end if;
      perform private.hub_register_check(p_book,p_data);
      if p_book = 'attendance' and (p_data->>'application_date')::date > private.wf_today() then
        raise exception 'External application date cannot be in the future' using errcode = '22023';
      end if;
      previous := target.payload;
      if previous = p_data then return; end if;
      insert into private.hub_register_entries values (p_hub,p_date,p_book,p_employee,p_data,auth.uid(),reason)
      on conflict (hub_id,work_date,book,employee_id) do update
      set payload = excluded.payload,actor = excluded.actor,reason = excluded.reason;
      delete from private.hub_register_reviews r
      where (r.hub_id,r.work_date,r.book,r.employee_id) = (p_hub,p_date,p_book,employee);
      p_data := jsonb_build_object('employee_id',p_employee,'before',previous,'after',p_data,'reason',reason);
    end if;
  end if;
  insert into private.hub_register_events (hub_id,work_date,book,action,actor,data)
  values (p_hub,p_date,p_book,p_action,auth.uid(),p_data);
end
$$;

revoke all on function private.hub_register_source(uuid,date,text,uuid), private.hub_register_rows(uuid,date,text),
  private.hub_register_check(text,jsonb), private.hub_register_totals(jsonb) from public, anon, authenticated;
revoke all on function public.hub_register_read(uuid,date,date),
  public.hub_register_write(uuid,date,text,text,uuid,jsonb,text) from public, anon;
grant execute on function public.hub_register_read(uuid,date,date),
  public.hub_register_write(uuid,date,text,text,uuid,jsonb,text) to authenticated;
