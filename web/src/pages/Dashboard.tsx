import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { hrReq } from '../lib/hrreq'
import { NodiGaps } from '../components/NodiGaps'
import { Link } from 'react-router-dom'
import { panelLevel } from '../lib/menu'
import { useAuth } from '../auth/AuthProvider'
import { AppShell, useMyPhoto } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { NetworkPanel } from '../components/NetworkPanel'
import { OfficeItemsPanel } from '../components/OfficeItemsPanel'
import { HrReqPanel } from '../components/HrReqPanel'
import { Badge, Stat, useLoad } from './accounts/ui'
import { usePrefs } from '../lib/prefs'
import { VIEWS, VIEW_OF, dashboard, dashboardFriendly, panelLabel, pickedView, setView, type DashView, type PanelCode } from '../lib/dashboard'
import { HubTodayPanel, MyDayPanel } from '../components/HomePanels'
import { MyApprovalCard } from '../components/MyApprovals'
import { RiderSendCard } from '../components/RiderQuick'
import { PersonalMenu } from '../components/PersonalMenu'
import { WorkforceAlerts } from '../components/WorkforceAlerts'
import { AppDownloadCard } from '../components/AppDownloadCard'
import { reportImport } from '../lib/reportImport'
import { todayDhaka } from '../lib/dailyAccounts'
import { pageAllowed } from '../lib/menu'

