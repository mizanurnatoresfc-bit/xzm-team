-- =====================================================================
--  দেনা-পাওনা (dues ledger) — owner asked, 21 Nov 2026.
--
--  A person's own money book with other people:
--   * upload a bKash / Nagad / Rocket statement (the browser reads the file and
--     sends the lines here; the file itself is not kept),
--   * go through the lines date by date and tick each one as checked,
--   * make a profile with a name and number(s): every line of that number then
--     shows the name, and the profile page lists all of that person's lines,
--   * add a line by hand (cash etc.), change or remove any line.
--
--  Everything is PRIVATE to the person who wrote it: each row carries owner_id
--  and every function works on auth.uid()'s own rows only — a Super Admin sees
--  only their own book too. The tables have no API access (RLS on, no policy,
--  rights revoked); all reads and writes go through the dp_* functions.
--  Because the lines are personal money, they are NOT copied into the audit log.
--
--  Permissions: dues.ledger.view (open the pages), dues.ledger.edit (upload, write).
--  Given to the admin role; Super Admin holds every permission by itself.
--
--  Additive only: three new tables, new functions, two permissions. Nothing existing changes.
--  Rollback: drop the public.dp_* and private.dp_* functions, then
--    drop table public.dp_txns, public.dp_statements, public.dp_profiles;
--    delete from public.permissions where code like 'dues.ledger.%';
-- =====================================================================
insert into public.permissions (code, module, resource, action, description) values
  ('dues.ledger.view', 'dues', 'ledger', 'view', 'Open one''s own dues ledger (দেনা-পাওনা): statements, lines and profiles'),
  ('dues.ledger.edit', 'dues', 'ledger', 'edit', 'Upload statements and write, change or remove lines and profiles in one''s own dues ledger')
on conflict (code) do nothing;
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code in ('dues.ledger.view', 'dues.ledger.edit')
where r.code = 'admin'
on conflict do nothing;

