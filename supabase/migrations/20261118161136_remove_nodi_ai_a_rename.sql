-- Live-only migration brought into the repository word for word from supabase_migrations.schema_migrations
-- (live version 20261118161136 remove_nodi_ai_a_rename, applied on 18 Nov 2026 from another session).
-- Posts written by the system in a hub group are signed "সিস্টেম" (no longer "নদী AI"); two attendance-gap functions
-- are rewritten with plain Bangla messages and without the AI wording.
create or replace function private.hub_post_add(p_hub uuid, p_kind text, p_body text, p_issue uuid, p_as_nodi boolean default false, p_photo text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  insert into public.hub_posts (hub_id, author_profile, author_name, kind, body, issue_id, photo_path)
  values (p_hub, case when p_as_nodi then null else auth.uid() end, case when p_as_nodi then 'সিস্টেম' else private.my_display_name() end,
          p_kind, nullif(trim(coalesce(p_body, '')), ''), p_issue, p_photo)
  returning id into v;
  return v;
end $$;

create or replace function public.att_gap_check(p_ids uuid[], p_ok boolean, p_note text default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare a public.attendance_gap_answers; n integer := 0; v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  if p_ok is null then raise exception 'ঠিক আছে নাকি ফেরত — বলুন' using errcode = '22023'; end if;
  if not p_ok and v_note is null then raise exception 'ফেরত পাঠানোর কারণ লিখুন' using errcode = '22023'; end if;
  for a in select * from public.attendance_gap_answers where id = any (coalesce(p_ids, '{}')) for update loop
    if not private.employee_has_permission('hr.attendance_gap.approve', a.employee_id) then
      raise exception 'এই উত্তর যাচাই করার অনুমতি নেই' using errcode = '42501'; end if;
    if private.is_self_employee(a.employee_id) then raise exception 'নিজের উত্তর নিজে যাচাই করা যায় না' using errcode = '42501'; end if;
    update public.attendance_gap_answers
       set status = case when p_ok then 'verified' else 'returned' end, checked_by = auth.uid(), checked_at = now(), check_note = v_note
     where id = a.id;
    if not p_ok then
      perform private.notify((select e.profile_id from public.employees e where e.id = a.employee_id),
        'হাজিরার উত্তর ফেরত এসেছে', to_char(a.work_date, 'DD Mon') || ' — ' || v_note, '/app', 'attendance_gap');
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.att_gap_remind(p_from date, p_to date, p_hub uuid default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  for r in
    select e.profile_id, count(*) days, string_agg(to_char(g.work_date, 'DD'), ', ' order by g.work_date) dates
    from private.attendance_gap_days(p_from, p_to) g
    join public.employees e on e.id = g.employee_id
    left join public.attendance_gap_answers a on a.employee_id = g.employee_id and a.work_date = g.work_date
    where (p_hub is null or e.hub_id = p_hub) and e.profile_id is not null
      and (a.id is null or a.status = 'returned')
      and private.has_permission('hr.attendance_gap.approve', e.zone_id, e.hub_id)
    group by e.profile_id
  loop
    perform private.notify(r.profile_id, 'আপনার ' || r.days || ' দিনের হাজিরা নেই',
      'তারিখ: ' || r.dates || ' — কারণ জানান (ছুটি হলে এখান থেকেই আবেদন দিন)', '/app', 'attendance_gap');
    n := n + 1;
  end loop;
  return n;
end $$;
