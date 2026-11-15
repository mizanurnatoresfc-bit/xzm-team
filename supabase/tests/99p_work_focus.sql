-- Work focus inside one post: Sorting / Loader on "Sorting + Loader".
begin;
select tests.fixture();
select tests.hr_fixture();
create temp table t (k text primary key, v uuid);
grant all on t to authenticated;
insert into t select 'pos', id from public.positions where archived_at is null limit 1;
update public.positions set focus_options = '[{"code":"sorting","label":"Sorting","label_bn":"সর্টিং","color":"blue"},{"code":"loader","label":"Loader","label_bn":"লোডার","color":"orange"}]'
 where id = (select v from t where k = 'pos');
insert into t values ('emp', tests.active_employee('Focus Person', 'XZ-00091', tests.id('hub_a1'), '01711000091', '1234567891'));
update public.employees set position_id = (select v from t where k = 'pos') where id = (select v from t where k = 'emp');

select tests.login(tests.id('hr'));
select public.hr_set_work_focus((select v from t where k = 'emp'), 'sorting');
select tests.ok((select work_focus = 'sorting' from public.employees where id = (select v from t where k = 'emp')), 'HR marks a person as Sorting');
select tests.throws(format($$select public.hr_set_work_focus(%L, 'driving')$$, (select v from t where k = 'emp')),
  'a focus the post does not offer is refused', '22023');
select tests.logout();

-- duties for a focus reach only that focus
insert into public.job_duties (position_id, title, focus) values
  ((select v from t where k = 'pos'), 'Sort parcels by route', 'sorting'),
  ((select v from t where k = 'pos'), 'Load the van', 'loader'),
  ((select v from t where k = 'pos'), 'Attend morning briefing', null);
select tests.ok((select array_agg(title order by title) from public.my_duties((select v from t where k = 'emp')))
                = array['Attend morning briefing', 'Sort parcels by route'],
  'a Sorting person sees the post''s common duties and the sorting duties, not loading');

-- another post clears the focus
update public.employees set position_id = (select id from public.positions where id <> (select v from t where k = 'pos') and archived_at is null limit 1)
 where id = (select v from t where k = 'emp');
select tests.ok((select work_focus is null from public.employees where id = (select v from t where k = 'emp')), 'a new post clears the old focus');
rollback;