-- ---------------------------------------------------------------- tables
create table public.dp_profiles (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null,
  name        text not null check (length(trim(name)) between 1 and 120),
  numbers     text[] not null default '{}',               -- cleaned numbers (see private.dp_phone)
  note        text,
  opening     numeric(14,2) not null default 0,           -- + = they owed me before the first line, - = I owed them
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index dp_profiles_owner_idx on public.dp_profiles (owner_id) where archived_at is null;
create index dp_profiles_numbers_idx on public.dp_profiles using gin (numbers);

create table public.dp_statements (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null,
  provider    text not null check (provider in ('bkash', 'nagad', 'rocket', 'bank', 'other')),
  account_no  text,
  file_name   text,
  date_from   date,
  date_to     date,
  row_count   integer not null default 0,                 -- lines in the file
  added_count integer not null default 0,                 -- lines that were new
  removed_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index dp_statements_owner_idx on public.dp_statements (owner_id, created_at desc);

create table public.dp_txns (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null,
  statement_id uuid references public.dp_statements(id),  -- null = written by hand
  provider     text not null check (provider in ('bkash', 'nagad', 'rocket', 'bank', 'cash', 'other')),
  txn_at       timestamptz not null,
  txn_date     date not null,                             -- the Asia/Dhaka day of txn_at
  direction    text not null check (direction in ('in', 'out')),   -- in = I received, out = I gave
  amount       numeric(14,2) not null check (amount > 0),
  fee          numeric(14,2) not null default 0,
  balance      numeric(14,2),                             -- the wallet balance printed on the statement
  txn_type     text,                                      -- Send Money, Cash Out … as the statement says
  trx_id       text,
  party_no     text,                                      -- the other side's number, cleaned
  party_name   text,                                      -- a name the statement itself printed
  reference    text,
  note         text,                                      -- the owner's own note
  profile_id   uuid references public.dp_profiles(id),    -- set by hand; otherwise the profile is found by party_no
  no_profile   boolean not null default false,            -- "this line is not that person's" although the number matches
  dedupe_key   text not null,
  checked_at   timestamptz,
  edited_at    timestamptz,
  removed_at   timestamptz,
  created_at   timestamptz not null default now(),
  constraint dp_txns_once unique (owner_id, provider, dedupe_key)
);
create index dp_txns_owner_date_idx on public.dp_txns (owner_id, txn_date desc, txn_at desc);
create index dp_txns_party_idx on public.dp_txns (owner_id, party_no) where party_no is not null;
create index dp_txns_profile_idx on public.dp_txns (profile_id) where profile_id is not null;
create index dp_txns_statement_idx on public.dp_txns (statement_id) where statement_id is not null;

alter table public.dp_profiles enable row level security;
alter table public.dp_statements enable row level security;
alter table public.dp_txns enable row level security;
revoke all on public.dp_profiles, public.dp_statements, public.dp_txns from anon, authenticated;   -- every read and write goes through a function

-- ---------------------------------------------------------------- helpers
-- A number as it is compared: digits only (Bangla digits too), without +88 / 88;
-- a 12-digit Rocket account (mobile + check digit) becomes its 11-digit mobile.
create or replace function private.dp_phone(p text) returns text
language sql immutable set search_path = '' as $$
  with d as (select regexp_replace(translate(coalesce(p, ''), '০১২৩৪৫৬৭৮৯', '0123456789'), '[^0-9]', '', 'g') as v),
       s as (select case when v like '8801%' and length(v) >= 13 then substr(v, 3) else v end as v from d)
  select nullif(case when v like '01%' and length(v) = 12 then left(v, 11) else v end, '') from s
$$;

create or replace function private.dp_guard(p_write boolean default false) returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  if p_write and not private.has_permission('dues.ledger.edit') then raise exception 'দেনা-পাওনা লেখার অনুমতি নেই' using errcode = '42501'; end if;
  if not p_write and not (private.has_permission('dues.ledger.view') or private.has_permission('dues.ledger.edit')) then
    raise exception 'দেনা-পাওনা দেখার অনুমতি নেই' using errcode = '42501'; end if;
  return auth.uid();
end $$;

-- The profile a line belongs to: the one set by hand, else the owner's profile holding the line's number.
create or replace function private.dp_profile_of(t public.dp_txns) returns uuid
language sql stable security definer set search_path = '' as $$
  select case when t.no_profile then null
    else coalesce(
      (select p.id from public.dp_profiles p where p.id = t.profile_id and p.owner_id = t.owner_id and p.archived_at is null),
      (select p.id from public.dp_profiles p where t.party_no is not null and p.owner_id = t.owner_id and p.archived_at is null
         and p.numbers @> array[t.party_no] order by p.created_at limit 1)) end
$$;
revoke all on function private.dp_phone(text), private.dp_guard(boolean), private.dp_profile_of(public.dp_txns) from public, anon, authenticated;

-- ---------------------------------------------------------------- profiles
create or replace function public.dp_profile_save(p_id uuid, p_name text, p_numbers text[], p_note text default null, p_opening numeric default 0)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.dp_guard(true); v_nums text[]; v_id uuid; v_clash text;
begin
  if length(trim(coalesce(p_name, ''))) < 1 then raise exception 'নাম লিখুন' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct n), '{}') into v_nums
    from (select private.dp_phone(x) as n from unnest(coalesce(p_numbers, '{}')) x) q where n is not null;
  if exists (select 1 from unnest(v_nums) n where length(n) < 5) then raise exception 'নম্বর ঠিক নয়' using errcode = '22023'; end if;
  select p.name into v_clash from public.dp_profiles p
    where p.owner_id = v_me and p.archived_at is null and p.id is distinct from p_id and p.numbers && v_nums limit 1;
  if v_clash is not null then raise exception 'এই নম্বর আগেই "%" প্রোফাইলে আছে', v_clash using errcode = '23505'; end if;
  if p_id is null then
    insert into public.dp_profiles (owner_id, name, numbers, note, opening)
    values (v_me, trim(p_name), v_nums, nullif(trim(coalesce(p_note, '')), ''), coalesce(p_opening, 0)) returning id into v_id;
  else
    update public.dp_profiles set name = trim(p_name), numbers = v_nums, note = nullif(trim(coalesce(p_note, '')), ''),
      opening = coalesce(p_opening, 0), updated_at = now()
    where id = p_id and owner_id = v_me and archived_at is null returning id into v_id;
    if v_id is null then raise exception 'প্রোফাইলটা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- Removing a profile keeps its lines; they simply have no name again.
