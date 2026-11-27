// অফিস অপারেশন: the lease and the month's bills (with what the hub's daily accounts already hold), the power the listed
// devices should use, items lent to another place, who lives in a residence, logins and locks, and the
// "নষ্ট / লাগবে" reports that go to the zonal manager. Money and reports are written through database functions.
import { supabase } from './supabase'
import type { Asset, Property } from './office'

function fail(error: { message: string; code?: string } | null): void {
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
}
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args); fail(error); return data as T
}

export type BillKind = 'rent' | 'electricity' | 'wifi' | 'water' | 'gas' | 'other'
export type Bill = { id: string; property_id: string; kind: BillKind; bill_month: string; amount: number; paid_on: string | null; method: string | null
  txn_id: string | null; payee: string | null; payee_phone: string | null; units: number | null; has_memo: boolean; memo_file: string | null
  memo_no: string | null; proof_file: string | null; da_expense_id: string | null; note: string | null; created_by_name: string | null; created_at: string }
export type BillMore = { paid_on?: string; method?: string; txn_id?: string; payee?: string; payee_phone?: string; units?: string; has_memo?: boolean
  memo_file?: string | null; proof_file?: string | null; da_expense_id?: string | null; note?: string }
export type ExpenseLine = { id: string; account_date: string; bill_date: string; kind: BillKind; category: string; expense_name: string; amount: number
  bill_no: string | null; voucher_no: string | null; has_file: boolean; sheet_status: string; bill_id: string | null }
export type Loan = { id: string; asset_id: string; asset_kind: string; asset_name: string; quantity: number; since: string; note: string | null; returned_at: string | null
  from_property_id: string; from_name: string; from_hub_id: string | null; to_property_id: string; to_name: string; to_hub_id: string | null; can_return: boolean
  /** The hub that gave / took, and the optional person on each side. */
  from_hub_name: string | null; to_hub_name: string | null; from_person: string | null; to_person: string | null }
export type Resident = { id: string; property_id: string; room_id: string | null; employee_id: string; since: string; note: string | null }
export type SecretKind = 'cctv' | 'dvr' | 'router' | 'wifi' | 'pc' | 'other'
export type Secret = { id: string; property_id: string; asset_id: string | null; kind: SecretKind; label: string; username: string | null; secret: string | null; note: string | null }
export type NoticeKind = 'broken' | 'need' | 'other'
export type Notice = { id: string; notice_no: string; property_id: string; zone_id: string; hub_id: string | null; asset_id: string | null; kind: NoticeKind
  item_kind: string | null; title: string; quantity: number; note: string | null; priority: 'normal' | 'urgent'; status: 'open' | 'seen' | 'done' | 'rejected'
  reply: string | null; decided_by_name: string | null; decided_at: string | null; by_name: string | null; created_at: string
  /** The hub manager who checked the report (null = not verified yet). */
  hub_verified_by_name: string | null; hub_verified_at: string | null; hub_verify_note: string | null }
export type HubVehicle = { id: string; name: string; reg_no: string | null; kind: string; status: string; hub_id: string | null; hub_name: string | null
  crew: Array<{ role: 'driver' | 'helper'; name: string; code: string | null; mobile: string | null }> }