export function Dashboard() {
  const { session, grants, can, viewAs, isSuperAdmin, menu } = useAuth()
  const { L, n, lang } = usePrefs()
  const home = useLoad(() => dashboard.home(), [])
  const d = home.data
  const name = d?.me?.name || session?.user.user_metadata?.full_name || session?.user.email || L('ব্যবহারকারী', 'User')
  // Previewing a role: show that role's panels (numbers stay the Super Admin's own).
  const panels: PanelCode[] = (viewAs?.panels as PanelCode[] | null | undefined) ?? d?.panels ?? []
  const has = (p: PanelCode) => panels.includes(p)
  // Views (আমি / হাব / জোন): only those with at least one panel this person may see.
  const views = VIEWS.filter(([v]) => panels.some(p => VIEW_OF[p]?.includes(v)))
  const [view, setV] = useState<DashView | null>(pickedView())
  const [defView, setDefView] = useState<DashView | null>(null)
  useEffect(() => { if (viewAs) { setDefView(viewAs.view); setV(null) } else void dashboard.defaultView().then(setDefView) }, [viewAs])
  const cur: DashView | null = views.find(x => x[0] === view)?.[0] ?? views.find(x => x[0] === defView)?.[0] ?? views[views.length - 1]?.[0] ?? null
  const vis = (p: PanelCode) => has(p) && !!cur && !!VIEW_OF[p]?.includes(cur)
  const pickView = (v: DashView) => { setV(v); setView(v) }
  // Let the tab bar follow the view on show, without saving it as the person's choice.
  useEffect(() => { if (cur) setView(cur, false) }, [cur])
  const where = [d?.me?.position, d?.me?.hub, d?.me?.zone].filter(Boolean).join(' · ')
  const photo = useMyPhoto()
  const hour = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', hour12: false }))
  const hello = hour < 5 ? L('শুভ রাত্রি', 'Good night') : hour < 12 ? L('শুভ সকাল', 'Good morning') : hour < 17 ? L('শুভ দুপুর', 'Good afternoon') : hour < 20 ? L('শুভ সন্ধ্যা', 'Good evening') : L('শুভ রাত্রি', 'Good night')
  const day = new Date().toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', weekday: 'long', day: 'numeric', month: 'long' })
  // Which of the "today" panels are on screen, so each fact is shown once (audit 21 Nov 2026).
  const showsMyDay = vis('my_day'), showsMyWork = vis('my_work')
  const firstSteps = panelLevel(can) === 2
  return <AppShell title={L('হোম', 'Home')}
    subtitle={d?.me?.employee_code ? `${L('আইডি', 'ID')} ${n(d.me.employee_code)}` : L('আপনার রোল অনুযায়ী আজকের চিত্র', 'Today at a glance, for your role')}>
    <div className="home-dash">
    {grants.length === 0 && <p className="notice">{L('আপনার অ্যাকাউন্টে এখনো কোনো রোল দেওয়া হয়নি। সিস্টেম অ্যাডমিনের সঙ্গে যোগাযোগ করুন।', 'No role has been given to your account yet. Contact your system administrator.')}</p>}
    {home.error ? <p className="da-error">{dashboardFriendly(home.error)}</p> : null}
    {firstSteps && <FirstSteps photo={photo} />}
    <NodiGaps />
    {home.loading && !d ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p> : null}

    <div className="greet">
      <div className="g-main"><div className="g-day">{hello} 👋 <span>· {day}</span></div><h2>{String(name).split(' ').slice(0, 2).join(' ')}</h2>
        <div className="g-sub"><Icon name="hub" size={15} /><span>{where || L('আজকের কাজ এক নজরে', 'Today at a glance')}</span></div>
        <div className="g-motto">{L('কম কাজ · বেশি অটোমেশন · ভালো ব্যবস্থাপনা', 'Less work · More automation · Better management')}</div></div>
      {/* duties only — the waiting attendance and approvals have their own cards below, so no "0 open" next to them */}
      {d?.my_work && d.my_work.tasks_open > 0 && <div className="g-badge"><b>{n(d.my_work.tasks_open)}</b>{L('চলমান দায়িত্ব', 'open duties')}</div>}
    </div>
    {/* the three personal entries under the name card, and what is waiting on me (attendance, daily numbers, approvals) */}
    <div className="wf-under"><PersonalMenu variant="card" /><WorkforceAlerts /></div>
    {isSuperAdmin && !viewAs && <Link to="/app/role-dashboards" className="dash-edit"><Icon name="gear" size={15} />{L('ড্যাশবোর্ড সাজান', 'Arrange dashboard')}</Link>}
    {views.length > 1 && <div className="view-switch" role="tablist" aria-label={L('ড্যাশবোর্ড', 'Dashboard')}>
      {views.map(([v, bn, en, ic]) => <button key={v} type="button" role="tab" aria-selected={cur === v} className={cur === v ? 'on' : ''} onClick={() => pickView(v)}>
        <Icon name={ic} size={17} />{L(bn, en)}</button>)}</div>}
    {d?.my_work && !d.my_work.marked_today && !showsMyDay && !showsMyWork && <Link to="/app/workforce/hub" className="alert-card warn"><span className="ai"><Icon name="clock" size={20} /></span>
      <span>{L('আজকের হাজিরা এখনো দেওয়া হয়নি', 'Your attendance for today is not marked yet')}</span></Link>}
    {d?.my_work && d.my_work.tasks_due > 0 && <Link to="/app/hub/tasks" className="alert-card bad"><span className="ai"><Icon name="alert" size={20} /></span>
      <span>{L(`${n(d.my_work.tasks_due)}টা কাজের সময় পেরিয়ে গেছে`, `${d.my_work.tasks_due} tasks are overdue`)}</span></Link>}
    {/* the first-steps list already asks for the photo; say it once, the same way */}
    {d?.me && photo === null && !firstSteps && <Link to="/app/me" className="alert-card warn"><span className="ai"><Icon name="user" size={20} /></span>
      <span>{L('প্রোফাইলের ছবি নেই — নিজেই ছবি দিন', 'No profile photo — add it yourself')}</span></Link>}
    {/* one card for everything waiting on me: riders' pickup, delivery and money, staff bills, other approvals */}
    <MyApprovalCard />
    <RiderSendCard />
    {(can('da.import.create') || can('da.sheet.view')) && pageAllowed(menu ?? null, '/app/accounts/report-import') && <ReportUploadCard />}
    {/* Panels come in the order saved for the person's role (রোল অনুযায়ী ড্যাশবোর্ড). */}
    {panels.filter(vis).map(p => <Fragment key={p}>{draw(p)}</Fragment>)}
    <AppDownloadCard />
    </div>
  </AppShell>

  function draw(p: PanelCode): ReactNode {
    switch (p) {
      case 'my_day': return <MyDayPanel />
      case 'hub_today': return <HubTodayPanel />
      case 'network': return <NetworkPanel />
      case 'office_items': return <OfficeItemsPanel />
      case 'approvals': return null   // always shown at the top as "আমার অনুমোদন" (MyApprovalCard)
      case 'my_requests': return <HrReqPanel />
      case 'my_work': return d?.my_work ? <Panel code="my_work">
      <div className="da-stats">
        <Stat icon="log" label={L('আমার দায়িত্ব', 'My tasks')} value={n(d.my_work.tasks_open)}
          sub={d.my_work.tasks_due ? <span className="warn">{L(`${n(d.my_work.tasks_due)} টির সময় শেষ`, `${d.my_work.tasks_due} due`)}</span> : L('সব ঠিক আছে', 'All clear')} tone={d.my_work.tasks_due ? 'warn' : undefined} />
        {d.my_work.tasks_to_check > 0 && <Stat icon="check" label={L('আমার দেখার অপেক্ষায়', 'Waiting for my check')} value={n(d.my_work.tasks_to_check)} tone="warn" />}
        {!showsMyDay && <Stat icon="cal" label={L('আজকের হাজিরা', 'Attendance today')} value={d.my_work.marked_today ? L('দেওয়া হয়েছে', 'Marked') : L('দেওয়া হয়নি', 'Not marked')}
          tone={d.my_work.marked_today ? 'ok' : 'warn'} />}
        <Stat icon="log" label={L('আমার ছুটির আবেদন', 'My leave requests')} value={n(d.my_work.leave_pending)} sub={L('সিদ্ধান্তের অপেক্ষায়', 'Awaiting a decision')} />
      </div>
      {!showsMyDay && <p className="muted small home-links"><Link to="/app/me">{L('আমার প্রোফাইল', 'My profile')}</Link> · <Link to="/app/hr/leave">{L('ছুটি', 'Leave')}</Link> · <Link to="/app/accounts/mine">{L('আমার হিসাব', 'My accounts')}</Link></p>}
    </Panel> : null
      case 'hr_overview': return d?.hr_overview ? <Panel code="hr_overview" to="/app/staff/list">
      <div className="da-stats">
        <Stat icon="users" label={L('মোট কর্মী', 'Staff')} value={n(d.hr_overview.total)} />
        <Stat icon="check" tone="ok" label={L('সক্রিয়', 'Active')} value={n(d.hr_overview.active)} />
        <Stat icon="user" label={L('নিষ্ক্রিয়', 'Inactive')} value={n(d.hr_overview.inactive)} />
        <Stat icon="clock" tone={d.hr_overview.applicant ? 'warn' : undefined} label={L('আইডির অপেক্ষায়', 'Waiting for an ID')} value={n(d.hr_overview.applicant)} />
        <Stat icon="chart" label={L('৩০ দিনে যোগ দিয়েছেন', 'Joined in 30 days')} value={n(d.hr_overview.joined_30d)} />
        <Stat icon="chart" label={L('৩০ দিনে বিদায়', 'Left in 30 days')} value={n(d.hr_overview.left_30d)} />
      </div>
    </Panel> : null
      case 'hr_pending': return d?.hr_pending ? <Panel code="hr_pending">
      <div className="da-stats">
        <Row to="/app/hr/applications" icon="form" label={L('আইডি আবেদন', 'ID applications')} value={d.hr_pending.applications} />
        <Row to="/app/hr/leave" icon="log" label={L('ছুটির আবেদন', 'Leave requests')} value={d.hr_pending.leave} />
        <Row to="/app/staff/list" icon="wallet" label={L('বেতনের প্রস্তাব', 'Salary proposals')} value={d.hr_pending.salary} />
        <Row to="/app/staff/list" icon="shield" label={L('ডকুমেন্ট যাচাই', 'Documents to verify')} value={d.hr_pending.documents} />
      </div>
    </Panel> : null
      case 'hub_staff': return d?.hub_staff ? <Panel code="hub_staff" to="/app/staff/list">
      {!d.hub_staff.length ? <p className="muted">{L('কোনো হাব নেই।', 'No hubs yet.')}</p> :
        <div className="da-table-wrap"><table className="da-table">
          <thead><tr><th>{L('হাব', 'Hub')}</th><th>{L('মোট', 'Total')}</th><th>{L('সক্রিয়', 'Active')}</th><th>{L('নিষ্ক্রিয়', 'Inactive')}</th><th>{L('আইডির অপেক্ষায়', 'Waiting')}</th></tr></thead>
          <tbody>{d.hub_staff.slice(0, 10).map(h => <tr key={h.hub_id}>
            <td><strong>{h.hub}</strong><span className="sec">{h.zone}</span></td>
            <td>{n(h.total)}</td><td>{n(h.active)}</td><td>{n(h.inactive)}</td>
            <td>{h.applicant ? <Badge tone="warn">{n(h.applicant)}</Badge> : <span className="muted">—</span>}</td>
          </tr>)}</tbody></table></div>}
      {d.hub_staff.length > 10 && <p className="muted small">{L(`আরও ${n(d.hub_staff.length - 10)}টি হাব — পুরো তালিকা দেখুন`, `${d.hub_staff.length - 10} more hubs — see the full list`)}</p>}
    </Panel> : null
      case 'ops_today': return d?.ops_today ? <Panel code="ops_today">
      <div className="da-stats">
        <Stat icon="hub" label={L('হাবে আছে', 'At the hub')} value={n(d.ops_today.at_hub)} />
        <Stat icon="truck" label={L('ডেলিভারিতে গেছে', 'Out for delivery')} value={n(d.ops_today.out_for_delivery)} />
        <Stat icon="form" label={L('আজ এসেছে', 'Received today')} value={n(d.ops_today.received_today)} />
        <Stat icon="clock" tone={d.ops_today.pickups_waiting ? 'warn' : undefined} label={L('পিকআপ অপেক্ষায়', 'Pickups waiting')} value={n(d.ops_today.pickups_waiting)} />
        <Stat icon="clock" tone={d.ops_today.deliveries_waiting ? 'warn' : undefined} label={L('ডেলিভারি অপেক্ষায়', 'Deliveries waiting')} value={n(d.ops_today.deliveries_waiting)} />
        <Stat icon="alert" tone={d.ops_today.issues_open ? 'bad' : undefined} label={L('খোলা সমস্যা', 'Open issues')} value={n(d.ops_today.issues_open)} />
      </div>
    </Panel> : null
      case 'cash_today': return d?.cash_today ? <Panel code="cash_today">
      <div className="da-stats">
        <Stat icon="wallet" label={L('আজ আদায়', 'Collected today')} value={`৳ ${n(d.cash_today.collected_today)}`} />
        <Stat icon="clock" tone={d.cash_today.handovers_waiting ? 'warn' : undefined} label={L('হ্যান্ডওভার অপেক্ষায়', 'Handovers waiting')} value={n(d.cash_today.handovers_waiting)} />
        <Stat icon="log" tone={d.cash_today.expenses_waiting ? 'warn' : undefined} label={L('খরচ অনুমোদনের অপেক্ষায়', 'Expenses waiting')} value={n(d.cash_today.expenses_waiting)} />
        <Stat icon="wallet" tone={d.cash_today.payments_waiting ? 'warn' : undefined} label={L('মার্চেন্ট পেমেন্ট', 'Merchant payments')} value={n(d.cash_today.payments_waiting)} />
        <Stat icon="check" tone={d.cash_today.recons_waiting ? 'warn' : undefined} label={L('মিলকরণ অপেক্ষায়', 'Reconciliations waiting')} value={n(d.cash_today.recons_waiting)} />
      </div>
    </Panel> : null
      case 'accounts_today': return d?.accounts_today ? <Panel code="accounts_today" to="/app/accounts/daily">
      <div className="da-stats">
        <Stat icon="hub" label={L('হাব', 'Hubs')} value={n(d.accounts_today.hubs)} />
        <Stat icon="ledger" tone={d.accounts_today.open ? 'warn' : undefined} label={L('খোলা খাতা', 'Open sheets')} value={n(d.accounts_today.open)} />
        <Stat icon="clock" tone={d.accounts_today.submitted ? 'warn' : undefined} label={L('যাচাইয়ের অপেক্ষায়', 'Waiting to be checked')} value={n(d.accounts_today.submitted)} />
        <Stat icon="alert" tone={d.accounts_today.correction ? 'bad' : undefined} label={L('সংশোধন লাগবে', 'Needs correction')} value={n(d.accounts_today.correction)} />
        <Stat icon="check" tone="ok" label={L('অনুমোদিত', 'Approved')} value={n(d.accounts_today.approved)} />
      </div>
    </Panel> : null
      case 'zonal_overview': return d?.zonal_overview ? <Panel code="zonal_overview" to="/app/staff/list">
      <div className="da-stats">
        <Stat icon="map" label={L('এরিয়া', 'Areas')} value={n(d.zonal_overview.zones)} />
        <Stat icon="hub" label={L('হাব', 'Hubs')} value={n(d.zonal_overview.hubs)} />
        <Stat icon="users" label={L('সক্রিয় কর্মী', 'Active staff')} value={n(d.zonal_overview.staff)} />
        <Stat icon="log" tone={d.zonal_overview.tasks_overdue ? 'bad' : undefined} label={L('চলমান দায়িত্ব', 'Open tasks')} value={n(d.zonal_overview.tasks_open)}
          sub={d.zonal_overview.tasks_overdue ? L(`${n(d.zonal_overview.tasks_overdue)} টির সময় পেরিয়েছে`, `${d.zonal_overview.tasks_overdue} overdue`) : undefined} />
        <Stat icon="wallet" tone={d.zonal_overview.claims_waiting ? 'warn' : undefined} label={L('ভ্রমণ দাবি', 'Travel claims')} value={n(d.zonal_overview.claims_waiting)} />
        <Stat icon="chart" tone={d.zonal_overview.metrics_waiting ? 'warn' : undefined} label={L('হাবের হিসাব যাচাই', 'Hub figures to check')} value={n(d.zonal_overview.metrics_waiting)} />
      </div>
    </Panel> : null
      case 'quick_links': return null   // destinations are already available in the role-filtered main menu
      default: return null
    }
  }

  function Panel({ code, to, children }: { code: PanelCode; to?: string; children: ReactNode }) {
    return <section className="panel">
      <div className="da-bar"><h2 style={{ margin: 0 }}>{panelLabel(code, lang)}</h2>
        {to && <Link to={to} className="small">{L('বিস্তারিত', 'Open')} →</Link>}</div>
      {children}
    </section>
  }
}

