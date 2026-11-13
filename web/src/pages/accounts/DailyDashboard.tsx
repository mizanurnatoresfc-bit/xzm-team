import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { da, num, taka, dateBn, timeBn, todayDhaka, addDays, STATUS_LABEL, type SheetStatus, type SessionRow } from '../../lib/dailyAccounts'
import { AccountsShell, Stat, StatusBadge, Modal, Field, ErrorNote, useLoad, useToast } from './ui'

// Accounts Management → Daily Accounts dashboard (আজকের হিসাব খাতা)
export function DailyDashboard() {
  const nav = useNavigate()
  const today = todayDhaka()
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [hub, setHub] = useState('')
  const [status, setStatus] = useState<SheetStatus | ''>('')
  const [q, setQ] = useState('')
  const [view, setView] = useState<'table' | 'cards'>('table')
  const [start, setStart] = useState<{ hub: string; date: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const { toast, node } = useToast()

  const hubs = useLoad(() => da.myHubs(), [])
  const dash = useLoad(() => da.dashboard(from, to, hub || null), [from, to, hub])
  const list = useLoad(() => da.list(from, to, hub || null, null, status || null), [from, to, hub, status])
  const startable = (hubs.data ?? []).filter(h => h.can_submit)

  const rows = useMemo(() => (list.data ?? []).filter(r => !q.trim() || [r.no, r.hub_name, r.zone_name, r.started_by_name, r.submitted_by_name]
    .join(' ').toLowerCase().includes(q.trim().toLowerCase())), [list.data, q])
  const d = dash.data

  async function doStart() {
    if (!start) return
    setBusy(true); setErr(null)
    try {
      const id = await da.start(start.hub, start.date)
      toast('হিসাব শুরু হয়েছে ও সংরক্ষিত হয়েছে')
      nav(`/app/accounts/daily/${id}`)
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  const existingFor = (h: string, date: string) => (list.data ?? []).find(r => r.hub_id === h && r.account_date === date)

  return <AccountsShell title="আজকের হিসাব খাতা" subtitle={`Accounts Management → Daily Accounts · আজ ${dateBn(today)}`}
    actions={startable.length > 0 && <button onClick={() => { setErr(null); setStart({ hub: startable[0].hub_id, date: today }) }}>＋ আজকের হিসাব শুরু করুন</button>}>
    {node}
    <section className="da-filters panel no-print">
      <Field label="শুরুর তারিখ"><input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></Field>
      <Field label="শেষ তারিখ"><input type="date" value={to} min={from} max={today} onChange={e => setTo(e.target.value)} /></Field>
      <Field label="হাব"><select value={hub} onChange={e => setHub(e.target.value)}>
        <option value="">সব হাব</option>{(hubs.data ?? []).map(h => <option key={h.hub_id} value={h.hub_id}>{h.name} · {h.zone_name}</option>)}</select></Field>
      <Field label="অবস্থা"><select value={status} onChange={e => setStatus(e.target.value as SheetStatus | '')}>
        <option value="">সব</option>{(Object.keys(STATUS_LABEL) as SheetStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></Field>
      <div className="da-quick">
        <button className="secondary sm" onClick={() => { setFrom(today); setTo(today) }}>আজ</button>
        <button className="secondary sm" onClick={() => { setFrom(addDays(today, -6)); setTo(today) }}>৭ দিন</button>
        <button className="secondary sm" onClick={() => { setFrom(today.slice(0, 8) + '01'); setTo(today) }}>এ মাস</button>
      </div>
    </section>
    <ErrorNote error={dash.error || list.error || hubs.error} />

    <section className="da-stats">
      <Stat label="মোট রাইডার" value={num(d?.riders)} />
      <Stat label="মোট ডেলিভারি" value={num(d?.delivery)} />
      <Stat label="মোট পিকআপ" value={num(d?.pickup)} />
      <Stat label="মোট টাকা" value={taka(d?.amount)} />
      <Stat label="মোট বকেয়া" value={taka(d?.due)} tone={Number(d?.due) > 0 ? 'warn' : undefined} />
      <Stat label="মোবাইল ব্যাংকিং" value={taka(d?.mobile_banking)} sub="বকেয়ার সাথে আলাদা" />
      <Stat label="মোট খরচ" value={taka(d?.expense)} sub={`মার্চেন্ট পেমেন্ট ${taka(d?.merchant_cash)}`} />
      <Stat label="Submit হয়েছে" value={num(d?.submitted)} />
      <Stat label="যাচাইয়ের অপেক্ষায়" value={num(d?.pending_verification)} tone={Number(d?.pending_verification) > 0 ? 'warn' : undefined} />
      <Stat label="অনুমোদিত" value={num(d?.approved)} tone="ok" sub={Number(d?.correction) ? `সংশোধনে ${num(d?.correction)}` : undefined} />
    </section>

    <section className="panel">
      <div className="da-bar no-print">
        <input type="search" className="da-search" placeholder="খুঁজুন: নং, হাব, জোন, নাম…" value={q} onChange={e => setQ(e.target.value)} aria-label="খুঁজুন" />
        <div className="da-seg" role="group" aria-label="View">
          <button className={view === 'table' ? '' : 'secondary'} onClick={() => setView('table')}>টেবিল</button>
          <button className={view === 'cards' ? '' : 'secondary'} onClick={() => setView('cards')}>কার্ড</button>
        </div>
      </div>
      {list.loading ? <p className="muted">লোড হচ্ছে…</p> : rows.length === 0 ? <p className="muted">এই সময়ে কোনো হিসাব নেই।</p> :
        view === 'table' ? <div className="da-table-wrap"><table className="da-table">
          <thead><tr><th>নং</th><th>তারিখ</th><th>হাব</th><th className="r">রাইডার</th><th className="r">ডেলিভারি</th><th className="r">পিকআপ</th>
            <th className="r">টাকা</th><th className="r">বকেয়া</th><th className="r">মোবাইল ব্যাংকিং</th><th className="r">খরচ</th><th>অবস্থা</th><th>Submit করেছেন</th><th /></tr></thead>
          <tbody>{rows.map(r => <SessionTr key={r.id} r={r} />)}</tbody></table></div>
        : <div className="da-cards">{rows.map(r => <Link key={r.id} className="da-card" to={`/app/accounts/daily/${r.id}`}>
            <div className="row"><b>{r.hub_name}</b><StatusBadge status={r.status} /></div>
            <span className="muted">নং {num(r.no)} · {dateBn(r.account_date)} · {r.zone_name}</span>
            <div className="da-mini"><span>রাইডার <b>{num(r.riders)}</b></span><span>ডেলিভারি <b>{num(r.delivery)}</b></span><span>পিকআপ <b>{num(r.pickup)}</b></span></div>
            <div className="da-mini"><span>টাকা <b>{taka(r.amount)}</b></span><span>বকেয়া <b>{taka(r.due)}</b></span></div>
            <span className="muted small">{r.submitted_by_name ? `Submit: ${r.submitted_by_name} · ${timeBn(r.submitted_at)}` : `শুরু: ${r.started_by_name ?? '—'}`}</span>
          </Link>)}</div>}
    </section>

    {start && <Modal title="আজকের হিসাব শুরু করবেন?" onClose={() => setStart(null)}
      actions={<><button className="secondary" onClick={() => setStart(null)}>না (No)</button>
        {existingFor(start.hub, start.date)
          ? <button onClick={() => nav(`/app/accounts/daily/${existingFor(start.hub, start.date)!.id}`)}>খোলা হিসাবে যান</button>
          : <button disabled={busy} onClick={() => void doStart()}>{busy ? 'শুরু হচ্ছে…' : 'হ্যাঁ, শুরু করুন (Yes)'}</button>}</>}>
      <p className="muted">হিসাব শুরু করলে আজকের তারিখে নতুন সেশন তৈরি হবে, আর আপনার আইডি, নাম ও সময় সংরক্ষিত হবে।</p>
      <div className="da-grid2">
        <Field label="হাব"><select value={start.hub} onChange={e => setStart({ ...start, hub: e.target.value })}>
          {startable.map(h => <option key={h.hub_id} value={h.hub_id}>{h.name} · {h.zone_name}</option>)}</select></Field>
        <Field label="তারিখ"><input type="date" value={start.date} max={today} onChange={e => setStart({ ...start, date: e.target.value })} /></Field>
      </div>
      {existingFor(start.hub, start.date) && <p className="notice">এই হাব ও তারিখের হিসাব আগে থেকেই আছে — নতুন করে শুরু করা যাবে না।</p>}
      <ErrorNote error={err} />
    </Modal>}
  </AccountsShell>
}

function SessionTr({ r }: { r: SessionRow }) {
  const nav = useNavigate()
  return <tr className="click" onClick={() => nav(`/app/accounts/daily/${r.id}`)}>
    <td data-l="নং">{num(r.no)}</td><td data-l="তারিখ">{dateBn(r.account_date)}</td>
    <td data-l="হাব"><b>{r.hub_name}</b><span className="sec">{r.zone_name}</span></td>
    <td data-l="রাইডার" className="r">{num(r.riders)}</td><td data-l="ডেলিভারি" className="r">{num(r.delivery)}</td>
    <td data-l="পিকআপ" className="r">{num(r.pickup)}</td><td data-l="টাকা" className="r">{taka(r.amount)}</td>
    <td data-l="বকেয়া" className="r">{taka(r.due)}</td><td data-l="মোবাইল ব্যাংকিং" className="r">{taka(r.mobile_banking)}</td>
    <td data-l="খরচ" className="r">{taka(r.expense)}</td><td data-l="অবস্থা"><StatusBadge status={r.status} /></td>
    <td data-l="Submit করেছেন">{r.submitted_by_name ?? '—'}<span className="sec">{r.submitted_at ? timeBn(r.submitted_at) : ''}</span></td>
    <td><Link to={`/app/accounts/daily/${r.id}`} onClick={e => e.stopPropagation()}>খুলুন →</Link></td>
  </tr>
}
