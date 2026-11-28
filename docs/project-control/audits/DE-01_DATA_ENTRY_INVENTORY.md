# DE-01 — ডাটা এন্ট্রি ইনভেন্টরি ও ইন্টিগ্রেশন যাচাই

যাচাইয়ের তারিখ ২০২৬-১১-২৮ (Asia/Dhaka)। [PR #207](https://github.com/mizanurnatoresfc-bit/xzm-team/pull/207), original head `be83e42`, current main `6831f29`, GitHub test merge `61a7859`। Main-এর আগের base `2836a07` থেকে দুই পাশের পরিবর্তন আলাদা পাথে ছিল। পরীক্ষামূলক মার্জে মূল শাখা থেকে শুধু PR-এর ২১টি পাথ বদলেছে। উভয় পাশের একক পরিবর্তন blob hash দিয়ে মিলেছে।

## মডিউলের বর্তমান অবস্থা

| অংশ | main `6831f29` | PR #207-এর ইন্টিগ্রেশন |
| --- | --- | --- |
| Frontend | বিদ্যমান Staff Panel, Operations Collection এবং মেনু/অ্যাক্সেস ব্যবস্থা | `/app/data-entry/{live,team,targets,reports,updates,performance}`। `DataEntryTeam.tsx` জোন ও টিম, `DataEntryShift.tsx` শিফট, রিপোর্ট ও হেড, `DataEntryTargets.tsx` টার্গেট এবং ইনপুট। `AppShell`, `navAccess`, Access Catalog, Menu Editor ও Role Menu Matrix-এ সংযোগ। |
| Staff Panel | চালু স্টাফ প্যানেল। `DailyOpsCard` থেকে পিকআপ, পিকআপ ফেরত, ডেলিভারি ও ডেলিভারি ফেরতের সংখ্যা যোগ হয়। | নিজের অনুমোদিত হাবের টার্গেট ও হিসাবের ব্যাখ্যা, সর্বোচ্চ তিনটি সঞ্চিত শিফট চেক-ইন, দায়িত্ব সম্পন্ন চিহ্ন, জোনাল ম্যানেজারকে ব্যক্তিগত সহকর্মী আপডেট। মনোনীত হেডের দায়িত্ব দেওয়া ও রিপোর্ট যাচাইয়ের আলাদা অনুমতি। |
| Zonal Panel | বিদ্যমান `OperationsCollection.tsx`-এ হাবভিত্তিক দৈনিক অপারেশন। | লাইভ কন্ট্রোল, টিম ও দায়িত্ব, টার্গেট ও কাজ বণ্টন, দৈনিক রিপোর্ট, কর্মীদের আপডেট এবং পারফরম্যান্স/লিডারবোর্ড। হাবভিত্তিক শিফট, opening history, উপস্থিতি সমন্বয়, দৈনিক সীমা, রিপোর্ট রিভিউ ও ঐচ্ছিক হেড। জোনভিত্তিক `data_entry.team.edit` দিয়ে নিয়ন্ত্রণ। |
| Backend | Operations-এর `ops_pickup_groups` এবং `ops_{submit,verify,approve,reject,withdraw,void}_pickup`। HR ও Workforce হাজিরা ও ছুটির তথ্য। | Supabase RPC দিয়ে টিম, শিফট ও টার্গেট। অনুমোদিত পিকআপ, হাজিরা, ছুটি, যাচাইকৃত সক্ষমতা ও অতিরিক্ত দায়িত্ব থেকে বণ্টন। যাচাইকৃত কাজ সংরক্ষণ করে পুনর্বণ্টন, সংশোধনের ইতিহাস, অপরিবর্তিত ইনপুটে পুনরায় গণনার ফল স্থির। |
| Database | `employees`, `hubs`, `zones`, `pickup_submissions`, `pickup_consolidations` সহ `merchants`, `parcels`, `wf_daily_ops` এবং অডিট | টিম, স্মার্ট টার্গেট ও সন্ধ্যার workflow-র তিনটি migration। Asia/Dhaka শিফট, মধ্যরাত পেরোলেও শিফট শুরুর তারিখ, এবং pg_cron পাওয়া গেলে প্রতি মিনিটে `data-entry-smart-targets`। |

## RPC ও অভ্যন্তরীণ ফাংশন

প্রতিটি নামের শুরুতে `data_entry_` আছে।

| Schema | ক্ষেত্র | ফাংশন |
| --- | --- | --- |
| public | টিম | `team_zones`, `team_snapshot`, `team_candidates`, `team_save` |
| public | টার্গেট | `target_admin`, `target_save`, `target_mine` |
| public | শিফট | `shift_control`, `shift_mine`, `shift_action` |
| private | টার্গেট সহ `merchants`, `parcels`, `wf_daily_ops` এবং অডিট | `target_team`, `target_split`, `target_snapshot`, `target_refresh`, `target_tick`, `target_require_zone`, `target_input_audit` |
| private | শিফট ও অ্যাক্সেস | `shift_now`, `shift_window`, `shift_ready`, `report_due`, `is_zone_owner`, `head_eligible`, `owner_or_head`, `my_member`, `head_payload` |

## Database tables

প্রতিটি নামের শুরুতে `data_entry_` আছে।

| Migration | Schema | Tables |
| --- | --- | --- |
| `20261127134000_data_entry_team.sql` | public | `team_members`, `hub_assignments` |
| `20261127170000_data_entry_smart_targets.sql` | private | `shift_reports`, `extra_duties`, `shift_availability`, `target_limits`, `shift_settings`, `seed_pickups`, `target_hubs`, `target_rules`, `target_observations`, `performance_profile`, `target_complexity`, `target_runs` |
| `20261127190000_data_entry_evening_workflow.sql` | private | `heads`, `peer_updates` |

ওয়ার্কফ্লোর বিবরণ [Data Entry Evening Workflow](../../DATA_ENTRY_EVENING_WORKFLOW.md)-এ। Hosted DEMO login, staging scheduler ও Android device যাচাই পরবর্তী release কাজের আওতায়।
