-- =====================================================================
-- XZM-TEAM ERP — Migration: performance cleanup
--
--  * Row-level security: every policy that calls auth.uid() directly now calls
--    (select auth.uid()), so Postgres works it out once per query instead of
--    once per row. What each policy allows does not change.
--  * Every foreign key in public gets an index on its columns (if none covers
--    them), so joins and deletes on the parent stay fast as data grows.
--  * Nothing is removed; no table, rule or permission changes.
-- =====================================================================

do $$
declare
  p record; v_qual text; v_check text; v_sql text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (   (qual is not null and qual ~ 'auth\.uid\(\)' and qual !~* 'select\s+auth\.uid\(\)')
           or (with_check is not null and with_check ~ 'auth\.uid\(\)' and with_check !~* 'select\s+auth\.uid\(\)'))
  loop
    v_qual  := case when p.qual is null then null else replace(p.qual, 'auth.uid()', '(select auth.uid())') end;
    v_check := case when p.with_check is null then null else replace(p.with_check, 'auth.uid()', '(select auth.uid())') end;
    v_sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if v_qual is not null then v_sql := v_sql || format(' using (%s)', v_qual); end if;
    if v_check is not null then v_sql := v_sql || format(' with check (%s)', v_check); end if;
    execute v_sql;
  end loop;
end $$;

do $$
declare
  fk record; v_cols text; v_name text;
begin
  for fk in
    select c.conrelid, c.conname, c.conkey, cl.relname as tbl
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where c.contype = 'f' and n.nspname = 'public'
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.conrelid
          and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey
          and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] <@ c.conkey)
  loop
    select string_agg(quote_ident(a.attname), ', ' order by k.ord) into v_cols
    from unnest(fk.conkey) with ordinality k(attnum, ord)
    join pg_attribute a on a.attrelid = fk.conrelid and a.attnum = k.attnum;
    v_name := left(fk.conname, 55) || '_ix';
    execute format('create index if not exists %I on public.%I (%s)', v_name, fk.tbl, v_cols);
  end loop;
end $$;
