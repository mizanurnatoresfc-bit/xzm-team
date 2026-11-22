// Accounts settings → "খরচের ভাউচার": the voucher number format and the automatic voucher.
// The database (private.da_next_voucher_no, da_configure) makes the numbers and refuses unsafe formats;
// this card only edits the setting and shows what the next number will look like.
import { useEffect, useState } from 'react'
import { VOUCHER_DEFAULT, type VoucherSetting } from '../../lib/dailyAccounts'
import { Field } from './ui'

const pad2 = (n: number) => String(n).padStart(2, '0')

/** The same rule the database uses, for the preview only. */
export function voucherPreview(v: VoucherSetting, hubCode: string, n: number, d = new Date()): string {
  const yy = pad2(d.getFullYear() % 100), yyyy = String(d.getFullYear()), mm = pad2(d.getMonth() + 1), dd = pad2(d.getDate())
  const date = v.date === 'YYMM' ? `${yy}${mm}-` : v.date === 'YYYYMM' ? `${yyyy}${mm}-` : v.date === 'YYMMDD' ? `${yy}${mm}${dd}-` : ''
  const seq = String(n).length >= v.digits ? String(n) : String(n).padStart(v.digits, '0')
  return `${v.prefix}${v.hub_code ? `${hubCode.toUpperCase()}-` : ''}${date}${seq}`
}

/** What the database would refuse, said before saving. */
export function voucherProblem(v: VoucherSetting): string | null {
  if (!/^[A-Za-z0-9/-]{0,8}$/.test(v.prefix)) return 'শুরুর অক্ষরে শুধু ইংরেজি অক্ষর, সংখ্যা, / বা - (সর্বোচ্চ ৮টা)।'
  if (v.reset === 'daily' && v.date !== 'YYMMDD') return 'প্রতিদিন ১ থেকে শুরু হলে তারিখের অংশে দিনও (YYMMDD) রাখুন, নইলে একই নম্বর দুবার হবে।'
  if (v.reset === 'monthly' && v.date === 'none') return 'প্রতি মাসে ১ থেকে শুরু হলে তারিখের অংশে মাস রাখুন।'
  if (v.per_hub && !v.hub_code) return 'প্রতি হাবে আলাদা গণনা হলে নম্বরে হাবের কোড রাখুন, নইলে দুই হাবে একই নম্বর হবে।'
  return null
}

export function VoucherCard({ value, billOver, onSave }: { value: VoucherSetting | undefined; billOver: number | null
  onSave: (v: VoucherSetting) => Promise<void> }) {
  const [v, setV] = useState<VoucherSetting>(value ?? VOUCHER_DEFAULT)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setV(value ?? VOUCHER_DEFAULT) }, [value])
  const set = (patch: Partial<VoucherSetting>) => setV({ ...v, ...patch })
  const problem = voucherProblem(v)
  const note = `${v.reset === 'daily' ? 'প্রতিদিন ১ থেকে শুরু' : v.reset === 'monthly' ? 'প্রতি মাসের ১ তারিখে ১ থেকে শুরু' : 'কখনো আবার শুরু হয় না, একটানা চলে'} · ${v.per_hub ? 'প্রতি হাবের নিজের গণনা' : 'সব হাব মিলে একটা গণনা'}`
  return <section className="panel"><h2>খরচের ভাউচার</h2>
    <p className="muted small">বিল ছাড়া খরচের জন্য কোম্পানির নিজের ভাউচার। নম্বর কেমন হবে আর কখন নিজে থেকে তৈরি হবে, এখান থেকে ঠিক করুন।
      নতুন নিয়ম শুধু এর পরে তৈরি হওয়া ভাউচারে বসবে; আগের নম্বর যেমন আছে তেমন থাকবে।</p>
    <label className="da-check"><input type="checkbox" checked={v.auto_on_submit} onChange={e => set({ auto_on_submit: e.target.checked })} />
      {' '}বিল নেই এমন খরচে নিজে থেকে ভাউচার তৈরি হবে (নিজের অংশ বন্ধ বা খাতা জমা দেওয়ার সময়)</label>
    <p className="muted small">{v.auto_on_submit
      ? `বিলের ছবি লাগবে ${billOver != null ? `৳${billOver.toLocaleString('en-IN')} বা বেশি` : 'কোনো সীমা ছাড়া নয়'} খরচে (সীমা বদলাতে: "রেফারেন্স, বিল আপলোড ও OCR")। এর কম খরচে বিল না দিলে অটো ভাউচার হবে।`
      : 'বন্ধ থাকলে বিল বা ভাউচার ছাড়া খরচ থাকলে খাতা জমা হবে না — ম্যানেজারকে বিলের ছবি দিতে হবে বা নিজে "ভাউচার বানান" চাপতে হবে।'}</p>
    <h3>ভাউচার নম্বর</h3>
    <div className="da-grid3">
      <Field label="শুরুর অক্ষর" hint="যেমন V- বা AV-"><input value={v.prefix} maxLength={8} onChange={e => set({ prefix: e.target.value.toUpperCase() })} /></Field>
      <Field label="তারিখের অংশ"><select value={v.date} onChange={e => set({ date: e.target.value as VoucherSetting['date'] })}>
        <option value="YYMM">বছর-মাস (2611)</option><option value="YYYYMM">বছর-মাস (202611)</option>
        <option value="YYMMDD">বছর-মাস-দিন (261121)</option><option value="none">তারিখ নেই</option></select></Field>
      <Field label="ক্রম নম্বরের ঘর"><select value={v.digits} onChange={e => set({ digits: Number(e.target.value) })}>
        {[3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n} ঘর ({'0'.repeat(n - 1)}1)</option>)}</select></Field>
      <Field label="নম্বর আবার ১ থেকে শুরু"><select value={v.reset} onChange={e => set({ reset: e.target.value as VoucherSetting['reset'] })}>
        <option value="never">কখনো না (একটানা)</option><option value="monthly">প্রতি মাসে</option><option value="daily">প্রতিদিন</option></select></Field>
      <Field label="গণনা"><select value={v.per_hub ? 'hub' : 'all'} onChange={e => set(e.target.value === 'hub' ? { per_hub: true, hub_code: true } : { per_hub: false })}>
        <option value="all">সব হাব মিলিয়ে একটা</option><option value="hub">প্রতি হাবে আলাদা</option></select></Field>
      <div style={{ display: 'flex', alignItems: 'flex-end' }}>
        <label className="da-check"><input type="checkbox" checked={v.hub_code} disabled={v.per_hub} onChange={e => set({ hub_code: e.target.checked })} /> নম্বরে হাবের কোড</label></div>
    </div>
    <div className="a11y-preview" aria-live="polite">
      <span className="muted small">পরের ভাউচার দেখতে হবে এমন</span>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: .5 }}>{voucherPreview(v, 'HUB', 1)}</div>
      <span className="muted small">{note}{v.hub_code ? ' · HUB = হাবের কোড' : ''}</span>
    </div>
    {problem && <p className="small" role="alert" style={{ color: 'var(--bad-fg, #b91c1c)' }}>{problem}</p>}
    <button disabled={!!problem || busy} onClick={async () => { setBusy(true); try { await onSave(v) } finally { setBusy(false) } }}>সেভ</button>
  </section>
}
