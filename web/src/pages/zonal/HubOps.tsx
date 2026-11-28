import { askConfirm, askText } from '../../components/ask'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { usePrefs } from '../../lib/prefs'
import { dmy } from '../../lib/hr'
import {
  ATT, JOB, PERIOD, STATUS, dhakaToday, hubOps, hubOpsFriendly, numOr, shiftDay,
  type BossPeriod, type Group, type HubSummary, type LogRow, type PeriodType, type Settings, type Summary,
} from '../../lib/hubOps'
import { zonal, type ZmDashboard } from '../../lib/zonal'
import { Badge, Field, Modal, Stat, useLoad, useToast } from '../accounts/ui'
import { useOrg } from '../hr/common'
import { HistoryModal, SummaryView } from './HubOpsParts'

import { OperationsCollection } from './OperationsCollection'

// XZM-014 Phase 1: 'center' হলো নতুন কেন্দ্রীয় অপারেশন ড্যাশবোর্ড (default landing)।
type Tab = 'center' | 'collection' | 'hubs' | 'summary' | 'boss' | 'log' | 'settings'
const monthStart = (iso: string) => iso.slice(0, 8) + '01'
/** Bangladesh week: Saturday to Friday. */
const weekStart = (iso: string) => { const d = new Date(iso + 'T00:00:00Z'); const back = (d.getUTCDay() - 6 + 7) % 7; return shiftDay(iso, -back) }

/**
 * হাব অপারেশন ড্যাশবোর্ড — the zonal manager's centre for hub operations and workforce reporting:
 * every hub of the zone for a day (tap a hub to enter its report), the zonal summary for any period,
 * reports to the boss (daily / weekly / monthly: pending → submitted → reviewed), the status log and the zone's settings.
 */
