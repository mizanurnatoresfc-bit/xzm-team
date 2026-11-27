# COMPANY_RULES

> XZM TEAM business rules, approval flows ও isolation। Source: Project memory + CLAUD.txt।

---

## 1. Development Rules (from CLAUD.txt)

1. Implementation-এর আগে existing functionality পরীক্ষা।
2. Approved Task ID ও requirement অনুসরণ।
3. অপ্রয়োজনীয় duplicate module তৈরি নয়।
4. Approval ছাড়া existing functionality সরানো নয়।
5. Owner approval ছাড়া production পরিবর্তন নয়।
6. Credentials/tokens/secrets কখনো expose নয়।
7. DB security, RLS, role permission রক্ষা।
8. Hub-level data isolation যাচাই।
9. Web + Android compatibility চিন্তা।
10. Asia/Dhaka timezone।
11. DEMO Hub বা isolated test env-এ test।
12. Backup ও rollback plan।
13. Test evidence ছাড়া completion claim নয়।
14. Blockers/assumption/unverified finding report।
15. Approved task ছাড়া business rule পরিবর্তন নয়।
16. ERP branding শুধু approved task-এ সরানো।
17. "সর্টিং সেন্টার" নাম consistently ব্যবহার।

## 2. Role Hierarchy

- **Zonal Manager** — full scope, hub-manager permission toggles (`can_add_route` ইত্যাদি)।
- **Hub Manager** — শুধু নিজ hub-এর running staff।
- **Accounts Center Manager** — হিসাব কেন্দ্র-এর 7-step flow।
- **Staff / Driver / Rider / Helper** — designation-ভিত্তিক dashboard।

## 3. Hub Isolation

- Hub Manager-এর view শুধু নিজ hub-এর Active staff।
- Zonal Manager সব Active / Transferred / Inactive দেখেন।
- Hub switcher একমাত্র global header-এ।

## 4. Attendance

- পৃথক leave application নেই।
- কোনো দিনে attendance click না পড়লে কর্মী ওই দিনের জন্য **report with reason** দেন।
- WorkforceHub (`/app/workforce/hub`) master; হিসাব এখান থেকেই।

## 5. Expense & Approval Flow

- কর্মী নিজ খরচ submit করেন।
- Manager approval না পেলে count হয় না।
- Approval limit configurable — zonal panel-এ সেট।
- Driver + সকল staff-এর ক্ষেত্রে একই model।
- Approved expense → Accounts panel → কর্মীর নিজ খাতা (khata)।

## 6. Accounts Center (হিসাব কেন্দ্র) — 7-Step Linear Day Flow

1. Rider hisab (delivery · tk · approval · submit)
2. Hub expense submit
3. Staff expense approval + submit
4. Merchant cash payment submit
5. Create daily report
6. Bank amount submit
7. Day close — all vouchers, top sheet, bank slips one date-folder-এ।

## 7. Staff Entry Terminology

- **ডেলিভারি টাকা** = delivery-তে customer থেকে collected cash (per-staff daily)।
- **মার্চেন্টে জমা** = সেই টাকা merchant-কে payout — আলাদা পরবর্তী step।
- দুটো **একই field নয়**।

## 8. Rider Commission

- Structure: **Basic (monthly fixed) + per-parcel rate**।
- Command Center "research center" (closed loop)।
- Commission numbers **auto-push হয় না** daily accounts, rider hisab বা হিসাব কেন্দ্র-এ।

## 9. HR Status Model

Status options: **Active / Resigned / Terminated / Transferred (hub-to-hub) / On Leave**।

Hub manager one-click submission → system auto-generates company-format file (staff info + join-leave date + reason + final accounts) → HR Records-এ archive।

## 10. Auto (Vehicle) Rules

- "Auto" = electric vehicle name।
- Battery charge at hub = electricity cost।
- Battery charge at garage = per-day garage bill।
- Parts request + repair request = zonal panel-এর format।
- Garage bill fixed, request-format-এ handled।

## 11. Append-Only Audit

- All `da_*` tables: `private.prevent_delete`, `private.da_append_only`।
- Route assignment history → একই append-only pattern।
- Wipe করতে SQL editor-এ triggers disable লাগবে।

## 12. Data Entry Principle

- "One task, one page" — same work multiple page-এ আর নয়।
- Duplicate pages consolidated (staff, attendance done; route structure already clean)।

## 13. Documentation & Code Flow

- Claude: Frontend / UI-UX / integration design।
- ChatGPT Backend Team: Backend changes লিখিত Contract/Requirement Report-এ।
- No unrelated changes mixed in single task।
