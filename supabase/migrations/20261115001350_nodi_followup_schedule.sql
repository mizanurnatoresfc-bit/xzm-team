-- Brought into the repository on 2026-11-17 from the live database (applied live as 20261115104516 nodi_followup_schedule).
-- Same as what ran live; the cron part is wrapped so a database without pg_cron (the local test one) skips it.

do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('nodi-issue-followup', '7 * * * *', $$select public.issue_nudge_due(6)$$);
  end if;
end $do$;
