# XZM-TEAM ERP — ডাটাবেস কাঠামো (Database Structure)

তারিখ: ১৭ নভেম্বর ২০২৬ · উৎস: `supabase/migrations/` এর ৭৭টা ফাইল একটা খালি PostgreSQL 16-এ ক্রমানুসারে চালিয়ে `information_schema` / `pg_catalog` থেকে স্বয়ংক্রিয়ভাবে তোলা। লাইভে বাড়তি আছে শুধু `advanced_permissions` migration (ব্রাঞ্চে) — অডিট রিপোর্ট দেখুন।

## সংক্ষেপ

| বিষয় | সংখ্যা |
|---|---|
| public টেবিল | 126 (সবগুলোতে RLS চালু) |
| RLS policy (public) | 222 |
| `public` ফাংশন | 359 (SECURITY DEFINER 323) |
| `private` ফাংশন | 170 (SECURITY DEFINER 129) |
| ট্রিগার | 339 |
| Storage bucket (সব private) | employee-docs, da-evidence, sorting-slips, vehicle-docs, issue-photos, office-docs |
| স্কিমা | `public` (টেবিল ও RPC), `private` (অনুমতি যাচাই, অডিট, নোটিফিকেশন — ব্রাউজার থেকে ডাকা যায় না), `storage`, `auth` |

**সব টেবিলে একই নিয়ম:** `id uuid` প্রাইমারি কি; `created_at/created_by/updated_at/updated_by` নিজে বসে (`private.stamp_row`); গুরুত্বপূর্ণ টেবিলে `*_no_delete` ট্রিগার (`private.prevent_delete`) — মোছা যায় না, `archived_at/archive_reason` দিয়ে archive; `*_audit` ট্রিগার (`private.audit_row`) প্রতিটা বদল `audit_logs`-এ লেখে।

## টেবিলের দল

- **HR ও হাজিরা** (31): `attendance_day_counts`, `attendance_gap_answers`, `attendance_records`, `attendance_self_marks`, `employee_applications`, `employee_assignments`, `employee_compensation`, `employee_compensation_items`, `employee_custom_field_values`, `employee_custom_fields`, `employee_documents`, `employee_field_sections`, `employee_formats`, `employee_import_batches`, `employee_import_rows`, `employee_reference_requests`, `employee_sensitive`, `employee_status_history`, `employees`, `hr_request_events`, `hr_request_formats`, `hr_requests`, `job_duties`, `leave_requests`, `leave_types`, `manpower_requests`, `pay_component_types`, `referral_prospect_columns`, `referral_prospects`, `salary_sheet_lines`, `salary_sheets`
- **ভিত্তি: প্রতিষ্ঠান, ইউজার, রোল, অডিট** (15): `audit_logs`, `departments`, `hubs`, `login_events`, `organizations`, `permissions`, `positions`, `profiles`, `regions`, `role_dashboards`, `role_permissions`, `roles`, `system_settings`, `user_roles`, `zones`
- **কুরিয়ার অপারেশন** (13): `cash_collections`, `cash_handovers`, `cash_reconciliations`, `delivery_records`, `merchant_payments`, `merchants`, `ops_assignments`, `parcel_issue_events`, `parcel_issues`, `parcels`, `pickup_consolidations`, `pickup_submissions`, `rider_routes`
- **দৈনিক হিসাব খাতা** (21): `da_approval_rules`, `da_cash_notes`, `da_cash_payments`, `da_cells`, `da_deposits`, `da_events`, `da_expense_claims`, `da_expense_templates`, `da_expenses`, `da_hub_accountants`, `da_import_lists`, `da_import_reports`, `da_import_rider_map`, `da_merchant_payments`, `da_page_visits`, `da_payees`, `da_reference_people`, `da_report_ids`, `da_rider_lines`, `da_sessions`, `da_sheet_collectors`
- **জোনাল ম্যানেজমেন্ট** (9): `hub_daily_metrics`, `hub_import_rows`, `hub_routes`, `hub_visits`, `operational_expenses`, `task_reminders`, `tasks`, `travel_claims`, `workforce_recommendations`
- **ইস্যু ও হাব গ্রুপ** (5): `hub_post_reactions`, `hub_post_seen`, `hub_posts`, `issue_events`, `issues`
- **নদী AI** (1): `nodi_usage`
- **নোটিফিকেশন** (4): `notifications`, `pulse_answers`, `pulse_questions`, `push_devices`
- **অফিস** (9): `office_asset_loans`, `office_assets`, `office_bills`, `office_desks`, `office_notices`, `office_properties`, `office_residents`, `office_rooms`, `office_secrets`
- **শটিং সেন্টার** (7): `sorting_centers`, `sorting_driver_reports`, `sorting_fuel_requests`, `sorting_handovers`, `sorting_route_hubs`, `sorting_routes`, `sorting_staff`
- **গাড়ি / ফ্লিট** (11): `vehicle_assignments`, `vehicle_day_logs`, `vehicle_documents`, `vehicle_events`, `vehicle_hub_reports`, `vehicle_hubs`, `vehicle_logs`, `vehicle_requests`, `vehicle_requisition_events`, `vehicle_requisitions`, `vehicles`

## HR ও হাজিরা

### `attendance_day_counts`

RLS policy: 1 (SELECT) · ট্রিগার: —

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `employee_id` | uuid | না | → `employees` |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | হ্যাঁ |  |
| `period_from` | date | না |  |
| `period_to` | date | না |  |
| `online_days` | integer | না |  |
| `register_days` | integer | না |  |
| `note` | text | হ্যাঁ |  |
| `submitted_by` | uuid | হ্যাঁ |  |
| `submitted_by_name` | text | হ্যাঁ |  |
| `submitted_at` | timestamp with time zone | না | `now()` |
| `created_at` | timestamp with time zone | না | `now()` |
| `updated_at` | timestamp with time zone | না | `now()` |

### `attendance_gap_answers`

RLS policy: 1 (SELECT) · ট্রিগার: —

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `employee_id` | uuid | না | → `employees` |
| `work_date` | date | না |  |
| `kind` | text | না |  |
| `note` | text | হ্যাঁ |  |
| `leave_request_id` | uuid | হ্যাঁ | → `leave_requests` |
| `status` | text | না | `'answered'::text` |
| `answered_by` | uuid | হ্যাঁ |  |
| `answered_at` | timestamp with time zone | না | `now()` |
| `checked_by` | uuid | হ্যাঁ |  |
| `checked_at` | timestamp with time zone | হ্যাঁ |  |
| `check_note` | text | হ্যাঁ |  |

### `attendance_records`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: attendance_guard, attendance_records_audit, attendance_records_no_delete, attendance_records_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `employee_id` | uuid | না | → `employees` |
| `work_date` | date | না |  |
| `status` | text | না |  |
| `check_in` | timestamp with time zone | হ্যাঁ |  |
| `check_out` | timestamp with time zone | হ্যাঁ |  |
| `source` | text | না | `'manual'::text` |
| `note` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `attendance_self_marks`

RLS policy: 1 (SELECT) · ট্রিগার: att_self_audit, att_self_no_delete

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `employee_id` | uuid | না | → `employees` |
| `hub_id` | uuid | হ্যাঁ | → `hubs` |
| `work_date` | date | না |  |
| `kind` | text | না |  |
| `note` | text | হ্যাঁ |  |
| `marked_at` | timestamp with time zone | না | `now()` |
| `status` | text | না | `'waiting'::text` |
| `decided_as` | text | হ্যাঁ |  |
| `decided_by` | uuid | হ্যাঁ |  |
| `decided_at` | timestamp with time zone | হ্যাঁ |  |
| `decide_note` | text | হ্যাঁ |  |
| `attendance_id` | uuid | হ্যাঁ | → `attendance_records` |

### `employee_applications`

RLS policy: 1 (SELECT) · ট্রিগার: employee_applications_audit, employee_applications_no_delete, employee_applications_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `employee_id` | uuid | না | → `employees` |
| `status` | text | না | `'draft'::text` |
| `submitted_by` | uuid | হ্যাঁ |  |
| `submitted_at` | timestamp with time zone | হ্যাঁ |  |
| `reviewed_by` | uuid | হ্যাঁ |  |
| `reviewed_at` | timestamp with time zone | হ্যাঁ |  |
| `review_note` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `employee_assignments`

RLS policy: 1 (SELECT) · ট্রিগার: employee_assignments_append_only, employee_assignments_audit

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `employee_id` | uuid | না | → `employees` |
| `change_type` | text | না |  |
| `department_id` | uuid | হ্যাঁ | → `departments` |
| `position_id` | uuid | হ্যাঁ | → `positions` |
| `zone_id` | uuid | হ্যাঁ | → `zones` |
| `hub_id` | uuid | হ্যাঁ | → `hubs` |
| `reporting_manager_id` | uuid | হ্যাঁ | → `employees` |
| `effective_from` | date | না |  |
| `effective_to` | date | হ্যাঁ |  |
| `reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ | `auth.uid()` |

### `employee_compensation`

RLS policy: 1 (SELECT) · ট্রিগার: compensation_guard, employee_compensation_audit, employee_compensation_no_delete, employee_compensation_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `employee_id` | uuid | না | → `employees` |
| `effective_from` | date | না |  |
| `effective_to` | date | হ্যাঁ |  |
| `basic_salary` | numeric | না |  |
| `transport_allowance` | numeric | না | `0` |
| `commission` | numeric | না | `0` |
| `status` | text | না | `'pending'::text` |
| `reason` | text | না |  |
| `approved_by` | uuid | হ্যাঁ |  |
| `approved_at` | timestamp with time zone | হ্যাঁ |  |
| `rejection_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `employee_compensation_items`

RLS policy: 1 (SELECT) · ট্রিগার: compensation_item_guard, compensation_items_audit

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `compensation_id` | uuid | না | → `employee_compensation` |
| `type_id` | uuid | না | → `pay_component_types` |
| `amount` | numeric | না |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ | `auth.uid()` |

### `employee_custom_field_values`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: custom_value_guard, custom_value_zone_guard, employee_custom_field_values_audit, employee_custom_field_values_no_delete, employee_custom_field_values_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `employee_id` | uuid | না | → `employees` |
| `field_id` | uuid | না | → `employee_custom_fields` |
| `value` | jsonb | না |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `employee_custom_fields`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: custom_field_guard, employee_custom_fields_audit, employee_custom_fields_no_delete, employee_custom_fields_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `section_id` | uuid | না | → `employee_field_sections` |
| `code` | USER-DEFINED(citext) | না |  |
| `label` | text | না |  |
| `label_bn` | text | হ্যাঁ |  |
| `field_type` | text | না |  |
| `is_required` | boolean | না | `false` |
| `is_visible` | boolean | না | `true` |
| `view_permission` | text | হ্যাঁ | → `permissions` |
| `edit_permission` | text | হ্যাঁ | → `permissions` |
| `validation` | jsonb | না | `'{}'::jsonb` |
| `options` | jsonb | না | `'[]'::jsonb` |
| `sort_order` | integer | না | `100` |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |
| `zone_id` | uuid | হ্যাঁ | → `zones` |

### `employee_documents`

_Employee files. A signature image is stored for identification only and is never treated as proof of consent or payment._

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: employee_documents_audit, employee_documents_no_delete, employee_documents_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `employee_id` | uuid | না | → `employees` |
| `doc_type` | text | না |  |
| `title` | text | হ্যাঁ |  |
| `storage_path` | text | না |  |
| `file_name` | text | না |  |
| `mime_type` | text | না |  |
| `size_bytes` | bigint | না |  |
| `sha256` | text | হ্যাঁ |  |
| `version` | integer | না | `1` |
| `expiry_date` | date | হ্যাঁ |  |
| `verified_by` | uuid | হ্যাঁ |  |
| `verified_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `employee_field_sections`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: employee_field_sections_audit, employee_field_sections_no_delete, employee_field_sections_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `code` | USER-DEFINED(citext) | না |  |
| `name` | text | না |  |
| `name_bn` | text | হ্যাঁ |  |
| `sort_order` | integer | না | `100` |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `employee_formats`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: employee_formats_audit, employee_formats_guard, employee_formats_no_delete, employee_formats_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `zone_id` | uuid | হ্যাঁ | → `zones` |
| `name` | text | না |  |
| `name_bn` | text | হ্যাঁ |  |
| `purpose` | text | না | `'both'::text` |
| `columns` | jsonb | না | `'[]'::jsonb` |
| `is_default` | boolean | না | `false` |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `employee_import_batches`

RLS policy: 2 (INSERT,SELECT) · ট্রিগার: employee_import_batches_audit, employee_import_batches_no_delete, employee_import_batches_stamp, import_batch_guard

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `file_name` | text | না |  |
| `status` | text | না | `'uploaded'::text` |
| `column_mapping` | jsonb | না | `'{}'::jsonb` |
| `total_rows` | integer | না | `0` |
| `valid_rows` | integer | না | `0` |
| `error_rows` | integer | না | `0` |
| `validated_at` | timestamp with time zone | হ্যাঁ |  |
| `verified_by` | uuid | হ্যাঁ |  |
| `verified_at` | timestamp with time zone | হ্যাঁ |  |
| `committed_by` | uuid | হ্যাঁ |  |
| `committed_at` | timestamp with time zone | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `employee_import_rows`

RLS policy: 2 (INSERT,SELECT) · ট্রিগার: employee_import_rows_no_delete, import_row_guard

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `batch_id` | uuid | না | → `employee_import_batches` |
| `row_number` | integer | না |  |
| `raw` | jsonb | না |  |
| `data` | jsonb | হ্যাঁ |  |
| `errors` | ARRAY | না | `'{}'::text[]` |
| `status` | text | না | `'pending'::text` |
| `employee_id` | uuid | হ্যাঁ | → `employees` |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ | `auth.uid()` |

### `employee_reference_requests`

RLS policy: 0 (—) · ট্রিগার: —

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `employee_id` | uuid | না | → `employees` |
| `referrer_id` | uuid | হ্যাঁ | → `employees` |
| `manual` | jsonb | হ্যাঁ |  |
| `note` | text | হ্যাঁ |  |
| `status` | text | না | `'pending'::text` |
| `requested_by` | uuid | না | `auth.uid()` |
| `requested_by_name` | text | হ্যাঁ |  |
| `requested_at` | timestamp with time zone | না | `now()` |
| `decided_by` | uuid | হ্যাঁ |  |
| `decided_by_name` | text | হ্যাঁ |  |
| `decided_at` | timestamp with time zone | হ্যাঁ |  |
| `decision_note` | text | হ্যাঁ |  |
| `action` | text | না | `'set'::text` |

### `employee_sensitive`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: employee_sensitive_audit, employee_sensitive_guard, employee_sensitive_no_delete, employee_sensitive_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `employee_id` | uuid | না | → `employees` |
| `nid_number` | text | হ্যাঁ |  |
| `date_of_birth` | date | হ্যাঁ |  |
| `father_name` | text | হ্যাঁ |  |
| `mother_name` | text | হ্যাঁ |  |
| `present_address` | text | হ্যাঁ |  |
| `permanent_address` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `employee_status_history`

RLS policy: 1 (SELECT) · ট্রিগার: employee_status_history_append_only, employee_status_history_audit

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `employee_id` | uuid | না | → `employees` |
| `from_status` | text | হ্যাঁ |  |
| `to_status` | text | না |  |
| `effective_date` | date | না |  |
| `reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ | `auth.uid()` |

