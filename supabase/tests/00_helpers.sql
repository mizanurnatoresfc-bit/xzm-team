-- Test helpers (local test database only). Each test file runs in a
-- transaction that is rolled back, so tests never leave data behind.
create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

-- Become an authenticated API user (same GUCs PostgREST sets).
create or replace function tests.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims',
          json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function tests.login_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end $$;

-- Back to the migration/owner role (no JWT).
create or replace function tests.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function tests.ok(p_cond boolean, p_name text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'FAIL: %', p_name;
  end if;
  raise notice 'PASS: %', p_name;
end $$;

-- Asserts that a statement raises an error (optionally with a given SQLSTATE).
create or replace function tests.throws(p_sql text, p_name text, p_state text default null)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_state is not null and sqlstate <> p_state then
      raise exception 'FAIL: % (expected SQLSTATE %, got % — %)', p_name, p_state, sqlstate, sqlerrm;
    end if;
    raise notice 'PASS: %', p_name;
    return;
  end;
  raise exception 'FAIL: % (statement succeeded but should have failed)', p_name;
end $$;

-- Number of rows a statement affects/returns, as the CURRENT role sees it.
create or replace function tests.row_count(p_sql text) returns bigint language plpgsql as $$
declare v bigint;
begin
  execute 'select count(*) from (' || p_sql || ') q' into v;
  return v;
end $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- Creates an auth user (profile is created by trigger) and returns its id.
create or replace function tests.make_user(p_email text, p_name text default 'Test User')
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into auth.users (email, raw_user_meta_data)
  values (p_email, jsonb_build_object('full_name', p_name)) returning id into v;
  return v;
end $$;

create or replace function tests.grant_role(p_user uuid, p_role text, p_scope text default 'global',
                                            p_zone uuid default null, p_hub uuid default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.user_roles (user_id, role_id, scope_type, zone_id, hub_id)
  select p_user, id, p_scope, p_zone, p_hub from public.roles where code = p_role
  returning id into v;
  return v;
end $$;

-- Named fixture ids readable from any role.
create table if not exists tests.ids (name text primary key, id uuid not null);
grant select, insert on tests.ids to anon, authenticated, service_role;
create or replace function tests.id(p_name text) returns uuid language sql stable as $$
  select id from tests.ids where name = p_name
$$;
grant execute on function tests.id(text) to anon, authenticated, service_role;

-- Standard org fixture used by most tests (call inside the test transaction).
create or replace function tests.fixture() returns void language plpgsql as $$
declare
  v_org uuid; v_za uuid; v_zb uuid;
begin
  insert into public.organizations (code, name) values ('XZM', 'XZM-TEAM Ltd') returning id into v_org;
  insert into public.zones (organization_id, code, name) values (v_org, 'ZA', 'Zone A') returning id into v_za;
  insert into public.zones (organization_id, code, name) values (v_org, 'ZB', 'Zone B') returning id into v_zb;
  insert into tests.ids values ('org', v_org), ('zone_a', v_za), ('zone_b', v_zb);
  with h as (
    insert into public.hubs (zone_id, code, name) values
      (v_za, 'A1', 'Hub A1'), (v_za, 'A2', 'Hub A2'), (v_zb, 'B1', 'Hub B1')
    returning id, code)
  insert into tests.ids select 'hub_' || lower(code::text), id from h;

  insert into tests.ids values
    ('super',    tests.make_user('super@test.local',    'Super')),
    ('admin',    tests.make_user('admin@test.local',    'Admin')),
    ('zonal_a',  tests.make_user('zonal.a@test.local',  'Zonal A')),
    ('hub_mgr',  tests.make_user('hub.a1@test.local',   'Hub A1 Mgr')),
    ('auditor',  tests.make_user('auditor@test.local',  'Auditor')),
    ('hr',       tests.make_user('hr@test.local',       'HR')),
    ('inactive', tests.make_user('inactive@test.local', 'Inactive')),
    ('noroles',  tests.make_user('noroles@test.local',  'No Roles'));

  perform tests.grant_role(tests.id('super'),   'super_admin');
  perform tests.grant_role(tests.id('admin'),   'admin');
  perform tests.grant_role(tests.id('zonal_a'), 'zonal_manager', 'zone', v_za);
  perform tests.grant_role(tests.id('hub_mgr'), 'hub_manager',   'hub', null, tests.id('hub_a1'));
  perform tests.grant_role(tests.id('auditor'), 'auditor');
  perform tests.grant_role(tests.id('hr'),      'hr_manager');
  perform tests.grant_role(tests.id('inactive'),'hub_manager',   'hub', null, tests.id('hub_a1'));
  update public.profiles set status = 'inactive' where id = tests.id('inactive');
end $$;

-- HR fixture: departments, positions, extra users. Call after tests.fixture().
create or replace function tests.hr_fixture() returns void language plpgsql as $$
begin
  insert into public.departments (organization_id, code, name) values
    (tests.id('org'), 'OPS', 'Operations'), (tests.id('org'), 'HRD', 'Human Resources'), (tests.id('org'), 'ACC', 'Accounts');
  insert into public.positions (department_id, code, name)
    select id, 'RIDER', 'Rider' from public.departments where code = 'OPS';
  insert into public.positions (department_id, code, name)
    select id, 'HUBACC', 'Hub Accountant' from public.departments where code = 'ACC';
  insert into tests.ids select 'dept_ops', id from public.departments where code = 'OPS';
  insert into tests.ids select 'pos_rider', id from public.positions where code = 'RIDER';
  insert into tests.ids values
    ('hr2',      tests.make_user('hr2@test.local', 'HR Two')),
    ('acct_mgr', tests.make_user('acct@test.local', 'Accounts Mgr')),
    ('hub_b_mgr', tests.make_user('hub.b1@test.local', 'Hub B1 Mgr')),
    ('rider_login', tests.make_user('rider@test.local', 'Rider Login'));
  perform tests.grant_role(tests.id('hr2'), 'hr_manager');
  perform tests.grant_role(tests.id('acct_mgr'), 'accounts_manager');
  perform tests.grant_role(tests.id('hub_b_mgr'), 'hub_manager', 'hub', null, tests.id('hub_b1'));
end $$;

-- Creates a fully-approved active employee directly (as owner) for tests that need one.
create or replace function tests.active_employee(p_name text, p_code text, p_hub uuid, p_mobile text, p_nid text,
                                                 p_basic numeric default 15000, p_profile uuid default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.employees (employee_code, full_name, mobile, hub_id, department_id, position_id, joining_date,
                                status, status_since, profile_id)
  values (p_code, p_name, p_mobile, p_hub, tests.id('dept_ops'), tests.id('pos_rider'), current_date - 400, 'active', current_date - 400, p_profile)
  returning id into v;
  insert into public.employee_sensitive (employee_id, nid_number, date_of_birth) values (v, p_nid, '1995-05-05');
  insert into public.employee_assignments (employee_id, change_type, department_id, position_id, zone_id, hub_id, effective_from)
  select id, 'joining', department_id, position_id, zone_id, hub_id, joining_date from public.employees where id = v;
  insert into public.employee_compensation (employee_id, effective_from, basic_salary, transport_allowance, commission, reason, status, approved_at)
  values (v, current_date - 400, p_basic, 2000, 500, 'Initial salary', 'approved', now());
  return v;
end $$;
grant execute on all functions in schema tests to anon, authenticated, service_role;
