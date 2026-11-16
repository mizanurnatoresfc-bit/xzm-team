-- Applied on the live database from another chat on 15 Nov 2026 and copied here unchanged on 16 Nov 2026,
-- so the repository matches the live database (supabase_migrations.schema_migrations, version 20261115200607).

-- collector ট্রিগার rider_lines, expenses, merchant_payments সব টেবিলে চলে — কলাম না থাকলেও যেন ভাঙে না
create or replace function private.da_note_collector() returns trigger
language plpgsql security definer set search_path = public, private, pg_temp as $$
declare s public.da_sessions; v_user uuid; v_emp uuid; v_name text; v_code text; v_src text;
begin
  v_user := coalesce((to_jsonb(new) ->> 'collector_user')::uuid, auth.uid());
  v_src  := to_jsonb(new) ->> 'source';
  if v_user is null then return new; end if;
  if tg_table_name = 'da_rider_lines' and new.collector_user is null then new.collector_user := v_user; end if;
  -- রাইডারের নিজে পাঠানো লাইন: রাইডারকে নয়, বাছা ম্যানেজারকে collector ধরা হয় (v_user = collector_user)
  select * into s from public.da_sessions where id = new.session_id;
  if s.id is null then return new; end if;
  select e.id, e.full_name, e.employee_code::text into v_emp, v_name, v_code
    from public.employees e where e.profile_id = v_user and e.archived_at is null limit 1;
  if v_name is null then select nullif(p.full_name,''), null into v_name, v_code from public.profiles p where p.id = v_user; end if;
  insert into public.da_sheet_collectors (session_id, user_id, employee_id, name, code)
  values (new.session_id, v_user, v_emp, v_name, v_code)
  on conflict (session_id, user_id) do update set updated_at = now();
  return new;
end $$;

-- ক্যাশ পেমেন্টেও collector রেজিস্ট্রেশন
drop trigger if exists da_cash_collector on public.da_cash_payments;
create trigger da_cash_collector before insert on public.da_cash_payments for each row execute function private.da_note_collector();
