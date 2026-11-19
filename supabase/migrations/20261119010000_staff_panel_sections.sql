-- =====================================================================
--  স্টাফ প্যানেল, arranged by the Super Admin, per role.
--  * role_dashboards.staff_sections: which sections of the staff panel page
--    (/app/staff) a role sees, in that order. NULL = the standard page (all, in the standard order).
--  * role_staff_sections_save(): Super Admin sets or clears it for one role.
--  * staff_panel_sections(): the caller's list, merged over their active roles
--    (a section shows when any of their roles has it; earliest position wins). NULL = standard page.
--  A section still only shows what the person may already see: every number on it is read under RLS.
-- =====================================================================

create or replace function private.staff_section_ok(p text) returns boolean
language sql immutable set search_path = '' as $$
  select p in ('accounts','work','attendance','bill','route','complaint','issues','people')
$$;

alter table public.role_dashboards add column if not exists staff_sections jsonb;
alter table public.role_dashboards drop constraint if exists role_dashboards_staff_sections_chk;
alter table public.role_dashboards add constraint role_dashboards_staff_sections_chk
  check (staff_sections is null or (jsonb_typeof(staff_sections) = 'array' and jsonb_array_length(staff_sections) <= 12));

create or replace function public.role_staff_sections_save(p_role uuid, p_sections jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare s text;
begin
  if not private.is_super_admin() then
    raise exception 'Only a Super Admin can arrange the staff panel.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.roles r where r.id = p_role) then
    raise exception 'Unknown role.' using errcode = '22023';
  end if;
  if p_sections is not null then
    if jsonb_typeof(p_sections) <> 'array' then raise exception 'The sections must be a list.' using errcode = '22023'; end if;
    for s in select jsonb_array_elements_text(p_sections) loop
      if not private.staff_section_ok(s) then raise exception 'Unknown staff panel section: %.', s using errcode = '22023'; end if;
    end loop;
    if (select count(distinct x) from jsonb_array_elements_text(p_sections) x) <> jsonb_array_length(p_sections) then
      raise exception 'The same section is listed twice.' using errcode = '22023';
    end if;
  end if;
  insert into public.role_dashboards (role_id, panels, staff_sections) values (p_role, '[]'::jsonb, p_sections)
  on conflict (role_id) do update set staff_sections = excluded.staff_sections;
end $$;

create or replace function public.staff_panel_sections()
returns jsonb
language sql stable security definer set search_path = '' as $$
  -- ties (two roles both put something first) follow the standard page order
  select jsonb_agg(s order by pos, array_position(array['accounts','work','attendance','bill','route','complaint','issues','people'], s))
  from (
    select x.s, min(x.pos) pos
    from public.user_roles ur
    join public.role_dashboards rd on rd.role_id = ur.role_id
    cross join lateral jsonb_array_elements_text(rd.staff_sections) with ordinality x(s, pos)
    where ur.user_id = auth.uid() and ur.revoked_at is null
      and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date)
      and rd.staff_sections is not null
    group by x.s
  ) t
$$;

revoke all on function public.role_staff_sections_save(uuid, jsonb) from public, anon;
revoke all on function public.staff_panel_sections() from public, anon;
grant execute on function public.role_staff_sections_save(uuid, jsonb) to authenticated;
grant execute on function public.staff_panel_sections() to authenticated;
