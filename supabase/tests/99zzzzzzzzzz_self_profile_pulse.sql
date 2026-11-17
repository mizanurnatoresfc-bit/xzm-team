-- Staff complete their own profile; the zonal manager's popup question.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values ('s2_login', tests.make_user('s2@test.local', 'Staff Two'));
insert into tests.ids values
  ('me', tests.active_employee('Rider Me', '981', tests.id('hub_a1'), '01711000981', '9810101010', 15000, tests.id('rider_login'))),
  ('other', tests.active_employee('Rider Two', '982', tests.id('hub_a2'), '01711000982', '9820101010', 15000, tests.id('s2_login'))),
  ('b', tests.active_employee('B Rider', '983', tests.id('hub_b1'), '01711000983', '9830101010'));

-- ---------- self profile ----------
select tests.login(tests.id('rider_login'));
select tests.ok((public.hr_hub_profile_get(tests.id('me'))->>'full_name') = 'Rider Me', 'staff read their own profile form');
select public.hr_hub_profile_save(tests.id('me'), '{"emergency_contact_name":"মা","emergency_contact_phone":"01811000000","father_name":"Abdul","present_address":"নাটোর"}'::jsonb);
select tests.ok((public.hr_hub_profile_get(tests.id('me'))->'has'->>'father_name')::boolean, 'staff fill their own identity details');
select tests.ok((public.hr_hub_profile_get(tests.id('me'))->>'emergency_contact_name') = 'মা', 'staff fill their own contact details');
select tests.throws(format($$select public.hr_hub_profile_save(%L, '{"mobile":"01711000982"}'::jsonb)$$, tests.id('me')), 'another person''s mobile is refused', '23505');
select tests.throws(format($$select public.hr_hub_profile_get(%L)$$, tests.id('other')), 'staff cannot open someone else''s profile', '42501');
select tests.ok(private.can_upload_employee_object('employee/' || tests.id('me') || '/x-photo.jpg'), 'staff may upload their own photo');
select tests.ok(not private.can_upload_employee_object('employee/' || tests.id('other') || '/x.jpg'), 'not into someone else''s folder');

-- ---------- popup question ----------
select tests.throws(format($$select public.pulse_create(%L, 'Test?')$$, tests.id('zone_a')), 'staff cannot ask the zone', '42501');
select tests.login(tests.id('zonal_a'));
insert into tests.ids select 'q1', public.pulse_create(tests.id('zone_a'), 'আজ গাড়ি সময়মতো এসেছে?', null, 'yes_no_text');
insert into tests.ids select 'q2', public.pulse_create(tests.id('zone_a'), 'হাব A2-এর জন্য', null, 'text', array[tests.id('hub_a2')]);
select tests.throws(format($$select public.pulse_create(%L, 'x?', null, 'yes_no', array[%L]::uuid[])$$, tests.id('zone_a'), tests.id('hub_b1')), 'a hub of another zone is refused', '22023');
select tests.throws(format($$select public.pulse_create(%L, 'x?')$$, tests.id('zone_b')), 'not another zone', '42501');
select tests.ok(((select x->>'targets' from jsonb_array_elements(public.pulse_list(tests.id('zone_a'))) x where x->>'id' = tests.id('q1')::text))::int = 2, 'the zone question goes to both zone A staff');
select tests.logout();
select tests.ok(exists (select 1 from public.notifications where profile_id = tests.id('rider_login') and kind = 'pulse'), 'staff are notified');

select tests.login(tests.id('rider_login'));
select tests.ok(jsonb_array_length(public.pulse_mine()) = 1, 'staff of hub A1 see only the zone-wide question');
select tests.throws(format($$select public.pulse_answer(%L)$$, tests.id('q1')), 'yes / no is needed', '22023');
select public.pulse_answer(tests.id('q1'), 'yes', 'ঠিক সময়ে');
select tests.ok(jsonb_array_length(public.pulse_mine()) = 0, 'an answered question does not come back');
select tests.throws(format($$select public.pulse_answer(%L, null, 'x')$$, tests.id('q2')), 'a question for another hub cannot be answered', 'P0002');
select tests.throws(format($$select public.pulse_results(%L)$$, tests.id('q1')), 'staff cannot see the results', '42501');

select tests.login(tests.id('s2_login'));
select tests.ok(jsonb_array_length(public.pulse_mine()) = 2, 'hub A2 staff see both questions');
select public.pulse_answer(tests.id('q2'), null, 'লোক কম');

select tests.login(tests.id('zonal_a'));
select tests.ok((select (x->>'answered')::int = 1 and (x->>'yes')::int = 1 from jsonb_array_elements(public.pulse_list(tests.id('zone_a'))) x where x->>'id' = tests.id('q1')::text), 'counts are right');
select tests.ok((select count(*) filter (where r->>'answer' is null) = 1 from jsonb_array_elements(public.pulse_results(tests.id('q1'))) r), 'who has not answered is listed');
select public.pulse_close(tests.id('q1'));
select tests.login(tests.id('s2_login'));
select tests.ok(jsonb_array_length(public.pulse_mine()) = 0, 'a closed question disappears');
select tests.throws(format($$select public.pulse_answer(%L, 'no')$$, tests.id('q1')), 'a closed question takes no answer', '22023');
select tests.throws('select * from public.pulse_answers', 'answers are not read directly', '42501');
select tests.logout();
rollback;
