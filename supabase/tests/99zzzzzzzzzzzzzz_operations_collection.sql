begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
  ('collection_user', tests.make_user('collection.rider@test.local', 'Collection Rider')),
  ('collection_employee', tests.active_employee('Collection Rider', '704', tests.id('hub_a1'), '01711000704', '7040101010'));
update public.employees set profile_id = tests.id('collection_user') where id = tests.id('collection_employee');

select tests.login(tests.id('zonal_a'));
select tests.ok(public.operation_collection(tests.id('zone_b')) = '[]'::jsonb, 'another zone has no visible collection data');
select tests.throws(format('select public.operation_baseline_save(%L, 1, 1, 1)', tests.id('hub_b1')), 'another zone cannot be edited', '42501');
select public.operation_baseline_save(tests.id('hub_a1'), 30, 85, 120);
select public.operation_baseline_save(tests.id('hub_a1'), 30, 85, 125);
select tests.ok(exists (
  select 1 from jsonb_array_elements(public.operation_collection(tests.id('zone_a'))) h
  where h->>'id' = tests.id('hub_a1')::text and h#>>'{baseline,received}' = '125'
    and h#>'{actual,received}' = 'null'::jsonb
), 'the latest fixed average is available while the actual is missing');
create temp table collection_question as
  select public.operation_question_send(tests.id('hub_a1'), tests.id('collection_employee'), 'delivery_pending', 'How many pending?') as id;
grant select on collection_question to authenticated;

select tests.login(tests.id('hub_mgr'));
select tests.ok(public.operation_questions_today() = '[]'::jsonb, 'another employee does not see the question');
select tests.throws('select public.operation_question_answer(id, 5) from collection_question', 'another employee cannot answer', '42501');

select tests.login(tests.id('collection_user'));
select tests.ok(jsonb_array_length(public.operation_questions_today()) = 1, 'the targeted employee sees the question');
select public.operation_question_answer(id, 5) from collection_question;
select public.operation_question_answer(id, 0) from collection_question;
select tests.ok(public.operation_questions_today()#>>'{0,value}' = '0', 'a revised zero counts as an answer');

select tests.login(tests.id('zonal_a'));
select tests.ok(public.operation_questions_today(tests.id('hub_a1'))#>>'{0,value}' = '0', 'the zone sees the latest answer');
select tests.logout();
select tests.ok((select count(*) = 2 from private.operation_answers), 'the previous answer remains recorded');
rollback;
