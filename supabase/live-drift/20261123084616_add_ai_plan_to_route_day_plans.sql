-- RECORDED FROM LIVE (drift sync, System Control Center Phase 0).
-- This migration was applied to the live Supabase project as version 20261123084616 (add_ai_plan_to_route_day_plans) but its source was never committed.
-- The statements below are copied unchanged from supabase_migrations.schema_migrations on live; nothing is applied to live by adding this file.

ALTER TABLE public.route_day_plans
  ADD COLUMN IF NOT EXISTS ai_plan jsonb,
  ADD COLUMN IF NOT EXISTS ai_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_model text;

COMMENT ON COLUMN public.route_day_plans.ai_plan IS 
  'NODI AI suggestion: {summary_bn, manpower_needed, rider_assignments, shortfall, actions}';