function Row({ to, icon, label, value }: { to: string; icon: string; label: string; value: number }) {
  const { n } = usePrefs()
  return <Link to={to} className={`da-stat${value ? ' warn' : ''}`} style={{ textDecoration: 'none', color: 'inherit' }}>
    <span className="ri"><Icon name={icon} size={18} /></span><span className="lbl">{label}</span><span className="val">{n(value)}</span></Link>
}

/** Menu card: upload the courier panel's daily report; shows how many reports came in today. */
function ReportUploadCard() {
  const { L, n } = usePrefs()
  const q = useLoad(() => reportImport.status(todayDhaka()).catch(() => []), [])
  const rows = q.data ?? []
  const reports = rows.reduce((a, r) => a + r.reports, 0), done = rows.filter(r => r.reports > 0).length
  return <Link to="/app/accounts/report-import" className="ri-home">
    <span className="qi"><Icon name="upload" size={24} /></span>
    <span className="ri-home-t"><strong>{L('রিপোর্ট আপলোড', 'Report upload')}</strong>
      <span className="muted small">{L('কুরিয়ার প্যানেলের Update Report পেস্ট করুন', 'Paste the courier panel’s Update Report')}</span></span>
    <span className="ri-home-n"><b>{q.loading && !q.data ? '…' : n(reports)}</b>
      <span>{L('আজ কয়টি রিপোর্ট', 'reports today')}{rows.length > 1 ? L(` · ${n(done)}/${n(rows.length)} হাব`, ` · ${done}/${rows.length} hubs`) : ''}</span></span>
  </Link>
}

