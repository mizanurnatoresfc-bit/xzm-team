-- Run AFTER supabase/apply-live-step-2-3.sql. Read-only. Compare with the expected values in the comments.

-- 1. All 71 functions of the three 24 Nov migrations are byte-for-byte what the tests ran against.
--    expected: n = 71, agg = 0af72775bc560f06a24648192d030b69
select count(*) n, md5(string_agg(sig||h, E'\n' order by sig collate "C")) agg from (select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' sig, md5(p.prosrc) h from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname in ('att_day_autosubmit','att_edit_open','att_leave_state','att_line_gap','att_line_prefill','att_month_check_ok','att_month_check_return','att_month_get','att_month_scan','att_month_send','att_month_sheet','att_month_submit','att_open_window','att_reopen_close','att_reopen_do','att_reopen_list','att_reopen_open','att_sheet_check_ok','att_sheet_check_return','att_sheet_close','att_sheet_get','att_sheet_prepare','att_sheet_send','att_sheet_submit','att_sheet_unlock','att_sheet_version_get','att_sheet_write','att_zone_day','route_plan_backfill','route_plan_decide','route_plan_mine','route_plan_morning','route_plan_morning_link','route_plan_notify','route_plan_published','route_plan_resend','route_presence','staff_profile_get','staff_profile_people','staff_work_record','swe_att_line','swe_att_sheet','swe_backfill','swe_daily_ops','swe_hubops_report','swe_hubops_row','swe_hubops_staff','swe_morning','swe_route','swe_sorting_handover','swe_sorting_run','wf_att_policy_get','wf_att_policy_save','wf_auto_from','wf_day_due','wf_hold_resolve','wf_hold_set','wf_leave_on','wf_morning_autosubmit','wf_morning_close','wf_morning_date','wf_morning_due','wf_morning_get','wf_morning_people','wf_morning_return','wf_morning_save','wf_morning_submit','wf_morning_zone','wf_role_hub_managers','wf_role_zone_managers','wf_setting_text')) q;

-- 2. The start date and the two jobs.   expected: start_from = "2026-11-25" (or the day step 1 was applied), both jobs active = true
select (select value::text from public.system_settings where key = 'workforce.auto_submit_from') as start_from,
       (select string_agg(jobname || ' ' || schedule || ' active=' || active, '; ' order by jobname) from cron.job where jobname in ('wf-morning-autosubmit', 'att-day-autosubmit')) as cron_jobs;

-- 3. The new tables exist and the live columns of the final register are still there.   expected: all true
select to_regclass('public.att_reopen_windows') is not null as windows,
       to_regclass('public.att_sheet_versions') is not null as versions,
       to_regclass('public.att_month_subs') is not null as month_subs,
       to_regclass('public.staff_work_events') is not null as work_events,
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'att_day_lines' and column_name = 'self_pending') as self_pending,
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'route_day_plans' and column_name = 'ai_plan') as ai_plan_kept;
