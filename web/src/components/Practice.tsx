// অনুশীলন মোড — learn with sample data. Nothing here calls the database: every check runs in the browser
// with the same rules the real screens use, so a manager can make mistakes freely.
import { useState } from 'react'
import { MATCH_LABEL, slipMatch, sortExpense } from '../lib/accountsGuide'
import { da, type Category } from '../lib/dailyAccounts'
import { findAmount, readImage } from '../lib/ocr'
import { printVoucher, takaInWords } from '../lib/voucher'
import { downloadVoucherPng } from '../lib/voucherImage'
import type { Practice } from '../lib/accountsGuide'
import { Badge, Field, useLoad } from '../pages/accounts/ui'
import { Icon } from './Icon'

const bnNum = (v: number | string) => String(v).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[+d])
const toNum = (v: string) => { const x = Number(v.replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).replace(/[^\d.]/g, '')); return Number.isFinite(x) ? x : 0 }
type Check = [boolean, string]

function Checks({ list }: { list: Check[] }) {
  if (!list.length) return null
  const ok = list.every(c => c[0])
  return <div className={`pr-result ${ok ? 'ok' : 'bad'}`}>
    <b>{ok ? 'সব ঠিক আছে — আসল খাতায় এভাবেই লিখবেন।' : 'কিছু ঠিক করতে হবে:'}</b>
    <ul>{list.map(([good, t], i) => <li key={i} className={good ? 'good' : 'bad'}><Icon name={good ? 'check' : 'x'} size={14} />{t}</li>)}</ul>
  </div>
}

export function PracticeBox({ kind }: { kind: Practice }) {
  return <div className="pr-box">
    <p className="pr-banner"><Icon name="shield" size={16} />অনুশীলন মোড — নমুনা তথ্য দিয়ে শিখুন। এখানে যা লিখবেন তা আসল হিসাবে সেভ হয় না।</p>
    {kind === 'expense' && <ExpensePractice />}
    {kind === 'bank' && <BankPractice />}
    {kind === 'report' && <ReportPractice />}
    {kind === 'voucher' && <VoucherPractice />}
    {kind === 'rider' && <RiderPractice />}
    {kind === 'merchant' && <MerchantPractice />}
  </div>
}

