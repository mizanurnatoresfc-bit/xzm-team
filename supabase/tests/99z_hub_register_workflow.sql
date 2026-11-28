begin;
select tests.fixture();
select tests.hr_fixture();

insert into tests.ids values
 ('demo_staff', tests.make_user('register-staff@test.local','DEMO Staff'));
insert into tests.ids values
 ('demo_rider_employee', tests.active_employee('DEMO Rider','861',tests.id('hub_a1'),'01711000861','8610101010',15000,tests.id('rider_login'))),
 ('demo_staff_employee', tests.active_employee('DEMO Staff','862',tests.id('hub_a1'),'01711000862','8620101010',15000,tests.id('demo_staff')));
update public.hubs set name = 'DEMO Hub' where id = tests.id('hub_a1');
select tests.grant_role(tests.id('demo_staff'),'staff','hub',null,tests.id('hub_a1'));
select tests.grant_role(tests.id('rider_login'),'rider','hub',null,tests.id('hub_a1'));
insert into tests.ids values ('demo_manager', tests.make_user('register-manager@test.local','DEMO Manager'));
select tests.grant_role(tests.id('demo_manager'),'hub_manager','hub',null,tests.id('hub_a1'));

create function tests.register_day() returns date language sql stable as $$
  select (now() at time zone 'Asia/Dhaka')::date
$$;
create function tests.register_book(b text) returns jsonb language sql stable as $$
  select x from jsonb_array_elements(public.hub_register_read(tests.id('hub_a1'))->'books') x where x->>'id' = b
$$;
create function tests.register_row(b text,e text) returns jsonb language sql stable as $$
  select x from jsonb_array_elements(tests.register_book(b)->'rows') x where x->>'employee_id' = tests.id(e)::text
$$;
create function tests.register_write(b text,a text,e text default null,d jsonb default null,r text default null)
returns void language sql as $$
  select public.hub_register_write(tests.id('hub_a1'),tests.register_day(),b,a,
    case when e is not null then tests.id(e) end,d,r)
$$;
create function tests.register_error(q text) returns text language plpgsql as $$
begin execute q; return null; exception when others then return sqlstate; end $$;

select tests.ok(not has_function_privilege('anon','public.hub_register_read(uuid,date,date)','execute')
  and not has_function_privilege('anon','public.hub_register_write(uuid,date,text,text,uuid,jsonb,text)','execute')
  and not has_function_privilege('authenticated','private.hub_register_source(uuid,date,text,uuid)','execute'),
  'register RPCs deny anonymous access and source helper access');

select tests.login(tests.id('rider_login'));
select tests.ok(jsonb_array_length(tests.register_book('attendance')->'rows') = 1,'DEMO Rider sees only their own entry');
select tests.ok(tests.register_error($$select public.hub_register_read(tests.id('hub_a2'))$$) = '42501','rider cannot read another hub');
select tests.ok(tests.register_error($$select tests.register_write('pickup','save','demo_staff_employee','{"pickup":1,"merchant_return":0}')$$)
  = '42501','rider cannot enter on behalf of another employee');
select tests.register_write('attendance','save','demo_rider_employee',
  jsonb_build_object('status','leave','application_date',tests.register_day()));
select tests.ok(tests.register_row('attendance','demo_rider_employee')->'payload' =
  jsonb_build_object('status','leave','application_date',tests.register_day()),'leave application stores the date alone');
select tests.register_write('pickup','save','demo_rider_employee','{"pickup":1,"merchant_return":0}');
select public.wf_pending_today(3,tests.register_day());
select public.wf_pending_today(4,tests.register_day());
select tests.logout();

select tests.login(tests.id('demo_staff'));
select tests.register_write('expense','save','demo_staff_employee','{"expense":25.50,"bills":1}');
select tests.ok(tests.register_row('expense','demo_staff_employee') #>> '{payload,expense}' = '25.50'
  and tests.register_row('expense','demo_rider_employee') is null,'DEMO Staff saves and sees their own expense alone');
