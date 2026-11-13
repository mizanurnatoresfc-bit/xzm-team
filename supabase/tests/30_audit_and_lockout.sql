-- Audit trail is complete and tamper-proof; login lockout works.
begin;
select tests.fixture();

-- Changes are audited with actor, old/new values and reason.
select tests.login(tests.id('zonal_a'));
select set_config('app.change_reason', 'New hub phone line', true);
update public.hubs set phone = '01811111111' where code = 'A1';
select tests.logout();
select tests.ok(exists (
  select 1 from public.audit_logs
  where table_name = 'hubs' and action = 'UPDATE'
    and actor_id = tests.id('zonal_a')
    and record_id = tests.id('hub_a1')::text
    and old_data ->> 'phone' is null and new_data ->> 'phone' = '01811111111'
    and changed_fields = array['phone']
    and reason = 'New hub phone line'), 'hub update audited with actor, diff and reason');

select tests.login(tests.id('admin'));
select public.archive_org_unit('zones', tests.id('zone_b'), 'Zone merged');
select tests.logout();
select tests.ok(exists (select 1 from public.audit_logs where table_name = 'zones' and action = 'ARCHIVE'
                        and reason = 'Zone merged'), 'archive recorded as ARCHIVE with reason');

select tests.ok(exists (select 1 from public.audit_logs where table_name = 'user_roles' and action = 'INSERT'),
                'role assignments are audited');

-- Only permitted users can read the audit log.
select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.row_count('select * from public.audit_logs') = 0, 'hub manager cannot read audit log');
select tests.login(tests.id('auditor'));
select tests.ok(tests.row_count('select * from public.audit_logs') > 0, 'auditor can read audit log');
select tests.throws('update public.audit_logs set reason = null', 'auditor cannot modify audit log', '42501');
select tests.throws($$insert into public.audit_logs (action, module) values ('FAKE','x')$$, 'users cannot forge audit entries', '42501');

-- Even the database owner cannot alter or delete audit history.
select tests.logout();
select tests.throws('update public.audit_logs set reason = null', 'owner cannot update audit log', 'P0001');
select tests.throws('delete from public.audit_logs', 'owner cannot delete audit log', 'P0001');

-- Lockout: browser roles cannot call the login recorder.
select tests.login(tests.id('hub_mgr'));
select tests.throws($$select public.record_login_attempt('hub.a1@test.local', true, 'staff')$$,
                    'authenticated users cannot call record_login_attempt', '42501');
select tests.login_anon();
select tests.throws($$select public.record_login_attempt('hub.a1@test.local', true, 'staff')$$,
                    'anon cannot call record_login_attempt', '42501');

-- Server side (service role): 5 failures lock the account, success resets.
select tests.logout();
select public.record_login_attempt('hub.a1@test.local', false, 'staff', 'bad password') from generate_series(1, 4);
select tests.ok((select locked_until is null and failed_login_count = 4 from public.profiles where id = tests.id('hub_mgr')),
                'four failures do not lock');
select tests.ok((select locked from public.record_login_attempt('hub.a1@test.local', false, 'staff', 'bad password')),
                'fifth failure locks the account');
select tests.ok((select count(*) = 5 from public.login_events where user_id = tests.id('hub_mgr') and not success),
                'failed attempts are logged');
select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.row_count('select * from public.hubs') = 0, 'locked account has no data access');
select tests.ok(tests.row_count('select * from public.login_events') = 5, 'user can see own login history');
select tests.logout();
select tests.ok((select not locked from public.record_login_attempt('unknown@test.local', false, 'staff')),
                'unknown email is logged without revealing anything');
update public.profiles set locked_until = null, failed_login_count = 0 where id = tests.id('hub_mgr');
select public.record_login_attempt('hub.a1@test.local', true, 'staff');
select tests.ok((select last_login_at is not null from public.profiles where id = tests.id('hub_mgr')),
                'successful login records last_login_at');
select tests.throws('delete from public.login_events', 'login history cannot be deleted', 'P0001');

-- Bootstrap super admin refuses when one already exists.
select tests.throws($$select private.bootstrap_super_admin('noroles@test.local')$$,
                    'bootstrap refuses when a super admin exists');

-- Profiles cannot be deleted (employee/user history is preserved).
select tests.throws(format('delete from public.profiles where id = %L', tests.id('noroles')),
                    'profiles cannot be deleted', 'P0001');

rollback;
