-- Indexes for the 17 foreign keys added by the live-only daily-accounts migrations (the performance test wants every foreign key indexed).
-- Additive only. Rollback: drop the indexes.

create index if not exists da_approval_rules_hub_id_idx on public.da_approval_rules (hub_id);
create index if not exists da_approval_rules_position_id_idx on public.da_approval_rules (position_id);
create index if not exists da_approval_rules_user_id_idx on public.da_approval_rules (user_id);
create index if not exists da_approval_rules_zone_id_idx on public.da_approval_rules (zone_id);
create index if not exists da_cash_payments_collector_user_idx on public.da_cash_payments (collector_user);
create index if not exists da_cash_payments_payee_id_idx on public.da_cash_payments (payee_id);
create index if not exists da_cash_payments_zone_id_idx on public.da_cash_payments (zone_id);
create index if not exists da_expense_claims_to_user_idx on public.da_expense_claims (to_user);
create index if not exists da_expenses_approved_by_idx on public.da_expenses (approved_by);
create index if not exists da_expenses_reference_person_id_idx on public.da_expenses (reference_person_id);
create index if not exists da_payees_hub_id_idx on public.da_payees (hub_id);
create index if not exists da_reference_people_employee_id_idx on public.da_reference_people (employee_id);
create index if not exists da_reference_people_hub_id_idx on public.da_reference_people (hub_id);
create index if not exists da_reference_people_profile_id_idx on public.da_reference_people (profile_id);
create index if not exists da_reference_people_zone_id_idx on public.da_reference_people (zone_id);
create index if not exists da_rider_lines_accepted_by_idx on public.da_rider_lines (accepted_by);
create index if not exists da_rider_lines_collector_user_idx on public.da_rider_lines (collector_user);