export const BILL_KIND: Record<BillKind, [string, string, string]> = {
  rent: ['ভাড়া', 'Rent', 'home'], electricity: ['বিদ্যুৎ বিল', 'Electricity', 'sun'], wifi: ['ওয়াইফাই বিল', 'Wifi', 'globe'],
  water: ['পানির বিল', 'Water', 'receipt'], gas: ['গ্যাস বিল', 'Gas', 'a_stove'], other: ['অন্য বিল', 'Other', 'receipt'],
}
export const METHOD: Record<string, [string, string]> = {
  cash: ['নগদ', 'Cash'], bkash: ['বিকাশ', 'bKash'], nagad: ['নগদ (Nagad)', 'Nagad'], rocket: ['রকেট', 'Rocket'], bank: ['ব্যাংক', 'Bank'], other: ['অন্য', 'Other'],
}
export const SECRET_KIND: Record<SecretKind, [string, string]> = {
  cctv: ['সিসি ক্যামেরা', 'CCTV'], dvr: ['DVR / NVR', 'DVR / NVR'], router: ['রাউটার', 'Router'], wifi: ['ওয়াইফাই', 'Wifi'], pc: ['পিসির লক', 'PC lock'], other: ['অন্যান্য', 'Other'],
}
export const NOTICE_KIND: Record<NoticeKind, [string, string, 'bad' | 'warn' | 'info']> = {
  broken: ['নষ্ট হয়েছে', 'Broken', 'bad'], need: ['লাগবে', 'Needed', 'warn'], other: ['অন্য', 'Other', 'info'],
}
export const NOTICE_STATUS: Record<Notice['status'], [string, string, 'ok' | 'warn' | 'bad' | 'info']> = {
  open: ['অপেক্ষায়', 'Waiting', 'warn'], seen: ['দেখা হয়েছে', 'Seen', 'info'], done: ['ব্যবস্থা হয়েছে', 'Done', 'ok'], rejected: ['হবে না', 'Declined', 'bad'],
}