select tests.ok(tests.register_error($$select tests.register_write('expense','submit')$$) = '42501','staff cannot submit a whole book');
select tests.logout();

insert into public.wf_daily_ops(employee_id,hub_id,work_date,pickup,pickup_return,delivery,delivery_return)
values(tests.id('demo_rider_employee'),tests.id('hub_a1'),tests.register_day(),5,2,7,1);

select tests.login(tests.id('demo_manager'));
select tests.ok(jsonb_array_length(public.hub_register_read(tests.id('hub_a1'))->'books') = 5
  and jsonb_array_length(tests.register_book('pickup')->'rows') >= 2,'DEMO Manager sees five books and auto roster');
select tests.ok(tests.register_row('pickup','demo_rider_employee') #>> '{payload,pickup}' = '5'
  and tests.register_row('pending','demo_rider_employee')->'payload' = '{"pending":4,"return":1}',
  'existing operation takes precedence and latest pending snapshot counts once');
select tests.ok(tests.register_error($$select tests.register_write('pickup','submit')$$) = '22023','missing or unreviewed entries block final submission');
select tests.ok(tests.register_error($$select tests.register_write('pickup','rule',null,'{"required":false,"duty":"All","due_at":"10:00"}')$$)
  = '42501','manager cannot configure deadlines');
select tests.register_write('delivery','save','demo_rider_employee','{"delivery":7,"cash":700,"mobile":25,"due":10}','DEMO handover');
select tests.ok(tests.register_row('delivery','demo_rider_employee')->>'source' = 'proxy','manager can fill missing data on behalf of rider');
select tests.logout();

select tests.login(tests.id('zonal_a'));
select tests.ok(tests.register_error($$select public.hub_register_read(tests.id('hub_b1'))$$) = '42501','DEMO Zonal Manager cannot read another zone');
select tests.register_write('pending','rule',null,'{"required":false,"duty":"No assigned duty","due_at":"13:00"}');
select tests.register_write('pending','rule','demo_rider_employee','{"required":true,"duty":"Parcel handover","due_at":"16:30"}');
select tests.ok(jsonb_array_length(tests.register_book('pending')->'rows') = 1
  and tests.register_row('pending','demo_rider_employee')->>'duty' = 'Parcel handover'
  and ((tests.register_row('pending','demo_rider_employee')->>'due')::timestamptz at time zone 'Asia/Dhaka')::time = time '16:30',
  'employee assignment overrides hub default and sets Dhaka deadline');
select tests.logout();

select tests.login(tests.id('demo_manager'));
select tests.ok(tests.register_error($$select tests.register_write('pending','review','demo_rider_employee','["existing",{"pending":3,"return":1}]')$$)
  = '40001','stale review is rejected');
select tests.register_write('pending','review','demo_rider_employee','["existing",{"pending":4,"return":1}]');
select tests.register_write('pending','submit');
select tests.register_write('pending','submit');
select tests.ok(tests.register_book('pending')->>'locked' = 'true'
  and (select count(*) from jsonb_array_elements(tests.register_book('pending')->'history') e where e->>'action' = 'submit') = 1,
  'submission locks the book and a repeated request does not duplicate it');
select tests.ok((public.hub_register_read(tests.id('hub_a1'),null,tests.register_day()) #>> '{month,0,totals,pending}') = '4',
  'monthly report includes locked daily totals once');
select tests.ok(tests.register_error($$select tests.register_write('pending','reopen',null,null,'Manager reason')$$) = '42501',
  'manager cannot reopen a locked book');
select tests.logout();

select tests.login(tests.id('zonal_a'));
select tests.register_write('pending','reopen',null,null,'Correct pending count');
select tests.ok(tests.register_book('pending')->>'locked' = 'false'
  and tests.register_book('pending') #>> '{history,0,data,reason}' = 'Correct pending count',
  'zonal manager reopens with a recorded reason');
select tests.logout();
rollback;
