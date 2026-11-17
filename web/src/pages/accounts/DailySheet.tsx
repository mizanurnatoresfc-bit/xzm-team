import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { refs } from '../../lib/refs'
import { Link, useParams } from 'react-router-dom'
import {
  da, num, taka, dateBn, timeBn, duration, todayDhaka, EVENT_LABEL,
  type Sheet, type DaSettings, type Template, type RiderLine, type MerchantPayment, type Expense, type OcrResult, type Category,
  type Claim, type Vehicle, type CashNote, NOTE_METHOD,
} from '../../lib/dailyAccounts'
import { readImage, parsePayment, parseBill } from '../../lib/ocr'
import { printVoucher } from '../../lib/voucher'
import { printArea } from '../../lib/xlsx'
import { AccountsShell, Stat, StatusBadge, Badge, Modal, Field, ErrorNote, useLoad, useToast } from './ui'
import { QuickGrid, type GCol, type Vals } from './QuickGrid'
import { FlowPanel, onlyOf } from './sheetFlow'
import { SectionMenu, ExtraHeads, ExtraCells, ExtraBlanks, BankPanel, useApplyLayout, isOff } from './sheetTools'

const EMPTY_LAYOUT = {}
export type LS = (m: string) => Promise<void>

export function DailySheet() {
  const { id = '' } = useParams()
  const sheet = useLoad(() => da.sheet(id), [id])
  const settings = useLoad(() => da.settings(), [])
  const templates = useLoad(() => da.templates().catch(() => [] as Template[]), [])
  const { toast, node } = useToast()
  const s = sheet.data
  const [tab, setTab] = useState('riders')
  const [viewing, setViewing] = useState<string | null>(null)
  const area = useRef<HTMLDivElement>(null)
  useApplyLayout(area, settings.data?.['da.layout'] ?? EMPTY_LAYOUT, s ? `${tab}-${s.session.id}` : null)

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
  const layoutSaved: LS = async (msg) => { await settings.reload(); await sheet.reload(); toast(msg) }
  const st = settings.data
  // "check" one khata: only that person's lines are shown in the three parts they write
  const shown = viewing ? onlyOf(s, new Set([viewing])) : s

  const allTabs: Array<[string, string, number | null]> = [
    ['riders', 'রাইডার', s.riders.length],
    ['payment', 'পেমেন্ট', s.merchant_payments.length],
    ['expense', 'খরচ', s.expenses.length],
    ['claims', 'জমা বিল', null],
    ['notes', 'নোট', s.notes_in?.length ?? 0],
    ['bank', 'ব্যাংক ডিপোজিট', s.deposits?.length ?? 0],
    ['close', 'দিন শেষ', null],
  ]
  // A part the Super Admin switched off is not shown (the bank tab goes when both of its parts are off)
  const tabs = allTabs.filter(([k]) => k === 'close' || (k === 'bank' ? !(isOff(st, 'reports') && isOff(st, 'deposits')) : !isOff(st, k)))

  return <AccountsShell title={`${s.hub.name} · ${dateBn(s.session.account_date)}`}
    subtitle={`হিসাব নং ${num(s.session.no)} · শুরু করেছেন ${s.session.started_by_name ?? '—'}${s.session.started_by_code ? ` (ID ${s.session.started_by_code})` : ''} · ${timeBn(s.session.started_at)}`}
    actions={<><StatusBadge status={s.session.status} /><button className="secondary" onClick={() => printArea(`Daily-account-${s.hub.code}-${s.session.account_date}`)}>প্রিন্ট / PDF</button></>}>
    {node}
    <div className="nv-sheet">
    {s.session.status === 'correction' && s.session.verify_note && <p className="notice">সংশোধন প্রয়োজন: {s.session.verify_note}</p>}
    {s.session.status === 'approved' && <p className="da-ok">অনুমোদিত — {s.session.verified_by_name} · {timeBn(s.session.verified_at)}{s.session.verify_note ? ` · “${s.session.verify_note}”` : ''}</p>}
    {s.session.closed_at && <p className="da-ok">আজকের হিসাব ক্লোজ — {timeBn(s.session.closed_at)}</p>}
    {t && <section className="da-stats">
      <Stat label="রাইডার" value={num(t.riders)} /><Stat label="ডেলিভারি" value={num(t.delivery)} /><Stat label="পিকআপ" value={num(t.pickup)} />
      <Stat label="টাকা" value={taka(t.amount)} /><Stat label="বকেয়া" value={taka(t.due)} tone={t.due > 0 ? 'warn' : undefined} />
      <Stat label="মোবাইল ব্যাংকিং" value={taka(t.mobile_banking)} sub="আলাদা হিসাব" />
      <Stat label="পেমেন্ট" value={taka(t.merchant_cash)} />
      <Stat label="মোট খরচ" value={taka(t.transport_expense + t.employee_expense)} />
    </section>}

    <FlowPanel s={s} settings={st} reload={reload} viewing={viewing} onView={u => { setViewing(u); if (u) setTab('riders') }} />
    {viewing && <p className="notice no-print" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>শুধু <b>{(s.collectors ?? []).find(c => c.user_id === viewing)?.name ?? '—'}</b>-এর খাতা দেখাচ্ছে (রাইডার, পেমেন্ট, খরচ)।
      <button type="button" className="secondary sm" onClick={() => setViewing(null)}>সবার খাতা দেখুন</button></p>}

    <nav className="da-tabs no-print" aria-label="হিসাবের অংশ">
      {tabs.map(([key, label, count]) => <button key={key} data-tab={key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>
        {label}{count !== null ? ` (${num(count)})` : ''}</button>)}
    </nav>

    <div className="print-area" ref={area}>
      {tab === 'riders' && <RidersTab s={shown} settings={st} reload={reload} ls={layoutSaved} />}
      {tab === 'payment' && <MerchantTab s={shown} settings={st} reload={reload} ls={layoutSaved} />}
      {tab === 'expense' && <ExpenseTab s={shown} settings={st} templates={templates.data ?? []} reload={reload} ls={layoutSaved} />}
      {tab === 'claims' && <ClaimsPanel s={s} settings={st} cats={st['da.expense_categories']} reload={reload} ls={layoutSaved} />}
      {tab === 'notes' && <NotesPanel s={s} settings={st} reload={reload} ls={layoutSaved} />}
      {tab === 'bank' && <BankPanel s={s} settings={st} reload={reload} onLayoutSaved={layoutSaved} />}
      {tab === 'close' && <><ClosingBox s={s} settings={st} /><CloseDay s={s} reload={reload} />
        <details className="panel no-print" id="da-history"><summary><b>ইতিহাস — কে কখন কী করেছেন</b></summary><HistoryTab s={s} /></details></>}
    </div>
    <ActionBar s={s} reload={reload} />
    </div>
  </AccountsShell>
}

// ---------------------------------------------------------------------------- riders
const F_LABEL: Record<string, string> = { delivery_qty: 'ডেলিভারি', pickup_qty: 'পিকআপ', amount: 'টাকা', paid_amount: 'জমা দিয়েছেন',
  due: 'বকেয়া', mobile_banking: 'মোবাইল ব্যাংকিং', remarks: 'মন্তব্য' }
type RiderDraft = { line?: string; code: string; name?: string; mobile?: string | null; hub?: string | null; allowed?: boolean
  delivery: string; pickup: string; amount: string; paid: string; due: string; mb: string; remarks: string }
const emptyRider: RiderDraft = { code: '', delivery: '', pickup: '', amount: '', paid: '', due: '', mb: '', remarks: '' }

export function RidersTab({ s, settings, reload, ls }: { s: Sheet; settings: DaSettings; reload: (m?: string) => Promise<void>; ls: LS }) {
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

  const sum = (f: (r: RiderLine) => number) => s.riders.reduce((a, r) => a + f(r), 0)

  // ---- Excel-like entry: type straight into the cells
  const rcols: GCol[] = [
    { key: 'code', label: 'Employee ID', width: 96, req: true, placeholder: 'ID', list: 'da-staff-q' },
    { key: 'name', label: 'রাইডারের নাম', width: 150, ro: true },
    ...(fields.includes('delivery_qty') ? [{ key: 'delivery', label: 'ডেলিভারি', type: 'number' as const, width: 84, total: true }] : []),
    ...(fields.includes('pickup_qty') ? [{ key: 'pickup', label: 'পিকআপ', type: 'number' as const, width: 78, total: true }] : []),
    ...(fields.includes('amount') ? [{ key: 'amount', label: 'টাকা', type: 'number' as const, width: 96, total: true }] : []),
    ...(fields.includes('paid_amount') ? [{ key: 'paid', label: 'জমা', type: 'number' as const, width: 96, total: true }] : []),
    ...(fields.includes('due') ? [manualDue ? { key: 'due', label: 'বকেয়া', type: 'number' as const, width: 90, total: true }
      : { key: 'due', label: 'বকেয়া', type: 'number' as const, width: 90, total: true, calc: (v: Vals) => String((+v.amount || 0) - (+v.paid || 0)) }] : []),
    ...(fields.includes('mobile_banking') ? [{ key: 'mb', label: 'মোবাইল ব্যাংকিং', type: 'number' as const, width: 100, total: true }] : []),
    ...(fields.includes('remarks') ? [{ key: 'remarks', label: 'মন্তব্য', width: 140 }] : []),
  ]
  const rrows = useMemo(() => s.riders.map(r => ({ id: r.id, v: { code: r.employee_code, name: r.rider_name, delivery: String(r.delivery_qty), pickup: String(r.pickup_qty),
    amount: String(r.amount), paid: String(r.paid_amount), due: String(manualDue ? r.due_input : r.due), mb: String(r.mobile_banking), remarks: r.remarks ?? '' } })), [s.riders, manualDue])
  const rblank = useCallback((): Vals => ({ code: '', name: '', delivery: '', pickup: '', amount: '', paid: '', due: '', mb: '', remarks: '' }), [])
  const rsave = useCallback(async (v: Vals, line?: string) => {
    await da.saveRider({ session: s.session.id, code: v.code, delivery: +v.delivery || 0, pickup: +v.pickup || 0, amount: +v.amount || 0, paid: +v.paid || 0,
      due: manualDue ? +v.due || 0 : 0, mb: +v.mb || 0, remarks: v.remarks, line })
  }, [s.session.id, manualDue])
  const rlookup = useMemo(() => ({ key: 'code', run: async (code: string): Promise<Vals> => {
    const r = (await da.lookupEmployee(s.hub.id, code))[0]
    return { name: r ? (r.allowed ? r.full_name : `${r.full_name} — এই হাবের নন`) : 'এই আইডি পাওয়া যায়নি' } } }), [s.hub.id])

  return <section className="panel" id="da-riders">
    <div className="da-bar"><h2>রাইডার-ভিত্তিক হিসাব</h2>
      {s.can_edit && <div className="row no-print">
        {missing.length > 0 && <Badge tone="warn">এখনো হিসাব বাকি: {num(missing.length)} জন</Badge>}
        <button onClick={() => { setErr(null); setD({ ...emptyRider }) }}>＋ রাইডার যোগ</button></div>}
      <SectionMenu sec="riders" title="রাইডার-ভিত্তিক হিসাব" s={s} settings={settings} onAdd={() => { setErr(null); setD({ ...emptyRider }) }} addLabel="＋ রাইডার যোগ" onLayoutSaved={ls} /></div>
    {missing.length > 0 && <p className="muted small no-print">যাঁদের লাইন এখনো ওঠেনি: {missing.map(m => `${m.employee_code} ${m.full_name}`).join(' · ')}</p>}
    <p className="muted small">বকেয়া নিয়ম: {manualDue ? 'নিজে লিখবেন' : 'টাকা − জমা'} · মোবাইল ব্যাংকিং: {settings['da.mobile_banking_rule'] === 'separate' ? 'আলাদা হিসাব (বকেয়ার সাথে যোগ-বিয়োগ হয় না)' : settings['da.mobile_banking_rule'] === 'reduces_due' ? 'বকেয়া থেকে বাদ যায়' : 'বকেয়ার সাথে যোগ হয়'}</p>
    {s.can_edit && <div className="screen-only no-print-keep">
      <p className="qg-tip no-print">এক্সেলের মতো ঘরে সরাসরি লিখুন — <b>Employee ID</b> দিলে নাম নিজে আসবে। <b>Enter / ↓</b> নিচের ঘরে যায়, <b>Tab</b> পাশের ঘরে। লাইন ছাড়লেই নিজে সেভ হয়; নিচের ফাঁকা লাইনে নতুন রাইডার।</p>
      <datalist id="da-staff-q">{(staff.data ?? []).map(e => <option key={e.employee_id} value={e.employee_code}>{e.full_name}</option>)}</datalist>
      <QuickGrid cols={rcols} rows={rrows} blank={rblank} editable
        ready={v => (v.code.trim() ? null : 'ID লিখুন')} save={rsave} onSaved={() => reload()} lookup={rlookup}
        onRemove={id => setRemove(s.riders.find(r => r.id === id) ?? null)} /></div>}
    {/* phone: one row per rider — tap to change it */}
    <div className="nv-rows nv-phone-only no-print">
      {s.riders.map(r => <button key={r.id} type="button" className="nv-row" disabled={!s.can_edit} onClick={() => { setErr(null); edit(r) }}>
        <span className="nv-av">{r.rider_name.slice(0, 1)}</span>
        <span className="tx"><b>{r.rider_name}</b>
          <span>ID {r.employee_code}{fields.includes('delivery_qty') ? ` · ${num(r.delivery_qty)} ডেলিভারি` : ''}{fields.includes('pickup_qty') ? ` · ${num(r.pickup_qty)} পিকআপ` : ''}</span>
          {(r.due > 0 || r.mobile_banking > 0 || r.remarks) && <span className="who">{r.due > 0 && <em>বকেয়া {taka(r.due)}</em>}{r.mobile_banking > 0 ? ` · মোবাইল ব্যাংকিং ${taka(r.mobile_banking)}` : ''}{r.remarks ? ` · ${r.remarks}` : ''}</span>}</span>
        <span className="end"><b>{taka(r.amount)}</b>{s.can_edit && <small>বদলান ›</small>}</span>
      </button>)}
      {s.riders.length === 0 && <p className="nv-none">এখনো কোনো রাইডার যোগ হয়নি।{s.can_edit ? ' উপরের “＋ রাইডার যোগ” চাপুন।' : ''}</p>}
      {s.riders.length > 0 && <div className="nv-row total"><span className="tx"><b>মোট ({num(s.riders.length)} জন)</b>
        <span>{fields.includes('delivery_qty') ? `${num(sum(r => r.delivery_qty))} ডেলিভারি` : ''}{fields.includes('pickup_qty') ? ` · ${num(sum(r => r.pickup_qty))} পিকআপ` : ''}{sum(r => r.due) > 0 ? ` · বকেয়া ${taka(sum(r => r.due))}` : ''}</span></span>
        <span className="end"><b>{taka(sum(r => r.amount))}</b></span></div>}
    </div>
    <div className={`da-table-wrap nv-not-phone${s.can_edit ? ' only-print' : ''}`}><table className="da-table" data-sec="riders">
      <thead><tr><th>নং</th><th>Employee ID</th><th>রাইডারের নাম</th><th>মোবাইল</th>
        {fields.filter(f => f !== 'remarks').map(f => <th key={f} className="r">{F_LABEL[f]}</th>)}{fields.includes('remarks') && <th>মন্তব্য</th>}<ExtraHeads settings={settings} sec="riders" /><th className="no-print" /></tr></thead>
      <tbody>{s.riders.map(r => <tr key={r.id}>
        <td data-l="নং">{num(r.no)}</td><td data-l="ID">{r.employee_code}</td><td data-l="নাম"><b>{r.rider_name}</b></td><td data-l="মোবাইল">{r.mobile ?? '—'}</td>
        {fields.includes('delivery_qty') && <td data-l="ডেলিভারি" className="r">{num(r.delivery_qty)}</td>}
        {fields.includes('pickup_qty') && <td data-l="পিকআপ" className="r">{num(r.pickup_qty)}</td>}
        {fields.includes('amount') && <td data-l="টাকা" className="r">{taka(r.amount)}</td>}
        {fields.includes('paid_amount') && <td data-l="জমা" className="r">{taka(r.paid_amount)}</td>}
        {fields.includes('due') && <td data-l="বকেয়া" className="r"><b className={r.due > 0 ? 'bad' : ''}>{taka(r.due)}</b></td>}
        {fields.includes('mobile_banking') && <td data-l="মোবাইল ব্যাংকিং" className="r">{taka(r.mobile_banking)}</td>}
        {fields.includes('remarks') && <td data-l="মন্তব্য">{r.remarks ?? ''}</td>}
        <ExtraCells s={s} settings={settings} sec="riders" row={r.id} reload={reload} />
        <td className="no-print">{s.can_edit && <span className="row"><button className="secondary sm" onClick={() => edit(r)}>এডিট</button>
          <button className="danger sm" onClick={() => setRemove(r)}>বাদ</button></span>}</td></tr>)}
        {s.riders.length === 0 && <tr><td colSpan={12} className="muted">এখনো কোনো রাইডার যোগ হয়নি।</td></tr>}</tbody>
      {s.riders.length > 0 && <tfoot><tr><td colSpan={4}>মোট ({num(s.riders.length)} জন)</td>
        {fields.includes('delivery_qty') && <td data-l="মোট ডেলিভারি" className="r">{num(sum(r => r.delivery_qty))}</td>}
        {fields.includes('pickup_qty') && <td data-l="মোট পিকআপ" className="r">{num(sum(r => r.pickup_qty))}</td>}
        {fields.includes('amount') && <td data-l="মোট টাকা" className="r">{taka(sum(r => r.amount))}</td>}
        {fields.includes('paid_amount') && <td data-l="মোট জমা" className="r">{taka(sum(r => r.paid_amount))}</td>}
        {fields.includes('due') && <td data-l="মোট বকেয়া" className="r"><b className={sum(r => r.due) > 0 ? 'bad' : ''}>{taka(sum(r => r.due))}</b></td>}
        {fields.includes('mobile_banking') && <td data-l="মোট মোবাইল ব্যাংকিং" className="r">{taka(sum(r => r.mobile_banking))}</td>}
        {fields.includes('remarks') && <td className="no-print" />}<ExtraBlanks settings={settings} sec="riders" /><td className="no-print" /></tr></tfoot>}</table></div>

    {d && <Modal title={d.line ? 'রাইডারের হিসাব এডিট' : 'রাইডার যোগ'} onClose={() => setD(null)} wide
      actions={<>{d.line && <button className="danger nv-phone-only" onClick={() => { const r = s.riders.find(x => x.id === d.line) ?? null; setD(null); setRemove(r) }}>বাদ দিন</button>}
        <button className="secondary" onClick={() => setD(null)}>বাতিল</button><button disabled={busy || !d.code || d.allowed === false} onClick={() => void save()}>{busy ? 'সেভ হচ্ছে…' : 'সেভ'}</button></>}>
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

const NO_ROWS: Array<{ id: string; v: Vals }> = []
// ---------------------------------------------------------------------------- merchant cash payments
type MDraft = { line?: string; merchantQ: string; merchant?: string; merchantName?: string; ref: string; txn: string; amount: string; date: string
  path?: string | null; ocr: OcrResult | null; verified: boolean; remarks: string
  /** What the hub's own record says about this Payment ID: found, or not found. */
  match?: string; matched?: boolean; byHand?: boolean }
export function MerchantTab({ s, settings, reload, ls }: { s: Sheet; settings: DaSettings; reload: (m?: string) => Promise<void>; ls: LS }) {
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
      setD(x => x && ({ ...x, matched: !!m,
        match: m ? `${m.merchant_name} · ${taka(m.amount)} · ${m.status}` : 'এই আইডির রেকর্ড নেই — তবু লেখা যাবে',
        byHand: x.byHand || !m,
        merchant: x.merchant ?? m?.merchant_id, merchantName: x.merchantName ?? m?.merchant_name,
        merchantQ: x.merchantQ || (m?.merchant_name ?? ''),
        amount: x.amount || (m ? String(m.amount) : ''), date: x.date || m?.payment_date || x.date }))
    } catch (e) { setErr(e) }
  }
  async function onFile(f: File) {
    if (!d) return
    try {
      const { path, ocr } = await up.run(f, parsePayment)
      setD(x => x && ({ ...x, path, ocr, verified: false, txn: String(ocr?.transaction_id ?? x.txn ?? ''), ref: String(ocr?.payment_ref ?? x.ref ?? ''),
        amount: ocr?.amount ? String(ocr.amount) : x.amount, date: String(ocr?.payment_date ?? x.date),
        merchantQ: x.merchantQ || String(ocr?.payee ?? '') }))
      if (ocr?.payment_ref) void checkRef(String(ocr.payment_ref))
    } catch (e) { setErr(e) }
  }
  async function save() {
    if (!d) return
    if (!d.ref.trim() && !d.merchant && !d.merchantQ.trim()) { setErr(new Error('Payment ID লিখুন।')); return }
    if (!(+d.amount > 0)) { setErr(new Error('টাকার অঙ্ক লিখুন।')); return }
    setBusy(true); setErr(null)
    try {
      await da.saveMerchant({ session: s.session.id, merchant: d.merchant ?? null, ref: d.ref, txn: d.txn, amount: +d.amount, date: d.date, path: d.path,
        ocr: d.ocr, verified: d.ocr ? d.verified : false, remarks: d.remarks, line: d.line })
      setD(null); await reload('মার্চেন্ট পেমেন্ট সংরক্ষিত')
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  const edit = (m: MerchantPayment) => setD({ line: m.id, merchantQ: m.merchant_id || m.payee_name ? m.merchant_name : '', merchant: m.merchant_id, merchantName: m.merchant_name, ref: m.payment_ref ?? '',
    txn: m.transaction_id ?? '', amount: String(m.amount), date: m.payment_date, path: m.screenshot_path, ocr: m.ocr, verified: m.ocr_verified, remarks: m.remarks ?? '' })

  const total = s.merchant_payments.reduce((a, m) => a + m.amount, 0)

  // ---- Excel-like quick entry: Payment ID + amount, nothing else
  const pcols: GCol[] = [{ key: 'ref', label: 'Payment ID', width: 150, placeholder: '101001 বা SFC-101001' }, { key: 'amount', label: 'টাকা', type: 'number', width: 110 }, { key: 'remarks', label: 'মন্তব্য', width: 180 }]
  const pblank = useCallback((): Vals => ({ ref: '', amount: '', remarks: '' }), [])
  const psave = useCallback(async (v: Vals) => { await da.saveMerchant({ session: s.session.id, ref: v.ref, amount: +v.amount, date: s.session.account_date, remarks: v.remarks }) }, [s.session.id, s.session.account_date])
  return <section className="panel" id="da-merchant">
    <div className="da-bar"><h2>মার্চেন্ট ক্যাশ পেমেন্ট</h2><div className="row no-print">{s.can_edit && <button onClick={() => { setErr(null); setD({ ...blank }) }}>＋ পেমেন্ট যোগ</button>}
      <SectionMenu sec="payment" title="মার্চেন্ট ক্যাশ পেমেন্ট" s={s} settings={settings} onAdd={() => { setErr(null); setD({ ...blank }) }} addLabel="＋ পেমেন্ট যোগ" onLayoutSaved={ls} /></div></div>
    {s.can_edit && <div className="screen-only"><p className="qg-tip no-print">নিচের ফাঁকা লাইনে শুধু <b>Payment ID</b> আর <b>টাকা</b> লিখুন — লাইন ছাড়লেই সেভ। স্ক্রিনশট বা বিস্তারিত লাগলে উপরের "＋ পেমেন্ট" বাটন।</p>
      <QuickGrid cols={pcols} rows={NO_ROWS} blank={pblank} editable ready={v => (!v.ref.trim() ? 'Payment ID লিখুন' : !(+v.amount > 0) ? 'টাকা লিখুন' : null)}
        save={psave} onSaved={() => reload()} /></div>}
    <div className="da-table-wrap"><table className="da-table" data-sec="payment"><thead><tr><th>নং</th><th>কে নিয়েছে</th><th>Payment ID</th><th>Transaction ID</th><th className="r">টাকা</th><th>তারিখ</th><th>মিল</th><th>OCR</th><th>স্ক্রিনশট</th><th>মন্তব্য</th><ExtraHeads settings={settings} sec="payment" /><th className="no-print" /></tr></thead>
      <tbody>{s.merchant_payments.map(m => <tr key={m.id}><td data-l="নং">{num(m.no)}</td><td data-l="কে নিয়েছে">{m.merchant_id || m.payee_name ? <b>{m.merchant_name}</b> : <span className="muted">—</span>}</td><td data-l="Payment ID">{m.payment_ref ?? '—'}</td>
        <td data-l="Transaction ID">{m.transaction_id ?? '—'}</td><td data-l="টাকা" className="r">{taka(m.amount)}</td><td data-l="তারিখ">{dateBn(m.payment_date)}</td>
        <td data-l="মিল">{m.match_status === 'matched' ? <Badge tone="ok">মিলেছে</Badge> : m.match_status === 'mismatch' ? <Badge tone="bad">অমিল</Badge> : <Badge>রেকর্ড নেই</Badge>}</td>
        <td data-l="OCR">{!m.ocr ? '—' : m.ocr_verified ? <Badge tone="ok">যাচাই হয়েছে</Badge> : <Badge tone="warn">যাচাই বাকি</Badge>}</td>
        <td data-l="স্ক্রিনশট">{m.screenshot_path ? <FileLink path={m.screenshot_path} /> : '—'}</td><td data-l="মন্তব্য">{m.remarks ?? ''}</td>
        <ExtraCells s={s} settings={settings} sec="payment" row={m.id} reload={reload} />
        <td className="no-print">{s.can_edit && <span className="row"><button className="secondary sm" onClick={() => edit(m)}>এডিট</button><button className="danger sm" onClick={() => setRemove(m)}>বাদ</button></span>}</td></tr>)}
        {s.merchant_payments.length === 0 && <tr><td colSpan={11} className="muted">কোনো মার্চেন্ট পেমেন্ট নেই।</td></tr>}</tbody>
      {s.merchant_payments.length > 0 && <tfoot><tr><td colSpan={4}>মোট ({num(s.merchant_payments.length)} টি)</td>
        <td data-l="মোট টাকা" className="r">{taka(total)}</td><td colSpan={6} className="no-print" /></tr></tfoot>}</table></div>

    {d && <Modal title={d.line ? 'মার্চেন্ট পেমেন্ট এডিট' : 'মার্চেন্ট পেমেন্ট যোগ'} wide onClose={() => setD(null)}
      actions={<><button className="secondary" onClick={() => setD(null)}>বাতিল</button><button disabled={busy || up.progress !== null || (!!d.ocr && !d.verified)} onClick={() => void save()}>{busy ? 'সেভ হচ্ছে…' : 'যাচাই করে সেভ'}</button></>}>
      <Field label="পেমেন্টের স্ক্রিনশট (ছবি দিলে তথ্য নিজে পূরণ হবে)" hint={up.progress !== null ? `পড়া হচ্ছে… ${num(Math.round(up.progress * 100))}%` : d.path ? 'আপলোড হয়েছে' : undefined}>
        <input type="file" accept="image/png,image/jpeg,application/pdf" onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f) }} /></Field>
      <ErrorNote error={up.err} /><OcrNote ocr={d.ocr} min={settings['da.ocr'].min_confidence} />
      <p className="muted small no-print">শুধু <b>Payment ID</b> আর <b>টাকা</b> — ব্যস। <b>101001</b> লিখলেও <b>SFC-101001</b> হয়ে যাবে। মার্চেন্ট মেলানোর দরকার নেই; ওই আইডির রেকর্ড থাকলে নাম নিজে থেকেই বসবে।</p>
      <div className="da-grid3">
        <Field label="Payment ID *" hint={d.match ?? '101001 লিখলেই চলবে'}>
          <input value={d.ref} autoFocus={!d.line} placeholder="101001"
            onChange={e => setD({ ...d, ref: e.target.value, match: undefined, matched: undefined })}
            onBlur={e => void checkRef(e.target.value)} /></Field>
        <Field label="টাকা *"><input type="number" min={1} value={d.amount} onChange={e => setD({ ...d, amount: e.target.value })} /></Field>
        <Field label="কে নিয়েছে" hint={d.merchantName ? `পেয়েছে: ${d.merchantName}` : 'না দিলেও চলবে — Payment ID-ই যথেষ্ট'}>
          {d.merchantName && !d.byHand
            ? <span className="row"><b>{d.merchantName}</b><button type="button" className="secondary sm"
                onClick={() => setD({ ...d, byHand: true, merchant: undefined, merchantName: undefined, merchantQ: '' })}>বদলান</button></span>
            : <input value={d.merchantQ} placeholder="কোড বা নাম"
                onChange={e => { setD({ ...d, merchantQ: e.target.value, merchant: undefined, merchantName: undefined }); void findMerchant(e.target.value) }} />}
          {opts.length > 0 && !d.merchant && <div className="da-pick">{opts.map(o => <button type="button" key={o.merchant_id} className="secondary sm"
            onClick={() => { setD({ ...d, merchant: o.merchant_id, merchantName: o.name, merchantQ: `${o.code} — ${o.name}` }); setOpts([]) }}>{o.code} — {o.name}</button>)}</div>}</Field>
      </div>
      <details className="da-more no-print"><summary>আরও তথ্য (দরকার হলে)</summary><div className="da-grid3">
        <Field label="Transaction ID"><input value={d.txn} onChange={e => setD({ ...d, txn: e.target.value })} /></Field>
        <Field label="পেমেন্টের তারিখ"><input type="date" max={todayDhaka()} value={d.date} onChange={e => setD({ ...d, date: e.target.value })} /></Field>
        <Field label="মন্তব্য"><input value={d.remarks} onChange={e => setD({ ...d, remarks: e.target.value })} /></Field>
      </div></details>
      {d.ocr && <ScreenshotRead ocr={d.ocr} />}
      {d.ocr && <label className="da-check"><input type="checkbox" checked={d.verified} onChange={e => setD({ ...d, verified: e.target.checked })} /> আমি স্ক্রিনশটের সাথে Payment ID, Transaction ID ও টাকা মিলিয়ে দেখেছি</label>}
      <ErrorNote error={err} />
    </Modal>}
    {remove && <RemoveDialog what={`${remove.merchant_name} · ${taka(remove.amount)}`} onClose={() => setRemove(null)}
      onOk={async reason => { await da.removeLine('merchant', remove.id, reason); setRemove(null); await reload('বাদ দেওয়া হয়েছে') }} />}
  </section>
}