// ---------------------------------------------------------------- power: what the listed devices should use
/** Usual watt and hours a day for a kind, used when the item itself says nothing. */
export const POWER: Record<string, [number, number]> = {
  light: [20, 10], fan: [75, 12], pc: [150, 10], monitor: [30, 10], laptop: [60, 8], printer: [40, 2], ups: [25, 24], router: [10, 24],
  scanner: [10, 2], ac: [1500, 6], cctv: [8, 24], dvr: [20, 24], ip_phone: [5, 24], mobile: [10, 3], weight_machine: [10, 4],
}
/** ৳ per unit when the place has no rate of its own. An assumption: the real slab is on the bill. */
export const DEFAULT_RATE = 11
export const isElectric = (a: Asset) => a.watt != null || a.kind in POWER
export type PowerRow = { asset: Asset; watt: number; hours: number; guessed: boolean; units: number }
/** Units (kWh) a month for each electric item in working order. */
export function powerRows(assets: Asset[]): PowerRow[] {
  return assets.filter(a => isElectric(a) && a.condition !== 'broken' && a.condition !== 'lost').map(a => {
    const d = POWER[a.kind] ?? [0, 0]
    const watt = a.watt ?? d[0]; const hours = a.hours_per_day ?? d[1]
    return { asset: a, watt, hours, guessed: a.watt == null || a.hours_per_day == null, units: a.quantity * watt * hours * 30 / 1000 }
  }).sort((x, y) => y.units - x.units)
}
export type Tip = { text: string; save?: number; tone: 'info' | 'warn' | 'bad' }
/** Ways to bring the bill down, worked out from the list itself (no AI needed). `save` = units a month. */
export function powerTips(rows: PowerRow[], rate: number, lastBill: number | null, lastUnits: number | null): Tip[] {
  const tips: Tip[] = []
  const total = rows.reduce((s, r) => s + r.units, 0)
  const est = total * rate
  const sum = (f: (r: PowerRow) => boolean, g: (r: PowerRow) => number) => rows.filter(f).reduce((s, r) => s + g(r), 0)
  const oldLights = sum(r => r.asset.kind === 'light' && r.watt > 25, r => r.asset.quantity * (r.watt - 12) * r.hours * 30 / 1000)
  if (oldLights > 1) tips.push({ tone: 'warn', save: oldLights, text: 'পুরোনো বাল্ব/টিউব বদলে ১২ ওয়াটের LED দিন' })
  const fans = sum(r => r.asset.kind === 'fan' && r.watt >= 70, r => r.asset.quantity * (r.watt - 35) * r.hours * 30 / 1000)
  if (fans > 5) tips.push({ tone: 'info', save: fans, text: 'ফ্যান বদলানোর সময় এলে BLDC (৩০–৩৫ ওয়াট) ফ্যান নিন — সাধারণ ফ্যানের অর্ধেক বিদ্যুৎ' })
  const pcLong = sum(r => (r.asset.kind === 'pc' || r.asset.kind === 'monitor') && r.hours > 10, r => r.asset.quantity * r.watt * (r.hours - 10) * 30 / 1000)
  if (pcLong > 1) tips.push({ tone: 'warn', save: pcLong, text: 'পিসি ও মনিটর দিনে ১০ ঘণ্টার বেশি চলছে — কাজ শেষে বন্ধ, আর ১০ মিনিটে স্লিপ মোড চালু করুন' })
  const pcs = sum(r => r.asset.kind === 'pc' || r.asset.kind === 'monitor', r => r.units * 0.15)
  if (pcs > 2 && !pcLong) tips.push({ tone: 'info', save: pcs, text: 'পিসিতে স্লিপ মোড ও মনিটরের ব্রাইটনেস কমালে প্রায় ১৫% কম লাগে' })
  const ac = sum(r => r.asset.kind === 'ac', r => r.units * 0.2)
  if (ac > 0) tips.push({ tone: 'warn', save: ac, text: 'এসি ২৫–২৬°C-তে রাখুন, দরজা-জানালা বন্ধ রাখুন, মাসে একবার ফিল্টার পরিষ্কার করুন' })
  const lightsLong = sum(r => r.asset.kind === 'light' && r.hours > 12, r => r.asset.quantity * r.watt * (r.hours - 12) * 30 / 1000)
  if (lightsLong > 1) tips.push({ tone: 'info', save: lightsLong, text: 'দিনের বেলা জানালার আলো ব্যবহার করুন; খালি রুমের লাইট-ফ্যান বন্ধ রাখার দায়িত্ব একজনকে দিন' })
  const top = rows[0]
  if (top && total > 0 && top.units / total > 0.4) tips.push({ tone: 'info', text: `মোট বিদ্যুতের ${Math.round(top.units / total * 100)}% যাচ্ছে "${top.asset.name}"-এ — এখানে কমালেই বিল সবচেয়ে বেশি কমবে` })
  if (lastBill != null && est > 0) {
    if (lastBill > est * 1.3) tips.push({ tone: 'bad', text: 'আসল বিল হিসাবের চেয়ে ৩০%-এর বেশি — সব ডিভাইস লেখা হয়েছে কি দেখুন; না হলে মিটার, লাইন বা পাশের সংযোগ চেক করান' })
    else if (lastBill < est * 0.6) tips.push({ tone: 'info', text: 'আসল বিল হিসাবের চেয়ে অনেক কম — ঘণ্টা বা ওয়াট বেশি ধরা হয়েছে, ঠিক করে নিন' })
  }
  if (lastBill != null && lastUnits) tips.push({ tone: 'info', text: `গত বিলে প্রতি ইউনিট পড়েছে ৳${(lastBill / lastUnits).toFixed(2)} — এই রেটটা "ইউনিট রেট"-এ বসালে হিসাব আরও মিলবে` })
  if (rows.some(r => r.guessed)) tips.push({ tone: 'info', text: 'কিছু ডিভাইসের ওয়াট/ঘণ্টা লেখা নেই — সাধারণ মান ধরা হয়েছে। লিখে দিলে হিসাব ঠিক হবে' })
  return tips
}

