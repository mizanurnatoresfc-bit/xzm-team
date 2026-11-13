import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  da, num, taka, dateBn, timeBn, duration, todayDhaka, EVENT_LABEL,
  type Sheet, type DaSettings, type Template, type RiderLine, type MerchantPayment, type Expense, type OcrResult,
} from '../../lib/dailyAccounts'
import { readImage, parsePayment, parseBill } from '../../lib/ocr'
import { printArea } from '../../lib/xlsx'
import { AccountsShell, Stat, StatusBadge, Badge, Modal, Field, ErrorNote, useLoad, useToast } from './ui'

type Tab = 'riders' | 'merchant' | 'expense' | 'history'

export function DailySheet() {
  const { id = '' } = useParams()
  const sheet = useLoad(() => da.sheet(id), [id])
  const settings = useLoad(() => da.settings(), [])
  const templates = useLoad(() => da.templates().catch(() => [] as Template[]), [])
  const [tab, setTab] = useState<Tab>('riders')
  const { toast, node } = useToast()
  const s = sheet.data

  // Page tracking: entry, a heartbeat every minute, exit
  useEffect(() => {
    let visit: string | null = null
    let timer = 0
    void da.enter(id).then(v => { visit = v; if (v) timer = window.setInterval(() => void da.ping(v).catch(() => undefined), 60000) }).catch(() => undefined)
    const leave = () => { if (visit) void da.ping(visit, true).catch(() => undefined) }
    window.addEventListener('pagehide', leave)
    return () => { window.clearInterval(timer); window.removeEventListener('pagehide', leave); leave() }
  }, [id])

  if (sheet.error) return <AccountsShell title="হিসাব খাতা"><ErrorNote error={sheet.error} /><Link to="/app/accounts/daily">← তালিকায় ফিরুন</Link></AccountsShell>
  if (!s || !settings.data) return <AccountsShell title="হিসাব খাতা"><p className="muted">লোড হচ্ছে…</p></AccountsShell>
  const t = s.totals
  const reload = async (msg?: string) => { await sheet.reload(); if (msg) toast(msg) }

  return <AccountsShell title={`${s.hub.name} · ${dateBn(s.session.account_date)}`}
    subtitle={`হিসাব নং ${num(s.session.no)} · শুরু করেছেন ${s.session.started_by_name ?? '—'}${s.session.started_by_code ? ` (ID ${s.session.started_by_code})` : ''} · ${timeBn(s.session.started_at)}`}
    actions={<><StatusBadge status={s.session.status} /><button className="secondary" onClick={() => printArea(`Daily-account-${s.hub.code}-${s.session.account_date}`)}>প্রিন্ট / PDF</button></>}>
    {node}
    {s.session.status === 'correction' && s.session.verify_note && <p className="notice">সংশোধন প্রয়োজন: {s.session.verify_note}</p>}
    {s.session.status === 'approved' && <p className="da-ok">অনুমোদিত — {s.session.verified_by_name} · {timeBn(s.session.verified_at)}{s.session.verify_note ? ` · “${s.session.verify_note}”` : ''}</p>}
    {t && <section className="da-stats">
      <Stat label="রাইডার" value={num(t.riders)} /><Stat label="ডেলিভারি" value={num(t.delivery)} /><Stat label="পিকআপ" value={num(t.pickup)} />
      <Stat label="টাকা" value={taka(t.amount)} /><Stat label="বকেয়া" value={taka(t.due)} tone={t.due > 0 ? 'warn' : undefined} />
      <Stat label="মোবাইল ব্যাংকিং" value={taka(t.mobile_banking)} sub="আলাদা হিসাব" />
      <Stat label="মার্চেন্ট পেমেন্ট" value={taka(t.merchant_cash)} />
      <Stat label="যাতায়াত খরচ" value={taka(t.transport_expense)} /><Stat label="কর্মী খরচ" value={taka(t.employee_expense)} />
      <Stat label="মোট খরচ" value={taka(t.merchant_cash + t.transport_expense + t.employee_expense)} />
    </section>}

    <div className="da-tabs no-print" role="tablist">
      {([['riders', `রাইডার (${num(s.riders.length)})`], ['merchant', `মার্চেন্ট পেমেন্ট (${num(s.merchant_payments.length)})`],
         ['expense', `খরচ (${num(s.expenses.length)})`], ['history', 'ইতিহাস']] as Array<[Tab, string]>)
        .map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? '' : 'secondary'} onClick={() => setTab(k)}>{l}</button>)}
    </div>
    <div className="print-area">
      {tab === 'riders' && <RidersTab s={s} settings={settings.data} reload={reload} />}
      {tab === 'merchant' && <MerchantTab s={s} settings={settings.data} reload={reload} />}
      {tab === 'expense' && <ExpenseTab s={s} settings={settings.data} templates={templates.data ?? []} reload={reload} />}
      {tab === 'history' && <HistoryTab s={s} />}
    </div>
    <ActionBar s={s} reload={reload} />
  </AccountsShell>
}

// ---------------------------------------------------------------------------- riders
const F_LABEL: Record<string, string> = { delivery_qty: 'ডেলিভারি', pickup_qty: 'পিকআপ', amount: 'টাকা', paid_amount: 'জমা দিয়েছেন',
  due: 'বকেয়া', mobile_banking: 'মোবাইল ব্যাংকিং', remarks: 'মন্তব্য' }
type RiderDraft = { line?: string; code: string; name?: string; mobile?: string | null; hub?: string | null; allowed?: boolean
  delivery: string; pickup: string; amount: string; paid: string; due: string; mb: string; remarks: string }
const emptyRider: RiderDraft = { code: '', delivery: '', pickup: '', amount: '', paid: '', due: '', mb: '', remarks: '' }