/** What the payment screenshot said, in the person's own words, to check against. */
function ScreenshotRead({ ocr }: { ocr: OcrResult }) {
  const bits = [
    ocr.payee ? `টাকা নিয়েছেন: ${ocr.payee}` : null,
    ocr.paid_by ? `দিয়েছেন: ${ocr.paid_by}` : null,
    ocr.account ? `যেখান থেকে: ${ocr.account}` : null,
  ].filter(Boolean)
  if (!bits.length) return null
  return <p className="muted small no-print">স্ক্রিনশটে পাওয়া গেছে — {bits.join(' · ')}</p>
}

function FileLink({ path }: { path: string }) {
  const [err, setErr] = useState(false)
  return <button type="button" className="link" onClick={() => void da.fileUrl(path).then(u => window.open(u, '_blank', 'noopener')).catch(() => setErr(true))}>{err ? 'খোলা যায়নি' : 'দেখুন'}</button>
}

// ---------------------------------------------------------------------------- expenses
type XDraft = { line?: string; kind: 'transport' | 'employee'; employee: string; employeeName?: string; template: string; name: string; category: string; amount: string
  date: string; billNo: string; ref: string; paidBy: string; path?: string | null; ocr: OcrResult | null; verified: boolean; remarks: string
  vehicle: string; refName: string; refPhone: string; refPosition: string }