// ---------------------------------------------------------------- the lease
export const daysLeft = (d: string | null) => d ? Math.round((new Date(d + 'T00:00:00').getTime() - new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' }) + 'T00:00:00').getTime()) / 86400000) : null
const bnDigits = (s: string | number) => String(s).replace(/[0-9]/g, d => '০১২৩৪৫৬৭৮৯'[Number(d)])
const dmy = (d: string | null | undefined) => d ? bnDigits(d.split('-').reverse().join('/')) : '..............'
/** A plain rental agreement filled from the place's data. A starting draft: it must be read and agreed by both sides. */
export function contractDraft(p: Property, hubName: string | null, rooms: { office: number; living: number; other: number }, from: string, to: string, rent: number | null, advance: number | null): string {
  const use = p.kind === 'residence' ? 'কর্মীদের আবাসিক ব্যবহার' : p.kind === 'office' ? 'কুরিয়ার অফিস / হাব পরিচালনা' : 'গাড়ি রাখা ও চার্জ দেওয়া'
  const tk = (n: number | null) => n ? `${bnDigits(n.toLocaleString('en-US'))} টাকা` : '.............. টাকা'
  return `বাড়ি / ঘর ভাড়ার চুক্তিপত্র

প্রথম পক্ষ (মালিক): ${p.owner_name || '..............'}, মোবাইল: ${p.owner_phone ? bnDigits(p.owner_phone) : '..............'}
দ্বিতীয় পক্ষ (ভাড়াটিয়া): XZM TEAM${hubName ? ` — ${hubName}` : ''}

ভাড়ার জায়গা: ${p.address || '..............'}${p.floor_note ? `, ${p.floor_note}` : ''}
বিবরণ: অফিস রুম ${bnDigits(rooms.office)}টি, থাকার রুম ${bnDigits(rooms.living)}টি, অন্যান্য (রান্নাঘর, বাথরুম, গ্যারেজ, স্টোর) ${bnDigits(rooms.other)}টি।
ব্যবহার: ${use}।

শর্তাবলি
১. মেয়াদ: ${dmy(from)} থেকে ${dmy(to)} পর্যন্ত। মেয়াদ শেষে দুই পক্ষের সম্মতিতে নবায়ন করা যাবে।
২. মাসিক ভাড়া: ${tk(rent)}। প্রতি মাসের ${p.rent_due_day ? bnDigits(p.rent_due_day) : '....'} তারিখের মধ্যে পরিশোধ করা হবে; মালিক প্রতিবার রসিদ / মেমো দেবেন।
৩. অগ্রিম (এডভান্স): ${tk(advance)}। চুক্তি শেষে জায়গা বুঝিয়ে দেওয়ার পর বকেয়া সমন্বয় করে বাকি টাকা ফেরত দেওয়া হবে।
৪. বিদ্যুৎ বিল (মিটার নং ${p.meter_no ? bnDigits(p.meter_no) : '..............'}), ইন্টারনেট ও অন্যান্য ব্যবহারের বিল দ্বিতীয় পক্ষ দেবে। পৌর কর / জমির খাজনা প্রথম পক্ষ দেবেন।
৫. দ্বিতীয় পক্ষ জায়গাটি যত্নে রাখবে; মালিকের লিখিত সম্মতি ছাড়া কাঠামোগত পরিবর্তন বা অন্যকে ভাড়া দেওয়া যাবে না।
৬. বড় মেরামত (ছাদ, পানির লাইন, বৈদ্যুতিক মূল লাইন) প্রথম পক্ষ করবেন; দৈনন্দিন ছোট মেরামত দ্বিতীয় পক্ষ করবে।
৭. যেকোনো পক্ষ চুক্তি শেষ করতে চাইলে অন্তত ২ (দুই) মাস আগে লিখিতভাবে জানাবেন।
৮. ভাড়া বাড়াতে হলে মেয়াদ শেষে, দুই পক্ষের আলোচনায় ঠিক হবে।

প্রথম পক্ষের স্বাক্ষর: ....................        দ্বিতীয় পক্ষের স্বাক্ষর: ....................
সাক্ষী ১: ....................                    সাক্ষী ২: ....................
তারিখ: ....................`
}

const esc = (s: unknown) => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!))
/** Shows HTML in the browser's print window (Save as PDF works there too) — the same print box the lists use. */
export function printHtml(title: string, html: string) {
  const box = document.createElement('div'); box.id = 'print-box'; box.innerHTML = html
  const host = document.querySelector('.app-main') ?? document.body
  host.appendChild(box); document.body.classList.add('print-list')
  const old = document.title; document.title = title
  const done = () => { box.remove(); document.body.classList.remove('print-list'); document.title = old; window.removeEventListener('afterprint', done) }
  window.addEventListener('afterprint', done)
  setTimeout(() => window.print(), 50)
}
export const printText = (title: string, text: string) =>
  printHtml(title, `<div style="white-space:pre-wrap;font-size:13px;line-height:1.7;padding:10px 6px">${esc(text)}</div>`)

