import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell, refreshShellCounts } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { todayDhaka } from '../../lib/dailyAccounts'
import { ATTENDANCE_HUB, ATTENDANCE_ZONE } from '../../lib/menu'
import { usePrefs } from '../../lib/prefs'
import { resolveWorkHub, useWorkHub } from '../../lib/workHub'
import { LIVE, useLiveLoad, wf, wfFriendly, type HubOverview, type Mark } from '../../lib/workforce'
import { Field } from '../accounts/ui'
import { AttendanceBook } from './AttendanceBook'
import { FinalSheetTab, MonthSheetTab } from './FinalSheet'
import { AppsTab, OpsTab } from './HubTabs'
import { MorningPolicy, MorningTab, PublishedPlanTab, ZoneMorningTab } from './Morning'
import { MyExplanations } from './MyExplanations'
import { ReopenPanel } from './Reopen'
import { ZoneFinal } from './ZoneFinal'
import { ZoneOps } from './ZoneOps'
import { OpsDeadlineEditor } from './OpsDeadlines'
import { ZoneWindows } from './ZoneWindows'
import { ChipTabs, Loading, LiveDot, Notice, fmtDay, prevMonth, useHubList } from './shared'
import '../../workforce.css'

/**
 * হাজিরা খাতা — the one attendance page for everybody (/app/attendance). What it shows follows the person's permissions:
 *   আমার হাজিরা    every staff member: their own monthly book, and the explanations the manager asked for
 *   হাব            a hub manager: the hub's daily final register, the monthly register, absence applications, the daily report
 *   জোন            a zonal manager: every hub's final register of a day side by side, the zone's numbers, and the setting
 * The final register is the one way attendance reaches the register: staff give it once, the hub manager makes the day final and
 * submits (it locks), only the zonal manager unlocks. Every rule is checked again in the database (att_* and wf_* functions).
 * The old addresses (/app/workforce/hub, /zone, /attendance) lead here (see LegacyAttendanceRedirect in App.tsx).
 */
type View = 'me' | 'hub' | 'zone'
type HubTab = 'morning' | 'plan' | 'final' | 'month' | 'apps' | 'ops'
type ZoneTab = 'morning' | 'final' | 'ops' | 'setting' | 'ops-setting'

export function AttendancePage() {
  const { L } = usePrefs()
  const { can } = useAuth()
  const [sp, setSp] = useSearchParams()
  const canHub = ATTENDANCE_HUB.some(can)   // the same lists the Hub tab and the quick action use (lib/navAccess.ts)
  const canZone = ATTENDANCE_ZONE.some(can)
  const views = useMemo(() => [
    { key: 'me' as View, label: L('আমার হাজিরা', 'My attendance') },
    ...(canHub ? [{ key: 'hub' as View, label: L('হাব', 'Hub') }] : []),
    ...(canZone ? [{ key: 'zone' as View, label: L('জোন', 'Zone') }] : []),
  ], [L, canHub, canZone])
  const asked = sp.get('view')
  const view: View = views.find(v => v.key === asked)?.key ?? (sp.get('give') ? 'me' : canZone ? 'zone' : canHub ? 'hub' : 'me')

  /** Change some of the address's parts at once (null removes one). */
  const put = (patch: Record<string, string | null>) => setSp(p => {
    const q = new URLSearchParams(p)
    for (const [k, v] of Object.entries(patch)) { if (v === null) q.delete(k); else q.set(k, v) }
    return q
  }, { replace: true })

  return <AppShell title={L('হাজিরা খাতা', 'Attendance register')}>
    {views.length > 1 && <div className="wm"><ChipTabs<View> tabs={views} value={view} onChange={v => put({ view: v, tab: null, date: null, give: null })} label={L('হাজিরা খাতার অংশ', 'Attendance sections')} /></div>}
    {view === 'me' && <div className="wf"><MyExplanations /><AttendanceBook /></div>}
    {view === 'hub' && <HubView sp={sp} put={put} canResend={can('ops.route_plan.approve')} />}
    {view === 'zone' && <ZoneView sp={sp} put={put} canSet={can('hr.attendance.configure')} />}
  </AppShell>
}

type Put = (patch: Record<string, string | null>) => void

// ====================================================================================== হাব
const HUB_TABS: HubTab[] = ['morning', 'plan', 'final', 'month', 'apps', 'ops']

