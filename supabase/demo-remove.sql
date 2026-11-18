-- XZM-TEAM: switch off the DEMO data created by demo-seed.sql.
-- Run by hand (Supabase -> SQL Editor). Zones, hubs, employees and role grants cannot be
-- deleted in this system (prevent_delete), so they are archived / revoked instead, and the
-- three demo logins are blocked. Real data is not touched: everything is matched by the DEMO codes.
begin;

update public.user_roles set revoked_at = now(), revoke_reason = 'Demo data removed'
 where revoked_at is null
   and user_id in (select id from auth.users where email in
       ('id-demo01@xzmteam.com', 'id-demomgr@xzmteam.com', 'id-demozm@xzmteam.com'));

update public.profiles set status = 'inactive', archived_at = now(), archive_reason = 'Demo data removed'
 where email in ('id-demo01@xzmteam.com', 'id-demomgr@xzmteam.com', 'id-demozm@xzmteam.com');

update auth.users set banned_until = 'infinity'
 where email in ('id-demo01@xzmteam.com', 'id-demomgr@xzmteam.com', 'id-demozm@xzmteam.com');

update public.employees set status = 'inactive', archived_at = now(), archive_reason = 'Demo data removed'
 where employee_code in ('DEMO01','DEMO02','DEMO03','DEMO04','DEMO05','DEMO06','DEMO07','DEMO08','DEMO09','DEMO10','DEMOMGR','DEMOZM')
   and archived_at is null;

update public.hubs  set status = 'inactive', archived_at = now(), archive_reason = 'Demo data removed' where code = 'DEMOH' and archived_at is null;
update public.zones set status = 'inactive', archived_at = now(), archive_reason = 'Demo data removed' where code = 'DEMOZ' and archived_at is null;

commit;