/** The office's own memo for a bill that came without one: office copy and payee copy. */
export function memoHtml(b: Bill, p: Property, hubName: string | null, words: string): string {
  const month = new Date(b.bill_month + 'T00:00:00').toLocaleDateString('bn-BD', { month: 'long', year: 'numeric' })
  const row = (a: string, v: string) => `<tr><th>${a}</th><td>${v}</td></tr>`
  const amount = '৳ ' + bnDigits(Number(b.amount).toLocaleString('en-US', { minimumFractionDigits: 2 }))
  const copy = (label: string) => `<div class="vch">
    <div class="vch-head"><div><b>XZM TEAM</b><div class="s">${esc(hubName ?? '')}${hubName ? ' · ' : ''}${esc(p.name)}</div></div>
      <div class="r"><b>${esc(BILL_KIND[b.kind][0])} — মেমো</b><div class="s">${label}</div></div></div>
    <table class="vch-t">
      ${row('মেমো নম্বর', `<b>${esc(b.memo_no ?? '—')}</b>`)}
      ${row('কোন মাসের', esc(month))}
      ${row('কী বাবদ', `${esc(BILL_KIND[b.kind][0])} — ${esc(p.name)}${p.address ? `<div class="s">${esc(p.address)}</div>` : ''}`)}
      ${b.kind === 'electricity' ? row('মিটার / ইউনিট', `${esc(p.meter_no ?? '—')}${b.units ? ` · ${bnDigits(b.units)} ইউনিট` : ''}`) : ''}
      ${row('টাকার পরিমাণ', `<b>${amount}</b><div class="s">কথায়: ${esc(words)}</div>`)}
      ${row('যিনি পেয়েছেন', `${esc(b.payee ?? (b.kind === 'rent' ? p.owner_name : null) ?? '—')}${(b.payee_phone ?? (b.kind === 'rent' ? p.owner_phone : null)) ? ` · ${esc(bnDigits(b.payee_phone ?? p.owner_phone ?? ''))}` : ''}`)}
      ${row('কীভাবে দেওয়া', `${esc(b.method ? METHOD[b.method]?.[0] ?? b.method : '—')}${b.txn_id ? ` · TrxID ${esc(b.txn_id)}` : ''}${b.paid_on ? ` · ${dmy(b.paid_on)}` : ''}`)}
      ${row('মন্তব্য', esc(b.note ?? '—'))}
    </table>
    <p class="s">পক্ষের কাছ থেকে কোনো মেমো / রসিদ পাওয়া যায়নি বলে প্রতিষ্ঠানের নিজের এই মেমো করা হলো।${b.proof_file ? ' পেমেন্টের স্ক্রিনশট সিস্টেমে রাখা আছে।' : ''} লিখেছেন ${esc(b.created_by_name ?? '')}</p>
    <div class="vch-sign"><div>যিনি টাকা পেয়েছেন</div><div>যিনি টাকা দিয়েছেন</div><div>হাব ইনচার্জ</div><div>হিসাব বিভাগ</div></div></div>`
  return `<style>
    #print-box .vch{border:1px solid #333;padding:14px;margin-bottom:16px;font-size:12px}
    #print-box .vch-head{display:flex;justify-content:space-between;border-bottom:1px solid #333;padding-bottom:6px;margin-bottom:8px}
    #print-box .vch-head .r{text-align:right}#print-box .vch .s{font-size:10px;color:#444}
    #print-box table.vch-t{width:100%;border-collapse:collapse;margin-bottom:8px}#print-box table.vch-t th{width:150px;text-align:left;background:#f1f1f1}
    #print-box .vch-sign{display:flex;gap:16px;margin-top:34px}#print-box .vch-sign div{flex:1;border-top:1px dotted #333;padding-top:4px;text-align:center;font-size:10px}
  </style>${copy('অফিস কপি')}${copy('পক্ষের কপি')}`
}

