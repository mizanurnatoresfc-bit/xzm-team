-- Menu editor, icons (owner, 22 Nov 2026): a menu row and a panel can now carry their own icon, picked in
-- "সেটিং ও অনুমতি → মেনু এডিটর". The saved value is only the icon's name from the app's own icon set
-- ({ "items": { "/app/hub/routes": { "icon": "truck" } }, "groups": { "hub": { "icon": "hub" } } });
-- a name the app does not know falls back to the icon written in the code. Everything else is as in 000600.

create or replace function public.menu_layout_save(p_layout jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare part text; k text; v jsonb; f text; fv jsonb;
begin
  if not private.has_permission('system.settings.configure') then
    raise exception 'You are not allowed to change the menu.' using errcode = '42501';
  end if;
  if p_layout is null or jsonb_typeof(p_layout) <> 'object' then
    raise exception 'Nothing to save.' using errcode = '22023';
  end if;
  if length(p_layout::text) > 65536 then
    raise exception 'The menu layout is too large.' using errcode = '22023';
  end if;
  for part in select jsonb_object_keys(p_layout) loop
    if part not in ('items', 'groups', 'secs') or jsonb_typeof(p_layout -> part) <> 'object' then
      raise exception 'Unknown menu part: %.', part using errcode = '22023';
    end if;
    for k, v in select * from jsonb_each(p_layout -> part) loop
      if length(k) > 120 or jsonb_typeof(v) <> 'object' then
        raise exception 'Bad menu entry: %.', k using errcode = '22023';
      end if;
      for f, fv in select * from jsonb_each(v) loop
        if f in ('bn', 'en') then
          if jsonb_typeof(fv) <> 'string' or length(fv #>> '{}') > 80 then
            raise exception 'A menu name must be text of up to 80 letters (%).', k using errcode = '22023';
          end if;
        elsif f = 'icon' and part in ('items', 'groups') then
          if jsonb_typeof(fv) <> 'string' or (fv #>> '{}') !~ '^[a-z][a-z0-9_]{0,31}$' then
            raise exception 'Bad icon name (%).', k using errcode = '22023';
          end if;
        elsif f = 'hide' and part = 'items' then
          if jsonb_typeof(fv) <> 'boolean' then raise exception 'Bad hide value (%).', k using errcode = '22023'; end if;
        elsif f = 'order' and part = 'items' then
          if jsonb_typeof(fv) <> 'number' then raise exception 'Bad order value (%).', k using errcode = '22023'; end if;
        elsif f = 'new_until' and part = 'items' then
          if fv <> 'null'::jsonb and (jsonb_typeof(fv) <> 'string' or (fv #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$') then
            raise exception 'Bad "new" date (%).', k using errcode = '22023';
          end if;
        else
          raise exception 'Unknown menu field: % (%).', f, k using errcode = '22023';
        end if;
      end loop;
    end loop;
  end loop;
  insert into public.system_settings (key, value, description, is_public, updated_by)
  values ('menu.layout', p_layout, 'Menu names, icons, order, hidden rows and "new" dates (menu editor)', false, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
end $$;

revoke all on function public.menu_layout_save(jsonb) from public, anon;
grant execute on function public.menu_layout_save(jsonb) to authenticated;
