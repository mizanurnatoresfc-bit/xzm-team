# ৪. Database Migration Plan

**সাধারণ নিয়ম (বিদ্যমান `MIGRATIONS_LIVE_MAP.md` নিয়ম মেনে):** (১) Migration ফাইল আগে `supabase/migrations/`-এ (Unix line ending), (২) `scripts/test-db.sh` সবুজ, (৩) Staging-এ প্রয়োগ, (৪) Super Admin অনুমোদন, (৫) তবেই লাইভে **একই লেখা**। লাইভে ফাইল-ছাড়া SQL নয়। ফাইলের নাম `2026MMDDHHMMSS_sc_<বিষয়>.sql`।
**সব Migration শুধু যোগ করে (additive)।** কোনো `drop`, `delete`, `truncate`, বিদ্যমান টেবিলের কলাম মোছা/বদলানো নেই। প্রতিটি Migration-এ নিচে "রিগ্রেশন-স্ক্রিপ্ট" (শুধু নতুন `sc_` অবজেক্ট `drop` করে) থাকবে, যা Staging-এ পরীক্ষা হবে।

## ৪.১ পুনঃব্যবহার (নতুন তৈরি নয়)

| প্রয়োজন | বিদ্যমান | কীভাবে |
|---|---|---|
| Audit Log | `audit_logs`, `private.write_audit`, `private.audit_row` | নতুন `sc_` টেবিলে trigger; `module='system'`। কোনো নতুন audit টেবিল নয় |
| সেটিং | `system_settings` | নতুন key (যেমন `sc.retention_days`) — নতুন সেটিং-টেবিল নয় |
| অনুমতি | `permissions`, `roles`, `role_permissions`, `has_permission` | নতুন `system.*` পারমিশন-সারি; Super বাদে কাউকে ডিফল্ট নয় |
| Timezone | `system.timezone`, `private.setting_text`, `system_timezone_ok()` | সরাসরি |
| Notification | `notifications` | সতর্কতা এতে লেখা |
| মেনু | `menu_items`, `position_menu_access` (লাইভে আছে; রিপোতে আনার পর) | নতুন গ্রুপের আইটেম এতে |
| লগইন ইতিহাস | `login_events` | Security Center শুধু পড়ে |

## ৪.২ নতুন অবজেক্ট (সবই `sc_` উপসর্গ, সব RLS চালু, সরাসরি DML বন্ধ, RPC-only)

