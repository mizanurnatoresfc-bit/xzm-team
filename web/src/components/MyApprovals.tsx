// আমার অনুমোদন — the manager's one card on the dashboard: everything waiting for their decision.
//  * what riders/staff sent (pickup, delivery, money) into my khata — accept, send back, or accept all
//  * staff expense bills of my hubs — take into today's khata (opened automatically if needed), or turn down
//  * the other approvals (ID applications, leave, sheets to check, HR requests) as counts with a link
// Every rule stays in the database; this only reads what the person may see and calls the same functions.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { da, todayDhaka } from '../lib/dailyAccounts'
import { dashboard } from '../lib/dashboard'
import { org } from '../lib/hr'
import { usePrefs } from '../lib/prefs'
import { supabase } from '../lib/supabase'
import { ErrorNote, useLoad } from '../pages/accounts/ui'
import { Icon } from './Icon'

type RiderRow = { id: string; session_id: string; hub_id: string; rider_name: string; employee_code: string; pickup_qty: number
  delivery_qty: number; amount: number; seq: number; office_deposit: boolean; created_at: string }
type BillRow = { id: string; no: number; hub_id: string; employee_code: string | null; employee_name: string | null; kind: 'transport' | 'employee'
  expense_name: string; category: string; amount: number; bill_date: string; attachment_path: string | null; remarks: string | null; created_at: string }
type Tab = 'rider' | 'bill' | 'other'

