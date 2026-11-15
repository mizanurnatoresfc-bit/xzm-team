-- Performance cleanup: no policy calls auth.uid() row by row, every foreign key has an index.
begin;
select tests.ok(not exists (
  select 1 from pg_policies where schemaname = 'public'
    and ((qual ~ 'auth\.uid\(\)' and qual !~* 'select\s+auth\.uid\(\)')
      or (with_check ~ 'auth\.uid\(\)' and with_check !~* 'select\s+auth\.uid\(\)'))),
  'every row-level policy works out auth.uid() once per query');
select tests.ok(not exists (
  select 1 from pg_constraint c join pg_class cl on cl.oid = c.conrelid join pg_namespace n on n.oid = cl.relnamespace
  where c.contype = 'f' and n.nspname = 'public'
    and not exists (select 1 from pg_index i where i.indrelid = c.conrelid
                    and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey
                    and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] <@ c.conkey)),
  'every foreign key has an index');
rollback;
