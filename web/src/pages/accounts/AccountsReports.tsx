import { useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { da, num, taka, dateBn, timeBn, todayDhaka, addDays, STATUS_LABEL, EVENT_LABEL, type ReportKind, type SheetStatus, type SheetEvent } from '../../lib/dailyAccounts'
import { xlsxBlob, download, printArea } from '../../lib/xlsx'
import { AccountsShell, Field, ErrorNote, useLoad } from './ui'

type Col = { k: string; l: string; t?: 'n' | 'tk' | 'd' | 'dt' | 'st' | 'ev' }
const KINDS: Array<[ReportKind, string, Col[]]> = [
  ['hub_daily', 'দৈনিক হাব-ভিত্তিক', [{ k: 'account_date', l: 'তারিখ', t: 'd' }, { k: 'hub_name', l: 'হাব' }, { k: 'zone_name', l: 'জোন' }, { k: 'riders', l: 'রাইডার', t: 'n' },
    { k: 'delivery', l: 'ডেলিভারি', t: 'n' }, { k: 'pickup', l: 'পিকআপ', t: 'n' }, { k: 'amount', l: 'টাকা', t: 'tk' }, { k: 'due', l: 'বকেয়া', t: 'tk' },
    { k: 'mobile_banking', l: 'মোবাইল ব্যাংকিং', t: 'tk' }, { k: 'merchant_cash', l: 'মার্চেন্ট পেমেন্ট', t: 'tk' }, { k: 'expense', l: 'খরচ', t: 'tk' },
    { k: 'status', l: 'অবস্থা', t: 'st' }, { k: 'submitted_by_name', l: 'সাবমিট করেছেন' }, { k: 'submitted_at', l: 'সাবমিট সময়', t: 'dt' }, { k: 'verified_by_name', l: 'যাচাই করেছেন' }]],
  ['rider', 'রাইডার-ভিত্তিক', [{ k: 'employee_code', l: 'ID' }, { k: 'rider_name', l: 'রাইডার' }, { k: 'mobile', l: 'মোবাইল' }, { k: 'hub', l: 'হাব' }, { k: 'days', l: 'দিন', t: 'n' },
    { k: 'delivery', l: 'ডেলিভারি', t: 'n' }, { k: 'pickup', l: 'পিকআপ', t: 'n' }, { k: 'amount', l: 'টাকা', t: 'tk' }, { k: 'paid', l: 'জমা', t: 'tk' }, { k: 'due', l: 'বকেয়া', t: 'tk' }, { k: 'mobile_banking', l: 'মোবাইল ব্যাংকিং', t: 'tk' }]],
  ['employee_expense', 'কর্মী-ভিত্তিক খরচ', [{ k: 'account_date', l: 'তারিখ', t: 'd' }, { k: 'hub', l: 'হাব' }, { k: 'employee_code', l: 'ID' }, { k: 'employee_name', l: 'কর্মী' },
    { k: 'expense_name', l: 'খরচ' }, { k: 'category', l: 'খাত' }, { k: 'amount', l: 'টাকা', t: 'tk' }, { k: 'bill_no', l: 'বিল নং' }, { k: 'reference_no', l: 'রেফারেন্স' }, { k: 'paid_by_name', l: 'দিয়েছেন' }, { k: 'status', l: 'অবস্থা', t: 'st' }]],
  ['merchant_payment', 'মার্চেন্ট পেমেন্ট', [{ k: 'account_date', l: 'তারিখ', t: 'd' }, { k: 'hub', l: 'হাব' }, { k: 'merchant_name', l: 'মার্চেন্ট' }, { k: 'payment_ref', l: 'Payment ID' },
    { k: 'transaction_id', l: 'Transaction ID' }, { k: 'amount', l: 'টাকা', t: 'tk' }, { k: 'payment_date', l: 'পেমেন্টের তারিখ', t: 'd' }, { k: 'match_status', l: 'মিল' }, { k: 'status', l: 'অবস্থা', t: 'st' }]],
  ['transport_expense', 'যাতায়াত খরচ', [{ k: 'account_date', l: 'তারিখ', t: 'd' }, { k: 'hub', l: 'হাব' }, { k: 'expense_name', l: 'খরচ' }, { k: 'category', l: 'খাত' },
    { k: 'employee_name', l: 'কর্মী' }, { k: 'amount', l: 'টাকা', t: 'tk' }, { k: 'bill_no', l: 'বিল নং' }, { k: 'reference_no', l: 'রেফারেন্স' }, { k: 'status', l: 'অবস্থা', t: 'st' }]],
  ['verification', 'হিসাব ম্যানেজার যাচাই', [{ k: 'at', l: 'সময়', t: 'dt' }, { k: 'session_no', l: 'হিসাব নং', t: 'n' }, { k: 'account_date', l: 'তারিখ', t: 'd' }, { k: 'hub', l: 'হাব' },
    { k: 'action', l: 'সিদ্ধান্ত', t: 'ev' }, { k: 'by', l: 'কে' }, { k: 'by_code', l: 'ID' }, { k: 'note', l: 'মন্তব্য' }]],
  ['pending', 'যাচাইয়ের অপেক্ষায়', [{ k: 'account_date', l: 'তারিখ', t: 'd' }, { k: 'hub_name', l: 'হাব' }, { k: 'riders', l: 'রাইডার', t: 'n' }, { k: 'amount', l: 'টাকা', t: 'tk' },
    { k: 'due', l: 'বকেয়া', t: 'tk' }, { k: 'expense', l: 'খরচ', t: 'tk' }, { k: 'submitted_by_name', l: 'সাবমিট করেছেন' }, { k: 'submitted_at', l: 'সাবমিট সময়', t: 'dt' }]],
  ['corrections', 'সংশোধনের ইতিহাস', [{ k: 'at', l: 'সময়', t: 'dt' }, { k: 'session_no', l: 'হিসাব নং', t: 'n' }, { k: 'account_date', l: 'তারিখ', t: 'd' }, { k: 'hub', l: 'হাব' },
    { k: 'action', l: 'ঘটনা', t: 'ev' }, { k: 'by', l: 'কে' }, { k: 'note', l: 'কারণ / মন্তব্য' }]],
]

const show = (v: unknown, t?: Col['t']) => v === null || v === undefined || v === '' ? '—'
  : t === 'n' ? num(v as number) : t === 'tk' ? taka(v as number) : t === 'd' ? dateBn(String(v)) : t === 'dt' ? timeBn(String(v))
  : t === 'st' ? STATUS_LABEL[v as SheetStatus] ?? String(v) : t === 'ev' ? EVENT_LABEL[v as SheetEvent['action']] ?? String(v) : String(v)
const raw = (v: unknown, t?: Col['t']) => v === null || v === undefined ? '' : t === 'n' || t === 'tk' ? Number(v)
  : t === 'st' ? STATUS_LABEL[v as SheetStatus] ?? String(v) : t === 'ev' ? EVENT_LABEL[v as SheetEvent['action']] ?? String(v) : String(v)

export function AccountsReports() {
  const { can } = useAuth()
  const today = todayDhaka()
  const [kind, setKind] = useState<ReportKind>('hub_daily')
  const [from, setFrom] = useState(addDays(today, -6))
  const [to, setTo] = useState(today)
  const [hub, setHub] = useState('')
  const hubs = useLoad(() => da.myHubs(), [])
  const rep = useLoad(() => da.report(kind, from, to, hub || null), [kind, from, to, hub])
  const def = KINDS.find(k => k[0] === kind)!
  const rows = rep.data ?? []
  const totals = def[2].filter(c => c.t === 'n' || c.t === 'tk').map(c => [c.k, rows.reduce((a, r) => a + Number(r[c.k] ?? 0), 0)] as const)
  const sub = `${dateBn(from)} – ${dateBn(to)} · ${hub ? (hubs.data ?? []).find(h => h.hub_id === hub)?.name ?? '' : 'সব হাব'}`

  return <AccountsShell title="হিসাবের রিপোর্ট" subtitle="Daily Accounts · Reports & Export"
    actions={can('da.report.export') || can('da.report.print') ? <>
      {can('da.report.export') && <button onClick={() => download(xlsxBlob(`XZM-TEAM — ${def[1]}`, sub, def[2].map(c => c.l), rows.map(r => def[2].map(c => raw(r[c.k], c.t)))), `daily-accounts-${kind}-${from}-${to}.xlsx`)}>Excel</button>}
      {can('da.report.export') && <button className="secondary" onClick={() => printArea(`daily-accounts-${kind}-${from}-${to}`)}>PDF</button>}
      {can('da.report.print') && <button className="secondary" onClick={() => printArea(`daily-accounts-${kind}`)}>প্রিন্ট</button>}</> : undefined}>
    <div className="nv-chips no-print" role="group" aria-label="কোন রিপোর্ট" style={{ marginBottom: 10 }}>{KINDS.map(k => <button key={k[0]} type="button" className={`nv-chip${kind === k[0] ? ' on' : ''}`} aria-pressed={kind === k[0]} onClick={() => setKind(k[0])}>{k[1]}</button>)}</div>
    <div className="nv-chips no-print" role="group" aria-label="কোন সময়ের" style={{ marginBottom: 10 }}>
      <button type="button" className={`nv-chip${from === today && to === today ? ' on' : ''}`} onClick={() => { setFrom(today); setTo(today) }}>আজ</button>
      <button type="button" className={`nv-chip${from === addDays(today, -6) && to === today ? ' on' : ''}`} onClick={() => { setFrom(addDays(today, -6)); setTo(today) }}>৭ দিন</button>
      <button type="button" className={`nv-chip${from === today.slice(0, 8) + '01' && to === today ? ' on' : ''}`} onClick={() => { setFrom(today.slice(0, 8) + '01'); setTo(today) }}>এ মাস</button></div>
    <section className="da-filters panel no-print">
      <Field label="শুরুর তারিখ"><input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></Field>
      <Field label="শেষ তারিখ"><input type="date" value={to} min={from} max={today} onChange={e => setTo(e.target.value)} /></Field>
      <Field label="হাব"><select value={hub} onChange={e => setHub(e.target.value)}><option value="">সব হাব</option>{(hubs.data ?? []).map(h => <option key={h.hub_id} value={h.hub_id}>{h.name}</option>)}</select></Field>
    </section>
    <ErrorNote error={rep.error} />
    <section className="panel print-area">
      <h2>{def[1]} <span className="muted small">{sub} · {num(rows.length)}টি সারি</span></h2>
      {rep.loading ? <p className="muted">লোড হচ্ছে…</p> : <div className="da-table-wrap"><table className="da-table">
        <thead><tr><th>#</th>{def[2].map(c => <th key={c.k} className={c.t === 'n' || c.t === 'tk' ? 'r' : ''}>{c.l}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}><td data-l="#">{num(i + 1)}</td>{def[2].map(c => <td key={c.k} data-l={c.l} className={c.t === 'n' || c.t === 'tk' ? 'r' : ''}>{show(r[c.k], c.t)}</td>)}</tr>)}
          {rows.length === 0 && <tr><td colSpan={def[2].length + 1} className="muted">এই সময়ে কোনো তথ্য নেই।</td></tr>}</tbody>
        {rows.length > 0 && totals.length > 0 && <tfoot><tr><td><b>মোট</b></td>{def[2].map(c => { const t = totals.find(x => x[0] === c.k); return <td key={c.k} className="r"><b>{t ? show(t[1], c.t) : ''}</b></td> })}</tr></tfoot>}
      </table></div>}
    </section>
  </AccountsShell>
}
