-- REVIEW ONLY. Outside migration runner. Do not apply to production.
-- Hub scope intentionally deferred until RLS and employee membership checks are designed.
begin;
alter table public.job_duties
  add column if not exists deadline_local time without time zone,
  add column if not exists verification_mode text not null default 'manual',
  add column if not exists evidence_source text,
  add column if not exists reviewer_role text;
alter table public.job_duties
  add constraint job_duties_verification_mode_ck check (verification_mode in ('manual','automatic','both')),
  add constraint job_duties_evidence_source_ck check (verification_mode = 'manual' or (evidence_source is not null and length(trim(evidence_source)) > 0)),
  add constraint job_duties_reviewer_role_ck check (reviewer_role is null or reviewer_role in ('hub_manager','zonal_manager','super_admin'));
comment on column public.job_duties.deadline_local is 'Local wall clock in Asia/Dhaka; null means no specific time.';
-- Intentionally rollback: rehearsal only, no persistence.
rollback;
