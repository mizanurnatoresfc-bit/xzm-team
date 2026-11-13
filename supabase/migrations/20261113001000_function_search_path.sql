-- Supabase Security Advisor (lint 0011 "function_search_path_mutable"): pin search_path
-- on the 15 helper/trigger functions that did not set it. They are SECURITY INVOKER and
-- only use pg_catalog built-ins or fully qualified names, so an empty search_path is safe.
alter function private.append_only()                 set search_path = '';
alter function private.audit_immutable()             set search_path = '';
alter function private.compensation_guard()          set search_path = '';
alter function private.compensation_item_guard()     set search_path = '';
alter function private.custom_field_guard()          set search_path = '';
alter function private.da_append_only()              set search_path = '';
alter function private.guard_system_role()           set search_path = '';
alter function private.import_batch_guard()          set search_path = '';
alter function private.is_api_user()                 set search_path = '';
alter function private.leave_request_guard()         set search_path = '';
alter function private.parse_date_bd(text)           set search_path = '';
alter function private.prevent_delete()              set search_path = '';
alter function private.request_header(text)          set search_path = '';
alter function private.salary_sheet_guard()          set search_path = '';
alter function private.stamp_row()                   set search_path = '';
