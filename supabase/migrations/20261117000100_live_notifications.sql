-- =====================================================================
--  ঘণ্টা লাইভ (live notifications)
--  * notifications joins the supabase_realtime publication, so a signed-in
--    person's browser / app hears a new row at once. Realtime applies the
--    table's RLS: each person receives only their own rows (profile_id = auth.uid()).
--  * a small index for "how many unread" and the page's paging.
--  Additive only. Rollback: alter publication supabase_realtime drop table
--  public.notifications; drop index notifications_unread_idx.
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

create index if not exists notifications_unread_idx on public.notifications (profile_id) where read_at is null;