function RidersTab({ s, settings, reload }: { s: Sheet; settings: DaSettings; reload: (m?: string) => Promise<void> }) {
  const fields = settings['da.rider_fields']
  const manualDue = settings['da.due_rule'] === 'manual'
  const [d, setD] = useState<RiderDraft | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [remove, setRemove] = useState<RiderLine | null>(null)
  const staff = useLoad(() => s.can_edit ? da.hubEmployees(s.hub.id) : Promise.resolve([]), [s.hub.id, s.can_edit])
  const missing = (staff.data ?? []).filter(e => e.is_rider && !s.riders.some(r => r.employee_id === e.employee_id))

  async function lookup(code: string) {
    if (!d || !code.trim()) return
    try {
      const r = (await da.lookupEmployee(s.hub.id, code))[0]
      setD(x => x && ({ ...x, name: r?.full_name ?? '', mobile: r?.mobile ?? null, hub: r?.hub_name ?? null, allowed: r ? r.allowed : false }))
    } catch (e) { setErr(e) }
  }
  async function save() {
    if (!d) return
    setBusy(true); setErr(null)
    try {
      await da.saveRider({ session: s.session.id, code: d.code, delivery: +d.delivery || 0, pickup: +d.pickup || 0, amount: +d.amount || 0,
        paid: +d.paid || 0, due: +d.due || 0, mb: +d.mb || 0, remarks: d.remarks, line: d.line })
      setD(null); await reload('সংরক্ষিত হয়েছে')
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  const edit = (r: RiderLine) => setD({ line: r.id, code: r.employee_code, name: r.rider_name, mobile: r.mobile, allowed: true,
    delivery: String(r.delivery_qty), pickup: String(r.pickup_qty), amount: String(r.amount), paid: String(r.paid_amount),
    due: String(r.due_input), mb: String(r.mobile_banking), remarks: r.remarks ?? '' })

  return <section className="panel">
    <div className="da-bar"><h2>রাইডার-ভিত্তিক হিসাব</h2>
      {s.can_edit && <div className="row no-print">{missing.length > 0 && <span className="muted small">তালিকায় নেই: {missing.map(m => m.full_name).join(', ')}</span>}
        <button onClick={() => { setErr(null); setD({ ...emptyRider }) }}>＋ রাইডার যোগ</button></div>}</div>
    <p className="muted small">বকেয়া নিয়ম: {manualDue ? 'নিজে লিখবেন' : 'টাকা − জমা'} · মোবাইল ব্যাংকিং: {settings['da.mobile_banking_rule'] === 'separate' ? 'আলাদা হিসাব (বকেয়ার সাথে যোগ-বিয়োগ হয় না)' : settings['da.mobile_banking_rule'] === 'reduces_due' ? 'বকেয়া থেকে বাদ যায়' : 'বকেয়ার সাথে যোগ হয়'}</p>
    <div className="da-table-wrap"><table className="da-table">
      <thead><tr><th>নং</th><th>Employee ID</th><th>রাইডারের নাম</th><th>মোবাইল</th>
        {fields.filter(f => f !== 'remarks').map(f => <th key={f} className="r">{F_LABEL[f]}</th>)}{fields.includes('remarks') && <th>মন্তব্য</th>}<th className="no-print" /></tr></thead>
      <tbody>{s.riders.map(r => <tr key={r.id}>
        <td data-l="নং">{num(r.no)}</td><td data-l="ID">{r.employee_code}</td><td data-l="নাম"><b>{r.rider_name}</b></td><td data-l="মোবাইল">{r.mobile ?? '—'}</td>
        {fields.includes('delivery_qty') && <td data-l="ডেলিভারি" className="r">{num(r.delivery_qty)}</td>}
        {fields.includes('pickup_qty') && <td data-l="পিকআপ" className="r">{num(r.pickup_qty)}</td>}
        {fields.includes('amount') && <td data-l="টাকা" className="r">{taka(r.amount)}</td>}
        {fields.includes('paid_amount') && <td data-l="জমা" className="r">{taka(r.paid_amount)}</td>}
        {fields.includes('due') && <td data-l="বকেয়া" className="r"><b className={r.due > 0 ? 'bad' : ''}>{taka(r.due)}</b></td>}
        {fields.includes('mobile_banking') && <td data-l="মোবাইল ব্যাংকিং" className="r">{taka(r.mobile_banking)}</td>}
        {fields.includes('remarks') && <td data-l="মন্তব্য">{r.remarks ?? ''}</td>}
        <td className="no-print">{s.can_edit && <span className="row"><button className="secondary sm" onClick={() => edit(r)}>এডিট</button>
          <button className="danger sm" onClick={() => setRemove(r)}>বাদ</button></span>}</td></tr>)}
        {s.riders.length === 0 && <tr><td colSpan={12} className="muted">এখনো কোনো রাইডার যোগ হয়নি।</td></tr>}</tbody></table></div>

    {d && <Modal title={d.line ? 'রাইডারের হিসাব এডিট' : 'রাইডার যোগ'} onClose={() => setD(null)} wide
      actions={<><button className="secondary" onClick={() => setD(null)}>বাতিল</button><button disabled={busy || !d.code || d.allowed === false} onClick={() => void save()}>{busy ? 'সেভ হচ্ছে…' : 'সেভ'}</button></>}>
      <div className="da-grid3">
        <Field label="Employee ID *" hint={d.name ? <>{d.name} · {d.mobile ?? '—'} · {d.hub ?? ''} {d.allowed === false && <b className="bad"> — এই হাবের সক্রিয় কর্মী নন</b>}</> : 'আইডি লিখলেই নাম, মোবাইল ও হাব চলে আসবে'}>
          <input autoFocus inputMode="numeric" value={d.code} onChange={e => setD({ ...d, code: e.target.value, name: undefined, allowed: undefined })} onBlur={e => void lookup(e.target.value)} list="da-staff" /></Field>
        <datalist id="da-staff">{(staff.data ?? []).map(e => <option key={e.employee_id} value={e.employee_code}>{e.full_name}</option>)}</datalist>
        {fields.includes('delivery_qty') && <Field label="ডেলিভারি সংখ্যা"><input type="number" min={0} value={d.delivery} onChange={e => setD({ ...d, delivery: e.target.value })} /></Field>}
        {fields.includes('pickup_qty') && <Field label="পিকআপ সংখ্যা"><input type="number" min={0} value={d.pickup} onChange={e => setD({ ...d, pickup: e.target.value })} /></Field>}
        {fields.includes('amount') && <Field label="টাকা (Amount)"><input type="number" min={0} value={d.amount} onChange={e => setD({ ...d, amount: e.target.value })} /></Field>}
        {fields.includes('paid_amount') && <Field label="জমা দিয়েছেন (নগদ)"><input type="number" min={0} value={d.paid} onChange={e => setD({ ...d, paid: e.target.value })} /></Field>}
        {fields.includes('due') && (manualDue
          ? <Field label="বকেয়া (Due)"><input type="number" value={d.due} onChange={e => setD({ ...d, due: e.target.value })} /></Field>
          : <Field label="বকেয়া (স্বয়ংক্রিয়)"><input readOnly value={num((+d.amount || 0) - (+d.paid || 0))} /></Field>)}
        {fields.includes('mobile_banking') && <Field label="মোবাইল ব্যাংকিং" hint="আলাদা হিসাব হিসেবে থাকবে"><input type="number" min={0} value={d.mb} onChange={e => setD({ ...d, mb: e.target.value })} /></Field>}
        {fields.includes('remarks') && <Field label="মন্তব্য" wide><input value={d.remarks} onChange={e => setD({ ...d, remarks: e.target.value })} /></Field>}
      </div>
      <ErrorNote error={err} />
    </Modal>}
    {remove && <RemoveDialog what={`${remove.rider_name} (ID ${remove.employee_code})`} onClose={() => setRemove(null)}
      onOk={async reason => { await da.removeLine('rider', remove.id, reason); setRemove(null); await reload('বাদ দেওয়া হয়েছে') }} />}
  </section>
}

function RemoveDialog({ what, onClose, onOk }: { what: string; onClose: () => void; onOk: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState(''); const [err, setErr] = useState<unknown>(null)
  return <Modal title="লাইন বাদ দেবেন?" onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>বাতিল</button><button className="danger" disabled={!reason.trim()} onClick={() => void onOk(reason).catch(setErr)}>বাদ দিন</button></>}>
    <p>{what}</p><Field label="কারণ *"><input autoFocus value={reason} onChange={e => setReason(e.target.value)} /></Field>
    <p className="muted small">লাইনটি মুছে যায় না — “বাদ” হিসেবে কারণসহ রেকর্ডে থাকে।</p><ErrorNote error={err} />
  </Modal>
}

// ---------------------------------------------------------------------------- OCR upload helper
function useOcrUpload(sessionId: string, settings: DaSettings) {
  const [progress, setProgress] = useState<number | null>(null)
  const [err, setErr] = useState<unknown>(null)
  async function run(file: File, parse: (text: string, conf: number) => OcrResult) {
    setErr(null)
    const path = await da.upload(sessionId, file, settings['da.bill_upload'])
    let ocr: OcrResult | null = null
    if (file.type.startsWith('image/')) {
      try { setProgress(0); const r = await readImage(file, settings['da.ocr'].languages, p => setProgress(p)); ocr = parse(r.text, r.confidence) }
      catch (e) { setErr(e) } finally { setProgress(null) }
    }
    return { path, ocr }
  }
  return { run, progress, err }
}
const OcrNote = ({ ocr, min }: { ocr: OcrResult | null; min: number }) => !ocr ? null : <p className={Number(ocr.confidence) < min ? 'notice' : 'muted small'}>
  OCR থেকে পূরণ করা হয়েছে · নির্ভরযোগ্যতা {num(ocr.confidence ?? 0)}%{Number(ocr.confidence) < min ? ' — কম, প্রতিটি ঘর ভালো করে মিলিয়ে নিন' : ''}। সেভ করার আগে মিলিয়ে নিন ও টিক দিন।</p>

// ---------------------------------------------------------------------------- merchant cash payments
type MDraft = { line?: string; merchantQ: string; merchant?: string; merchantName?: string; ref: string; txn: string; amount: string; date: string
  path?: string | null; ocr: OcrResult | null; verified: boolean; remarks: string; match?: string }
function MerchantTab({ s, settings, reload }: { s: Sheet; settings: DaSettings; reload: (m?: string) => Promise<void> }) {
  const [d, setD] = useState<MDraft | null>(null)
  const [opts, setOpts] = useState<Array<{ merchant_id: string; code: string; name: string }>>([])
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false)
  const [remove, setRemove] = useState<MerchantPayment | null>(null)
  const up = useOcrUpload(s.session.id, settings)
  const blank: MDraft = { merchantQ: '', ref: '', txn: '', amount: '', date: s.session.account_date, ocr: null, verified: false, remarks: '' }

  async function findMerchant(q: string) { if (q.trim().length < 1) { setOpts([]); return } try { setOpts(await da.lookupMerchant(s.hub.id, q)) } catch (e) { setErr(e) } }
  async function checkRef(ref: string) {
    if (!d || !ref.trim()) return
    try {
      const m = (await da.matchPayment(s.hub.id, ref))[0]
      setD(x => x && ({ ...x, match: m ? `মিলেছে: ${m.payment_no} · ${m.merchant_name} · ${taka(m.amount)} · ${m.status}` : 'এই Payment ID-র কোনো রেকর্ড পাওয়া যায়নি',
        merchant: x.merchant ?? m?.merchant_id, merchantName: x.merchantName ?? m?.merchant_name, amount: x.amount || (m ? String(m.amount) : '') }))
    } catch (e) { setErr(e) }
  }
  async function onFile(f: File) {
    if (!d) return
    try {
      const { path, ocr } = await up.run(f, parsePayment)
      setD(x => x && ({ ...x, path, ocr, verified: false, txn: String(ocr?.transaction_id ?? x.txn ?? ''), ref: String(ocr?.payment_ref ?? x.ref ?? ''),
        amount: ocr?.amount ? String(ocr.amount) : x.amount, date: String(ocr?.payment_date ?? x.date) }))
      if (ocr?.payment_ref) void checkRef(String(ocr.payment_ref))
    } catch (e) { setErr(e) }
  }
  async function save() {
    if (!d?.merchant) { setErr(new Error('মার্চেন্ট বেছে নিন।')); return }
    setBusy(true); setErr(null)
    try {
      await da.saveMerchant({ session: s.session.id, merchant: d.merchant, ref: d.ref, txn: d.txn, amount: +d.amount, date: d.date, path: d.path,
        ocr: d.ocr, verified: d.ocr ? d.verified : false, remarks: d.remarks, line: d.line })
      setD(null); await reload('মার্চেন্ট পেমেন্ট সংরক্ষিত')
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  const edit = (m: MerchantPayment) => setD({ line: m.id, merchantQ: m.merchant_name, merchant: m.merchant_id, merchantName: m.merchant_name, ref: m.payment_ref ?? '',
    txn: m.transaction_id ?? '', amount: String(m.amount), date: m.payment_date, path: m.screenshot_path, ocr: m.ocr, verified: m.ocr_verified, remarks: m.remarks ?? '' })

  return <section className="panel">
    <div className="da-bar"><h2>মার্চেন্ট ক্যাশ পেমেন্ট</h2>{s.can_edit && <button className="no-print" onClick={() => { setErr(null); setD({ ...blank }) }}>＋ পেমেন্ট যোগ</button>}</div>
    <div className="da-table-wrap"><table className="da-table"><thead><tr><th>নং</th><th>মার্চেন্ট</th><th>Payment ID</th><th>Transaction ID</th><th className="r">টাকা</th><th>তারিখ</th><th>মিল</th><th>OCR</th><th>স্ক্রিনশট</th><th>মন্তব্য</th><th className="no-print" /></tr></thead>
      <tbody>{s.merchant_payments.map(m => <tr key={m.id}><td data-l="নং">{num(m.no)}</td><td data-l="মার্চেন্ট"><b>{m.merchant_name}</b></td><td data-l="Payment ID">{m.payment_ref ?? '—'}</td>
        <td data-l="Transaction ID">{m.transaction_id ?? '—'}</td><td data-l="টাকা" className="r">{taka(m.amount)}</td><td data-l="তারিখ">{dateBn(m.payment_date)}</td>
        <td data-l="মিল">{m.match_status === 'matched' ? <Badge tone="ok">মিলেছে</Badge> : m.match_status === 'mismatch' ? <Badge tone="bad">অমিল</Badge> : <Badge>রেকর্ড নেই</Badge>}</td>
        <td data-l="OCR">{!m.ocr ? '—' : m.ocr_verified ? <Badge tone="ok">যাচাই হয়েছে</Badge> : <Badge tone="warn">যাচাই বাকি</Badge>}</td>
        <td data-l="স্ক্রিনশট">{m.screenshot_path ? <FileLink path={m.screenshot_path} /> : '—'}</td><td data-l="মন্তব্য">{m.remarks ?? ''}</td>
        <td className="no-print">{s.can_edit && <span className="row"><button className="secondary sm" onClick={() => edit(m)}>এডিট</button><button className="danger sm" onClick={() => setRemove(m)}>বাদ</button></span>}</td></tr>)}
        {s.merchant_payments.length === 0 && <tr><td colSpan={11} className="muted">কোনো মার্চেন্ট পেমেন্ট নেই।</td></tr>}</tbody></table></div>

    {d && <Modal title={d.line ? 'মার্চেন্ট পেমেন্ট এডিট' : 'মার্চেন্ট পেমেন্ট যোগ'} wide onClose={() => setD(null)}
      actions={<><button className="secondary" onClick={() => setD(null)}>বাতিল</button><button disabled={busy || up.progress !== null || (!!d.ocr && !d.verified)} onClick={() => void save()}>{busy ? 'সেভ হচ্ছে…' : 'যাচাই করে সেভ'}</button></>}>
      <Field label="পেমেন্টের স্ক্রিনশট (ছবি দিলে তথ্য নিজে পূরণ হবে)" hint={up.progress !== null ? `পড়া হচ্ছে… ${num(Math.round(up.progress * 100))}%` : d.path ? 'আপলোড হয়েছে' : undefined}>
        <input type="file" accept="image/png,image/jpeg,application/pdf" onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f) }} /></Field>
      <ErrorNote error={up.err} /><OcrNote ocr={d.ocr} min={settings['da.ocr'].min_confidence} />
      <div className="da-grid3">
        <Field label="মার্চেন্ট *" hint={d.merchantName ? `বেছে নেওয়া: ${d.merchantName}` : 'কোড বা নাম লিখুন'}>
          <input value={d.merchantQ} onChange={e => { setD({ ...d, merchantQ: e.target.value, merchant: undefined, merchantName: undefined }); void findMerchant(e.target.value) }} />
          {opts.length > 0 && !d.merchant && <div className="da-pick">{opts.map(o => <button type="button" key={o.merchant_id} className="secondary sm"
            onClick={() => { setD({ ...d, merchant: o.merchant_id, merchantName: o.name, merchantQ: `${o.code} — ${o.name}` }); setOpts([]) }}>{o.code} — {o.name}</button>)}</div>}</Field>
        <Field label="Payment ID" hint={d.match}><input value={d.ref} onChange={e => setD({ ...d, ref: e.target.value, match: undefined })} onBlur={e => void checkRef(e.target.value)} /></Field>
        <Field label="Transaction ID"><input value={d.txn} onChange={e => setD({ ...d, txn: e.target.value })} /></Field>
        <Field label="টাকা *"><input type="number" min={1} value={d.amount} onChange={e => setD({ ...d, amount: e.target.value })} /></Field>
        <Field label="পেমেন্টের তারিখ *"><input type="date" max={todayDhaka()} value={d.date} onChange={e => setD({ ...d, date: e.target.value })} /></Field>
        <Field label="মন্তব্য"><input value={d.remarks} onChange={e => setD({ ...d, remarks: e.target.value })} /></Field>
      </div>
      {d.ocr && <label className="da-check"><input type="checkbox" checked={d.verified} onChange={e => setD({ ...d, verified: e.target.checked })} /> আমি স্ক্রিনশটের সাথে Payment ID, Transaction ID ও টাকা মিলিয়ে দেখেছি</label>}
      <ErrorNote error={err} />
    </Modal>}
    {remove && <RemoveDialog what={`${remove.merchant_name} · ${taka(remove.amount)}`} onClose={() => setRemove(null)}
      onOk={async reason => { await da.removeLine('merchant', remove.id, reason); setRemove(null); await reload('বাদ দেওয়া হয়েছে') }} />}
  </section>
}

