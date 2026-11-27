-- Indexes for the six foreign keys of the sorting trip dispatch tables (20261127131000_sorting_trip_dispatch.sql) that had none; the performance
-- test (99n_performance_cleanup.sql: "every foreign key has an index") was red on main because of them. Additive only. Rollback: drop the indexes.
create index if not exists sorting_dispatches_driver_id_idx on public.sorting_dispatches (driver_id);
create index if not exists sorting_dispatches_helper_id_idx on public.sorting_dispatches (helper_id);
create index if not exists sorting_dispatches_dispatched_by_idx on public.sorting_dispatches (dispatched_by);
create index if not exists sorting_dispatch_reports_reporter_idx on public.sorting_dispatch_reports (reporter);
create index if not exists sorting_dispatch_reports_assignee_idx on public.sorting_dispatch_reports (assignee);
-- a composite key: the index must start with exactly the key's columns, in this order
create index if not exists sorting_dispatch_reports_dispatch_pos_idx on public.sorting_dispatch_reports (dispatch_id, position);