export function ExpenseTab({ s, settings, templates, reload, ls }: { s: Sheet; settings: DaSettings; templates: Template[]; reload: (m?: string) => Promise<void>; ls: LS }) {
  const cats = settings['da.expense_categories']
  const catL = (c: string) => cats.find(x => x.code === c)?.bn ?? c
  const refCfg = settings['da.reference_setup']; const billCfg = settings['da.bill_upload']
  const [d, setD] = useState<XDraft | null>(null)
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false)
  const [remove, setRemove] = useState<Expense | null>(null)
  const [kindF, setKindF] = useState<'all' | 'transport' | 'employee'>('all')
  const up = useOcrUpload(s.session.id, settings)
  const active = templates.filter(t => t.status === 'active')
  const vehicles = useLoad(() => s.can_edit ? da.vehicles(s.hub.id).catch(() => [] as Vehicle[]) : Promise.resolve([] as Vehicle[]), [s.hub.id, s.can_edit])
  // the approved reference list (রেফারেন্স তালিকা); the old saved list in settings is kept as a fallback
  const refList = useLoad(() => refs.approved(), [])
  const refPeople = refList.data?.length ? refList.data.map(r => ({ name: r.name, phone: r.phone ?? undefined, position: [r.position, r.hub_name].filter(Boolean).join(' · ') || undefined })) : settings['da.reference_people'] ?? []
  const blank = (kind: 'transport' | 'employee'): XDraft => ({ kind, employee: '', template: '', name: '', category: cats[0]?.code ?? 'other', amount: '', date: s.session.account_date,
    vehicle: '', refName: '', refPhone: '', refPosition: '',
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
  async function print(x: Expense) {
    try { printVoucher(await da.voucher(x.id), cats.find(c => c.code === x.category)) } catch (e) { setErr(e) }
  }
  async function makeVoucher(x: Expense) {
    setErr(null)
    try { await da.makeVoucher(x.id); await reload('ভাউচার তৈরি হয়েছে'); printVoucher(await da.voucher(x.id), cats.find(c => c.code === x.category)) }
    catch (e) { setErr(e) }
  }
  async function save() {
    if (!d) return
    setBusy(true); setErr(null)
    try {
      const line = await da.saveExpense({ session: s.session.id, kind: d.kind, employee: d.employee || null, name: d.name, category: d.category, amount: +d.amount,
        date: d.date, billNo: d.billNo || null, ref: d.ref && !/-$/.test(d.ref) ? d.ref : null, path: d.path, paidBy: d.paidBy || null,
        ocr: d.ocr, verified: d.ocr ? d.verified : false, template: d.template || null, remarks: d.remarks, line: d.line })
      if (d.vehicle || d.refName || d.refPhone || d.refPosition) {
        await da.setReference({ line, name: d.refName, phone: d.refPhone, position: d.refPosition, vehicle: d.vehicle || null })
      }
      setD(null); await reload('খরচ সংরক্ষিত')
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  const edit = (x: Expense) => setD({ line: x.id, kind: x.kind, employee: x.employee_code ?? '', employeeName: x.employee_name ?? undefined, template: x.template_id ?? '',
    name: x.expense_name, category: x.category, amount: String(x.amount), date: x.bill_date, billNo: x.bill_no ?? '', ref: x.reference_no ?? '', paidBy: '',
    path: x.attachment_path, ocr: x.ocr, verified: x.ocr_verified, remarks: x.remarks ?? '',
    vehicle: x.vehicle_id ?? '', refName: x.reference_name ?? '', refPhone: x.reference_phone ?? '', refPosition: x.reference_position ?? '' })
  const list = s.expenses.filter(x => kindF === 'all' || x.kind === kindF)
  const tSum = list.filter(x => x.kind === 'transport').reduce((a, x) => a + x.amount, 0)
  const eSum = list.filter(x => x.kind === 'employee').reduce((a, x) => a + x.amount, 0)

  // ---- Excel-like quick entry: name, amount, whose (Employee ID), category
  const ecols: GCol[] = [{ key: 'name', label: 'খরচের নাম', width: 170, placeholder: 'যেমন: তেল' }, { key: 'amount', label: 'টাকা', type: 'number', width: 100 },
    { key: 'employee', label: 'কার খরচ (ID)', width: 110, placeholder: 'ফাঁকা = যাতায়াত', list: 'da-staff-x' }, { key: 'empName', label: 'কার', width: 130, ro: true },
    { key: 'category', label: 'খাত', type: 'select', width: 150, options: cats.map(c => [c.code, c.bn] as [string, string]) }]
  const eblank = useCallback((): Vals => ({ name: '', amount: '', employee: '', empName: '', category: cats[0]?.code ?? 'other' }), [cats])
  const esave = useCallback(async (v: Vals) => {
    await da.saveExpense({ session: s.session.id, kind: v.employee.trim() ? 'employee' : 'transport', employee: v.employee.trim() || null, name: v.name,
      category: v.category, amount: +v.amount, date: s.session.account_date })
  }, [s.session.id, s.session.account_date])
  const elookup = useMemo(() => ({ key: 'employee', run: async (code: string): Promise<Vals> => {
    const r = (await da.lookupEmployee(s.hub.id, code))[0]
    return { empName: r ? (r.allowed ? r.full_name : `${r.full_name} — এই হাবের নন`) : 'পাওয়া যায়নি' } } }), [s.hub.id])
  const staffX = useLoad(() => s.can_edit ? da.hubEmployees(s.hub.id) : Promise.resolve([]), [s.hub.id, s.can_edit])
  return <section className="panel" id="da-expense">
    <div className="da-bar"><h2>যাতায়াত ও হাব কর্মীর খরচ</h2>
      <div className="row no-print"><select value={kindF} onChange={e => setKindF(e.target.value as typeof kindF)} aria-label="ধরন">
        <option value="all">সব</option><option value="transport">যাতায়াত</option><option value="employee">কর্মীর খরচ</option></select>
        {s.can_edit && <><button onClick={() => { setErr(null); setD(blank('transport')) }}>＋ যাতায়াত খরচ</button><button className="secondary" onClick={() => { setErr(null); setD(blank('employee')) }}>＋ কর্মীর খরচ</button></>}
        <SectionMenu sec="expense" title="যাতায়াত ও হাব কর্মীর খরচ" s={s} settings={settings} onAdd={() => { setErr(null); setD(blank('transport')) }} addLabel="＋ খরচ যোগ" onLayoutSaved={ls} /></div></div>
    <ErrorNote error={err && !d ? err : null} />
    {s.can_edit && <div className="screen-only"><p className="qg-tip no-print">নিচের ফাঁকা লাইনে <b>খরচের নাম, টাকা, কার খরচ (Employee ID), খাত</b> লিখুন — লাইন ছাড়লেই সেভ। বিল ফাইল/ভাউচার/গাড়ির তথ্য লাগলে উপরের বাটন।</p>
      <datalist id="da-staff-x">{(staffX.data ?? []).map(e => <option key={e.employee_id} value={e.employee_code}>{e.full_name}</option>)}</datalist>
      <QuickGrid cols={ecols} rows={NO_ROWS} blank={eblank} editable ready={v => (!v.name.trim() ? 'খরচের নাম লিখুন' : !(+v.amount > 0) ? 'টাকা লিখুন' : null)}
        save={esave} onSaved={() => reload()} lookup={elookup} /></div>}
    <div className="da-table-wrap"><table className="da-table" data-sec="expense"><thead><tr><th>নং</th><th>ধরন</th><th>কর্মী</th><th>খরচের নাম</th><th>খাত</th><th className="r">বিল</th><th>তারিখ</th><th>বিল / রেফ.</th><th>দিয়েছেন</th><th>বিল ফাইল</th><th>ভাউচার</th><th>OCR</th><ExtraHeads settings={settings} sec="expense" /><th className="no-print" /></tr></thead>
      <tbody>{list.map(x => <tr key={x.id}><td data-l="নং">{num(x.no)}</td><td data-l="ধরন">{x.kind === 'transport' ? 'যাতায়াত' : 'কর্মী'}</td>
        <td data-l="কর্মী">{x.employee_name ? <>{x.employee_name}<span className="sec">ID {x.employee_code}</span></> : '—'}</td><td data-l="নাম"><b>{x.expense_name}</b></td>
        <td data-l="খাত">{catL(x.category)}</td><td data-l="বিল" className="r">{taka(x.amount)}</td><td data-l="তারিখ">{dateBn(x.bill_date)}</td>
        <td data-l="বিল / রেফ.">{x.bill_no ?? '—'}<span className="sec">{[x.reference_no, x.reference_name, x.reference_phone].filter(Boolean).join(' · ')}</span></td>
        <td data-l="দিয়েছেন">{x.paid_by_name ?? '—'}{x.claim_id ? <span className="sec">কর্মীর জমা দেওয়া</span> : null}</td>
        <td data-l="ফাইল">{x.attachment_path ? <FileLink path={x.attachment_path} /> : x.claim_file ? <FileLink path={x.claim_file} /> : '—'}</td>
        <td data-l="ভাউচার">{x.voucher_no ? <span className="row"><b>{x.voucher_no}</b><button className="secondary sm no-print" onClick={() => void print(x)}>প্রিন্ট</button></span>
          : x.attachment_path || x.bill_no ? <span className="muted">লাগবে না</span>
          : s.can_edit ? <button className="secondary sm no-print" onClick={() => void makeVoucher(x)}>ভাউচার বানান</button> : '—'}</td>
        <td data-l="OCR">{!x.ocr ? '—' : x.ocr_verified ? <Badge tone="ok">যাচাই হয়েছে</Badge> : <Badge tone="warn">যাচাই বাকি</Badge>}</td>
        <ExtraCells s={s} settings={settings} sec="expense" row={x.id} reload={reload} />
        <td className="no-print">{s.can_edit && <span className="row"><button className="secondary sm" onClick={() => edit(x)}>এডিট</button><button className="danger sm" onClick={() => setRemove(x)}>বাদ</button></span>}</td></tr>)}
        {list.length === 0 && <tr><td colSpan={13} className="muted">কোনো খরচ নেই।</td></tr>}</tbody>
      {list.length > 0 && <tfoot><tr><td colSpan={5}>মোট ({num(list.length)} টি) · যাতায়াত {taka(tSum)} · কর্মী {taka(eSum)}</td>
        <td data-l="মোট খরচ" className="r">{taka(tSum + eSum)}</td><td colSpan={7} className="no-print" /></tr></tfoot>}</table></div>

    {d && <Modal title={`${d.line ? 'এডিট' : 'নতুন'} · ${d.kind === 'transport' ? 'যাতায়াত খরচ' : 'কর্মীর খরচ'}`} wide onClose={() => setD(null)}
      actions={<><button className="secondary" onClick={() => setD(null)}>বাতিল</button><button disabled={busy || up.progress !== null || (!!d.ocr && !d.verified)} onClick={() => void save()}>{busy ? 'সেভ হচ্ছে…' : 'যাচাই করে সেভ'}</button></>}>
      <Field label="বিল / মেমোর ছবি বা PDF" hint={up.progress !== null ? `পড়া হচ্ছে… ${num(Math.round(up.progress * 100))}%` : d.path ? 'আপলোড হয়েছে' : `ছবি দিলে AI/OCR দিয়ে তথ্য পূরণ হবে · সর্বোচ্চ ${num(billCfg.max_mb)} MB`}>
        <input type="file" accept="image/png,image/jpeg,application/pdf" onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f) }} /></Field>
      <ErrorNote error={up.err} /><OcrNote ocr={d.ocr} min={settings['da.ocr'].min_confidence} />
      <div className="da-grid3">
        <Field label="খরচের নাম *" hint="যেমন: CNG ভাড়া, ভ্যানের তেল"><input autoFocus={!d.line} value={d.name} onChange={e => setD({ ...d, name: e.target.value })} /></Field>
        <Field label="বিলের টাকা *"><input type="number" min={1} value={d.amount} onChange={e => setD({ ...d, amount: e.target.value })} /></Field>
        <Field label={d.kind === 'employee' ? 'কার খরচ — Employee ID *' : 'কার খরচ — Employee ID'} hint={d.employeeName || 'রাইডার বা স্টাফের আইডি'}>
          <input inputMode="numeric" value={d.employee} onChange={e => { setD({ ...d, employee: e.target.value, employeeName: '' }); void lookup(e.target.value) }} /></Field>
        <Field label="খাত *" wide><select value={d.category} onChange={e => setD({ ...d, category: e.target.value })}>{cats.map(c => <option key={c.code} value={c.code}>{c.bn} ({c.en})</option>)}</select>
          <CatHelp cat={cats.find(c => c.code === d.category)} amount={+d.amount || 0} /></Field>
        {refPeople.length > 0 && <Field label="রেফারেন্স (তালিকা থেকে)" hint={<>বাছলে নাম, নম্বর ও পদবি এক ক্লিকে বসবে · <a href="/app/references" target="_self">নতুন নাম যোগ</a></>}>
          <select value="" onChange={e => { const r = refPeople[+e.target.value]; if (r) setD({ ...d, refName: r.name, refPhone: r.phone ?? '', refPosition: r.position ?? '' }) }}>
            <option value="">— বেছে নিন —</option>
            {refPeople.map((r, i) => <option key={`${r.name}-${i}`} value={i}>{r.name}{r.position ? ` · ${r.position}` : ''}</option>)}
          </select></Field>}
        <Field label="রেফারেন্সের নাম" hint="কার মাধ্যমে / কার কথায় খরচ"><input value={d.refName} onChange={e => setD({ ...d, refName: e.target.value })} /></Field>
      </div>
      <details className="da-more no-print"><summary>আরও তথ্য (দরকার হলে)</summary><div className="da-grid3">
        <Field label="ধরন"><select value={d.kind} onChange={e => setD({ ...d, kind: e.target.value as XDraft['kind'] })}><option value="transport">যাতায়াত</option><option value="employee">কর্মীর খরচ</option></select></Field>
        <Field label="টেমপ্লেট"><select value={d.template} onChange={e => applyTemplate(e.target.value)}><option value="">— নেই —</option>{active.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        <Field label="বিলের তারিখ *"><input type="date" max={todayDhaka()} value={d.date} onChange={e => setD({ ...d, date: e.target.value })} /></Field>
        <Field label="বিল নম্বর"><input value={d.billNo} onChange={e => setD({ ...d, billNo: e.target.value })} /></Field>
        <Field label="কে দিয়েছেন (Employee ID)"><input inputMode="numeric" value={d.paidBy} onChange={e => setD({ ...d, paidBy: e.target.value })} /></Field>
        <Field label="কোন গাড়ির জন্য" hint="গাড়ি বাছলে খরচটা যার নামে গাড়ি আছে তার পাতায়ও দেখাবে">
          <select value={d.vehicle} onChange={e => setD({ ...d, vehicle: e.target.value })}>
            <option value="">— গাড়ি নয় —</option>
            {(vehicles.data ?? []).filter(v => v.status === 'active').map(v =>
              <option key={v.id} value={v.id}>{v.name} ({v.code}){v.holder_name ? ` — ${v.holder_name}` : ''}</option>)}
          </select></Field>
        <Field label={`রেফারেন্স নম্বর${refCfg.reference_required ? ' *' : ''}`}><input value={d.ref} onChange={e => setD({ ...d, ref: e.target.value })} /></Field>
        <Field label="রেফারেন্সের মোবাইল"><input inputMode="numeric" placeholder="01XXXXXXXXX" value={d.refPhone} onChange={e => setD({ ...d, refPhone: e.target.value })} /></Field>
        <Field label="রেফারেন্সের পদবি"><input value={d.refPosition} onChange={e => setD({ ...d, refPosition: e.target.value })} /></Field>
        <Field label="মন্তব্য" wide><input value={d.remarks} onChange={e => setD({ ...d, remarks: e.target.value })} /></Field>
      </div></details>
      {needBill && <p className="notice">৳ {num(billCfg.required_over)} বা বেশি খরচে বিল/মেমো সংযুক্ত করতে হবে — না হলে Submit হবে না।</p>}
      {d.ocr && <label className="da-check"><input type="checkbox" checked={d.verified} onChange={e => setD({ ...d, verified: e.target.checked })} /> আমি বিলের সাথে নাম, টাকা, তারিখ ও নম্বর মিলিয়ে দেখেছি</label>}
      <ErrorNote error={err} />
    </Modal>}
    {remove && <RemoveDialog what={`${remove.expense_name} · ${taka(remove.amount)}`} onClose={() => setRemove(null)}
      onOk={async reason => { await da.removeLine('expense', remove.id, reason); setRemove(null); await reload('বাদ দেওয়া হয়েছে') }} />}
  </section>
}

/** What belongs in this category, and what to do with it on the main site. */
function CatHelp({ cat, amount }: { cat?: Category; amount: number }) {
  if (!cat) return null
  const over = cat.site_limit != null && amount > cat.site_limit
  return <span className="cat-help">
    {cat.note_bn && <span className="muted small">{cat.note_bn}</span>}
    {cat.site_name
      ? <span className={over ? 'notice' : 'muted small'}>মেইন সাইটে: <b>{cat.site_name}</b>{cat.site_sub ? ` → ${cat.site_sub}` : ''}
          {cat.site_limit != null && ` · সর্বোচ্চ ৳ ${num(cat.site_limit)}`}{cat.site_receipt ? ' · রসিদ লাগবে' : ''}
          {over && ` — এই খরচ সীমার বেশি, হেড অফিসের অনুমোদন নিন।`}</span>
      : <span className="muted small">{cat.site_note_bn ?? 'মেইন সাইটে যায় না।'}</span>}
  </span>
}

/** Bills the staff put up themselves. The manager takes one in with a click. */
function ClaimsPanel({ s, settings, cats, reload, ls }: { s: Sheet; settings: DaSettings; cats: Category[]; reload: (m?: string) => Promise<void>; ls: LS }) {
  const claims = useLoad(() => s.can_edit ? da.sheetClaims(s.session.id) : Promise.resolve([] as Claim[]), [s.session.id, s.can_edit])
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [reject, setReject] = useState<Claim | null>(null)
  const [note, setNote] = useState('')
  const list = claims.data ?? []

  async function add(c: Claim) {
    setErr(null); setBusy(c.id)
    try { await da.addClaim(c.id, s.session.id); await claims.reload(); await reload(`${c.employee_name ?? ''}-এর বিল শীটে যোগ হয়েছে`) }
    catch (e) { setErr(e) } finally { setBusy(null) }
  }
  async function turnDown() {
    if (!reject) return
    setErr(null); setBusy(reject.id)
    try { await da.rejectClaim(reject.id, note); setReject(null); setNote(''); await claims.reload(); await reload('বিলটি বাতিল করা হয়েছে') }
    catch (e) { setErr(e) } finally { setBusy(null) }
  }

  if (!s.can_edit && list.length === 0) return null
  return <section className="panel" id="da-claims">
    <div className="da-bar"><h2>কর্মীদের জমা দেওয়া বিল {list.length > 0 && <Badge tone="warn">{num(list.length)} টি</Badge>}</h2>
      <SectionMenu sec="claims" title="কর্মীদের জমা দেওয়া বিল" s={s} settings={settings} onLayoutSaved={ls} /></div>
    <p className="muted small">কর্মীরা “আমার হিসাব” থেকে নিজের খরচ জমা দেন। এখান থেকে এক ক্লিকে আজকের খাতায় তুলে নিন।</p>
    <ErrorNote error={err ?? claims.error} />
    {list.length === 0 ? <p className="muted">এখন কোনো বিল অপেক্ষায় নেই।</p> :
      <div className="da-table-wrap"><table className="da-table" data-sec="claims">
        <thead><tr><th>নং</th><th>কে</th><th>খরচ</th><th>খাত</th><th className="r">টাকা</th><th>তারিখ</th><th>গাড়ি</th><th>রেফারেন্স</th><th>বিল ফাইল</th><th className="no-print" /></tr></thead>
        <tbody>{list.map(c => <tr key={c.id}>
          <td data-l="নং">{num(c.no)}</td>
          <td data-l="কে">{c.employee_name}<span className="sec">ID {c.employee_code}</span></td>
          <td data-l="খরচ"><b>{c.expense_name}</b>{c.remarks ? <span className="sec">{c.remarks}</span> : null}</td>
          <td data-l="খাত">{cats.find(x => x.code === c.category)?.bn ?? c.category}</td>
          <td data-l="টাকা" className="r">{taka(c.amount)}</td>
          <td data-l="তারিখ">{dateBn(c.bill_date)}</td>
          <td data-l="গাড়ি">{c.vehicle_name ?? '—'}</td>
          <td data-l="রেফারেন্স">{c.reference_name ? <>{c.reference_name}<span className="sec">{[c.reference_position, c.reference_phone].filter(Boolean).join(' · ')}</span></> : '—'}</td>
          <td data-l="ফাইল">{c.attachment_path ? <FileLink path={c.attachment_path} /> : '—'}</td>
          <td className="no-print">{s.can_edit && <span className="row">
            <button className="sm" disabled={busy === c.id} onClick={() => void add(c)}>শীটে যোগ</button>
            <button className="danger sm" onClick={() => { setReject(c); setNote('') }}>বাতিল</button></span>}</td>
        </tr>)}</tbody></table></div>}
    {reject && <Modal title={`${reject.employee_name}-এর বিল বাতিল`} onClose={() => setReject(null)}
      actions={<><button className="secondary" onClick={() => setReject(null)}>ফিরে যান</button>
        <button className="danger" disabled={busy === reject.id} onClick={() => void turnDown()}>বাতিল করুন</button></>}>
      <p className="muted small">{reject.expense_name} · {taka(reject.amount)} · {dateBn(reject.bill_date)}</p>
      <Field label="কেন বাতিল হচ্ছে *"><input value={note} onChange={e => setNote(e.target.value)} placeholder="যেমন: বিল নেই / হাবের খরচে পড়ে না" /></Field>
      <ErrorNote error={err} />
    </Modal>}
  </section>
}

/** The bottom line of the day: what came in, what went out, what should be in hand. */
function ClosingBox({ s, settings }: { s: Sheet; settings: DaSettings }) {
  const paid = s.riders.reduce((a, r) => a + r.paid_amount, 0)
  const amount = s.riders.reduce((a, r) => a + r.amount, 0)
  const due = s.riders.reduce((a, r) => a + r.due, 0)
  const mb = s.riders.reduce((a, r) => a + r.mobile_banking, 0)
  const merchant = s.merchant_payments.reduce((a, m) => a + m.amount, 0)
  const expense = s.expenses.reduce((a, x) => a + x.amount, 0)
  const rule = settings['da.mobile_banking_rule']
  const inHand = paid - merchant - expense
  const row = (label: string, value: string, note?: string, tone?: 'warn' | 'bad') =>
    <tr><td>{label}{note ? <span className="sec">{note}</span> : null}</td><td className={`r ${tone ?? ''}`}>{value}</td></tr>

  return <section className="panel" id="da-close">
    <h2>দিন শেষের হিসাব</h2>
    <div className="da-table-wrap"><table className="da-table da-close">
      <tbody>
        {row('রাইডারদের মোট টাকা', taka(amount), `${num(s.riders.length)} জন রাইডার`)}
        {row('যা জমা দিয়েছেন (ক্যাশ)', taka(paid))}
        {row('− মার্চেন্ট ক্যাশ পেমেন্ট', `− ${taka(merchant)}`, `${num(s.merchant_payments.length)} টি`)}
        {row('− খরচ', `− ${taka(expense)}`, `${num(s.expenses.length)} টি`)}
      </tbody>
      <tfoot>
        <tr><td><b>হাতে থাকার কথা</b><span className="sec">জমা − পেমেন্ট − খরচ</span></td>
          <td className="r"><b className={inHand < 0 ? 'bad' : ''}>{taka(inHand)}</b></td></tr>
      </tfoot>
    </table></div>
    <div className="da-close-side">
      <p className="muted small">বকেয়া: <b className={due > 0 ? 'bad' : ''}>{taka(due)}</b> — আজ যা আদায় হয়নি, রাইডারের নামে থেকে যাবে।</p>
      <p className="muted small">মোবাইল ব্যাংকিং: <b>{taka(mb)}</b> — {rule === 'separate' ? 'আলাদা হিসাব, হাতের ক্যাশের সাথে ধরা হয়নি'
        : rule === 'reduces_due' ? 'বকেয়া থেকে বাদ গেছে' : 'বকেয়ার সাথে যোগ হয়েছে'}।</p>
      <p className="muted small">ক্যাশে গরমিল থাকলে Submit করার আগে মন্তব্যে লিখে দিন — যাচাইকারী সেটাই আগে দেখবেন।</p>
    </div>
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
    {s.can_edit && (s.session.closed_at
      ? <><span className="muted small">ডেইলি হিসাবের খাতা খোলা হয়েছে{s.session.bank_done_at ? ', ব্যাংকে জমাও শেষ' : ' — ব্যাংকে জমা বাকি থাকলে আগে সেটা শেষ করুন'}। সব ঠিক থাকলে একাউন্টসে পাঠান; পাঠানোর পর আর বদলানো যাবে না।{unchecked ? ` · OCR যাচাই বাকি ${num(unchecked)}টি` : ''}</span>
        <button className="secondary" onClick={() => open('submit')}>একাউন্টসে চূড়ান্ত জমা দিন</button></>
      : <span className="muted small">শেষ সেভ {timeBn(s.session.last_saved_at)} · উপরের ধাপগুলো শেষ করুন: খাতা Accept → ডেইলি হিসাবের খাতা → রিপোর্ট ওকে → ব্যাংকে জমা। তারপর এখানে একাউন্টসে পাঠানোর বোতাম আসবে।</span>)}
    {s.can_reopen && <button className="secondary" onClick={() => open('reopen')}>সংশোধনের জন্য খুলুন</button>}
    {showVerify && <><span className="muted small">Submit: {s.session.submitted_by_name} · {timeBn(s.session.submitted_at)}</span>
      <button className="secondary" onClick={() => open('note')}>মন্তব্য দিন</button>
      <button className="danger" onClick={() => open('correction')}>সংশোধন প্রয়োজন</button>
      <button onClick={() => open('approve')}>অনুমোদন — সব ঠিক আছে</button></>}

    {dlg === 'submit' && <Modal title="একাউন্টসে চূড়ান্ত জমা" onClose={() => setDlg(null)}
      actions={<><button className="secondary" onClick={() => setDlg(null)}>বাতিল (Cancel)</button><button className="secondary" onClick={() => setDlg(null)}>এডিট করুন (Edit)</button>
        <button disabled={busy || unchecked > 0} onClick={() => void go()}>{busy ? 'হচ্ছে…' : 'Submit'}</button></>}>
      <p><b>আপনি কি নিশ্চিত যে আজকের হিসাব একাউন্টসে চূড়ান্তভাবে জমা দিতে চান?</b> জমা দেওয়ার পর এই হাবের আজকের কোনো খাতা আর বদলানো বা Accept করা যাবে না।</p>
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


// ---------------------------------------------------------------------------- cash notes
type NoteDraft = { id?: string; amount: string; method: string; code: string; name: string; note: string }

/** Money that came to hand: who gave it, how much, by which wallet. */
function NotesPanel({ s, settings, reload, ls }: { s: Sheet; settings: DaSettings; reload: (m?: string) => Promise<void>; ls: LS }) {
  const methods = settings['da.note_methods'] ?? ['cash']
  const [d, setD] = useState<NoteDraft | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [drop, setDrop] = useState<CashNote | null>(null)
  const list = s.notes_in ?? []
  const total = list.reduce((a, n) => a + n.amount, 0)

  async function save() {
    if (!d) return
    setBusy(true); setErr(null)
    try {
      await da.saveNote({ session: s.session.id, amount: +d.amount || 0, method: d.method, fromCode: d.code || null,
        fromName: d.name || null, note: d.note || null, id: d.id })
      setD(null); await reload('নোট রাখা হলো')
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }

  return <section className="panel" id="da-notes">
    <div className="da-bar"><h2>জমা ও নোট</h2>
      <div className="row no-print">{s.can_edit && <button onClick={() => { setErr(null); setD({ amount: '', method: 'cash', code: '', name: '', note: '' }) }}>＋ নোট যোগ</button>}
        <SectionMenu sec="notes" title="জমা ও নোট" s={s} settings={settings} onAdd={() => { setErr(null); setD({ amount: '', method: 'cash', code: '', name: '', note: '' }) }} addLabel="＋ নোট যোগ" onLayoutSaved={ls} /></div></div>
    <p className="muted small">কে কত টাকা জমা দিয়ে গেলেন, কোন মাধ্যমে — এখানে লিখে রাখুন। যাঁর নামে লেখা হবে, তিনি নিজের পাতায় দেখতে পাবেন।</p>
    <ErrorNote error={err} />
    <div className="da-table-wrap"><table className="da-table" data-sec="notes">
      <thead><tr><th>নং</th><th>কার কাছ থেকে</th><th>মাধ্যম</th><th className="r">টাকা</th><th>নোট</th><th>সময়</th><ExtraHeads settings={settings} sec="notes" /><th className="no-print" /></tr></thead>
      <tbody>{list.map(n => <tr key={n.id}>
        <td data-l="নং">{num(n.no)}</td>
        <td data-l="কার"><b>{n.from_name ?? '—'}</b>{n.from_code ? <span className="sec">ID {n.from_code}</span> : null}</td>
        <td data-l="মাধ্যম">{NOTE_METHOD[n.method] ?? n.method}</td>
        <td data-l="টাকা" className="r">{taka(n.amount)}</td>
        <td data-l="নোট">{n.note ?? ''}</td>
        <td data-l="সময়">{timeBn(n.created_at)}</td>
        <ExtraCells s={s} settings={settings} sec="notes" row={n.id} reload={reload} />
        <td className="no-print">{s.can_edit && <span className="row">
          <button className="secondary sm" onClick={() => setD({ id: n.id, amount: String(n.amount), method: n.method,
            code: n.from_code ?? '', name: n.from_name ?? '', note: n.note ?? '' })}>এডিট</button>
          <button className="danger sm" onClick={() => setDrop(n)}>বাদ</button></span>}</td>
      </tr>)}
        {list.length === 0 && <tr><td colSpan={7} className="muted">কোনো নোট নেই।</td></tr>}</tbody>
      {list.length > 0 && <tfoot><tr><td colSpan={3}>মোট ({num(list.length)} টি)</td><td className="r">{taka(total)}</td><td colSpan={3} /></tr></tfoot>}
    </table></div>

    {d && <Modal title={d.id ? 'নোট এডিট' : 'জমার নোট'} onClose={() => setD(null)}
      actions={<><button className="secondary" onClick={() => setD(null)}>বাতিল</button>
        <button disabled={busy} onClick={() => void save()}>সেভ</button></>}>
      <div className="da-grid3">
        <Field label="টাকা *"><input type="number" min={0} value={d.amount} onChange={e => setD({ ...d, amount: e.target.value })} /></Field>
        <Field label="মাধ্যম"><select value={d.method} onChange={e => setD({ ...d, method: e.target.value })}>
          {methods.map(m => <option key={m} value={m}>{NOTE_METHOD[m] ?? m}</option>)}</select></Field>
        <Field label="Employee ID" hint="আইডি দিলে তিনি নিজের পাতায় দেখতে পাবেন"><input value={d.code} onChange={e => setD({ ...d, code: e.target.value })} /></Field>
        <Field label="নাম (আইডি না থাকলে)"><input value={d.name} onChange={e => setD({ ...d, name: e.target.value })} /></Field>
        <Field wide label="নোট"><input value={d.note} onChange={e => setD({ ...d, note: e.target.value })} placeholder="যেমন: বিকাশে পাঠিয়েছেন, রসিদ নেই" /></Field>
      </div>
      <ErrorNote error={err} />
    </Modal>}
    {drop && <RemoveDialog what={`${drop.from_name ?? 'নোট'} · ${taka(drop.amount)}`} onClose={() => setDrop(null)}
      onOk={async reason => { await da.removeNote(drop.id, reason); setDrop(null); await reload('নোট বাদ দেওয়া হলো') }} />}
  </section>
}

// ---------------------------------------------------------------------------- closing the day
/** The day's three totals, and the button that closes it. */
function CloseDay({ s, reload }: { s: Sheet; reload: (m?: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [why, setWhy] = useState('')
  const [ask, setAsk] = useState(false)
  const open = (s.collectors ?? []).filter(c => !c.closed_at)
  const t = s.session.closed_totals
  if (!s.can_edit && !s.session.closed_at) return null

  async function close() {
    setBusy(true); setErr(null)
    try { await da.closeDay(s.session.id); await reload('আজকের হিসাব ক্লোজ হয়েছে') }
    catch (e) { setErr(e) } finally { setBusy(false) }
  }
  async function reopen() {
    setBusy(true); setErr(null)
    try { await da.reopenDay(s.session.id, why); setAsk(false); setWhy(''); await reload('আবার খোলা হলো') }
    catch (e) { setErr(e) } finally { setBusy(false) }
  }

  return <section className="panel" id="da-close-day">
    <div className="da-bar"><h2>আজকের হিসাব ক্লোজ</h2>
      {s.session.closed_at ? <Badge tone="ok">ক্লোজ হয়েছে · {timeBn(s.session.closed_at)}</Badge> : null}</div>
    {t ? <div className="da-stats">
      <Stat label="মোট হিসাব" value={taka(t.rider_amount)} sub={`${num(t.riders)} টি লাইন`} />
      <Stat label="মোট পেমেন্ট" value={taka(t.payment_amount)} sub={`${num(t.payments)} টি`} />
      <Stat label="মোট খরচ" value={taka(t.expense_amount)} sub={`${num(t.expenses)} টি`} />
      <Stat label="জমা হয়েছে" value={taka(t.collected)} />
      <Stat label="বকেয়া" value={taka(t.due)} tone={t.due > 0 ? 'warn' : undefined} />
      <Stat label="নোটে জমা" value={taka(t.notes_in)} />
    </div> : <p className="muted small">সবার হিসাব নেওয়া শেষ হলে এখান থেকে দিনটা ক্লোজ করুন — মোট হিসাব, মোট পেমেন্ট আর মোট খরচ একসাথে বসে যাবে।</p>}
    <ErrorNote error={err} />
    {s.can_edit && <div className="row no-print">
      {!s.session.closed_at
        ? <><button disabled={busy} onClick={() => void close()}>দিন ক্লোজ করুন</button>
            {open.length > 0 && <span className="muted small">{num(open.length)} জনের হিসাব এখনো চলছে: {open.map(c => c.name ?? '—').join(' · ')}</span>}</>
        : <button className="secondary" onClick={() => setAsk(true)}>আবার খুলুন</button>}
    </div>}
    {ask && <Modal title="দিনটা আবার খুলবেন?" onClose={() => setAsk(false)}
      actions={<><button className="secondary" onClick={() => setAsk(false)}>না</button>
        <button className="danger" disabled={busy || !why.trim()} onClick={() => void reopen()}>খুলুন</button></>}>
      <Field label="কেন খুলছেন *"><input value={why} onChange={e => setWhy(e.target.value)} placeholder="যেমন: একটা খরচ বাদ পড়েছে" /></Field>
    </Modal>}
  </section>
}
