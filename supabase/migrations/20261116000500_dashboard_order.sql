-- =====================================================================
--  ড্যাশবোর্ড সাজানো: the order a Super Admin saves is the order people see
--
--  role_dashboards.panels already keeps an order, but dashboard_panels()
--  returned the panels in catalogue order and the home page drew them in a
--  fixed order, so "arrange" did nothing. Now:
--    * dashboard_panels() returns the panels in the saved order of the
--      person's roles (earliest place wins when two roles list a panel);
--      with no layout, in the order the home page has always shown them.
--    * Saved layouts are put once into that same on-screen order, so nobody's
--      home page moves until a Super Admin rearranges it. The set of panels of
--      each role is not changed.
--
--  No table or column changes.
--
--  Rollback: re-run dashboard_panels() from 20261113002000_role_dashboards.sql
--  and drop private.dashboard_screen_order(). The order inside the saved
--  layouts may stay (the old function ignores it).
-- =====================================================================

-- The order the home page has always drawn the panels in.
create or replace function private.dashboard_screen_order() returns text[]
language sql immutable set search_path = '' as $$
  select array['my_day','hub_today','network','approvals','my_requests','my_work','hr_overview','hr_pending',
               'hub_staff','ops_today','cash_today','accounts_today','zonal_overview','quick_links']
$$;

update public.role_dashboards rd
   set panels = (select coalesce(jsonb_agg(x.p order by coalesce(array_position(private.dashboard_screen_order(), x.p), 100), x.o), '[]'::jsonb)
                   from jsonb_array_elements_text(rd.panels) with ordinality x(p, o))
 where jsonb_array_length(rd.panels) > 1
   and rd.panels is distinct from (select coalesce(jsonb_agg(x.p order by coalesce(array_position(private.dashboard_screen_order(), x.p), 100), x.o), '[]'::jsonb)
                                     from jsonb_array_elements_text(rd.panels) with ordinality x(p, o));

create or replace function public.dashboard_panels()
returns text[]
language plpgsql stable security invoker set search_path = '' as $$
declare v_panels text[];
begin
  -- the panels their roles ask for, in the order saved for those roles
  select array_agg(q.panel order by q.pos, q.ord) into v_panels
  from (
    select c.panel, min(x.pos) pos, coalesce(array_position(private.dashboard_screen_order(), c.panel), 100) ord
    from private.dashboard_catalogue() c
    join public.user_roles ur on ur.user_id = auth.uid() and ur.revoked_at is null
     and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date)
    join public.role_dashboards rd on rd.role_id = ur.role_id
    cross join lateral jsonb_array_elements_text(rd.panels) with ordinality x(panel, pos)
    where x.panel = c.panel and private.dashboard_panel_allowed(c.panel)
    group by c.panel
  ) q;

  -- a role with no layout of its own: whatever their permissions allow, in the usual order
  if coalesce(array_length(v_panels, 1), 0) = 0 then
    select array_agg(c.panel order by coalesce(array_position(private.dashboard_screen_order(), c.panel), 100)) into v_panels
    from private.dashboard_catalogue() c
    where private.dashboard_panel_allowed(c.panel);
  end if;
  return coalesce(v_panels, array['my_work','quick_links']);
end $$;

revoke all on function private.dashboard_screen_order() from public, anon;
grant execute on function private.dashboard_screen_order() to authenticated;
revoke all on function public.dashboard_panels() from public, anon;
grant execute on function public.dashboard_panels() to authenticated;