const BN: Array<[RegExp, string]> = [
  [/Could not find the (function|table)|PGRST20[25]|office_(bills|notices|secrets|residents|asset_loans)|function public\.office_\w+.*does not exist|column .* does not exist|schema cache/i,
    'অফিস অপারেশনের নতুন অংশ ডাটাবেসে এখনো বসানো হয়নি — বসানো হলে এই পাতা চালু হবে'],
  [/office_bill_electricity_proof/i, 'বিদ্যুৎ বিলে মোবাইল ব্যাংকিংয়ের স্ক্রিনশট দিতে হবে'],
  // water / gas before migration 20261121000100 is on the database
  [/office_bills_kind_check|বিলের ধরন ঠিক নয়/i, 'পানি / গ্যাস বিল ডাটাবেসে এখনো চালু হয়নি — হেড অফিসকে জানান'],
  [/office_residents_once|duplicate key/i, 'এটা আগেই লেখা আছে'],
  [/row-level security|42501|permission denied/i, 'এই কাজের অনুমতি আপনার নেই'],
  [/Bucket not found/i, 'ছবি রাখার জায়গা (office-docs) এখনো তৈরি হয়নি'],
]
export const opsFriendly = (e: unknown) => {
  const m = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)
  return BN.find(([re]) => re.test(m))?.[1] ?? m
}

export type AiTask = 'contract' | 'power' | 'insight'