export function HubOps() {
  const { L } = usePrefs()
  const o = useOrg()
  const [sp, setSp] = useSearchParams()
  // XZM-014: default tab 'center' — the new central Operations Dashboard.
  const tab = (sp.get('tab') as Tab) || 'center'
  const zones = o.data?.zones ?? []
  const [zone, setZone] = useState(sp.get('zone') ?? '')
  useEffect(() => { if (!zone && zones.length) setZone(zones[0].id) }, [zones, zone])
  const setTab = (t: Tab) => { const x = new URLSearchParams(sp); x.set('tab', t); setSp(x, { replace: true }) }

  return <AppShell title={L('অপারেশন সেন্টার', 'Operations Center')}
    subtitle={L('জোনের কেন্দ্রীয় অপারেশন ড্যাশবোর্ড — হাব, কর্মী, পার্সেল, দায়িত্ব ও অনুমোদন এক পাতায়; সেখান থেকে বসের কাছে দৈনিক, সাপ্তাহিক ও মাসিক রিপোর্ট।',
      'Central operations dashboard for the zone — hubs, staff, parcels, duties and approvals in one place; daily, weekly and monthly reports to the boss from here.')}>
    {zones.length > 1 && <section className="da-filters panel no-print">
      <Field label={L('জোন', 'Zone')}><select value={zone} onChange={e => setZone(e.target.value)}>{zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>
    </section>}
    <nav className="emp-tabs no-print" role="tablist">
      {([['center', 'আজকের অপারেশন', "Today's operations", 'dash'], ['hubs', 'হাবগুলো', 'Hubs', 'hub'], ['summary', 'জোনাল সারাংশ', 'Zonal summary', 'chart'], ['boss', 'বসের রিপোর্ট', 'Boss reports', 'doc'],
        ['collection', 'তথ্য সংগ্রহ কেন্দ্র', 'Operations Data Collection', 'doc'], ['log', 'স্ট্যাটাস লগ', 'Status log', 'log'], ['settings', 'সেটিং', 'Settings', 'gear']] as const).map(([k, b, e, ic]) =>
        <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><Icon name={ic} size={16} />{L(b, e)}</button>)}
    </nav>
    {o.loading && !zone && <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>}
    {!o.loading && !zones.length && <p className="da-error">{L('আপনার কোনো জোন দেখার অনুমতি নেই।', 'You cannot see any zone.')}</p>}
    {zone && tab === 'center' && <OperationCenterDashboard zone={zone} />}
    {zone && tab === 'hubs' && <HubsDay zone={zone} />}
    {zone && tab === 'collection' && <OperationsCollection key={zone} zone={zone} />}
    {zone && tab === 'summary' && <PeriodSummary zone={zone} />}
    {zone && tab === 'boss' && <BossReports zone={zone} />}
    {zone && tab === 'log' && <StatusLog zone={zone} />}
    {zone && tab === 'settings' && <ZoneSettings zone={zone} />}
  </AppShell>
}

/**
 * XZM-014 Phase 1 — অপারেশন সেন্টার ড্যাশবোর্ড।
 * ১২টি KPI টাইল — সবই বিদ্যমান RPC (`hub_ops_summary`, `zm_dashboard`) থেকে আসছে, নতুন টেবিল/RPC নেই।
 * প্রতি টাইলে ক্লিক করলে বিদ্যমান পাতা/ট্যাবে বিস্তারিত দেখা যাবে। জোন ও তারিখ ফিল্টার — Asia/Dhaka টাইমজোন।
 * শূন্য বা ভুয়া তথ্য দেখানো হবে না — RPC ব্যর্থ হলে বা অনুমতি না থাকলে বার্তা দেখাবে।
 */
function OperationCenterDashboard({ zone }: { zone: string }) {
  const { L, n } = usePrefs()
  const { can } = useAuth()
  const [sp, setSp] = useSearchParams()
  const date = sp.get('date') || dhakaToday()
  const setDate = (d: string) => { const x = new URLSearchParams(sp); x.set('date', d); setSp(x, { replace: true }) }
  // দৈনিক KPI — আজকের একদিনের hub_ops_summary (রিপোর্ট জমা, কর্মী, পার্সেল, পিকআপ, হাজিরা)
  const sum = useLoad(() => hubOps.summary(zone, date, date), [zone, date])
  // সময়কাল KPI — zm_dashboard (দায়িত্ব / অনুমোদন / ক্লেইম)
  const dash = useLoad<ZmDashboard | null>(() => can('zonal.dashboard.view')
    ? zonal.dashboard(zone, date, date).catch(() => null) : Promise.resolve(null), [zone, date])
  const s = sum.data
  const d = dash.data
  const today = s?.today ?? dhakaToday()
  const missing = s ? Math.max(0, (s.zone.hubs_expected ?? 0) - (s.zone.hubs_reported ?? 0)) : 0
  const err = sum.error ? hubOpsFriendly(sum.error) : null
  const anyLoading = sum.loading || dash.loading

  // ক্লিকযোগ্য টাইল: Link দিয়ে বিদ্যমান পাতায় drill-down (অতিরিক্ত state নয়)
  const tile = (to: string, icon: string, label: string, value: string, tone?: 'ok' | 'warn' | 'bad', sub?: string, title?: string) =>
    <Link to={to} className="zd-stat" style={{ display: 'block' }} title={title ?? L('বিস্তারিত দেখুন', 'View details')}>
      <Stat icon={icon} label={label} value={value} tone={tone} sub={sub} />
    </Link>

  return <>
    <section className="da-filters panel no-print">
      <button type="button" className="secondary" onClick={() => setDate(shiftDay(date, -1))} aria-label={L('আগের দিন', 'Previous day')}>‹</button>
      <Field label={L('তারিখ', 'Date')}>
        <input type="date" value={date} max={today} onChange={e => e.target.value && setDate(e.target.value)} />
      </Field>
      <button type="button" className="secondary" disabled={date >= today} onClick={() => setDate(shiftDay(date, 1))} aria-label={L('পরের দিন', 'Next day')}>›</button>
      {date !== today && <button type="button" className="secondary sm" onClick={() => setDate(today)}>{L('আজ', 'Today')}</button>}
      <span className="muted small">{dmy(date)} · {L('বাংলাদেশ সময়', 'Asia/Dhaka')}</span>
      {anyLoading && <span className="muted small">{L('লোড হচ্ছে…', 'Loading…')}</span>}
    </section>
    {err && <p className="da-error">{err}</p>}
    {!s && !sum.loading && !err && <p className="muted">{L('তথ্য পাওয়া যায়নি।', 'No data available.')}</p>}

    {s && <>
      {/* সারি ১ — হাব ও রিপোর্ট জমার অবস্থা */}
      <h3 className="zd-h">{L('হাব ও রিপোর্ট', 'Hubs & reports')} <span className="muted small">{L('— টাইলে চাপলে বিস্তারিত', '— tap a tile to drill down')}</span></h3>
      <div className="da-stats">
        {tile(`/app/zonal/hub-ops?tab=hubs&date=${date}`, 'hub', L('মোট হাব', 'Total hubs'), n(s.zone.hubs_expected ?? 0))}
        {tile(`/app/zonal/hub-ops?tab=hubs&date=${date}`, 'check', L('রিপোর্ট জমা দিয়েছে', 'Hubs reported'), n(s.zone.hubs_reported ?? 0), 'ok',
          s.zone.pending ? L(`${n(s.zone.pending)}টি খসড়া`, `${s.zone.pending} drafts`) : undefined)}
        {tile(`/app/zonal/hub-ops?tab=hubs&date=${date}`, 'alert', L('রিপোর্ট জমা দেয়নি', 'Hubs missing'), n(missing), missing ? 'bad' : 'ok',
          missing ? L('চাপ দিয়ে দেখুন কোন হাব', 'Tap to see which hubs') : undefined)}
        {tile(`/app/zonal/hub-ops?tab=boss`, 'doc', L('অনুমোদনের অপেক্ষায়', 'Awaiting approval'), n((d?.claims_pending ?? 0) + (d?.tasks?.awaiting_confirmation ?? 0)),
          ((d?.claims_pending ?? 0) + (d?.tasks?.awaiting_confirmation ?? 0)) ? 'warn' : undefined,
          d ? L('রিপোর্ট / ক্লেইম / কাজ', 'Reports / claims / tasks') : undefined)}
      </div>

      {/* সারি ২ — কর্মী ও হাজিরা */}
      <h3 className="zd-h">{L('কর্মী ও হাজিরা', 'Staff & attendance')}</h3>
      <div className="da-stats">
        {tile(`/app/staff/list`, 'users', L('মোট কর্মী', 'Total staff'), n(s.zone.staff_latest ?? 0))}
        {tile(`/app/attendance?view=zone`, 'check', L('উপস্থিত', 'Present'), n(s.zone.att?.present ?? 0), 'ok',
          L(`কর্মী ${n(s.zone.staff_latest ?? 0)} এর মধ্যে`, `of ${n(s.zone.staff_latest ?? 0)}`))}
        {tile(`/app/attendance?view=zone`, 'userx', L('অনুপস্থিত', 'Absent'), n(s.zone.att?.absent ?? 0), (s.zone.att?.absent ?? 0) ? 'bad' : undefined,
          L(`ছুটি ${n((s.zone.att?.leave_applied ?? 0) + (s.zone.att?.leave_not_applied ?? 0))}`,
            `Leave ${(s.zone.att?.leave_applied ?? 0) + (s.zone.att?.leave_not_applied ?? 0)}`))}
      </div>

      {/* সারি ৩ — পার্সেল কার্যক্রম */}
      <h3 className="zd-h">{L('পার্সেল কার্যক্রম', 'Parcel operations')}</h3>
      <div className="da-stats">
        {tile(`/app/hub/pickup`, 'truck', L('মোট পিকআপ', 'Total pickups'), numOr(s.zone.total_pickups, n))}
        {tile(`/app/hub/ops`, 'box', L('মোট পার্সেল', 'Total parcels'), numOr(s.zone.total_parcels, n))}
      </div>

      {/* সারি ৪ — দায়িত্ব ও অনুমোদন */}
      <h3 className="zd-h">{L('দায়িত্ব ও কাজ', 'Duties & tasks')}</h3>
      <div className="da-stats">
        {d
          ? <>
            {tile(`/app/hub/tasks`, 'tasks', L('চলমান দায়িত্ব', 'Open duties'), n(d.tasks?.open ?? 0))}
            {tile(`/app/hub/tasks`, 'form', L('অসম্পূর্ণ কাজ', 'Pending submissions'), n(d.tasks?.pending_submissions ?? 0),
              (d.tasks?.pending_submissions ?? 0) ? 'warn' : undefined)}
            {tile(`/app/hub/tasks`, 'clock', L('সময় পার হওয়া দায়িত্ব', 'Overdue duties'), n(d.tasks?.overdue ?? 0),
              (d.tasks?.overdue ?? 0) ? 'bad' : undefined)}
          </>
          : can('zonal.dashboard.view')
            ? <p className="muted small">{L('দায়িত্বের তথ্য লোড হয়নি।', 'Duty data not loaded.')}</p>
            : <p className="muted small">{L('এই অংশ দেখার অনুমতি নেই (zonal.dashboard.view দরকার)।', 'You do not have zonal.dashboard.view.')}</p>}
      </div>

      {/* দ্রুত লিঙ্ক — ১১ মেনুর বাকিগুলোয় সরাসরি যাওয়ার সুবিধা */}
      <section className="panel" style={{ marginTop: 14 }}>
        <div className="da-bar"><h2 style={{ margin: 0 }}><Icon name="map" size={18} /> {L('দ্রুত লিঙ্ক', 'Quick links')}</h2></div>
        <div className="row-acts" style={{ flexWrap: 'wrap', gap: 8 }}>
          <Link to="/app/routes" className="btn-ghost"><Icon name="map" size={14} />{L('রুট ও জনবল পরিকল্পনা', 'Routes & manpower plan')}</Link>
          <Link to="/app/hr/duties" className="btn-ghost"><Icon name="tasks" size={14} />{L('কর্মী ও দায়িত্ব', 'Staff & duties')}</Link>
          <Link to="/app/zonal/requests" className="btn-ghost"><Icon name="check" size={14} />{L('অনুমোদন কেন্দ্র', 'Approval centre')}</Link>
          <Link to={`/app/zonal/hub-ops?tab=collection&date=${date}`} className="btn-ghost"><Icon name="doc" size={14} />{L('তথ্য সংগ্রহ কেন্দ্র', 'Data collection')}</Link>
          <Link to="/app/zonal/hub-ops?tab=boss" className="btn-ghost"><Icon name="chart" size={14} />{L('অপারেশন রিপোর্ট', 'Operations report')}</Link>
          <Link to="/app/zonal/hub-ops?tab=settings" className="btn-ghost"><Icon name="gear" size={14} />{L('অপারেশন সেটিংস', 'Operations settings')}</Link>
        </div>
      </section>
    </>}
  </>
}

/** Every hub of the zone for one day: status, totals and staff at a glance; tap a hub to open its input panel. */
function HubsDay({ zone }: { zone: string }) {
  const { L, n } = usePrefs()
  const [sp, setSp] = useSearchParams()
  const date = sp.get('date') || dhakaToday()
  const setDate = (d: string) => { const x = new URLSearchParams(sp); x.set('date', d); setSp(x, { replace: true }) }
  const q = useLoad(() => hubOps.summary(zone, date, date), [zone, date])
  const { toast, node } = useToast()
  const [busy, setBusy] = useState(false)
  const s = q.data
  const waiting = (s?.hubs ?? []).filter(h => h.status === 'submitted' && h.report_id)
  async function reviewAll() {
    if (!await askConfirm(L(`জমা হওয়া ${n(waiting.length)}টি রিপোর্ট "দেখা হয়েছে" করবেন?`, `Mark ${waiting.length} submitted reports reviewed?`), { ok: L('দেখা হয়েছে', 'Mark reviewed') })) return
    setBusy(true)
    try { const k = await hubOps.review(waiting.map(h => h.report_id!), null); toast(L(`${n(k)}টি রিপোর্ট দেখা হয়েছে`, `${k} reviewed`)); await q.reload() }
    catch (e) { toast(hubOpsFriendly(e)) } finally { setBusy(false) }
  }
  const order = (h: HubSummary) => h.skip ? 3 : !h.status ? 0 : h.status === 'pending' ? 1 : 2
  const hubs = [...(s?.hubs ?? [])].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name))
  const today = s?.today ?? dhakaToday()
  return <>{node}
    <div className="hop-date no-print">
      <button type="button" className="secondary" onClick={() => setDate(shiftDay(date, -1))} aria-label={L('আগের দিন', 'Previous day')}>‹</button>
      <input type="date" aria-label={L('তারিখ', 'Date')} value={date} max={today} onChange={e => e.target.value && setDate(e.target.value)} />
      <button type="button" className="secondary" disabled={date >= today} onClick={() => setDate(shiftDay(date, 1))} aria-label={L('পরের দিন', 'Next day')}>›</button>
      {date !== today && <button type="button" className="secondary sm" onClick={() => setDate(today)}>{L('আজ', 'Today')}</button>}
      {q.loading && <span className="muted small">{L('লোড হচ্ছে…', 'Loading…')}</span>}
    </div>
    {q.error ? <p className="da-error">{hubOpsFriendly(q.error)}</p> : null}
    {s && <>
      <div className="da-stats">
        <Stat icon="hub" label={L('রিপোর্ট দিয়েছে', 'Hubs reported')} value={`${n(s.zone.hubs_reported)}/${n(s.zone.hubs_expected)}`} tone={s.zone.missing ? 'warn' : 'ok'}
          sub={s.zone.pending ? L(`${n(s.zone.pending)}টি খসড়া`, `${s.zone.pending} drafts`) : undefined} />
        <Stat icon="box" label={L('মোট পার্সেল', 'Total parcels')} value={numOr(s.zone.total_parcels, n)} />
        <Stat icon="truck" label={L('মোট পিকআপ', 'Total pickups')} value={numOr(s.zone.total_pickups, n)} />
        <Stat icon="check" tone="ok" label={L('উপস্থিত', 'Present')} value={n(s.zone.att.present)} sub={L(`কর্মী ${n(s.zone.staff_latest)}`, `of ${s.zone.staff_latest}`)} />
        <Stat icon="userx" tone={s.zone.att.absent ? 'bad' : undefined} label={L('অনুপস্থিত', 'Absent')} value={n(s.zone.att.absent)} />
        <Stat icon="log" label={L('ছুটি (আবেদন / আবেদন নেই)', 'Leave (applied / not)')} value={`${n(s.zone.att.leave_applied)} / ${n(s.zone.att.leave_not_applied)}`}
          tone={s.zone.att.leave_not_applied ? 'warn' : undefined} />
      </div>
      {s.can?.approve && waiting.length > 0 && <p><button type="button" disabled={busy} onClick={() => void reviewAll()}><Icon name="checkall" size={16} />
        {L(`জমা হওয়া ${n(waiting.length)}টি রিপোর্ট দেখা হয়েছে`, `Mark ${waiting.length} submitted reviewed`)}</button></p>}
      <div className="hop-cards">{hubs.map(h => <Link key={h.hub_id} to={`/app/zonal/hub-ops/hub/${h.hub_id}?date=${date}`} className={`hop-card${!h.status && !h.skip ? ' missing' : ''}`}>
        <header><b>{h.name}</b>{h.status ? <Badge tone={STATUS[h.status][2]}>{L(STATUS[h.status][0], STATUS[h.status][1])}</Badge>
          : h.skip ? <Badge tone="neutral">{L('লাগবে না', 'Not expected')}</Badge> : <Badge tone="bad">{L('রিপোর্ট নেই', 'No report')}</Badge>}</header>
        <div className="hop-card-nums">
          <span><small>{L('পার্সেল', 'Parcels')}</small><b>{h.status && h.status !== 'pending' ? numOr(h.total_parcels, n) : '—'}</b></span>
          <span><small>{L('পিকআপ', 'Pickups')}</small><b>{h.status && h.status !== 'pending' ? numOr(h.total_pickups, n) : '—'}</b></span>
          <span><small>{L('কর্মী', 'Staff')}</small><b>{h.status && h.status !== 'pending' ? n(h.staff_latest) : '—'}</b></span>
        </div>
        {h.status && h.status !== 'pending' ? <div className="hop-card-att">
          <span className="c-ok">{L('উপস্থিত', 'Present')} {n(h.att.present)}</span>
          <span className="c-bad">{L('অনুপস্থিত', 'Absent')} {n(h.att.absent)}</span>
          <span className="c-info">{L('ছুটি', 'Leave')} {n(h.att.leave_applied + h.att.leave_not_applied)}</span>
          {h.att.not_marked > 0 && <span className="c-warn">{L('বাকি', 'Unmarked')} {n(h.att.not_marked)}</span>}
          {h.resigned > 0 && <span className="c-bad">{L('ছেড়েছেন', 'Left')} {n(h.resigned)}</span>}
          {h.new > 0 && <span className="c-info">{L('নতুন', 'New')} {n(h.new)}</span>}
        </div> : <div className="muted small">{h.status === 'pending' ? L('খসড়া সেভ আছে — জমা দেওয়া হয়নি', 'Draft saved — not submitted') : L(`এইচআর তালিকায় ${n(h.roster)} জন · ট্যাপ করে লিখুন`, `${h.roster} in HR · tap to enter`)}</div>}
        {(h.version ?? 1) > 1 && <small className="muted">{L(`সংশোধিত (সংস্করণ ${n(h.version!)})`, `Corrected (v${h.version})`)}</small>}
      </Link>)}</div>
    </>}
  </>
}

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'last_month' | 'custom'
function PeriodSummary({ zone }: { zone: string }) {
  const { L } = usePrefs()
  const t = dhakaToday()
  const [preset, setPreset] = useState<Preset>('today')
  const [custom, setCustom] = useState({ from: monthStart(t), to: t })
  const range = useMemo(() => {
    if (preset === 'today') return { from: t, to: t }
    if (preset === 'yesterday') return { from: shiftDay(t, -1), to: shiftDay(t, -1) }
    if (preset === 'week') return { from: weekStart(t), to: t }
    if (preset === 'month') return { from: monthStart(t), to: t }
    if (preset === 'last_month') { const e = shiftDay(monthStart(t), -1); return { from: monthStart(e), to: e } }
    return custom
  }, [preset, custom, t])
  const q = useLoad(() => hubOps.summary(zone, range.from, range.to), [zone, range.from, range.to])
  return <>
    <section className="da-filters panel no-print">
      <div className="da-seg">{([['today', 'আজ', 'Today'], ['yesterday', 'গতকাল', 'Yesterday'], ['week', 'এই সপ্তাহ', 'This week'], ['month', 'এই মাস', 'This month'],
        ['last_month', 'গত মাস', 'Last month'], ['custom', 'নিজে বাছুন', 'Custom']] as const).map(([k, b, e]) =>
        <button key={k} type="button" className={preset === k ? '' : 'secondary'} onClick={() => setPreset(k)}>{L(b, e)}</button>)}</div>
      {preset === 'custom' && <>
        <Field label={L('থেকে', 'From')}><input type="date" value={custom.from} max={custom.to} onChange={e => setCustom({ ...custom, from: e.target.value })} /></Field>
        <Field label={L('পর্যন্ত', 'To')}><input type="date" value={custom.to} min={custom.from} max={t} onChange={e => setCustom({ ...custom, to: e.target.value })} /></Field></>}
      <span className="muted small">{dmy(range.from)}{range.to !== range.from ? ` — ${dmy(range.to)}` : ''}</span>
      <button type="button" className="secondary no-print" onClick={() => window.print()}><Icon name="print" size={16} />{L('প্রিন্ট', 'Print')}</button>
      {q.loading && <span className="muted small">{L('লোড হচ্ছে…', 'Loading…')}</span>}
    </section>
    {q.error ? <p className="da-error">{hubOpsFriendly(q.error)}</p> : null}
    {q.data && <SummaryView s={q.data} linkDate />}
  </>
}