// ---- হাবের খরচ ----
const EXP_TASKS: Array<{ text: string; want: { cat: string; amount: number; staff: string; voucher: boolean } }> = [
  { text: 'হাব থেকে ব্যাংকে টাকা নিতে ভ্যান ভাড়া ১২০ টাকা। ভ্যানচালক কোনো রসিদ দেননি।', want: { cat: 'transport', amount: 120, staff: '', voucher: false } },
  { text: 'রাইডার Md Mahin (ID 6799) অসুস্থ — ওষুধ কিনে দেওয়া হলো ৫০০ টাকা, ফার্মেসির মেমো আছে।', want: { cat: 'hr_treatment', amount: 500, staff: '6799', voucher: true } },
  { text: 'অফিসের জন্য প্যাকিং টেপ ও কাগজ কেনা ৩৫০ টাকা, দোকানের ক্যাশ মেমো আছে।', want: { cat: 'office', amount: 350, staff: '', voucher: true } },
]
function ExpensePractice() {
  const st = useLoad(() => da.settings().catch(() => null), [])
  const cats: Category[] = st.data?.['da.expense_categories'] ?? []
  const [i, setI] = useState(0)
  const [d, setD] = useState({ name: '', cat: '', amount: '', staff: '', file: false })
  const [checked, setChecked] = useState<Check[]>([])
  const task = EXP_TASKS[i]
  const cat = cats.find(c => c.code === d.cat)
  const sort = sortExpense({ staffId: d.staff, hasVoucherFile: d.file })
  function check() {
    const w = task.want, out: Check[] = []
    out.push([d.name.trim().length > 2, d.name.trim().length > 2 ? 'খরচের নাম লেখা হয়েছে।' : 'খরচের নাম লিখুন — কী বাবদ, সহজ কথায়।'])
    out.push([d.cat === w.cat, d.cat === w.cat ? `খাত ঠিক: ${cat?.bn ?? d.cat}` : `খাত মেলেনি — এই খরচের খাত "${cats.find(c => c.code === w.cat)?.bn ?? w.cat}"।`])
    out.push([toNum(d.amount) === w.amount, toNum(d.amount) === w.amount ? 'টাকা ঠিক।' : `টাকা হবে ${bnNum(w.amount)}।`])
    out.push([d.staff.trim() === w.staff, w.staff ? (d.staff.trim() === w.staff ? 'স্টাফ আইডি দেওয়া হয়েছে — এটা স্টাফ খরচ।' : `কর্মীর জন্য খরচ — স্টাফ আইডি ${w.staff} দিন।`)
      : (d.staff.trim() ? 'এটা কোনো কর্মীর জন্য নয় — স্টাফ আইডি খালি রাখুন।' : 'স্টাফ আইডি খালি — ঠিক আছে।')])
    out.push([d.file === w.voucher, w.voucher ? (d.file ? 'মেমোর ছবি দেওয়া হবে — ভালো।' : 'মেমো আছে — তার ছবি দিন।') : (d.file ? 'রসিদ নেই — ছবি দেওয়ার মতো কিছু নেই; "ভাউচার বানান" দিন।' : 'রসিদ নেই → সেভ করে "ভাউচার বানান" দিন।')])
    if (cat?.site_limit && toNum(d.amount) > cat.site_limit) out.push([false, `এই খাতের সর্বোচ্চ সীমা ৳${bnNum(cat.site_limit)} — বেশি হলে কারণ লিখতে হবে।`])
    setChecked(out)
  }
  const next = () => { setI((i + 1) % EXP_TASKS.length); setD({ name: '', cat: '', amount: '', staff: '', file: false }); setChecked([]) }
  return <div className="pr-task">
    <p className="pr-q"><b>কাজ {bnNum(i + 1)}/{bnNum(EXP_TASKS.length)}:</b> {task.text}</p>
    <div className="pr-grid">
      <Field label="খরচের নাম"><input value={d.name} onChange={e => setD({ ...d, name: e.target.value })} placeholder="যেমন: ভ্যান ভাড়া" /></Field>
      <Field label="খাত" hint={cat?.note_bn ?? undefined}><select value={d.cat} onChange={e => setD({ ...d, cat: e.target.value })}>
        <option value="">— বাছুন —</option>{cats.map(c => <option key={c.code} value={c.code}>{c.bn} ({c.en})</option>)}</select></Field>
      <Field label="টাকা"><input inputMode="decimal" value={d.amount} onChange={e => setD({ ...d, amount: e.target.value })} /></Field>
      <Field label="স্টাফ আইডি (কর্মীর জন্য হলে)"><input inputMode="numeric" value={d.staff} onChange={e => setD({ ...d, staff: e.target.value })} /></Field>
    </div>
    <label className="pr-tick"><input type="checkbox" checked={d.file} onChange={e => setD({ ...d, file: e.target.checked })} /> বিল/মেমোর ছবি দেব</label>
    <p className="pr-sort">সিস্টেম যেখানে রাখবে: <Badge tone={sort.missingVoucher ? 'warn' : 'ok'}>{sort.label}</Badge></p>
    <div className="row"><button type="button" onClick={check}>মিলিয়ে দেখুন</button><button type="button" className="secondary" onClick={next}>পরের কাজ</button></div>
    <Checks list={checked} />
  </div>
}

