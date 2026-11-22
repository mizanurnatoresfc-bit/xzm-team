-- =====================================================================
-- XZM-TEAM ERP — Migration: staff lifecycle (hub manager asks, zonal manager decides)
--
--  Two roles, one flow, built on what is already there (hr_requests,
--  employee_applications, employee_assignments, employee_status_history):
--
--  * Hub manager, from the active staff list of the hub:
--      hr_staff_leave_request  "চাকরি ছেড়ে দিয়েছে"  -> hr_requests (id_inactive)
--      hr_staff_join_request   "নতুন স্টাফ যোগ"      -> applicant + submitted
--                              employee_applications row + hr_requests (id_create)
--  * Zonal manager (anyone with hr.request.approve in the hub's zone):
--      hr_request_inbox        what is waiting, with the person, the reason,
--                              who sent it and (for a leaver) the final accounts
--      hr_request_decide       approve / reject. Approving does the real change:
--                                id_create   -> Employee ID, active, joining assignment
--                                id_inactive -> resigned / terminated, exit assignment
--                                id_transfer -> hub transfer (old assignment closed, new opened)
--                                id_active   -> active again
--      hr_staff_transfer       zonal starts and finishes a transfer in one step
--  * Every approved joining / exit / transfer writes one row to
--    hr_record_files: the company's Excel layout (employee_formats, purpose
--    export / both, the zone's own format first) filled in at that moment.
--    The HR records page downloads it as .xlsx.
--
--  Rules kept:
--  * Two-person rule on applications: whoever sent a new-staff request cannot
--    approve it (Super Admin excepted, as in hr_approve_application).
--  * No new status values, no leave flow.
--  * A hub manager can only ask; resigned / terminated / transfer happen only
--    through hr.request.approve.
--  * The new-staff form is short, so the application is sent without the
--    "ID-ready profile" check; what is still missing is shown to the approver.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. Generated files (joining / exit / transfer)
-- ---------------------------------------------------------------------
create sequence public.hr_record_no_seq;
create table public.hr_record_files (
  id              uuid primary key default gen_random_uuid(),
  record_no       text not null unique default ('REC-' || lpad(nextval('public.hr_record_no_seq')::text, 5, '0')),
  request_id      uuid references public.hr_requests(id),
  employee_id     uuid not null references public.employees(id),
  kind            text not null check (kind in ('joining', 'exit', 'transfer')),
  employee_status text not null,
  employee_name   text not null,
  employee_code   text,
  zone_id         uuid not null references public.zones(id),
  hub_id          uuid references public.hubs(id),
  to_hub_id       uuid references public.hubs(id),
  action_date     date not null,
  reason          text,
  format_id       uuid references public.employee_formats(id),
  title           text not null,
  file_name       text not null,
  heads           jsonb not null check (jsonb_typeof(heads) = 'array'),
  cells           jsonb not null check (jsonb_typeof(cells) = 'array'),
  accounts        jsonb check (accounts is null or jsonb_typeof(accounts) = 'object'),
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid()
);
create index hr_record_files_zone_idx on public.hr_record_files (zone_id, action_date desc);
create index hr_record_files_hub_idx on public.hr_record_files (hub_id);
create index hr_record_files_to_hub_idx on public.hr_record_files (to_hub_id);
create index hr_record_files_employee_idx on public.hr_record_files (employee_id);
create index hr_record_files_request_idx on public.hr_record_files (request_id);
create index hr_record_files_format_idx on public.hr_record_files (format_id);

create trigger hr_record_files_no_delete before delete on public.hr_record_files
  for each row execute function private.prevent_delete();
create trigger hr_record_files_audit after insert on public.hr_record_files
  for each row execute function private.audit_row('hr');

alter table public.hr_record_files enable row level security;
revoke all on public.hr_record_files from anon, authenticated;
-- The archive belongs to whoever decides requests there (zonal manager, HR, admin). Rows are written only by the functions below.
create policy hr_record_files_read on public.hr_record_files for select to authenticated using (
  private.has_permission('hr.request.approve', zone_id, hub_id)
  or (to_hub_id is not null and private.has_permission('hr.request.approve', private.hub_zone(to_hub_id), to_hub_id)));
grant select on public.hr_record_files to authenticated;

-- ---------------------------------------------------------------------
--  2. Helpers
-- ---------------------------------------------------------------------
-- Final accounts of a leaver on their last working day: salary still owed for the
-- month (the month's salary sheet line when there is one, else the fixed pay
-- for the days worked) and the person's khata (daily accounts: taken, paid in, due).
create or replace function private.hr_exit_accounts(p_employee uuid, p_date date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.employees%rowtype;
  v_basic numeric := 0; v_transport numeric := 0; v_commission numeric := 0;
  v_month date := date_trunc('month', p_date)::date;
  v_from date; v_days int; v_dim int;
  v_unpaid numeric; v_source text := 'estimate';
  v_sheet numeric;
  v_amount numeric; v_paid numeric; v_due numeric; v_lines int;
begin
  select * into e from public.employees where id = p_employee;
  if e.id is null then return null; end if;
  select c.basic_salary, c.transport_allowance, c.commission into v_basic, v_transport, v_commission
    from public.employee_compensation c
   where c.employee_id = p_employee and c.status = 'approved' and c.effective_from <= p_date
   order by c.effective_from desc limit 1;
  v_basic := coalesce(v_basic, 0); v_transport := coalesce(v_transport, 0); v_commission := coalesce(v_commission, 0);

  v_from := greatest(v_month, coalesce(e.joining_date, v_month));
  v_days := greatest(0, p_date - v_from + 1);
  v_dim := extract(day from (v_month + interval '1 month' - interval '1 day'))::int;
  v_unpaid := round((v_basic + v_transport) * v_days / v_dim);

  select l.net_payable into v_sheet
    from public.salary_sheet_lines l join public.salary_sheets s on s.id = l.sheet_id
   where l.employee_id = p_employee and s.period_month = v_month and s.status <> 'cancelled'
   order by s.created_at desc limit 1;
  if v_sheet is not null then v_unpaid := v_sheet; v_source := 'salary_sheet'; end if;

  select coalesce(sum(r.amount), 0), coalesce(sum(r.paid_amount + r.mobile_banking), 0), coalesce(sum(r.due), 0), count(*)
    into v_amount, v_paid, v_due, v_lines
    from public.da_rider_lines r
   where r.employee_id = p_employee and r.removed_at is null;

  return jsonb_build_object(
    'as_of', p_date, 'basic_salary', v_basic, 'transport_allowance', v_transport, 'commission', v_commission,
    'last_salary', v_basic + v_transport + v_commission,
    'salary_days', v_days, 'month_days', v_dim, 'unpaid_salary', v_unpaid, 'salary_source', v_source,
    'khata_lines', v_lines, 'khata_amount', v_amount, 'khata_deposit', v_paid, 'khata_due', v_due,
    'net_payable', v_unpaid - v_due);
end $$;

-- The company layout for a zone: the zone's own format first, then the default one.
create or replace function private.hr_pick_format(p_zone uuid, p_purposes text[])
returns public.employee_formats
language sql stable security definer set search_path = '' as $$
  select f from public.employee_formats f
   where f.archived_at is null and f.purpose = any (p_purposes)
     and (f.zone_id is null or f.zone_id = p_zone)
   order by (f.zone_id is not null) desc, f.is_default desc, f.name
   limit 1
$$;

create or replace function private.hr_next_code() returns text
language sql stable security definer set search_path = '' as $$
  select (coalesce(max((employee_code::text)::bigint), 0) + 1)::text
    from public.employees where employee_code::text ~ '^[0-9]{1,9}$'
$$;

-- Logins that manage one hub (hub-scoped role that may send HR requests).
create or replace function private.hub_request_senders(p_hub uuid)
returns table (profile_id uuid)
language sql stable security definer set search_path = '' as $$
  select distinct ur.user_id
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id and r.status = 'active' and r.archived_at is null
    join public.profiles pr on pr.id = ur.user_id and pr.status = 'active' and pr.archived_at is null
    join public.role_permissions rp on rp.role_id = r.id
    join public.permissions p on p.id = rp.permission_id and p.code = 'hr.request.create'
   where ur.scope_type = 'hub' and ur.hub_id = p_hub and p_hub is not null
     and ur.revoked_at is null and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date)
$$;

create or replace function private.hr_request_insert(
  p_kind text, p_employee uuid, p_hub uuid, p_data jsonb, p_status text default 'submitted')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  f public.hr_request_formats;
  v_code text := case p_kind when 'id_create' then 'ID_CREATE' when 'id_inactive' then 'ID_INACTIVE'
                             when 'id_transfer' then 'ID_TRANSFER' when 'id_active' then 'ID_ACTIVE' end;
  v_zone uuid := private.hub_zone(p_hub);
  v_id uuid;
begin
  if v_zone is null then raise exception 'হাব পাওয়া যায়নি' using errcode = 'P0002'; end if;
  select * into f from public.hr_request_formats
   where kind = p_kind and archived_at is null
   order by (code = v_code::extensions.citext) desc, sort_order limit 1;
  if not found then raise exception 'এই কাজের রিকুয়েস্ট ফরম্যাট নেই (%)', v_code using errcode = 'P0002'; end if;
  perform set_config('app.change_reason', 'HR request: ' || f.name, true);
  insert into public.hr_requests (format_id, kind, employee_id, zone_id, hub_id, data, status, submitter_employee_id)
  values (f.id, f.kind, p_employee, v_zone, p_hub, p_data, p_status, private.my_employee_id())
  returning id into v_id;
  insert into public.hr_request_events (request_id, status, note, by_name)
  values (v_id, 'submitted', nullif(trim(coalesce(p_data ->> 'reason', '')), ''), private.my_display_name());
  return v_id;
end $$;

-- One cell of a company layout as it should stand in the sheet.
create or replace function private.hr_cell(p_field text, p_value jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then to_jsonb(''::text)
    when p_field in ('joining_date', 'status_since', 'date_of_birth') and (p_value #>> '{}') ~ '^\d{4}-\d{2}-\d{2}'
      then to_jsonb(to_char((p_value #>> '{}')::date, 'DD/MM/YYYY'))
    when p_field = 'status' then to_jsonb(initcap(p_value #>> '{}'))
    when jsonb_typeof(p_value) = 'number' then p_value
    when jsonb_typeof(p_value) = 'array' then to_jsonb((select string_agg(x, ', ') from jsonb_array_elements_text(p_value) x))
    else to_jsonb(p_value #>> '{}') end
$$;

-- Writes the file of one joining / exit / transfer in the company layout.
create or replace function private.hr_make_record_file(
  p_request uuid, p_kind text, p_employee uuid, p_date date, p_reason text,
  p_from_hub uuid default null, p_to_hub uuid default null, p_accounts jsonb default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees%rowtype;
  f public.employee_formats;
  v_cols jsonb := '[]'::jsonb;
  v_fields text[];
  v_row jsonb;
  v_heads jsonb := to_jsonb(array['SL']);
  v_cells jsonb := '[1]'::jsonb;
  c jsonb;
  k text;
  v_hub uuid;
  v_title text;
  v_id uuid;
  d constant text := 'DD/MM/YYYY';
begin
  select * into e from public.employees where id = p_employee;
  v_hub := coalesce(p_from_hub, e.hub_id);
  f := private.hr_pick_format(e.zone_id, array['export', 'both']);
  if f.id is not null then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_cols
      from jsonb_array_elements(f.columns) x where private.export_field_ok(x ->> 'field');
  end if;
  -- the file always carries who it is about, whatever the layout holds
  foreach k in array array['employee_code', 'full_name', 'mobile', 'position_name', 'hub_name', 'joining_date'] loop
    if not exists (select 1 from jsonb_array_elements(v_cols) x where x ->> 'field' = k) then
      v_cols := v_cols || jsonb_build_object('field', k, 'label', case k
        when 'employee_code' then 'Employee ID' when 'full_name' then 'Name' when 'mobile' then 'Mobile'
        when 'position_name' then 'Position' when 'hub_name' then 'Hub' else 'Joining Date' end);
    end if;
  end loop;
  select array_agg(x ->> 'field') into v_fields from jsonb_array_elements(v_cols) x;
  -- same rules as every staff export: private columns stay blank without the permission
  v_row := coalesce(public.hr_sheet_people(array[p_employee], v_fields) -> p_employee::text, '{}'::jsonb);
  -- the basics come from the record itself
  v_row := v_row || jsonb_strip_nulls(jsonb_build_object(
    'employee_code', e.employee_code::text, 'full_name', e.full_name, 'mobile', e.mobile, 'joining_date', e.joining_date,
    'status', e.status,
    'position_name', (select p.name from public.positions p where p.id = e.position_id),
    'hub_name', (select h.name from public.hubs h where h.id = v_hub)));
  for c in select * from jsonb_array_elements(v_cols) loop
    v_heads := v_heads || to_jsonb(coalesce(nullif(trim(c ->> 'label'), ''), nullif(trim(c ->> 'label_bn'), ''), c ->> 'field'));
    v_cells := v_cells || jsonb_build_array(private.hr_cell(c ->> 'field', v_row -> (c ->> 'field')));
  end loop;

  if p_kind = 'joining' then
    v_title := 'Joining File';
    v_heads := v_heads || to_jsonb(array['Approved On', 'Remarks']);
    v_cells := v_cells || jsonb_build_array(to_char(current_date, d), coalesce(p_reason, ''));
  elsif p_kind = 'transfer' then
    v_title := 'Transfer File';
    v_heads := v_heads || to_jsonb(array['From Hub', 'To Hub', 'Transfer Date', 'Reason']);
    v_cells := v_cells || jsonb_build_array(
      coalesce((select h.name from public.hubs h where h.id = p_from_hub), ''),
      coalesce((select h.name from public.hubs h where h.id = p_to_hub), ''), to_char(p_date, d), coalesce(p_reason, ''));
  else
    v_title := 'Exit File — Final Accounts';
    v_heads := v_heads || to_jsonb(array['Last Working Day', 'Exit Type', 'Reason', 'Last Salary (Monthly)', 'Salary Days',
      'Unpaid Salary', 'Khata Deposit', 'Khata Due', 'Net Payable']);
    v_cells := v_cells || jsonb_build_array(to_char(p_date, d), initcap(e.status), coalesce(p_reason, ''),
      coalesce(p_accounts -> 'last_salary', '0'), coalesce(p_accounts -> 'salary_days', '0'),
      coalesce(p_accounts -> 'unpaid_salary', '0'), coalesce(p_accounts -> 'khata_deposit', '0'),
      coalesce(p_accounts -> 'khata_due', '0'), coalesce(p_accounts -> 'net_payable', '0'));
  end if;

  insert into public.hr_record_files (request_id, employee_id, kind, employee_status, employee_name, employee_code, zone_id, hub_id, to_hub_id,
      action_date, reason, format_id, title, file_name, heads, cells, accounts)
  values (p_request, p_employee, p_kind, e.status, e.full_name, e.employee_code::text, coalesce(private.hub_zone(v_hub), e.zone_id), v_hub, p_to_hub,
      p_date, nullif(trim(coalesce(p_reason, '')), ''), f.id, v_title,
      initcap(p_kind) || '-File-' || coalesce(e.employee_code::text, 'new') || '-' || to_char(p_date, 'YYYYMMDD') || '.xlsx',
      v_heads, v_cells, p_accounts)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
--  3. Hub manager: "চাকরি ছেড়ে দিয়েছে"
--     With p_exit_type ('resigned' | 'terminated') a person who may decide
--     requests finishes it in the same step (the zonal manager's own button).
-- ---------------------------------------------------------------------
create or replace function public.hr_staff_leave_request(
  p_employee uuid, p_reason text, p_last_date date default null, p_exit_type text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees%rowtype;
  v_last date := least(coalesce(p_last_date, current_date), current_date);
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  select * into e from public.employees where id = p_employee and archived_at is null for update;
  if e.id is null then raise exception 'স্টাফ পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.request.create', e.zone_id, e.hub_id) then
    raise exception 'এই হাবের স্টাফের জন্য অনুরোধ পাঠানোর অনুমতি নেই' using errcode = '42501';
  end if;
  if e.status <> 'active' then raise exception 'শুধু সক্রিয় স্টাফের জন্য এই অনুরোধ দেওয়া যায়' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'কারণ লিখুন' using errcode = '22023'; end if;
  if p_exit_type is not null and p_exit_type not in ('resigned', 'terminated') then
    raise exception 'ভুল ধরন' using errcode = '22023';
  end if;
  if exists (select 1 from public.hr_requests r where r.employee_id = p_employee and r.kind = 'id_inactive'
                and r.status in ('submitted', 'processing')) then
    raise exception 'এই স্টাফের জন্য একটি অনুরোধ আগে থেকেই অপেক্ষমাণ আছে' using errcode = 'P0001';
  end if;

  v_id := private.hr_request_insert('id_inactive', e.id, e.hub_id, jsonb_build_object(
      'employee_code', coalesce(e.employee_code::text, ''), 'full_name', e.full_name,
      'hub', coalesce((select h.name from public.hubs h where h.id = e.hub_id), ''),
      'position', coalesce((select p.name from public.positions p where p.id = e.position_id), ''),
      'last_date', v_last::text,
      'reason_type', case when p_exit_type = 'terminated' then 'অফিস থেকে বাদ' else 'চাকরি ছেড়ে দিচ্ছি' end,
      'reason', trim(p_reason)),
    case when p_exit_type is null then 'submitted' else 'processing' end);
  if p_exit_type is not null then
    perform public.hr_request_decide(v_id, true, null, jsonb_build_object('exit_type', p_exit_type));
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
--  4. Hub manager: "নতুন স্টাফ যোগ"
--     p_data holds the boxes of the form by their employee_formats field name.
-- ---------------------------------------------------------------------
create or replace function public.hr_staff_join_request(p_hub uuid, p_position uuid, p_data jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_zone uuid := private.hub_zone(p_hub);
  pos public.positions%rowtype;
  t jsonb := coalesce(p_data, '{}'::jsonb);
  v_name text := nullif(trim(coalesce(t ->> 'full_name', '')), '');
  v_mobile text := nullif(regexp_replace(coalesce(t ->> 'mobile', ''), '[^0-9]', '', 'g'), '');
  v_emg text := nullif(regexp_replace(coalesce(t ->> 'emergency_contact_phone', ''), '[^0-9]', '', 'g'), '');
  v_join date := nullif(trim(coalesce(t ->> 'joining_date', '')), '')::date;
  v_ref uuid;
  v_emp uuid;
  v_id uuid;
  k text; v text;
  cf public.employee_custom_fields%rowtype;
  v_num constant text := '^[0-9]+(\.[0-9]+)?$';
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  if v_zone is null then raise exception 'হাব বেছে নিন' using errcode = '22023'; end if;
  if not (private.has_permission('hr.request.create', v_zone, p_hub) and private.has_permission('hr.application.create', v_zone, p_hub)) then
    raise exception 'এই হাবে নতুন স্টাফের আবেদন পাঠানোর অনুমতি নেই' using errcode = '42501';
  end if;
  if jsonb_typeof(t) <> 'object' then raise exception 'তথ্য দিন' using errcode = '22023'; end if;
  if v_name is null or length(v_name) < 2 then raise exception 'পুরো নাম লিখুন' using errcode = '22023'; end if;
  if v_mobile is null or v_mobile !~ private.setting_text('hr.mobile_pattern') then
    raise exception 'সঠিক মোবাইল নম্বর দিন (যেমন 01711000000)' using errcode = '22023';
  end if;
  if v_emg is not null and v_emg !~ private.setting_text('hr.mobile_pattern') then
    raise exception 'জরুরি যোগাযোগের মোবাইল নম্বর সঠিক নয়' using errcode = '22023';
  end if;
  select * into pos from public.positions where id = p_position and archived_at is null;
  if pos.id is null then raise exception 'পদবি বেছে নিন' using errcode = '22023'; end if;
  if v_join is not null and v_join > current_date + 31 then raise exception 'যোগদানের তারিখ ঠিক নয়' using errcode = '22023'; end if;
  if exists (select 1 from public.employees x where x.mobile = v_mobile and x.status <> 'rejected' and x.archived_at is null) then
    raise exception 'এই মোবাইল নম্বরে একজন স্টাফ বা আবেদন আগে থেকেই আছে' using errcode = '23505';
  end if;
  if nullif(trim(coalesce(t ->> 'referrer_code', '')), '') is not null then
    select x.id into v_ref from public.employees x
     where x.employee_code = trim(t ->> 'referrer_code')::extensions.citext and x.archived_at is null;
    if v_ref is null then raise exception 'রেফারেন্সের আইডি পাওয়া যায়নি' using errcode = 'P0002'; end if;
  end if;

  perform set_config('app.change_reason', 'New staff request from the hub', true);
  insert into public.employees (full_name, full_name_bn, mobile, email, hub_id, department_id, position_id, joining_date,
      emergency_contact_name, emergency_contact_phone, referred_by_employee_id)
  values (v_name, nullif(trim(coalesce(t ->> 'full_name_bn', '')), ''), v_mobile,
      nullif(trim(coalesce(t ->> 'email', '')), '')::extensions.citext, p_hub, pos.department_id, pos.id, v_join,
      nullif(trim(coalesce(t ->> 'emergency_contact_name', '')), ''), v_emg, v_ref)
  returning id into v_emp;

  if exists (select 1 from jsonb_each_text(t) x where x.key in ('nid_number', 'date_of_birth', 'father_name', 'mother_name',
              'present_address', 'permanent_address') and trim(x.value) <> '') then
    insert into public.employee_sensitive (employee_id, nid_number, date_of_birth, father_name, mother_name, present_address, permanent_address)
    values (v_emp, nullif(trim(coalesce(t ->> 'nid_number', '')), ''), nullif(trim(coalesce(t ->> 'date_of_birth', '')), '')::date,
      nullif(trim(coalesce(t ->> 'father_name', '')), ''), nullif(trim(coalesce(t ->> 'mother_name', '')), ''),
      nullif(trim(coalesce(t ->> 'present_address', '')), ''), nullif(trim(coalesce(t ->> 'permanent_address', '')), ''));
  end if;

  if trim(coalesce(t ->> 'basic_salary', '')) ~ v_num then
    insert into public.employee_compensation (employee_id, effective_from, basic_salary, transport_allowance, commission, status, reason)
    values (v_emp, coalesce(v_join, current_date), (trim(t ->> 'basic_salary'))::numeric,
      case when trim(coalesce(t ->> 'transport_allowance', '')) ~ v_num then (trim(t ->> 'transport_allowance'))::numeric else 0 end,
      case when trim(coalesce(t ->> 'commission', '')) ~ v_num then (trim(t ->> 'commission'))::numeric else 0 end,
      'pending', 'New staff request from the hub');
  end if;

  for k, v in select x.key, trim(x.value) from jsonb_each_text(t) x where x.key like 'cf:%' and trim(coalesce(x.value, '')) <> '' loop
    select * into cf from public.employee_custom_fields
     where code = substr(k, 4)::extensions.citext and archived_at is null and (zone_id is null or zone_id = v_zone);
    if cf.id is not null then
      insert into public.employee_custom_field_values (employee_id, field_id, value)
      values (v_emp, cf.id, case when cf.field_type = 'number' and v ~ v_num then to_jsonb(v::numeric)
                                 when cf.field_type = 'checkbox' then to_jsonb(v in ('true', '1', 'yes'))
                                 when cf.field_type = 'multi_select' then to_jsonb(string_to_array(v, ','))
                                 else to_jsonb(v) end);
    end if;
  end loop;

  -- The application goes straight to the approver. Whoever sends it can never approve it (two-person rule).
  insert into public.employee_applications (employee_id, status, submitted_by, submitted_at)
  values (v_emp, 'submitted', auth.uid(), now());
  perform private.write_audit('SUBMIT', 'hr', 'employee_applications', v_emp::text, null, null, 'New staff request sent for approval');

  v_id := private.hr_request_insert('id_create', v_emp, p_hub, jsonb_strip_nulls(jsonb_build_object(
      'full_name', v_name, 'mobile', v_mobile, 'position', pos.name, 'joining_date', v_join::text,
      'nid', nullif(trim(coalesce(t ->> 'nid_number', '')), ''),
      'address', nullif(trim(coalesce(t ->> 'permanent_address', t ->> 'present_address', '')), ''),
      'reason', nullif(trim(coalesce(t ->> 'note', '')), ''))));
  return v_id;
end $$;

-- ---------------------------------------------------------------------
--  5. Zonal manager: approve / reject
--     p_opts: employee_code (id_create), exit_type + effective_date (id_inactive),
--             to_hub + effective_date (id_transfer), effective_date (id_active)
-- ---------------------------------------------------------------------
create or replace function public.hr_request_decide(p_id uuid, p_approve boolean, p_note text default null, p_opts jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.hr_requests;
  e public.employees%rowtype;
  a public.employee_applications%rowtype;
  o jsonb := coalesce(p_opts, '{}'::jsonb);
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_reason text;
  v_eff date;
  v_code text;
  v_status text;
  v_to uuid;
  v_from uuid;
  v_accounts jsonb;
  v_file uuid;
  v_result text;
  v_what text;
  v_title text;
  v_link text;
  u uuid;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  select * into r from public.hr_requests where id = p_id for update;
  if not found then raise exception 'রিকুয়েস্ট পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.request.approve', r.zone_id, r.hub_id) then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
  if r.status not in ('submitted', 'processing') then raise exception 'এই রিকুয়েস্ট আগেই শেষ হয়েছে' using errcode = 'P0001'; end if;
  if r.kind not in ('id_create', 'id_inactive', 'id_transfer', 'id_active') then
    raise exception 'এই ধরনের রিকুয়েস্ট “রিকুয়েস্ট ও আবেদন” পাতা থেকে শেষ করুন' using errcode = '22023';
  end if;
  if r.employee_id is not null then
    select * into e from public.employees where id = r.employee_id for update;
  end if;
  v_reason := nullif(concat_ws(' — ', nullif(trim(coalesce(r.data ->> 'reason_type', '')), ''), nullif(trim(coalesce(r.data ->> 'reason', '')), '')), '');
  v_what := case r.kind when 'id_create' then 'নতুন স্টাফ' when 'id_inactive' then 'চাকরি ছাড়া'
                        when 'id_transfer' then 'বদলি' else 'আইডি চালু' end;

  if not coalesce(p_approve, false) then
    if v_note is null then raise exception 'বাতিলের কারণ লিখুন' using errcode = '22023'; end if;
    if r.kind = 'id_create' and e.id is not null and e.status = 'applicant' then
      update public.employee_applications
         set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_note
       where employee_id = e.id and status = 'submitted';
      if found then
        perform set_config('app.change_reason', v_note, true);
        update public.employees set status = 'rejected', status_since = current_date where id = e.id;
        insert into public.employee_status_history (employee_id, from_status, to_status, effective_date, reason)
        values (e.id, 'applicant', 'rejected', current_date, v_note);
      end if;
    end if;
    v_status := 'rejected';
  else
    if e.id is null then
      raise exception 'এই রিকুয়েস্টে কোনো স্টাফ যুক্ত নেই — “রিকুয়েস্ট ও আবেদন” পাতা থেকে শেষ করুন' using errcode = 'P0001';
    end if;

    if r.kind = 'id_create' then
      select * into a from public.employee_applications where employee_id = e.id for update;
      if a.status is distinct from 'submitted' or e.status <> 'applicant' then
        raise exception 'আবেদনটি অনুমোদনের অবস্থায় নেই' using errcode = 'P0001';
      end if;
      -- two-person rule, as in hr_approve_application
      if (a.submitted_by = auth.uid() or r.submitted_by = auth.uid()) and not private.is_super_admin() then
        raise exception 'যিনি আবেদন পাঠিয়েছেন তিনি নিজে অনুমোদন করতে পারবেন না — অন্য একজন অনুমোদন করবেন' using errcode = '42501';
      end if;
      v_code := upper(nullif(trim(coalesce(o ->> 'employee_code', '')), ''));
      if v_code is null then v_code := private.hr_next_code(); end if;
      if v_code !~ private.setting_text('hr.employee_code_pattern') then
        raise exception 'এমপ্লয়ি আইডি "%" কোম্পানির নিয়মের সাথে মিলছে না', v_code using errcode = '23514';
      end if;
      if exists (select 1 from public.employees x where x.employee_code = v_code::extensions.citext) then
        raise exception 'এমপ্লয়ি আইডি % আগেই ব্যবহার হয়েছে', v_code using errcode = '23505';
      end if;
      v_eff := coalesce(e.joining_date, current_date);
      perform set_config('app.change_reason', 'New staff request ' || r.request_no || ' approved', true);
      update public.employees
         set employee_code = v_code, status = 'active', status_since = v_eff, joining_date = v_eff
       where id = e.id;
      update public.employee_applications
         set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_note
       where employee_id = e.id;
      insert into public.employee_assignments
        (employee_id, change_type, department_id, position_id, zone_id, hub_id, reporting_manager_id, effective_from, reason)
      values (e.id, 'joining', e.department_id, e.position_id, e.zone_id, e.hub_id, e.reporting_manager_id, v_eff,
              'Application approved (' || r.request_no || ')');
      insert into public.employee_status_history (employee_id, from_status, to_status, effective_date, reason)
      values (e.id, 'applicant', 'active', v_eff, coalesce(v_note, 'Application approved'));
      update public.employee_compensation
         set status = 'approved', approved_by = auth.uid(), approved_at = now()
       where employee_id = e.id and status = 'pending';
      v_file := private.hr_make_record_file(r.id, 'joining', e.id, v_eff, v_note);
      v_result := v_code;

    elsif r.kind = 'id_inactive' then
      if e.status not in ('active', 'inactive') then
        raise exception 'এই স্টাফ এখন সক্রিয় নেই' using errcode = 'P0001';
      end if;
      if e.profile_id = auth.uid() then
        raise exception 'নিজের চাকরির অবস্থা নিজে বদলানো যায় না' using errcode = '42501';
      end if;
      v_status := coalesce(nullif(trim(coalesce(o ->> 'exit_type', '')), ''), 'resigned');
      if v_status not in ('resigned', 'terminated') then raise exception 'ভুল ধরন' using errcode = '22023'; end if;
      v_eff := least(coalesce(nullif(o ->> 'effective_date', '')::date, nullif(r.data ->> 'last_date', '')::date, current_date), current_date);
      v_reason := coalesce(v_reason, v_note, 'HR request ' || r.request_no);
      v_accounts := private.hr_exit_accounts(e.id, v_eff);

      perform set_config('app.change_reason', v_reason, true);
      update public.employees set status = v_status, status_since = v_eff where id = e.id;
      insert into public.employee_status_history (employee_id, from_status, to_status, effective_date, reason)
      values (e.id, e.status, v_status, v_eff, v_reason);
      update public.employee_assignments set effective_to = greatest(v_eff, effective_from)
       where employee_id = e.id and effective_to is null;
      -- the exit itself, as a closed row of the assignment history
      insert into public.employee_assignments
        (employee_id, change_type, department_id, position_id, zone_id, hub_id, reporting_manager_id, effective_from, effective_to, reason)
      values (e.id, 'exit', e.department_id, e.position_id, e.zone_id, e.hub_id, e.reporting_manager_id, v_eff, v_eff, v_reason);
      if e.profile_id is not null then
        update public.profiles set status = 'inactive' where id = e.profile_id;
      end if;
      v_file := private.hr_make_record_file(r.id, 'exit', e.id, v_eff, v_reason, e.hub_id, null, v_accounts);
      v_result := case v_status when 'terminated' then 'অব্যাহতি' else 'চাকরি ছেড়েছেন' end;

    elsif r.kind = 'id_transfer' then
      if coalesce(o ->> 'to_hub', r.data ->> 'to_hub', '') !~ '^[0-9a-fA-F-]{36}$' then
        raise exception 'নতুন হাব বেছে নিন' using errcode = '22023';
      end if;
      v_to := coalesce(nullif(o ->> 'to_hub', ''), r.data ->> 'to_hub')::uuid;
      v_from := e.hub_id;
      if v_to = v_from then raise exception 'কর্মী এখনই এই হাবে আছেন — অন্য হাব বেছে নিন' using errcode = '22023'; end if;
      v_eff := coalesce(nullif(o ->> 'effective_date', '')::date, nullif(r.data ->> 'effective_date', '')::date, current_date);
      v_reason := coalesce(v_reason, v_note, 'HR request ' || r.request_no);
      -- the file is filled while the person is still in the old hub; a refused transfer rolls it back
      v_file := private.hr_make_record_file(r.id, 'transfer', e.id, v_eff, v_reason, v_from, v_to);
      perform public.hr_transfer_employee(e.id, v_to, e.department_id, e.position_id, e.reporting_manager_id, v_eff, v_reason, 'transfer');
      v_result := (select h.name from public.hubs h where h.id = v_to);

    else  -- id_active
      v_eff := least(coalesce(nullif(o ->> 'effective_date', '')::date, nullif(r.data ->> 'effective_date', '')::date, current_date), current_date);
      perform public.hr_change_status(e.id, 'active', v_eff, coalesce(v_reason, v_note, 'HR request ' || r.request_no));
      v_result := 'আইডি চালু';
    end if;
    v_status := 'done';
  end if;

  perform set_config('app.change_reason', 'HR request ' || r.request_no || ' → ' || v_status, true);
  update public.hr_requests
     set status = v_status, decided_by = auth.uid(), decided_at = now(),
         decision_note = coalesce(v_note, decision_note), result = coalesce(v_result, result)
   where id = p_id;
  insert into public.hr_request_events (request_id, status, note, by_name)
  values (p_id, v_status, concat_ws(' · ', v_note, v_result), private.my_display_name());

  -- the sender, the hub's managers (both hubs of a transfer) and the person are told; each row also goes out as a phone push
  v_title := case when v_status = 'done' then 'অনুমোদিত: ' else 'বাতিল: ' end || v_what || ' · '
             || coalesce(nullif(r.data ->> 'full_name', ''), e.full_name, '') || ' · ' || r.request_no;
  for u in
    select x.profile_id from (
      select r.submitted_by as profile_id
      union select s.profile_id from private.hub_request_senders(r.hub_id) s
      union select s.profile_id from private.hub_request_senders(v_to) s
    ) x where x.profile_id is not null
  loop
    v_link := case when exists (select 1 from private.profiles_with_perm('hr.request.create', r.zone_id, r.hub_id) w where w.profile_id = u)
                     or exists (select 1 from private.hub_request_senders(v_to) w where w.profile_id = u)
                   then '/app/manager/staff?tab=pending' else '/app/hr/requests?id=' || p_id end;
    perform private.notify_p(u, v_title, coalesce(v_note, v_result), v_link, 'hr_request', 'high');
  end loop;
  if v_status = 'done' and r.kind in ('id_transfer', 'id_active') and e.profile_id is not null
     and e.profile_id is distinct from r.submitted_by then
    perform private.notify_p(e.profile_id, v_title, coalesce(v_note, v_result), '/app/hr/requests?id=' || p_id, 'hr_request', 'normal');
  end if;

  return jsonb_build_object('status', v_status, 'result', v_result, 'record_id', v_file, 'employee_id', e.id);
end $$;

-- ---------------------------------------------------------------------
--  6. Zonal manager: transfer in one step (request + decision + file)
-- ---------------------------------------------------------------------
create or replace function public.hr_staff_transfer(p_employee uuid, p_to_hub uuid, p_effective date, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees%rowtype;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  select * into e from public.employees where id = p_employee and archived_at is null for update;
  if e.id is null then raise exception 'স্টাফ পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.request.approve', e.zone_id, e.hub_id) then
    raise exception 'বদলি শুধু জোনাল ম্যানেজার করতে পারেন' using errcode = '42501';
  end if;
  if e.status <> 'active' then raise exception 'শুধু সক্রিয় স্টাফ বদলি করা যায়' using errcode = 'P0001'; end if;
  if p_to_hub is null or not exists (select 1 from public.hubs h where h.id = p_to_hub and h.archived_at is null) then
    raise exception 'নতুন হাব বেছে নিন' using errcode = '22023';
  end if;
  if p_to_hub = e.hub_id then raise exception 'কর্মী এখনই এই হাবে আছেন — অন্য হাব বেছে নিন' using errcode = '22023'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'কারণ লিখুন' using errcode = '22023'; end if;

  v_id := private.hr_request_insert('id_transfer', e.id, e.hub_id, jsonb_build_object(
      'employee_code', coalesce(e.employee_code::text, ''), 'full_name', e.full_name,
      'from_hub', coalesce((select h.name from public.hubs h where h.id = e.hub_id), ''),
      'position', coalesce((select p.name from public.positions p where p.id = e.position_id), ''),
      'to_hub', p_to_hub::text, 'effective_date', coalesce(p_effective, current_date)::text, 'reason', trim(p_reason)),
    'processing');
  return public.hr_request_decide(v_id, true, null, '{}'::jsonb) || jsonb_build_object('request_id', v_id);
end $$;

-- ---------------------------------------------------------------------
--  7. Zonal manager: the inbox
-- ---------------------------------------------------------------------
create or replace function public.hr_request_inbox(p_zone uuid default null, p_status text default 'open')
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(x.obj order by x.created_at desc), '[]'::jsonb) into v
  from (
    select r.created_at, jsonb_build_object(
      'id', r.id, 'request_no', r.request_no, 'kind', r.kind, 'status', r.status, 'created_at', r.created_at,
      'zone_id', r.zone_id, 'hub_id', r.hub_id, 'hub_name', h.name, 'hub_code', h.code::text,
      'employee_id', r.employee_id, 'employee_name', coalesce(e.full_name, r.data ->> 'full_name'),
      'employee_code', e.employee_code::text, 'mobile', coalesce(e.mobile, r.data ->> 'mobile'),
      'position_name', coalesce(p.name, r.data ->> 'position'), 'employee_status', e.status, 'joining_date', e.joining_date,
      'reason', nullif(concat_ws(' — ', nullif(trim(coalesce(r.data ->> 'reason_type', '')), ''), nullif(trim(coalesce(r.data ->> 'reason', '')), '')), ''),
      'last_date', r.data ->> 'last_date', 'effective_date', r.data ->> 'effective_date',
      'to_hub_id', case when r.kind = 'id_transfer' then r.data ->> 'to_hub' end,
      'to_hub_name', case when r.kind = 'id_transfer' and (r.data ->> 'to_hub') ~ '^[0-9a-fA-F-]{36}$'
                          then (select th.name from public.hubs th where th.id = (r.data ->> 'to_hub')::uuid) end,
      'submitter_name', coalesce(se.full_name || coalesce(' (' || se.employee_code::text || ')', ''), sp.full_name, ''),
      'own', r.submitted_by = auth.uid(),
      'missing', case when r.kind = 'id_create' and e.status = 'applicant' then to_jsonb(private.hr_id_gaps(e.id)) end,
      'accounts', case when r.kind = 'id_inactive' and e.id is not null and r.status in ('submitted', 'processing')
                       then private.hr_exit_accounts(e.id, least(coalesce(nullif(r.data ->> 'last_date', '')::date, current_date), current_date)) end,
      'decided_at', r.decided_at, 'decision_note', r.decision_note, 'result', r.result) as obj
    from public.hr_requests r
    left join public.employees e on e.id = r.employee_id
    left join public.positions p on p.id = e.position_id
    left join public.hubs h on h.id = r.hub_id
    left join public.employees se on se.id = r.submitter_employee_id
    left join public.profiles sp on sp.id = r.submitted_by
    where r.kind in ('id_create', 'id_inactive', 'id_transfer', 'id_active')
      and private.has_permission('hr.request.approve', r.zone_id, r.hub_id)
      and (p_zone is null or r.zone_id = p_zone)
      and (case when coalesce(p_status, 'open') = 'open' then r.status in ('submitted', 'processing')
                when p_status = 'all' then true else r.status = p_status end)
    order by r.created_at desc
    limit 1000
  ) x;
  return jsonb_build_object('rows', v, 'next_code', private.hr_next_code());
end $$;

-- ---------------------------------------------------------------------
--  8. Grants
-- ---------------------------------------------------------------------
revoke all on function private.hr_exit_accounts(uuid, date) from public, anon, authenticated;
revoke all on function private.hr_pick_format(uuid, text[]) from public, anon, authenticated;
revoke all on function private.hr_next_code() from public, anon, authenticated;
revoke all on function private.hub_request_senders(uuid) from public, anon, authenticated;
revoke all on function private.hr_request_insert(text, uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function private.hr_make_record_file(uuid, text, uuid, date, text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function private.hr_cell(text, jsonb) from public, anon;

revoke all on function public.hr_staff_leave_request(uuid, text, date, text) from public, anon;
revoke all on function public.hr_staff_join_request(uuid, uuid, jsonb) from public, anon;
revoke all on function public.hr_request_decide(uuid, boolean, text, jsonb) from public, anon;
revoke all on function public.hr_staff_transfer(uuid, uuid, date, text) from public, anon;
revoke all on function public.hr_request_inbox(uuid, text) from public, anon;
grant execute on function public.hr_staff_leave_request(uuid, text, date, text) to authenticated;
grant execute on function public.hr_staff_join_request(uuid, uuid, jsonb) to authenticated;
grant execute on function public.hr_request_decide(uuid, boolean, text, jsonb) to authenticated;
grant execute on function public.hr_staff_transfer(uuid, uuid, date, text) to authenticated;
grant execute on function public.hr_request_inbox(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
--  9. A new request opens the zonal inbox for the people who decide it
-- ---------------------------------------------------------------------
create or replace function private.hr_request_tell_approvers() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  u uuid;
  v_what text;
  v_who text;
begin
  if new.status is distinct from 'submitted' then return new; end if;
  select f.name into v_what from public.hr_request_formats f where f.id = new.format_id;
  v_who := coalesce(nullif(trim(coalesce(new.data ->> 'full_name', '')), ''),
                    (select e.full_name from public.employees e where e.id = new.employee_id), '');
  for u in select profile_id from private.profiles_with_perm('hr.request.approve', new.zone_id, new.hub_id) loop
    perform private.notify_p(u, 'নতুন আবেদন: ' || coalesce(v_what, new.kind) || ' · ' || new.request_no,
      nullif(v_who, ''),
      case when new.kind in ('id_create', 'id_inactive', 'id_transfer', 'id_active') and new.employee_id is not null
           then '/app/zonal/requests?id=' || new.id else '/app/hr/requests?id=' || new.id end,
      'hr_request', 'normal');
  end loop;
  return new;
end $$;

-- ---------------------------------------------------------------------
--  10. Role page lists: the new pages sit beside the ones they grew out of
-- ---------------------------------------------------------------------
update public.role_dashboards d
   set menu = d.menu || '["/app/manager/staff"]'::jsonb
 where d.menu is not null and d.menu ? '/app/hub/team' and not d.menu ? '/app/manager/staff'
   and exists (select 1 from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
                where rp.role_id = d.role_id and p.code = 'hr.request.create');
update public.role_dashboards d
   set menu = d.menu || '["/app/zonal/requests", "/app/zonal/hr-records"]'::jsonb
 where d.menu is not null and (d.menu ? '/app/zonal/files' or d.menu ? '/app/hr/requests') and not d.menu ? '/app/zonal/requests'
   and exists (select 1 from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
                where rp.role_id = d.role_id and p.code = 'hr.request.approve');