/** Reports to the boss: the last periods with their status; open one to send it, send it again, or review it. */
function BossReports({ zone }: { zone: string }) {
  const { L, n } = usePrefs()
  const [sp, setSp] = useSearchParams()
  const type = (sp.get('type') as PeriodType) || 'daily'
  const openDate = sp.get('date')
  const set = (k: string, v: string | null) => { const x = new URLSearchParams(sp); if (v) x.set(k, v); else x.delete(k); setSp(x, { replace: true }) }
  const q = useLoad(() => hubOps.bossList(zone, type, type === 'daily' ? 14 : type === 'weekly' ? 8 : 6), [zone, type])
  const label = (p: { period_from: string; period_to: string }) => p.period_from === p.period_to ? dmy(p.period_from) : `${dmy(p.period_from)} — ${dmy(p.period_to)}`
  return <>
    <div className="da-seg hop-seg no-print">{(['daily', 'weekly', 'monthly'] as PeriodType[]).map(k =>
      <button key={k} type="button" className={type === k ? '' : 'secondary'} onClick={() => { const x = new URLSearchParams(sp); x.set('type', k); x.delete('date'); setSp(x, { replace: true }) }}>{L(PERIOD[k][0], PERIOD[k][1])}</button>)}</div>
    {q.error ? <p className="da-error">{hubOpsFriendly(q.error)}</p> : null}
    {!openDate && <div className="hop-boss-list">{(q.data ?? []).map((p: BossPeriod) => <button type="button" key={p.period_from} className="hop-boss" onClick={() => set('date', p.period_from)}>
      <span className="hop-boss-when"><b>{label(p)}</b>{p.running && <small className="muted">{L('চলছে', 'In progress')}</small>}</span>
      <Badge tone={STATUS[p.status][2]}>{L(STATUS[p.status][0], STATUS[p.status][1])}</Badge>
      <span className="muted small">{L(`রিপোর্ট ${n(p.received)}/${n(p.expected)}`, `Reports ${p.received}/${p.expected}`)}{p.missing ? L(` · ${n(p.missing)}টি নেই`, ` · ${p.missing} missing`) : ''}</span>
      {p.report?.changed_after && <Badge tone="warn">{L('পাঠানোর পরে বদলেছে', 'Changed after sending')}</Badge>}
      <Icon name="chev" size={16} />
    </button>)}</div>}
    {openDate && <BossReport zone={zone} type={type} date={openDate} onBack={() => set('date', null)} onChanged={() => void q.reload()} />}
  </>
}

