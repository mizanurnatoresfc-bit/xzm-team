import { useAuth } from '../../auth/AuthProvider'
import { useWorkHub } from '../../lib/workHub'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { collectorsNeeded, da, num, taka, dateBn, timeBn, todayDhaka, addDays, STATUS_LABEL, type SheetStatus, type SessionRow, type FlowRow } from '../../lib/dailyAccounts'
import { Icon } from '../../components/Icon'
import { Combo } from '../../components/inputs'
import { matches } from '../../lib/validate'
import { AccountsShell, StatusBadge, Modal, Field, ErrorNote, useLoad, useToast } from './ui'
import { AppDownloadCard } from '../../components/AppDownloadCard'

type Range = 'today' | 'yesterday' | 'week' | 'month' | 'custom'
const wide = () => typeof matchMedia === 'function' && matchMedia('(min-width:900px)').matches

// Accounts Management → Daily Accounts (আজকের হিসাব খাতা): which hubs have given today's sheet, and the way into each one.
export function DailyDashboard() {
  const nav = useNavigate()
  const { session } = useAuth()
  const workHub = useWorkHub(session?.user.id ?? '')
  const today = todayDhaka()
  const [range, setRange] = useState<Range>('today')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [hub, setHub] = useState('')
  const [status, setStatus] = useState<SheetStatus | 'none' | ''>('')
  const [q, setQ] = useState('')
  const [view, setView] = useState<'list' | 'table'>(() => (wide() ? 'table' : 'list'))
  const [more, setMore] = useState(false)
  const [pick, setPick] = useState(false)
  const [start, setStart] = useState<{ hub: string; date: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const { toast, node } = useToast()

  const hubs = useLoad(() => da.myHubs(), [])
  const dash = useLoad(() => da.dashboard(from, to, hub || null), [from, to, hub])
  const list = useLoad(() => da.list(from, to, hub || null, null, null), [from, to, hub])
  const flow = useLoad(() => da.flowList(from, to, hub || null).catch(() => []), [from, to, hub])
  const settings = useLoad(() => da.settings().catch(() => null), [])
  const flowOf = useMemo(() => new Map((flow.data ?? []).map(f => [f.session_id, f])), [flow.data])
  const startable = (hubs.data ?? []).filter(h => h.can_submit)
  const all = useMemo(() => list.data ?? [], [list.data])
  const oneDay = from === to
  // Hubs with no sheet for the day on screen (only meaningful when one day is shown).
  const missing = useMemo(() => !oneDay ? [] : (hubs.data ?? []).filter(h => (!hub || h.hub_id === hub) && !all.some(r => r.hub_id === h.hub_id)), [oneDay, hubs.data, all, hub])
  const hit = (...t: Array<string | number | null>) => matches(t.join(' '), q)
  const rows = useMemo(() => all.filter(r => (!status || r.status === status) && hit(r.no, r.hub_name, r.zone_name, r.started_by_name, r.submitted_by_name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, status, q])
  const gaps = !status || status === 'none' ? missing.filter(h => hit(h.name, h.zone_name, h.code)) : []
  const d = dash.data
  const count = (s: SheetStatus) => all.filter(r => r.status === s).length
  const given = all.filter(r => r.status !== 'open').length
  const total = all.length + missing.length

  function show(r: Range) {
    setRange(r)
    if (r === 'today') { setFrom(today); setTo(today) }
    else if (r === 'yesterday') { setFrom(addDays(today, -1)); setTo(addDays(today, -1)) }
    else if (r === 'week') { setFrom(addDays(today, -6)); setTo(today) }
    else if (r === 'month') { setFrom(today.slice(0, 8) + '01'); setTo(today) }
    else setPick(true)
  }
  async function doStart() {
    if (!start) return
    setBusy(true); setErr(null)
    try {
      const id = await da.start(start.hub, start.date)
      toast('হিসাব শুরু হয়েছে ও সংরক্ষিত হয়েছে')
      nav(`/app/accounts/daily/${id}`)
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  const existingFor = (h: string, date: string) => all.find(r => r.hub_id === h && r.account_date === date)
  const begin = (h?: string) => { setErr(null); setStart({ hub: h ?? startable.find(item => item.hub_id === workHub)?.hub_id ?? startable[0].hub_id, date: oneDay ? from : today }) }
  const canStart = (h: string) => startable.some(x => x.hub_id === h)
  const RANGES: Array<[Range, string]> = [['today', 'আজ'], ['yesterday', 'গতকাল'], ['week', '৭ দিন'], ['month', 'এ মাস'], ['custom', range === 'custom' ? `${dateBn(from)} – ${dateBn(to)}` : 'তারিখ বাছুন']]
  const STATUSES: Array<[SheetStatus | 'none' | '', string, number, string]> = [['', 'সব', total, ''], ['open', STATUS_LABEL.open, count('open'), ''], ['submitted', 'যাচাই বাকি', count('submitted'), count('submitted') ? 'warn' : ''],
    ['correction', 'সংশোধন', count('correction'), count('correction') ? 'bad' : ''], ['approved', STATUS_LABEL.approved, count('approved'), ''], ...(oneDay ? [['none', 'শুরু হয়নি', missing.length, ''] as [SheetStatus | 'none' | '', string, number, string]] : [])]
  const loading = list.loading && !list.data

  return <AccountsShell title="আজকের হাবের হিসাব খাতা" subtitle={`জমা পড়া খাতা গ্রহণ করুন, তারপর ডেইলি হিসাবের খাতা খুলুন · আজ ${dateBn(today)}`}
    actions={startable.length > 0 && <button className="nv-wide-only" onClick={() => begin()}>＋ হিসাব শুরু করুন</button>}>
    {node}
    <div className="nv">
      <div className="nv-chips no-print" role="group" aria-label="কোন সময়ের হিসাব">{RANGES.map(([k, l]) => <button key={k} type="button" className={`nv-chip${range === k ? ' on' : ''}`} aria-pressed={range === k} onClick={() => show(k)}>{l}</button>)}
        <span className="nv-hub"><Combo value={hub} onChange={setHub} placeholder="সব হাব" label="হাব" options={(hubs.data ?? []).map(h => ({ value: h.hub_id, label: h.name, sub: h.zone_name }))} /></span></div>
      <ErrorNote error={dash.error || list.error || hubs.error} />

      <section className="nv-hero">
        <div className="nv-hero-main">
          <span className="lbl">{oneDay ? (from === today ? 'আজকের হিসাব' : dateBn(from)) : `${dateBn(from)} – ${dateBn(to)}`}</span>
          {oneDay ? <><b className="big">{num(given)} / {num(total)} হাব জমা দিয়েছে</b>
            <div className="nv-prog" role="progressbar" aria-label="কয়টি হাব জমা দিয়েছে" aria-valuemin={0} aria-valuemax={total} aria-valuenow={given}><i style={{ width: `${total ? (given / total) * 100 : 0}%` }} /></div></>
            : <b className="big">{num(all.length)}টি খাতা · {taka(d?.amount)}</b>}
          <span className="sub">{count('submitted') > 0 ? `${num(count('submitted'))}টি যাচাইয়ের অপেক্ষায়` : 'যাচাইয়ের অপেক্ষায় কিছু নেই'}{count('correction') > 0 ? ` · ${num(count('correction'))}টি সংশোধনে` : ''}{oneDay && missing.length > 0 ? ` · ${num(missing.length)}টি হাব শুরু করেনি` : ''}</span>
        </div>
        <div className="nv-nums">
          <div><b>{taka(d?.amount)}</b><span>মোট টাকা</span></div>
          <div className={Number(d?.due) > 0 ? 'warn' : ''}><b>{taka(d?.due)}</b><span>বকেয়া</span></div>
          <div><b>{num(d?.delivery)}</b><span>ডেলিভারি</span></div>
          <div><b>{num(d?.pickup)}</b><span>পিকআপ</span></div>
          {more && <><div><b>{num(d?.riders)}</b><span>রাইডার</span></div><div><b>{taka(d?.mobile_banking)}</b><span>মোবাইল ব্যাংকিং</span></div>
            <div><b>{taka(d?.expense)}</b><span>খরচ</span></div><div><b>{taka(d?.merchant_cash)}</b><span>মার্চেন্ট পেমেন্ট</span></div></>}
          <button type="button" className="nv-more" aria-expanded={more} onClick={() => setMore(m => !m)}>{more ? 'কম দেখান' : 'আরও হিসাব'}</button>
        </div>
      </section>

      <div className="nv-tools no-print">
        <label className="nv-search"><Icon name="search" size={18} /><input type="search" placeholder="খুঁজুন: নং, হাব, এরিয়া, নাম…" value={q} onChange={e => setQ(e.target.value)} aria-label="খুঁজুন" /></label>
        <div className="da-seg nv-wide-only" role="group" aria-label="চেহারা">
          <button type="button" className={view === 'list' ? '' : 'secondary'} aria-pressed={view === 'list'} onClick={() => setView('list')}>তালিকা</button>
          <button type="button" className={view === 'table' ? '' : 'secondary'} aria-pressed={view === 'table'} onClick={() => setView('table')}>টেবিল</button>
        </div>
      </div>
      <div className="nv-chips no-print" role="group" aria-label="অবস্থা">{STATUSES.map(([k, l, c, tone]) => <button key={k} type="button" className={`nv-chip ${tone}${status === k ? ' on' : ''}`} aria-pressed={status === k} onClick={() => setStatus(k)}>{l}{c > 0 && <b>{num(c)}</b>}</button>)}</div>

      {loading ? <p className="muted">লোড হচ্ছে…</p> : rows.length + gaps.length === 0 ? <div className="nv-empty"><Icon name="ledger" size={34} /><p>{q ? 'কিছু মেলেনি' : 'এই সময়ে কোনো হিসাব নেই।'}</p>
          {startable.length > 0 && !q && <button type="button" onClick={() => begin()}>＋ হিসাব শুরু করুন</button>}</div>
        : view === 'table' && rows.length > 0 ? <section className="panel"><div className="da-table-wrap"><table className="da-table">
          <thead><tr><th>নং</th><th>তারিখ</th><th>হাব</th><th className="r">রাইডার</th><th className="r">ডেলিভারি</th><th className="r">পিকআপ</th>
            <th className="r">টাকা</th><th className="r">বকেয়া</th><th className="r">মোবাইল ব্যাংকিং</th><th className="r">খরচ</th><th>অবস্থা</th><th>ধাপ</th><th>সাবমিট করেছেন</th><th /></tr></thead>
          <tbody>{rows.map(r => <SessionTr key={r.id} r={r} f={flowOf.get(r.id)} />)}</tbody></table></div>
          {gaps.length > 0 && <p className="muted small" style={{ margin: '10px 0 0' }}>শুরু হয়নি: {gaps.map(h => h.name).join(', ')}</p>}</section>
        : <div className="nv-rows">
          {rows.map(r => <Link key={r.id} className={`nv-row nv-s-${r.status}`} to={`/app/accounts/daily/${r.id}`}>
            <span className="nv-av">{r.hub_name.slice(0, 1)}</span>
            <span className="tx"><b>{r.hub_name}</b>
              <span>{oneDay ? '' : `${dateBn(r.account_date)} · `}{num(r.riders)} জন রাইডার · {num(r.delivery)} ডেলিভারি · {num(r.pickup)} পিকআপ</span>
              <span className="who">{r.submitted_by_name ? `জমা: ${r.submitted_by_name} · ${timeBn(r.submitted_at)}` : `শুরু: ${r.started_by_name ?? '—'}`}{Number(r.due) > 0 ? <em> · বকেয়া {taka(r.due)}</em> : null}</span>
              {flowOf.get(r.id) && <FlowLine f={flowOf.get(r.id)!} />}</span>
            <span className="end"><b>{taka(r.amount)}</b><StatusBadge status={r.status} /></span>
          </Link>)}
          {gaps.map(h => <div key={h.hub_id} className="nv-row none">
            <span className="nv-av">{h.name.slice(0, 1)}</span>
            <span className="tx"><b>{h.name}</b><span>{h.zone_name} · এখনো হিসাব শুরু হয়নি · {num(collectorsNeeded(settings.data, h.hub_id))} জনের হিসাব নেওয়ার কথা</span></span>
            <span className="end">{canStart(h.hub_id) ? <button type="button" className="sm" onClick={() => begin(h.hub_id)}>শুরু করুন</button> : <span className="da-badge">শুরু হয়নি</span>}</span>
          </div>)}
        </div>}
    </div>
    {startable.length > 0 && <button type="button" className="nv-fab no-print" onClick={() => begin()}><Icon name="plus" size={22} /> হিসাব শুরু</button>}

    {pick && <Modal title="তারিখ বাছুন" onClose={() => setPick(false)} actions={<button onClick={() => setPick(false)}>দেখান</button>}>
      <div className="da-grid2">
        <Field label="শুরুর তারিখ"><input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="শেষ তারিখ"><input type="date" value={to} min={from} max={today} onChange={e => setTo(e.target.value)} /></Field>
      </div>
    </Modal>}
    {start && <Modal title="হিসাব শুরু করবেন?" onClose={() => setStart(null)}
      actions={<><button className="secondary" onClick={() => setStart(null)}>না</button>
        {existingFor(start.hub, start.date)
          ? <button onClick={() => nav(`/app/accounts/daily/${existingFor(start.hub, start.date)!.id}`)}>খোলা হিসাবে যান</button>
          : <button disabled={busy} onClick={() => void doStart()}>{busy ? 'শুরু হচ্ছে…' : 'হ্যাঁ, শুরু করুন'}</button>}</>}>
      <p className="muted">হিসাব শুরু করলে এই তারিখে নতুন খাতা তৈরি হবে, আর আপনার আইডি, নাম ও সময় সংরক্ষিত হবে।</p>
      <div className="da-grid2">
        <Field label="হাব"><select value={start.hub} onChange={e => setStart({ ...start, hub: e.target.value })}>
          {startable.map(h => <option key={h.hub_id} value={h.hub_id}>{h.name} · {h.zone_name}</option>)}</select></Field>
        <Field label="তারিখ"><input type="date" value={start.date} max={today} onChange={e => setStart({ ...start, date: e.target.value })} /></Field>
      </div>
      {existingFor(start.hub, start.date) && <p className="notice">এই হাব ও তারিখের হিসাব আগে থেকেই আছে — নতুন করে শুরু করা যাবে না।</p>}
      <ErrorNote error={err} />
    </Modal>}
    <AppDownloadCard />
  </AccountsShell>
}

/** Where the sheet stands: parts submitted, checked, main-site report confirmed. */
function FlowLine({ f }: { f: FlowRow }) {
  return <span className="fl-line">
    <i className={f.submitted > f.accepted ? 'warn' : f.people > f.submitted ? '' : 'ok'}>জমা {num(f.submitted)}{f.people > f.submitted ? ` · ড্রাফট ${num(f.people - f.submitted)}` : ''}</i>
    <i className={f.accepted >= f.needed && f.accepted === f.people ? 'ok' : f.submitted > f.accepted ? 'warn' : ''}>Accept {num(f.accepted)}/{num(f.needed)}</i>
    <i className={f.checked_at ? 'ok' : ''}>{f.checked_at ? '✓ ডেইলি খাতা' : 'ডেইলি খাতা বাকি'}</i>
    {f.checked_at && <i className={f.report_ok_at ? (Number(f.report_diff) !== 0 ? 'warn' : 'ok') : ''}>{f.report_ok_at ? (Number(f.report_diff) !== 0 ? '✓ রিপোর্ট (পার্থক্যসহ)' : '✓ রিপোর্ট') : 'রিপোর্ট বাকি'}</i>}
    {f.checked_at && <i className={f.bank_done_at ? 'ok' : ''}>{f.bank_done_at ? '✓ ব্যাংকে জমা — ক্লোজ' : 'ব্যাংক বাকি'}</i>}</span>
}

function SessionTr({ r, f }: { r: SessionRow; f?: FlowRow }) {
  const nav = useNavigate()
  return <tr className="click" onClick={() => nav(`/app/accounts/daily/${r.id}`)}>
    <td data-l="নং">{num(r.no)}</td><td data-l="তারিখ">{dateBn(r.account_date)}</td>
    <td data-l="হাব"><b>{r.hub_name}</b><span className="sec">{r.zone_name}</span></td>
    <td data-l="রাইডার" className="r">{num(r.riders)}</td><td data-l="ডেলিভারি" className="r">{num(r.delivery)}</td>
    <td data-l="পিকআপ" className="r">{num(r.pickup)}</td><td data-l="টাকা" className="r">{taka(r.amount)}</td>
    <td data-l="বকেয়া" className="r">{taka(r.due)}</td><td data-l="মোবাইল ব্যাংকিং" className="r">{taka(r.mobile_banking)}</td>
    <td data-l="খরচ" className="r">{taka(r.expense)}</td><td data-l="অবস্থা"><StatusBadge status={r.status} /></td><td data-l="ধাপ">{f ? <FlowLine f={f} /> : '—'}</td>
    <td data-l="Submit করেছেন">{r.submitted_by_name ?? '—'}<span className="sec">{r.submitted_at ? timeBn(r.submitted_at) : ''}</span></td>
    <td><Link to={`/app/accounts/daily/${r.id}`} onClick={e => e.stopPropagation()}>খুলুন →</Link></td>
  </tr>
}