export function MyApprovalCard() {
  const { L, n } = usePrefs()
  const { session, can } = useAuth()
  const uid = session?.user.id ?? ''
  const canBills = can('da.sheet.create')
  const d = useLoad(async () => {
    if (!uid) return null
    const [riders, bills, other, hubs] = await Promise.all([
      supabase.from('da_rider_lines')
        .select('id, session_id, hub_id, rider_name, employee_code, pickup_qty, delivery_qty, amount, seq, office_deposit, created_at')
        .eq('created_by', uid).eq('source', 'rider').is('accepted_at', null).is('removed_at', null).order('created_at').limit(200)
        .then(r => { if (r.error) throw r.error; return (r.data ?? []) as RiderRow[] }),
      canBills ? supabase.from('da_expense_claims')
        .select('id, no, hub_id, employee_code, employee_name, kind, expense_name, category, amount, bill_date, attachment_path, remarks, created_at')
        .eq('status', 'submitted').order('created_at').limit(200)
        .then(r => { if (r.error) throw r.error; return (r.data ?? []) as BillRow[] }) : Promise.resolve([] as BillRow[]),
      dashboard.approvals(can, { throwOnError: true }),
      org.hubs().catch(() => []),
    ])
    return { riders, bills, other, hubs: new Map(hubs.map(h => [h.id, h.name])) }
  }, [uid, canBills])
  const [tab, setTab] = useState<Tab | null>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState<unknown>(null)
  const [back, setBack] = useState<{ kind: 'rider' | 'bill'; id: string } | null>(null)
  const [reason, setReason] = useState('')
  const [done, setDone] = useState<string | null>(null)
  useEffect(() => { if (!done) return; const t = window.setTimeout(() => setDone(null), 3500); return () => window.clearTimeout(t) }, [done])
  // riders keep sending through the day: look again every minute
  useEffect(() => { const t = window.setInterval(() => void d.reload(), 60000); return () => window.clearInterval(t) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (d.error) return <section className="panel">
    <h2>{L('আমার অনুমোদন', 'My approvals')}</h2>
    <ErrorNote error={d.error} />
    <button type="button" className="secondary" disabled={d.loading} onClick={() => void d.reload()}>{L('আবার চেষ্টা করুন', 'Retry')}</button>
  </section>

  const v = d.data
  if (!v) return null
  const { riders, bills, other } = v
  const others: Array<[string, number, string, string, string]> = ([
    ['/app/accounts/daily', other.sheets, L('হিসাব খাতা যাচাই', 'Daily sheets to check'), 'ledger', 'g'],
    ['/app/hr/requests?tab=list', other.hrreq, L('এইচআর রিকুয়েস্ট', 'HR requests'), 'users', 'o'],
  ] as Array<[string, number, string, string, string]>).filter(r => r[1] >= 0)
  const otherTotal = others.reduce((a, r) => a + r[1], 0)
  // nothing to approve and no right to approve anything: no card
  if (!riders.length && !bills.length && !others.length && !canBills) return null
  const total = riders.length + bills.length + otherTotal
  const cur: Tab = tab ?? (riders.length ? 'rider' : bills.length ? 'bill' : 'other')
  const many = new Set([...riders.map(r => r.hub_id), ...bills.map(b => b.hub_id)]).size > 1
  const hubOf = (id: string) => (many ? v.hubs.get(id) ?? '' : '')
  const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + f(r), 0)
  const today = todayDhaka()

  async function run(key: string, f: () => Promise<unknown>, msg: string) {
    setBusy(key); setErr(null)
    try { await f(); setBack(null); setReason(''); setDone(msg); await d.reload() }
    catch (e) {
      setErr(e)
      // "accept all" may have got part-way: show what is still waiting instead of lines that are already taken
      await d.reload().catch(() => undefined)
    } finally { setBusy('') }
  }
  /** Today's khata of the hub; opened now when nobody has opened it yet. */
  async function sheetOf(hub: string) {
    const { data } = await supabase.from('da_sessions').select('id').eq('hub_id', hub).eq('account_date', today).maybeSingle()
    return (data as { id: string } | null)?.id ?? await da.start(hub, today)
  }
  const takeBill = async (b: BillRow) => { await da.addClaim(b.id, await sheetOf(b.hub_id)) }
  const acceptAllRiders = async () => { for (const s of new Set(riders.map(r => r.session_id))) await da.riderAcceptAll(s) }
  const takeAllBills = async () => { for (const b of bills) await takeBill(b) }

  const backBox = (kind: 'rider' | 'bill', id: string, send: () => Promise<unknown>) => back?.kind === kind && back.id === id
    ? <span className="ri-back">
        <input autoFocus placeholder={L('কারণ লিখুন', 'Write the reason')} value={reason} onChange={e => setReason(e.target.value)} />
        <button type="button" className="secondary" disabled={!!busy || !reason.trim()} onClick={() => void run(id, send, L('ফেরত দেওয়া হয়েছে', 'Sent back'))}>{kind === 'rider' ? L('ফেরত দিন', 'Send back') : L('বাতিল করুন', 'Turn down')}</button>
        <button type="button" className="link" onClick={() => setBack(null)}>{L('থাক', 'Cancel')}</button></span>
    : null

  return <section className="panel rinbox myapp">
    <div className="da-bar"><h2 style={{ margin: 0 }}>{L('আমার অনুমোদন', 'My approvals')} {total > 0 && <span className="ap-total">{n(total)}</span>}</h2>
      <button type="button" className="link small" onClick={() => void d.reload()} disabled={d.loading}>{L('আবার দেখুন', 'Refresh')}</button></div>

    {total === 0 ? <div className="ap-clear"><Icon name="check" size={20} />{L('সব পরিষ্কার — কিছু বাকি নেই', 'All clear — nothing waiting')}</div> : <>
      <div className="ma-sum">
        <button type="button" className="t-b" onClick={() => setTab('rider')}><Icon name="box" size={18} /><b>{n(sum(riders, r => r.pickup_qty))}</b><small>{L('পিকআপ', 'Pickups')}</small></button>
        <button type="button" className="t-p" onClick={() => setTab('rider')}><Icon name="truck" size={18} /><b>{n(sum(riders, r => r.delivery_qty))}</b><small>{L('ডেলিভারি', 'Deliveries')}</small></button>
        <button type="button" className="t-g" onClick={() => setTab('rider')}><Icon name="cash" size={18} /><b>৳{n(sum(riders, r => Number(r.amount)))}</b><small>{L('রাইডারের টাকা', 'Rider money')}</small></button>
        {canBills && <button type="button" className="t-o" onClick={() => setTab('bill')}><Icon name="receipt" size={18} /><b>৳{n(sum(bills, b => Number(b.amount)))}</b><small>{L(`খরচের বিল · ${n(bills.length)}টি`, `Expense bills · ${bills.length}`)}</small></button>}
      </div>

      <nav className="da-tabs ma-tabs" aria-label={L('কী অনুমোদন', 'What to approve')}>
        <button type="button" className={cur === 'rider' ? 'on' : ''} onClick={() => setTab('rider')}>{L('পিকআপ · ডেলিভারি · টাকা', 'Pickup · delivery · money')} ({n(riders.length)})</button>
        {canBills && <button type="button" className={cur === 'bill' ? 'on' : ''} onClick={() => setTab('bill')}>{L('খরচের বিল', 'Expense bills')} ({n(bills.length)})</button>}
        {otherTotal > 0 && <button type="button" className={cur === 'other' ? 'on' : ''} onClick={() => setTab('other')}>{L('অন্যান্য', 'Other')} ({n(otherTotal)})</button>}
      </nav>
      <ErrorNote error={err} />
      {done && <p className="rs-done" role="status"><Icon name="check" size={16} />{done}</p>}

      {cur === 'rider' && (!riders.length ? <p className="muted small">{L('রাইডার/স্টাফের পাঠানো কোনো হিসাব বাকি নেই।', 'Nothing sent by riders is waiting.')}</p> : <>
        <div className="ma-all"><span className="small muted">{L(`${n(riders.length)}টি হিসাব আপনার খাতায় গ্রহণের অপেক্ষায়`, `${riders.length} waiting in your khata`)}</span>
          <button type="button" disabled={!!busy} onClick={() => void run('all-r', acceptAllRiders, L('সব হিসাব গ্রহণ করা হয়েছে', 'All accepted'))}>
            <Icon name="checkall" size={16} />{busy === 'all-r' ? L('হচ্ছে…', 'Working…') : L(`সব গ্রহণ · ৳${n(sum(riders, r => Number(r.amount)))}`, `Accept all · ৳${sum(riders, r => Number(r.amount))}`)}</button></div>
        <ul className="ri-list">{riders.map(r => <li key={r.id} data-kind="rider">
          <span className="ri-who"><b>{r.rider_name}</b><small>#{n(r.employee_code)}{r.seq > 1 ? ` · ${n(r.seq)}${L('য় বার', ' time')}` : ''}{hubOf(r.hub_id) ? ` · ${hubOf(r.hub_id)}` : ''}</small></span>
          <span className="ri-v">{n(r.pickup_qty)} {L('পিকআপ', 'pickup')} · {n(r.delivery_qty)} {L('ডেলিভারি', 'delivery')} · <b>৳{n(Number(r.amount))}</b>{r.office_deposit ? L(' · অফিসে জমা', ' · at office') : ''}</span>
          {backBox('rider', r.id, () => da.riderAccept(r.id, false, reason)) ?? <span className="ri-acts">
            <button type="button" disabled={!!busy} onClick={() => void run(r.id, () => da.riderAccept(r.id, true), L(`${r.rider_name} — গ্রহণ করা হয়েছে`, `${r.rider_name} — accepted`))}><Icon name="check" size={16} />{L('গ্রহণ', 'Accept')}</button>
            <button type="button" className="secondary" disabled={!!busy} onClick={() => { setBack({ kind: 'rider', id: r.id }); setReason('') }}>{L('ফেরত', 'Back')}</button></span>}
        </li>)}</ul></>)}

      {cur === 'bill' && canBills && (!bills.length ? <p className="muted small">{L('কর্মীদের জমা দেওয়া কোনো বিল বাকি নেই।', 'No staff bills are waiting.')}</p> : <>
        <div className="ma-all"><span className="small muted">{L('গ্রহণ করলে আজকের খাতার খরচে উঠবে', 'Accepted bills go into today’s khata as expenses')}</span>
          <button type="button" disabled={!!busy} onClick={() => void run('all-b', takeAllBills, L('সব বিল খাতায় উঠেছে', 'All bills taken in'))}>
            <Icon name="checkall" size={16} />{busy === 'all-b' ? L('হচ্ছে…', 'Working…') : L(`সব খাতায় তুলুন · ৳${n(sum(bills, b => Number(b.amount)))}`, `Take all · ৳${sum(bills, b => Number(b.amount))}`)}</button></div>
        <ul className="ri-list">{bills.map(b => <li key={b.id} data-kind="bill">
          <span className="ri-who"><b>{b.employee_name ?? '—'}</b><small>{b.employee_code ? `#${n(b.employee_code)}` : ''}{hubOf(b.hub_id) ? ` · ${hubOf(b.hub_id)}` : ''}</small></span>
          <span className="ri-v">{b.expense_name}{b.kind === 'transport' ? L(' · যাতায়াত', ' · transport') : ''} · <b>৳{n(Number(b.amount))}</b>
            <small className="muted"> · {new Date(b.bill_date + 'T00:00:00').toLocaleDateString(L('bn-BD', 'en-GB'), { day: 'numeric', month: 'short' })}</small>
            {b.attachment_path && <> · <button type="button" className="link" onClick={() => void da.fileUrl(b.attachment_path!).then(u => window.open(u, '_blank', 'noopener')).catch(e => setErr(e))}>{L('বিল দেখুন', 'See bill')}</button></>}</span>
          {backBox('bill', b.id, () => da.rejectClaim(b.id, reason)) ?? <span className="ri-acts">
            <button type="button" disabled={!!busy} onClick={() => void run(b.id, () => takeBill(b), L(`${b.expense_name} — খাতায় উঠেছে`, `${b.expense_name} — taken in`))}><Icon name="check" size={16} />{L('গ্রহণ', 'Accept')}</button>
            <button type="button" className="secondary" disabled={!!busy} onClick={() => { setBack({ kind: 'bill', id: b.id }); setReason('') }}>{L('বাতিল', 'Turn down')}</button></span>}
        </li>)}</ul></>)}

      {cur === 'other' && <div className="ap-list">{others.map(([to, c, t, ic, tone]) => <Link key={to} to={to} className={`ap-row${c ? '' : ' zero'}`}>
        <span className={`hrq-ic t-${tone}`}><Icon name={ic} size={16} /></span><span className="ap-t">{t}</span><span className={`ap-c${c ? ' on' : ''}`}>{n(c)}</span></Link>)}</div>}
    </>}
  </section>
}
