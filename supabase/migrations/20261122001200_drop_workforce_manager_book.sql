-- =====================================================================
-- Remove the older manager's attendance book (20261122001100_workforce_manager_book.sql)
--
-- Owner (22 Nov 2026): "পুরনো হাজিরা খাতার টেবিল গুলা মুছে ফেলো".
-- That book (19 Nov, wf_mb_*) was applied on live on 22 Nov, the same day the owner's daily final attendance
-- register (att_*, 20261122000800_att_final_sheet.sql) went live. No page ever called it and it held no data
-- (checked on live before this ran: 0 entries, 0 closed days, 0 submissions, 0 log lines, 0 leave photos,
-- 0 files in the bucket, 0 register rows with source 'book'; only the one default rule row).
--
-- Removes: the 5 tables wf_book_rules / entries / days / submissions / entry_log, the 11 public wf_mb_* functions,
-- wf_absence_photo, wf_absence_photos, the 9 private helpers, the two storage policies, the column
-- wf_absence_applications.photo_path, and puts attendance_records_source_check back as it was.
-- NOT touched: wf_book_windows, wf_book_fill, wf_book_mode, wf_book_full_month_set (the staff's own হাজিরা বই),
-- and everything of att_*.
-- The empty private bucket "wf-leave" is left: Supabase does not let SQL delete a bucket. It can be removed from
-- the dashboard (Storage); nothing reads or writes it.
-- =====================================================================

-- Stop if anything was written after the check above.
do $$
begin
  if exists (select 1 from public.wf_book_entries) or exists (select 1 from public.wf_book_days)
     or exists (select 1 from public.wf_book_submissions) or exists (select 1 from public.wf_book_entry_log)
     or exists (select 1 from public.wf_absence_applications where photo_path is not null)
     or exists (select 1 from public.attendance_records where source = 'book') then
    raise exception 'The older attendance book holds data - not removed';
  end if;
end $$;

drop policy if exists wf_leave_read on storage.objects;
drop policy if exists wf_leave_write on storage.objects;

drop function if exists public.wf_mb_rules_get(uuid);
drop function if exists public.wf_mb_rules_save(uuid, jsonb, jsonb, boolean);
drop function if exists public.wf_mb_book(uuid, date);
drop function if exists public.wf_mb_set(uuid, date, jsonb, text);
drop function if exists public.wf_mb_close(uuid, date, text);
drop function if exists public.wf_mb_history(uuid, uuid, date, integer);
drop function if exists public.wf_mb_sheet(uuid, uuid, date, date);
drop function if exists public.wf_mb_submit(uuid, text, date, text);
drop function if exists public.wf_mb_submissions(uuid, uuid);
drop function if exists public.wf_mb_reopen(uuid, text);
drop function if exists public.wf_mb_mine(date);
drop function if exists public.wf_absence_photo(uuid, text);
drop function if exists public.wf_absence_photos(uuid[]);
drop function if exists private.wf_mb_may_write(uuid, uuid, date, uuid);
drop function if exists private.wf_mb_cells(date, date, uuid[], uuid);
drop function if exists private.wf_mb_sum(text[], boolean[], boolean[], boolean[]);
drop function if exists private.wf_mb_entry_json(public.wf_book_entries);
drop function if exists private.wf_mb_locked(uuid, date);
drop function if exists private.wf_mb_rules(uuid);
drop function if exists private.wf_mb_codes();
drop function if exists private.wf_leave_object_emp(text);

-- Dropping a table also takes it out of the live-updates publication, with its triggers, policies and indexes.
drop table if exists public.wf_book_entry_log;
drop table if exists public.wf_book_entries;
drop table if exists public.wf_book_days;
drop table if exists public.wf_book_submissions;
drop table if exists public.wf_book_rules;
drop function if exists private.wf_mb_log_frozen();

alter table public.wf_absence_applications drop constraint if exists wf_app_photo_len;
alter table public.wf_absence_applications drop column if exists photo_path;

alter table public.attendance_records drop constraint if exists attendance_records_source_check;
alter table public.attendance_records add constraint attendance_records_source_check
  check (source in ('manual', 'kiosk', 'import', 'leave', 'self'));