function BossReport({ zone, type, date, onBack, onChanged }: { zone: string; type: PeriodType; date: string; onBack: () => void; onChanged: () => void }) {
  const { L, n, lang } = usePrefs()
  const q = useLoad(() => hubOps.bossGet(zone, type, date), [zone, type, date])
  const { toast, node } = useToast()
  const [ask, setAsk] = useState<null | 'send' | 'review'>(null); const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [history, setHistory] = useState(false)
  const [showLive, setShowLive] = useState(false)
  const v = q.data
  const r = v?.report
  const shown: Summary | null = v ? (r && v.sent && !showLive ? v.sent : v.live) : null
  const at = (t: string) => new Date(t).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  async function go() {
    if (!v) return
    setBusy(true); setErr('')
    try {
      if (ask === 'send') { await hubOps.bossSubmit(zone, type, v.period_from, note.trim() || null); toast(L('বসের কাছে পাঠানো হয়েছে', 'Sent to the boss')) }
      else if (r) { await hubOps.bossReview(r.id, note.trim() || null); toast(L('দেখা হয়েছে (রিভিউ) দেওয়া হলো', 'Marked reviewed')) }
      setAsk(null); setNote(''); await q.reload(); onChanged()
    } catch (e) { setErr(hubOpsFriendly(e)) } finally { setBusy(false) }
  }
  const title = v ? `${L(PERIOD[type][0], PERIOD[type][1])} ${L('হাব অপারেশন রিপোর্ট', 'hub operation report')} — ${v.live.zone_name} — ${v.period_from === v.period_to ? dmy(v.period_from) : `${dmy(v.period_from)} — ${dmy(v.period_to)}`}` : ''
  return <>{node}
    <div className="da-bar no-print"><button type="button" className="secondary" onClick={onBack}><Icon name="back" size={16} />{L('তালিকা', 'List')}</button>
      {v && <span style={{ flex: 1 }} />}
      {r && <button type="button" className="secondary sm" onClick={() => setHistory(true)}><Icon name="clock" size={14} />{L('ইতিহাস', 'History')}</button>}
      <button type="button" className="secondary sm" onClick={() => window.print()}><Icon name="print" size={14} />{L('প্রিন্ট / পিডিএফ', 'Print / PDF')}</button></div>
    {q.error ? <p className="da-error">{hubOpsFriendly(q.error)}</p> : null}
    {v && <>
      <section className="panel hop-boss-head">
        <h2 style={{ margin: 0 }}>{title}</h2>
        <div className="hop-meta">
          <Badge tone={STATUS[v.status][2]}>{L(STATUS[v.status][0], STATUS[v.status][1])}</Badge>
          {r && <span>{L('পাঠিয়েছেন', 'Sent by')}: {r.submitted_by_name} · {at(r.submitted_at)}{r.version > 1 ? L(` · সংস্করণ ${n(r.version)}`, ` · v${r.version}`) : ''}</span>}
          {r?.note && <span>{L('বার্তা', 'Note')}: {r.note}</span>}
          {r?.reviewed_at && <span>{L('দেখেছেন', 'Reviewed by')}: {r.reviewed_by_name} · {at(r.reviewed_at)}{r.review_note ? ` — ${r.review_note}` : ''}</span>}
        </div>
        {r?.changed_after && <p className="hop-note"><span>{L('পাঠানোর পরে কোনো হাবের রিপোর্ট জমা বা সংশোধন হয়েছে। বসের কাছে যা গেছে আর এখনকার হিসাব আলাদা হতে পারে।',
          'A hub report was submitted or corrected after this was sent. What the boss has may differ from now.')}</span>
          <button type="button" className="secondary sm" onClick={() => setShowLive(x => !x)}>{showLive ? L('যা পাঠানো হয়েছিল দেখুন', 'Show what was sent') : L('এখনকার হিসাব দেখুন', 'Show current figures')}</button></p>}
        {!r && <p className="muted small">{L('এখনো পাঠানো হয়নি — নিচে এখনকার হিসাব। পাঠালে এই মুহূর্তের হিসাব বসের কাছে জমা থাকবে।', 'Not sent yet — below are the current figures. Sending freezes them for the boss.')}</p>}
        <div className="row-acts no-print">
          {v.can.create && !r && <button type="button" onClick={() => { setNote(''); setErr(''); setAsk('send') }}><Icon name="check" size={16} />{L('বসের কাছে পাঠান', 'Send to the boss')}</button>}
          {v.can.edit && r && (r.changed_after || r.status === 'submitted') && <button type="button" className="secondary" onClick={() => { setNote(''); setErr(''); setAsk('send') }}><Icon name="edit" size={16} />{L('আবার পাঠান (সংশোধিত)', 'Send again (corrected)')}</button>}
          {v.can.approve && r?.status === 'submitted' && <button type="button" onClick={() => { setNote(''); setErr(''); setAsk('review') }}><Icon name="checkall" size={16} />{L('দেখা হয়েছে (রিভিউ)', 'Mark reviewed')}</button>}
        </div>
      </section>
      {shown && <SummaryView s={shown} />}
    </>}
    {ask && <Modal title={ask === 'send' ? (r ? L('আবার পাঠান', 'Send again') : L('বসের কাছে পাঠান', 'Send to the boss')) : L('রিপোর্ট দেখা হয়েছে', 'Mark reviewed')} onClose={() => setAsk(null)}
      actions={<><button className="secondary" onClick={() => setAsk(null)}>{L('বাতিল', 'Cancel')}</button>
        <button disabled={busy || (ask === 'send' && !!r && !note.trim())} onClick={() => void go()}>{busy ? L('হচ্ছে…', 'Working…') : L('ঠিক আছে', 'Confirm')}</button></>}>
      {ask === 'send' && v && v.live.zone.missing > 0 && <p className="hop-note"><span>{L(`${n(v.live.zone.missing)}টি হাব-রিপোর্ট এখনো আসেনি — রিপোর্টে "নেই" হিসেবেই যাবে, কিছু ধরে নেওয়া হবে না।`,
        `${v.live.zone.missing} hub reports are missing — they go as missing; nothing is assumed.`)}</span></p>}
      <Field label={ask === 'send' ? (r ? L('কী বদলেছে', 'What changed') : L('বসের জন্য বার্তা (ইচ্ছা হলে)', 'Note for the boss (optional)')) : L('মন্তব্য (ইচ্ছা হলে)', 'Note (optional)')} wide required={ask === 'send' && !!r}>
        <textarea rows={3} autoFocus value={note} onChange={e => setNote(e.target.value)} /></Field>
      {ask === 'review' && <p className="muted small">{L('এই সময়ের জমা হওয়া হাব রিপোর্টগুলোও "দেখা হয়েছে" হবে।', 'The submitted hub reports of this period are marked reviewed too.')}</p>}
      {err && <p className="da-error">{err}</p>}
    </Modal>}
    {history && r && <HistoryModal kind="boss" id={r.id} title={title} onClose={() => setHistory(false)} />}
  </>
}