// ---- ব্যাংকে জমা ----
function BankPractice() {
  const expected = 97450
  const [amount, setAmount] = useState('')
  const [ocr, setOcr] = useState('')
  const [conf, setConf] = useState('90')
  const [reading, setReading] = useState<number | null>(null)
  const [readErr, setReadErr] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const m = amount && (ocr !== '' || reading !== null) ? slipMatch(toNum(amount), ocr === '' ? null : toNum(ocr), toNum(conf)) : null
  async function tryPhoto(f: File) {
    setReadErr(''); setReading(0)
    try {
      const r = await readImage(f, 'eng', p => setReading(Math.round(p * 100)))
      const a = findAmount(r.text); setOcr(a === null ? '' : String(a)); setConf(String(r.confidence))
      if (a === null) setReadErr('ছবিতে টাকা পড়া যায়নি — NEEDS REVIEW।')
    } catch (e) { setReadErr(e instanceof Error ? e.message : String(e)) } finally { setReading(null) }
  }
  return <div className="pr-task">
    <p className="pr-q"><b>কাজ:</b> নমুনা হাবের হিসাবে ব্যাংকে যাওয়ার কথা <b>৳{bnNum(expected.toLocaleString('en-IN'))}</b>। আপনি জমা দিয়ে স্লিপ পেয়েছেন।
      জমার টাকা লিখুন, তারপর স্লিপে যা পড়া গেল তা লিখুন — অথবা নিজের যেকোনো স্লিপের ছবি দিয়ে দেখুন (ছবি কোথাও সেভ হয় না)।</p>
    <div className="pr-grid">
      <Field label="জমার টাকা (আপনি যা লিখবেন)"><input inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); setConfirmed(false) }} /></Field>
      <Field label="স্লিপে পড়া টাকা (OCR)"><input inputMode="decimal" value={ocr} onChange={e => { setOcr(e.target.value); setConfirmed(false) }} placeholder="পড়া না গেলে খালি" /></Field>
      <Field label="OCR কতটা নিশ্চিত (%)"><input inputMode="numeric" value={conf} onChange={e => setConf(e.target.value)} /></Field>
      <Field label="অথবা স্লিপের ছবি দিন"><input type="file" accept="image/png,image/jpeg" onChange={e => { const f = e.target.files?.[0]; if (f) void tryPhoto(f) }} /></Field>
    </div>
    {reading !== null && <p className="muted small">ছবি পড়া হচ্ছে… {bnNum(reading)}%</p>}
    {readErr && <p className="muted small">{readErr}</p>}
    {m && <div className={`pr-match t-${MATCH_LABEL[m][1]}`}><b>{MATCH_LABEL[m][0]}</b>
      <span>{m === 'match' ? 'ছবির লেখা আপনার টাকার সাথে মিলেছে। তবু এটা ব্যাংকে জমার প্রমাণ নয়।' : m === 'not_match' ? 'স্লিপের টাকা আর লেখা টাকা আলাদা — কোনটা ভুল দেখে ঠিক করুন।' : 'ছবি ঠিকমতো পড়া যায়নি — নিজে স্লিপ দেখে মিলিয়ে নিন।'}</span></div>}
    {toNum(amount) > 0 && toNum(amount) !== expected && <p className="muted small">হাবের বকেয়া: ৳{bnNum((expected - toNum(amount)).toLocaleString('en-IN'))} {expected - toNum(amount) > 0 ? '(আরও জমা দিতে হবে)' : '(বেশি জমা — কারণ লিখুন)'}</p>}
    {m && <div className="row">
      <button type="button" disabled={confirmed} onClick={() => setConfirmed(true)}><Icon name="check" size={16} />ব্যাংকে নিশ্চিত করুন (অনুশীলন)</button>
      {confirmed && <span className="pr-note">{m === 'match' ? 'আপনি নিজে স্লিপ দেখে নিশ্চিত করলেন — আসল খাতায় আপনার নাম ও সময় থেকে যায়।' : 'মেলেনি বা পড়া যায়নি — আসল খাতায় এখানে আপনাকে নিজের মন্তব্য লিখতে হতো (যেমন: "ব্যাংক স্টেটমেন্টে দেখেছি")।'}</span>}
    </div>}
  </div>
}

// ---- দৈনিক রিপোর্ট ----
const SAMPLE_REPORT = `Update Report #743858
Hub: Natore Sadar   Date: 17-11-2026
Delivered: 120   Total Collected: 100,700 Tk`
function ReportPractice() {
  const [text, setText] = useState(SAMPLE_REPORT)
  const [id, setId] = useState('')
  const [amount, setAmount] = useState('')
  const [checked, setChecked] = useState<Check[]>([])
  const readText = () => {
    const m = text.match(/#\s?(\d{4,})/) ?? text.match(/report\s*(?:id|no)?\s*[:#]?\s*(\d{4,})/i)
    if (m) setId('#' + m[1])
    const a = findAmount(text.replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d))))
    if (a !== null) setAmount(String(a))
  }
  const check = () => setChecked([
    [id.replace(/\s/g, '') === '#743858', id.replace(/\s/g, '') === '#743858' ? 'রিপোর্ট আইডি ঠিক।' : 'রিপোর্ট আইডি হবে #743858 — রিপোর্টের উপরের নম্বর।'],
    [toNum(amount) === 100700, toNum(amount) === 100700 ? 'টোটাল এমাউন্ট ঠিক।' : 'টোটাল এমাউন্ট হবে ১,০০,৭০০ — কমা বাদ দিয়ে লিখুন।'],
    [true, 'নমুনা খাতার রাইডার যোগফল ৳১,০১,২০০ — পার্থক্য −৫০০। আসল খাতায় "রিপোর্ট ওকে"-র আগে কারণ লিখতে হবে।'],
  ])
  return <div className="pr-task">
    <p className="pr-q"><b>কাজ:</b> নিচের নমুনা রিপোর্টের লেখা থেকে রিপোর্ট আইডি ও টোটাল এমাউন্ট বের করুন। "লেখা থেকে পড়ুন" চাপলে সিস্টেম চেষ্টা করবে — আপনি মিলিয়ে নেবেন।</p>
    <Field label="রিপোর্টের লেখা (পেস্ট করা)"><textarea rows={4} value={text} onChange={e => setText(e.target.value)} /></Field>
    <div className="row"><button type="button" className="secondary" onClick={readText}>লেখা থেকে পড়ুন</button></div>
    <div className="pr-grid">
      <Field label="রিপোর্ট আইডি"><input value={id} onChange={e => setId(e.target.value)} placeholder="#743858" /></Field>
      <Field label="টোটাল এমাউন্ট"><input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
    </div>
    <div className="row"><button type="button" onClick={check}>মিলিয়ে দেখুন</button></div>
    <Checks list={checked} />
  </div>
}