function FileLink({ path }: { path: string }) {
  const [err, setErr] = useState(false)
  return <button type="button" className="link" onClick={() => void da.fileUrl(path).then(u => window.open(u, '_blank', 'noopener')).catch(() => setErr(true))}>{err ? 'খোলা যায়নি' : 'দেখুন'}</button>
}

// ---------------------------------------------------------------------------- expenses
type XDraft = { line?: string; kind: 'transport' | 'employee'; employee: string; employeeName?: string; template: string; name: string; category: string; amount: string
  date: string; billNo: string; ref: string; paidBy: string; path?: string | null; ocr: OcrResult | null; verified: boolean; remarks: string }
function ExpenseTab({ s, settings, templates, reload }: { s: Sheet; settings: DaSettings; templates: Template[]; reload: (m?: string) => Promise<void> }) {
  const cats = settings['da.expense_categories']
  const catL = (c: string) => cats.find(x => x.code === c)?.bn ?? c
  const refCfg = settings['da.reference_setup']; const billCfg = settings['da.bill_upload']
  const [d, setD] = useState<XDraft | null>(null)
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false)
  const [remove, setRemove] = useState<Expense | null>(null)
  const [kindF, setKindF] = useState<'all' | 'transport' | 'employee'>('all')
  const up = useOcrUpload(s.session.id, settings)
  const active = templates.filter(t => t.status === 'active')
  const blank = (kind: 'transport' | 'employee'): XDraft => ({ kind, employee: '', template: '', name: '', category: cats[0]?.code ?? 'other', amount: '', date: s.session.account_date,
    billNo: '', ref: '', paidBy: '', ocr: null, verified: false, remarks: '' })
  const needBill = d && billCfg.required_over != null && (+d.amount || 0) >= billCfg.required_over && !d.path

  async function lookup(code: string) {
    if (!d || !code.trim()) return
    try { const r = (await da.lookupEmployee(s.hub.id, code))[0]; setD(x => x && ({ ...x, employeeName: r ? (r.allowed ? r.full_name : `${r.full_name} — এই হাবের নন`) : 'পাওয়া যায়নি' })) }
    catch (e) { setErr(e) }
  }
  function applyTemplate(id: string) {
    const t = templates.find(x => x.id === id)
    if (!d) return
    setD({ ...d, template: id, name: t ? t.name : d.name, category: t ? t.category : d.category,
      ref: d.ref || (t?.reference_prefix ? `${t.reference_prefix}-` : refCfg.expense_prefix ? `${refCfg.expense_prefix}-` : ''),
      amount: d.amount || (t?.default_amount ? String(t.default_amount) : '') })
  }
  async function onFile(f: File) {
    if (!d) return
    try {
      const { path, ocr } = await up.run(f, (text, conf) => parseBill(text, conf, templates, cats))
      setD(x => x && ({ ...x, path, ocr, verified: false, name: String(ocr?.expense_name ?? x.name), template: String(ocr?.template_id ?? x.template),
        category: String(ocr?.category ?? x.category), amount: ocr?.amount ? String(ocr.amount) : x.amount, date: String(ocr?.bill_date ?? x.date),
        billNo: String(ocr?.bill_no ?? x.billNo), ref: String(ocr?.reference_no ?? x.ref) }))
    } catch (e) { setErr(e) }
  }
  async function save() {
    if (!d) return
    setBusy(true); setErr(null)
    try {
      await da.saveExpense({ session: s.session.id, kind: d.kind, employee: d.employee || null, name: d.name, category: d.category, amount: +d.amount,
        date: d.date, billNo: d.billNo || null, ref: d.ref && !/-$/.test(d.ref) ? d.ref : null, path: d.path, paidBy: d.paidBy || null,
        ocr: d.ocr, verified: d.ocr ? d.verified : false, template: d.template || null, remarks: d.remarks, line: d.line })
      setD(null); await reload('খরচ সংরক্ষিত')
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  const edit = (x: Expense) => setD({ line: x.id, kind: x.kind, employee: x.employee_code ?? '', employeeName: x.employee_name ?? undefined, template: x.template_id ?? '',
    name: x.expense_name, category: x.category, amount: String(x.amount), date: x.bill_date, billNo: x.bill_no ?? '', ref: x.reference_no ?? '', paidBy: '',
    path: x.attachment_path, ocr: x.ocr, verified: x.ocr_verified, remarks: x.remarks ?? '' })
  const list = s.expenses.filter(x => kindF === 'all' || x.kind === kindF)

  return <section className="panel">
    <div className="da-bar"><h2>যাতায়াত ও হাব কর্মীর খরচ</h2>
      <div className="row no-print"><select value={kindF} onChange={e => setKindF(e.target.value as typeof kindF)} aria-label="ধরন">
        <option value="all">সব</option><option value="transport">যাতায়াত</option><option value="employee">কর্মীর খরচ</option></select>
        {s.can_edit && <><button onClick={() => { setErr(null); setD(blank('transport')) }}>＋ যাতায়াত খরচ</button><button className="secondary" onClick={() => { setErr(null); setD(blank('employee')) }}>＋ কর্মীর খরচ</button></>}</div></div>
    <div className="da-table-wrap"><table className="da-table"><thead><tr><th>নং</th><th>ধরন</th><th>কর্মী</th><th>খরচের নাম</th><th>খাত</th><th className="r">বিল</th><th>তারিখ</th><th>বিল / রেফ.</th><th>দিয়েছেন</th><th>বিল ফাইল</th><th>OCR</th><th className="no-print" /></tr></thead>
      <tbody>{list.map(x => <tr key={x.id}><td data-l="নং">{num(x.no)}</td><td data-l="ধরন">{x.kind === 'transport' ? 'যাতায়াত' : 'কর্মী'}</td>
        <td data-l="কর্মী">{x.employee_name ? <>{x.employee_name}<span className="sec">ID {x.employee_code}</span></> : '—'}</td><td data-l="নাম"><b>{x.expense_name}</b></td>
        <td data-l="খাত">{catL(x.category)}</td><td data-l="বিল" className="r">{taka(x.amount)}</td><td data-l="তারিখ">{dateBn(x.bill_date)}</td>
        <td data-l="বিল / রেফ.">{x.bill_no ?? '—'}<span className="sec">{x.reference_no ?? ''}</span></td><td data-l="দিয়েছেন">{x.paid_by_name ?? '—'}</td>
        <td data-l="ফাইল">{x.attachment_path ? <FileLink path={x.attachment_path} /> : '—'}</td>
        <td data-l="OCR">{!x.ocr ? '—' : x.ocr_verified ? <Badge tone="ok">যাচাই হয়েছে</Badge> : <Badge tone="warn">যাচাই বাকি</Badge>}</td>
        <td className="no-print">{s.can_edit && <span className="row"><button className="secondary sm" onClick={() => edit(x)}>এডিট</button><button className="danger sm" onClick={() => setRemove(x)}>বাদ</button></span>}</td></tr>)}
        {list.length === 0 && <tr><td colSpan={12} className="muted">কোনো খরচ নেই।</td></tr>}</tbody></table></div>

    {d && <Modal title={`${d.line ? 'এডিট' : 'নতুন'} · ${d.kind === 'transport' ? 'যাতায়াত খরচ' : 'কর্মীর খরচ'}`} wide onClose={() => setD(null)}
      actions={<><button className="secondary" onClick={() => setD(null)}>বাতিল</button><button disabled={busy || up.progress !== null || (!!d.ocr && !d.verified)} onClick={() => void save()}>{busy ? 'সেভ হচ্ছে…' : 'যাচাই করে সেভ'}</button></>}>
      <Field label="বিল / মেমোর ছবি বা PDF" hint={up.progress !== null ? `পড়া হচ্ছে… ${num(Math.round(up.progress * 100))}%` : d.path ? 'আপলোড হয়েছে' : `ছবি দিলে AI/OCR দিয়ে তথ্য পূরণ হবে · সর্বোচ্চ ${num(billCfg.max_mb)} MB`}>
        <input type="file" accept="image/png,image/jpeg,application/pdf" onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f) }} /></Field>
      <ErrorNote error={up.err} /><OcrNote ocr={d.ocr} min={settings['da.ocr'].min_confidence} />
      <div className="da-grid3">
        <Field label="ধরন"><select value={d.kind} onChange={e => setD({ ...d, kind: e.target.value as XDraft['kind'] })}><option value="transport">যাতায়াত</option><option value="employee">কর্মীর খরচ</option></select></Field>
        <Field label={d.kind === 'employee' ? 'Employee ID *' : 'Employee ID (ঐচ্ছিক)'} hint={d.employeeName}><input inputMode="numeric" value={d.employee}
          onChange={e => setD({ ...d, employee: e.target.value, employeeName: undefined })} onBlur={e => void lookup(e.target.value)} /></Field>
        <Field label="টেমপ্লেট"><select value={d.template} onChange={e => applyTemplate(e.target.value)}><option value="">— নেই —</option>{active.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        <Field label="খরচের নাম *"><input value={d.name} onChange={e => setD({ ...d, name: e.target.value })} /></Field>
        <Field label="খাত *"><select value={d.category} onChange={e => setD({ ...d, category: e.target.value })}>{cats.map(c => <option key={c.code} value={c.code}>{c.bn} ({c.en})</option>)}</select></Field>
        <Field label="বিলের টাকা *"><input type="number" min={1} value={d.amount} onChange={e => setD({ ...d, amount: e.target.value })} /></Field>
        <Field label="বিলের তারিখ *"><input type="date" max={todayDhaka()} value={d.date} onChange={e => setD({ ...d, date: e.target.value })} /></Field>
        <Field label="বিল নম্বর"><input value={d.billNo} onChange={e => setD({ ...d, billNo: e.target.value })} /></Field>
        <Field label={`রেফারেন্স নম্বর${refCfg.reference_required ? ' *' : ''}`}><input value={d.ref} onChange={e => setD({ ...d, ref: e.target.value })} /></Field>
        <Field label="কে দিয়েছেন (Employee ID)"><input inputMode="numeric" value={d.paidBy} onChange={e => setD({ ...d, paidBy: e.target.value })} /></Field>
        <Field label="মন্তব্য" wide><input value={d.remarks} onChange={e => setD({ ...d, remarks: e.target.value })} /></Field>
      </div>
      {needBill && <p className="notice">৳ {num(billCfg.required_over)} বা বেশি খরচে বিল/মেমো সংযুক্ত করতে হবে — না হলে Submit হবে না।</p>}
      {d.ocr && <label className="da-check"><input type="checkbox" checked={d.verified} onChange={e => setD({ ...d, verified: e.target.checked })} /> আমি বিলের সাথে নাম, টাকা, তারিখ ও নম্বর মিলিয়ে দেখেছি</label>}
      <ErrorNote error={err} />
    </Modal>}
    {remove && <RemoveDialog what={`${remove.expense_name} · ${taka(remove.amount)}`} onClose={() => setRemove(null)}
      onOk={async reason => { await da.removeLine('expense', remove.id, reason); setRemove(null); await reload('বাদ দেওয়া হয়েছে') }} />}
  </section>
}

