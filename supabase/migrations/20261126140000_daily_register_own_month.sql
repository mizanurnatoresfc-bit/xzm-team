create or replace function public.wf_ops_own_month(p_month date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  employee public.employees;
  current_month date := date_trunc('month', private.wf_today()::timestamp)::date;
  first_day date := date_trunc('month', p_month::timestamp)::date;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if first_day < current_month - interval '1 month' or first_day > current_month then
    raise exception 'Only the current and previous month are available' using errcode = '22023';
  end if;
  employee := private.wf_me();
  if employee.id is null or first_day is null then
    return '[]'::jsonb;
  end if;
  return (
    select coalesce(jsonb_agg(private.wf_ops_json(entry) order by entry.work_date), '[]'::jsonb)
    from public.wf_daily_ops entry
    where entry.employee_id = employee.id
      and entry.work_date >= first_day
      and entry.work_date < first_day + interval '1 month'
      and entry.work_date <= private.wf_today()
  );
end;
$$;

revoke all on function public.wf_ops_own_month(date) from public, anon;
grant execute on function public.wf_ops_own_month(date) to authenticated;