// ---- ভাউচার ----
function VoucherPractice() {
  const st = useLoad(() => da.settings().catch(() => null), [])
  const cats: Category[] = st.data?.['da.expense_categories'] ?? []
  const [d, setD] = useState({ name: 'ভ্যান ভাড়া (হাব থেকে ব্যাংক)', cat: 'transport', amount: '120', staff: '', ref: '', desc: 'ভ্যানচালক রসিদ দেননি' })
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
  const v = () => ({ voucher_no: 'V-অনুশীলন', expense_no: 0, amount: toNum(d.amount), bill_date: today, expense_name: d.name, category: d.cat,
    kind: (d.staff.trim() ? 'employee' : 'transport') as 'employee' | 'transport', remarks: [d.ref && `রেফারেন্স: ${d.ref}`, d.desc, 'অনুশীলন — আসল ভাউচার নয়'].filter(Boolean).join(' · '),
    employee_code: d.staff || null, employee_name: d.staff ? 'নমুনা কর্মী' : null, paid_by_name: null, reference_no: null,
    hub: 'নমুনা হাব', hub_code: '00', zone: 'নমুনা জোন', account_date: today, sheet_no: 0, made_by: 'অনুশীলন', made_at: new Date().toISOString() })
  const cat = cats.find(c => c.code === d.cat)
  return <div className="pr-task">
    <p className="pr-q"><b>কাজ:</b> বিল না পাওয়া একটা খরচের ভাউচার বানানো শিখুন। ঘরগুলো বদলে দেখুন, তারপর প্রিন্ট/পিডিএফ বা ছবি নামান — নম্বরের জায়গায় "অনুশীলন" লেখা থাকবে।</p>
    <div className="pr-grid">
      <Field label="খরচের নাম"><input value={d.name} onChange={e => setD({ ...d, name: e.target.value })} /></Field>
      <Field label="খাত"><select value={d.cat} onChange={e => setD({ ...d, cat: e.target.value })}>{cats.map(c => <option key={c.code} value={c.code}>{c.bn}</option>)}</select></Field>
      <Field label="টাকা" hint={toNum(d.amount) ? `কথায়: ${takaInWords(toNum(d.amount))}` : undefined}><input inputMode="decimal" value={d.amount} onChange={e => setD({ ...d, amount: e.target.value })} /></Field>
      <Field label="স্টাফ আইডি"><input value={d.staff} onChange={e => setD({ ...d, staff: e.target.value })} /></Field>
      <Field label="রেফারেন্স"><input value={d.ref} onChange={e => setD({ ...d, ref: e.target.value })} placeholder="যার কথায় খরচ" /></Field>
      <Field label="বিবরণ"><input value={d.desc} onChange={e => setD({ ...d, desc: e.target.value })} /></Field>
    </div>
    <div className="row"><button type="button" disabled={!toNum(d.amount) || !d.name.trim()} onClick={() => printVoucher(v(), cat)}><Icon name="print" size={16} />প্রিন্ট / পিডিএফ</button>
      <button type="button" className="secondary" disabled={!toNum(d.amount) || !d.name.trim()} onClick={() => void downloadVoucherPng(v(), cat)}><Icon name="save" size={16} />ছবি নামান</button></div>
  </div>
}