/** First steps after the first sign-in. Shown only while one of them is still open. */
function FirstSteps({ photo }: { photo: string | null | undefined }) {
  const { L } = usePrefs()
  const me = useLoad(() => hrReq.myEmployee().catch(() => null), [])
  const e = me.data
  if (!e || photo === undefined || (e.mobile && photo)) return null
  const steps: Array<[boolean, string, string | null]> = [
    [true, L('লগইন চালু হয়েছে', 'You are signed in'), null],
    [!!e.mobile, e.mobile ? L('মোবাইল নম্বর দেওয়া আছে', 'Mobile number given') : L('মোবাইল নম্বর দিন — তারপর নম্বর দিয়েও লগইন হবে', 'Give your mobile number — then you can sign in with it too'), '/app/me'],
    [!!photo, photo ? L('প্রোফাইলের ছবি আছে', 'Profile photo added') : L('প্রোফাইলের ছবি নেই — নিজেই ছবি দিন', 'No profile photo — add it yourself'), '/app/me'],
  ]
  return <section className="panel first-steps">
    <h2>{L('শুরুর ধাপ', 'First steps')} <Link to="/app/training" className="link small">{L('ট্রেনিং সেন্টার →', 'Training centre →')}</Link></h2>
    <ul>{steps.map(([ok, text, to], i) => <li key={i} className={ok ? 'ok' : ''}><span className="fs-tick" aria-hidden="true">{ok ? '✓' : i + 1}</span>
      {ok || !to ? <span>{text}</span> : <Link to={to}>{text}</Link>}</li>)}</ul>
  </section>
}
