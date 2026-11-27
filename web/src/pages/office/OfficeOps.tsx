import { RowMenu } from '../../components/RowMenu'
// অফিস অপারেশন — the parts of the Office pages that deal with running a place: the lease and the month's bills,
// what the electricity should cost, vehicles / locks / logins, who lives there, reports to the zonal manager, and the zone picture.
import { askConfirm, askText } from '../../components/ask'
import { useMemo, useState, type ReactNode } from 'react'
import { Contact } from '../../components/Contact'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { Icon } from '../../components/Icon'
import { Badge, Field, Modal, Stat, useLoad, useToast } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { useNodiFeatures } from '../../lib/useNodiFeatures'
import { sorting, type EmpLite } from '../../lib/sorting'
import { ASSET_KIND, office, PLACE_KIND, scopeOf, scopePath, type Asset, type Desk, type Property, type Room } from '../../lib/office'
import {
  BILL_KIND, contractDraft, daysLeft, DEFAULT_RATE, memoHtml, METHOD, NOTICE_KIND, NOTICE_STATUS, ops, opsFriendly, powerRows, powerTips, printHtml, printText,
  SECRET_KIND, type Bill, type BillKind, type BillMore, type ExpenseLine, type Loan, type Notice, type NoticeKind, type Secret, type SecretKind,
} from '../../lib/officeOps'
import { parsePayment, readImage } from '../../lib/ocr'
import { takaInWords } from '../../lib/voucher'
import { askWith } from './askText'
import { EmpPicker, empLabel } from '../sorting/Sorting'

export type Ctx = { p: Property; all: Property[]; hubName: (id: string | null) => string; rooms: Room[]; desks: Desk[]; assets: Asset[]
  emp: Record<string, EmpLite>; reload: () => Promise<void>; reloadPlaces: () => Promise<void> }

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const monthBn = (d: string, lang: string) => new Date(d.slice(0, 7) + '-01T00:00:00').toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { month: 'long', year: 'numeric' })
const dayBn = (d: string, lang: string) => new Date(d.length > 10 ? d : d + 'T00:00:00').toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', year: 'numeric' })
/** How the rooms of a place split: office work, living, everything else. */
export const roomSplit = (rooms: Room[]) => ({
  office: rooms.filter(r => r.kind === 'office_room' || r.kind === 'meeting').length,
  living: rooms.filter(r => r.kind === 'room').length,
  other: rooms.filter(r => !['office_room', 'meeting', 'room'].includes(r.kind)).length,
})