// ---- রাইডারের হিসাব ----
const RIDERS = [{ name: 'Alamin Sarker', code: '7982', delivery: 18, pickup: 4, amount: 3600, paid: 3600 }, { name: 'Md Mahin', code: '6799', delivery: 11, pickup: 0, amount: 2250, paid: 2000 }]
function RiderPractice() {
  const [due, setDue] = useState(['', ''])
  const [checked, setChecked] = useState<Check[]>([])
  const check = () => setChecked(RIDERS.map((r, i) => {
    const want = r.amount - r.paid
    return [toNum(due[i]) === want, toNum(due[i]) === want ? `${r.name}: বকেয়া ঠিক (৳${bnNum(want)})।` : `${r.name}: বকেয়া = টাকা − জমা = ৳${bnNum(r.amount)} − ৳${bnNum(r.paid)} = ৳${bnNum(want)}।`] as Check
  }))
  return <div className="pr-task">
    <p className="pr-q"><b>কাজ:</b> দুই রাইডারের বকেয়া হিসাব করুন। (আসল খাতায় বকেয়া সিস্টেম নিজে হিসাব করে — কিন্তু বুঝে রাখা দরকার।)</p>
    <div className="da-table-wrap"><table className="da-table"><thead><tr><th>রাইডার</th><th>পিকআপ</th><th>ডেলিভারি</th><th>টাকা</th><th>জমা</th><th>বকেয়া?</th></tr></thead>
      <tbody>{RIDERS.map((r, i) => <tr key={r.code}><td data-l="রাইডার">{r.name} #{r.code}</td><td data-l="পিকআপ">{bnNum(r.pickup)}</td><td data-l="ডেলিভারি">{bnNum(r.delivery)}</td>
        <td data-l="টাকা">৳{bnNum(r.amount)}</td><td data-l="জমা">৳{bnNum(r.paid)}</td>
        <td data-l="বকেয়া?"><input inputMode="decimal" style={{ maxWidth: 110 }} value={due[i]} onChange={e => setDue(due.map((x, j) => (j === i ? e.target.value : x)))} /></td></tr>)}</tbody></table></div>
    <div className="row"><button type="button" onClick={check}>মিলিয়ে দেখুন</button></div>
    <Checks list={checked} />
  </div>
}

// ---- মার্চেন্ট ক্যাশ পেমেন্ট ----
function MerchantPractice() {
  const st = useLoad(() => da.settings().catch(() => null), [])
  const prefix = (st.data?.['da.payment_id_prefix'] ?? 'SFC').replace(/-$/, '')
  const [id, setId] = useState('')
  const [amount, setAmount] = useState('')
  const [ticked, setTicked] = useState(false)
  const [checked, setChecked] = useState<Check[]>([])
  const norm = (v: string) => { const digits = v.replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).replace(/\D/g, ''); return digits ? `${prefix}-${digits}` : '' }
  const check = () => setChecked([
    [norm(id) === `${prefix}-33223762`, norm(id) === `${prefix}-33223762` ? `Payment ID ঠিক — সিস্টেম এভাবে বসাবে: ${norm(id)}` : `স্ক্রিনশটের Payment ID 33223762 — যেভাবেই লিখুন, সিস্টেম ${prefix}-33223762 বানাবে।`],
    [toNum(amount) === 15000, toNum(amount) === 15000 ? 'টাকা ঠিক।' : 'স্ক্রিনশটে টাকা ১৫,০০০।'],
    [ticked, ticked ? '"যাচাই করেছি" দেওয়া হয়েছে।' : 'OCR-এ পড়া মান মিলিয়ে "যাচাই করেছি" টিক দিন — না দিলে হিসাব জমা হয় না।'],
  ])
  return <div className="pr-task">
    <p className="pr-q"><b>কাজ:</b> নমুনা স্ক্রিনশটে লেখা: <code>Payment SFC-33223762 · ৳15,000 · Paid 17 Nov 2026 to AFRIN by Maruful</code>। খাতায় তুলুন।</p>
    <div className="pr-grid">
      <Field label="Payment ID" hint={norm(id) ? `সিস্টেম বসাবে: ${norm(id)}` : 'যেমন: 33223762 বা sfc-33223762'}><input value={id} onChange={e => setId(e.target.value)} /></Field>
      <Field label="টাকা"><input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
    </div>
    <label className="pr-tick"><input type="checkbox" checked={ticked} onChange={e => setTicked(e.target.checked)} /> পড়া মান মিলিয়ে যাচাই করেছি</label>
    <div className="row"><button type="button" onClick={check}>মিলিয়ে দেখুন</button></div>
    <Checks list={checked} />
  </div>
}