function HubView({ sp, put, canResend }: { sp: URLSearchParams; put: Put; canResend: boolean }) {
  const { L, n, lang } = usePrefs()
  const hubsQ = useHubList()
  const hubs = useMemo(() => hubsQ.data?.hubs ?? [], [hubsQ.data])
  const { session } = useAuth()
  const preferred = useWorkHub(session?.user.id ?? '')
  const linkedHub = sp.get('hub')
  const hub = resolveWorkHub(hubs, preferred, linkedHub)
  const hubId = hub?.id ?? ''
  const ovQ = useLiveLoad<HubOverview | null>(() => hubId ? wf.hubOverview(hubId) : Promise.resolve(null), [hubId], LIVE.manage)
  const ov = ovQ.data && ovQ.data.hub.id === hubId ? ovQ.data : null
  const can = ov?.can
  const today = ov?.date ?? todayDhaka()

  const visible: Record<HubTab, boolean> = { morning: !!can?.attendance, plan: !!can?.attendance, final: !!can?.attendance, month: !!can?.attendance, apps: !!can?.attendance, ops: !!can?.ops }
  const askedTab = sp.get('tab') as HubTab | null
  const tab: HubTab = askedTab && HUB_TABS.includes(askedTab) && visible[askedTab] ? askedTab : can?.attendance ? 'morning' : 'ops'
  const go = (t: HubTab) => put({ tab: t })

  // the days on which staff gave attendance that no final register has settled yet — one tap opens that day's register
  const waitingQ = useLiveLoad<Mark[]>(() => hubId && can?.attendance ? wf.marks({ hub: hubId }, prevMonth(today), today, 'waiting') : Promise.resolve([]), [hubId, today, can?.attendance], LIVE.manage)
  const backlog = useMemo(() => {
    const m = new Map<string, number>()
    for (const x of waitingQ.data ?? []) m.set(x.work_date, (m.get(x.work_date) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [waitingQ.data])

  const tabs: Array<{ key: HubTab; label: string; count?: number; tone?: 'warn' | 'bad' }> = [
    { key: 'morning', label: L('সকালের জনবল', 'Morning input') },
    { key: 'plan', label: L('পাওয়া রুট প্ল্যান', 'Route plan received') },
    { key: 'final', label: L('ফাইনাল খাতা', 'Final register'), count: backlog.length },
    { key: 'month', label: L('মাসিক খাতা', 'Monthly register') },
    { key: 'apps', label: L('আবেদন', 'Applications'), count: ov?.pending.applications },
    { key: 'ops', label: L('দৈনিক রিপোর্ট', 'Daily report') },
  ]

  return <div className="wm">
    {hub && <div className="da-bar no-print"><span className="muted small">{hub.name}</span><LiveDot on={ovQ.live} /></div>}
    {hubs.length > 0 && !hub && <Notice>{linkedHub
      ? <Link to="/app/attendance?view=hub">{L('লিংকের হাবটি দেখা যাচ্ছে না। কাজের হাব খুলুন।', 'This link’s hub is unavailable. Open your working hub.')}</Link>
      : <Link to="/app/me/permissions">{L('আমার অনুমতি থেকে কাজের হাব বেছে নিন।', 'Choose a working hub in My permissions.')}</Link>}</Notice>}

    {hubsQ.error ? <p className="da-error" role="alert">{wfFriendly(hubsQ.error)}</p> : null}
    {hubsQ.data && !hubs.length ? <Notice>{L('আপনার দেখার মতো কোনো হাব নেই।', 'There is no hub you can see.')}</Notice> : null}
    {ovQ.error && !ov ? <p className="da-error" role="alert">{wfFriendly(ovQ.error)}</p> : null}
    {hubId && !ov && !ovQ.error ? <Loading /> : null}

    {ov && can && !can.attendance && !can.ops && <Notice>{L('এই হাবের হাজিরা দেখার অনুমতি আপনার নেই।', 'You may not open this hub’s attendance.')}</Notice>}

    {ov && can && (can.attendance || can.ops) && <>
      {can.attendance && backlog.length > 0 && <section className="panel wm-sec no-print" aria-label={L('ফাইনাল খাতা বাকি', 'Final registers still to make')}>
        <p className="wm-hint"><Icon name="alert" size={16} /> <b>{L(`${n(backlog.length)} দিনের হাজিরা ফাইনাল খাতায় বসার অপেক্ষায়`, `${backlog.length} days of attendance wait for the final register`)}</b>
          {' '}<span className="muted small">{L('কর্মীর দেওয়া হাজিরা তখনই খাতায় ওঠে যখন সেই দিনের ফাইনাল খাতা সাবমিট হয়। দিন বেছে নিন:', 'Staff attendance reaches the register when that day’s final register is submitted. Pick a day:')}</span></p>
        <div className="wm-chips" role="group" aria-label={L('বাকি দিন', 'Days to do')}>
          {backlog.slice(0, 14).map(([d, c]) => <button key={d} type="button" className={`wm-chip${tab === 'final' && sp.get('date') === d ? ' on' : ''}`} onClick={() => put({ tab: 'final', date: d })}>
            {fmtDay(d, lang)}<b className="plain">{n(c)}</b></button>)}
          {backlog.length > 14 && <span className="muted small">+{n(backlog.length - 14)}</span>}
        </div>
      </section>}

      <ChipTabs<HubTab> tabs={tabs.filter(t => visible[t.key])} value={tab} onChange={go} label={L('হাবের বিভাগ', 'Hub sections')} />

      <div key={`${hubId}-${tab}`}>
        {tab === 'morning' && <MorningTab hubId={hubId} />}
        {tab === 'plan' && <PublishedPlanTab hubId={hubId} canResend={canResend} />}
        {tab === 'final' && <FinalSheetTab hubId={hubId} />}
        {tab === 'month' && <MonthSheetTab hubId={hubId} />}
        {tab === 'apps' && <AppsTab hubId={hubId} can={can} onChanged={() => { void ovQ.reload(); refreshShellCounts() }} />}
        {tab === 'ops' && <OpsTab hubId={hubId} zoneId={hub?.zone_id ?? ''} />}
      </div>
    </>}
  </div>
}

// ====================================================================================== জোন
function ZoneView({ sp, put, canSet }: { sp: URLSearchParams; put: Put; canSet: boolean }) {
  const { L } = usePrefs()
  const { grants } = useAuth()
  const hubsQ = useHubList()
  const tabAsked = sp.get('tab') as ZoneTab | null
  const configuring = canSet && (tabAsked === 'setting' || tabAsked === 'ops-setting')
  const tab: ZoneTab = tabAsked === 'ops' || tabAsked === 'final' || configuring ? tabAsked : 'morning'
  const zones = (hubsQ.data?.zones ?? []).filter(z => !configuring || grants.some(grant =>
    grant.is_super || (grant.permission_code === 'hr.attendance.configure' &&
      (grant.scope_type === 'global' || (grant.scope_type === 'zone' && grant.zone_id === z.id)))))
  const zoneAsked = sp.get('zone') ?? ''
  const zone = zones.some(z => z.id === zoneAsked) ? zoneAsked : ''
  const policyZone = zone || zones[0]?.id || ''
  const tabs: Array<{ key: ZoneTab; label: string }> = [
    { key: 'morning', label: L('জোনের সকাল', 'The zone’s morning') },
    { key: 'final', label: L('দৈনিক হাজিরা — হাব অনুযায়ী', 'Daily attendance — by hub') },
    { key: 'ops', label: L('পিকআপ · রিটার্ন · ডেলিভারি', 'Pickup · return · delivery') },
    ...(canSet ? [
      { key: 'setting' as const, label: L('সেটিং: হাজিরা বই', 'Setting: attendance book') },
      { key: 'ops-setting' as const, label: L('সেটিং: দৈনিক রিপোর্ট', 'Setting: daily report') },
    ] : []),
  ]

  return <div className="wm">
    {zones.length > 1 && <section className="panel wm-top no-print">
      <Field label={L('জোন', 'Zone')}>
        <select value={configuring ? policyZone : zone} onChange={e => put({ zone: e.target.value || null })}>
          {!configuring && <option value="">{L('সব জোন', 'All zones')}</option>}
          {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>
    </section>}
    {hubsQ.error ? <p className="da-error" role="alert">{wfFriendly(hubsQ.error)}</p> : null}

    <ChipTabs<ZoneTab> tabs={tabs} value={tab} onChange={t => put({ tab: t })} label={L('জোনের বিভাগ', 'Zone sections')} />
    <div key={`${zone}-${tab}`}>
      {tab === 'morning' && <ZoneMorningTab zone={zone} />}
      {tab === 'final' && <><ZoneFinal zone={zone} onOpenHub={(hub, date) => put({ view: 'hub', hub, tab: 'final', date })} />{canSet && <ReopenPanel zone={zone} />}</>}
      {tab === 'ops' && <ZoneOps zone={zone} />}
      {tab === 'ops-setting' && <OpsDeadlineEditor key={policyZone} zone={policyZone} />}
      {tab === 'setting' && <><MorningPolicy key={policyZone} zone={policyZone} />{policyZone && <ZoneWindows key={`windows-${policyZone}`} zone={policyZone} />}</>}
    </div>
  </div>
}
