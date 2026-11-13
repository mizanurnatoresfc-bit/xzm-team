-- Numeric Employee IDs from 1, with the old XZ-1234 style still accepted.
begin;
select tests.fixture();
select tests.hr_fixture();
select tests.ok('14' ~ private.setting_text('hr.employee_code_pattern'), 'a plain number is a valid Employee ID');
select tests.ok('XZ-1234' ~ private.setting_text('hr.employee_code_pattern'), 'the older XZ-1234 style is still valid');
select tests.ok(not ('0' ~ private.setting_text('hr.employee_code_pattern')), 'IDs start at 1 (0 is not valid)');
select tests.ok(not ('01' ~ private.setting_text('hr.employee_code_pattern')), 'no leading zeros');
select tests.ok(not ('12a' ~ private.setting_text('hr.employee_code_pattern')), 'letters mixed into a number are refused');

select tests.login(tests.id('admin'));
select tests.ok(public.hr_next_employee_code() ~ '^[1-9][0-9]*$', 'next Employee ID suggestion is a number');
select tests.logout();
select tests.active_employee('Numbered Rider', '41', tests.id('hub_a1'), '01711000041', '1234567890');
select tests.login(tests.id('admin'));
select tests.ok(public.hr_next_employee_code()::int >= 42, 'suggestion follows the highest number in use');
select tests.logout();

select tests.login(tests.id('hub_mgr'));
select tests.throws('select public.hr_next_employee_code()', 'a hub manager without approval rights cannot ask for the next ID', '42501');
select tests.logout();
select tests.login_anon();
select tests.throws('select public.hr_next_employee_code()', 'anon cannot ask for the next ID', '42501');
select tests.logout();
rollback;