### `employees`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: employees_audit, employees_guard, employees_no_delete, employees_stamp, employees_work_focus

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `employee_code` | USER-DEFINED(citext) | হ্যাঁ |  |
| `profile_id` | uuid | হ্যাঁ | → `profiles` |
| `full_name` | text | না |  |
| `full_name_bn` | text | হ্যাঁ |  |
| `mobile` | text | হ্যাঁ |  |
| `email` | USER-DEFINED(citext) | হ্যাঁ |  |
| `emergency_contact_name` | text | হ্যাঁ |  |
| `emergency_contact_phone` | text | হ্যাঁ |  |
| `emergency_contact_relation` | text | হ্যাঁ |  |
| `reference_info` | text | হ্যাঁ |  |
| `department_id` | uuid | হ্যাঁ | → `departments` |
| `position_id` | uuid | হ্যাঁ | → `positions` |
| `zone_id` | uuid | হ্যাঁ | → `zones` |
| `hub_id` | uuid | হ্যাঁ | → `hubs` |
| `reporting_manager_id` | uuid | হ্যাঁ | → `employees` |
| `joining_date` | date | হ্যাঁ |  |
| `status` | text | না | `'applicant'::text` |
| `status_since` | date | না | `CURRENT_DATE` |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |
| `referred_by_employee_id` | uuid | হ্যাঁ | → `employees` |
| `reference_manual` | jsonb | হ্যাঁ |  |
| `work_focus` | text | হ্যাঁ |  |

### `hr_request_events`

RLS policy: 1 (SELECT) · ট্রিগার: hr_request_events_no_delete

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `request_id` | uuid | না | → `hr_requests` |
| `status` | text | না |  |
| `note` | text | হ্যাঁ |  |
| `by_user` | uuid | হ্যাঁ | `auth.uid()` |
| `by_name` | text | হ্যাঁ |  |
| `at` | timestamp with time zone | না | `now()` |

### `hr_request_formats`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: hr_request_formats_audit, hr_request_formats_no_delete, hr_request_formats_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `code` | USER-DEFINED(citext) | না |  |
| `kind` | text | না | `'custom'::text` |
| `name` | text | না |  |
| `name_bn` | text | হ্যাঁ |  |
| `description` | text | হ্যাঁ |  |
| `fields` | jsonb | না | `'[]'::jsonb` |
| `needs_employee` | boolean | না | `true` |
| `self_service` | boolean | না | `false` |
| `sort_order` | integer | না | `100` |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `hr_requests`

RLS policy: 1 (SELECT) · ট্রিগার: hr_requests_audit, hr_requests_no_delete, hr_requests_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `request_no` | text | না | `('HR-'::text || lpad((nextval('hr_request_no_seq':` |
| `format_id` | uuid | না | → `hr_request_formats` |
| `kind` | text | না |  |
| `employee_id` | uuid | হ্যাঁ | → `employees` |
| `zone_id` | uuid | না | → `zones` |
| `hub_id` | uuid | হ্যাঁ | → `hubs` |
| `data` | jsonb | না | `'{}'::jsonb` |
| `note` | text | হ্যাঁ |  |
| `status` | text | না | `'submitted'::text` |
| `submitted_by` | uuid | না | `auth.uid()` |
| `submitter_employee_id` | uuid | হ্যাঁ | → `employees` |
| `decided_by` | uuid | হ্যাঁ |  |
| `decided_at` | timestamp with time zone | হ্যাঁ |  |
| `decision_note` | text | হ্যাঁ |  |
| `result` | text | হ্যাঁ |  |
| `ref_employee_id` | uuid | হ্যাঁ | → `employees` |
| `ref_name` | text | হ্যাঁ |  |
| `ref_code` | text | হ্যাঁ |  |
| `ref_hub` | text | হ্যাঁ |  |
| `ref_position` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `job_duties`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: job_duties_audit, job_duties_no_delete, job_duties_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `position_id` | uuid | হ্যাঁ | → `positions` |
| `employee_id` | uuid | হ্যাঁ | → `employees` |
| `zone_id` | uuid | হ্যাঁ | → `zones` |
| `title` | text | না |  |
| `details` | text | হ্যাঁ |  |
| `frequency` | text | না | `'daily'::text` |
| `sort` | integer | না | `100` |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |
| `focus` | text | হ্যাঁ |  |

### `leave_requests`

RLS policy: 2 (INSERT,SELECT) · ট্রিগার: leave_request_guard, leave_requests_audit, leave_requests_no_delete, leave_requests_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `employee_id` | uuid | না | → `employees` |
| `leave_type_id` | uuid | না | → `leave_types` |
| `from_date` | date | না |  |
| `to_date` | date | না |  |
| `days` | integer | হ্যাঁ |  |
| `reason` | text | না |  |
| `status` | text | না | `'pending'::text` |
| `decided_by` | uuid | হ্যাঁ |  |
| `decided_at` | timestamp with time zone | হ্যাঁ |  |
| `decision_note` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `leave_types`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: leave_types_audit, leave_types_no_delete, leave_types_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `code` | USER-DEFINED(citext) | না |  |
| `name` | text | না |  |
| `name_bn` | text | হ্যাঁ |  |
| `is_paid` | boolean | না | `true` |
| `annual_quota` | numeric | হ্যাঁ |  |
| `status` | text | না | `'active'::text` |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `manpower_requests`

RLS policy: 1 (SELECT) · ট্রিগার: manpower_requests_audit, manpower_requests_no_delete, manpower_requests_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `request_no` | text | না | `('MP-'::text || lpad((nextval('manpower_request_no` |
| `zone_id` | uuid | না | → `zones` |
| `hub_id` | uuid | না | → `hubs` |
| `position_id` | uuid | হ্যাঁ | → `positions` |
| `needed` | integer | না |  |
| `reason` | text | না |  |
| `daily_pickup` | integer | হ্যাঁ |  |
| `daily_delivery` | integer | হ্যাঁ |  |
| `big_parcels` | integer | হ্যাঁ |  |
| `other_issues` | text | হ্যাঁ |  |
| `status` | text | না | `'submitted'::text` |
| `scope` | text | না | `'hub'::text` |
| `notify_positions` | ARRAY | না | `'{}'::uuid[]` |
| `filled` | integer | না | `0` |
| `submitted_by` | uuid | না | `auth.uid()` |
| `submitter_employee_id` | uuid | হ্যাঁ | → `employees` |
| `decided_by` | uuid | হ্যাঁ |  |
| `decided_at` | timestamp with time zone | হ্যাঁ |  |
| `decision_note` | text | হ্যাঁ |  |
| `notified_count` | integer | না | `0` |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `pay_component_types`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: pay_component_types_audit, pay_component_types_no_delete, pay_component_types_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `code` | USER-DEFINED(citext) | না |  |
| `kind` | text | না |  |
| `name` | text | না |  |
| `name_bn` | text | হ্যাঁ |  |
| `status` | text | না | `'active'::text` |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `referral_prospect_columns`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: referral_prospect_columns_audit, referral_prospect_columns_no_delete, referral_prospect_columns_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `zone_id` | uuid | হ্যাঁ | → `zones` |
| `code` | text | না |  |
| `label` | text | না |  |
| `label_bn` | text | হ্যাঁ |  |
| `field_type` | text | না | `'text'::text` |
| `options` | jsonb | না | `'[]'::jsonb` |
| `sort_order` | integer | না | `100` |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `referral_prospects`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: referral_prospects_audit, referral_prospects_guard, referral_prospects_no_delete, referral_prospects_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `referrer_id` | uuid | না | → `employees` |
| `full_name` | text | না |  |
| `mobile` | text | হ্যাঁ |  |
| `position_id` | uuid | হ্যাঁ | → `positions` |
| `area` | text | হ্যাঁ |  |
| `note` | text | হ্যাঁ |  |
| `status` | text | না | `'available'::text` |
| `extra` | jsonb | না | `'{}'::jsonb` |
| `joined_employee_id` | uuid | হ্যাঁ | → `employees` |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `salary_sheet_lines`

RLS policy: 2 (SELECT,UPDATE) · ট্রিগার: salary_line_guard, salary_sheet_lines_audit, salary_sheet_lines_no_delete, salary_sheet_lines_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `sheet_id` | uuid | না | → `salary_sheets` |
| `employee_id` | uuid | না | → `employees` |
| `compensation_id` | uuid | হ্যাঁ | → `employee_compensation` |
| `present_days` | integer | না | `0` |
| `leave_days` | integer | না | `0` |
| `absent_days` | integer | না | `0` |
| `basic_salary` | numeric | না | `0` |
| `transport_allowance` | numeric | না | `0` |
| `commission` | numeric | না | `0` |
| `other_allowances` | numeric | না | `0` |
| `deductions` | numeric | না | `0` |
| `net_payable` | numeric | হ্যাঁ |  |
| `adjustment_note` | text | হ্যাঁ |  |
| `issue` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `salary_sheets`

RLS policy: 1 (SELECT) · ট্রিগার: salary_sheet_guard, salary_sheets_audit, salary_sheets_no_delete, salary_sheets_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `period_month` | date | না |  |
| `zone_id` | uuid | হ্যাঁ | → `zones` |
| `hub_id` | uuid | হ্যাঁ | → `hubs` |
| `status` | text | না | `'draft'::text` |
| `submitted_by` | uuid | হ্যাঁ |  |
| `submitted_at` | timestamp with time zone | হ্যাঁ |  |
| `approved_by` | uuid | হ্যাঁ |  |
| `approved_at` | timestamp with time zone | হ্যাঁ |  |
| `cancel_reason` | text | হ্যাঁ |  |
| `note` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

## ভিত্তি: প্রতিষ্ঠান, ইউজার, রোল, অডিট

### `audit_logs`

RLS policy: 1 (SELECT) · ট্রিগার: audit_logs_no_truncate, audit_logs_no_update

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | bigint | না |  |
| `occurred_at` | timestamp with time zone | না | `now()` |
| `actor_id` | uuid | হ্যাঁ |  |
| `action` | text | না |  |
| `module` | text | না |  |
| `table_name` | text | হ্যাঁ |  |
| `record_id` | text | হ্যাঁ |  |
| `old_data` | jsonb | হ্যাঁ |  |
| `new_data` | jsonb | হ্যাঁ |  |
| `changed_fields` | ARRAY | হ্যাঁ |  |
| `reason` | text | হ্যাঁ |  |
| `ip_address` | text | হ্যাঁ |  |
| `user_agent` | text | হ্যাঁ |  |

### `departments`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: departments_audit, departments_no_delete, departments_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `organization_id` | uuid | না | → `organizations` |
| `code` | USER-DEFINED(citext) | না |  |
| `name` | text | না |  |
| `name_bn` | text | হ্যাঁ |  |
| `status` | text | না | `'active'::text` |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `hubs`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: hubs_audit, hubs_no_delete, hubs_stamp, hubs_zone_move_guard

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `zone_id` | uuid | না | → `zones` |
| `code` | USER-DEFINED(citext) | না |  |
| `name` | text | না |  |
| `name_bn` | text | হ্যাঁ |  |
| `address` | text | হ্যাঁ |  |
| `phone` | text | হ্যাঁ |  |
| `email` | USER-DEFINED(citext) | হ্যাঁ |  |
| `status` | text | না | `'active'::text` |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |
| `latitude` | numeric | হ্যাঁ |  |
| `longitude` | numeric | হ্যাঁ |  |
| `hub_type` | text | হ্যাঁ |  |
| `ops_zone` | text | হ্যাঁ |  |
| `sorting_center_id` | uuid | হ্যাঁ | → `sorting_centers` |

### `login_events`

RLS policy: 2 (SELECT) · ট্রিগার: login_events_no_update

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | bigint | না |  |
| `occurred_at` | timestamp with time zone | না | `now()` |
| `user_id` | uuid | হ্যাঁ | → `profiles` |
| `email` | USER-DEFINED(citext) | হ্যাঁ |  |
| `portal` | text | না |  |
| `success` | boolean | না |  |
| `failure_reason` | text | হ্যাঁ |  |
| `ip_address` | text | হ্যাঁ |  |
| `user_agent` | text | হ্যাঁ |  |

### `organizations`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: organizations_audit, organizations_no_delete, organizations_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `code` | USER-DEFINED(citext) | না |  |
| `name` | text | না |  |
| `name_bn` | text | হ্যাঁ |  |
| `head_office_address` | text | হ্যাঁ |  |
| `phone` | text | হ্যাঁ |  |
| `email` | USER-DEFINED(citext) | হ্যাঁ |  |
| `status` | text | না | `'active'::text` |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `permissions`

RLS policy: 1 (SELECT) · ট্রিগার: —

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `code` | text | না |  |
| `module` | text | না |  |
| `resource` | text | না |  |
| `action` | text | না |  |
| `description` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |

### `positions`

RLS policy: 4 (INSERT,SELECT,UPDATE) · ট্রিগার: positions_audit, positions_no_delete, positions_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `department_id` | uuid | হ্যাঁ | → `departments` |
| `code` | USER-DEFINED(citext) | না |  |
| `name` | text | না |  |
| `name_bn` | text | হ্যাঁ |  |
| `status` | text | না | `'active'::text` |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |
| `level` | text | না | `'hub'::text` |
| `aliases` | ARRAY | না | `'{}'::text[]` |
| `sort_order` | integer | না | `100` |
| `focus_options` | jsonb | না | `'[]'::jsonb` |
| `default_role_id` | uuid | হ্যাঁ | → `roles` |

### `profiles`

RLS policy: 4 (SELECT,UPDATE) · ট্রিগার: profiles_audit, profiles_guard, profiles_last_super_guard, profiles_no_delete, profiles_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | → `auth.users` |
| `full_name` | text | না | `''::text` |
| `email` | USER-DEFINED(citext) | হ্যাঁ |  |
| `phone` | text | হ্যাঁ |  |
| `preferred_language` | text | না | `'en'::text` |
| `status` | text | না | `'active'::text` |
| `failed_login_count` | integer | না | `0` |
| `locked_until` | timestamp with time zone | হ্যাঁ |  |
| `last_login_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |
| `must_change_password` | boolean | না | `false` |

### `regions`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: regions_audit, regions_no_delete, regions_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `organization_id` | uuid | না | → `organizations` |
| `code` | USER-DEFINED(citext) | না |  |
| `name` | text | না |  |
| `name_bn` | text | হ্যাঁ |  |
| `status` | text | না | `'active'::text` |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `role_dashboards`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: role_dashboards_audit, role_dashboards_guard, role_dashboards_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `role_id` | uuid | না | → `roles` |
| `panels` | jsonb | না | `'[]'::jsonb` |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |
| `default_view` | text | হ্যাঁ |  |
| `menu` | jsonb | হ্যাঁ |  |

### `role_permissions`

RLS policy: 3 (DELETE,INSERT,SELECT) · ট্রিগার: role_permissions_audit, role_permissions_guard

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `role_id` | uuid | না | → `roles` |
| `permission_id` | uuid | না | → `permissions` |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ | `auth.uid()` |

### `roles`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: roles_audit, roles_guard, roles_no_delete, roles_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `code` | USER-DEFINED(citext) | না |  |
| `name` | text | না |  |
| `name_bn` | text | হ্যাঁ |  |
| `description` | text | হ্যাঁ |  |
| `is_system` | boolean | না | `false` |
| `is_super` | boolean | না | `false` |
| `status` | text | না | `'active'::text` |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `system_settings`

RLS policy: 4 (INSERT,SELECT,UPDATE) · ট্রিগার: system_settings_audit, system_settings_branding_guard, system_settings_no_delete, system_settings_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `key` | text | না |  |
| `value` | jsonb | না |  |
| `description` | text | হ্যাঁ |  |
| `is_public` | boolean | না | `false` |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `user_roles`

RLS policy: 4 (INSERT,SELECT,UPDATE) · ট্রিগার: user_roles_audit, user_roles_guard, user_roles_no_delete, user_roles_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `user_id` | uuid | না | → `profiles` |
| `role_id` | uuid | না | → `roles` |
| `scope_type` | text | না |  |
| `zone_id` | uuid | হ্যাঁ | → `zones` |
| `hub_id` | uuid | হ্যাঁ | → `hubs` |
| `valid_from` | date | না | `CURRENT_DATE` |
| `valid_to` | date | হ্যাঁ |  |
| `revoked_at` | timestamp with time zone | হ্যাঁ |  |
| `revoked_by` | uuid | হ্যাঁ |  |
| `revoke_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `zones`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: zones_audit, zones_no_delete, zones_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `organization_id` | uuid | না | → `organizations` |
| `code` | USER-DEFINED(citext) | না |  |
| `name` | text | না |  |
| `name_bn` | text | হ্যাঁ |  |
| `address` | text | হ্যাঁ |  |
| `phone` | text | হ্যাঁ |  |
| `status` | text | না | `'active'::text` |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |
| `region_id` | uuid | হ্যাঁ | → `regions` |

