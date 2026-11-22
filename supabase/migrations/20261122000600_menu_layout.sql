-- Menu editor (owner, 22 Nov 2026): the sidebar's names, order, hidden rows and "নতুন" dates are kept in the database,
-- so Super Admin can change them from "সেটিং ও অনুমতি → মেনু এডিটর" without touching the code.
--
-- One row in system_settings, key 'menu.layout':
--   { "items":  { "/app/hub/routes": { "bn": "...", "en": "...", "hide": false, "order": 3, "new_until": "2026-12-15" }, ... },
--     "groups": { "hub":   { "bn": "...", "en": "..." }, ... },
--     "secs":   { "hub:0": { "bn": "...", "en": "..." }, ... } }
-- Anything left out keeps the name written in the code. Who may open a page is still decided only by the role's
-- permissions and page list: hiding a row here never opens anything, and showing one never grants anything.

create or replace function public.menu_layout() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.value from public.system_settings s where s.key = 'menu.layout'), '{}'::jsonb)
$$;

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
  values ('menu.layout', p_layout, 'Menu names, order, hidden rows and "new" dates (menu editor)', false, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
end $$;

revoke all on function public.menu_layout() from public, anon;
grant execute on function public.menu_layout() to authenticated;
revoke all on function public.menu_layout_save(jsonb) from public, anon;
grant execute on function public.menu_layout_save(jsonb) to authenticated;
