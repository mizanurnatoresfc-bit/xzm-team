# Live steps 2 + 3 in small pieces (for the SQL editor)

The one-file script (`../apply-live-step-2-3.sql`, 116 KB) gets cut when pasted into the browser. These are the same text in 7 pieces.

1. Open the SQL editor of the LIVE project. Run `part01.sql`, then `part02.sql` ... `part07.sql`, one at a time (each stores ~18 KB of text; nothing else happens).
2. Run `check.sql`. Every row must show `ok = true`, and the second result `all_parts_exact = true`. If not, re-run that part (it is an insert: first `delete from private._mig_stage where part = N;`).
3. Run `final.sql` (one statement, one transaction; it removes the scratch table when it succeeds).
4. Run `../verify-live-step-2-3.sql`: expect `n = 71`, `agg = 0af72775bc560f06a24648192d030b69`, both cron jobs active.

Do not use `supabase db push`.