## কুরিয়ার অপারেশন

### `cash_collections`

RLS policy: 1 (SELECT) · ট্রিগার: cash_collections_audit, cash_collections_no_delete, cash_collections_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `collection_date` | date | না |  |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `source` | text | না |  |
| `holder` | text | না |  |
| `rider_id` | uuid | হ্যাঁ | → `employees` |
| `merchant_id` | uuid | হ্যাঁ | → `merchants` |
| `amount` | numeric | না |  |
| `delivery_record_id` | uuid | হ্যাঁ | → `delivery_records` |
| `pickup_consolidation_id` | uuid | হ্যাঁ | → `pickup_consolidations` |
| `note` | text | হ্যাঁ |  |
| `recorded_by` | uuid | হ্যাঁ |  |
| `voided_at` | timestamp with time zone | হ্যাঁ |  |
| `voided_by` | uuid | হ্যাঁ |  |
| `void_reason` | text | হ্যাঁ |  |
| `ledger_entry_id` | uuid | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `cash_handovers`

RLS policy: 1 (SELECT) · ট্রিগার: cash_handovers_audit, cash_handovers_no_delete, cash_handovers_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `handover_no` | text | না | `('HO-'::text || lpad((nextval('cash_handover_no_se` |
| `level` | text | না |  |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `rider_id` | uuid | হ্যাঁ | → `employees` |
| `handover_date` | date | না | `CURRENT_DATE` |
| `expected_amount` | numeric | না |  |
| `declared_amount` | numeric | না |  |
| `received_amount` | numeric | হ্যাঁ |  |
| `shortage_amount` | numeric | হ্যাঁ |  |
| `status` | text | না | `'submitted'::text` |
| `handed_by` | uuid | না |  |
| `handed_at` | timestamp with time zone | না | `now()` |
| `note` | text | হ্যাঁ |  |
| `received_by` | uuid | হ্যাঁ |  |
| `received_at` | timestamp with time zone | হ্যাঁ |  |
| `receiver_note` | text | হ্যাঁ |  |
| `cancel_reason` | text | হ্যাঁ |  |
| `ledger_entry_id` | uuid | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `cash_reconciliations`

RLS policy: 1 (SELECT) · ট্রিগার: cash_reconciliations_audit, cash_reconciliations_no_delete, cash_reconciliations_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `recon_date` | date | না |  |
| `opening_balance` | numeric | না |  |
| `rider_handovers_in` | numeric | না |  |
| `hub_collections_in` | numeric | না |  |
| `sent_to_accounts` | numeric | না |  |
| `merchant_cash_paid` | numeric | না |  |
| `expenses_paid` | numeric | না |  |
| `expected_closing` | numeric | না |  |
| `counted_cash` | numeric | না |  |
| `difference` | numeric | হ্যাঁ |  |
| `note` | text | হ্যাঁ |  |
| `status` | text | না | `'submitted'::text` |
| `prepared_by` | uuid | না |  |
| `decided_by` | uuid | হ্যাঁ |  |
| `decided_at` | timestamp with time zone | হ্যাঁ |  |
| `decision_note` | text | হ্যাঁ |  |
| `ledger_entry_id` | uuid | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `delivery_records`

RLS policy: 1 (SELECT) · ট্রিগার: delivery_records_audit, delivery_records_no_delete, delivery_records_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `parcel_id` | uuid | না | → `parcels` |
| `merchant_id` | uuid | না | → `merchants` |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `rider_id` | uuid | না | → `employees` |
| `delivery_date` | date | না |  |
| `outcome` | text | না |  |
| `cod_expected` | numeric | না | `0` |
| `cod_collected` | numeric | না | `0` |
| `failure_reason` | text | হ্যাঁ |  |
| `recipient_name` | text | হ্যাঁ |  |
| `recorded_by` | uuid | না |  |
| `recorded_at` | timestamp with time zone | না | `now()` |
| `status` | text | না | `'pending'::text` |
| `decided_by` | uuid | হ্যাঁ |  |
| `decided_at` | timestamp with time zone | হ্যাঁ |  |
| `decision_note` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `merchant_payments`

RLS policy: 1 (SELECT) · ট্রিগার: merchant_payments_audit, merchant_payments_no_delete, merchant_payments_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `payment_no` | text | না | `('MP-'::text || lpad((nextval('merchant_payment_no` |
| `merchant_id` | uuid | না | → `merchants` |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `payment_date` | date | না |  |
| `amount` | numeric | না |  |
| `method` | text | না |  |
| `reference` | text | হ্যাঁ |  |
| `note` | text | হ্যাঁ |  |
| `status` | text | না | `'pending'::text` |
| `requested_by` | uuid | না |  |
| `decided_by` | uuid | হ্যাঁ |  |
| `decided_at` | timestamp with time zone | হ্যাঁ |  |
| `decision_note` | text | হ্যাঁ |  |
| `ledger_entry_id` | uuid | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `merchants`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: merchants_audit, merchants_guard, merchants_no_delete, merchants_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `code` | USER-DEFINED(citext) | না |  |
| `name` | text | না |  |
| `phone` | text | হ্যাঁ |  |
| `address` | text | হ্যাঁ |  |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `status` | text | না | `'active'::text` |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `ops_assignments`

