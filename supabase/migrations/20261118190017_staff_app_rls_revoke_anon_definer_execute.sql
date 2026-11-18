-- Live-only migration brought into the repository word for word from supabase_migrations.schema_migrations
-- (live version 20261118190017 staff_app_rls_revoke_anon_definer_execute, applied on 18 Nov 2026 from another session).
-- No SECURITY DEFINER function in public may be run by an anonymous visitor (except branding(), which the login page needs):
-- each one is given to signed-in users and the service role only.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.proname <> 'branding'
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;