// ---------------------------------------------------------------------------- history
function HistoryTab({ s }: { s: Sheet }) {
  const [diff, setDiff] = useState<{ title: string; rows: Array<[string, string, string, string]> } | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const snaps = s.events.filter(e => e.has_snapshot)
  async function compare(i: number) {
    try {
      const cur = await da.eventSnapshot(snaps[i].id); const prev = i > 0 ? await da.eventSnapshot(snaps[i - 1].id) : null
      const rows: Array<[string, string, string, string]> = []
      const key = (r: RiderLine) => r.employee_code
      const all = new Set([...(prev?.riders ?? []).map(key), ...(cur?.riders ?? []).map(key)])
      all.forEach(k => {
        const a = prev?.riders.find(r => key(r) === k), b = cur?.riders.find(r => key(r) === k)
        ;(['delivery_qty', 'pickup_qty', 'amount', 'paid_amount', 'due', 'mobile_banking'] as const).forEach(f => {
          const va = a ? String(a[f]) : '—', vb = b ? String(b[f]) : '—'
          if (va !== vb) rows.push([`${b?.rider_name ?? a?.rider_name} (ID ${k})`, F_LABEL[f], va, vb])
        })
      })
      ;(['merchant_cash', 'transport_expense', 'employee_expense'] as const).forEach(f => {
        const va = prev?.totals ? String(prev.totals[f]) : '—', vb = cur?.totals ? String(cur.totals[f]) : '—'
        if (va !== vb) rows.push(['মোট', f === 'merchant_cash' ? 'মার্চেন্ট পেমেন্ট' : f === 'transport_expense' ? 'যাতায়াত খরচ' : 'কর্মী খরচ', va, vb])
      })
      setDiff({ title: `${EVENT_LABEL[snaps[i].action]} · ${timeBn(snaps[i].at)}${i > 0 ? ` (আগের: ${timeBn(snaps[i - 1].at)})` : ''}`, rows })
    } catch (e) { setErr(e) }
  }
  return <section className="panel">
    <h2>হিসাবের ইতিহাস</h2><ErrorNote error={err} />
    <ol className="da-timeline">{s.events.map(e => {
      const si = snaps.findIndex(x => x.id === e.id)
      return <li key={e.id} className={`ev-${e.action}`}><b>{EVENT_LABEL[e.action]}</b> — {e.actor_name ?? '—'}{e.actor_code ? ` (ID ${e.actor_code})` : ''} · {timeBn(e.at)}
        {e.note && <div className="muted">“{e.note}”</div>}{si >= 0 && <button className="link" onClick={() => void compare(si)}>{si > 0 ? 'আগের সাথে তুলনা' : 'তখনকার তথ্য দেখুন'}</button>}</li>
    })}</ol>
    {s.visits && s.visits.length > 0 && <><h3>পেজে কে কতক্ষণ ছিলেন</h3><div className="da-table-wrap"><table className="da-table"><thead><tr><th>ব্যবহারকারী</th><th>প্রবেশ</th><th>বের হয়েছেন</th><th>সময়</th></tr></thead>
      <tbody>{s.visits.map(v => <tr key={v.id}><td data-l="ব্যবহারকারী">{v.user_name ?? '—'}</td><td data-l="প্রবেশ">{timeBn(v.entered_at)}</td><td data-l="বের হয়েছেন">{v.left_at ? timeBn(v.left_at) : 'এখনো আছেন / শেষ সাড়া'}</td><td data-l="সময়">{duration(v.duration_seconds)}</td></tr>)}</tbody></table></div></>}
    {diff && <Modal title={diff.title} wide onClose={() => setDiff(null)} actions={<button onClick={() => setDiff(null)}>বন্ধ</button>}>
      {diff.rows.length === 0 ? <p className="muted">আগের সংস্করণের সাথে কোনো পার্থক্য নেই।</p> :
        <table className="da-table"><thead><tr><th>কী</th><th>ঘর</th><th>আগে</th><th>পরে</th></tr></thead>
          <tbody>{diff.rows.map((r, i) => <tr key={i}><td>{r[0]}</td><td>{r[1]}</td><td className="muted">{r[2]}</td><td><b>{r[3]}</b></td></tr>)}</tbody></table>}
    </Modal>}
  </section>
}