/** Every status change of every person: date, hub, from → to, reason, remarks, who and when. */
function StatusLog({ zone }: { zone: string }) {
  const { L, lang } = usePrefs()
  const o = useOrg()
  const t = dhakaToday()
  const [from, setFrom] = useState(monthStart(t)); const [to, setTo] = useState(t); const [hub, setHub] = useState('')
  const q = useLoad(() => hubOps.log(zone, from, to, hub || null, null), [zone, from, to, hub])
  const hubs = (o.data?.hubs ?? []).filter(h => h.zone_id === zone && !h.archived_at)
  const label = (f: string, v: string | null) => !v ? '—' : f === 'attendance' && v in ATT ? L(ATT[v as keyof typeof ATT][0], ATT[v as keyof typeof ATT][1])
    : v in JOB ? L(JOB[v as keyof typeof JOB][0], JOB[v as keyof typeof JOB][1]) : v
  const at = (x: string) => new Date(x).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  return <>
    <section className="da-filters panel no-print">
      <Field label={L('থেকে', 'From')}><input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></Field>
      <Field label={L('পর্যন্ত', 'To')}><input type="date" value={to} min={from} max={t} onChange={e => setTo(e.target.value)} /></Field>
      <Field label={L('হাব', 'Hub')}><select value={hub} onChange={e => setHub(e.target.value)}><option value="">{L('সব হাব', 'All hubs')}</option>
        {hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
    </section>
    {q.error ? <p className="da-error">{hubOpsFriendly(q.error)}</p> : null}
    <DataTable<LogRow> title={L('কর্মীর স্ট্যাটাস লগ', 'Staff status log')} file={`hub-ops-status-log-${from}-${to}`} prefKey="hub-ops-log" rows={q.data} rowKey={r => String(r.id)} phoneView="list"
      empty={<p className="muted">{L('এই সময়ে কোনো বদল নেই।', 'No changes in this period.')}</p>}
      cols={[
        { key: 'name', label: L('নাম', 'Name'), primary: true, value: r => r.person_name,
          render: r => <><strong>{r.person_name}</strong><span className="sec">{[r.employee_code ? `#${r.employee_code}` : L('এইচআর-এ নেই', 'not in HR'), r.hub_name].join(' · ')}</span></> },
        { key: 'date', label: L('তারিখ', 'Date'), value: r => r.status_date, render: r => dmy(r.status_date) },
        { key: 'hub', label: L('হাব', 'Hub'), value: r => r.hub_name, hidden: true },
        { key: 'what', label: L('বদল', 'Change'), value: r => `${label(r.field, r.from_value)} → ${label(r.field, r.to_value)}`,
          render: r => <span><span className="muted">{label(r.field, r.from_value)}</span> → <b>{label(r.field, r.to_value)}</b></span> },
        { key: 'reason', label: L('কারণ', 'Reason'), value: r => r.reason ?? '' },
        { key: 'remarks', label: L('মন্তব্য', 'Remarks'), value: r => r.remarks ?? '' },
        { key: 'by', label: L('কে', 'By'), value: r => `${r.changed_by_name ?? ''} · ${at(r.changed_at)}` },
      ]} />
  </>
}

const DAYS: Array<[number, string, string]> = [[6, 'শনি', 'Sat'], [7, 'রবি', 'Sun'], [1, 'সোম', 'Mon'], [2, 'মঙ্গল', 'Tue'], [3, 'বুধ', 'Wed'], [4, 'বৃহস্পতি', 'Thu'], [5, 'শুক্র', 'Fri']]

/** The zone's own settings: designation groups (Manager, Hub CC, Entry Man stay; more can be added), reasons, hubs and days without a report. */
function ZoneSettings({ zone }: { zone: string }) {
  const { L, lang } = usePrefs()
  const q = useLoad(() => hubOps.settings(zone), [zone])
  const { toast, node } = useToast()
  const [f, setF] = useState<Settings | null>(null)
  const [newReason, setNewReason] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  useEffect(() => { if (q.data) setF(q.data) }, [q.data])
  if (q.error) return <p className="da-error">{hubOpsFriendly(q.error)}</p>
  if (!f) return <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>
  const can = f.can_configure
  const setGroup = (i: number, g: Partial<Group>) => setF({ ...f, groups: f.groups.map((x, j) => j === i ? { ...x, ...g } : x) })
  const posName = (p: Settings['positions'][number]) => lang === 'bn' ? p.name_bn || p.name : p.name
  async function save() {
    if (!f) return
    setBusy(true); setErr('')
    try { await hubOps.configure(zone, f.groups, f.reasons, f.skip_hub_ids, f.off_days); toast(L('সেটিং সেভ হয়েছে', 'Settings saved')); await q.reload() }
    catch (e) { setErr(hubOpsFriendly(e)) } finally { setBusy(false) }
  }
  return <>{node}
    {!can && <p className="muted">{L('শুধু দেখা যাবে — বদলানোর অনুমতি নেই।', 'View only — you cannot change these.')}</p>}
    <section className="panel">
      <h3 className="hop-h"><Icon name="users" size={17} />{L('পদের গ্রুপ (কর্মী যেভাবে সাজানো থাকবে)', 'Designation groups (how staff are grouped)')}</h3>
      <p className="muted small">{L('ম্যানেজার, হাব সিসি ও এন্ট্রি ম্যান থাকবেই; দরকারমতো আরও গ্রুপ যোগ করুন। প্রতিটি পদ বেছে দিন — বাছা না থাকলে নামের মিল দিয়ে বসে, কোনোটাতেই না মিললে "অন্যান্য"।',
        'Manager, Hub CC and Entry Man always stay; add more as needed. Pick the posts of each group — otherwise the match words decide, and anything else is "Other".')}</p>
      {f.groups.map((g, i) => <div key={g.key} className="hop-gedit">
        <div className="hop-gedit-row">
          <input value={g.bn} disabled={!can} onChange={e => setGroup(i, { bn: e.target.value })} aria-label={L('বাংলা নাম', 'Bangla name')} />
          <input value={g.en} disabled={!can} onChange={e => setGroup(i, { en: e.target.value })} aria-label={L('ইংরেজি নাম', 'English name')} />
          {can && <span className="row-acts">
            <button type="button" className="secondary sm" disabled={i === 0} onClick={() => { const x = [...f.groups];[x[i - 1], x[i]] = [x[i], x[i - 1]]; setF({ ...f, groups: x }) }} aria-label={L('উপরে', 'Up')}>↑</button>
            {!['manager', 'hub_cc', 'entry_man'].includes(g.key) && <button type="button" className="secondary sm" onClick={() => setF({ ...f, groups: f.groups.filter((_, j) => j !== i) })}><Icon name="x" size={14} /></button>}
          </span>}
        </div>
        <div className="chips">{f.positions.map(p => { const on = (g.position_ids ?? []).includes(p.id)
          return <button type="button" key={p.id} disabled={!can} aria-pressed={on} className={`chip-toggle${on ? ' on' : ''}`}
            onClick={() => setGroup(i, { position_ids: on ? (g.position_ids ?? []).filter(x => x !== p.id) : [...(g.position_ids ?? []), p.id] })}>{posName(p)}</button> })}</div>
        <small className="muted">{L('এখন এই গ্রুপে', 'In this group now')}: {f.positions.filter(p => p.group_key === g.key).map(posName).join(', ') || '—'}
          {g.pattern ? ` · ${L('মিলের শব্দ', 'match words')}: ${g.pattern}` : ''}</small>
      </div>)}
      {can && <button type="button" className="secondary sm" onClick={async () => {
        const name = await askText(L('নতুন গ্রুপের নাম', 'New group name'), { short: true, label: L('নাম (যেমন: হিসাব)', 'Name (e.g. Accounts)'), ok: L('যোগ করুন', 'Add') }); if (!name) return
        let key = 'g_' + Math.random().toString(36).slice(2, 8)
        while (f.groups.some(x => x.key === key)) key = 'g_' + Math.random().toString(36).slice(2, 8)
        setF({ ...f, groups: [...f.groups, { key, bn: name, en: name, core: false, position_ids: [], pattern: null }] })
      }}><Icon name="plus" size={14} />{L('নতুন গ্রুপ', 'New group')}</button>}
    </section>

    <section className="panel">
      <h3 className="hop-h"><Icon name="note" size={17} />{L('অপারেশনের কারণ (এক ট্যাপে বাছার জন্য)', 'Operational reasons (one-tap list)')}</h3>
      <div className="chips">{f.reasons.map(r => <span key={r} className="chip">{r}{can && <button type="button" className="hop-x" aria-label={L('সরান', 'Remove')}
        onClick={() => setF({ ...f, reasons: f.reasons.filter(x => x !== r) })}>×</button>}</span>)}</div>
      {can && <form className="hop-inline" onSubmit={e => { e.preventDefault(); const v = newReason.trim(); if (v && !f.reasons.includes(v)) setF({ ...f, reasons: [...f.reasons, v] }); setNewReason('') }}>
        <input value={newReason} maxLength={120} onChange={e => setNewReason(e.target.value)} placeholder={L('নতুন কারণ…', 'New reason…')} />
        <button type="submit" className="secondary sm" disabled={!newReason.trim()}><Icon name="plus" size={14} />{L('যোগ', 'Add')}</button></form>}
    </section>

    <section className="panel">
      <h3 className="hop-h"><Icon name="hub" size={17} />{L('যে হাবের রিপোর্ট লাগবে না', 'Hubs with no report expected')}</h3>
      <p className="muted small">{L('যেমন যে হাবে এখনো কর্মী নেই। এগুলো "রিপোর্ট নেই" তালিকায় আসবে না।', 'E.g. a hub with no staff yet. These are not listed as missing.')}</p>
      <div className="chips">{f.hubs.map(h => { const on = f.skip_hub_ids.includes(h.id)
        return <button type="button" key={h.id} disabled={!can} aria-pressed={on} className={`chip-toggle${on ? ' on' : ''}`}
          onClick={() => setF({ ...f, skip_hub_ids: on ? f.skip_hub_ids.filter(x => x !== h.id) : [...f.skip_hub_ids, h.id] })}>{h.name}</button> })}</div>
      <h3 className="hop-h" style={{ marginTop: 14 }}><Icon name="cal" size={17} />{L('যে দিনে রিপোর্ট লাগবে না', 'Days with no report expected')}</h3>
      <div className="chips">{DAYS.map(([d, b, e]) => { const on = f.off_days.includes(d)
        return <button type="button" key={d} disabled={!can} aria-pressed={on} className={`chip-toggle${on ? ' on' : ''}`}
          onClick={() => setF({ ...f, off_days: on ? f.off_days.filter(x => x !== d) : [...f.off_days, d] })}>{L(b, e)}</button> })}</div>
      <p className="muted small">{L('সপ্তাহ শুরু হয় শনিবার।', 'A week starts on Saturday.')}</p>
    </section>
    {err && <p className="da-error">{err}</p>}
    {can && <div className="hop-bar"><button type="button" disabled={busy} onClick={() => void save()}><Icon name="save" size={16} />{busy ? L('সেভ হচ্ছে…', 'Saving…') : L('সেটিং সেভ করুন', 'Save settings')}</button></div>}
  </>
}