RLS policy: 1 (SELECT) · ট্রিগার: ops_assignments_audit, ops_assignments_no_delete, ops_assignments_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `kind` | text | না |  |
| `employee_id` | uuid | না | → `employees` |
| `zone_id` | uuid | না | → `zones` |
| `hub_id` | uuid | হ্যাঁ | → `hubs` |
| `duty` | text | হ্যাঁ |  |
| `effective_from` | date | না |  |
| `effective_to` | date | হ্যাঁ |  |
| `reason` | text | না |  |
| `end_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `parcel_issue_events`

RLS policy: 1 (SELECT) · ট্রিগার: parcel_issue_events_append_only, parcel_issue_events_audit

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `issue_id` | uuid | না | → `parcel_issues` |
| `event` | text | না |  |
| `note` | text | হ্যাঁ |  |
| `actor_id` | uuid | হ্যাঁ | `auth.uid()` |
| `created_at` | timestamp with time zone | না | `now()` |

### `parcel_issues`

RLS policy: 1 (SELECT) · ট্রিগার: parcel_issues_audit, parcel_issues_no_delete, parcel_issues_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `issue_no` | text | না | `('PI-'::text || lpad((nextval('parcel_issue_no_seq` |
| `parcel_id` | uuid | না | → `parcels` |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `issue_type` | text | না |  |
| `priority` | text | না | `'normal'::text` |
| `description` | text | না |  |
| `status` | text | না | `'open'::text` |
| `reported_by` | uuid | না |  |
| `assigned_to` | uuid | হ্যাঁ | → `profiles` |
| `assigned_at` | timestamp with time zone | হ্যাঁ |  |
| `resolution` | text | হ্যাঁ |  |
| `resolved_by` | uuid | হ্যাঁ |  |
| `resolved_at` | timestamp with time zone | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `parcels`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: parcels_audit, parcels_guard, parcels_no_delete, parcels_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `tracking_no` | USER-DEFINED(citext) | না |  |
| `merchant_id` | uuid | না | → `merchants` |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `received_date` | date | না | `CURRENT_DATE` |
| `customer_name` | text | না |  |
| `customer_phone` | text | হ্যাঁ |  |
| `customer_address` | text | হ্যাঁ |  |
| `cod_amount` | numeric | না | `0` |
| `status` | text | না | `'at_hub'::text` |
| `assigned_rider_id` | uuid | হ্যাঁ | → `employees` |
| `attempt_count` | integer | না | `0` |
| `closed_at` | timestamp with time zone | হ্যাঁ |  |
| `cancel_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `pickup_consolidations`

RLS policy: 1 (SELECT) · ট্রিগার: pickup_consolidations_audit, pickup_consolidations_no_delete, pickup_consolidations_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `pickup_date` | date | না |  |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `merchant_id` | uuid | না | → `merchants` |
| `trip_no` | smallint | না |  |
| `rider_id` | uuid | হ্যাঁ | → `employees` |
| `parcel_count` | integer | না |  |
| `cod_amount` | numeric | না |  |
| `collection_amount` | numeric | না |  |
| `accepted_submission_id` | uuid | না |  |
| `submission_count` | integer | না |  |
| `had_conflict` | boolean | না |  |
| `approved_by` | uuid | না |  |
| `approved_at` | timestamp with time zone | না | `now()` |
| `approval_note` | text | হ্যাঁ |  |
| `voided_at` | timestamp with time zone | হ্যাঁ |  |
| `voided_by` | uuid | হ্যাঁ |  |
| `void_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `pickup_submissions`

RLS policy: 1 (SELECT) · ট্রিগার: pickup_submissions_audit, pickup_submissions_no_delete, pickup_submissions_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `submission_no` | text | না | `('PS-'::text || lpad((nextval('pickup_submission_n` |
| `pickup_date` | date | না |  |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `merchant_id` | uuid | না | → `merchants` |
| `trip_no` | smallint | না | `1` |
| `source` | text | না |  |
| `submitted_by` | uuid | না | → `profiles` |
| `submitted_at` | timestamp with time zone | না | `now()` |
| `rider_id` | uuid | হ্যাঁ | → `employees` |
| `parcel_count` | integer | না |  |
| `cod_amount` | numeric | না | `0` |
| `collection_amount` | numeric | না | `0` |
| `note` | text | হ্যাঁ |  |
| `status` | text | না | `'pending'::text` |
| `verified_by` | uuid | হ্যাঁ |  |
| `verified_at` | timestamp with time zone | হ্যাঁ |  |
| `decided_by` | uuid | হ্যাঁ |  |
| `decided_at` | timestamp with time zone | হ্যাঁ |  |
| `decision_note` | text | হ্যাঁ |  |
| `consolidation_id` | uuid | হ্যাঁ | → `pickup_consolidations` |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `rider_routes`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: rider_routes_audit, rider_routes_no_delete, rider_routes_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `route_id` | uuid | না | → `hub_routes` |
| `employee_id` | uuid | না | → `employees` |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `effective_from` | date | না | `CURRENT_DATE` |
| `effective_to` | date | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

## দৈনিক হিসাব খাতা

### `da_approval_rules`

RLS policy: 1 (SELECT) · ট্রিগার: —

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `zone_id` | uuid | হ্যাঁ | → `zones` |
| `hub_id` | uuid | হ্যাঁ | → `hubs` |
| `user_id` | uuid | হ্যাঁ | → `profiles` |
| `position_id` | uuid | হ্যাঁ | → `positions` |
| `self_limit` | numeric | না | `0` |
| `transport_breakdown_required` | boolean | না | `true` |
| `note` | text | হ্যাঁ |  |
| `status` | text | না | `'active'::text` |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ | `auth.uid()` |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `da_cash_notes`

RLS policy: 1 (SELECT) · ট্রিগার: da_cash_notes_audit, da_cash_notes_no_delete, da_cash_notes_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `no` | bigint | না |  |
| `session_id` | uuid | না | → `da_sessions` |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `from_employee` | uuid | হ্যাঁ | → `employees` |
| `from_name` | text | হ্যাঁ |  |
| `from_code` | text | হ্যাঁ |  |
| `amount` | numeric | না | `0` |
| `method` | text | না | `'cash'::text` |
| `note` | text | হ্যাঁ |  |
| `removed_at` | timestamp with time zone | হ্যাঁ |  |
| `removed_by` | uuid | হ্যাঁ |  |
| `remove_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `da_cash_payments`

RLS policy: 1 (SELECT) · ট্রিগার: da_cash_collector, da_cash_payments_no_delete

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `no` | bigint | না | `nextval('da_cash_payment_no_seq'::regclass)` |
| `session_id` | uuid | না | → `da_sessions` |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `collector_user` | uuid | হ্যাঁ | → `profiles` |
| `payee_id` | uuid | হ্যাঁ | → `da_payees` |
| `payee_name` | text | না |  |
| `payment_ref` | text | হ্যাঁ |  |
| `amount` | numeric | না |  |
| `screenshot_path` | text | হ্যাঁ |  |
| `ocr` | jsonb | হ্যাঁ |  |
| `ocr_verified` | boolean | না | `false` |
| `source` | text | না | `'manual'::text` |
| `note` | text | হ্যাঁ |  |
| `removed_at` | timestamp with time zone | হ্যাঁ |  |
| `removed_by` | uuid | হ্যাঁ |  |
| `remove_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ | `auth.uid()` |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `da_cells`

RLS policy: 1 (SELECT) · ট্রিগার: da_cells_audit

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `session_id` | uuid | না | → `da_sessions` |
| `section` | text | না |  |
| `row_id` | uuid | না |  |
| `col_key` | text | না |  |
| `value` | text | হ্যাঁ |  |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `da_deposits`

RLS policy: 1 (SELECT) · ট্রিগার: da_deposits_audit, da_deposits_no_delete, da_deposits_slip_guard, da_deposits_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `no` | bigint | না |  |
| `session_id` | uuid | না | → `da_sessions` |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `method` | text | না | `'bank'::text` |
| `bank_name` | text | হ্যাঁ |  |
| `amount` | numeric | না |  |
| `charge` | numeric | না | `0` |
| `charge_auto` | boolean | না | `true` |
| `transport` | numeric | না | `0` |
| `people` | text | হ্যাঁ |  |
| `ref_no` | text | হ্যাঁ |  |
| `slip_path` | text | হ্যাঁ |  |
| `deposited_on` | date | না |  |
| `remarks` | text | হ্যাঁ |  |
| `removed_at` | timestamp with time zone | হ্যাঁ |  |
| `removed_by` | uuid | হ্যাঁ |  |
| `remove_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |
| `slip_uploaded_at` | timestamp with time zone | হ্যাঁ |  |
| `slip_uploaded_by` | uuid | হ্যাঁ |  |
| `slip_uploaded_by_name` | text | হ্যাঁ |  |
| `slip_ocr_amount` | numeric | হ্যাঁ |  |
| `slip_ocr_confidence` | integer | হ্যাঁ |  |
| `slip_ocr_at` | timestamp with time zone | হ্যাঁ |  |
| `slip_match` | text | হ্যাঁ |  |
| `bank_confirmed_at` | timestamp with time zone | হ্যাঁ |  |
| `bank_confirmed_by` | uuid | হ্যাঁ |  |
| `bank_confirmed_by_name` | text | হ্যাঁ |  |
| `bank_confirm_note` | text | হ্যাঁ |  |

### `da_events`

RLS policy: 1 (SELECT) · ট্রিগার: da_events_append_only, da_events_audit

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `no` | bigint | না |  |
| `session_id` | uuid | না | → `da_sessions` |
| `at` | timestamp with time zone | না | `now()` |
| `actor_id` | uuid | হ্যাঁ |  |
| `actor_name` | text | হ্যাঁ |  |
| `actor_code` | text | হ্যাঁ |  |
| `action` | text | না |  |
| `note` | text | হ্যাঁ |  |
| `snapshot` | jsonb | হ্যাঁ |  |

### `da_expense_claims`

RLS policy: 1 (SELECT) · ট্রিগার: da_claims_audit, da_claims_no_delete, da_claims_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `no` | bigint | না |  |
| `employee_id` | uuid | না | → `employees` |
| `employee_code` | text | হ্যাঁ |  |
| `employee_name` | text | হ্যাঁ |  |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `kind` | text | না | `'employee'::text` |
| `expense_name` | text | না |  |
| `category` | text | না |  |
| `amount` | numeric | না |  |
| `bill_date` | date | না |  |
| `bill_no` | text | হ্যাঁ |  |
| `reference_no` | text | হ্যাঁ |  |
| `reference_name` | text | হ্যাঁ |  |
| `reference_phone` | text | হ্যাঁ |  |
| `reference_position` | text | হ্যাঁ |  |
| `vehicle_id` | uuid | হ্যাঁ | → `vehicles` |
| `attachment_path` | text | হ্যাঁ |  |
| `remarks` | text | হ্যাঁ |  |
| `status` | text | না | `'submitted'::text` |
| `session_id` | uuid | হ্যাঁ | → `da_sessions` |
| `expense_id` | uuid | হ্যাঁ | → `da_expenses` |
| `reviewed_by` | uuid | হ্যাঁ |  |
| `reviewed_at` | timestamp with time zone | হ্যাঁ |  |
| `review_note` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |
| `to_user` | uuid | হ্যাঁ | → `profiles` |
| `transport_breakdown` | jsonb | হ্যাঁ |  |

### `da_expense_templates`

RLS policy: 1 (SELECT) · ট্রিগার: da_expense_templates_audit, da_expense_templates_no_delete, da_expense_templates_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `no` | bigint | না |  |
| `name` | text | না |  |
| `name_bn` | text | হ্যাঁ |  |
| `category` | text | না |  |
| `reference_prefix` | text | হ্যাঁ |  |
| `keywords` | ARRAY | না | `'{}'::text[]` |
| `memo_template` | text | হ্যাঁ |  |
| `default_amount` | numeric | হ্যাঁ |  |
| `status` | text | না | `'active'::text` |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `da_expenses`

RLS policy: 1 (SELECT) · ট্রিগার: da_expense_collector, da_expenses_after_insert, da_expenses_audit, da_expenses_no_delete, da_expenses_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `no` | bigint | না |  |
| `session_id` | uuid | না | → `da_sessions` |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `kind` | text | না |  |
| `employee_id` | uuid | হ্যাঁ | → `employees` |
| `employee_code` | text | হ্যাঁ |  |
| `employee_name` | text | হ্যাঁ |  |
| `expense_name` | text | না |  |
| `category` | text | না |  |
| `amount` | numeric | না |  |
| `bill_date` | date | না |  |
| `bill_no` | text | হ্যাঁ |  |
| `reference_no` | text | হ্যাঁ |  |
| `attachment_path` | text | হ্যাঁ |  |
| `paid_by_employee` | uuid | হ্যাঁ | → `employees` |
| `paid_by_name` | text | হ্যাঁ |  |
| `template_id` | uuid | হ্যাঁ | → `da_expense_templates` |
| `ocr` | jsonb | হ্যাঁ |  |
| `ocr_verified` | boolean | না | `false` |
| `verified_by` | uuid | হ্যাঁ |  |
| `remarks` | text | হ্যাঁ |  |
| `removed_at` | timestamp with time zone | হ্যাঁ |  |
| `removed_by` | uuid | হ্যাঁ |  |
| `remove_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |
| `voucher_no` | text | হ্যাঁ |  |
| `vehicle_id` | uuid | হ্যাঁ | → `vehicles` |
| `reference_name` | text | হ্যাঁ |  |
| `reference_phone` | text | হ্যাঁ |  |
| `reference_position` | text | হ্যাঁ |  |
| `claim_id` | uuid | হ্যাঁ | → `da_expense_claims` |
| `claim_file` | text | হ্যাঁ |  |
| `reference_person_id` | uuid | হ্যাঁ | → `da_reference_people` |
| `transport_breakdown` | jsonb | হ্যাঁ |  |
| `approval_status` | text | না | `'approved'::text` |
| `approved_by` | uuid | হ্যাঁ | → `profiles` |
| `approved_at` | timestamp with time zone | হ্যাঁ |  |
| `approval_note` | text | হ্যাঁ |  |

### `da_hub_accountants`

RLS policy: 1 (SELECT) · ট্রিগার: da_hub_accountants_audit, da_hub_accountants_no_delete, da_hub_accountants_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `user_id` | uuid | না | → `profiles` |
| `reason` | text | না |  |
| `revoked_at` | timestamp with time zone | হ্যাঁ |  |
| `revoked_by` | uuid | হ্যাঁ |  |
| `revoke_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `da_import_lists`

RLS policy: 1 (SELECT) · ট্রিগার: da_import_lists_audit, da_import_lists_no_delete, da_import_lists_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `report_id` | uuid | না | → `da_import_reports` |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `list_no` | bigint | না |  |
| `point` | boolean | না | `false` |
| `rider_code` | text | হ্যাঁ |  |
| `rider_name` | text | হ্যাঁ |  |
| `parcels` | integer | না |  |
| `amount` | numeric | না |  |
| `removed_at` | timestamp with time zone | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `da_import_reports`

RLS policy: 1 (SELECT) · ট্রিগার: da_import_reports_audit, da_import_reports_no_delete, da_import_reports_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `no` | bigint | না |  |
| `report_no` | bigint | না |  |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `account_date` | date | না |  |
| `manager_code` | text | না |  |
| `manager_name` | text | হ্যাঁ |  |
| `hub_text` | text | হ্যাঁ |  |
| `reported_at` | timestamp without time zone | না |  |
| `collected` | numeric | না |  |
| `delivery_charge` | numeric | না |  |
| `declared_lists` | integer | না |  |
| `declared_parcels` | integer | না |  |
| `lists_amount` | numeric | না |  |
| `raw_text` | text | না |  |
| `upload_count` | integer | না | `1` |
| `uploaded_by` | uuid | হ্যাঁ |  |
| `uploaded_by_name` | text | হ্যাঁ |  |
| `uploaded_at` | timestamp with time zone | না | `now()` |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `da_import_rider_map`

RLS policy: 1 (SELECT) · ট্রিগার: da_import_rider_map_audit, da_import_rider_map_no_delete, da_import_rider_map_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `rider_code` | text | না |  |
| `employee_id` | uuid | না | → `employees` |
| `mapped_by_name` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `da_merchant_payments`

RLS policy: 1 (SELECT) · ট্রিগার: da_merchant_payments_audit, da_merchant_payments_no_delete, da_merchant_payments_stamp, da_payment_collector

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `no` | bigint | না |  |
| `session_id` | uuid | না | → `da_sessions` |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `merchant_id` | uuid | হ্যাঁ | → `merchants` |
| `merchant_name` | text | না |  |
| `payment_ref` | text | হ্যাঁ |  |
| `transaction_id` | text | হ্যাঁ |  |
| `amount` | numeric | না |  |
| `payment_date` | date | না |  |
| `screenshot_path` | text | হ্যাঁ |  |
| `ocr` | jsonb | হ্যাঁ |  |
| `ocr_verified` | boolean | না | `false` |
| `verified_by` | uuid | হ্যাঁ |  |
| `match_status` | text | না | `'unmatched'::text` |
| `matched_payment_id` | uuid | হ্যাঁ | → `merchant_payments` |
| `remarks` | text | হ্যাঁ |  |
| `removed_at` | timestamp with time zone | হ্যাঁ |  |
| `removed_by` | uuid | হ্যাঁ |  |
| `remove_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |
| `payee_name` | text | হ্যাঁ |  |

### `da_page_visits`

RLS policy: 1 (SELECT) · ট্রিগার: da_page_visits_no_delete

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `session_id` | uuid | না | → `da_sessions` |
| `user_id` | uuid | না |  |
| `user_name` | text | হ্যাঁ |  |
| `entered_at` | timestamp with time zone | না | `now()` |
| `last_seen_at` | timestamp with time zone | না | `now()` |
| `left_at` | timestamp with time zone | হ্যাঁ |  |
| `duration_seconds` | integer | হ্যাঁ |  |

### `da_payees`

RLS policy: 1 (SELECT) · ট্রিগার: —

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `zone_id` | uuid | হ্যাঁ | → `zones` |
| `hub_id` | uuid | হ্যাঁ | → `hubs` |
| `name` | text | না |  |
| `name_bn` | text | হ্যাঁ |  |
| `kind` | text | না | `'merchant'::text` |
| `phone` | text | হ্যাঁ |  |
| `merchant_code` | text | হ্যাঁ |  |
| `status` | text | না | `'active'::text` |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ | `auth.uid()` |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `da_reference_people`

RLS policy: 1 (SELECT) · ট্রিগার: —

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `zone_id` | uuid | হ্যাঁ | → `zones` |
| `hub_id` | uuid | হ্যাঁ | → `hubs` |
| `name` | text | না |  |
| `position` | text | হ্যাঁ |  |
| `phone` | text | হ্যাঁ |  |
| `profile_id` | uuid | হ্যাঁ | → `profiles` |
| `employee_id` | uuid | হ্যাঁ | → `employees` |
| `status` | text | না | `'active'::text` |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ | `auth.uid()` |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |
| `approval` | text | না | `'approved'::text` |
| `pending_action` | text | হ্যাঁ |  |
| `pending_data` | jsonb | হ্যাঁ |  |
| `pending_note` | text | হ্যাঁ |  |
| `hub_name` | text | হ্যাঁ |  |
| `requested_by` | uuid | হ্যাঁ |  |
| `requested_by_name` | text | হ্যাঁ |  |
| `requested_at` | timestamp with time zone | হ্যাঁ |  |
| `decided_by` | uuid | হ্যাঁ |  |
| `decided_by_name` | text | হ্যাঁ |  |
| `decided_at` | timestamp with time zone | হ্যাঁ |  |
| `decision_note` | text | হ্যাঁ |  |

### `da_report_ids`

RLS policy: 1 (SELECT) · ট্রিগার: da_report_ids_audit, da_report_ids_no_delete, da_report_ids_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `no` | bigint | না |  |
| `session_id` | uuid | না | → `da_sessions` |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `report_no` | text | না |  |
| `amount` | numeric | না | `0` |
| `remarks` | text | হ্যাঁ |  |
| `removed_at` | timestamp with time zone | হ্যাঁ |  |
| `removed_by` | uuid | হ্যাঁ |  |
| `remove_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |
| `file_path` | text | হ্যাঁ |  |
| `raw_text` | text | হ্যাঁ |  |
| `file_at` | timestamp with time zone | হ্যাঁ |  |
| `file_by` | uuid | হ্যাঁ |  |

### `da_rider_lines`

RLS policy: 1 (SELECT) · ট্রিগার: da_rider_collector, da_rider_lines_audit, da_rider_lines_no_delete, da_rider_lines_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `no` | bigint | না |  |
| `session_id` | uuid | না | → `da_sessions` |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `employee_id` | uuid | না | → `employees` |
| `employee_code` | text | হ্যাঁ |  |
| `rider_name` | text | না |  |
| `mobile` | text | হ্যাঁ |  |
| `delivery_qty` | integer | না | `0` |
| `pickup_qty` | integer | না | `0` |
| `amount` | numeric | না | `0` |
| `paid_amount` | numeric | না | `0` |
| `due_input` | numeric | না | `0` |
| `due` | numeric | না | `0` |
| `mobile_banking` | numeric | না | `0` |
| `remarks` | text | হ্যাঁ |  |
| `removed_at` | timestamp with time zone | হ্যাঁ |  |
| `removed_by` | uuid | হ্যাঁ |  |
| `remove_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |
| `collector_user` | uuid | হ্যাঁ | → `profiles` |
| `source` | text | না | `'manager'::text` |
| `seq` | integer | না | `1` |
| `office_deposit` | boolean | না | `false` |
| `accepted_at` | timestamp with time zone | হ্যাঁ |  |
| `accepted_by` | uuid | হ্যাঁ | → `profiles` |

### `da_sessions`

RLS policy: 1 (SELECT) · ট্রিগার: da_sessions_audit, da_sessions_no_delete, da_sessions_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `no` | bigint | না |  |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `account_date` | date | না |  |
| `status` | text | না | `'open'::text` |
| `started_by` | uuid | না |  |
| `started_by_employee` | uuid | হ্যাঁ | → `employees` |
| `started_by_name` | text | হ্যাঁ |  |
| `started_by_code` | text | হ্যাঁ |  |
| `started_at` | timestamp with time zone | না | `now()` |
| `last_saved_at` | timestamp with time zone | না | `now()` |
| `submitted_by` | uuid | হ্যাঁ |  |
| `submitted_by_name` | text | হ্যাঁ |  |
| `submitted_by_code` | text | হ্যাঁ |  |
| `submitted_at` | timestamp with time zone | হ্যাঁ |  |
| `submit_note` | text | হ্যাঁ |  |
| `submit_count` | integer | না | `0` |
| `verified_by` | uuid | হ্যাঁ |  |
| `verified_by_name` | text | হ্যাঁ |  |
| `verified_at` | timestamp with time zone | হ্যাঁ |  |
| `verify_note` | text | হ্যাঁ |  |
| `ledger_entry_id` | uuid | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |
| `closed_at` | timestamp with time zone | হ্যাঁ |  |
| `closed_by` | uuid | হ্যাঁ |  |
| `closed_totals` | jsonb | হ্যাঁ |  |
| `bank_done_at` | timestamp with time zone | হ্যাঁ |  |
| `bank_done_by` | uuid | হ্যাঁ |  |
| `bank_done_note` | text | হ্যাঁ |  |
| `check_note` | text | হ্যাঁ |  |
| `check_done` | integer | হ্যাঁ |  |
| `check_needed` | integer | হ্যাঁ |  |
| `report_ok_at` | timestamp with time zone | হ্যাঁ |  |
| `report_ok_by` | uuid | হ্যাঁ |  |
| `report_ok_by_name` | text | হ্যাঁ |  |
| `report_total` | numeric | হ্যাঁ |  |
| `report_diff` | numeric | হ্যাঁ |  |
| `report_note` | text | হ্যাঁ |  |
| `check_left` | text | হ্যাঁ |  |

### `da_sheet_collectors`

RLS policy: 1 (SELECT) · ট্রিগার: da_collectors_unaccept

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `session_id` | uuid | না | → `da_sessions` |
| `user_id` | uuid | না |  |
| `employee_id` | uuid | হ্যাঁ | → `employees` |
| `name` | text | হ্যাঁ |  |
| `code` | text | হ্যাঁ |  |
| `closed_at` | timestamp with time zone | হ্যাঁ |  |
| `note` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |
| `closed_by` | uuid | হ্যাঁ |  |
| `closed_by_name` | text | হ্যাঁ |  |
| `accepted_at` | timestamp with time zone | হ্যাঁ |  |
| `accepted_by` | uuid | হ্যাঁ |  |
| `accepted_by_name` | text | হ্যাঁ |  |

## জোনাল ম্যানেজমেন্ট

### `hub_daily_metrics`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: hub_daily_metrics_audit, hub_daily_metrics_courier_guard, hub_daily_metrics_guard, hub_daily_metrics_no_delete, hub_daily_metrics_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `metric_date` | date | না |  |
| `pickup_count` | integer | না | `0` |
| `delivery_count` | integer | না | `0` |
| `pending_parcels` | integer | না | `0` |
| `merchant_count` | integer | না | `0` |
| `rider_count` | integer | না | `0` |
| `rider_capacity` | integer | না | `0` |
| `working_hours` | numeric | না | `0` |
| `cash_collected` | numeric | না | `0` |
| `expenses` | numeric | না | `0` |
| `note` | text | হ্যাঁ |  |
| `status` | text | না | `'submitted'::text` |
| `verified_by` | uuid | হ্যাঁ |  |
| `verified_at` | timestamp with time zone | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |
| `source` | text | না | `'manual'::text` |

### `hub_import_rows`

RLS policy: 1 (SELECT) · ট্রিগার: hub_import_rows_audit, hub_import_rows_no_delete

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `batch` | text | না |  |
| `sl` | integer | না |  |
| `zone_id` | uuid | না | → `zones` |
| `code` | text | না |  |
| `phone` | text | হ্যাঁ |  |
| `address` | text | হ্যাঁ |  |
| `latitude` | numeric | হ্যাঁ |  |
| `longitude` | numeric | হ্যাঁ |  |
| `suggested_hub_id` | uuid | হ্যাঁ | → `hubs` |
| `suggest_note` | text | হ্যাঁ |  |
| `applied_hub_id` | uuid | হ্যাঁ | → `hubs` |
| `applied_at` | timestamp with time zone | হ্যাঁ |  |
| `applied_by` | uuid | হ্যাঁ |  |
| `result_note` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |

### `hub_routes`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: hub_routes_audit, hub_routes_no_delete, hub_routes_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `code` | text | না |  |
| `name` | text | না |  |
| `areas` | ARRAY | না | `'{}'::text[]` |
| `note` | text | হ্যাঁ |  |
| `status` | text | না | `'active'::text` |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `hub_visits`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: hub_visits_audit, hub_visits_guard, hub_visits_no_delete, hub_visits_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `visitor_id` | uuid | না | → `profiles` · `auth.uid()` |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `visit_date` | date | না |  |
| `purpose` | text | না |  |
| `findings` | text | হ্যাঁ |  |
| `distance_km` | numeric | না | `0` |
| `fuel_amount` | numeric | না | `0` |
| `meal_amount` | numeric | না | `0` |
| `transport_amount` | numeric | না | `0` |
| `other_amount` | numeric | না | `0` |
| `other_note` | text | হ্যাঁ |  |
| `total_amount` | numeric | হ্যাঁ |  |
| `claim_id` | uuid | হ্যাঁ | → `travel_claims` |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `operational_expenses`

RLS policy: 1 (SELECT) · ট্রিগার: operational_expenses_audit, operational_expenses_no_delete, operational_expenses_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `expense_date` | date | না |  |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `category` | text | না |  |
| `amount` | numeric | না |  |
| `description` | text | না |  |
| `rider_id` | uuid | হ্যাঁ | → `employees` |
| `paid_from` | text | না | `'hub_cash'::text` |
| `status` | text | না | `'pending'::text` |
| `recorded_by` | uuid | না |  |
| `decided_by` | uuid | হ্যাঁ |  |
| `decided_at` | timestamp with time zone | হ্যাঁ |  |
| `decision_note` | text | হ্যাঁ |  |
| `ledger_entry_id` | uuid | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `task_reminders`

RLS policy: 1 (SELECT) · ট্রিগার: task_reminders_no_delete

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `task_id` | uuid | না | → `tasks` |
| `remind_at` | timestamp with time zone | না |  |
| `note` | text | হ্যাঁ |  |
| `sent_at` | timestamp with time zone | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ | `auth.uid()` |

### `tasks`

RLS policy: 1 (SELECT) · ট্রিগার: tasks_audit, tasks_no_delete, tasks_scope_guard, tasks_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `task_no` | text | না | `('T-'::text || lpad((nextval('task_no_seq'::regcla` |
| `title` | text | না |  |
| `description` | text | হ্যাঁ |  |
| `zone_id` | uuid | হ্যাঁ | → `zones` |
| `hub_id` | uuid | হ্যাঁ | → `hubs` |
| `assigned_to` | uuid | না | → `profiles` |
| `accountable_manager_id` | uuid | না | → `profiles` |
| `related_employee_id` | uuid | হ্যাঁ | → `employees` |
| `due_date` | date | না |  |
| `priority` | text | না | `'normal'::text` |
| `requires_submission` | boolean | না | `false` |
| `status` | text | না | `'assigned'::text` |
| `progress_note` | text | হ্যাঁ |  |
| `submission_note` | text | হ্যাঁ |  |
| `submitted_at` | timestamp with time zone | হ্যাঁ |  |
| `completed_at` | timestamp with time zone | হ্যাঁ |  |
| `completed_by` | uuid | হ্যাঁ |  |
| `completion_note` | text | হ্যাঁ |  |
| `cancelled_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `travel_claims`

RLS policy: 1 (SELECT) · ট্রিগার: travel_claims_audit, travel_claims_no_delete, travel_claims_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `claim_no` | text | না | `('TC-'::text || lpad((nextval('travel_claim_no_seq` |
| `claimant_id` | uuid | না | → `profiles` |
| `zone_id` | uuid | না | → `zones` |
| `period_type` | text | না |  |
| `period_from` | date | না |  |
| `period_to` | date | না |  |
| `visit_count` | integer | না |  |
| `total_km` | numeric | না | `0` |
| `fuel_amount` | numeric | না | `0` |
| `meal_amount` | numeric | না | `0` |
| `transport_amount` | numeric | না | `0` |
| `other_amount` | numeric | না | `0` |
| `total_amount` | numeric | না | `0` |
| `status` | text | না | `'submitted'::text` |
| `decided_by` | uuid | হ্যাঁ |  |
| `decided_at` | timestamp with time zone | হ্যাঁ |  |
| `decision_note` | text | হ্যাঁ |  |
| `voucher_no` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `workforce_recommendations`

_Advisory planning output. A recommendation never changes employees, pay or status; an authorised person decides and acts through the HR workflows._

RLS policy: 1 (SELECT) · ট্রিগার: workforce_recommendations_audit, workforce_recommendations_no_delete, workforce_recommendations_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `zone_id` | uuid | না | → `zones` |
| `hub_id` | uuid | না | → `hubs` |
| `period_from` | date | না |  |
| `period_to` | date | না |  |
| `kind` | text | না |  |
| `summary` | text | না |  |
| `evidence` | jsonb | না |  |
| `assumptions` | jsonb | না |  |
| `status` | text | না | `'proposed'::text` |
| `reviewed_by` | uuid | হ্যাঁ |  |
| `reviewed_at` | timestamp with time zone | হ্যাঁ |  |
| `review_note` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

## ইস্যু ও হাব গ্রুপ

### `hub_post_reactions`

RLS policy: 1 (SELECT) · ট্রিগার: —

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `post_id` | uuid | না | → `hub_posts` |
| `profile_id` | uuid | না |  |
| `emoji` | text | না |  |
| `at` | timestamp with time zone | না | `now()` |

### `hub_post_seen`

RLS policy: 1 (SELECT) · ট্রিগার: —

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `post_id` | uuid | না | → `hub_posts` |
| `profile_id` | uuid | না |  |
| `seen_at` | timestamp with time zone | না | `now()` |

### `hub_posts`

RLS policy: 1 (SELECT) · ট্রিগার: hub_posts_no_delete

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `hub_id` | uuid | না | → `hubs` |
| `author_profile` | uuid | হ্যাঁ |  |
| `author_name` | text | না |  |
| `kind` | text | না | `'text'::text` |
| `body` | text | হ্যাঁ |  |
| `photo_path` | text | হ্যাঁ |  |
| `issue_id` | uuid | হ্যাঁ | → `issues` |
| `created_at` | timestamp with time zone | না | `now()` |

### `issue_events`

RLS policy: 1 (SELECT) · ট্রিগার: issue_events_no_delete

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `issue_id` | uuid | না | → `issues` |
| `action` | text | না |  |
| `note` | text | হ্যাঁ |  |
| `by_user` | uuid | হ্যাঁ | `auth.uid()` |
| `by_name` | text | হ্যাঁ |  |
| `at` | timestamp with time zone | না | `now()` |

### `issues`

RLS policy: 1 (SELECT) · ট্রিগার: issues_audit, issues_no_delete, issues_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `issue_no` | text | না | `('IS-'::text || lpad((nextval('issue_no_seq'::regc` |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `kind` | text | না | `'parcel'::text` |
| `title` | text | না |  |
| `body` | text | হ্যাঁ |  |
| `priority` | text | না | `'normal'::text` |
| `parcel_ref` | text | হ্যাঁ |  |
| `parcel_id` | uuid | হ্যাঁ | → `parcels` |
| `photo_path` | text | হ্যাঁ |  |
| `status` | text | না | `'open'::text` |
| `assignee_id` | uuid | হ্যাঁ | → `employees` |
| `assigned_by` | uuid | হ্যাঁ |  |
| `assigned_by_name` | text | হ্যাঁ |  |
| `assigned_by_nodi` | boolean | না | `false` |
| `due_at` | timestamp with time zone | হ্যাঁ |  |
| `solved_at` | timestamp with time zone | হ্যাঁ |  |
| `solved_note` | text | হ্যাঁ |  |
| `solve_photo` | text | হ্যাঁ |  |
| `approved_at` | timestamp with time zone | হ্যাঁ |  |
| `approved_by` | uuid | হ্যাঁ |  |
| `approve_note` | text | হ্যাঁ |  |
| `reopen_count` | integer | না | `0` |
| `last_nudge_at` | timestamp with time zone | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

## নদী AI

### `nodi_usage`

RLS policy: 1 (SELECT) · ট্রিগার: nodi_usage_no_delete

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `profile_id` | uuid | না |  |
| `at` | timestamp with time zone | না | `now()` |
| `day` | date | না | `((now() AT TIME ZONE 'Asia/Dhaka'::text))::date` |
| `model` | text | হ্যাঁ |  |
| `input_tokens` | integer | না | `0` |
| `output_tokens` | integer | না | `0` |
| `ok` | boolean | না | `true` |
| `note` | text | হ্যাঁ |  |

## নোটিফিকেশন

### `notifications`

RLS policy: 2 (SELECT,UPDATE) · ট্রিগার: notifications_fleet_link, notifications_no_delete, notifications_push

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `profile_id` | uuid | না |  |
| `title` | text | না |  |
| `body` | text | হ্যাঁ |  |
| `link` | text | হ্যাঁ |  |
| `kind` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `read_at` | timestamp with time zone | হ্যাঁ |  |
| `pushed_at` | timestamp with time zone | হ্যাঁ |  |

### `pulse_answers`

RLS policy: 0 (—) · ট্রিগার: pulse_answers_audit, pulse_answers_no_delete

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `question_id` | uuid | না | → `pulse_questions` |
| `employee_id` | uuid | না | → `employees` |
| `hub_id` | uuid | হ্যাঁ | → `hubs` |
| `answer` | text | হ্যাঁ |  |
| `note` | text | হ্যাঁ |  |
| `answered_at` | timestamp with time zone | না | `now()` |

### `pulse_questions`

RLS policy: 0 (—) · ট্রিগার: pulse_questions_audit, pulse_questions_no_delete

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `zone_id` | uuid | না | → `zones` |
| `title` | text | না |  |
| `body` | text | হ্যাঁ |  |
| `kind` | text | না | `'yes_no'::text` |
| `hub_ids` | ARRAY | না | `'{}'::uuid[]` |
| `position_ids` | ARRAY | না | `'{}'::uuid[]` |
| `closes_at` | timestamp with time zone | হ্যাঁ |  |
| `status` | text | না | `'open'::text` |
| `created_by` | uuid | হ্যাঁ |  |
| `created_by_name` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `closed_at` | timestamp with time zone | হ্যাঁ |  |

### `push_devices`

RLS policy: 1 (SELECT) · ট্রিগার: —

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `profile_id` | uuid | না |  |
| `token` | text | না |  |
| `platform` | text | না | `'android'::text` |
| `app_version` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `last_seen` | timestamp with time zone | না | `now()` |
| `disabled_at` | timestamp with time zone | হ্যাঁ |  |

## অফিস

### `office_asset_loans`

RLS policy: 1 (SELECT) · ট্রিগার: office_asset_loans_audit, office_asset_loans_no_delete, office_asset_loans_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `asset_id` | uuid | না | → `office_assets` |
| `from_property_id` | uuid | না | → `office_properties` |
| `to_property_id` | uuid | না | → `office_properties` |
| `quantity` | integer | না | `1` |
| `since` | date | না | `((now() AT TIME ZONE 'Asia/Dhaka'::text))::date` |
| `note` | text | হ্যাঁ |  |
| `returned_at` | timestamp with time zone | হ্যাঁ |  |
| `returned_by` | uuid | হ্যাঁ |  |
| `return_note` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `office_assets`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: office_assets_audit, office_assets_no_delete, office_assets_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `property_id` | uuid | না | → `office_properties` |
| `room_id` | uuid | হ্যাঁ | → `office_rooms` |
| `desk_id` | uuid | হ্যাঁ | → `office_desks` |
| `kind` | text | না | `'other'::text` |
| `name` | text | না |  |
| `brand` | text | হ্যাঁ |  |
| `serial_no` | text | হ্যাঁ |  |
| `quantity` | integer | না | `1` |
| `condition` | text | না | `'good'::text` |
| `holder_id` | uuid | হ্যাঁ | → `employees` |
| `purchase_date` | date | হ্যাঁ |  |
| `price` | numeric | হ্যাঁ |  |
| `note` | text | হ্যাঁ |  |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |
| `watt` | integer | হ্যাঁ |  |
| `hours_per_day` | numeric | হ্যাঁ |  |
| `spec` | text | হ্যাঁ |  |
| `vehicle_id` | uuid | হ্যাঁ | → `vehicles` |

### `office_bills`

RLS policy: 1 (SELECT) · ট্রিগার: office_bills_audit, office_bills_no_delete, office_bills_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `property_id` | uuid | না | → `office_properties` |
| `kind` | text | না |  |
| `bill_month` | date | না |  |
| `amount` | numeric | না |  |
| `paid_on` | date | হ্যাঁ |  |
| `method` | text | হ্যাঁ |  |
| `txn_id` | text | হ্যাঁ |  |
| `payee` | text | হ্যাঁ |  |
| `payee_phone` | text | হ্যাঁ |  |
| `units` | numeric | হ্যাঁ |  |
| `has_memo` | boolean | না | `false` |
| `memo_file` | text | হ্যাঁ |  |
| `memo_no` | text | হ্যাঁ |  |
| `proof_file` | text | হ্যাঁ |  |
| `da_expense_id` | uuid | হ্যাঁ | → `da_expenses` |
| `note` | text | হ্যাঁ |  |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `created_by_name` | text | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `office_desks`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: office_desks_audit, office_desks_no_delete, office_desks_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `property_id` | uuid | না | → `office_properties` |
| `room_id` | uuid | হ্যাঁ | → `office_rooms` |
| `code` | text | না |  |
| `name` | text | না |  |
| `responsible_id` | uuid | হ্যাঁ | → `employees` |
| `duty` | text | হ্যাঁ |  |
| `note` | text | হ্যাঁ |  |
| `sort` | integer | না | `100` |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `office_notices`

RLS policy: 1 (SELECT) · ট্রিগার: office_notices_audit, office_notices_no_delete, office_notices_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `notice_no` | text | না | `('ON-'::text || lpad((nextval('office_notice_no_se` |
| `property_id` | uuid | না | → `office_properties` |
| `zone_id` | uuid | না | → `zones` |
| `hub_id` | uuid | হ্যাঁ | → `hubs` |
| `asset_id` | uuid | হ্যাঁ | → `office_assets` |
| `kind` | text | না |  |
| `item_kind` | text | হ্যাঁ |  |
| `title` | text | না |  |
| `quantity` | integer | না | `1` |
| `note` | text | হ্যাঁ |  |
| `priority` | text | না | `'normal'::text` |
| `status` | text | না | `'open'::text` |
| `reply` | text | হ্যাঁ |  |
| `decided_by` | uuid | হ্যাঁ |  |
| `decided_by_name` | text | হ্যাঁ |  |
| `decided_at` | timestamp with time zone | হ্যাঁ |  |
| `by_name` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `office_properties`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: office_properties_audit, office_properties_hub_address, office_properties_no_delete, office_properties_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `code` | USER-DEFINED(citext) | না |  |
| `name` | text | না |  |
| `kind` | text | না | `'office'::text` |
| `zone_id` | uuid | না | → `zones` |
| `hub_id` | uuid | হ্যাঁ | → `hubs` |
| `sorting_center_id` | uuid | হ্যাঁ | → `sorting_centers` |
| `address` | text | হ্যাঁ |  |
| `floor_note` | text | হ্যাঁ |  |
| `owner_name` | text | হ্যাঁ |  |
| `owner_phone` | text | হ্যাঁ |  |
| `rent` | numeric | হ্যাঁ |  |
| `front_direction` | text | হ্যাঁ |  |
| `note` | text | হ্যাঁ |  |
| `status` | text | না | `'active'::text` |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |
| `advance` | numeric | হ্যাঁ |  |
| `contract_from` | date | হ্যাঁ |  |
| `contract_to` | date | হ্যাঁ |  |
| `contract_file` | text | হ্যাঁ |  |
| `rent_due_day` | smallint | হ্যাঁ |  |
| `meter_no` | text | হ্যাঁ |  |
| `unit_rate` | numeric | হ্যাঁ |  |
| `wifi_provider` | text | হ্যাঁ |  |
| `wifi_bill` | numeric | হ্যাঁ |  |
| `capacity` | integer | হ্যাঁ |  |

### `office_residents`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: office_residents_audit, office_residents_no_delete, office_residents_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `property_id` | uuid | না | → `office_properties` |
| `room_id` | uuid | হ্যাঁ | → `office_rooms` |
| `employee_id` | uuid | না | → `employees` |
| `since` | date | না | `((now() AT TIME ZONE 'Asia/Dhaka'::text))::date` |
| `note` | text | হ্যাঁ |  |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `office_rooms`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: office_rooms_audit, office_rooms_no_delete, office_rooms_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `property_id` | uuid | না | → `office_properties` |
| `name` | text | না |  |
| `kind` | text | না | `'room'::text` |
| `direction` | text | না | `'c'::text` |
| `floor` | integer | না | `1` |
| `responsible_id` | uuid | হ্যাঁ | → `employees` |
| `note` | text | হ্যাঁ |  |
| `sort` | integer | না | `100` |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `office_secrets`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: office_secrets_no_delete, office_secrets_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `property_id` | uuid | না | → `office_properties` |
| `asset_id` | uuid | হ্যাঁ | → `office_assets` |
| `kind` | text | না | `'other'::text` |
| `label` | text | না |  |
| `username` | text | হ্যাঁ |  |
| `secret` | text | হ্যাঁ |  |
| `note` | text | হ্যাঁ |  |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

## শটিং সেন্টার

### `sorting_centers`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: sorting_centers_audit, sorting_centers_no_delete, sorting_centers_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `code` | USER-DEFINED(citext) | না |  |
| `name` | text | না |  |
| `name_bn` | text | হ্যাঁ |  |
| `zone_id` | uuid | না | → `zones` |
| `address` | text | হ্যাঁ |  |
| `phone` | text | হ্যাঁ |  |
| `status` | text | না | `'active'::text` |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |
| `home_hub_id` | uuid | হ্যাঁ | → `hubs` |

### `sorting_driver_reports`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: sorting_driver_reports_audit, sorting_driver_reports_no_delete, sorting_driver_reports_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `center_id` | uuid | না | → `sorting_centers` |
| `zone_id` | uuid | না | → `zones` |
| `route_id` | uuid | না | → `sorting_routes` |
| `work_date` | date | না | `CURRENT_DATE` |
| `driver_id` | uuid | হ্যাঁ | → `employees` |
| `vehicle_id` | uuid | হ্যাঁ | → `vehicles` |
| `depart_at` | time without time zone | হ্যাঁ |  |
| `return_at` | time without time zone | হ্যাঁ |  |
| `start_km` | numeric | হ্যাঁ |  |
| `end_km` | numeric | হ্যাঁ |  |
| `hubs_reached` | integer | হ্যাঁ |  |
| `parcels_out` | integer | হ্যাঁ |  |
| `parcels_in` | integer | হ্যাঁ |  |
| `status` | text | না | `'done'::text` |
| `note` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `sorting_fuel_requests`

RLS policy: 1 (SELECT) · ট্রিগার: sorting_fuel_requests_audit, sorting_fuel_requests_no_delete, sorting_fuel_requests_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `no` | bigint | না |  |
| `center_id` | uuid | না | → `sorting_centers` |
| `zone_id` | uuid | না | → `zones` |
| `route_id` | uuid | হ্যাঁ | → `sorting_routes` |
| `vehicle_id` | uuid | হ্যাঁ | → `vehicles` |
| `employee_id` | uuid | হ্যাঁ | → `employees` |
| `kind` | text | না | `'fuel'::text` |
| `request_date` | date | না | `CURRENT_DATE` |
| `fuel_date` | date | হ্যাঁ |  |
| `litres` | numeric | হ্যাঁ |  |
| `rate` | numeric | হ্যাঁ |  |
| `amount` | numeric | না |  |
| `odometer_km` | numeric | হ্যাঁ |  |
| `pump_name` | text | হ্যাঁ |  |
| `slip_no` | text | হ্যাঁ |  |
| `slip_path` | text | হ্যাঁ |  |
| `note` | text | হ্যাঁ |  |
| `status` | text | না | `'submitted'::text` |
| `charge_to` | text | না | `'center'::text` |
| `charge_hub_id` | uuid | হ্যাঁ | → `hubs` |
| `claim_id` | uuid | হ্যাঁ | → `da_expense_claims` |
| `reviewed_by` | uuid | হ্যাঁ |  |
| `reviewed_at` | timestamp with time zone | হ্যাঁ |  |
| `review_note` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `sorting_handovers`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: sorting_handovers_audit, sorting_handovers_no_delete, sorting_handovers_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `no` | bigint | না |  |
| `center_id` | uuid | না | → `sorting_centers` |
| `zone_id` | uuid | না | → `zones` |
| `route_id` | uuid | হ্যাঁ | → `sorting_routes` |
| `hub_id` | uuid | না | → `hubs` |
| `direction` | text | না |  |
| `work_date` | date | না | `CURRENT_DATE` |
| `vehicle_id` | uuid | হ্যাঁ | → `vehicles` |
| `driver_id` | uuid | হ্যাঁ | → `employees` |
| `handed_by_id` | uuid | হ্যাঁ | → `employees` |
| `handed_by_name` | text | হ্যাঁ |  |
| `parcel_count` | integer | না |  |
| `bag_count` | integer | হ্যাঁ |  |
| `wrong_count` | integer | না | `0` |
| `returned_count` | integer | না | `0` |
| `damaged_count` | integer | না | `0` |
| `note` | text | হ্যাঁ |  |
| `status` | text | না | `'sent'::text` |
| `received_count` | integer | হ্যাঁ |  |
| `received_by` | uuid | হ্যাঁ |  |
| `received_by_name` | text | হ্যাঁ |  |
| `received_at` | timestamp with time zone | হ্যাঁ |  |
| `receive_note` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `sorting_route_hubs`

RLS policy: 4 (DELETE,INSERT,SELECT,UPDATE) · ট্রিগার: sorting_route_hubs_audit, sorting_route_hubs_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `route_id` | uuid | না | → `sorting_routes` |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `seq` | integer | না | `1` |
| `can_charge` | boolean | না | `false` |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `sorting_routes`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: sorting_routes_audit, sorting_routes_no_delete, sorting_routes_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `center_id` | uuid | না | → `sorting_centers` |
| `zone_id` | uuid | না | → `zones` |
| `code` | text | না |  |
| `name` | text | না |  |
| `vehicle_id` | uuid | হ্যাঁ | → `vehicles` |
| `driver_id` | uuid | হ্যাঁ | → `employees` |
| `depart_time` | time without time zone | হ্যাঁ |  |
| `note` | text | হ্যাঁ |  |
| `status` | text | না | `'active'::text` |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `sorting_staff`

RLS policy: 3 (INSERT,SELECT,UPDATE) · ট্রিগার: sorting_staff_audit, sorting_staff_no_delete, sorting_staff_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `center_id` | uuid | না | → `sorting_centers` |
| `zone_id` | uuid | না | → `zones` |
| `employee_id` | uuid | না | → `employees` |
| `role` | text | না | `'sorter'::text` |
| `shift` | text | হ্যাঁ |  |
| `duties` | text | হ্যাঁ |  |
| `effective_from` | date | না | `CURRENT_DATE` |
| `effective_to` | date | হ্যাঁ |  |
| `end_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

## গাড়ি / ফ্লিট

### `vehicle_assignments`

RLS policy: 1 (SELECT) · ট্রিগার: vehicle_assign_audit, vehicle_assign_no_delete, vehicle_assign_stamp, vehicle_assignments_fleet_log

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `vehicle_id` | uuid | না | → `vehicles` |
| `employee_id` | uuid | না | → `employees` |
| `hub_id` | uuid | হ্যাঁ | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `effective_from` | date | না | `CURRENT_DATE` |
| `effective_to` | date | হ্যাঁ |  |
| `reason` | text | না |  |
| `end_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |
| `moved_hub` | boolean | না | `false` |
| `role` | text | না | `'driver'::text` |
| `daily_allowance` | numeric | হ্যাঁ |  |

### `vehicle_day_logs`

RLS policy: 1 (SELECT) · ট্রিগার: vehicle_day_logs_audit, vehicle_day_logs_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `vehicle_id` | uuid | না | → `vehicles` |
| `hub_id` | uuid | হ্যাঁ | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `log_date` | date | না | `CURRENT_DATE` |
| `driver_id` | uuid | হ্যাঁ | → `employees` |
| `charged` | boolean | হ্যাঁ |  |
| `charge_place` | text | হ্যাঁ |  |
| `charge_cost` | numeric | হ্যাঁ |  |
| `out_at` | time without time zone | হ্যাঁ |  |
| `in_at` | time without time zone | হ্যাঁ |  |
| `start_km` | integer | হ্যাঁ |  |
| `end_km` | integer | হ্যাঁ |  |
| `trips` | integer | হ্যাঁ |  |
| `data` | jsonb | না | `'{}'::jsonb` |
| `note` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `vehicle_documents`

RLS policy: 1 (SELECT) · ট্রিগার: vehicle_documents_audit, vehicle_documents_no_delete, vehicle_documents_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `vehicle_id` | uuid | না | → `vehicles` |
| `kind` | text | না |  |
| `title` | text | হ্যাঁ |  |
| `doc_no` | text | হ্যাঁ |  |
| `issued_on` | date | হ্যাঁ |  |
| `expires_on` | date | হ্যাঁ |  |
| `amount` | numeric | হ্যাঁ |  |
| `file_path` | text | হ্যাঁ |  |
| `note` | text | হ্যাঁ |  |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `vehicle_events`

RLS policy: 1 (SELECT) · ট্রিগার: vehicle_events_no_delete

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `vehicle_id` | uuid | না | → `vehicles` |
| `at` | timestamp with time zone | না | `now()` |
| `by_user` | uuid | হ্যাঁ | `auth.uid()` |
| `action` | text | না |  |
| `role` | text | হ্যাঁ |  |
| `employee_id` | uuid | হ্যাঁ | → `employees` |
| `detail` | text | হ্যাঁ |  |

### `vehicle_hub_reports`

RLS policy: 1 (SELECT) · ট্রিগার: vehicle_hub_reports_audit, vehicle_hub_reports_no_delete

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `vehicle_id` | uuid | না | → `vehicles` |
| `zone_id` | uuid | না | → `zones` |
| `hub_id` | uuid | না | → `hubs` |
| `report_date` | date | না |  |
| `status` | text | না |  |
| `late_minutes` | integer | হ্যাঁ |  |
| `note` | text | হ্যাঁ |  |
| `photo_path` | text | হ্যাঁ |  |
| `by_employee` | uuid | হ্যাঁ | → `employees` |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ | `auth.uid()` |
| `updated_at` | timestamp with time zone | না | `now()` |

### `vehicle_hubs`

RLS policy: 1 (SELECT) · ট্রিগার: —

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `vehicle_id` | uuid | না | → `vehicles` |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ | `auth.uid()` |

### `vehicle_logs`

RLS policy: 1 (SELECT) · ট্রিগার: vehicle_logs_audit, vehicle_logs_no_delete, vehicle_logs_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `vehicle_id` | uuid | না | → `vehicles` |
| `hub_id` | uuid | হ্যাঁ | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `kind` | text | না |  |
| `log_date` | date | না | `CURRENT_DATE` |
| `odometer` | integer | হ্যাঁ |  |
| `litres` | numeric | হ্যাঁ |  |
| `amount` | numeric | না | `0` |
| `vendor` | text | হ্যাঁ |  |
| `bill_no` | text | হ্যাঁ |  |
| `driver_id` | uuid | হ্যাঁ | → `employees` |
| `da_expense_id` | uuid | হ্যাঁ | → `da_expenses` |
| `note` | text | হ্যাঁ |  |
| `removed_at` | timestamp with time zone | হ্যাঁ |  |
| `removed_by` | uuid | হ্যাঁ |  |
| `remove_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |
| `status` | text | না | `'approved'::text` |
| `slip_path` | text | হ্যাঁ |  |
| `decided_by` | uuid | হ্যাঁ |  |
| `decided_at` | timestamp with time zone | হ্যাঁ |  |
| `decision_note` | text | হ্যাঁ |  |
| `day_log_id` | uuid | হ্যাঁ |  |

### `vehicle_requests`

RLS policy: 1 (SELECT) · ট্রিগার: vehicle_requests_audit, vehicle_requests_no_delete, vehicle_requests_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `no` | text | না |  |
| `vehicle_id` | uuid | না | → `vehicles` |
| `hub_id` | uuid | হ্যাঁ | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `kind` | text | না |  |
| `title` | text | না |  |
| `data` | jsonb | না | `'{}'::jsonb` |
| `photo_path` | text | হ্যাঁ |  |
| `priority` | text | না | `'normal'::text` |
| `status` | text | না | `'open'::text` |
| `by_employee` | uuid | হ্যাঁ | → `employees` |
| `decided_by` | uuid | হ্যাঁ |  |
| `decided_at` | timestamp with time zone | হ্যাঁ |  |
| `decision_note` | text | হ্যাঁ |  |
| `done_at` | timestamp with time zone | হ্যাঁ |  |
| `cost` | numeric | হ্যাঁ |  |
| `log_id` | uuid | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |
| `photos` | ARRAY | না | `'{}'::text[]` |

### `vehicle_requisition_events`

RLS policy: 1 (SELECT) · ট্রিগার: —

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `requisition_id` | uuid | না | → `vehicle_requisitions` |
| `status` | text | না |  |
| `note` | text | হ্যাঁ |  |
| `by_name` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ | `auth.uid()` |

### `vehicle_requisitions`

RLS policy: 1 (SELECT) · ট্রিগার: vehicle_requisitions_audit, vehicle_requisitions_no_delete, vehicle_requisitions_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `no` | text | না |  |
| `hub_id` | uuid | না | → `hubs` |
| `zone_id` | uuid | না | → `zones` |
| `vehicle_id` | uuid | হ্যাঁ | → `vehicles` |
| `work_date` | date | না |  |
| `work_time` | text | হ্যাঁ |  |
| `job` | text | না |  |
| `from_text` | text | হ্যাঁ |  |
| `to_text` | text | হ্যাঁ |  |
| `parcels` | integer | হ্যাঁ |  |
| `weight` | text | হ্যাঁ |  |
| `data` | jsonb | না | `'{}'::jsonb` |
| `note` | text | হ্যাঁ |  |
| `status` | text | না | `'open'::text` |
| `driver_id` | uuid | হ্যাঁ | → `employees` |
| `decided_by` | uuid | হ্যাঁ |  |
| `decided_at` | timestamp with time zone | হ্যাঁ |  |
| `decision_note` | text | হ্যাঁ |  |
| `started_at` | timestamp with time zone | হ্যাঁ |  |
| `done_at` | timestamp with time zone | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |

### `vehicles`

RLS policy: 1 (SELECT) · ট্রিগার: vehicles_audit, vehicles_fleet_log, vehicles_no_delete, vehicles_stamp

| কলাম | টাইপ | খালি? | ডিফল্ট / সম্পর্ক |
|---|---|---|---|
| `id` | uuid | না | `gen_random_uuid()` |
| `code` | USER-DEFINED(citext) | না |  |
| `name` | text | না |  |
| `kind` | text | না | `'bike'::text` |
| `reg_no` | text | হ্যাঁ |  |
| `zone_id` | uuid | না | → `zones` |
| `hub_id` | uuid | হ্যাঁ | → `hubs` |
| `status` | text | না | `'active'::text` |
| `remarks` | text | হ্যাঁ |  |
| `archived_at` | timestamp with time zone | হ্যাঁ |  |
| `archived_by` | uuid | হ্যাঁ |  |
| `archive_reason` | text | হ্যাঁ |  |
| `created_at` | timestamp with time zone | না | `now()` |
| `created_by` | uuid | হ্যাঁ |  |
| `updated_at` | timestamp with time zone | না | `now()` |
| `updated_by` | uuid | হ্যাঁ |  |
| `model` | text | হ্যাঁ |  |
| `model_year` | integer | হ্যাঁ |  |
| `color` | text | হ্যাঁ |  |
| `engine_no` | text | হ্যাঁ |  |
| `chassis_no` | text | হ্যাঁ |  |
| `owner_type` | text | না | `'own'::text` |
| `owner_name` | text | হ্যাঁ |  |
| `owner_phone` | text | হ্যাঁ |  |
| `monthly_rent` | numeric | হ্যাঁ |  |
| `purchase_date` | date | হ্যাঁ |  |
| `purchase_price` | numeric | হ্যাঁ |  |
| `odometer` | integer | না | `0` |
| `fuel_type` | text | হ্যাঁ |  |
| `service_interval_km` | integer | হ্যাঁ |  |
| `last_service_km` | integer | হ্যাঁ |  |
| `last_service_on` | date | হ্যাঁ |  |

## পরিশিষ্ট: public ফাংশন (RPC) — অ্যাপ এগুলো ডাকে

`D` = SECURITY DEFINER (ভেতরে অনুমতি যাচাই করে)। প্রিফিক্স দেখে মডিউল বোঝা যায়: `da_` হিসাব খাতা, `hr_` HR, `vehicle_`/`fleet_` গাড়ি, `sorting_` শটিং, `office_` অফিস, `issue_` ইস্যু, `nodi_` AI।

- `archive_org_unit(p_table text, p_id uuid, p_reason text)`
- `att_days_list(p_hub uuid, p_from date, p_to date)` D
- `att_days_save(p_hub uuid, p_from date, p_to date, p_rows jsonb)` D
- `att_gap_check(p_ids uuid[], p_ok boolean, p_note text)` D
- `att_gap_remind(p_from date, p_to date, p_hub uuid)` D
- `att_gap_report(p_from date, p_to date, p_zone uuid, p_hub uuid)` D
- `att_self_decide(p_ids uuid[], p_ok boolean, p_as text, p_note text)` D
- `att_self_list(p_hub uuid, p_date date)` D
- `att_self_mark(p_kind text, p_note text)` D
- `branding()` D
- `branding_save(p_values jsonb)` D
- `custom_access_token_hook(event jsonb)` D
- `da_accounts_history(p_hub uuid, p_from date, p_to date, p_limit integer)` D
- `da_apply_fixed(p_session uuid)` D
- `da_approval_rule_save(p_self_limit numeric, p_user uuid, p_position uuid, p_zone uuid, p_hub uuid, p_breakdown_required boolean, p_n)` D
- `da_assign_accountant(p_hub uuid, p_user uuid, p_reason text)` D
- `da_bank_charge(p_amount numeric, p_method text, p_date date)` D
- `da_bank_done(p_session uuid, p_note text)` D
- `da_cash_payment_remove(p_id uuid, p_reason text)` D
- `da_cash_payment_save(p_session uuid, p_amount numeric, p_payee uuid, p_payee_name text, p_payment_ref text, p_screenshot_path text,)` D
- `da_cell_set(p_session uuid, p_section text, p_row uuid, p_col text, p_value text)` D
- `da_center_overview(p_date date)` D
- `da_check(p_session uuid, p_note text)` D
- `da_claim_add(p_claim uuid, p_session uuid, p_note text)` D
- `da_claim_reject(p_claim uuid, p_note text)` D
- `da_claim_save(p_expense_name text, p_category text, p_amount numeric, p_bill_date date, p_kind text, p_bill_no text, p_refer)` D
- `da_claim_withdraw(p_claim uuid, p_reason text)` D
- `da_close_day(p_session uuid, p_note text)` D
- `da_close_my_part(p_session uuid, p_note text, p_done boolean)` D
- `da_close_part_for(p_session uuid, p_user uuid, p_done boolean, p_note text)` D
- `da_collectors(p_session uuid)`
- `da_configure(p_key text, p_value jsonb)` D
- `da_dashboard(p_from date, p_to date, p_hub uuid, p_zone uuid)`
- `da_deposit_confirm(p_deposit uuid, p_confirm boolean, p_note text)` D
- `da_deposit_remove(p_id uuid, p_reason text)` D
- `da_deposit_save(p_session uuid, p_amount numeric, p_method text, p_bank text, p_ref text, p_slip text, p_date date, p_transpor)` D
- `da_deposit_slip_read(p_deposit uuid, p_ocr_amount numeric, p_confidence integer)` D
- `da_event_snapshot(p_event uuid)`
- `da_expense_approve(p_expense uuid, p_approve boolean, p_note text)` D
- `da_expense_set_extra(p_line uuid, p_reference_person uuid, p_breakdown jsonb)` D
- `da_flow_list(p_from date, p_to date, p_hub uuid)`
- `da_hub_access(p_hub uuid)` D
- `da_hub_collectors_set(p_hub uuid, p_count integer)` D
- `da_hub_employees(p_hub uuid)` D
- `da_hub_rider_sheet(p_session uuid)` D
- `da_import_day(p_date date, p_hub uuid)` D
- `da_import_map_rider(p_code text, p_employee uuid)` D
- `da_import_save(p_hub uuid, p_date date, p_raw text, p_report jsonb)` D
- `da_import_status(p_date date, p_zone uuid)` D
- `da_list_sessions(p_from date, p_to date, p_hub uuid, p_zone uuid, p_status text)`
- `da_lookup_employee(p_hub uuid, p_code text)` D
- `da_lookup_merchant(p_hub uuid, p_query text)` D
- `da_make_voucher(p_expense uuid)` D
- `da_match_payment(p_hub uuid, p_payment_ref text)` D
- `da_my_accounts(p_from date, p_to date)`
- `da_my_claims(p_days integer)`
- `da_my_expense_requests(p_session uuid)` D
- `da_my_handovers(p_days integer)` D
- `da_my_hubs()` D
- `da_my_rider_lines(p_days integer)` D
- `da_my_vehicles()` D
- `da_note_remove(p_id uuid, p_reason text)` D
- `da_note_save(p_session uuid, p_amount numeric, p_method text, p_from_code text, p_from_name text, p_note text, p_id uuid)` D
- `da_page_enter(p_session uuid)` D
- `da_page_ping(p_visit uuid, p_leaving boolean)` D
- `da_parts_accept(p_session uuid, p_users uuid[], p_accept boolean)` D
- `da_payee_save(p_name text, p_kind text, p_zone uuid, p_hub uuid, p_phone text, p_merchant_code text, p_name_bn text, p_statu)` D
- `da_pending_approvals(p_zone uuid, p_hub uuid)` D
- `da_pending_riders(p_session uuid)` D
- `da_reconcile(p_session uuid, p_rows jsonb)` D
- `da_reference_save(p_name text, p_position text, p_phone text, p_profile uuid, p_employee uuid, p_zone uuid, p_hub uuid, p_status)` D
- `da_remind_open()` D
- `da_remove_line(p_kind text, p_line uuid, p_reason text)` D
- `da_reopen(p_session uuid, p_reason text)` D
- `da_reopen_day(p_session uuid, p_reason text)` D
- `da_report(p_kind text, p_from date, p_to date, p_hub uuid, p_zone uuid)`
- `da_report_attach(p_report uuid, p_path text, p_text text)` D
- `da_report_ok(p_session uuid, p_note text)` D
- `da_report_ok_undo(p_session uuid, p_reason text)` D
- `da_report_remove(p_id uuid, p_reason text)` D
- `da_report_save(p_session uuid, p_report_no text, p_amount numeric, p_remarks text, p_id uuid)` D
- `da_report_text(p_session uuid)` D
- `da_request_expense(p_to_user uuid, p_expense_name text, p_category text, p_amount numeric, p_kind text, p_attachment_path text, p)` D
- `da_revoke_accountant(p_id uuid, p_reason text)` D
- `da_rider_accept(p_line uuid, p_accept boolean, p_note text)` D
- `da_rider_accept_all(p_session uuid)` D
- `da_rider_open_managers(p_date date)` D
- `da_rider_submit(p_manager uuid, p_amount numeric, p_delivery integer, p_pickup integer, p_office boolean, p_mobile_banking num)` D
- `da_save_expense(p_session uuid, p_kind text, p_employee_code text, p_expense_name text, p_category text, p_amount numeric, p_b)` D
- `da_save_merchant_payment(p_session uuid, p_merchant uuid, p_payment_ref text, p_transaction_id text, p_amount numeric, p_payment_date d)` D
- `da_save_rider_line(p_session uuid, p_employee_code text, p_delivery integer, p_pickup integer, p_amount numeric, p_paid numeric, )` D
- `da_save_template(p_name text, p_category text, p_reference_prefix text, p_keywords text[], p_memo_template text, p_default_amou)` D
- `da_set_expense_reference(p_line uuid, p_name text, p_phone text, p_position text, p_vehicle uuid)` D
- `da_settings()` D
- `da_sheet(p_session uuid)` D
- `da_sheet_claims(p_session uuid)`
- `da_start_session(p_hub uuid, p_date date)` D
- `da_submit(p_session uuid, p_note text)` D
- `da_suggest_category(p_text text)` D
- `da_verifier_candidates()` D
- `da_verify(p_session uuid, p_action text, p_note text)` D
- `da_voucher(p_expense uuid)`
- `dashboard_default_view()` D
- `dashboard_home()`
- `dashboard_panels()`
- `fleet_approve(p_log uuid, p_note text)` D
- `fleet_approvers()` D
- `fleet_board(p_hub uuid)` D
- `fleet_events(p_vehicle uuid, p_limit integer)` D
- `fleet_garage_save(p_vehicle uuid, p_date date, p_charged boolean, p_cost numeric, p_place text, p_note text)` D
- `fleet_hub_report(p_vehicle uuid, p_hub uuid, p_status text, p_minutes integer, p_note text, p_photo text, p_date date)` D
- `fleet_hub_reports(p_from date, p_to date, p_hub uuid)` D
- `fleet_khoraki_post(p_vehicle uuid, p_date date)` D
- `fleet_mine()` D
- `fleet_post(p_log uuid)` D
- `fleet_request(p_vehicle uuid, p_kind text, p_title text, p_data jsonb, p_priority text, p_photos text[])` D
- `fleet_request_done(p_id uuid, p_cost numeric, p_note text)` D
- `fleet_set_crew(p_vehicle uuid, p_role text, p_employee_code text, p_allowance numeric, p_reason text)` D
- `fleet_vehicle_save(p_name text, p_reg_no text, p_kind text, p_hub uuid, p_status text, p_id uuid)` D
- `fleet_waiting(p_hub uuid)` D
- `hr_application_missing_fields(p_employee uuid)` D
- `hr_approve_application(p_employee uuid, p_employee_code text, p_note text)` D
- `hr_approve_compensation(p_compensation uuid)` D
- `hr_approve_salary_sheet(p_sheet uuid)` D
- `hr_archive_employee(p_employee uuid, p_reason text)` D
- `hr_attendance_summary(p_month date, p_hub uuid)`
- `hr_bulk_assign_ids(p_items jsonb, p_note text)` D
- `hr_cancel_import(p_batch uuid)` D
- `hr_cancel_leave(p_request uuid, p_reason text)` D
- `hr_cancel_salary_sheet(p_sheet uuid, p_reason text)` D
- `hr_change_register(p_zone uuid, p_from date, p_to date)` D
- `hr_change_status(p_employee uuid, p_status text, p_effective date, p_reason text)` D
- `hr_commit_import(p_batch uuid, p_skip_invalid boolean)` D
- `hr_correct_employee_code(p_employee uuid, p_code text, p_reason text)` D
- `hr_dashboard(p_from date, p_to date, p_zone uuid, p_hub uuid)`
- `hr_decide_leave(p_request uuid, p_approve boolean, p_note text)` D
- `hr_export_rows(p_fields text[], p_zone uuid, p_hub uuid, p_status text, p_q text)` D
- `hr_generate_salary_sheet(p_month date, p_hub uuid)` D
- `hr_hub_post_matrix(p_zone uuid)` D
- `hr_hub_profile_get(p_employee uuid)` D
- `hr_hub_profile_save(p_employee uuid, p jsonb)` D
- `hr_hub_staff_summary(p_zone uuid)` D
- `hr_import_create_missing(p_batch uuid, p_zone uuid, p_department uuid)` D
- `hr_import_missing(p_batch uuid)` D
- `hr_leave_balance(p_employee uuid, p_year integer)` D
- `hr_link_login(p_employee uuid, p_profile uuid)` D
- `hr_lookup_employee(p_code text)` D
- `hr_masked_nid(p_employee uuid)` D
- `hr_missing_information(p_zone uuid, p_hub uuid)`
- `hr_next_employee_code()` D
- `hr_next_employee_codes(p_count integer)` D
- `hr_profile_gaps(p_zone uuid, p_hub uuid)`
- `hr_propose_compensation(p_employee uuid, p_effective_from date, p_basic numeric, p_transport numeric, p_commission numeric, p_items js)` D
- `hr_reference_brought_pending(p_referrer uuid)` D
- `hr_reference_decide(p_ids uuid[], p_ok boolean, p_note text)` D
- `hr_reference_many(p_employees uuid[], p_action text, p_referrer uuid, p_note text)` D
- `hr_reference_of(p_employee uuid)` D
- `hr_reference_pending(p_employee uuid)` D
- `hr_reference_request(p_employee uuid, p_referrer uuid, p_manual jsonb, p_note text)` D
- `hr_reference_requests()` D
- `hr_referral_summary(p_zone uuid)` D
- `hr_referrals(p_employee uuid)` D
- `hr_referrer_of(p_employee uuid)` D
- `hr_reject_application(p_employee uuid, p_reason text)` D
- `hr_reject_compensation(p_compensation uuid, p_reason text)` D
- `hr_remove_wrong_entry(p_employee uuid, p_reason text)` D
- `hr_request_cancel(p_id uuid, p_reason text)` D
- `hr_request_submit(p_format uuid, p_employee uuid, p_hub uuid, p_data jsonb, p_note text, p_ref_employee uuid, p_ref_name text, p)` D
- `hr_request_summary()`
- `hr_request_update(p_id uuid, p_status text, p_note text, p_result text)` D
- `hr_return_application(p_employee uuid, p_note text)` D
- `hr_reveal_sensitive(p_employee uuid, p_reason text)` D
- `hr_set_reference(p_employee uuid, p_referrer uuid, p_manual jsonb)` D
- `hr_set_referrer(p_employee uuid, p_referrer_code text)` D
- `hr_set_work_focus(p_employee uuid, p_focus text)` D
- `hr_start_application(p_full_name text, p_mobile text, p_hub uuid, p_department uuid, p_position uuid)`
- `hr_submit_application(p_employee uuid)` D
- `hr_submit_salary_sheet(p_sheet uuid)` D
- `hr_transfer_employee(p_employee uuid, p_hub uuid, p_department uuid, p_position uuid, p_manager uuid, p_effective date, p_reason te)` D
- `hr_validate_import(p_batch uuid, p_mapping jsonb)` D
- `hr_verify_import(p_batch uuid)` D
- `hub_feed(p_hub uuid, p_before timestamp with time zone, p_limit integer)` D
- `hub_group_hubs()` D
- `hub_import_apply(p_row uuid, p_hub uuid, p_name text, p_name_bn text)` D
- `hub_login_list(p_hub uuid)` D
- `hub_post_create(p_hub uuid, p_body text, p_photo text)` D
- `hub_post_react(p_post uuid, p_emoji text)` D
- `hub_post_reacted_by(p_post uuid)` D
- `hub_post_seen_by(p_post uuid)` D
- `hub_posts_seen(p_posts uuid[])` D
- `issue_act(p_id uuid, p_action text, p_note text, p_photo text)` D
- `issue_assign(p_id uuid, p_assignee uuid, p_note text)` D
- `issue_create(p_hub uuid, p_title text, p_body text, p_kind text, p_parcel_ref text, p_photo text, p_assignee uuid, p_due ti)` D
- `issue_detail(p_id uuid)`
- `issue_nudge_due(p_hours integer)` D
- `issue_order_incharge()` D
- `issue_order_incharge_set(p_kind text, p_employee uuid)` D
- `issue_panels()`
- `login_lock_state(p_email text)` D
- `login_resolve(p_identifier text)` D
- `mp_close(p_id uuid, p_status text, p_filled integer, p_note text)` D
- `mp_decide(p_id uuid, p_status text, p_note text, p_scope text, p_notify_positions uuid[], p_needed integer)` D
- `mp_submit(p_hub uuid, p_position uuid, p_needed integer, p_reason text, p_pickup integer, p_delivery integer, p_big inte)` D
- `my_att_gap_answer(p_dates date[], p_kind text, p_note text, p_leave_type uuid)` D
- `my_att_gaps()` D
- `my_att_today()` D
- `my_duties(p_employee uuid)`
- `my_employee_id()` D
- `my_menu()` D
- `my_mobile_set(p_mobile text)` D
- `my_permissions()` D
- `nodi_configure(p_enabled boolean, p_model text, p_daily_limit integer, p_max_tokens integer)` D
- `nodi_gate()` D
- `nodi_log(p_profile uuid, p_model text, p_in integer, p_out integer, p_ok boolean, p_note text)` D
- `nodi_settings()` D
- `nodi_usage_summary(p_days integer)` D
- `office_bill_remove(p_id uuid, p_reason text)` D
- `office_bill_save(p_property uuid, p_kind text, p_month date, p_amount numeric, p_more jsonb, p_id uuid)` D
- `office_create_hub_offices(p_zone uuid)` D
- `office_expense_lines(p_property uuid, p_from date, p_to date)` D
- `office_lend(p_asset uuid, p_to uuid, p_quantity integer, p_note text)` D
- `office_lend_return(p_loan uuid, p_note text)` D
- `office_loan_list(p_open_only boolean)` D
- `office_notice_send(p_property uuid, p_kind text, p_title text, p_asset uuid, p_item_kind text, p_quantity integer, p_note text, p)` D
- `office_notice_update(p_id uuid, p_status text, p_reply text, p_fixed boolean)` D
- `ops_approve_pickup(p_id uuid, p_note text)` D
- `ops_assign(p_kind text, p_employee uuid, p_hub uuid, p_zone uuid, p_from date, p_reason text, p_duty text)` D
- `ops_assign_issue(p_issue uuid, p_assignee uuid, p_note text)` D
- `ops_cancel_handover(p_id uuid, p_reason text)` D
- `ops_cancel_parcel(p_parcel uuid, p_reason text)` D
- `ops_cash_position(p_hub uuid, p_date date)` D
- `ops_cod_reconciliation(p_from date, p_to date, p_zone uuid, p_hub uuid)`
- `ops_comment_issue(p_issue uuid, p_note text)` D
- `ops_confirm_handover(p_id uuid, p_received numeric, p_note text)` D
- `ops_daily_report(p_group text, p_from date, p_to date, p_zone uuid, p_hub uuid)`
- `ops_decide_delivery(p_id uuid, p_decision text, p_note text)` D
- `ops_decide_expense(p_id uuid, p_decision text, p_note text)` D
- `ops_decide_merchant_payment(p_id uuid, p_decision text, p_note text)` D
- `ops_decide_reconciliation(p_id uuid, p_decision text, p_note text)` D
- `ops_dispatch_parcels(p_rider uuid, p_parcels uuid[])` D
- `ops_end_assignment(p_id uuid, p_to date, p_reason text)` D
- `ops_hub_staff(p_hub uuid)` D
- `ops_hub_summary(p_hub uuid, p_date date)`
- `ops_open_issue(p_tracking_no text, p_type text, p_description text, p_priority text)` D
- `ops_parcel_lookup(p_tracking_no text)`
- `ops_pickup_groups(p_from date, p_to date, p_zone uuid, p_hub uuid)`
- `ops_record_cash_collection(p_hub uuid, p_date date, p_amount numeric, p_source text, p_note text, p_merchant uuid)` D
- `ops_record_delivery(p_parcel uuid, p_outcome text, p_cod_collected numeric, p_reason text, p_recipient text, p_date date)` D
- `ops_record_expense(p_hub uuid, p_date date, p_category text, p_amount numeric, p_description text, p_paid_from text, p_rider uuid)` D
- `ops_reject_pickup(p_id uuid, p_reason text)` D
- `ops_reopen_issue(p_issue uuid, p_reason text)` D
- `ops_request_merchant_payment(p_merchant uuid, p_hub uuid, p_amount numeric, p_method text, p_reference text, p_date date, p_note text)` D
- `ops_resolve_issue(p_issue uuid, p_resolution text)` D
- `ops_rider_ledger(p_rider uuid, p_from date, p_to date)` D
- `ops_submit_hub_handover(p_hub uuid, p_amount numeric, p_note text)` D
- `ops_submit_pickup(p_source text, p_date date, p_hub uuid, p_merchant uuid, p_parcels integer, p_cod numeric, p_collection numeri)` D
- `ops_submit_reconciliation(p_hub uuid, p_date date, p_counted numeric, p_note text)` D
- `ops_submit_rider_handover(p_hub uuid, p_amount numeric, p_rider uuid, p_note text)` D
- `ops_verify_pickup(p_id uuid)` D
- `ops_void_pickup(p_consolidation uuid, p_reason text)` D
- `ops_withdraw_pickup(p_id uuid, p_reason text)` D
- `pulse_answer(p_id uuid, p_answer text, p_note text)` D
- `pulse_close(p_id uuid)` D
- `pulse_create(p_zone uuid, p_title text, p_body text, p_kind text, p_hubs uuid[], p_positions uuid[], p_closes date)` D
- `pulse_list(p_zone uuid)` D
- `pulse_mine()` D
- `pulse_results(p_id uuid)` D
- `push_claim(p_limit integer)` D
- `push_device_dead(p_tokens text[])` D
- `push_device_remove(p_token text)` D
- `push_device_save(p_token text, p_platform text, p_version text)` D
- `record_login_attempt(p_email text, p_success boolean, p_portal text, p_failure_reason text, p_ip text, p_user_agent text)` D
- `ref_decide(p_ids uuid[], p_ok boolean, p_note text)` D
- `ref_hub_people(p_hub uuid)` D
- `ref_request_add(p_employee uuid, p_name text, p_position text, p_phone text, p_hub uuid, p_hub_name text, p_zone uuid, p_note )` D
- `ref_request_edit(p_id uuid, p_employee uuid, p_name text, p_position text, p_phone text, p_hub uuid, p_hub_name text, p_zone uu)` D
- `ref_request_remove(p_id uuid, p_reason text)` D
- `role_admin_archive(p_id uuid, p_reason text)` D
- `role_admin_list()` D
- `role_admin_save(p_id uuid, p_name text, p_name_bn text, p_description text, p_permissions text[])` D
- `role_dashboard_list()` D
- `role_dashboard_save(p_role uuid, p_panels text[])` D
- `role_dashboard_set_view(p_role uuid, p_view text)` D
- `role_menu_list()` D
- `role_menu_save(p_role uuid, p_menu text[])` D
- `rollout_people(p_hub uuid)` D
- `rollout_progress(p_zone uuid)` D
- `sorting_assign_hubs(p_center uuid, p_hubs uuid[], p_home_hub uuid)` D
- `sorting_dashboard(p_center uuid, p_from date, p_to date)` D
- `sorting_fuel_decide(p_id uuid, p_approve boolean, p_note text)` D
- `sorting_fuel_save(p_center uuid, p_amount numeric, p_kind text, p_route uuid, p_vehicle uuid, p_employee_code text, p_fuel_date )` D
- `sorting_fuel_withdraw(p_id uuid, p_reason text)` D
- `sorting_handover_receive(p_id uuid, p_count integer, p_wrong integer, p_returned integer, p_damaged integer, p_note text)` D
- `sorting_route_report(p_center uuid, p_from date, p_to date)` D
- `system_timezone_ok()`
- `task_add_reminder(p_task uuid, p_remind_at timestamp with time zone, p_note text)` D
- `task_assign(p_title text, p_assignee uuid, p_due date, p_zone uuid, p_hub uuid, p_description text, p_priority text, p_req)` D
- `task_cancel(p_task uuid, p_reason text)` D
- `task_complete(p_task uuid, p_note text)` D
- `task_due_reminders()` D
- `task_reassign(p_task uuid, p_assignee uuid, p_due date, p_reason text)` D
- `task_return(p_task uuid, p_note text)` D
- `task_update_progress(p_task uuid, p_status text, p_note text)` D
- `user_admin_assign_role(p_user uuid, p_role uuid, p_scope text, p_zone uuid, p_hub uuid, p_valid_to date)` D
- `user_admin_assignable_roles(p_scope text, p_zone uuid, p_hub uuid)` D
- `user_admin_can_manage(p_user uuid)` D
- `user_admin_finish_create(p_user uuid, p_full_name text, p_phone text)` D
- `user_admin_list()` D
- `user_admin_note_reset(p_user uuid)` D
- `user_admin_precheck(p_email text, p_role uuid, p_scope text, p_zone uuid, p_hub uuid, p_employee uuid)` D
- `user_admin_revoke_role(p_assignment uuid, p_reason text)` D
- `user_admin_set_status(p_user uuid, p_active boolean, p_reason text)` D
- `user_admin_unlinked_employees()` D
- `user_admin_unlock(p_user uuid)` D
- `vehicle_alerts(p_hub uuid)` D
- `vehicle_archive(p_vehicle uuid, p_reason text)` D
- `vehicle_assign(p_vehicle uuid, p_employee_code text, p_reason text, p_from date, p_keep_hub boolean, p_role text)` D
- `vehicle_configure(p_key text, p_value jsonb)` D
- `vehicle_day_list(p_vehicle uuid, p_from date, p_to date, p_hub uuid)` D
- `vehicle_day_save(p_vehicle uuid, p_date date, p_charged boolean, p_charge_place text, p_charge_cost numeric, p_out time without)` D
- `vehicle_document_archive(p_id uuid, p_reason text)` D
- `vehicle_document_save(p_vehicle uuid, p_kind text, p_doc_no text, p_issued date, p_expires date, p_amount numeric, p_title text, p_n)` D
- `vehicle_history(p_vehicle uuid)` D
- `vehicle_hubs()` D
- `vehicle_list(p_hub uuid)`
- `vehicle_log_decide(p_id uuid, p_approve boolean, p_note text)` D
- `vehicle_log_list(p_vehicle uuid, p_from date, p_to date)` D
- `vehicle_log_remove(p_id uuid, p_reason text)` D
- `vehicle_log_save(p_vehicle uuid, p_kind text, p_amount numeric, p_date date, p_odometer integer, p_litres numeric, p_vendor tex)` D
- `vehicle_log_to_sheet(p_id uuid, p_hub uuid, p_date date)` D
- `vehicle_overview(p_hub uuid)` D
- `vehicle_pending(p_hub uuid)` D
- `vehicle_release(p_vehicle uuid, p_reason text, p_role text)` D
- `vehicle_report(p_from date, p_to date, p_hub uuid)` D
- `vehicle_request_list(p_hub uuid, p_vehicle uuid, p_open_only boolean)` D
- `vehicle_request_submit(p_vehicle uuid, p_kind text, p_title text, p_data jsonb, p_priority text, p_photo text)` D
- `vehicle_request_update(p_id uuid, p_status text, p_note text, p_cost numeric)` D
- `vehicle_requisition_list(p_hub uuid, p_from date, p_to date)` D
- `vehicle_requisition_submit(p_hub uuid, p_work_date date, p_job text, p_vehicle uuid, p_work_time text, p_from text, p_to text, p_parcels )` D
- `vehicle_requisition_update(p_id uuid, p_status text, p_note text, p_vehicle uuid, p_driver_code text)` D
- `vehicle_save(p_name text, p_code text, p_kind text, p_hub uuid, p_reg_no text, p_status text, p_remarks text, p_id uuid, p_)` D
- `vehicle_set_hubs(p_vehicle uuid, p_hubs uuid[])` D
- `vehicle_settings()` D
- `zm_dashboard(p_zone uuid, p_from date, p_to date)`
- `zm_data_completion(p_zone uuid, p_hub uuid)` D
- `zm_decide_claim(p_claim uuid, p_decision text, p_note text, p_voucher_no text)` D
- `zm_hub_performance(p_zone uuid, p_from date, p_to date)`
- `zm_log_export(p_report text, p_format text, p_filters jsonb)` D
- `zm_reopen_hub_metric(p_id uuid, p_reason text)` D
- `zm_report_employees(p_from date, p_to date, p_zone uuid, p_hub uuid)`
- `zm_report_operations(p_group text, p_from date, p_to date, p_zone uuid, p_hub uuid)`
- `zm_report_workforce(p_group text, p_from date, p_to date, p_zone uuid, p_hub uuid)`
- `zm_review_recommendation(p_id uuid, p_status text, p_note text)` D
- `zm_submit_claim(p_zone uuid, p_period_type text, p_from date, p_to date)` D
- `zm_task_accountability(p_from date, p_to date, p_zone uuid)` D
- `zm_verify_hub_metric(p_id uuid)` D
- `zm_visit_report(p_group text, p_from date, p_to date, p_zone uuid, p_visitor uuid)`
- `zm_workforce_details(p_stat text, p_zone uuid, p_from date, p_to date, p_hub uuid)`
- `zm_workforce_plan(p_zone uuid, p_from date, p_to date, p_save boolean)` D