// ---------------------------------------------------------------------------- submit / verify / reopen
function ActionBar({ s, reload }: { s: Sheet; reload: (m?: string) => Promise<void> }) {
  const [dlg, setDlg] = useState<null | 'submit' | 'reopen' | 'approve' | 'correction' | 'note'>(null)
  const [note, setNote] = useState(''); const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false)
  const unchecked = useMemo(() => s.merchant_payments.filter(m => m.ocr && !m.ocr_verified).length + s.expenses.filter(x => x.ocr && !x.ocr_verified).length, [s])
  const open = (k: typeof dlg) => { setErr(null); setNote(''); setDlg(k) }
  async function go() {
    setBusy(true); setErr(null)
    try {
      if (dlg === 'submit') await da.submit(s.session.id, note)
      else if (dlg === 'reopen') await da.reopen(s.session.id, note)
      else if (dlg) await da.verify(s.session.id, dlg, note)
      const msg = dlg === 'submit' ? 'Submit হয়েছে — Accounts Manager-এর কাছে গেছে' : dlg === 'approve' ? 'অনুমোদিত — হিসাব চূড়ান্ত' : dlg === 'correction' ? 'সংশোধনের জন্য ফেরত পাঠানো হয়েছে' : dlg === 'reopen' ? 'সংশোধনের জন্য খোলা হয়েছে' : 'মন্তব্য যোগ হয়েছে'
      setDlg(null); await reload(msg)
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  const showVerify = s.can_verify && s.session.status === 'submitted'
  if (!s.can_edit && !showVerify && !s.can_reopen) return null
  return <div className="da-actionbar no-print">
    {s.can_edit && <><span className="muted small">শেষ সেভ {timeBn(s.session.last_saved_at)}{unchecked ? ` · OCR যাচাই বাকি ${num(unchecked)}টি` : ''}</span>
      <button onClick={() => open('submit')}>যাচাই করে Submit করুন</button></>}
    {s.can_reopen && <button className="secondary" onClick={() => open('reopen')}>সংশোধনের জন্য খুলুন</button>}
    {showVerify && <><span className="muted small">Submit: {s.session.submitted_by_name} · {timeBn(s.session.submitted_at)}</span>
      <button className="secondary" onClick={() => open('note')}>মন্তব্য দিন</button>
      <button className="danger" onClick={() => open('correction')}>সংশোধন প্রয়োজন</button>
      <button onClick={() => open('approve')}>অনুমোদন — সব ঠিক আছে</button></>}

    {dlg === 'submit' && <Modal title="Submit নিশ্চিত করুন" onClose={() => setDlg(null)}
      actions={<><button className="secondary" onClick={() => setDlg(null)}>বাতিল (Cancel)</button><button className="secondary" onClick={() => setDlg(null)}>এডিট করুন (Edit)</button>
        <button disabled={busy || unchecked > 0} onClick={() => void go()}>{busy ? 'হচ্ছে…' : 'Submit'}</button></>}>
      <p><b>আপনি কি নিশ্চিত যে সকল হিসাব যাচাই করে Submit করতে চান?</b></p>
      <ul className="muted"><li>রাইডার {num(s.riders.length)} জন · মোট টাকা {taka(s.totals?.amount)} · বকেয়া {taka(s.totals?.due)}</li>
        <li>মার্চেন্ট পেমেন্ট {num(s.merchant_payments.length)}টি · খরচ {num(s.expenses.length)}টি</li>
        <li>Submit-এর পর বদলাতে সংশোধনের অনুমতি লাগবে।</li></ul>
      {unchecked > 0 && <p className="notice">OCR থেকে পাওয়া {num(unchecked)}টি এন্ট্রি এখনো যাচাই হয়নি — আগে যাচাই করুন।</p>}
      <Field label="মন্তব্য (ঐচ্ছিক)"><input value={note} onChange={e => setNote(e.target.value)} /></Field><ErrorNote error={err} />
    </Modal>}
    {dlg && dlg !== 'submit' && <Modal title={{ reopen: 'সংশোধনের জন্য খুলবেন?', approve: 'হিসাব অনুমোদন', correction: 'সংশোধন প্রয়োজন', note: 'মন্তব্য দিন' }[dlg]} onClose={() => setDlg(null)}
      actions={<><button className="secondary" onClick={() => setDlg(null)}>বাতিল</button><button className={dlg === 'correction' ? 'danger' : ''} disabled={busy || (dlg !== 'approve' && !note.trim())} onClick={() => void go()}>{busy ? 'হচ্ছে…' : 'নিশ্চিত'}</button></>}>
      {dlg === 'approve' && <p>অনুমোদন দিলে হিসাবটি চূড়ান্ত হবে, আর বদলানো যাবে না।</p>}
      {dlg === 'correction' && <p>কী ভুল হয়েছে লিখুন। হিসাবটি যিনি Submit করেছেন তাঁর কাছে ফেরত যাবে।</p>}
      <Field label={dlg === 'approve' ? 'মন্তব্য (ঐচ্ছিক)' : dlg === 'reopen' ? 'কারণ *' : dlg === 'correction' ? 'কী ভুল হয়েছে *' : 'মন্তব্য *'}>
        <textarea rows={3} value={note} onChange={e => setNote(e.target.value)} /></Field><ErrorNote error={err} />
    </Modal>}
  </div>
}

