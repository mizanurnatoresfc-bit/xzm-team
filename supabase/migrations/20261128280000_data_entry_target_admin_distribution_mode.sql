-- DE-V2 fix: the Targets page showed the wrong distribution mode.
--
-- data_entry_target_admin did not return the hub's distribution_mode, so the page read it from the latest cached run
-- (latest.distribution_mode). A hub with no run yet, or one switched off, shows 'smart' whatever was saved: after
-- "Switch to equal split" the page said "Saved" and kept the old label, because the refresh that rewrites the cached
-- run does nothing for a hub that is switched off.
-- The function now returns the saved mode (data_entry_target_hubs.distribution_mode, default 'smart') as 'distribution_mode'.
-- Additive JSON field only. Signature, grants and permission check are unchanged.

create or replace function public.data_entry_target_admin(p_hub uuid, p_day date, p_member uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.data_entry_target_require_zone(p_hub);
  if p_member is not null and not exists (select 1 from private.data_entry_target_team(p_hub) where member_id = p_member) then
    raise exception 'Member is outside this hub' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'enabled', coalesce((select enabled from private.data_entry_target_hubs where hub_id = p_hub), false),
    'distribution_mode', coalesce((select distribution_mode from private.data_entry_target_hubs where hub_id = p_hub), 'smart'),
    'complex_parcels', (select complex_parcels from private.data_entry_target_complexity where hub_id = p_hub and work_date = p_day),
    'team', coalesce((select jsonb_agg(jsonb_build_object('id', t.member_id, 'name', coalesce(e.full_name_bn, e.full_name)) order by e.full_name, t.member_id)
      from private.data_entry_target_team(p_hub) t join public.employees e on e.id = t.employee_id), '[]'::jsonb),
    'rule', (select to_jsonb(r) - 'member_id' from private.data_entry_target_rules r where member_id = p_member),
    'observation', (select to_jsonb(o) - 'member_id' - 'hub_id' - 'work_date' - 'verified_by'
      from private.data_entry_target_observations o where member_id = p_member and hub_id = p_hub and work_date = p_day),
    'profile', (select to_jsonb(p) - 'member_id' - 'approved_by' from private.data_entry_performance_profile p where member_id = p_member),
    'latest', (select snapshot - 'workers' from private.data_entry_target_runs where hub_id = p_hub and work_date = p_day order by id desc limit 1),
    'history', coalesce((select jsonb_agg(to_jsonb(x) order by id desc) from (
      select id, reason, recorded_at, snapshot->'forecast_pickups' as forecast_pickups, snapshot->'actual_pickups' as actual_pickups,
        (snapshot->'workers')->p_member::text->'forecast'->'parcels' as forecast_target,
        (snapshot->'workers')->p_member::text->'actual_remaining'->'parcels' as actual_remaining
      from private.data_entry_target_runs where hub_id = p_hub and work_date = p_day order by id desc limit 20) x), '[]'::jsonb)
  );
end $$;
