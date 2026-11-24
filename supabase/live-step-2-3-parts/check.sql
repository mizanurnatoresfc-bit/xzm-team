-- Run after part 1-7, BEFORE final. Read-only. Every row must say ok = true and the last query must say true.
select e.part, e.md5 as expected, md5(rtrim(s.body, E'\n')) as stored, coalesce(md5(rtrim(s.body, E'\n')) = e.md5, false) as ok
from (values
  (1, 'e2d2dbf440d0b5e9a20a378bedd353cb'),
  (2, '8c8a81a297c9a1a51e56c75088271323'),
  (3, 'd41cd1e556140d6d261a6a43f3cab2a7'),
  (4, '3b8625bedc6256054dba8f16dac6cc9b'),
  (5, '579cb9b1ea06a32c19937b91612944cc'),
  (6, 'fc53c0765ce30376c579952cf0349410'),
  (7, '8965f3f192cc81759100b98e99837975')
) e(part, md5) left join private._mig_stage s on s.part = e.part order by e.part;
select (select count(*) from private._mig_stage) = 7
   and (select md5(string_agg(body, E'\n' order by part)) from private._mig_stage) = '771188ea597108318e289108bf02aafd' as all_parts_exact;