/** A file kept in the private bucket: opens through a short-lived link. */
function FileBtn({ path, children }: { path: string; children: ReactNode }) {
  const [err, setErr] = useState('')
  return <button type="button" className="secondary sm" title={err || undefined}
    onClick={() => { void ops.fileUrl(path).then(u => window.open(u, '_blank', 'noopener')).catch(e => setErr(opsFriendly(e))) }}><Icon name="eye" size={13} />{children}</button>
}
function Upload({ property, value, onChange, label, onFile }: { property: string; value: string | null; onChange: (p: string | null) => void; label: string; onFile?: (f: File) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  async function pick(f: File | undefined) {
    if (!f) return
    setBusy(true); setErr('')
    try { onChange(await ops.upload(property, f)); onFile?.(f) } catch (e) { setErr(opsFriendly(e)) } finally { setBusy(false) }
  }
  return <div className="oo-up">
    {value ? <span className="row-acts"><Badge tone="ok">{label} ✓</Badge><FileBtn path={value}>দেখুন</FileBtn>
      <button type="button" className="secondary sm" onClick={() => onChange(null)}><Icon name="x" size={12} /></button></span>
      : <label className={`oo-pick${busy ? ' busy' : ''}`}><Icon name="upload" size={16} /><span>{busy ? 'উঠছে…' : label}</span>
        <input type="file" accept="image/*,application/pdf" disabled={busy} onChange={e => { void pick(e.target.files?.[0]); e.target.value = '' }} /></label>}
    {err && <p className="da-error">{err}</p>}
  </div>
}
/** The AI's answer under a button; when the AI is not set up the page's own answer stays. */
function AiBox({ label, run, hint }: { label: string; run: () => Promise<string>; hint?: string }) {
  const [busy, setBusy] = useState(false); const [text, setText] = useState(''); const [err, setErr] = useState('')
  const feats = useNodiFeatures()
  if (!feats?.office) return null
  return <div className="oo-ai">
    <div className="row-acts"><button type="button" disabled={busy} onClick={() => { setBusy(true); setErr(''); void run().then(setText).catch(e => setErr(opsFriendly(e))).finally(() => setBusy(false)) }}>
      <Icon name="play" size={14} />{busy ? 'নদী AI ভাবছে…' : label}</button>{hint && <span className="muted small">{hint}</span>}</div>
    {err && <p className="notice small">{err} — উপরের হিসাবটা AI ছাড়াই ডাটা থেকে বের করা, সেটা ব্যবহার করুন।</p>}
    {text && <div className="oo-ai-out pre-wrap">{text}</div>}
  </div>
}

// ================================================================ bills (rent / electricity / wifi)
type BF = { id?: string; kind: BillKind; month: string; amount: string; paid_on: string; method: string; txn: string; payee: string; phone: string; units: string
  has_memo: boolean; memo_file: string | null; proof: string | null; exp: string; note: string }

function BillBlock({ ctx, kinds }: { ctx: Ctx; kinds: BillKind[] }) {
  const { can } = useAuth()
  const { L, n, lang } = usePrefs()
  const { toast, node } = useToast()
  const p = ctx.p
  const bills = useLoad(() => ops.bills(p.id), [p.id])
  const from = useMemo(() => { const d = new Date(today() + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 12); return d.toISOString().slice(0, 10) }, [])
  const lines = useLoad(() => p.hub_id ? ops.expenseLines(p.id, from, today()).catch(() => [] as ExpenseLine[]) : Promise.resolve([] as ExpenseLine[]), [p.id])
  const [f, setF] = useState<BF | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [ocr, setOcr] = useState('')
  const edit = can('office.bill.edit')
  const tk = (v: number | null | undefined) => `৳ ${n(Math.round(Number(v ?? 0)))}`
  const thisMonth = today().slice(0, 7)
  const open = (kind: BillKind, b?: Bill, line?: ExpenseLine) => { setErr(''); setOcr(''); setF(b
    ? { id: b.id, kind: b.kind, month: b.bill_month.slice(0, 7), amount: String(b.amount), paid_on: b.paid_on ?? '', method: b.method ?? '', txn: b.txn_id ?? '', payee: b.payee ?? '',
        phone: b.payee_phone ?? '', units: b.units?.toString() ?? '', has_memo: b.has_memo, memo_file: b.memo_file, proof: b.proof_file, exp: b.da_expense_id ?? '', note: b.note ?? '' }
    : { kind, month: (line?.account_date ?? today()).slice(0, 7), amount: line ? String(line.amount) : kind === 'rent' && p.rent ? String(p.rent) : kind === 'wifi' && p.wifi_bill ? String(p.wifi_bill) : '',
        paid_on: line?.bill_date ?? today(), method: kind === 'electricity' ? 'bkash' : 'cash', txn: '', payee: kind === 'rent' ? p.owner_name ?? '' : kind === 'wifi' ? p.wifi_provider ?? '' : '',
        phone: kind === 'rent' ? p.owner_phone ?? '' : '', units: '', has_memo: false, memo_file: null, proof: null, exp: line?.id ?? '', note: '' }) }
  async function readShot(file: File) {
    if (!file.type.startsWith('image/')) return
    setOcr(L('স্ক্রিনশট পড়া হচ্ছে…', 'Reading the screenshot…'))
    try {
      const r = await readImage(file); const x = parsePayment(r.text, r.confidence)
      setF(c => c ? { ...c, txn: c.txn || String(x.transaction_id ?? ''), amount: c.amount || (x.amount ? String(x.amount) : ''), paid_on: x.payment_date ? String(x.payment_date) : c.paid_on } : c)
      setOcr(x.transaction_id || x.amount ? L('স্ক্রিনশট থেকে তথ্য বসানো হয়েছে — মিলিয়ে নিন', 'Filled from the screenshot — please check') : L('স্ক্রিনশট থেকে কিছু পড়া যায়নি — নিজে লিখুন', 'Nothing readable — type it in'))
    } catch { setOcr('') }
  }
  async function save() {
    if (!f) return
    if (!f.month || !(Number(f.amount) > 0)) return setErr(L('মাস ও টাকার অঙ্ক দিন', 'Give the month and the amount'))
    if (f.kind === 'electricity' && !f.proof) return setErr(L('বিদ্যুৎ বিলে মোবাইল ব্যাংকিংয়ের স্ক্রিনশট দিতে হবে', 'An electricity bill needs the mobile-banking screenshot'))
    setBusy(true); setErr('')
    try {
      const more: BillMore = { paid_on: f.paid_on, method: f.method, txn_id: f.txn, payee: f.payee, payee_phone: f.phone, units: f.units, has_memo: f.has_memo,
        memo_file: f.has_memo ? f.memo_file : null, proof_file: f.proof, da_expense_id: f.exp || null, note: f.note }
      const r = await ops.billSave(p.id, f.kind, f.month + '-01', Number(f.amount), more, f.id)
      setF(null); await Promise.all([bills.reload(), lines.reload()])
      toast(r.memo_no && !f.has_memo ? L(`সেভ হয়েছে — মেমো নং ${r.memo_no}`, `Saved — memo ${r.memo_no}`) : L('সেভ হয়েছে', 'Saved'))
    } catch (e) { setErr(opsFriendly(e)) } finally { setBusy(false) }
  }
  async function remove(b: Bill) {
    const why = await askWith(L)(L('বিলটা সরানোর কারণ', 'Why remove this bill?')); if (!why) return
    try { await ops.billRemove(b.id, why); await Promise.all([bills.reload(), lines.reload()]) } catch (e) { setErr(opsFriendly(e)) }
  }
  const memo = (b: Bill) => printHtml(`XZM TEAM — মেমো ${b.memo_no ?? ''}`, memoHtml(b, p, p.hub_id ? ctx.hubName(p.hub_id) : null, takaInWords(Number(b.amount))))
  if (!can('office.bill.view')) return <p className="notice">{L('বিল দেখার অনুমতি আপনার রোলে নেই।', 'Your role may not see bills.')}</p>
  if (bills.error) return <p className="da-error">{opsFriendly(bills.error)}</p>

  return <>{node}
    {kinds.map(kind => {
      const mine = (bills.data ?? []).filter(b => b.kind === kind)
      const exp = (lines.data ?? []).filter(x => x.kind === kind)
      const cur = mine.find(b => b.bill_month.slice(0, 7) === thisMonth)
      const loose = exp.filter(x => !x.bill_id)
      const year = mine.slice(0, 12).reduce((s, b) => s + Number(b.amount), 0)
      // other, water and gas: shown only when there is a bill or the person may write one; no accounts category matches them yet
      const light = kind === 'other' || kind === 'water' || kind === 'gas'
      if (light && !mine.length && !edit) return null
      return <section key={kind} className="panel">
        <div className="da-bar"><h2><Icon name={BILL_KIND[kind][2]} size={18} /> {L(BILL_KIND[kind][0], BILL_KIND[kind][1])} <span className="count-pill">{n(mine.length)}</span></h2>
          {edit && <button onClick={() => open(kind)}><Icon name="plus" size={15} />{L('বিল লিখুন', 'Write a bill')}</button>}</div>
        {kind !== 'other' && <div className="da-stats">
          <Stat icon="cal" tone={cur ? 'ok' : 'warn'} label={L('চলতি মাস', 'This month')} value={cur ? tk(cur.amount) : L('লেখা হয়নি', 'Not written')}
            sub={cur ? (cur.paid_on ? dayBn(cur.paid_on, lang) : undefined) : monthBn(thisMonth, lang)} />
          {kind === 'rent' && <Stat icon="cash" label={L('মাসিক রানিং ভাড়া', 'Running rent')} value={p.rent ? tk(p.rent) : '—'} sub={p.rent_due_day ? L(`প্রতি মাসের ${n(p.rent_due_day)} তারিখ`, `due on day ${p.rent_due_day}`) : undefined} />}
          <Stat icon="chart" label={L('শেষ ১২ বিল মোট', 'Last 12 bills')} value={tk(year)} />
          <Stat icon="ledger" tone={loose.length ? 'warn' : undefined} label={L('হিসাব খাতায় পাওয়া লাইন', 'Lines in the accounts')} value={n(exp.length)} sub={loose.length ? L(`${n(loose.length)}টার বিল লেখা বাকি`, `${loose.length} without a bill`) : undefined} />
        </div>}
        {kind === 'electricity' && <p className="muted small">{L('বিদ্যুৎ বিলে মোবাইল ব্যাংকিংয়ের স্ক্রিনশট না দিলে সেভ হবে না। স্ক্রিনশট দিলে TrxID ও টাকা নিজে থেকে বসে।', 'An electricity bill cannot be saved without the mobile-banking screenshot. TrxID and amount are read from it.')}</p>}
        {!mine.length ? <p className="muted">{L('এখনো কোনো বিল লেখা হয়নি।', 'No bill written yet.')}</p> :
          <div className="oo-list">{mine.map(b => <article key={b.id} className="oo-row">
            <div className="oo-main"><b>{monthBn(b.bill_month, lang)}</b> <span className="oo-amt">{tk(b.amount)}</span>
              <div className="muted small">{[b.paid_on && dayBn(b.paid_on, lang), b.method && L(METHOD[b.method]?.[0] ?? b.method, METHOD[b.method]?.[1] ?? b.method), b.txn_id && `TrxID ${b.txn_id}`, b.payee,
                b.units && L(`${n(b.units)} ইউনিট`, `${b.units} units`)].filter(Boolean).join(' · ')}</div>
              {b.note && <div className="muted small">{b.note}</div>}</div>
            <div className="row-acts">
              {b.has_memo ? <>{b.memo_file ? <FileBtn path={b.memo_file}>{L('মেমো', 'Memo')}</FileBtn> : <Badge tone="ok">{L('মেমো আছে', 'Has memo')}</Badge>}</>
                : <button className="secondary sm" onClick={() => memo(b)}><Icon name="print" size={13} />{L('মেমো', 'Memo')} {b.memo_no}</button>}
              {b.proof_file && <FileBtn path={b.proof_file}>{L('স্ক্রিনশট', 'Screenshot')}</FileBtn>}
              {b.da_expense_id ? <Badge tone="ok">{L('খাতায় মিলেছে', 'In accounts')}</Badge> : p.hub_id ? <Badge tone="warn">{L('খাতায় মেলেনি', 'Not matched')}</Badge> : null}
              {edit && <button className="secondary sm" onClick={() => open(kind, b)}><Icon name="edit" size={13} /></button>}
              {edit && <button className="secondary sm" onClick={() => void remove(b)}><Icon name="trash" size={13} /></button>}
            </div></article>)}</div>}
        {!light && <>
          <h3 className="oo-h3">{L('হিসাব খাতার খরচ থেকে (খাত মিললে)', 'From the daily accounts (matching category)')}</h3>
          {!p.hub_id ? <p className="muted small">{L('এই জায়গাটা কোনো হাবের সাথে যুক্ত নয়, তাই হিসাব খাতা থেকে কিছু আসছে না।', 'This place is not tied to a hub, so nothing comes from the accounts.')}</p>
            : !exp.length ? <p className="muted small">{L('গত ১২ মাসে এই হাবের খাতায় এই খাতের কোনো খরচ ওঠেনি।', 'No expense in this category on the hub’s sheets in 12 months.')}</p>
            : <div className="oo-list">{exp.slice(0, 24).map(x => <article key={x.id} className="oo-row sm">
              <div className="oo-main"><b>{dayBn(x.account_date, lang)}</b> · {x.expense_name} <span className="oo-amt">{tk(x.amount)}</span>
                <div className="muted small">{[x.category, x.bill_no && L(`বিল ${x.bill_no}`, `bill ${x.bill_no}`), x.voucher_no && L(`ভাউচার ${x.voucher_no}`, `voucher ${x.voucher_no}`),
                  x.has_file ? L('বিলের ছবি আছে', 'bill photo') : null].filter(Boolean).join(' · ')}</div></div>
              <div className="row-acts">{x.bill_id ? <Badge tone="ok">{L('বিল লেখা আছে', 'Bill written')}</Badge>
                : edit ? <button className="secondary sm" onClick={() => open(kind, undefined, x)}><Icon name="plus" size={13} />{L('এখান থেকে বিল', 'Bill from this')}</button> : <Badge tone="warn">{L('বিল বাকি', 'No bill')}</Badge>}</div>
            </article>)}</div>}
        </>}
      </section> })}
    {err && !f && <p className="da-error">{err}</p>}
    {f && <Modal wide title={`${L(BILL_KIND[f.kind][0], BILL_KIND[f.kind][1])} — ${f.id ? L('এডিট', 'edit') : L('নতুন বিল', 'new bill')}`} onClose={() => setF(null)}
      actions={<><button className="secondary" onClick={() => setF(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ', 'Save')}</button></>}>
      <div className="hr-form">
        <Field label={L('কোন মাসের', 'Month')} required><input type="month" value={f.month} max={thisMonth} onChange={e => setF({ ...f, month: e.target.value })} /></Field>
        <Field label={L('টাকা (৳)', 'Amount (৳)')} required><input inputMode="decimal" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label={L('পরিশোধের তারিখ', 'Paid on')}><input type="date" value={f.paid_on} max={today()} onChange={e => setF({ ...f, paid_on: e.target.value })} /></Field>
        <Field label={L('কীভাবে দেওয়া', 'Paid by')}><select value={f.method} onChange={e => setF({ ...f, method: e.target.value })}><option value="">—</option>
          {Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{L(v[0], v[1])}</option>)}</select></Field>
        <Field label="TrxID"><input value={f.txn} onChange={e => setF({ ...f, txn: e.target.value })} /></Field>
        {f.kind === 'electricity' && <Field label={L('ইউনিট (kWh)', 'Units (kWh)')}><input inputMode="decimal" value={f.units} onChange={e => setF({ ...f, units: e.target.value })} /></Field>}
        <Field label={L('কাকে দেওয়া', 'Paid to')}><input value={f.payee} onChange={e => setF({ ...f, payee: e.target.value })} /></Field>
        <Field label={L('তার মোবাইল', 'Their mobile')}><input inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
        {p.hub_id && <Field label={L('হিসাব খাতার কোন লাইন', 'Line in the accounts')} wide hint={L('খাত মিললে এখানে আসে; বেছে দিলে বিলটা খাতার সাথে মিলে যায়।', 'Lines of the matching category; pick one to tie the bill to it.')}>
          <select value={f.exp} onChange={e => setF({ ...f, exp: e.target.value })}><option value="">{L('— মেলানো হয়নি —', '— not tied —')}</option>
            {(lines.data ?? []).filter(x => x.kind === f.kind && (!x.bill_id || x.id === f.exp)).map(x => <option key={x.id} value={x.id}>{dayBn(x.account_date, lang)} · {x.expense_name} · ৳{n(x.amount)}</option>)}</select></Field>}
        <Field label={L('নোট', 'Note')} wide><input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      <div className="oo-uprow">
        <div><b className="small">{L('পেমেন্টের স্ক্রিনশট', 'Payment screenshot')}{f.kind === 'electricity' && <span className="bad"> *</span>}</b>
          <Upload property={p.id} value={f.proof} onChange={v => setF(c => c ? { ...c, proof: v } : c)} label={L('মোবাইল ব্যাংকিং স্ক্রিনশট দিন', 'Add mobile-banking screenshot')} onFile={x => void readShot(x)} />
          {ocr && <p className="muted small">{ocr}</p>}</div>
        <div><label className="small oo-check"><input type="checkbox" checked={f.has_memo} onChange={e => setF({ ...f, has_memo: e.target.checked })} />{L('মেমো / রসিদ পাওয়া গেছে', 'A memo / receipt was given')}</label>
          {f.has_memo ? <Upload property={p.id} value={f.memo_file} onChange={v => setF(c => c ? { ...c, memo_file: v } : c)} label={L('মেমোর ছবি দিন', 'Add the memo photo')} />
            : <p className="muted small">{L('মেমো না থাকলে সেভ করার সাথে সাথে নিজস্ব মেমো নম্বর (OM-…) তৈরি হবে, প্রিন্ট করে সই নেওয়া যাবে।', 'Without a memo the office’s own memo number (OM-…) is made on save; print it and take the signature.')}</p>}</div>
      </div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </>
}

// ================================================================ rent & contract
export function Rent({ ctx }: { ctx: Ctx }) {
  const { can } = useAuth()
  const { L, n, lang } = usePrefs()
  const { toast, node } = useToast()
  const p = ctx.p
  const split = roomSplit(ctx.rooms)
  const left = daysLeft(p.contract_to)
  const edit = can('office.property.edit')
  type F = { rent: string; advance: string; owner: string; phone: string; from: string; to: string; day: string; file: string | null }
  const [f, setF] = useState<F | null>(null)
  const [c, setC] = useState<{ from: string; to: string; rent: string; advance: string; text: string } | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const tk = (v: number | null) => v ? `৳ ${n(Math.round(v))}` : '—'
  async function save() {
    if (!f) return
    if (f.from && f.to && f.to < f.from) return setErr(L('চুক্তির শেষ তারিখ শুরুর আগে হতে পারে না', 'The contract cannot end before it starts'))
    setBusy(true); setErr('')
    try {
      await office.saveProperty({ rent: f.rent ? Number(f.rent) : null, advance: f.advance ? Number(f.advance) : null, owner_name: f.owner.trim() || null, owner_phone: f.phone.trim() || null,
        contract_from: f.from || null, contract_to: f.to || null, rent_due_day: f.day ? Number(f.day) : null, contract_file: f.file }, p.id)
      setF(null); await ctx.reloadPlaces(); toast(L('সেভ হয়েছে', 'Saved'))
    } catch (e) { setErr(opsFriendly(e)) } finally { setBusy(false) }
  }
  function newContract() {
    // plain calendar dates: work in UTC so a Dhaka (UTC+6) browser does not slip the day back by one
    const next = (iso: string) => { const x = new Date(iso + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10) }
    const start = p.contract_to ? next(p.contract_to) : today()
    const e = new Date(start + 'T00:00:00Z'); e.setUTCFullYear(e.getUTCFullYear() + 1); e.setUTCDate(e.getUTCDate() - 1)
    const end = e.toISOString().slice(0, 10)
    setC({ from: start, to: end, rent: p.rent?.toString() ?? '', advance: p.advance?.toString() ?? '', text: contractDraft(p, p.hub_id ? ctx.hubName(p.hub_id) : null, split, start, end, p.rent, p.advance) })
  }
  const redraft = (x: NonNullable<typeof c>) => contractDraft(p, p.hub_id ? ctx.hubName(p.hub_id) : null, split, x.from, x.to, x.rent ? Number(x.rent) : null, x.advance ? Number(x.advance) : null)
  return <>{node}
    <section className="panel">
      <div className="da-bar"><h2>{L('ভাড়া ও চুক্তি', 'Rent & contract')}</h2><span className="row-acts">
        {edit && <button className="secondary" onClick={() => { setErr(''); setF({ rent: p.rent?.toString() ?? '', advance: p.advance?.toString() ?? '', owner: p.owner_name ?? '', phone: p.owner_phone ?? '',
          from: p.contract_from ?? '', to: p.contract_to ?? '', day: p.rent_due_day?.toString() ?? '', file: p.contract_file }) }}><Icon name="edit" size={15} />{L('তথ্য বদলান', 'Edit')}</button>}
        <button onClick={newContract}><Icon name="doc" size={15} />{L('নতুন চুক্তি (AI)', 'New contract (AI)')}</button></span></div>
      <div className="da-stats">
        <Stat icon="cash" label={L('মাসিক রানিং ভাড়া', 'Running rent')} value={tk(p.rent)} sub={p.rent_due_day ? L(`প্রতি মাসের ${n(p.rent_due_day)} তারিখে`, `on day ${p.rent_due_day}`) : undefined} />
        <Stat icon="wallet" label={L('এডভান্স', 'Advance')} value={tk(p.advance)} sub={p.rent && p.advance ? L(`${n(Math.round(p.advance / p.rent * 10) / 10)} মাসের ভাড়ার সমান`, `${(p.advance / p.rent).toFixed(1)} months of rent`) : undefined} />
        <Stat icon="clock" tone={left == null ? 'warn' : left < 0 ? 'bad' : left <= 60 ? 'warn' : 'ok'} label={L('চুক্তির মেয়াদ', 'Contract')}
          value={left == null ? L('লেখা নেই', 'Not set') : left < 0 ? L(`${n(-left)} দিন আগে শেষ`, `ended ${-left} days ago`) : L(`${n(left)} দিন বাকি`, `${left} days left`)}
          sub={p.contract_from || p.contract_to ? `${p.contract_from ? dayBn(p.contract_from, lang) : '…'} → ${p.contract_to ? dayBn(p.contract_to, lang) : '…'}` : undefined} />
        <Stat icon="grid" label={L('রুম', 'Rooms')} value={n(ctx.rooms.length)} sub={L(`অফিস ${n(split.office)} · আবাসিক ${n(split.living)} · অন্য ${n(split.other)}`, `office ${split.office} · living ${split.living} · other ${split.other}`)} />
      </div>
      <dl className="oo-dl">
        <div><dt>{L('বাসা মালিক', 'Landlord')}</dt><dd>{p.owner_name || '—'}</dd></div>
        <div><dt>{L('নাম্বার', 'Number')}</dt><dd><Contact phone={p.owner_phone} /></dd></div>
        <div><dt>{L('ঠিকানা', 'Address')}</dt><dd>{[p.address, p.floor_note].filter(Boolean).join(', ') || '—'}</dd></div>
        <div><dt>{L('চুক্তির ছবি', 'Contract photo')}</dt><dd>{p.contract_file ? <FileBtn path={p.contract_file}>{L('চুক্তি দেখুন', 'Open contract')}</FileBtn> : <span className="bad">{L('দেওয়া হয়নি', 'Not added')}</span>}</dd></div>
      </dl>
      {left != null && left <= 60 && <p className="notice small">{left < 0 ? L('চুক্তির মেয়াদ শেষ — নতুন চুক্তি করে ছবি তুলে রাখুন।', 'The contract has ended — make a new one and add its photo.')
        : L('চুক্তি ৬০ দিনের মধ্যে শেষ হবে — মালিকের সাথে নবায়নের কথা বলুন; "নতুন চুক্তি (AI)" থেকে খসড়া বানাতে পারেন।', 'The contract ends within 60 days — talk to the landlord; "New contract (AI)" makes a draft.')}</p>}
    </section>
    <BillBlock ctx={ctx} kinds={['rent']} />
    {f && <Modal wide title={L('ভাড়া ও চুক্তির তথ্য', 'Rent & contract details')} onClose={() => setF(null)}
      actions={<><button className="secondary" onClick={() => setF(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ', 'Save')}</button></>}>
      <div className="hr-form">
        <Field label={L('মাসিক ভাড়া (৳)', 'Monthly rent (৳)')}><input inputMode="decimal" value={f.rent} onChange={e => setF({ ...f, rent: e.target.value })} /></Field>
        <Field label={L('এডভান্স (৳)', 'Advance (৳)')}><input inputMode="decimal" value={f.advance} onChange={e => setF({ ...f, advance: e.target.value })} /></Field>
        <Field label={L('ভাড়া দেওয়ার তারিখ (মাসের)', 'Rent day of month')}><input inputMode="numeric" value={f.day} onChange={e => setF({ ...f, day: e.target.value.replace(/\D/g, '').slice(0, 2) })} placeholder="5" /></Field>
        <Field label={L('বাসা মালিক', 'Landlord')}><input value={f.owner} onChange={e => setF({ ...f, owner: e.target.value })} /></Field>
        <Field label={L('মালিকের নাম্বার', 'Landlord number')}><input inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label={L('চুক্তি শুরু', 'Contract from')}><input type="date" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></Field>
        <Field label={L('চুক্তি শেষ', 'Contract to')}><input type="date" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></Field>
      </div>
      <b className="small">{L('চুক্তির ছবি / পিডিএফ', 'Contract photo / PDF')}</b>
      <Upload property={p.id} value={f.file} onChange={v => setF(x => x ? { ...x, file: v } : x)} label={L('চুক্তির ছবি দিন', 'Add the contract photo')} />
      {err && <p className="da-error">{err}</p>}
    </Modal>}
    {c && <Modal wide title={L('নতুন চুক্তির খসড়া', 'New contract draft')} onClose={() => setC(null)}
      actions={<><button className="secondary" onClick={() => setC(null)}>{L('বন্ধ', 'Close')}</button>
        <button className="secondary" onClick={() => { void navigator.clipboard?.writeText(c.text).then(() => toast(L('কপি হয়েছে', 'Copied'))) }}><Icon name="doc" size={14} />{L('কপি', 'Copy')}</button>
        <button onClick={() => printText(`XZM TEAM — চুক্তি ${p.name}`, c.text)}><Icon name="print" size={14} />{L('প্রিন্ট / পিডিএফ', 'Print / PDF')}</button></>}>
      <div className="hr-form">
        <Field label={L('শুরু', 'From')}><input type="date" value={c.from} onChange={e => { const x = { ...c, from: e.target.value }; setC({ ...x, text: redraft(x) }) }} /></Field>
        <Field label={L('শেষ', 'To')}><input type="date" value={c.to} onChange={e => { const x = { ...c, to: e.target.value }; setC({ ...x, text: redraft(x) }) }} /></Field>
        <Field label={L('নতুন ভাড়া (৳)', 'New rent (৳)')}><input inputMode="decimal" value={c.rent} onChange={e => { const x = { ...c, rent: e.target.value }; setC({ ...x, text: redraft(x) }) }} /></Field>
        <Field label={L('এডভান্স (৳)', 'Advance (৳)')}><input inputMode="decimal" value={c.advance} onChange={e => { const x = { ...c, advance: e.target.value }; setC({ ...x, text: redraft(x) }) }} /></Field>
      </div>
      <textarea className="oo-contract" rows={16} value={c.text} onChange={e => setC({ ...c, text: e.target.value })} />
      <AiBox label={L('নদী AI দিয়ে পুরো চুক্তি লিখুন', 'Write the full contract with Nodi AI')} hint={L('উপরের খসড়াটা অফিসের তথ্য থেকে তৈরি; AI আরও বিস্তারিত লিখে দেয়।', 'The draft above is built from the office data; the AI writes a fuller one.')}
        run={async () => { const t = await ops.ai('contract', { landlord: p.owner_name, landlord_phone: p.owner_phone, tenant: `XZM TEAM${p.hub_id ? ' — ' + ctx.hubName(p.hub_id) : ''}`,
          place: p.name, kind: PLACE_KIND[p.kind][0], address: p.address, floor: p.floor_note, rooms_office: split.office, rooms_residential: split.living, rooms_other: split.other,
          from: c.from, to: c.to, monthly_rent: c.rent || null, advance: c.advance || null, rent_day: p.rent_due_day, meter_no: p.meter_no }); if (t) setC(x => x ? { ...x, text: t } : x); return '' }} />
      <p className="muted small">{L('এটা খসড়া — সই করার আগে দুই পক্ষ পড়ে মিলিয়ে নিন। সই হলে ছবি তুলে "তথ্য বদলান" থেকে চুক্তির ছবি ও নতুন মেয়াদ বসান।', 'This is a draft — both sides must read it before signing. Once signed, add its photo and the new dates under "Edit".')}</p>
    </Modal>}
  </>
}

// ================================================================ electricity & wifi bills
export function Bills({ ctx }: { ctx: Ctx }) {
  const { can } = useAuth()
  const { L, n } = usePrefs()
  const p = ctx.p
  type F = { meter: string; rate: string; prov: string; wifi: string }
  const [f, setF] = useState<F | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function save() {
    if (!f) return
    setBusy(true); setErr('')
    try { await office.saveProperty({ meter_no: f.meter.trim() || null, unit_rate: f.rate ? Number(f.rate) : null, wifi_provider: f.prov.trim() || null, wifi_bill: f.wifi ? Number(f.wifi) : null }, p.id)
      setF(null); await ctx.reloadPlaces() } catch (e) { setErr(opsFriendly(e)) } finally { setBusy(false) }
  }
  return <>
    <section className="panel">
      <div className="da-bar"><h2>{L('মিটার ও ইন্টারনেট সংযোগ', 'Meter & internet line')}</h2>
        {can('office.property.edit') && <button className="secondary" onClick={() => { setErr(''); setF({ meter: p.meter_no ?? '', rate: p.unit_rate?.toString() ?? '', prov: p.wifi_provider ?? '', wifi: p.wifi_bill?.toString() ?? '' }) }}><Icon name="edit" size={15} />{L('বদলান', 'Edit')}</button>}</div>
      <dl className="oo-dl">
        <div><dt>{L('মিটার নম্বর', 'Meter no.')}</dt><dd>{p.meter_no || '—'}</dd></div>
        <div><dt>{L('ইউনিট রেট', 'Unit rate')}</dt><dd>{p.unit_rate ? `৳ ${n(p.unit_rate)}` : L(`লেখা নেই (৳${n(DEFAULT_RATE)} ধরা হচ্ছে)`, `not set (৳${DEFAULT_RATE} assumed)`)}</dd></div>
        <div><dt>{L('ওয়াইফাই কোম্পানি', 'Wifi provider')}</dt><dd>{p.wifi_provider || '—'}</dd></div>
        <div><dt>{L('মাসিক ওয়াইফাই বিল', 'Monthly wifi bill')}</dt><dd>{p.wifi_bill ? `৳ ${n(p.wifi_bill)}` : '—'}</dd></div>
      </dl>
      <p className="muted small">{L('বিদ্যুৎ বিল কেমন আসা উচিত আর কীভাবে কমবে — ', 'What the electricity should cost and how to lower it — ')}<Link to={scopePath(scopeOf(p.kind), 'power')}>{L('ইলেকট্রনিক ও বিদ্যুৎ হিসাব →', 'Devices & power →')}</Link></p>
    </section>
    <BillBlock ctx={ctx} kinds={['electricity', 'water', 'gas', 'wifi', 'other']} />
    {f && <Modal title={L('মিটার ও ইন্টারনেট', 'Meter & internet')} onClose={() => setF(null)}
      actions={<><button className="secondary" onClick={() => setF(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ', 'Save')}</button></>}>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label={L('মিটার নম্বর', 'Meter no.')}><input value={f.meter} onChange={e => setF({ ...f, meter: e.target.value })} /></Field>
        <Field label={L('ইউনিট রেট (৳)', 'Unit rate (৳)')} hint={L('বিলের মোট ÷ ইউনিট', 'bill total ÷ units')}><input inputMode="decimal" value={f.rate} onChange={e => setF({ ...f, rate: e.target.value })} /></Field>
        <Field label={L('ওয়াইফাই কোম্পানি', 'Wifi provider')}><input value={f.prov} onChange={e => setF({ ...f, prov: e.target.value })} /></Field>
        <Field label={L('মাসিক ওয়াইফাই বিল (৳)', 'Monthly wifi bill (৳)')}><input inputMode="decimal" value={f.wifi} onChange={e => setF({ ...f, wifi: e.target.value })} /></Field>
      </div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </>
}

// ================================================================ devices & power
export function Power({ ctx }: { ctx: Ctx }) {
  const { can } = useAuth()
  const { L, n } = usePrefs()
  const p = ctx.p
  const rows = useMemo(() => powerRows(ctx.assets), [ctx.assets])
  const bills = useLoad(() => can('office.bill.view') ? ops.bills(p.id).catch(() => [] as Bill[]) : Promise.resolve([] as Bill[]), [p.id])
  const last = (bills.data ?? []).find(b => b.kind === 'electricity') ?? null
  const rate = p.unit_rate ?? (last?.units ? Number(last.amount) / Number(last.units) : DEFAULT_RATE)
  const units = rows.reduce((s, r) => s + r.units, 0)
  const est = units * rate
  const tips = powerTips(rows, rate, last ? Number(last.amount) : null, last?.units ? Number(last.units) : null)
  const edit = can('office.asset.edit')
  const [err, setErr] = useState('')
  const roomName = Object.fromEntries(ctx.rooms.map(r => [r.id, r.name])) as Record<string, string>
  const byRoom = Object.entries(rows.reduce((m, r) => { const k = r.asset.room_id ?? ''; m[k] = (m[k] ?? 0) + r.units; return m }, {} as Record<string, number>)).sort((a, b) => b[1] - a[1])
  const tk = (v: number) => `৳ ${n(Math.round(v))}`
  async function set(a: Asset, col: 'watt' | 'hours_per_day', v: string) {
    const num = v.trim() === '' ? null : Number(v)
    if (num != null && (!Number.isFinite(num) || num < 0 || (col === 'hours_per_day' && num > 24))) return setErr(L('সংখ্যা ঠিক নয়', 'Not a valid number'))
    if (num === a[col]) return
    setErr('')
    try { await office.saveAsset({ [col]: num }, a.id); await ctx.reload() } catch (e) { setErr(opsFriendly(e)) }
  }
  return <>
    <div className="da-stats">
      <Stat icon="sun" label={L('ইলেকট্রনিক আইটেম', 'Electric items')} value={n(rows.reduce((s, r) => s + r.asset.quantity, 0))} sub={L(`${n(rows.length)} রকম`, `${rows.length} kinds`)} />
      <Stat icon="chart" label={L('মাসে আনুমানিক ইউনিট', 'Units a month (est.)')} value={n(Math.round(units))} sub={L(`রেট ৳${n(Math.round(rate * 100) / 100)}/ইউনিট`, `at ৳${rate.toFixed(2)}/unit`)} />
      <Stat icon="cash" tone="ok" label={L('বিল কেমন আসা উচিত', 'Bill should be about')} value={tk(est)} sub={L('লাইন চার্জ ও ভ্যাট বাদে', 'before line charge & VAT')} />
      <Stat icon="receipt" tone={last && est > 0 && Number(last.amount) > est * 1.3 ? 'bad' : undefined} label={L('গত আসল বিল', 'Last real bill')} value={last ? tk(Number(last.amount)) : '—'}
        sub={last && est > 0 ? L(`হিসাবের ${n(Math.round(Number(last.amount) / est * 100))}%`, `${Math.round(Number(last.amount) / est * 100)}% of the estimate`) : L('বিল লেখা হলে মেলানো হবে', 'compared once a bill is written')} />
    </div>
    <section className="panel">
      <h2>{L('বিল কমানোর সাজেশন', 'Ways to lower the bill')} <span className="count-pill">{n(tips.length)}</span></h2>
      {!rows.length ? <p className="muted">{L('লাইট, ফ্যান, পিসি ইত্যাদি "অফিসের রিসোর্স"-এ যোগ করলে এখানে হিসাব আসবে।', 'Add lights, fans, PCs under "Office resources" to see the numbers here.')} <Link to={scopePath(scopeOf(ctx.p.kind), 'assets')}>{L('যোগ করুন →', 'Add →')}</Link></p>
        : <ul className="duty-list">{tips.map((t, i) => <li key={i} className="duty"><Badge tone={t.tone}>{t.tone === 'bad' ? '!' : t.tone === 'warn' ? '•' : 'i'}</Badge>
          <span>{t.text}{t.save ? <b className="oo-save"> {L(`— মাসে প্রায় ${tk(t.save * rate)} কম`, `— about ${tk(t.save * rate)} less a month`)}</b> : null}</span></li>)}
          {!tips.length && <li className="muted">{L('চোখে পড়ার মতো কিছু নেই — ব্যবহার ঠিক আছে।', 'Nothing stands out.')}</li>}</ul>}
      {rows.length > 0 && <AiBox label={L('নদী AI-র পরামর্শ নিন', 'Ask Nodi AI')} run={() => ops.ai('power', { office: p.name, kind: p.kind, unit_rate: rate, estimated_units: Math.round(units), estimated_bill: Math.round(est),
        last_bill: last ? { month: last.bill_month, amount: last.amount, units: last.units } : null,
        devices: rows.map(r => ({ name: r.asset.name, kind: r.asset.kind, room: r.asset.room_id ? roomName[r.asset.room_id] : null, qty: r.asset.quantity, watt: r.watt, hours_per_day: r.hours, units_month: Math.round(r.units), assumed: r.guessed })) })} />}
    </section>
    {rows.length > 0 && <section className="panel">
      <div className="da-bar"><h2>{L('কোন রুমে কত', 'By room')}</h2></div>
      <div className="oo-bars">{byRoom.map(([k, u]) => <div key={k} className="oo-bar"><span className="oo-bar-l">{k ? roomName[k] ?? '—' : L('রুম দেওয়া নেই', 'No room')}</span>
        <span className="oo-bar-t"><i style={{ width: `${Math.max(3, u / (byRoom[0]?.[1] || 1) * 100)}%` }} /></span><span className="oo-bar-v">{n(Math.round(u))} {L('ইউনিট', 'units')} · {tk(u * rate)}</span></div>)}</div>
    </section>}
    {rows.length > 0 && <section className="panel">
      <div className="da-bar"><h2>{L('ডিভাইস অনুযায়ী', 'By device')}</h2></div>
      <p className="muted small">{L('ওয়াট আর দিনে কত ঘণ্টা চলে — লেখা না থাকলে সাধারণ মান ধরা হয় (ধূসর)। ঘরে লিখে বাইরে চাপ দিলেই সেভ হয়।', 'Watt and hours a day — a usual value is assumed (grey) when blank. Type and tap outside to save.')}</p>
      {err && <p className="da-error">{err}</p>}
      <div className="table-scroll"><table className="oo-table"><thead><tr><th>{L('ডিভাইস', 'Device')}</th><th className="r">{L('সংখ্যা', 'Qty')}</th><th className="r">{L('ওয়াট', 'Watt')}</th><th className="r">{L('ঘণ্টা/দিন', 'Hours/day')}</th><th className="r">{L('ইউনিট/মাস', 'Units/mo')}</th><th className="r">{L('৳/মাস', '৳/mo')}</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.asset.id}>
          <td><b>{r.asset.name}</b><span className="sec">{[L(ASSET_KIND[r.asset.kind]?.[0] ?? r.asset.kind, ASSET_KIND[r.asset.kind]?.[1] ?? r.asset.kind), r.asset.room_id && roomName[r.asset.room_id]].filter(Boolean).join(' · ')}</span></td>
          <td className="r">{n(r.asset.quantity)}</td>
          <td className="r">{edit ? <input className={`oo-num${r.asset.watt == null ? ' guess' : ''}`} inputMode="numeric" defaultValue={r.asset.watt ?? ''} placeholder={String(r.watt)} key={`w${r.asset.watt}`} onBlur={e => void set(r.asset, 'watt', e.target.value)} aria-label={L('ওয়াট', 'Watt')} /> : n(r.watt)}</td>
          <td className="r">{edit ? <input className={`oo-num${r.asset.hours_per_day == null ? ' guess' : ''}`} inputMode="decimal" defaultValue={r.asset.hours_per_day ?? ''} placeholder={String(r.hours)} key={`h${r.asset.hours_per_day}`} onBlur={e => void set(r.asset, 'hours_per_day', e.target.value)} aria-label={L('ঘণ্টা', 'Hours')} /> : n(r.hours)}</td>
          <td className="r">{n(Math.round(r.units * 10) / 10)}</td><td className="r"><b>{tk(r.units * rate)}</b></td></tr>)}</tbody>
        <tfoot><tr><td colSpan={4}><b>{L('মোট', 'Total')}</b></td><td className="r"><b>{n(Math.round(units))}</b></td><td className="r"><b>{tk(est)}</b></td></tr></tfoot></table></div>
    </section>}
  </>
}

// ================================================================ report to the zonal manager / lend
export function NoticeModal({ property, asset, kind: k0, onClose, onDone }: { property: Property; asset?: Asset | null; kind: NoticeKind; onClose: () => void; onDone: (no: string, notified: number) => void }) {
  const { L } = usePrefs()
  const [kind, setKind] = useState<NoticeKind>(k0)
  const [title, setTitle] = useState(asset?.name ?? ''); const [item, setItem] = useState(asset?.kind ?? 'other')
  const [qty, setQty] = useState('1'); const [note, setNote] = useState(''); const [urgent, setUrgent] = useState(false)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function send() {
    if (!title.trim()) return setErr(L('কী নষ্ট বা কী লাগবে লিখুন', 'Write what is broken or needed'))
    setBusy(true); setErr('')
    try { const r = await ops.noticeSend({ property: property.id, kind, title: title.trim(), asset: asset?.id ?? null, itemKind: item, qty: Math.max(1, Number(qty) || 1), note: note.trim() || null, urgent }); onDone(r.no, r.notified) }
    catch (e) { setErr(opsFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title={L('সমস্যার রিপোর্ট', 'Report a problem')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void send()}><Icon name="bell" size={14} />{L('রিপোর্ট পাঠান', 'Send report')}</button></>}>
    <div className="da-seg" style={{ marginBottom: 10 }}>{(['broken', 'need', 'other'] as NoticeKind[]).map(k => <button key={k} type="button" className={k === kind ? 'sm' : 'secondary sm'} onClick={() => setKind(k)}>{L(NOTICE_KIND[k][0], NOTICE_KIND[k][1])}</button>)}</div>
    <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
      {!asset && <Field label={L('কোন জিনিস', 'Which item')}><select value={item} onChange={e => { setItem(e.target.value); if (!title.trim() || Object.values(ASSET_KIND).some(v => v[0] === title || v[1] === title)) setTitle(L(ASSET_KIND[e.target.value][0], ASSET_KIND[e.target.value][1])) }}>
        {Object.entries(ASSET_KIND).map(([k, v]) => <option key={k} value={k}>{L(v[0], v[1])}</option>)}</select></Field>}
      <Field label={kind === 'need' ? L('কী লাগবে', 'What is needed') : L('কী হয়েছে', 'What happened')} required><input value={title} onChange={e => setTitle(e.target.value)} /></Field>
      <Field label={L('কয়টা', 'How many')}><input inputMode="numeric" value={qty} onChange={e => setQty(e.target.value)} /></Field>
      <Field label={L('বিস্তারিত', 'Details')} wide><textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder={L('যেমন: চালু হয় না / ডেস্ক ৩-এর জন্য', 'e.g. will not start / for desk 3')} /></Field>
    </div>
    <label className="small oo-check"><input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} />{L('জরুরি', 'Urgent')}</label>
    <p className="muted small">{property.name} — {L('রিপোর্টটা সাথে সাথে জোনাল ম্যানেজার দেখতে পাবেন, আর হাব ম্যানেজারের কাছে যাচাইয়ের জন্য যাবে।', 'the zonal manager sees the report at once, and it goes to the hub manager to be verified.')}</p>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

export function LendModal({ ctx, asset, lentOut, onClose, onDone }: { ctx: Ctx; asset: Asset; lentOut: number; onClose: () => void; onDone: () => void }) {
  const { L, n } = usePrefs()
  const others = ctx.all.filter(x => x.id !== asset.property_id)
  const [to, setTo] = useState(others[0]?.id ?? ''); const [qty, setQty] = useState('1'); const [note, setNote] = useState('')
  // A person on each side, if the hubs want one: who hands it over, who takes it.
  const [fromPerson, setFromPerson] = useState<EmpLite | null>(null); const [toPerson, setToPerson] = useState<EmpLite | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const free = asset.quantity - lentOut
  const toPlace = others.find(x => x.id === to)
  const fromHub = ctx.hubName(ctx.p.hub_id) || ctx.p.name; const toHub = (toPlace && ctx.hubName(toPlace.hub_id)) || toPlace?.name || ''
  async function go() {
    if (!to) return setErr(L('কোন অফিসে দেবেন, বেছে নিন', 'Choose the office'))
    setBusy(true); setErr('')
    try { await ops.lend(asset.id, to, Math.max(1, Number(qty) || 1), note.trim() || null, fromPerson?.id ?? null, toPerson?.id ?? null); onDone() } catch (e) { setErr(opsFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title={L(`"${asset.name}" অন্য অফিসে দিন`, `Lend "${asset.name}"`)} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy || free < 1} onClick={() => void go()}>{L('দিন', 'Lend')}</button></>}>
    <p className="muted small">{L(`আছে ${n(asset.quantity)}টা, দেওয়া যাবে ${n(free)}টা। জিনিসটা ${ctx.p.name}-এর নামেই গোনা থাকবে; অন্য অফিস শুধু ব্যবহার করবে।`, `${asset.quantity} here, ${free} free. It stays counted under ${ctx.p.name}; the other office only uses it.`)}</p>
    <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Field label={L('কোন অফিস / হাবে', 'To which office / hub')}><select value={to} onChange={e => setTo(e.target.value)}>
        {others.map(x => <option key={x.id} value={x.id}>{PLACE_KIND[x.kind][2]} {x.name}</option>)}</select></Field>
      <Field label={L('কয়টা', 'How many')}><input inputMode="numeric" value={qty} onChange={e => setQty(e.target.value)} /></Field>
      <EmpPicker label={L(`${fromHub}-এর ব্যক্তি (ইচ্ছা হলে)`, `Person at ${fromHub} (optional)`)} value={fromPerson} onPick={setFromPerson} hint={L('যিনি দিচ্ছেন', 'who hands it over')} />
      <EmpPicker label={L(`${toHub || 'যে হাব নিচ্ছে'}-এর ব্যক্তি (ইচ্ছা হলে)`, `Person at ${toHub || 'the receiving hub'} (optional)`)} value={toPerson} onPick={setToPerson} hint={L('যিনি নিচ্ছেন', 'who takes it')} />
      <Field label={L('নোট', 'Note')} wide><input value={note} onChange={e => setNote(e.target.value)} /></Field>
    </div>
    <p className="small"><b>{L('দিচ্ছে', 'From')}:</b> {fromHub}{fromPerson ? ` · ${empLabel(fromPerson)}` : ''} &nbsp; → &nbsp; <b>{L('নিচ্ছে', 'To')}:</b> {toHub || '—'}{toPerson ? ` · ${empLabel(toPerson)}` : ''}</p>
    {!others.length && <p className="notice small">{L('আপনি আর কোনো অফিস দেখতে পান না — জোনাল ম্যানেজার এই কাজটা করতে পারবেন।', 'You can see no other office — the zonal manager can do this.')}</p>}
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

export function Notices({ ctx }: { ctx: Ctx }) {
  const { can } = useAuth()
  const { L, n, lang } = usePrefs()
  const { toast, node } = useToast()
  const [all, setAll] = useState(can('office.notice.approve'))
  const [openOnly, setOpenOnly] = useState(true)
  /** 'all' | 'todo' (not verified yet) | 'done' (verified, with the manager's name) */
  const [vf, setVf] = useState<'all' | 'todo' | 'done'>('all')
  const list = useLoad(() => ops.notices(all ? null : ctx.p.id), [all, ctx.p.id])
  const [add, setAdd] = useState(false); const [err, setErr] = useState('')
  const place = Object.fromEntries(ctx.all.map(x => [x.id, x.name])) as Record<string, string>
  const rows = (list.data ?? []).filter(x => (!openOnly || x.status === 'open' || x.status === 'seen') && (vf === 'all' || (vf === 'done') === !!x.hub_verified_at))
  const toVerify = (list.data ?? []).filter(x => !x.hub_verified_at && (x.status === 'open' || x.status === 'seen')).length
  async function verify(x: Notice) {
    const note = await askText(L('যাচাইয়ের নোট (ইচ্ছা হলে)', 'Verification note (optional)'), { optional: true, ok: L('যাচাই করলাম', 'Verify') })
    if (note === null) return
    setErr('')
    try { await ops.noticeVerify(x.id, note || null); await list.reload(); toast(L(`${x.notice_no} — যাচাই হয়েছে`, `${x.notice_no} verified`)) } catch (e) { setErr(opsFriendly(e)) }
  }
  async function act(x: Notice, status: 'seen' | 'done' | 'rejected', decision?: string) {
    let reply: string | null = null; let fixed = false
    if (decision) {
      const detail = await askText(decision, { ok: L('সিদ্ধান্ত পাঠান', 'Send decision') })
      if (!detail?.trim()) return
      reply = decision + ' — ' + detail.trim()
    }
    if (status === 'rejected') { reply = await askWith(L)(L('কেন হবে না, লিখুন', 'Why not?')); if (!reply) return }
    if (status === 'done') { const done = await askText(L('কী ব্যবস্থা হলো?', 'What was done?'), { optional: true, ok: L('সম্পন্ন', 'Done') }); if (done === null) return; reply = done || null
      if (x.kind === 'broken' && x.asset_id) fixed = await askConfirm(L('জিনিসটা ঠিক হয়ে গেছে?', 'Is the item working again?'), { detail: L('"হ্যাঁ" দিলে জিনিসটার অবস্থা "ভালো" হবে।', '"Yes" marks the item good.'), ok: L('হ্যাঁ, ঠিক হয়েছে', 'Yes, it works'), cancel: L('না, এখনো না', 'Not yet') }) }
    setErr('')
    try { await ops.noticeUpdate(x.id, status, reply, fixed); await Promise.all([list.reload(), ctx.reload()]) } catch (e) { setErr(opsFriendly(e)) }
  }
  return <section className="panel">{node}
    <div className="da-bar"><h2>{L('নষ্ট / লাগবে — হাবের প্রবলেম সেন্টার', 'Broken / needed — hub problem centre')} <span className="count-pill">{n(rows.length)}</span>{toVerify > 0 && <> <Badge tone="warn">{L(`যাচাই বাকি ${n(toVerify)}`, `${toVerify} to verify`)}</Badge></>}</h2>
      <span className="row-acts">
        <span className="da-seg"><button className={all ? 'secondary sm' : 'sm'} onClick={() => setAll(false)}>{ctx.p.name}</button><button className={all ? 'sm' : 'secondary sm'} onClick={() => setAll(true)}>{L('সব অফিস', 'All offices')}</button></span>
        <label className="small oo-check"><input type="checkbox" checked={openOnly} onChange={e => setOpenOnly(e.target.checked)} />{L('শুধু খোলা', 'Open only')}</label>
        <select value={vf} onChange={e => setVf(e.target.value as typeof vf)} aria-label={L('যাচাই', 'Verification')}>
          <option value="all">{L('সব', 'All')}</option><option value="todo">{L('যাচাই বাকি', 'Not verified')}</option><option value="done">{L('যাচাই হয়েছে (ভেরিফাই তালিকা)', 'Verified list')}</option></select>
        {can('office.notice.create') && <button onClick={() => setAdd(true)}><Icon name="plus" size={15} />{L('চাহিদা পাঠান', 'Send a request')}</button>}</span></div>
    <p className="muted small">{L('রিপোর্ট জমা দিলেই জোনাল ম্যানেজার দেখতে পান; হাব ম্যানেজার যাচাই করলে তাঁর নাম ও সময় এখানে লেখা থাকে।', 'A report reaches the zonal manager as soon as it is sent; when the hub manager verifies it, their name and the time are kept here.')}</p>
    <p className="muted small">{L('রিসোর্স তালিকা থেকে নষ্ট সরঞ্জাম রিপোর্ট করুন, অথবা এখান থেকে নতুন চাহিদা পাঠান।', 'Report damaged equipment from the resources list, or send a new request here.')}</p>
    {err || list.error ? <p className="da-error">{err || opsFriendly(list.error)}</p> : null}
    {!rows.length ? <p className="muted">{L('কোনো রিপোর্ট নেই।', 'No reports.')}</p> : <div className="oo-list">{rows.map(x => <article key={x.id} className="oo-row">
      <div className="oo-main"><Badge tone={NOTICE_KIND[x.kind][2]}>{L(NOTICE_KIND[x.kind][0], NOTICE_KIND[x.kind][1])}</Badge> <b>{x.title}{x.quantity > 1 ? ` ×${n(x.quantity)}` : ''}</b>
        {x.priority === 'urgent' && <> <Badge tone="bad">{L('জরুরি', 'Urgent')}</Badge></>}
        <div className="muted small">{[x.notice_no, place[x.property_id], x.by_name, dayBn(x.created_at, lang)].filter(Boolean).join(' · ')}</div>
        {x.note && <div className="small">{x.note}</div>}
        {x.hub_verified_at
          ? <div className="small"><Badge tone="ok">{L('যাচাই', 'Verified')}</Badge> {x.hub_verified_by_name} · {dayBn(x.hub_verified_at, lang)}{x.hub_verify_note ? ` — ${x.hub_verify_note}` : ''}</div>
          : (x.status === 'open' || x.status === 'seen') && <div className="small"><Badge tone="warn">{L('হাব ম্যানেজারের যাচাই বাকি', 'Waiting for the hub manager')}</Badge></div>}
        {x.reply && <div className="small oo-reply"><Icon name="check" size={12} /> {x.decided_by_name}: {x.reply}</div>}</div>
      <div className="row-acts"><Badge tone={NOTICE_STATUS[x.status][2]}>{L(NOTICE_STATUS[x.status][0], NOTICE_STATUS[x.status][1])}</Badge>
        {can('office.notice_verify.approve') && !x.hub_verified_at && (x.status === 'open' || x.status === 'seen') && <button className="sm" onClick={() => void verify(x)}><Icon name="check" size={14} />{L('যাচাই করুন', 'Verify')}</button>}
        {can('office.notice.approve') && (x.status === 'open' || x.status === 'seen') && <>
          {x.status === 'open' && <button className="secondary sm" onClick={() => void act(x, 'seen')}>{L('দেখেছি', 'Seen')}</button>}
          <RowMenu label={L('সিদ্ধান্ত দিন', 'Give a decision')} items={[
            ...(x.kind === 'broken' ? [L('মেরামতের অনুমতি', 'Approve repair')] : []),
            L('অন্য হাব থেকে বরাদ্দ', 'Allocate from another hub'),
            L('ক্রয়ের অনুমোদন', 'Approve purchase'),
            L('আরও তথ্য চান', 'Request more information'),
          ].map(label => ({ label, onClick: () => void act(x, 'seen', label) }))} />
          <button className="sm" onClick={() => void act(x, 'done')}>{L('ব্যবস্থা হয়েছে', 'Done')}</button>
          <button className="secondary sm" onClick={() => void act(x, 'rejected')}>{L('হবে না', 'Decline')}</button></>}</div>
    </article>)}</div>}
    {add && <NoticeModal property={ctx.p} kind="need" onClose={() => setAdd(false)} onDone={(no, c) => { setAdd(false); void list.reload()
      toast(c ? L(`${no} — জোনাল ম্যানেজারকে জানানো হয়েছে`, `${no} — the zonal manager was told`) : L(`${no} জমা হয়েছে`, `${no} saved`)) }} />}
  </section>
}

// ================================================================ vehicles, locks, CCTV, logins
export function Security({ ctx }: { ctx: Ctx }) {
  const { can } = useAuth()
  const { L, n } = usePrefs()
  const { toast, node } = useToast()
  const p = ctx.p
  const veh = useLoad(() => p.hub_id ? ops.vehicles(p.hub_id).catch(() => null) : Promise.resolve(null), [p.hub_id])
  const sec = useLoad(() => ops.secrets(p.id).catch(() => [] as Secret[]), [p.id])
  const locks = ctx.assets.filter(a => a.kind === 'lock')
  const count = (k: string) => ctx.assets.filter(a => a.kind === k).reduce((s, a) => s + a.quantity, 0)
  const specs = (k: string) => ctx.assets.filter(a => a.kind === k && a.spec).map(a => a.spec).join(', ')
  const vName = Object.fromEntries((veh.data ?? []).map(v => [v.id, v.name + (v.reg_no ? ` (${v.reg_no})` : '')])) as Record<string, string>
  const roomName = Object.fromEntries(ctx.rooms.map(r => [r.id, r.name])) as Record<string, string>
  const edit = can('office.asset.edit'); const sEdit = can('office.secret.edit')
  type LF = { id?: string; name: string; qty: string; holder: EmpLite | null; vehicle: string; room: string; note: string }
  type SF = { id?: string; kind: SecretKind; label: string; asset: string; username: string; secret: string; note: string }
  const [lf, setLf] = useState<LF | null>(null); const [sf, setSf] = useState<SF | null>(null)
  const [show, setShow] = useState<Record<string, boolean>>({})
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function saveLock() {
    if (!lf) return
    if (!lf.name.trim()) return setErr(L('তালার নাম দিন (যেমন মেইন গেট)', 'Name the lock (e.g. main gate)'))
    setBusy(true); setErr('')
    try { await office.saveAsset({ property_id: p.id, kind: 'lock', name: lf.name.trim(), quantity: Math.max(1, Number(lf.qty) || 1), holder_id: lf.holder?.id ?? null,
      vehicle_id: lf.vehicle || null, room_id: lf.vehicle ? null : lf.room || null, note: lf.note.trim() || null, ...(lf.id ? {} : { condition: 'good' }) }, lf.id)
      setLf(null); await ctx.reload(); toast(L('সেভ হয়েছে', 'Saved')) } catch (e) { setErr(opsFriendly(e)) } finally { setBusy(false) }
  }
  async function saveSecret() {
    if (!sf) return
    if (!sf.label.trim()) return setErr(L('কীসের লগইন, লিখুন', 'Say what this login is for'))
    setBusy(true); setErr('')
    try { await ops.secretSave({ property_id: p.id, kind: sf.kind, label: sf.label.trim(), asset_id: sf.asset || null, username: sf.username.trim() || null, secret: sf.secret || null, note: sf.note.trim() || null }, sf.id)
      setSf(null); await sec.reload(); toast(L('সেভ হয়েছে', 'Saved')) } catch (e) { setErr(opsFriendly(e)) } finally { setBusy(false) }
  }
  async function dropSecret(s: Secret) {
    const why = await askWith(L)(L(`"${s.label}" সরানোর কারণ`, `Why remove "${s.label}"?`)); if (!why) return
    try { await ops.secretSave({ archived_at: new Date().toISOString(), archive_reason: why }, s.id); await sec.reload() } catch (e) { setErr(opsFriendly(e)) }
  }
  const pcs = ctx.assets.filter(a => a.kind === 'pc' || a.kind === 'laptop' || a.kind === 'dvr' || a.kind === 'router' || a.kind === 'cctv')
  return <>{node}
    <section className="panel">
      <div className="da-bar"><h2><Icon name="truck" size={18} /> {L('হাবের গাড়ি', 'Hub vehicles')} <span className="count-pill">{n(veh.data?.length ?? 0)}</span></h2>
        <Link className="secondary sm" to="/app/fleet">{L('গাড়ির পাতা →', 'Fleet page →')}</Link></div>
      {!p.hub_id ? <p className="muted small">{L('এই জায়গাটা কোনো হাবের সাথে যুক্ত নয়।', 'This place is not tied to a hub.')}</p>
        : veh.data == null ? <p className="muted small">{L('গাড়ির তালিকা দেখার অনুমতি নেই বা লোড হয়নি।', 'The vehicle list is not available to you.')}</p>
        : !veh.data.length ? <p className="muted">{L('এই হাবে কোনো গাড়ি দেওয়া নেই।', 'No vehicle at this hub.')}</p>
        : <div className="route-cards">{veh.data.map(v => { const vl = locks.filter(a => a.vehicle_id === v.id)
          return <article key={v.id} className="route-card"><header><span className="ti"><Icon name="truck" size={18} /></span><div style={{ flex: 1, minWidth: 0 }}><b>{v.name}</b>
            <div className="muted small">{[v.reg_no, v.kind].filter(Boolean).join(' · ')}</div></div></header>
            <div className="small">{(['driver', 'helper'] as const).map(r => { const c = v.crew.find(x => x.role === r); return c ? <div key={r}><Icon name="user" size={12} /> {r === 'driver' ? L('ড্রাইভার', 'Driver') : L('হেল্পার', 'Helper')}: <b>{c.name}</b>{c.code ? ` (${c.code})` : ''}</div>
              : r === 'driver' ? <div key={r} className="bad">{L('ড্রাইভার দেওয়া নেই', 'No driver')}</div> : null })}</div>
            <div className="chips">{vl.length ? vl.map(a => <span key={a.id} className="chip"><Icon name="key" size={12} />{a.name}{a.quantity > 1 ? ` ×${n(a.quantity)}` : ''}{a.holder_id ? ` — ${ctx.emp[a.holder_id]?.full_name ?? ''}` : ''}</span>)
              : <span className="muted small">{L('এই গাড়ির কোনো তালা লেখা নেই', 'No lock listed for this vehicle')}</span>}</div>
          </article> })}</div>}
    </section>
    <section className="panel">
      <div className="da-bar"><h2><Icon name="key" size={18} /> {L('তালা ও চাবি', 'Locks & keys')} <span className="count-pill">{n(locks.reduce((s, a) => s + a.quantity, 0))}</span></h2>
        {edit && <button onClick={() => { setErr(''); setLf({ name: '', qty: '1', holder: null, vehicle: '', room: '', note: '' }) }}><Icon name="plus" size={15} />{L('তালা যোগ', 'Add lock')}</button>}</div>
      {!locks.length ? <p className="muted">{L('হাব ও গাড়িতে কয়টা তালা, কোনটার চাবি কোন স্টাফের কাছে — যোগ করুন।', 'Add the locks of the hub and vehicles, and who keeps each key.')}</p>
        : <div className="oo-list">{locks.map(a => <article key={a.id} className="oo-row sm">
          <div className="oo-main"><b>{a.name}</b>{a.quantity > 1 ? ` ×${n(a.quantity)}` : ''} <span className="muted small">· {a.vehicle_id ? `${L('গাড়ি', 'Vehicle')}: ${vName[a.vehicle_id] ?? '—'}` : a.room_id ? roomName[a.room_id] : L('হাব', 'Hub')}</span>
            <div className="small">{a.holder_id ? <><Icon name="user" size={12} /> {L('চাবি', 'Key')}: <b>{empLabel(ctx.emp[a.holder_id])}</b></> : <span className="bad">{L('চাবি কার কাছে লেখা নেই', 'Nobody holds the key')}</span>}{a.note ? ` · ${a.note}` : ''}</div></div>
          {edit && <div className="row-acts"><button className="secondary sm" onClick={() => { setErr(''); setLf({ id: a.id, name: a.name, qty: String(a.quantity), holder: a.holder_id ? ctx.emp[a.holder_id] ?? null : null, vehicle: a.vehicle_id ?? '', room: a.room_id ?? '', note: a.note ?? '' }) }}><Icon name="edit" size={13} />{L('এসাইন', 'Assign')}</button></div>}
        </article>)}</div>}
    </section>
    <section className="panel">
      <div className="da-bar"><h2><Icon name="eye" size={18} /> {L('সিসি ক্যামেরা ও নেটওয়ার্ক', 'CCTV & network')}</h2><Link className="secondary sm" to={scopePath(scopeOf(ctx.p.kind), 'assets')}>{L('রিসোর্সে যোগ করুন →', 'Add under resources →')}</Link></div>
      <div className="da-stats">
        <Stat icon="eye" label={L('সিসি ক্যামেরা', 'Cameras')} value={n(count('cctv'))} />
        <Stat icon="box" label="DVR / NVR" value={n(count('dvr'))} sub={specs('dvr') || L('কত পোর্ট — "মাপ/ধরন"-এ লিখুন', 'ports — write under size/type')} />
        <Stat icon="globe" label={L('রাউটার', 'Routers')} value={n(count('router'))} sub={specs('router') || undefined} />
        <Stat icon="log" label={L('তার (গজ)', 'Cable (yards)')} value={n(count('cable'))} />
      </div>
      {count('dvr') > 0 && count('cctv') === 0 && <p className="notice small">{L('DVR আছে কিন্তু ক্যামেরা লেখা নেই — ক্যামেরার সংখ্যা যোগ করুন।', 'A DVR is listed but no cameras.')}</p>}
    </section>
    <section className="panel">
      <div className="da-bar"><h2><Icon name="shield" size={18} /> {L('ইউজার নেম ও পাসওয়ার্ড', 'User names & passwords')} <span className="count-pill">{n(sec.data?.length ?? 0)}</span></h2>
        {(sEdit || pcs.some(a => a.holder_id)) && <button onClick={() => { setErr(''); setSf({ kind: 'cctv', label: '', asset: '', username: '', secret: '', note: '' }) }}><Icon name="plus" size={15} />{L('যোগ', 'Add')}</button>}</div>
      <p className="muted small">{L('সিসি/DVR, রাউটার, ওয়াইফাই আর পিসির লক। শুধু যাঁদের অনুমতি আছে আর যাঁর নামে জিনিসটা আছে তাঁরাই দেখেন। পিসিতে লক দিলে এখানে শেয়ার করতে হবে।', 'CCTV/DVR, router, wifi and PC locks. Seen only by those allowed and the holder of the item. A PC lock must be shared here.')}</p>
      {!(sec.data ?? []).length ? <p className="muted">{can('office.secret.view') ? L('কিছু লেখা নেই।', 'Nothing yet.') : L('আপনার নামে থাকা জিনিসের লক ছাড়া কিছু দেখা যাবে না।', 'You only see locks of items you hold.')}</p>
        : <div className="oo-list">{(sec.data ?? []).map(s => <article key={s.id} className="oo-row sm">
          <div className="oo-main"><Badge tone="info">{L(SECRET_KIND[s.kind][0], SECRET_KIND[s.kind][1])}</Badge> <b>{s.label}</b>
            <div className="small oo-cred">{s.username && <span>{L('ইউজার', 'User')}: <code>{s.username}</code></span>}
              <span>{L('পাসওয়ার্ড', 'Password')}: <code>{show[s.id] ? s.secret || '—' : '••••••'}</code></span></div>
            {s.note && <div className="muted small">{s.note}</div>}</div>
          <div className="row-acts"><button className="secondary sm" onClick={() => setShow(x => ({ ...x, [s.id]: !x[s.id] }))}><Icon name="eye" size={13} />{show[s.id] ? L('লুকান', 'Hide') : L('দেখুন', 'Show')}</button>
            {sEdit && <button className="secondary sm" onClick={() => { setErr(''); setSf({ id: s.id, kind: s.kind, label: s.label, asset: s.asset_id ?? '', username: s.username ?? '', secret: s.secret ?? '', note: s.note ?? '' }) }}><Icon name="edit" size={13} /></button>}
            {sEdit && <button className="secondary sm" onClick={() => void dropSecret(s)}><Icon name="trash" size={13} /></button>}</div>
        </article>)}</div>}
      {pcs.filter(a => a.kind === 'pc' || a.kind === 'laptop').length > 0 && can('office.secret.view') && (() => {
        const noLock = pcs.filter(a => (a.kind === 'pc' || a.kind === 'laptop') && !(sec.data ?? []).some(s => s.asset_id === a.id))
        return noLock.length ? <p className="muted small">{L(`${n(noLock.length)}টা পিসির লক এখানে শেয়ার করা নেই: `, `${noLock.length} PC(s) have no lock shared here: `)}{noLock.map(a => a.name + (a.holder_id ? ` (${ctx.emp[a.holder_id]?.full_name ?? ''})` : '')).join(', ')}</p> : null })()}
    </section>
    {err && !lf && !sf && <p className="da-error">{err}</p>}
    {lf && <Modal title={lf.id ? L('তালা এসাইন / এডিট', 'Assign / edit lock') : L('তালা যোগ', 'Add lock')} onClose={() => setLf(null)}
      actions={<><button className="secondary" onClick={() => setLf(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void saveLock()}>{L('সেভ', 'Save')}</button></>}>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label={L('কোন তালা', 'Which lock')} required><input value={lf.name} onChange={e => setLf({ ...lf, name: e.target.value })} placeholder={L('যেমন মেইন গেট / শাটার', 'e.g. main gate / shutter')} /></Field>
        <Field label={L('কয়টা', 'How many')}><input inputMode="numeric" value={lf.qty} onChange={e => setLf({ ...lf, qty: e.target.value })} /></Field>
        <Field label={L('গাড়ির তালা হলে — কোন গাড়ি', 'Vehicle (if a vehicle lock)')}><select value={lf.vehicle} onChange={e => setLf({ ...lf, vehicle: e.target.value })}><option value="">{L('— হাবের তালা —', '— hub lock —')}</option>
          {(veh.data ?? []).map(v => <option key={v.id} value={v.id}>{vName[v.id]}</option>)}</select></Field>
        {!lf.vehicle && <Field label={L('কোন রুম / গেট', 'Room / gate')}><select value={lf.room} onChange={e => setLf({ ...lf, room: e.target.value })}><option value="">—</option>
          {ctx.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>}
        <EmpPicker label={L('চাবি কার কাছে (এমপ্লয়ি আইডি)', 'Key held by (employee ID)')} value={lf.holder} onPick={e => setLf(x => x ? { ...x, holder: e } : x)} />
        <Field label={L('নোট', 'Note')}><input value={lf.note} onChange={e => setLf({ ...lf, note: e.target.value })} placeholder={L('যেমন বাড়তি চাবি ম্যানেজারের কাছে', 'e.g. spare key with the manager')} /></Field>
      </div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
    {sf && <Modal title={L('ইউজার নেম ও পাসওয়ার্ড', 'User name & password')} onClose={() => setSf(null)}
      actions={<><button className="secondary" onClick={() => setSf(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void saveSecret()}>{L('সেভ', 'Save')}</button></>}>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label={L('ধরন', 'Kind')}><select value={sf.kind} onChange={e => setSf({ ...sf, kind: e.target.value as SecretKind })}>{Object.entries(SECRET_KIND).map(([k, v]) => <option key={k} value={k}>{L(v[0], v[1])}</option>)}</select></Field>
        <Field label={L('কীসের', 'For what')} required><input value={sf.label} onChange={e => setSf({ ...sf, label: e.target.value })} placeholder={L('যেমন DVR লগইন / ডেস্ক ১-এর পিসি', 'e.g. DVR login / desk 1 PC')} /></Field>
        <Field label={L('কোন জিনিসের (ইচ্ছা হলে)', 'Item (optional)')} wide><select value={sf.asset} onChange={e => { const a = pcs.find(x => x.id === e.target.value); setSf({ ...sf, asset: e.target.value, label: sf.label || a?.name || '' }) }}><option value="">—</option>
          {pcs.map(a => <option key={a.id} value={a.id}>{a.name}{a.holder_id ? ` — ${ctx.emp[a.holder_id]?.full_name ?? ''}` : ''}</option>)}</select></Field>
        <Field label={L('ইউজার নেম', 'User name')}><input autoComplete="off" value={sf.username} onChange={e => setSf({ ...sf, username: e.target.value })} /></Field>
        <Field label={L('পাসওয়ার্ড / পিন', 'Password / PIN')}><input autoComplete="off" value={sf.secret} onChange={e => setSf({ ...sf, secret: e.target.value })} /></Field>
        <Field label={L('নোট', 'Note')} wide><input value={sf.note} onChange={e => setSf({ ...sf, note: e.target.value })} placeholder={L('যেমন অ্যাপের নাম, IP ঠিকানা', 'e.g. app name, IP address')} /></Field>
      </div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </>
}

// ================================================================ who lives here
export function People({ ctx }: { ctx: Ctx }) {
  const { can } = useAuth()
  const { L, n, lang } = usePrefs()
  const { toast, node } = useToast()
  const p = ctx.p
  const res = useLoad(() => ops.residents(p.id), [p.id])
  const key = (res.data ?? []).map(r => r.employee_id).sort().join(',')
  const emps = useLoad(() => sorting.employeesByIds(key ? key.split(',') : []).catch(() => [] as EmpLite[]), [key])
  const emp = Object.fromEntries((emps.data ?? []).map(e => [e.id, e])) as Record<string, EmpLite>
  const roomName = Object.fromEntries(ctx.rooms.map(r => [r.id, r.name])) as Record<string, string>
  const edit = can('office.property.edit')
  type F = { id?: string; who: EmpLite | null; room: string; since: string; note: string }
  const [f, setF] = useState<F | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function save() {
    if (!f) return
    if (!f.who) return setErr(L('এমপ্লয়ি আইডি দিন', 'Give the employee ID'))
    setBusy(true); setErr('')
    try { await ops.residentSave({ property_id: p.id, employee_id: f.who.id, room_id: f.room || null, since: f.since || today(), note: f.note.trim() || null }, f.id)
      setF(null); await res.reload(); toast(L('সেভ হয়েছে', 'Saved')) } catch (e) { setErr(opsFriendly(e)) } finally { setBusy(false) }
  }
  async function remove(id: string, name: string) {
    const why = await askWith(L)(L(`${name} আর এখানে থাকেন না — কারণ / কবে থেকে`, `${name} no longer lives here — why / since when`)); if (!why) return
    try { await ops.residentSave({ archived_at: new Date().toISOString(), archive_reason: why }, id); await res.reload() } catch (e) { setErr(opsFriendly(e)) }
  }
  const list = res.data ?? []
  const living = ctx.rooms.filter(r => r.kind === 'room')
  return <section className="panel">{node}
    <div className="da-bar"><h2>{L('এখানে কারা থাকেন', 'Who lives here')} <span className="count-pill">{n(list.length)}</span></h2>
      {edit && <button onClick={() => { setErr(''); setF({ who: null, room: living[0]?.id ?? '', since: today(), note: '' }) }}><Icon name="plus" size={15} />{L('লোক এসাইন', 'Assign a person')}</button>}</div>
    {p.kind !== 'residence' && <p className="muted small">{L('এটা আবাসিক ফ্ল্যাট নয় — তবু অফিসে/গ্যারেজে কেউ থাকলে এখানে লিখে রাখা যায়।', 'This is not a residence — still, anyone staying here can be listed.')}</p>}
    {p.capacity != null && <p className="small">{L(`ধারণক্ষমতা ${n(p.capacity)} জন · আছেন ${n(list.length)} জন`, `Room for ${p.capacity} · ${list.length} staying`)}{list.length > p.capacity ? <b className="bad"> — {L('বেশি হয়ে গেছে', 'over capacity')}</b> : null}</p>}
    {(err || res.error) && !f ? <p className="da-error">{err || opsFriendly(res.error)}</p> : null}
    {!list.length ? <p className="muted">{L('কাউকে এসাইন করা হয়নি।', 'Nobody assigned yet.')}</p> :
      <div className="route-cards">{[...living.map(r => r.id), ''].map(rid => { const here = list.filter(x => (x.room_id ?? '') === rid || (rid === '' && x.room_id && !living.some(r => r.id === x.room_id)))
        if (!here.length && rid === '') return null
        return <article key={rid || 'none'} className="route-card"><header><span className="ti"><Icon name="home" size={18} /></span><div style={{ flex: 1 }}><b>{rid ? roomName[rid] : L('রুম দেওয়া নেই', 'No room')}</b>
          <div className="muted small">{L(`${n(here.length)} জন`, `${here.length} people`)}</div></div></header>
          {here.length ? here.map(x => <div key={x.id} className="oo-res"><span><Icon name="user" size={13} /> <b>{empLabel(emp[x.employee_id]) || '…'}</b>
            <span className="muted small"> · {dayBn(x.since, lang)} {L('থেকে', 'since')}{emp[x.employee_id]?.mobile ? ` · ${emp[x.employee_id]?.mobile}` : ''}{x.note ? ` · ${x.note}` : ''}</span></span>
            {edit && <button className="secondary sm" aria-label={L('সরান', 'Remove')} onClick={() => void remove(x.id, emp[x.employee_id]?.full_name ?? '')}><Icon name="x" size={12} /></button>}</div>)
            : <span className="muted small">{L('খালি', 'Empty')}</span>}
        </article> })}</div>}
    {f && <Modal title={L('লোক এসাইন', 'Assign a person')} onClose={() => setF(null)}
      actions={<><button className="secondary" onClick={() => setF(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ', 'Save')}</button></>}>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <EmpPicker label={L('কে থাকবেন (এমপ্লয়ি আইডি)', 'Who (employee ID)')} value={f.who} onPick={e => setF(x => x ? { ...x, who: e } : x)} />
        <Field label={L('কোন রুমে', 'Room')}><select value={f.room} onChange={e => setF({ ...f, room: e.target.value })}><option value="">—</option>{ctx.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <Field label={L('কবে থেকে', 'Since')}><input type="date" value={f.since} max={today()} onChange={e => setF({ ...f, since: e.target.value })} /></Field>
        <Field label={L('নোট', 'Note')}><input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </section>
}

// ================================================================ the zone picture
const ZONE_KINDS = ['pc', 'laptop', 'monitor', 'printer', 'fan', 'light', 'cctv', 'lock', 'chair_exec', 'chair_plastic', 'table', 'weight_machine', 'mobile', 'ip_phone']

export function Zone({ ctx }: { ctx: Ctx }) {
  const { can } = useAuth()
  const { L, n } = usePrefs()
  const assets = useLoad(() => ops.allAssets(), [])
  const loans = useLoad(() => ops.loans().catch(() => [] as Loan[]), [])
  const notices = useLoad(() => ops.notices(null).catch(() => [] as Notice[]), [])
  const [err, setErr] = useState('')
  const all = ctx.all
  const open = (notices.data ?? []).filter(x => x.status === 'open' || x.status === 'seen')
  const A = assets.data ?? []; const LN = loans.data ?? []
  const label = (k: string) => L(ASSET_KIND[k]?.[0] ?? k, ASSET_KIND[k]?.[1] ?? k)
  /** "পিসি ৩ (নাটোর হাব ১টি ব্যবহার করছে)" */
  const line = (pl: Property, k: string) => {
    const own = A.filter(a => a.property_id === pl.id && a.kind === k); const qty = own.reduce((s, a) => s + a.quantity, 0)
    if (!qty) return null
    const out = LN.filter(l => l.from_property_id === pl.id && l.asset_kind === k)
    return `${label(k)} ${n(qty)}${out.length ? ` (${out.map(l => L(`${l.to_name} ${n(l.quantity)}টি ব্যবহার করছে`, `${l.to_name} uses ${l.quantity}`)).join(', ')})` : ''}`
  }
  const rentTotal = all.reduce((s, x) => s + Number(x.rent ?? 0), 0)
  const broken = A.filter(a => a.condition !== 'good')
  const ending = all.filter(x => { const d = daysLeft(x.contract_to); return d != null && d <= 60 })
  // What needs doing first, worked out from the data.
  const todo: Array<[string, 'bad' | 'warn' | 'info']> = []
  for (const x of all) {
    const d = daysLeft(x.contract_to)
    if (d != null && d < 0) todo.push([L(`${x.name}: চুক্তির মেয়াদ ${n(-d)} দিন আগে শেষ — নতুন চুক্তি দরকার`, `${x.name}: contract ended ${-d} days ago`), 'bad'])
    else if (d != null && d <= 60) todo.push([L(`${x.name}: চুক্তি ${n(d)} দিনে শেষ হবে — নবায়নের কথা বলুন`, `${x.name}: contract ends in ${d} days`), 'warn'])
    if (x.rent && !x.contract_file) todo.push([L(`${x.name}: ভাড়া আছে কিন্তু চুক্তির ছবি নেই`, `${x.name}: rent but no contract photo`), 'info'])
    if (x.rent && !x.advance && x.kind !== 'residence') todo.push([L(`${x.name}: এডভান্স কত দেওয়া — লেখা নেই`, `${x.name}: advance not recorded`), 'info'])
    const b = A.filter(a => a.property_id === x.id && (a.condition === 'broken' || a.condition === 'repair'))
    if (b.length) todo.push([L(`${x.name}: ${n(b.length)}টা জিনিস নষ্ট / মেরামত লাগবে (${b.slice(0, 4).map(a => a.name).join(', ')})`, `${x.name}: ${b.length} broken / to repair`), 'warn'])
    if (!A.some(a => a.property_id === x.id)) todo.push([L(`${x.name}: কোনো জিনিসপত্র লেখা হয়নি`, `${x.name}: no items listed`), 'info'])
  }
  for (const x of open) { const age = Math.floor((Date.now() - new Date(x.created_at).getTime()) / 86400000)
    if (x.priority === 'urgent' || age >= 3) todo.push([L(`${x.notice_no} (${all.find(q => q.id === x.property_id)?.name ?? ''}): "${x.title}" ${n(age)} দিন ধরে অপেক্ষায়`, `${x.notice_no}: "${x.title}" waiting ${age} days`), x.priority === 'urgent' ? 'bad' : 'warn']) }
  const order = { bad: 0, warn: 1, info: 2 }; todo.sort((a, b) => order[a[1]] - order[b[1]])
  async function back(l: Loan) {
    if (!await askConfirm(L(`${l.asset_name} (${l.to_name}) ফেরত এসেছে?`, `${l.asset_name} returned from ${l.to_name}?`), { ok: L('হ্যাঁ, ফেরত এসেছে', 'Yes, returned') })) return
    try { await ops.lendReturn(l.id, null); await loans.reload() } catch (e) { setErr(opsFriendly(e)) }
  }
  const hubs = [...new Set(all.map(x => x.hub_id ?? ''))]
  return <>
    <div className="da-stats">
      <Stat icon="home" label={L('অফিস / ফ্ল্যাট / গ্যারেজ', 'Places')} value={n(all.length)} sub={(Object.keys(PLACE_KIND) as Array<keyof typeof PLACE_KIND>).map(k => { const c = all.filter(x => x.kind === k).length; return c ? `${L(PLACE_KIND[k][0], PLACE_KIND[k][1])} ${n(c)}` : null }).filter(Boolean).join(' · ')} />
      <Stat icon="cash" label={L('মাসিক মোট ভাড়া', 'Total rent a month')} value={`৳ ${n(Math.round(rentTotal))}`} sub={ending.length ? L(`${n(ending.length)}টা চুক্তি শেষের পথে`, `${ending.length} contracts ending`) : undefined} tone={ending.length ? 'warn' : undefined} />
      <Stat icon="alert" tone={broken.length ? 'warn' : 'ok'} label={L('নষ্ট / মেরামত / হারানো', 'Broken / repair / lost')} value={n(broken.length)} />
      <Stat icon="bell" tone={open.length ? 'warn' : 'ok'} label={L('খোলা রিপোর্ট', 'Open reports')} value={n(open.length)} sub={LN.length ? L(`${n(LN.length)}টা জিনিস অন্য হাবে ব্যবহার হচ্ছে`, `${LN.length} items on loan`) : undefined} />
    </div>
    <section className="panel">
      <h2>{L('আগে যা করা দরকার', 'What to do first')} <span className="count-pill">{n(todo.length)}</span></h2>
      <p className="muted small">{L('অপারেশনের ডাটা দেখে নিজে থেকে বের করা — চুক্তি, বিল, নষ্ট জিনিস, অপেক্ষায় থাকা রিপোর্ট।', 'Worked out from the operational data: contracts, broken items, waiting reports.')}</p>
      {todo.length ? <ul className="duty-list">{todo.slice(0, 30).map(([t, tone], i) => <li key={i} className="duty"><Badge tone={tone}>{tone === 'bad' ? '!' : tone === 'warn' ? '•' : 'i'}</Badge> <span>{t}</span></li>)}</ul> : <p className="muted">{L('সব ঠিক আছে।', 'All good.')}</p>}
      {can('nodi.assistant.view') && <AiBox label={L('নদী AI-র অপারেশন পরামর্শ', 'Nodi AI operations advice')} run={() => ops.ai('insight', {
        offices: all.map(x => ({ name: x.name, kind: x.kind, hub: x.hub_id ? ctx.hubName(x.hub_id) : null, rent: x.rent, advance: x.advance, contract_to: x.contract_to, contract_days_left: daysLeft(x.contract_to), has_contract_photo: !!x.contract_file,
          items: Object.fromEntries(ZONE_KINDS.map(k => [k, A.filter(a => a.property_id === x.id && a.kind === k).reduce((s, a) => s + a.quantity, 0)]).filter(([, v]) => v)),
          broken: A.filter(a => a.property_id === x.id && a.condition !== 'good').map(a => `${a.name} (${a.condition})`) })),
        loans: LN.map(l => ({ item: l.asset_name, qty: l.quantity, owner: l.from_name, used_by: l.to_name, since: l.since })),
        open_reports: open.map(x => ({ no: x.notice_no, office: all.find(q => q.id === x.property_id)?.name, kind: x.kind, title: x.title, qty: x.quantity, urgent: x.priority === 'urgent', since: x.created_at.slice(0, 10) })) })} />}
    </section>
    <section className="panel">
      <div className="da-bar"><h2>{L('হাব অনুযায়ী জিনিসপত্র', 'Items by hub')}</h2></div>
      <p className="muted small">{L('এক হাবের জিনিস অন্য হাব ব্যবহার করলেও সেটা যার, তার নামেই গোনা থাকে — পাশে লেখা থাকে কে ব্যবহার করছে।', 'An item used by another hub stays counted under its owner — with who is using it.')}</p>
      {assets.error || err ? <p className="da-error">{err || opsFriendly(assets.error)}</p> : null}
      <div className="oo-zone">{hubs.map(h => <div key={h || 'none'} className="oo-hub"><h3>{h ? ctx.hubName(h) : L('হাব ছাড়া', 'No hub')}</h3>
        {all.filter(x => (x.hub_id ?? '') === h).map(x => { const lines = ZONE_KINDS.map(k => line(x, k)).filter(Boolean) as string[]
          const others = A.filter(a => a.property_id === x.id && !ZONE_KINDS.includes(a.kind)).reduce((s, a) => s + a.quantity, 0)
          const borrowed = LN.filter(l => l.to_property_id === x.id); const d = daysLeft(x.contract_to)
          return <article key={x.id} className="oo-place"><div className="oo-place-h"><b>{PLACE_KIND[x.kind][2]} {x.name}</b> <span className="muted small">{L(PLACE_KIND[x.kind][0], PLACE_KIND[x.kind][1])}{x.rent ? ` · ৳${n(Math.round(x.rent))}/${L('মাস', 'mo')}` : ''}</span>
            {d != null && d <= 60 && <Badge tone={d < 0 ? 'bad' : 'warn'}>{d < 0 ? L('চুক্তি শেষ', 'Contract ended') : L(`চুক্তি ${n(d)} দিন`, `contract ${d}d`)}</Badge>}</div>
            <div className="chips">{lines.map(t => <span key={t} className="chip">{t}</span>)}{others > 0 && <span className="chip">{L(`অন্যান্য ${n(others)}`, `other ${others}`)}</span>}
              {!lines.length && !others && <span className="muted small">{L('কিছু লেখা নেই', 'Nothing listed')}</span>}</div>
            {borrowed.length > 0 && <div className="small oo-borrow">{L('অন্যের জিনিস ব্যবহার করছে', 'Using from others')}: {borrowed.map(l => `${l.asset_name} ${n(l.quantity)} (${l.from_name})`).join(', ')}</div>}
          </article> })}</div>)}</div>
    </section>
    {LN.length > 0 && <section className="panel">
      <h2>{L('অন্য হাবে ব্যবহার হচ্ছে', 'On loan')} <span className="count-pill">{n(LN.length)}</span></h2>
      <div className="oo-list">{LN.map(l => <article key={l.id} className="oo-row sm"><div className="oo-main"><b>{l.asset_name}</b> ×{n(l.quantity)} · {l.from_name} → <b>{l.to_name}</b>
        <div className="muted small">{l.since}{l.note ? ` · ${l.note}` : ''}</div></div>
        {l.can_return && <div className="row-acts"><button className="secondary sm" onClick={() => void back(l)}>{L('ফেরত এসেছে', 'Returned')}</button></div>}</article>)}</div>
    </section>}
  </>
}

/** Loans of this place's items (asset id → how many are out), for the resources list. */
export function useLoans(dep: string) {
  const q = useLoad(() => ops.loans().catch(() => [] as Loan[]), [dep])
  const out = useMemo(() => (q.data ?? []).reduce((m, l) => { m[l.asset_id] = (m[l.asset_id] ?? 0) + l.quantity; return m }, {} as Record<string, number>), [q.data])
  return { list: q.data ?? [], out, reload: q.reload }
}
