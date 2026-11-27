// This fixture exercises the draft RPCs in embedded Postgres with synthetic
// data. Supabase auth, RLS, Storage and push delivery require separate tests.
import { createRequire } from 'node:module'
const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite')
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const db = new PGlite()
const id = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const [hub, other, zone, manager, worker, worker2, reporting, emp, emp2, zonal] = Array.from({length: 10}, (_, i) => id(i + 1))
await db.exec(`
create role anon; create role authenticated;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('fixture.uid', true), '')::uuid $$;
create table hubs(id uuid primary key);
create table zones(id uuid primary key);
create table employees(id uuid primary key, hub_id uuid, archived_at timestamptz, status text, full_name text, employee_code text, profile_id uuid);
create table parcels(id uuid primary key, hub_id uuid, tracking_no text, assigned_rider_id uuid, created_by uuid, updated_by uuid);
create function private.hub_zone(uuid) returns uuid language sql as $$ select '${zone}'::uuid $$;
create function private.has_permission(text, uuid, uuid) returns boolean language sql as $$ select auth.uid() = '${zonal}' or (auth.uid() = '${manager}' and $3 = '${hub}') $$;
create function private.in_hub_group(uuid) returns boolean language sql as $$ select auth.uid() is not null and $1 = '${hub}' $$;
create function private.my_employee_id() returns uuid language sql as $$ select id from public.employees where profile_id = auth.uid() $$;
create function private.my_display_name() returns text language sql as $$ select 'Fixture'::text $$;
create function private.issue_order_assignee(text) returns uuid language sql as $$ select '${emp2}'::uuid $$;
create function private.hub_name(uuid) returns text language sql as $$ select 'Hub'::text $$;
create function private.emp_name(uuid) returns text language sql as $$ select full_name from public.employees where id=$1 $$;
create function private.emp_code(uuid) returns text language sql as $$ select employee_code from public.employees where id=$1 $$;
create function private.issue_status_label(text) returns text language sql as $$ select $1 $$;
create table notice_fixture(profile uuid, link text);
create function private.notify(uuid,text,text,text,text) returns void language sql as $$ insert into public.notice_fixture values ($1,$4) $$;
create function private.hub_post_add(uuid,text,text,uuid,boolean default false,text default null) returns void language plpgsql as $$ begin end $$;
insert into zones values ('${zone}'); insert into hubs values ('${hub}'), ('${other}');
insert into employees values ('${emp}','${hub}',null,'active','Worker','1','${worker}'), ('${emp2}','${other}',null,'active','Other','2','${worker2}');
`)
const base = readFileSync('supabase/migrations/20261115001200_hub_issues.sql', 'utf8')
await db.exec(base.slice(base.indexOf('create sequence public.issue_no_seq'), base.indexOf('create table public.hub_posts')))
await db.exec(`create function private.issue_log(uuid,text,text) returns void language sql as $$ insert into public.issue_events(issue_id,action,note) values ($1,$2,$3) $$;`)
await db.exec("alter table issues drop constraint issues_kind_check; alter table issues add check (kind in ('parcel','vehicle','staff','cash','other','store','it'))")
const dir = 'docs/project-control/audits'
await db.exec(readFileSync(dir + '/xzm-010-migration-draft.sql', 'utf8'))
const as = uid => db.query("select set_config('fixture.uid', $1, false)", [uid])
const create = (kind, assignee) => db.query("select issue_create($1,'Test issue',null,$2,null,null,$3) as id", [hub,kind,assignee]).then(r => r.rows[0].id)
const act = (issue, action) => db.query('select issue_act($1,$2,$3)', [issue,action,'Example'])
const assign = (issue, employee) => db.query('select issue_assign($1,$2)', [issue,employee])
const denied = {code:'42501'}
await as(manager)
await assert.rejects(create('parcel', emp2), denied)
await assert.rejects(db.query("select issue_create($1,'Wrong hub')", [other]), denied)
const order = await create('store', emp2)
const issue = await create('parcel', emp)
const self = await create('parcel', null)
await assert.rejects(assign(issue, emp2), denied)
await as(zonal)
const crossHub = await create('parcel', emp2)
assert.equal((await db.query('select assignee_id from issues where id=$1', [crossHub])).rows[0].assignee_id, emp2)
await as(reporting)
await assert.rejects(act(issue,'start'), denied)
await assert.rejects(act(issue,'solve'), denied)
await as(worker)
await act(issue,'start')
await act(issue,'solve')
await assert.rejects(act(issue,'solve'), {code:'P0001'})
await as(manager)
await assign(issue, emp)
assert.deepEqual((await db.query('select status, solved_at, solved_note, solve_photo from issues where id=$1',[issue])).rows[0], {status:'open',solved_at:null,solved_note:null,solve_photo:null})
await as(worker2)
await act(order,'solve')
await as(manager)
await act(order,'approve')
await as(worker)
const own = await create('parcel', emp)
await act(own,'solve')
await assert.rejects(act(own,'approve'), denied)
assert.equal((await db.query('select issue_detail($1) as data',[own])).rows[0].data.issue.can_review,false)
assert.ok((await db.query('select issue_panels() as data')).rows[0].data.hub.some(r => r.id === self))
assert.ok((await db.query('select count(*)::int as n from notice_fixture where profile=$1',[worker])).rows[0].n > 0)
await db.exec(readFileSync(dir + '/xzm-010-rollback-draft.sql', 'utf8'))
assert.equal((await db.query("select to_regprocedure('private.issue_assignment_in_scope(uuid,uuid)') as helper")).rows[0].helper,null)
console.log('PASS: SQL draft, create/assign scope, authorized Store cross-hub, unmapped actor, reassignment reset, self approval, queue, notification call and rollback')
await db.close()