create or replace function public.dp_profile_remove(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.dp_guard(true);
begin
  update public.dp_profiles set archived_at = now(), updated_at = now() where id = p_id and owner_id = v_me and archived_at is null;
  if not found then raise exception 'প্রোফাইলটা পাওয়া যায়নি' using errcode = 'P0002'; end if;
end $$;

-- My profiles with their totals. given = I gave them, got = I received from them;
-- balance = opening + given - got: above zero I am owed (পাওনা), below zero I owe (দেনা).
create or replace function public.dp_profiles()
returns table (id uuid, name text, numbers text[], note text, opening numeric, given numeric, got numeric, balance numeric,
               txn_count integer, unchecked integer, last_date date, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with me as (select private.dp_guard(false) as id),
  t as (select private.dp_profile_of(x) as pid, x.direction, x.amount, x.txn_date, x.checked_at
        from public.dp_txns x, me where x.owner_id = me.id and x.removed_at is null),
  s as (select pid, coalesce(sum(amount) filter (where direction = 'out'), 0) as given,
               coalesce(sum(amount) filter (where direction = 'in'), 0) as got,
               count(*)::integer as n, (count(*) filter (where checked_at is null))::integer as un, max(txn_date) as last
        from t where pid is not null group by pid)
  select p.id, p.name, p.numbers, p.note, p.opening, coalesce(s.given, 0), coalesce(s.got, 0),
         p.opening + coalesce(s.given, 0) - coalesce(s.got, 0), coalesce(s.n, 0), coalesce(s.un, 0), s.last, p.created_at
  from public.dp_profiles p join me on p.owner_id = me.id left join s on s.pid = p.id
  where p.archived_at is null
  order by p.name
$$;

-- ---------------------------------------------------------------- statements
-- p_rows: [{at:'2026-11-20T14:05:00' (Asia/Dhaka clock), dir:'in'|'out', amount, fee, balance, type, trx, party, party_name, ref}]
-- A line already in the book (same trx id, or same time + amount + side + number when there is no id) is skipped,
-- so the same statement — or two statements that overlap — can be uploaded again without doubling anything.
create or replace function public.dp_statement_import(p_provider text, p_account text, p_file_name text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.dp_guard(true); v_st uuid; r jsonb; v_at timestamptz; v_amt numeric; v_dir text; v_trx text; v_party text; v_key text;
  v_n integer := 0; v_added integer := 0; v_bad integer := 0; v_min date; v_max date; v_day date; v_new uuid;
begin
  if p_provider is null or p_provider not in ('bkash', 'nagad', 'rocket', 'bank', 'other') then raise exception 'কোন স্টেটমেন্ট, বেছে নিন' using errcode = '22023'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'স্টেটমেন্টে কোনো লেনদেন পাওয়া যায়নি' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 20000 then raise exception 'একবারে ২০,০০০ লাইনের বেশি নয় — ফাইলটা ভাগ করে দিন' using errcode = '22023'; end if;
  insert into public.dp_statements (owner_id, provider, account_no, file_name)
  values (v_me, p_provider, private.dp_phone(p_account), nullif(left(trim(coalesce(p_file_name, '')), 200), '')) returning id into v_st;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_n := v_n + 1;
    begin
      v_at := (r ->> 'at')::timestamp at time zone 'Asia/Dhaka';
      v_amt := round(abs((r ->> 'amount')::numeric), 2);
    exception when others then v_bad := v_bad + 1; continue;
    end;
    v_dir := r ->> 'dir';
    if v_at is null or v_amt is null or v_amt <= 0 or v_dir is null or v_dir not in ('in', 'out') then v_bad := v_bad + 1; continue; end if;
    v_trx := nullif(upper(trim(coalesce(r ->> 'trx', ''))), '');
    v_party := private.dp_phone(r ->> 'party');
    v_key := coalesce(v_trx, 'h:' || md5(concat_ws('|', v_at::text, v_amt::text, v_dir, coalesce(v_party, ''))));
    v_day := (v_at at time zone 'Asia/Dhaka')::date;
    v_new := null;
    insert into public.dp_txns (owner_id, statement_id, provider, txn_at, txn_date, direction, amount, fee, balance, txn_type, trx_id, party_no, party_name, reference, dedupe_key)
    values (v_me, v_st, p_provider, v_at, v_day, v_dir, v_amt,
            coalesce(round(abs(nullif(r ->> 'fee', '')::numeric), 2), 0), round(nullif(r ->> 'balance', '')::numeric, 2),
            nullif(left(trim(coalesce(r ->> 'type', '')), 80), ''), v_trx, v_party,
            nullif(left(trim(coalesce(r ->> 'party_name', '')), 120), ''), nullif(left(trim(coalesce(r ->> 'ref', '')), 300), ''), v_key)
    on conflict on constraint dp_txns_once do nothing returning id into v_new;
    if v_new is not null then v_added := v_added + 1; end if;
    v_min := least(coalesce(v_min, v_day), v_day); v_max := greatest(coalesce(v_max, v_day), v_day);
  end loop;
  update public.dp_statements set row_count = v_n, added_count = v_added, date_from = v_min, date_to = v_max where id = v_st;
  return jsonb_build_object('statement_id', v_st, 'rows', v_n, 'added', v_added, 'skipped', v_n - v_added - v_bad, 'bad', v_bad, 'date_from', v_min, 'date_to', v_max);
end $$;

create or replace function public.dp_statements()
returns table (id uuid, provider text, account_no text, file_name text, date_from date, date_to date, row_count integer, added_count integer, live_count integer, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, s.provider, s.account_no, s.file_name, s.date_from, s.date_to, s.row_count, s.added_count,
         (select count(*)::integer from public.dp_txns t where t.statement_id = s.id and t.removed_at is null), s.created_at
  from public.dp_statements s
  where s.owner_id = private.dp_guard(false) and s.removed_at is null
  order by s.created_at desc limit 500
$$;

-- Taking a statement back removes the lines it brought in (lines kept ticked or changed by hand stay unless p_all).
create or replace function public.dp_statement_remove(p_id uuid, p_all boolean default false) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.dp_guard(true); v_n integer;
begin
  update public.dp_statements set removed_at = now() where id = p_id and owner_id = v_me and removed_at is null;
  if not found then raise exception 'স্টেটমেন্টটা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  update public.dp_txns set removed_at = now() where statement_id = p_id and owner_id = v_me and removed_at is null
    and (p_all or (checked_at is null and edited_at is null));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------- lines
-- p_profile: a profile's lines; p_state: 'all' | 'unchecked' | 'checked' | 'noname' | 'removed'.
create or replace function public.dp_txns(p_from date default null, p_to date default null, p_provider text default null, p_profile uuid default null,
                                          p_state text default 'all', p_q text default null)
returns table (id uuid, provider text, txn_at timestamptz, txn_date date, direction text, amount numeric, fee numeric, balance numeric, txn_type text,
               trx_id text, party_no text, party_name text, reference text, note text, profile_id uuid, profile_name text, by_hand boolean,
               manual boolean, checked boolean, edited boolean, removed boolean)
language sql stable security definer set search_path = '' as $$
  with me as (select private.dp_guard(false) as id),
  t as (select x.*, private.dp_profile_of(x) as pid from public.dp_txns x, me
        where x.owner_id = me.id
          and (p_from is null or x.txn_date >= p_from) and (p_to is null or x.txn_date <= p_to)
          and (p_provider is null or x.provider = p_provider)
          and ((coalesce(p_state, 'all') = 'removed') = (x.removed_at is not null))
          and (coalesce(p_state, 'all') <> 'unchecked' or x.checked_at is null)
          and (coalesce(p_state, 'all') <> 'checked' or x.checked_at is not null))
  select t.id, t.provider, t.txn_at, t.txn_date, t.direction, t.amount, t.fee, t.balance, t.txn_type, t.trx_id, t.party_no, t.party_name, t.reference, t.note,
         t.pid, p.name, t.profile_id is not null, t.statement_id is null, t.checked_at is not null, t.edited_at is not null, t.removed_at is not null
  from t left join public.dp_profiles p on p.id = t.pid
  where (p_profile is null or t.pid = p_profile)
    and (coalesce(p_state, 'all') <> 'noname' or t.pid is null)
    and (nullif(trim(coalesce(p_q, '')), '') is null
         or concat_ws(' ', t.party_no, t.party_name, p.name, t.trx_id, t.reference, t.note, t.txn_type, t.amount::text) ilike '%' || trim(p_q) || '%')
  order by t.txn_at desc, t.created_at desc
  limit 5000
$$;

-- Add a line by hand (p_id null) or change one. p_data keys, all optional on a change:
--  at ('2026-11-20T14:05' Asia/Dhaka clock), dir, amount, fee, provider, type, trx, party, ref, note,
--  profile (uuid, '' = follow the number again, 'none' = nobody's line).
create or replace function public.dp_txn_save(p_id uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.dp_guard(true); d jsonb := coalesce(p_data, '{}'::jsonb); o public.dp_txns; v_id uuid;
  v_at timestamptz; v_prof uuid; v_none boolean;
begin
  if p_id is not null then
    select * into o from public.dp_txns where id = p_id and owner_id = v_me for update;
    if not found then raise exception 'লেনদেনটা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  end if;
  v_at := case when d ? 'at' and nullif(d ->> 'at', '') is not null then (d ->> 'at')::timestamp at time zone 'Asia/Dhaka' else o.txn_at end;
  if v_at is null then raise exception 'তারিখ দিন' using errcode = '22023'; end if;
  if v_at > now() + interval '1 day' then raise exception 'আগামী তারিখের লেনদেন লেখা যায় না' using errcode = '22023'; end if;
  if coalesce(nullif(d ->> 'dir', ''), o.direction) is null or coalesce(nullif(d ->> 'dir', ''), o.direction) not in ('in', 'out') then
    raise exception 'দিলাম না পেলাম, বেছে নিন' using errcode = '22023'; end if;
  if coalesce(nullif(d ->> 'amount', '')::numeric, o.amount, 0) <= 0 then raise exception 'টাকার অঙ্ক দিন' using errcode = '22023'; end if;
  if coalesce(nullif(d ->> 'provider', ''), o.provider, 'cash') not in ('bkash', 'nagad', 'rocket', 'bank', 'cash', 'other') then
    raise exception 'মাধ্যম ঠিক নয়' using errcode = '22023'; end if;
  -- whose line: a profile picked by hand, "nobody", or (empty) follow the number
  v_prof := o.profile_id; v_none := coalesce(o.no_profile, false);
  if d ? 'profile' then
    if d ->> 'profile' = 'none' then v_prof := null; v_none := true;
    elsif nullif(d ->> 'profile', '') is null then v_prof := null; v_none := false;
    else
      select p.id into v_prof from public.dp_profiles p where p.id = (d ->> 'profile')::uuid and p.owner_id = v_me and p.archived_at is null;
      if v_prof is null then raise exception 'প্রোফাইলটা পাওয়া যায়নি' using errcode = 'P0002'; end if;
      v_none := false;
    end if;
  end if;
  if p_id is null then
    v_id := gen_random_uuid();
    insert into public.dp_txns (id, owner_id, provider, txn_at, txn_date, direction, amount, fee, txn_type, trx_id, party_no, reference, note, profile_id, no_profile, dedupe_key)
    values (v_id, v_me, coalesce(nullif(d ->> 'provider', ''), 'cash'), v_at, (v_at at time zone 'Asia/Dhaka')::date, d ->> 'dir',
            round((d ->> 'amount')::numeric, 2), coalesce(round(nullif(d ->> 'fee', '')::numeric, 2), 0),
            nullif(left(trim(coalesce(d ->> 'type', '')), 80), ''), nullif(upper(trim(coalesce(d ->> 'trx', ''))), ''), private.dp_phone(d ->> 'party'),
            nullif(left(trim(coalesce(d ->> 'ref', '')), 300), ''), nullif(left(trim(coalesce(d ->> 'note', '')), 500), ''), v_prof, v_none, 'm:' || v_id::text);
    return v_id;
  end if;
  update public.dp_txns set
    txn_at = v_at, txn_date = (v_at at time zone 'Asia/Dhaka')::date,
    direction = coalesce(nullif(d ->> 'dir', ''), direction),
    amount = coalesce(round(nullif(d ->> 'amount', '')::numeric, 2), amount),
    fee = case when d ? 'fee' then coalesce(round(nullif(d ->> 'fee', '')::numeric, 2), 0) else fee end,
    provider = case when statement_id is null then coalesce(nullif(d ->> 'provider', ''), provider) else provider end,   -- a statement line keeps its wallet (and so its place in re-uploads)
    txn_type = case when d ? 'type' then nullif(left(trim(d ->> 'type'), 80), '') else txn_type end,
    party_no = case when d ? 'party' then private.dp_phone(d ->> 'party') else party_no end,
    reference = case when d ? 'ref' then nullif(left(trim(d ->> 'ref'), 300), '') else reference end,
    note = case when d ? 'note' then nullif(left(trim(d ->> 'note'), 500), '') else note end,
    profile_id = v_prof, no_profile = v_none, edited_at = now()
  where id = p_id;
  return p_id;
end $$;

-- Tick / untick lines as checked.
create or replace function public.dp_txn_check(p_ids uuid[], p_checked boolean default true) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.dp_guard(true); v_n integer;
begin
  update public.dp_txns set checked_at = case when p_checked then coalesce(checked_at, now()) else null end
  where id = any (p_ids) and owner_id = v_me and removed_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Remove lines (they stay out even if the statement is uploaded again) or bring them back.
create or replace function public.dp_txn_remove(p_ids uuid[], p_restore boolean default false) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.dp_guard(true); v_n integer;
begin
  update public.dp_txns set removed_at = case when p_restore then null else coalesce(removed_at, now()) end
  where id = any (p_ids) and owner_id = v_me;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Numbers in my lines that have no profile yet, busiest first — to make profiles from.
create or replace function public.dp_unknown_numbers()
returns table (party_no text, party_name text, txn_count integer, given numeric, got numeric, last_date date)
language sql stable security definer set search_path = '' as $$
  with me as (select private.dp_guard(false) as id)
  select x.party_no, max(x.party_name), count(*)::integer,
         coalesce(sum(x.amount) filter (where x.direction = 'out'), 0), coalesce(sum(x.amount) filter (where x.direction = 'in'), 0), max(x.txn_date)
  from public.dp_txns x, me
  where x.owner_id = me.id and x.removed_at is null and x.party_no is not null and not x.no_profile and private.dp_profile_of(x) is null
  group by x.party_no order by count(*) desc, max(x.txn_date) desc limit 500
$$;

revoke all on function
  public.dp_profile_save(uuid, text, text[], text, numeric), public.dp_profile_remove(uuid), public.dp_profiles(),
  public.dp_statement_import(text, text, text, jsonb), public.dp_statements(), public.dp_statement_remove(uuid, boolean),
  public.dp_txns(date, date, text, uuid, text, text), public.dp_txn_save(uuid, jsonb), public.dp_txn_check(uuid[], boolean),
  public.dp_txn_remove(uuid[], boolean), public.dp_unknown_numbers()
  from public, anon;
grant execute on function
  public.dp_profile_save(uuid, text, text[], text, numeric), public.dp_profile_remove(uuid), public.dp_profiles(),
  public.dp_statement_import(text, text, text, jsonb), public.dp_statements(), public.dp_statement_remove(uuid, boolean),
  public.dp_txns(date, date, text, uuid, text, text), public.dp_txn_save(uuid, jsonb), public.dp_txn_check(uuid[], boolean),
  public.dp_txn_remove(uuid[], boolean), public.dp_unknown_numbers()
  to authenticated, service_role;
