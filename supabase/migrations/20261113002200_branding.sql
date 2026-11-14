-- =====================================================================
-- XZM-TEAM ERP — Migration 0022: branding a person can change
--
-- The name, the short mark, the one-line description, the logo, the favicon and
-- the colour all sit in system_settings under branding.*, which anyone may read
-- before signing in (the login page needs them) and only someone with
-- system.settings.configure may write. Pictures are kept as data URLs and are
-- always shown through an <img>, never put into the page as markup, so a picture
-- can never run anything. The guard below holds that line in the database too.
-- =====================================================================

insert into public.system_settings (key, value, description, is_public) values
  ('branding.name_bn',    '"XZM-TEAM"', 'Name in Bangla', true),
  ('branding.short_name', '"X"',        'Short mark shown when there is no logo', true),
  ('branding.tagline',    '{"bn":"নিজের কাজের জন্য নিজের টুল","en":"My own tool for my own work"}',
                          'One line under the name', true),
  ('branding.logo',       '"data:image/svg+xml,<svg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 64 64%27 role=%27img%27 aria-label=%27XZM-TEAM%27> <defs><linearGradient id=%27g%27 x1=%270%27 y1=%270%27 x2=%271%27 y2=%271%27> <stop offset=%270%27 stop-color=%27%2317A95B%27/><stop offset=%271%27 stop-color=%27%230A4D27%27/></linearGradient></defs> <rect width=%2764%27 height=%2764%27 rx=%2715%27 fill=%27url(%23g)%27/> <path d=%27M19.5 18.5 L44.5 45.5 M44.5 18.5 L19.5 45.5%27 stroke=%27%23ffffff%27 stroke-width=%277.5%27 stroke-linecap=%27round%27/> <path d=%27M12 52.5 h40%27 stroke=%27%23ffffff%27 stroke-opacity=%27.55%27 stroke-width=%273%27 stroke-linecap=%27round%27/> </svg>"', 'Logo as a data URL (SVG, PNG or JPEG)', true),
  ('branding.favicon',    '"data:image/svg+xml,<svg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 64 64%27 role=%27img%27 aria-label=%27XZM-TEAM%27> <defs><linearGradient id=%27g%27 x1=%270%27 y1=%270%27 x2=%271%27 y2=%271%27> <stop offset=%270%27 stop-color=%27%2317A95B%27/><stop offset=%271%27 stop-color=%27%230A4D27%27/></linearGradient></defs> <rect width=%2764%27 height=%2764%27 rx=%2715%27 fill=%27url(%23g)%27/> <path d=%27M19.5 18.5 L44.5 45.5 M44.5 18.5 L19.5 45.5%27 stroke=%27%23ffffff%27 stroke-width=%277.5%27 stroke-linecap=%27round%27/> <path d=%27M12 52.5 h40%27 stroke=%27%23ffffff%27 stroke-opacity=%27.55%27 stroke-width=%273%27 stroke-linecap=%27round%27/> </svg>"', 'Browser tab icon as a data URL', true)
on conflict (key) do nothing;

-- Pictures: a data URL of a picture, nothing else, and nothing that could run.
create or replace function private.branding_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if new.key not in ('branding.logo', 'branding.favicon') then return new; end if;
  if jsonb_typeof(new.value) = 'null' then return new; end if;
  if jsonb_typeof(new.value) <> 'string' then
    raise exception 'The logo must be a picture address (data URL).' using errcode = '22023';
  end if;
  v := new.value #>> '{}';
  if v !~ '^data:image/(svg\+xml|png|jpeg|webp)[,;]' then
    raise exception 'Only an SVG, PNG, JPEG or WebP picture can be used here.' using errcode = '22023';
  end if;
  if length(v) > 262144 then
    raise exception 'The picture is too large (256 KB at most).' using errcode = '22023';
  end if;
  if v ~* '<script|javascript:|onload=|onerror=|onclick=|<foreignobject' then
    raise exception 'This picture carries something that can run, so it cannot be used.' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger system_settings_branding_guard before insert or update on public.system_settings
  for each row execute function private.branding_guard();

-- Everything the login page and the app need, in one read, before sign-in.
create or replace function public.branding() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(replace(s.key, 'branding.', ''), s.value), '{}'::jsonb)
    from public.system_settings s
   where s.key like 'branding.%' and s.is_public
$$;

create or replace function public.branding_save(p_values jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare k text; v jsonb;
begin
  if not private.has_permission('system.settings.configure') then
    raise exception 'You are not allowed to change the branding.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_values) <> 'object' then
    raise exception 'Nothing to save.' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(p_values) loop
    if k not in ('company_name','name_bn','short_name','tagline','logo','favicon','theme','system_title',
                 'address','contact_phone','contact_email') then
      raise exception 'Unknown branding setting: %.', k using errcode = '22023';
    end if;
    insert into public.system_settings (key, value, description, is_public)
    values ('branding.' || k, v, 'Branding', true)
    on conflict (key) do update set value = excluded.value;
  end loop;
end $$;

revoke all on function public.branding() from public;
grant execute on function public.branding() to anon, authenticated;
revoke all on function public.branding_save(jsonb) from public, anon;
grant execute on function public.branding_save(jsonb) to authenticated;
