-- Data Entry V2 · R2.A — Staff personal weekly RPC for chart rendering.
--
-- Owner's DE-V2 release list, item 5: a staff-scoped public RPC that returns,
-- for the signed-in employee, a day-by-day breakdown of target / assigned /
-- submitted / verified parcel counts for the trailing N days (default 7).
-- ChatGPT's frontend branch will drive its own charts off this.
--
-- Read-only, self-scoped by auth.uid(). Returns the same four numbers per
-- (hub, work_date) so the UI can filter/sum by hub for multi-hub members.
-- No table or trigger change. One new public function. Backend-only.
--
-- Per-day fields:
--   target   — the smart-engine's forecast parcels for this member that day
--              (from the latest data_entry_target_runs snapshot for that day).
--              Null when no run exists for that hub/day/member.
--   assigned — the actual_remaining parcels the latest run placed on this
--              member for the day — what the hub was actually asked to do
--              once today's pickup count was known. Null before the actual
--              side existed.
--   submitted — the member's own entry count (shift_reports.attempted) from
--               the latest slot they submitted that day.
--   verified  — verified entry count (data_entry_target_observations.correct)
--               for that (member, hub, day). Reflects the reviewer's decision
--               rather than the member's submission.

create function public.data_entry_staff_week(p_days integer default 7)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me_member uuid;
  today date := private.wf_today();
  days integer := greatest(1, least(coalesce(p_days, 7), 90));
begin
  select m.id into me_member
  from public.data_entry_team_members m
  join public.employees e on e.id = m.employee_id
  where e.profile_id = auth.uid() and e.status = 'active' and e.archived_at is null
    and m.is_active;

  if me_member is null then
    -- Signed-in user is not an active Data Entry team member; return an empty
    -- shell so the UI can render "no data" without a branch for errors.
    return jsonb_build_object('member_id', null, 'days', days, 'from', today - days + 1, 'to', today, 'rows', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'member_id', me_member,
    'days', days,
    'from', today - days + 1,
    'to', today,
    'rows', coalesce((
      select jsonb_agg(row_to_json(d)::jsonb order by work_date desc, hub_id)
      from (
        select
          d.work_date,
          d.hub_id,
          coalesce(h.name_bn, h.name) as hub_name,
          -- Latest run's forecast parcels for this member on this day
          (
            select ((r.snapshot->'workers')->me_member::text->'forecast'->>'parcels')::integer
            from private.data_entry_target_runs r
            where r.hub_id = d.hub_id and r.work_date = d.work_date
              and (r.snapshot->'workers') ? me_member::text
            order by r.id desc limit 1
          ) as target,
          -- Latest run's actual_remaining parcels for this member on this day
          (
            select ((r.snapshot->'workers')->me_member::text->'actual_remaining'->>'parcels')::integer
            from private.data_entry_target_runs r
            where r.hub_id = d.hub_id and r.work_date = d.work_date
              and (r.snapshot->'workers') ? me_member::text
            order by r.id desc limit 1
          ) as assigned,
          -- Member's own latest submitted entry count (max slot)
          (
            select sr.attempted
            from private.data_entry_shift_reports sr
            where sr.member_id = me_member and sr.hub_id = d.hub_id and sr.work_date = d.work_date
            order by sr.slot desc limit 1
          ) as submitted,
          -- Verified entry count from the target observation table
          (
            select o.correct
            from private.data_entry_target_observations o
            where o.member_id = me_member and o.hub_id = d.hub_id and o.work_date = d.work_date
          ) as verified
        from (
          -- Only days where this member has some trace (a run, a report, or an
          -- observation). Days with no activity are omitted so the UI can draw
          -- a sparse series rather than forcing zeros it would misinterpret.
          select distinct r.work_date, r.hub_id
          from private.data_entry_target_runs r
          where r.work_date between today - days + 1 and today
            and (r.snapshot->'workers') ? me_member::text
          union
          select sr.work_date, sr.hub_id
          from private.data_entry_shift_reports sr
          where sr.member_id = me_member and sr.work_date between today - days + 1 and today
          union
          select o.work_date, o.hub_id
          from private.data_entry_target_observations o
          where o.member_id = me_member and o.work_date between today - days + 1 and today
        ) d
        left join public.hubs h on h.id = d.hub_id
      ) d
    ), '[]'::jsonb)
  );
end $$;

revoke all on function public.data_entry_staff_week(integer) from public, anon;
grant execute on function public.data_entry_staff_week(integer) to authenticated;
