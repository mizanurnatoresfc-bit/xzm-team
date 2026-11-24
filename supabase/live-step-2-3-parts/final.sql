-- FINAL step. Run ONLY when check.sql says ok = true for every part and all_parts_exact = true.
-- Runs steps 2 and 3 (the stored text) as ONE statement = one transaction: if anything fails, nothing is kept and the stored parts stay for a retry.
-- On success it also removes the scratch table. (Step 1 is already applied on the live project.)
do $m$
begin
  if (select md5(string_agg(body, E'\n' order by part)) from private._mig_stage) is distinct from '771188ea597108318e289108bf02aafd' then
    raise exception 'The stored parts are not exactly the expected text - stop.';
  end if;
  if to_regclass('public.wf_auto_holds') is null or to_regprocedure('private.att_hub_managers(uuid)') is null or to_regclass('public.att_reopen_windows') is not null then
    raise exception 'Unexpected database state (step 1 missing, live-only migrations missing, or step 2 already applied) - stop.';
  end if;
  execute (select string_agg(body, E'\n' order by part) from private._mig_stage);
  drop table private._mig_stage;
end $m$;