export const ops = {
  // every place the person may see, with all its items — for the zone picture
  allAssets: async () => {
    const { data, error } = await supabase.from('office_assets').select('*').is('archived_at', null); fail(error); return (data ?? []) as Asset[]
  },
  bills: async (property: string) => {
    const { data, error } = await supabase.from('office_bills').select('*').eq('property_id', property).is('archived_at', null).order('bill_month', { ascending: false }).limit(120); fail(error)
    return (data ?? []) as Bill[]
  },
  billSave: (property: string, kind: BillKind, month: string, amount: number, more: BillMore, id?: string | null) =>
    rpc<{ id: string; memo_no: string | null }>('office_bill_save', { p_property: property, p_kind: kind, p_month: month, p_amount: amount, p_more: more, p_id: id ?? null }),
  billRemove: (id: string, reason: string) => rpc<void>('office_bill_remove', { p_id: id, p_reason: reason }),
  expenseLines: (property: string, from: string, to: string) => rpc<ExpenseLine[]>('office_expense_lines', { p_property: property, p_from: from, p_to: to }),
  loans: () => rpc<Loan[]>('office_loan_list', { p_open_only: true }),
  lend: (asset: string, to: string, qty: number, note: string | null, fromPerson: string | null = null, toPerson: string | null = null) =>
    rpc<string>('office_lend', { p_asset: asset, p_to: to, p_quantity: qty, p_note: note, p_from_person: fromPerson, p_to_person: toPerson }),
  lendReturn: (loan: string, note: string | null) => rpc<void>('office_lend_return', { p_loan: loan, p_note: note }),
  residents: async (property: string) => {
    const { data, error } = await supabase.from('office_residents').select('*').eq('property_id', property).is('archived_at', null).order('since'); fail(error)
    return (data ?? []) as Resident[]
  },
  /** Everyone living in the given places, in one call (row-level security still decides what comes back). */
  residentsOf: async (properties: string[]) => {
    if (!properties.length) return [] as Resident[]
    // A long id list would make the address too long: past 100 places, read everything the person may see and keep the ones asked for.
    let q = supabase.from('office_residents').select('*').is('archived_at', null)
    if (properties.length <= 100) q = q.in('property_id', properties)
    const { data, error } = await q; fail(error)
    const want = new Set(properties); return ((data ?? []) as Resident[]).filter(r => want.has(r.property_id))
  },
  /** The bills of one month for the given places, in one call. `month` = 'YYYY-MM-01'. */
  billsOfMonth: async (properties: string[], month: string) => {
    if (!properties.length) return [] as Bill[]
    let q = supabase.from('office_bills').select('*').eq('bill_month', month).is('archived_at', null)
    if (properties.length <= 100) q = q.in('property_id', properties)
    const { data, error } = await q; fail(error)
    const want = new Set(properties); return ((data ?? []) as Bill[]).filter(b => want.has(b.property_id))
  },
  residentSave: async (row: Record<string, unknown>, id?: string) => {
    const q = id ? supabase.from('office_residents').update(row).eq('id', id) : supabase.from('office_residents').insert(row)
    const { error } = await q; fail(error)
  },
  secrets: async (property: string) => {
    const { data, error } = await supabase.from('office_secrets').select('*').eq('property_id', property).is('archived_at', null).order('kind').order('label'); fail(error)
    return (data ?? []) as Secret[]
  },
  secretSave: async (row: Record<string, unknown>, id?: string) => {
    const q = id ? supabase.from('office_secrets').update(row).eq('id', id) : supabase.from('office_secrets').insert(row)
    const { error } = await q; fail(error)
  },
  notices: async (property?: string | null) => {
    let q = supabase.from('office_notices').select('*').order('created_at', { ascending: false }).limit(300)
    if (property) q = q.eq('property_id', property)
    const { data, error } = await q; fail(error); return (data ?? []) as Notice[]
  },
  noticeSend: (n: { property: string; kind: NoticeKind; title?: string | null; asset?: string | null; itemKind?: string | null; qty?: number; note?: string | null; urgent?: boolean }) =>
    rpc<{ id: string; no: string; notified: number }>('office_notice_send', { p_property: n.property, p_kind: n.kind, p_title: n.title ?? null, p_asset: n.asset ?? null,
      p_item_kind: n.itemKind ?? null, p_quantity: n.qty ?? 1, p_note: n.note ?? null, p_urgent: n.urgent ?? false }),
  /** The hub manager checks a report; the name and time are kept. */
  noticeVerify: (id: string, note: string | null = null) => rpc<void>('office_notice_verify', { p_id: id, p_note: note }),
  noticeUpdate: (id: string, status: 'seen' | 'done' | 'rejected', reply: string | null, fixed = false) =>
    rpc<void>('office_notice_update', { p_id: id, p_status: status, p_reply: reply, p_fixed: fixed }),
  /** One line in the audit log for an export / print; refused (42501) without office.report.export / .print. */
  logExport: (list: string, format: 'excel' | 'pdf' | 'print', rows: number) => rpc<void>('office_log_export', { p_report: list, p_format: format, p_rows: rows }),
  /** The hub's vehicles with their crew (the fleet's own function decides what the person may see). */
  vehicles: async (hub: string): Promise<HubVehicle[]> => rpc<HubVehicle[]>('fleet_board', { p_hub: hub }),
  upload: async (property: string, file: File) => {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const path = `${property}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
    const { error } = await supabase.storage.from('office-docs').upload(path, file, { contentType: file.type || undefined, upsert: false }); fail(error as { message: string } | null)
    return path
  },
  fileUrl: async (path: string) => {
    const { data, error } = await supabase.storage.from('office-docs').createSignedUrl(path, 300); fail(error as { message: string } | null); return data!.signedUrl
  },
  /** Ask নদী AI (the key lives only in the Edge Function). Throws when the AI is not set up — the page then keeps its own worked-out answer. */
  ai: async (task: AiTask, data: unknown): Promise<string> => {
    const { data: out, error } = await supabase.functions.invoke('nodi-ai', { body: { action: 'office', task, data } })
    if (error) {
      let b: { message?: string; error?: string } = {}
      const ctx = (error as { context?: Response }).context
      try { if (ctx && typeof ctx.json === 'function') b = await ctx.json() } catch { /* not JSON */ }
      throw new Error(b.error === 'bad_request' ? 'AI-র অফিস অংশ এখনো সার্ভারে বসানো হয়নি' : b.message || b.error || error.message)
    }
    return String((out as { text?: string })?.text ?? '').trim()
  },
}