| ধাপ | Migration | টেবিল / ফাংশন | উদ্দেশ্য |
|---|---|---|---|
| M0 | `sc_00_repo_drift_sync` | কিছু নতুন নয়; **লাইভে ইতিমধ্যে থাকা** ছয়টি Migration ও `menu_items` ইত্যাদির সোর্স রিপোতে আনা (লাইভ থেকে `pg_get_functiondef`/স্কিমা-ডাম্প মিলিয়ে, লাইভে কিছু চালানো নয়) | A1 মেটানো — এটি ছাড়া কোনো নতুন কাজ নিরাপদ নয় |
| M1 | `sc_01_registry` | `sc_registry_items(id text pk, module, kind, slug, status, platform, risk, ai_exposable, desc_bn, desc_en, source_ref, replaced_by, created_at, updated_at)`, `sc_registry_edges(from_id, to_id, kind, confidence, declared_by)`; ফাংশন `sc_registry_sync()` (catalog→registry; শুধু-পড়া), `sc_registry_import(jsonb)` (কোড-ম্যানিফেস্ট), `sc_registry_impact(id)` | Master Function Registry + Dependency Map |
| M2 | `sc_02_features` | `sc_features(key, registry_id, enabled, platform, reason, changed_by, changed_at)`; `sc_feature_set(key,bool,reason)` (Dependency Check, প্রত্যাখ্যানসহ) | Feature on/off (P3-তে UI; টেবিল P1-এ প্রস্তুত) |
| M3 | `sc_03_errors` | `sc_error_events(id, occurred_at, user_id, platform, app_version, route, kind, message, stack, fingerprint, count, status, resolved_by, note)`; `sc_log_error(jsonb)` (ছাঁটাই+হারসীমা+dedupe), `sc_error_status_set()` | Error & Bug |
| M4 | `sc_04_health` | `sc_health_snapshots(id, taken_at, area, status, detail jsonb)`; `sc_health_run()` (শুধু catalog/`cron.job_run_details`/`pg_stat_*` পড়ে); cron `sc-health` (প্রতি ১৫ মিনিট — Staging-এ আগে) | System Health |
| M5 | `sc_05_perm_audit` | ফাংশন `sc_permission_audit()` (শুধু-পড়া রিপোর্ট; কিছু বদলায় না) | Permission Audit |
| M6 | `sc_06_permissions` | `permissions`-এ নতুন `system.*` সারি (২.৫); `role_permissions`: শুধু `super_admin` (বা Super-ফ্ল্যাগ যুক্তি) | অনুমতি |
| M7 | `sc_07_audit_coverage` | **প্রস্তাব, আলাদা অনুমোদন:** সংবেদনশীল audit-হীন টেবিলে `audit_row` trigger (`employee_sensitive`, `office_secrets`, `permissions`, `menu_items`, `position_menu_access`, `da_cash_payments`, `da_approval_rules`, `sorting_dispatches/_stops/_reports`, `wf_ops_decisions`, `wf_pending_approvals`, `zone_posts`, `hub_posts`)। এটি বিদ্যমান টেবিলে trigger যোগ — ডাটা বদলায় না, কিন্তু লেখার পথে অতিরিক্ত কাজ যোগ করে; তাই Staging-এ লোড-মাপসহ | A3 |
| M8 | `sc_08_test_runs` | `sc_test_cases`, `sc_test_runs(id, env, release_id, started_at, finished_at, passed, failed, detail)`; ফলাফল ঢোকানো: Edge Function `sc-ci-report` (HMAC-স্বাক্ষরিত, **Staging/CI → DB**) | DEMO Test Foundation |
| M9 | `sc_09_releases` | `sc_releases`, `sc_release_items`; `sc_release_approve()` (শর্ত ২.৮) | Release Manager (P3) |
| M10 | `sc_10_backups` | `sc_backups(id, taken_at, kind, size_bytes, checksum, location_ref, restore_tested_at, restore_tested_by)` | Backup রেকর্ড (P3) |
| M11 | `sc_11_integrations` | `sc_integrations(id, name, kind, edge_function, secret_names text[], last_ok_at, status)` — **মান নয়, নাম** | Integration (P3) |
| M12 | `sc_12_misc` | `sc_dev_tasks`, `sc_alert_rules` | P4 |

## ৪.৩ নিরাপত্তা-টেমপ্লেট (প্রতিটি নতুন টেবিল/ফাংশন)

```sql
-- টেবিল
alter table public.sc_x enable row level security;
create policy sc_x_read on public.sc_x for select to authenticated
  using (private.has_permission('system.<res>.view'));
-- কোনো insert/update/delete policy নেই: লেখা শুধু RPC দিয়ে
create trigger sc_x_audit after insert or update or delete on public.sc_x
  for each row execute function private.audit_row('system');
-- ফাংশন
create function public.sc_do(...) returns ... language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission('system.<res>.<act>') then raise exception 'অনুমতি নেই' using errcode='42501'; end if;
  ...
end $$;
revoke all on function public.sc_do(...) from public, anon;
grant execute on function public.sc_do(...) to authenticated;
```

SQL টেস্ট (বিদ্যমান ধরনে, `supabase/tests/99_sc_*.sql`): (১) অ-Super কেউ প্রতিটি `sc_*` RPC-তে `42501` পায়, (২) anon কিছুই পায় না, (৩) `sc_feature_set` নির্ভরশীল থাকলে প্রত্যাখ্যান, (৪) `sc_log_error` টোকেন/ইমেইল ছাঁটে ও হারসীমা মানে, (৫) কোনো `sc_*` RPC ব্যবসার টেবিলের সারি সংখ্যা বদলায় না (আগে/পরে গণনা), (৬) নতুন ফাংশন anon-executable নয় (A4-এর পুনরাবৃত্তি ঠেকাতে)।

## ৪.৪ Rollback

প্রতিটি Migration-এর জন্য `rollback/sc_NN_*.sql` (শুধু ওই Migration-এর নতুন `sc_` অবজেক্ট `drop`; ডাটা-বহনকারী টেবিলে রোলব্যাকের আগে `sc_backups`-এ রেকর্ড)। M6/M7 (বিদ্যমান টেবিলে স্পর্শ) এর রোলব্যাক শুধু trigger/permission-সারি সরায়।

## ৪.৫ লাইভে যা **কখনো** করা হবে না

কোনো ব্যবসায়িক টেবিলে `insert/update/delete/truncate`; বিদ্যমান ফাংশন-বডি বদল; বিদ্যমান policy বদল; `audit_logs`-এ কিছু; কোনো Restore/Seed লাইভে।
