-- Employee IDs as plain numbers starting at 1 (the office's own numbering), while
-- still accepting the older "XZ-1234" style so existing records stay valid.
update public.system_settings
   set value = to_jsonb('^([A-Z]{2,4}-[0-9]{3,6}|[1-9][0-9]{0,5})$'::text),
       description = 'Employee ID format: a number from 1 (e.g. 14) or the older XZ-1234 style'
 where key = 'hr.employee_code_pattern';

-- Suggests the next free numeric Employee ID for the approval screen. Only people who
-- can approve applications may ask. The approver can still type another free number.
create or replace function public.hr_next_employee_code()
returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.my_grants() g where g.permission_code = 'hr.application.approve' or g.is_super) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return (select (coalesce(max((employee_code::text)::bigint), 0) + 1)::text
            from public.employees where employee_code::text ~ '^[0-9]{1,9}$');
end $$;
revoke all on function public.hr_next_employee_code() from public, anon;
grant execute on function public.hr_next_employee_code() to authenticated;
