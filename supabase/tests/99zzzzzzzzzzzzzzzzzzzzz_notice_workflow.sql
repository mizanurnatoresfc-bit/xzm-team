-- Notification centre + workflow automation: priority, notice board, reminders, assignment notice,
-- deadline control (auto forward up the reporting line), pending-approval reminders, my report line.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
  ('e_rider', tests.active_employee('Rider One', '901', tests.id('hub_a1'), '01711000901', '9010000000', 15000, tests.id('rider_login'))),
  ('e_mgr',   tests.active_employee('Hub Mgr',   '902', tests.id('hub_a1'), '01711000902', '9020000000', 25000, tests.id('hub_mgr'))),
  ('e_zonal', tests.active_employee('Zonal Mgr', '903', tests.id('hub_a1'), '01711000903', '9030000000', 40000, tests.id('zonal_a'))),
  ('e_other', tests.active_employee('Other Zone Rider', '904', tests.id('hub_b1'), '01711000904', '9040000000', 15000, tests.id('hub_b_mgr')));
update public.employees set reporting_manager_id = tests.id('e_mgr')   where id = tests.id('e_rider');
update public.employees set reporting_manager_id = tests.id('e_zonal') where id = tests.id('e_mgr');

-- ---------- 1. priority
select tests.logout();
select private.notify_p(tests.id('rider_login'), 'p-urgent', null, '/app', 'test', 'urgent');
select private.notify_p(tests.id('rider_login'), 'p-bad', null, '/app', 'test', 'whatever');
select tests.ok((select priority from public.notifications where title = 'p-urgent') = 'urgent', 'a notification can carry a priority');
select tests.ok((select priority from public.notifications where title = 'p-bad') = 'normal', 'an unknown priority becomes normal');
select tests.ok((select priority from (select priority from public.notifications where title = 'p-bad') x) = 'normal'
                and not exists (select 1 from public.notifications where kind = 'hr_request' and priority <> 'normal'), 'the older notify() still gives normal');
select tests.login(tests.id('rider_login'));
select tests.ok((select priority from public.notifications where title = 'p-urgent') = 'urgent', 'the person can read the priority of their own notification');
select tests.throws($$select private.notify_p(null, 'x', null, null, 'x', 'normal')$$, 'notify_p is not callable from the browser', '42501');

-- ---------- 2. notice board
select tests.login(tests.id('noroles'));
select tests.throws($$select public.notice_publish('Hello all', 'Body text', 'all')$$, 'no right: cannot publish', '42501');
select tests.throws($$select count(*) from public.notices$$, 'the notices table cannot be read directly', '42501');
select tests.login(tests.id('hub_mgr'));
select tests.throws($$select public.notice_publish('Company news', 'Body text', 'all')$$, 'a hub manager cannot publish company-wide', '42501');
select tests.throws(format($$select public.notice_publish('Other hub', 'Body text', 'hub', null, %L)$$, tests.id('hub_b1')), 'a hub manager cannot publish to another hub', '42501');
select tests.throws(format($$select public.notice_publish('x', 'Body text', 'hub', null, %L, 'extreme')$$, tests.id('hub_a1')), 'an unknown priority is refused', '22023');
insert into tests.ids select 'n_hub', public.notice_publish('Hub meeting 5pm', 'Everyone at the hub at 5pm', 'hub', null, tests.id('hub_a1'), 'high', true);
select tests.login(tests.id('admin'));
insert into tests.ids select 'n_all', public.notice_publish('New rule', 'Read the new rule', 'all', null, null, 'urgent', true, true);

select tests.login(tests.id('rider_login'));
select tests.ok((select count(*) from public.notice_list()) = 2, 'a rider of the hub sees the company notice and the hub notice');
select tests.ok((select title from public.notice_list() limit 1) = 'New rule', 'pinned + urgent comes first');
select tests.ok((select not seen from public.notice_list() where title = 'New rule'), 'not read yet');
select tests.ok((select count(*) from public.notifications where kind = 'notice' and priority in ('urgent', 'high')) = 2, 'the bell got both notices with their priority');
select tests.ok((select readers is null and not can_manage from public.notice_list() where title = 'New rule'), 'a rider cannot see who read it or take it down');
select public.notice_mark_read(tests.id('n_all'));
select tests.ok((select seen from public.notice_list() where title = 'New rule'), 'mark read works');
select tests.throws(format($$select public.notice_archive(%L)$$, tests.id('n_all')), 'a rider cannot archive', '42501');

select tests.login(tests.id('hub_b_mgr'));
select tests.ok((select count(*) from public.notice_list()) = 1 and (select title from public.notice_list()) = 'New rule', 'another hub sees only the company notice');
select tests.throws(format($$select public.notice_mark_read(%L)$$, tests.id('n_hub')), 'cannot mark a notice meant for another hub', '42501');

