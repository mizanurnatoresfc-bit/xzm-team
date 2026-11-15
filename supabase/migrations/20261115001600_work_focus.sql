-- =====================================================================
-- XZM-TEAM ERP — Migration: work focus inside one post
--
--  One post can hold people who mainly do different work. "Sorting + Loader"
--  stays ONE post, but each person is marked Sorting (blue) or Loader
--  (orange); the profile shows it in its colour, and duties written for a
--  focus reach only the people with that focus.
--  * positions.focus_options: the focuses a post offers (code, names, colour)
--  * employees.work_focus: the person's focus (one of their post's focuses)
--  * job_duties.focus: a duty for one focus of the post (null = everyone in it)
--  * hr_set_work_focus(): HR / duty editors set it; changing post clears it
-- =====================================================================

alter table public.positions add column if not exists focus_options jsonb not null default '[]'::jsonb;
alter table public.positions drop constraint if exists positions_focus_options_array;
alter table public.positions add constraint positions_focus_options_array check (jsonb_typeof(focus_options) = 'array');
alter table public.employees add column if not exists work_focus text;
alter table public.job_duties add column if not exists focus text;

update public.positions
   set focus_options = '[{"code":"sorting","label":"Sorting","label_bn":"সর্টিং","color":"blue"},
                         {"code":"loader","label":"Loader","label_bn":"লোডার","color":"orange"}]'::jsonb
 where code = 'SHORTINGLOAD' and focus_options = '[]'::jsonb;

-- A focus must be one the post offers; a new post clears an old focus.
create or replace function private.employee_focus_check() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.work_focus is not null and not exists (
       select 1 from public.positions p, jsonb_array_elements(p.focus_options) o
        where p.id = new.position_id and o ->> 'code' = new.work_focus) then
    if tg_op = 'UPDATE' and new.position_id is distinct from old.position_id then
      new.work_focus := null;
    else
      raise exception 'This work focus is not one of the post''s focuses.' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists employees_work_focus on public.employees;
create trigger employees_work_focus before insert or update of work_focus, position_id on public.employees
  for each row execute function private.employee_focus_check();

create or replace function public.hr_set_work_focus(p_employee uuid, p_focus text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (private.employee_has_permission('hr.employee.edit', p_employee)
          or private.employee_has_permission('hr.duty.edit', p_employee)) then
    raise exception 'Not authorised to set the work focus.' using errcode = '42501';
  end if;
  update public.employees set work_focus = nullif(trim(p_focus), '') where id = p_employee and archived_at is null;
  if not found then raise exception 'Employee not found.' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.hr_set_work_focus(uuid, text) from public, anon;
grant execute on function public.hr_set_work_focus(uuid, text) to authenticated;

-- My duties: the person's own, the post's for everyone, and the post's for the person's focus.
create or replace function public.my_duties(p_employee uuid default null)
returns table (id uuid, title text, details text, frequency text, source text)
language sql stable security invoker set search_path = '' as $$
  with me as (select e.id, e.position_id, e.work_focus from public.employees e
               where e.id = coalesce(p_employee, private.my_employee_id()))
  select d.id, d.title, d.details, d.frequency, case when d.employee_id is not null then 'person' else 'post' end
    from public.job_duties d, me
   where d.archived_at is null
     and (d.employee_id = me.id
       or (d.position_id = me.position_id and (d.focus is null or d.focus = me.work_focus)))
   order by d.sort, d.title
$$;
