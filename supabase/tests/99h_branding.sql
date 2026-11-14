-- The name, mark, pictures and colour: readable by anyone, writable by the right person only.
begin;
select tests.fixture();

-- ---------- anyone may read it, even before signing in ----------
select tests.logout();
select tests.ok((public.branding() ->> 'short_name') = 'X', 'the short mark is readable before signing in');
select tests.ok((public.branding() ->> 'logo') like 'data:image/svg+xml,%', 'the logo comes with the system');
select tests.ok((public.branding() -> 'tagline' ->> 'bn') is not null, 'the one-line description is there in Bangla');
select tests.ok(not exists (select 1 from jsonb_object_keys(public.branding()) k where k like '%password%'),
  'only branding settings come back from branding()');

-- ---------- only someone with the setting permission may write ----------
select tests.login(tests.id('hr'));
select tests.throws($$select public.branding_save('{"company_name":"Other Name"}'::jsonb)$$,
  'an HR manager cannot rename the system', '42501');
select tests.login(tests.id('super'));
select public.branding_save('{"company_name":"My Work Tool","name_bn":"আমার কাজের টুল","short_name":"MW"}'::jsonb);
select tests.ok((public.branding() ->> 'company_name') = 'My Work Tool', 'the super admin renames the system');
select tests.ok((public.branding() ->> 'name_bn') = 'আমার কাজের টুল', 'the Bangla name is saved as given');
select tests.throws($$select public.branding_save('{"nonsense":"x"}'::jsonb)$$,
  'a setting that does not exist is refused', '22023');

-- ---------- a picture must be a picture, and must not be able to run ----------
select tests.throws($$select public.branding_save('{"logo":"https://example.com/logo.png"}'::jsonb)$$,
  'a link to somewhere else is not accepted as a logo', '22023');
select tests.throws($$select public.branding_save('{"logo":"data:image/svg+xml,<svg onload=alert(1)></svg>"}'::jsonb)$$,
  'a picture that carries something that can run is refused', '22023');
select tests.throws($$select public.branding_save('{"logo":"data:text/html,<b>hi</b>"}'::jsonb)$$,
  'a page pretending to be a picture is refused', '22023');
select tests.ok((public.branding() ->> 'logo') like 'data:image/svg+xml,%', 'after all that, the logo is still the good one');
select public.branding_save('{"logo":"data:image/png;base64,iVBORw0KGgo="}'::jsonb);
select tests.ok((public.branding() ->> 'logo') like 'data:image/png;%', 'a PNG logo is accepted');
select public.branding_save('{"logo":null}'::jsonb);
select tests.ok((public.branding() -> 'logo') = 'null'::jsonb, 'the logo can be taken away again');

-- ---------- the pictures stay public, so the login page can read them ----------
select tests.ok((select bool_and(is_public) from public.system_settings where key like 'branding.%'),
  'every branding setting stays readable before sign-in');
select tests.logout();
select tests.ok((public.branding() ->> 'company_name') = 'My Work Tool', 'the new name shows on the login page too');

rollback;