select tests.login(tests.id('admin'));
select tests.ok((select readers = 1 and can_manage from public.notice_list() where title = 'New rule'), 'the publisher sees how many have read it');
select public.notice_archive(tests.id('n_all'));
select tests.logout();
select tests.ok((select sent_to from public.notices where id = tests.id('n_all')) = 4, 'the company notice went to all four people with an account');
select tests.login(tests.id('rider_login'));
select tests.ok((select count(*) from public.notice_list()) = 1, 'an archived notice disappears');
select tests.logout();
select tests.ok((select count(*) from public.notices where archived_at is not null) = 1, 'it is archived, not deleted');
select tests.throws(format($$delete from public.notices where id = %L$$, tests.id('n_hub')), 'notices are never deleted', null);

-- a notice that starts later is announced when it starts
select tests.login(tests.id('admin'));
insert into tests.ids select 'n_later', public.notice_publish('Tomorrow', 'Starts later', 'all', null, null, 'normal', false, false, now() + interval '1 hour');
select tests.logout();
select tests.ok((select sent_to from public.notices where id = tests.id('n_later')) = 0, 'a later notice is not announced yet');
update public.notices set publish_at = now() - interval '1 minute' where id = tests.id('n_later');
select private.workflow_run();
select tests.ok((select sent_to from public.notices where id = tests.id('n_later')) = 4, 'the engine announces it when its time comes');

-- ---------- 3. reminders
select tests.login(tests.id('rider_login'));
select tests.throws($$select public.reminder_add('Past', now() - interval '1 hour')$$, 'a reminder must be in the future', '22023');
insert into tests.ids select 'rm1', public.reminder_add('Call merchant', now() + interval '1 hour', 'none', 'about COD', 'high', '/app/accounts/mine');
insert into tests.ids select 'rm2', public.reminder_add('Weekly check', now() + interval '2 hours', 'weekly');
select tests.throws($$select public.reminder_add('Bad link', now() + interval '1 hour', 'none', null, 'normal', 'https://evil.example')$$, 'a link must stay inside the app', '23514');
select tests.ok((select count(*) from public.reminder_list()) = 2, 'my reminders');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select count(*) from public.reminder_list()) = 0, 'nobody sees another person''s reminders');
select tests.throws(format($$select public.reminder_done(%L)$$, tests.id('rm1')), 'nobody can finish another person''s reminder', '42501');
select tests.logout();
update public.user_reminders set remind_at = now() - interval '1 minute';
select tests.ok(private.reminders_fire() = 2, 'both due reminders are delivered');
select tests.ok((select priority = 'high' and link = '/app/accounts/mine' from public.notifications where title = '⏰ Call merchant'), 'delivered with its priority and link');
select tests.ok((select done_at is not null from public.user_reminders where id = tests.id('rm1')), 'a one-time reminder is finished after it is sent');
select tests.ok((select done_at is null and remind_at > now() + interval '6 days' from public.user_reminders where id = tests.id('rm2')), 'a weekly reminder moves to next week');
select tests.ok(private.reminders_fire() = 0, 'nothing is sent twice');
select tests.login(tests.id('rider_login'));
select public.reminder_remove(tests.id('rm2'));
select tests.ok((select count(*) from public.reminder_list(true)) = 1, 'a removed reminder is gone from the list');
select tests.logout();
select tests.ok((select archived_at is not null from public.user_reminders where id = tests.id('rm2')), 'removed means archived, not deleted');

-- ---------- 4. assignment notification
select tests.login(tests.id('zonal_a'));
insert into tests.ids select 't1', public.task_assign('Collect NID copy', tests.id('rider_login'), current_date + 5, null, tests.id('hub_a1'), null, 'urgent');
select tests.login(tests.id('rider_login'));
select tests.ok((select count(*) = 1 and bool_and(priority = 'urgent') from public.notifications where kind = 'task' and title like 'নতুন দায়িত্ব%'),
                'the person given a task is told, with the task''s priority');
select tests.login(tests.id('zonal_a'));
select tests.ok((select count(*) = 0 from public.notifications where kind = 'task'), 'the person who assigned is not notified of their own action');
select public.task_reassign(tests.id('t1'), tests.id('hub_mgr'), current_date + 6, 'rider on leave');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select count(*) = 1 from public.notifications where kind = 'task' and title like 'নতুন দায়িত্ব%'), 'a reassigned task notifies the new person');

-- ---------- 5. deadline control and auto forward
select tests.logout();
update public.tasks set assigned_to = tests.id('rider_login'), due_date = current_date - 1 where id = tests.id('t1');
update public.notifications set kind = 'old' where kind = 'task';
select private.workflow_run();
select tests.ok((select count(*) from public.notifications where kind = 'task' and profile_id = tests.id('rider_login') and title like '⚠ সময় পেরিয়ে%') = 1,
                'a day late: only the assignee is reminded');
