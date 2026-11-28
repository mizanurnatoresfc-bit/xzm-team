# REPORT_FORMATS

> কোম্পানির নির্ধারিত Excel-ভিত্তিক report format catalogue। প্রাথমিক seed; প্রকৃত column list owner approval ও backend contract-এর সাথে আসবে।

---

## 1. General Principles

- All reports exported/imported as **Excel (.xlsx / .xls)**।
- Column format **Zonal Manager** নির্ধারণ করেন।
- Report generation hub-wise ও date-wise।
- Timezone: Asia/Dhaka।
- Numbering/currency: Bangladeshi Taka (৳)।

## 2. Report Catalogue

### 2.1 Rider Hisab Daily Report
- **Scope:** per rider, per day।
- **Columns (PENDING VERIFICATION):** date, rider name, hub, delivery count, delivery টাকা, merchant জমা, cash on hand, remarks।
- **Trigger:** হিসাব কেন্দ্র step 1।

### 2.2 Hub Expense Report
- **Scope:** per hub, per day।
- **Columns (PENDING VERIFICATION):** date, hub, expense category, amount, approver, voucher ref।

### 2.3 Staff Expense Report
- **Scope:** per staff, per day/month।
- **Columns (PENDING VERIFICATION):** date, staff, designation, item, amount, status (pending/approved/rejected), approver।

### 2.4 Merchant Cash Payment Report
- **Scope:** per merchant, per date।
- **Columns (PENDING VERIFICATION):** date, merchant, amount, mode (cash/MFS), reference।

### 2.5 Daily Report (হিসাব কেন্দ্র step 5)
- **Scope:** hub-wise daily summary।
- **Columns (PENDING VERIFICATION):** date, hub, total delivery, total টাকা, total expense, net, closing bank।

### 2.6 Bank Amount Report
- **Scope:** per hub, per day।
- **Columns (PENDING VERIFICATION):** date, hub, bank name, slip no, amount।

### 2.7 Day Close Package
- **Scope:** per hub, per date।
- **Content:** vouchers + top sheet + bank slips — এক date-folder-এ।

### 2.8 HR Status Change File (auto-generated)
- **Scope:** per staff event।
- **Columns:** staff info + join date + leave date + reason + final accounts।
- **Trigger:** hub manager one-click status change।

### 2.9 Route Day Plan (NODI AI)
- **Storage:** `route_day_plans.ai_plan` (jsonb)।
- **Columns (planned):** route, parcel count, assigned riders, suggested surge support, AI confidence।

### 2.10 Debtor-Creditor (দেনা-পাওয়া) Reports
- **Source:** uploaded bKash/Nagad/Rocket statements।
- **View:** date-wise + per-profile ledger across all MFS।
- **PENDING VERIFICATION:** exact column schema।

## 3. Zonal Operation Research Reports (Command Center)

- Staff duties snapshot
- Hub capacity input
- Rider commission computation
- Route & hub planning summary
- All closed-loop — no push to daily accounts।

## 4. Report Approval Chain

Report generation → Hub Manager verify → Zonal Manager approve → Archive।

## 5. Open Items

- প্রতিটি report-এর final Excel column list owner থেকে নিতে হবে।
- Multi-hub consolidated report format PENDING।
- NODI AI generated report-এর human-review workflow PENDING।