select tests.ok((select count(*) from public.notifications where kind = 'task' and profile_id in (tests.id('zonal_a'), tests.id('hub_mgr'))) = 0, 'a day late: no forwarding yet');
select private.workflow_run();
select tests.ok((select count(*) from public.notifications where kind = 'task') = 1, 'the engine never repeats itself');
update public.tasks set due_date = current_date - 3 where id = tests.id('t1');
select private.workflow_run();
select tests.ok((select count(*) from public.notifications where profile_id = tests.id('hub_mgr') and title like '⚠ ফরওয়ার্ড%') = 1, '3 days late: forwarded to the reporting manager');
select tests.ok((select count(*) from public.notifications where profile_id = tests.id('zonal_a') and title like '⚠ ফরওয়ার্ড%') = 1, '3 days late: and to the accountable manager');
update public.tasks set due_date = current_date - 5 where id = tests.id('t1');
select private.workflow_run();
select tests.ok((select count(*) from public.notifications where profile_id = tests.id('zonal_a') and title like '🔴%' and priority = 'urgent') = 1, '5 days late: the next manager up is told, urgent');
select private.workflow_run();
select tests.ok((select count(*) from public.notifications where title like '🔴%') = 1, 'each step is sent once');
-- the setting
update public.system_settings set value = '1' where key = 'workflow.escalate_after_days';
insert into public.tasks (title, assigned_to, accountable_manager_id, due_date, status, hub_id)
  values ('Late too', tests.id('rider_login'), tests.id('zonal_a'), current_date - 1, 'assigned', tests.id('hub_a1'));
select private.workflow_run();
select tests.ok((select count(*) from public.notifications where profile_id = tests.id('hub_mgr') and title like '⚠ ফরওয়ার্ড%Late too') = 1, 'with escalate_after_days = 1 a one-day-late task is forwarded');
update public.system_settings set value = 'false' where key = 'workflow.enabled';
update public.tasks set due_date = current_date - 20 where title = 'Late too';
update public.notifications set kind = 'old';
select private.workflow_run();
select tests.ok((select count(*) from public.notifications where kind <> 'old') = 0, 'switched off: the engine sends nothing');
update public.system_settings set value = 'true' where key = 'workflow.enabled';
update public.system_settings set value = '2' where key = 'workflow.escalate_after_days';

-- a result waiting for confirmation
update public.tasks set status = 'submitted', submitted_at = now() - interval '2 days' where id = tests.id('t1');
update public.notifications set kind = 'old';
select private.workflow_run();
select tests.ok((select count(*) from public.notifications where profile_id = tests.id('zonal_a') and title like 'যাচাইয়ের অপেক্ষায়%') = 1, 'a submitted result waiting a day reminds the manager');

-- ---------- 6. pending approvals
insert into public.leave_types (code, name) values ('CL', 'Casual');
insert into tests.ids select 'lv1', null where false;
insert into public.leave_requests (employee_id, leave_type_id, from_date, to_date, reason, status, created_at)
  select tests.id('e_rider'), id, current_date + 3, current_date + 4, 'family', 'pending', now() - interval '30 hours' from public.leave_types where code = 'CL';
update public.notifications set kind = 'old';
select private.workflow_run();
select tests.ok((select count(*) from public.notifications where profile_id = tests.id('hub_mgr') and title like 'ছুটির আবেদন অপেক্ষায়%') = 1, 'a leave request waiting a day reminds the reporting manager');
select tests.ok((select count(*) from public.notifications where profile_id = tests.id('hr') and title like 'ছুটির আবেদন অপেক্ষায়%') = 1, 'and the people who can approve leave');
select private.workflow_run();
select tests.ok((select count(*) from public.notifications where title like 'ছুটির আবেদন অপেক্ষায়%') = (select count(distinct profile_id) from public.notifications where title like 'ছুটির আবেদন অপেক্ষায়%'),
                'each person is reminded once');
select tests.ok(private.profiles_with_perm('hr.request.approve', tests.id('zone_a'), tests.id('hub_a1')) is not null, 'the approver lookup runs');

-- ---------- 7. report line
select tests.login(tests.id('rider_login'));
select tests.ok((select count(*) from public.my_report_line()) = 2, 'a rider reports to the hub manager, who reports to the zonal manager');
select tests.ok((select name from public.my_report_line() where level = 1) = 'Hub Mgr' and (select name from public.my_report_line() where level = 2) = 'Zonal Mgr', 'in the right order');
select tests.login(tests.id('zonal_a'));
select tests.ok((select count(*) from public.my_report_line()) = 0, 'the top of the line has no one above');
select tests.logout();
-- a loop in the data must not hang the query
update public.employees set reporting_manager_id = tests.id('e_rider') where id = tests.id('e_zonal');
select tests.login(tests.id('rider_login'));
select tests.ok((select count(*) from public.my_report_line()) = 2, 'a reporting loop stops instead of running for ever');
select 'done';
rollback;
