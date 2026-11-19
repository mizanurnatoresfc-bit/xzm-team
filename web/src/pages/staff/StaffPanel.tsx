import { Fragment, useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { pageAllowed } from '../../lib/menu'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { NodiGaps } from '../../components/NodiGaps'
import { DailyOpsCard } from '../../components/DailyOpsCard'
import { PersonalMenu, useWfCounts } from '../../components/PersonalMenu'
import { WorkforceAlerts } from '../../components/WorkforceAlerts'
import { RiderSendCard } from '../../components/RiderQuick'
import { MyAvatarUpload } from '../../components/MyAvatar'
import { MyRouteCard } from '../../components/MyRoute'
import { da, addDays, todayDhaka, type Claim } from '../../lib/dailyAccounts'
import { dashboard } from '../../lib/dashboard'
import { staffPanel, STAFF_DEFAULT, type StaffSection } from '../../lib/staffPanel'
import { referrals } from '../../lib/extra'
import { dutiesApi } from '../../lib/hub'
import { hrReq } from '../../lib/hrreq'
import { hr } from '../../lib/hr'
import { issues, type ZoneContacts, type ZoneGroup } from '../../lib/issues'
import { usePrefs } from '../../lib/prefs'
import { supabase } from '../../lib/supabase'
import { fleet } from '../../lib/fleet'
import { useLiveLoad, wf } from '../../lib/workforce'
import { selfAtt, selfAttFriendly, type MyAttToday } from '../../lib/selfAtt'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'
import { AppDownloadCard } from '../../components/AppDownloadCard'

/**
 * স্টাফ প্যানেল — one phone screen for a staff member's own day, in the order the owner asked for:
 * my accounts, today's attendance, my bill, my route and duties, my complaint, issues and contact, my people.
 * It only reads what the person may already see and links into the pages that do the work; nothing new is stored.
 * A row marked "শীঘ্রই" has no database behind it yet. (Zone group and zonal manager are live since 19 Nov.)
 */
const ATT: Record<string, [bn: string, en: string, tone: string]> = {
  present: ['উপস্থিত', 'Present', 'g'], late: ['দেরিতে এসেছেন', 'Late', 'o'], half_day: ['অর্ধদিবস', 'Half day', 'o'], absent: ['অনুপস্থিত', 'Absent', 'r'],
  leave: ['ছুটিতে', 'On leave', 'p'], holiday: ['সরকারি ছুটি', 'Holiday', 'b'], weekly_off: ['সাপ্তাহিক ছুটি', 'Weekly off', 'b'],
}
const CLAIM: Record<string, [bn: string, en: string, tone: 'ok' | 'warn' | 'bad' | 'neutral']> = {
  submitted: ['ম্যানেজারের অপেক্ষায়', 'Waiting for manager', 'warn'], added: ['খাতায় উঠেছে', 'Taken into the sheet', 'ok'],
  rejected: ['বাতিল', 'Rejected', 'bad'], withdrawn: ['ফিরিয়ে নেওয়া', 'Withdrawn', 'neutral'],
}
const quiet = <T,>(p: PromiseLike<T>, or: T): Promise<T> => Promise.resolve(p).then(x => x, () => or)

export function StaffPanel() {
  const { L, n, lang } = usePrefs()
  const { can, session, menu } = useAuth()
  // A role limited to a list of pages: rows that lead off the list are left out.
  const ok = (to: string) => pageAllowed(menu, to)
  const today = todayDhaka()
  const d = useLoad(async () => {
    const [home, me] = await Promise.all([quiet(dashboard.home(), null), quiet(hrReq.myEmployee(), null)])
    const [acc, claims, panels, groups, att, duties, routes, hand, brought, car, zones, zm] = await Promise.all([
      quiet(da.myAccounts(addDays(today, -30), today), null),
      quiet(da.myClaims(30), [] as Claim[]),
      quiet(issues.panels(), null),
      quiet(issues.groupHubs(), []),
      quiet(selfAtt.mine(), null as MyAttToday | null),
      me ? quiet(dutiesApi.mine(me.id), []) : [],
      me ? quiet(supabase.from('rider_routes').select('hub_routes(name, areas)').eq('employee_id', me.id).is('effective_to', null)
        .then(r => ((r.data ?? []) as unknown as Array<{ hub_routes: { name: string; areas: string[] } | null }>).map(x => x.hub_routes).filter(Boolean) as Array<{ name: string; areas: string[] }>), []) : [],
      me ? quiet(referrals.prospects(me.id).then(x => x.length), 0) : 0,
      me ? quiet(referrals.brought(me.id).then(x => x.length), 0) : 0,
      quiet(fleet.mine(), null),
      quiet(issues.zoneGroups(), [] as ZoneGroup[]),
      quiet(issues.zoneContacts(), null as ZoneContacts | null),
    ])
    return { home, me, acc, claims, panels, groups, att, duties, routes, hand, brought, car, zones, zm }
  }, [])
  const v = d.data
  const layout = useLoad(() => staffPanel.mine(), [])
  const order: StaffSection[] = layout.loading && !layout.data ? [] : layout.data ?? STAFF_DEFAULT   // wait for it, so nothing jumps
  // Today's four numbers (My Workforce): the returns tile reads them; the input card below saves them. Live, so a submit shows here at once.
  const ops = useLiveLoad(() => wf.myOps(1), [], ['wf_daily_ops'])
  const reloadOps = ops.reload
  useEffect(() => { const f = () => void reloadOps(); window.addEventListener('wf:changed', f); return () => window.removeEventListener('wf:changed', f) }, [reloadOps])
  const todayOps = ops.data?.entry ?? null
  const returnsToday = todayOps ? todayOps.pickup_return + todayOps.delivery_return : null
  const wfOpen = useWfCounts().data?.open === true   // the attendance book is open today (days 1-17): "not coming" is given there
  const opsHere = !!ops.data && !ops.error   // a login with no active staff profile gets no input card
  const { hash } = useLocation()
  useEffect(() => { if (hash === '#wf-ops' && opsHere) document.getElementById('wf-ops')?.scrollIntoView({ block: 'start' }) }, [hash, opsHere])
  const toOps = (e: MouseEvent) => { const el = document.getElementById('wf-ops'); if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth', block: 'start' }) } }
  const gapQ = useLoad(() => v?.me ? hr.profileGaps().then(l => l.find(g => g.employee_id === v.me!.id) ?? null).catch(() => null) : Promise.resolve(null), [v?.me?.id])
  const profilePct = gapQ.data ? Math.round(100 * (gapQ.data.total_checks - gapQ.data.missing.length) / Math.max(1, gapQ.data.total_checks)) : null
  const duties = v?.duties ?? [], routes = v?.routes ?? []   // a database function may answer null instead of an empty list
  const name = v?.home?.me?.name || v?.me?.full_name || session?.user.user_metadata?.full_name || L('স্টাফ', 'Staff')
  const who = [v?.home?.me?.employee_code && `${L('আইডি', 'ID')} ${v.home.me.employee_code}`, v?.home?.me?.position, v?.home?.me?.hub].filter(Boolean).join(' · ')
  const day = new Date().toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', weekday: 'long', day: 'numeric', month: 'long' })
  const taka = (x: number) => `৳ ${n(Math.round(x))}`

  const lines = v?.acc?.my_lines ?? []
  const mine = lines.filter(l => l.account_date === today)
  const sum = (f: (l: (typeof lines)[number]) => number, rows = mine) => rows.reduce((a, l) => a + f(l), 0)
  const due = sum(l => Number(l.line.due), lines)
  // Today's attendance: on the register (approved or marked by the manager), or my own input waiting / returned.
  const rec = v?.att?.record ?? null, mark = v?.att?.mark ?? null
  const a = rec ? ATT[rec.status] ?? null : null
  const waiting = !rec && mark?.status === 'waiting' ? mark : null
  const returned = !rec && mark?.status === 'rejected' ? mark : null
  const clock = (t: string) => new Date(t).toLocaleTimeString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' })
  const attTitle = a ? L(a[0], a[1]) : waiting ? (waiting.kind === 'present' ? L('হাবে এসেছেন — অনুমোদন বাকি', 'At the hub — waiting for approval') : L('আজ আসবেন না — অনুমোদন বাকি', 'Not coming — waiting for approval'))
    : returned ? L('হাজিরা ফেরত দেওয়া হয়েছে', 'Attendance was returned') : L('আজকের হাজিরা এখনো দেননি', 'Not given yet today')
  const attSub = rec ? [rec.check_in && `${L('হাবে এসেছেন', 'Arrived')} ${clock(rec.check_in)}`,
      rec.source === 'self' ? `${L('অনুমোদন দিয়েছেন', 'Approved by')} ${mark?.decided_by_name ?? L('ম্যানেজার', 'manager')}` : L('হাব ম্যানেজার তুলেছেন', 'Marked by the hub manager')].filter(Boolean).join(' · ')
    : waiting ? (waiting.kind === 'present' ? `${L('দিয়েছেন', 'Given at')} ${clock(waiting.marked_at)} · ${L('হাব ম্যানেজার অনুমোদন দিলে খাতায় উঠবে', 'it counts once the hub manager approves')}` : `${L('কারণ', 'Reason')}: ${waiting.note ?? ''}`)
    : returned ? `${L('কারণ', 'Reason')}: ${returned.decide_note ?? ''} · ${L('আবার দিন', 'give it again')}` : L('হাবে এসে নিচের বোতাম চাপুন', 'Tap the button below when you reach the hub')
  const attTone = a?.[2] ?? (waiting ? 'w' : returned ? 'r' : 'w')
  const { toast, node } = useToast()
  const [busy, setBusy] = useState(false)
  const [absent, setAbsent] = useState<string | null>(null)
  const [attErr, setAttErr] = useState('')
  async function give(kind: 'present' | 'absent', note?: string) {
    setBusy(true); setAttErr('')
    try {
      await selfAtt.mark(kind, note); setAbsent(null); await d.reload()
      toast(kind === 'present' ? L('হাজিরা দেওয়া হয়েছে — ম্যানেজারের অনুমোদনের অপেক্ষায়', 'Given — waiting for the manager') : L('হাব ম্যানেজারকে জানানো হয়েছে', 'Your hub manager has been told'))
    } catch (e) { setAttErr(selfAttFriendly(e)) } finally { setBusy(false) }
  }
  const claims = v?.claims ?? []
  const waitingBills = claims.filter(c => (c.status ?? 'submitted') === 'submitted')
  const myIssues = (v?.panels?.mine ?? []).filter(i => i.status === 'open' || i.status === 'in_progress')
  const given = v?.panels?.given ?? []
  const unseen = (v?.groups ?? []).reduce((s, g) => s + g.unseen, 0)
  // My zone's group (the one I am posted in; else the only one I can open) and my zonal manager(s).
  const zoneList = v?.zones ?? []
  const myZone = zoneList.find(z => z.zone_id === v?.zm?.zone_id) ?? zoneList.find(z => z.mine) ?? (zoneList.length === 1 ? zoneList[0] : null)
  const zm = v?.zm ?? null
  const managers = (zm?.managers ?? []).filter(m => !m.is_me)
  const [zmOpen, setZmOpen] = useState(false)
  const people = (c: number) => (c ? L(`${n(c)} জন`, `${c} people`) : L('এখনো কেউ নেই', 'Nobody yet'))
  const desk = can('hr.request.create') ? null : '/app/hr/requests?tab=new&do='   // the plain-words staff desk; others keep these on their profile
  const canLeave = can('hr.leave.create') || can('hr.leave.view')

  const row = (to: string | null, tone: string, icon: string, title: string, sub: string, end?: ReactNode) => {
    if (to && !ok(to)) return null
    const body = <><span className={`nv-av sd-i ${tone}`}><Icon name={icon} size={22} /></span>
      <span className="tx"><b>{title}</b><span>{sub}</span></span>
      {end ?? (to ? <Icon name="chev" size={18} /> : <span className="sp-soon">{L('শীঘ্রই', 'Soon')}</span>)}</>
    return to ? <Link to={to} className="nv-row">{body}</Link> : <div className="nv-row none" aria-disabled="true">{body}</div>
  }
  const cnt = (c: number, tone: 'warn' | 'bad' | 'info' = 'warn') => c > 0 ? <span className="end"><Badge tone={tone}>{n(c)}</Badge></span> : undefined

  const act = (tone: string, icon: string, title: string, sub: string, onClick: () => void, disabled = false) =>
    <button type="button" className="nv-row" disabled={disabled} onClick={onClick}><span className={`nv-av sd-i ${tone}`}><Icon name={icon} size={22} /></span>
      <span className="tx"><b>{title}</b><span>{sub}</span></span><Icon name="chev" size={18} /></button>

  // The sections, by key: the Super Admin may hide some and change the order per role (রোল অনুযায়ী ড্যাশবোর্ড → স্টাফ প্যানেল).
  const SECTION: Record<StaffSection, () => ReactNode> = {
    accounts: () => <>
      <h2 className="sd-h">{L('আমার হিসাব', 'My accounts')}</h2>
      <div className="sp-tiles">
        <Link to="/app/accounts/mine" className="sp-tile t-b"><span className="i"><Icon name="box" size={20} /></span><b>{n(sum(l => l.line.pickup_qty))}</b><small>{L('আজকের পিকআপ', 'Pickups today')}</small></Link>
        <Link to="/app/accounts/mine" className="sp-tile t-g"><span className="i"><Icon name="truck" size={20} /></span><b>{n(sum(l => l.line.delivery_qty))}</b><small>{L('আজকের ডেলিভারি', 'Deliveries today')}</small></Link>
        {opsHere
          ? <a href="#wf-ops" className="sp-tile t-o" onClick={toOps}><span className="i"><Icon name="back" size={20} /></span><b>{returnsToday === null ? '—' : n(returnsToday)}</b><small>{L('আজকের রিটার্ন', 'Returns today')}</small></a>
          : <div className="sp-tile t-o off"><span className="i"><Icon name="back" size={20} /></span><b>—</b><small>{L('আজকের রিটার্ন', 'Returns today')}</small></div>}
        <Link to="/app/accounts/mine" className="sp-tile t-p"><span className="i"><Icon name="cash" size={20} /></span><b>{taka(sum(l => Number(l.line.amount)))}</b><small>{L('আজকের টাকা', 'Money today')}</small></Link>
      </div>
      <RiderSendCard onSent={() => d.reload()} />
      <div className="nv-rows">
        {row('/app/accounts/mine', 'g', 'wallet', L('আমার হিসাব', 'My accounts'), mine.length ? L('আজকের হিসাব খাতায় উঠেছে', "Today's line is on the sheet") : L('আজ এখনো আমার নামে হিসাব ওঠেনি', 'No line in my name yet today'))}
        {row('/app/accounts/mine', due > 0 ? 'o' : 'b', 'ledger', L('আমার আগের হিসাব', 'My earlier accounts'), due > 0 ? L(`৩০ দিনে বকেয়া ${taka(due)}`, `Due in 30 days ${taka(due)}`) : L('৭ দিন, ৩০ দিন, এ মাস বা তারিখ বেছে', '7 days, 30 days, this month or pick dates'))}
      </div>
    </>,
    work: () => <>
      {opsHere && <section id="wf-ops" className="wf-ops-sec">
        <h2 className="sd-h">{L('আজকের কাজের হিসাব', "Today's work count")}</h2>
        <DailyOpsCard />
      </section>}
    </>,
    attendance: () => <>
      <h2 className="sd-h">{L('আজকের হাজিরা', "Today's attendance")}</h2>
      <div className={`sp-card t-${attTone}`} id="sp-att">
        <span className="i"><Icon name={a ? 'check' : returned ? 'alert' : 'clock'} size={24} /></span>
        <div className="tx"><b>{attTitle}</b><span>{attSub}</span></div>
      </div>
      {attErr && <p className="da-error">{attErr}</p>}
      {!rec && <div className="nv-rows">
        {act('g', 'check', waiting?.kind === 'present' ? L('হাজিরা আবার দিন', 'Give it again') : L('হাবে এসেছি — হাজিরা দিই', 'I am at the hub — mark me'),
          L('চাপলেই হাজিরা যাবে, হাব ম্যানেজার অনুমোদন দেবেন', 'One tap; your hub manager approves it'), () => void give('present'), busy || !v?.me)}
        {wfOpen && v?.me
          ? row('/app/workforce/attendance?give=today', 'p', 'log', L('আজ আসব না — জানাই', 'Not coming — tell us'), L('ওয়েবসাইটে আবেদন করেছেন কি না জিজ্ঞেস করব, না করলে আবেদন পাঠাবেন', 'We ask if you applied on the website; if not, you send an application'))
          : act('p', 'log', L('আজ আসব না — কারণ জানাই', 'Not coming — give the reason'), L('কারণ লিখুন, হাব ম্যানেজার দেখবেন', 'Write the reason for your hub manager'),
            () => { setAttErr(''); setAbsent(waiting?.kind === 'absent' ? waiting.note ?? '' : '') }, busy || !v?.me)}
      </div>}
      {canLeave && ok('/app/hr/leave') && <div className="nv-rows">{row('/app/hr/leave', 'b', 'cal', L('ছুটির আবেদন', 'Apply for leave'), L('কয়েক দিনের ছুটি লাগলে এখান থেকে', 'For leave of one or more days'))}</div>}
      <NodiGaps />
    </>,
    bill: () => <>
      <h2 className="sd-h">{L('আমার বিল', 'My bill')}</h2>
      <Link to="/app/accounts/mine?bill=1" className="sp-cta"><Icon name="plus" size={20} />{L('আজকের খরচের বিল দিন', "Put up today's bill")}</Link>
      <div className="nv-rows">
        {claims.slice(0, 3).map(c => { const s = CLAIM[c.status ?? 'submitted'] ?? CLAIM.submitted
          return <Link key={c.id} to="/app/accounts/mine" className="nv-row">
            <span className="nv-av sd-i o"><Icon name="receipt" size={22} /></span>
            <span className="tx"><b>{c.expense_name}</b><span>{c.review_note ? `${L('ম্যানেজারের মন্তব্য', 'Manager')}: ${c.review_note}` : new Date(c.bill_date + 'T00:00:00').toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { day: 'numeric', month: 'short' })}</span></span>
            <span className="end"><b>{taka(Number(c.amount))}</b><Badge tone={s[2]}>{L(s[0], s[1])}</Badge></span></Link> })}
        {row('/app/accounts/mine', 'b', 'file', L('আমার সব বিল', 'All my bills'),
          claims.length ? L(`৩০ দিনে ${n(claims.length)}টি বিল · ${n(waitingBills.length)}টি অপেক্ষায়`, `${claims.length} bills in 30 days · ${waitingBills.length} waiting`) : L('এখনো কোনো বিল জমা দেননি', 'No bills put up yet'))}
      </div>
      <p className="muted small sd-note">{L('বিল আপনার হাবের খাতায় যায়। হাব ম্যানেজার দেখে খাতায় তুলে নেন, বা কারণ লিখে ফেরত দেন।', 'A bill goes to your hub’s sheet. The hub manager takes it in, or returns it with a reason.')}</p>
    </>,
    route: () => <>
      <h2 className="sd-h">{L('আমার রুট ও দায়িত্ব', 'My route & duties')}</h2>
      <div className="sp-two">
        <div className="sp-box"><h3><Icon name="map" size={16} />{L('আমার রুট', 'My route')}</h3>
          {routes.length ? routes.map((r, i) => <div key={i}><b>{r.name}</b><div className="myday-chips">{r.areas.slice(0, 12).map(x => <span key={x}>{x}</span>)}</div></div>)
            : <p className="muted small">{L('রুট দেওয়া হয়নি', 'No route given')}</p>}</div>
        <div className="sp-box"><h3><Icon name="tasks" size={16} />{L('আমার দায়িত্ব', 'My duties')}{duties.length ? <span className="cnt">{n(duties.length)}</span> : null}</h3>
          {duties.length ? <ul>{duties.slice(0, 6).map(x => <li key={x.id}>{x.title}</li>)}</ul>
            : <p className="muted small">{L('কোনো দায়িত্ব লেখা নেই', 'No duties written')}</p>}</div>
      </div>
      {routes.length > 0 && <MyRouteCard />}

      {(v?.car?.vehicles.length ?? 0) > 0 && <div className="nv-rows">{row('/app/fleet/mine', 'o', 'truck', `${L('আমার গাড়ি', 'My vehicle')} — ${v!.car!.vehicles[0].name}`,
        L('হাব রিপোর্ট, তেল/স্লিপ, সার্ভিস রিকুইজিশন, গ্যারেজ বিল ও খরচ', 'Hub report, fuel slip, service request, garage bills and costs'))}</div>}
    </>,
    complaint: () => <>
      {ok('/app/issues') && <>
      <h2 className="sd-h">{L('আমার অভিযোগ', 'My complaint')}</h2>
      <div className="nv-rows">
        {row('/app/issues?new=1', 'r', 'alert', L('অভিযোগ জানান', 'Make a complaint'), L('লিখে বা ছবি দিয়ে — হাবের ইস্যু হিসেবে যাবে', 'Write it or add a photo — it goes in as a hub issue'))}
        {row('/app/issues?tab=given', 'b', 'eye', L('আমি যা জানিয়েছি', 'What I reported'), given.length ? L(`${n(given.length)}টি চলছে`, `${given.length} open`) : L('এখন কিছু চলছে না', 'Nothing open now'))}
      </div>
      </>}
    </>,
    issues: () => <>
      <h2 className="sd-h">{L('ইস্যু ও যোগাযোগ', 'Issues & contact')}</h2>
      <div className="nv-rows">
        {row('/app/issues?tab=mine', 'o', 'tasks', L('আমাকে দেওয়া ইস্যু', 'Issues given to me'), myIssues.length ? L(`${n(myIssues.length)}টি কাজ বাকি`, `${myIssues.length} to do`) : L('কোনো কাজ বাকি নেই', 'Nothing to do'), cnt(myIssues.length, myIssues.some(i => i.overdue) ? 'bad' : 'warn'))}
        {row('/app/issues?tab=group', 'g', 'hub', L('হাব গ্রুপ', 'Hub group'), unseen ? L(`${n(unseen)}টি নতুন মেসেজ`, `${unseen} new messages`) : L('হাবের সবার সাথে কথা', 'Talk with everyone at the hub'), cnt(unseen, 'info'))}
        {myZone
          ? row(`/app/issues?tab=zone&z=${myZone.zone_id}`, 'b', 'map', L(`জোন গ্রুপ — ${myZone.zone_name}`, `Zone group — ${myZone.zone_name}`),
            myZone.unseen ? L(`${n(myZone.unseen)}টি নতুন মেসেজ`, `${myZone.unseen} new messages`) : L(`জোনের ${n(myZone.hubs)}টি হাবের সবার সাথে কথা`, `Talk with all ${myZone.hubs} hubs of the zone`), cnt(myZone.unseen, 'info'))
          : row(null, 'b', 'map', L('জোন গ্রুপ', 'Zone group'), L('আপনার প্রোফাইলে কোনো জোন নেই', 'No zone on your profile'), <span className="sp-soon">{L('নেই', 'None')}</span>)}
        {zm
          ? act('p', 'phone', managers.length === 1 ? `${L('জোনাল ম্যানেজার', 'Zonal manager')} — ${managers[0].full_name}` : L('জোনাল ম্যানেজার', 'Zonal manager'),
            managers.length ? L('ফোন, SMS, WhatsApp বা লিখে সরাসরি জানান', 'Call, SMS, WhatsApp or write to them directly') : L(`${zm.zone_name}-এ এখনো কোনো জোনাল ম্যানেজার দেওয়া নেই`, `No zonal manager set for ${zm.zone_name} yet`),
            () => setZmOpen(true))
          : row(null, 'p', 'phone', L('জোনাল ম্যানেজার', 'Zonal manager'), L('আপনার প্রোফাইলে কোনো জোন নেই', 'No zone on your profile'), <span className="sp-soon">{L('নেই', 'None')}</span>)}
      </div>
    </>,
    people: () => <>
      {ok(desk ? desk + 'hand' : '/app/me') && <>
      <h2 className="sd-h">{L('আমার লোক', 'My people')}</h2>
      <div className="nv-rows">
        {row(desk ? desk + 'hand' : '/app/me', 'b', 'plus', L('আমার হাতে লোক আছে', 'I have people in hand'), `${L('কাজ করতে চায় এমন কারো নাম দিন', 'Add someone who wants work')} · ${people(v?.hand ?? 0)}`)}
        {row(desk ? desk + 'brought' : '/app/me', 'g', 'users', L('আমি যাদের দিয়েছি', 'People I brought'), `${L('আমার আনা লোকের তালিকা', 'Who joined through me')} · ${people(v?.brought ?? 0)}`)}
      </div>
      </>}
    </>,
  }
  return <AppShell title={L('স্টাফ প্যানেল', 'Staff panel')} subtitle={who || L('আমার আজকের সব কাজ এক জায়গায়', 'My whole day in one place')}>
    <div className="sd sp">
      {node}
      <div className="sp-hero">
        <MyAvatarUpload className="sp-av" onDone={m => { toast(m); void d.reload() }} />
        <Link to="/app/me" className="tx"><small>{day}</small><b>{name}</b>{who && <span>{who}</span>}</Link>
        <span className={`sp-att t-${attTone}`}><Icon name={a ? 'check' : 'clock'} size={15} />{a ? L(a[0], a[1]) : waiting ? L('অনুমোদন বাকি', 'Waiting') : L('হাজিরা বাকি', 'Not marked')}</span>
      </div>
      <div className="wf-under"><PersonalMenu variant="card" /><WorkforceAlerts /></div>
      {d.loading && !v && <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>}
      {profilePct !== null && profilePct < 100 && <Link to="/app/me/complete" className="sp-card t-w mpc-nudge">
        <span className="i"><Icon name="user" size={24} /></span>
        <div className="tx"><b>{L(`আমার প্রোফাইল ${n(profilePct)}% পূর্ণ — বাকিটা দিন`, `My profile is ${profilePct}% complete — finish it`)}</b>
          <span>{L('ছবি, এনআইডি, জরুরি যোগাযোগ — নিজেই দিন, সাথে সাথে সেভ হবে', 'Photo, NID, emergency contact — add them yourself, they save at once')}</span></div>
        <Icon name="chev" size={18} /></Link>}

      {order.map(k => <Fragment key={k}>{SECTION[k]()}</Fragment>)}
      {zmOpen && zm && <ZonalManagerSheet zm={zm} onClose={() => setZmOpen(false)} onSent={k => { setZmOpen(false); toast(L(`জোনাল ম্যানেজারকে জানানো হয়েছে${k > 1 ? ` (${n(k)} জন)` : ''}`, `Sent to the zonal manager${k > 1 ? ` (${k})` : ''}`)); void d.reload() }} />}
      {absent !== null && <Modal title={L('আজ আসব না', 'Not coming today')} onClose={() => setAbsent(null)}
        actions={<><button className="secondary" onClick={() => setAbsent(null)}>{L('বাতিল', 'Cancel')}</button>
          <button disabled={busy || !absent.trim()} onClick={() => void give('absent', absent.trim())}>{busy ? L('পাঠানো হচ্ছে…', 'Sending…') : L('জানিয়ে দিন', 'Send')}</button></>}>
        <Field label={L('কেন আসছেন না *', 'Why are you not coming *')}><textarea id="sp-absent" rows={3} autoFocus value={absent} placeholder={L('যেমন: জ্বর, ডাক্তার দেখাতে যাচ্ছি', 'e.g. fever, going to the doctor')} onChange={e => setAbsent(e.target.value)} /></Field>
        <p className="muted small">{L('হাব ম্যানেজার অনুমোদন দিলে আজ "অনুপস্থিত" হিসেবে খাতায় উঠবে।', 'Once your hub manager approves, today goes on the register as absent.')}</p>
        {attErr && <p className="da-error">{attErr}</p>}
      </Modal>}
    </div>
    <AppDownloadCard />
  </AppShell>
}

/** Phone number as WhatsApp wants it: 01XXXXXXXXX → 8801XXXXXXXXX. */
const waNumber = (p: string) => { const d = p.replace(/\D/g, ''); return d.startsWith('880') ? d : d.startsWith('0') ? '88' + d : d }

/** The zonal manager(s) of my zone: call, SMS, WhatsApp, or a written note that reaches them as a notification. */
function ZonalManagerSheet({ zm, onClose, onSent }: { zm: ZoneContacts; onClose: () => void; onSent: (k: number) => void }) {
  const { L } = usePrefs()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const list = zm.managers.filter(m => !m.is_me)
  const canWrite = list.some(m => m.has_login)
  async function send() {
    setBusy(true); setErr('')
    try { onSent(await issues.tellZoneManager(zm.zone_id, text.trim())) }
    catch (e) { setErr(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)) } finally { setBusy(false) }
  }
  return <Modal title={`${L('জোনাল ম্যানেজার', 'Zonal manager')} — ${zm.zone_name}`} onClose={onClose}
    actions={<>{canWrite && <button disabled={busy || text.trim().length < 2} onClick={() => void send()}>{busy ? L('পাঠানো হচ্ছে…', 'Sending…') : L('লিখে পাঠান', 'Send note')}</button>}
      <button className="secondary" onClick={onClose}>{L('বন্ধ', 'Close')}</button></>}>
    {!list.length && <p className="notice small">{L('এই জোনে এখনো কোনো জোনাল ম্যানেজার দেওয়া নেই। হাব ম্যানেজারকে বা হেড অফিসে জানান।', 'No zonal manager is set for this zone yet. Tell your hub manager or head office.')}</p>}
    <div className="nv-rows">
      {list.map((m, i) => <div key={i} className="nv-row zm-card">
        <span className="nv-av sd-i p"><Icon name="user" size={22} /></span>
        <span className="tx"><b>{m.full_name}{m.employee_code ? ` · ${m.employee_code}` : ''}</b><span>{[m.position, m.phone].filter(Boolean).join(' · ') || L('ফোন নম্বর দেওয়া নেই', 'No phone number')}</span></span>
        {m.phone && <span className="zm-acts">
          <a className="btn-ghost sm" href={`tel:${m.phone}`} aria-label={L('ফোন করুন', 'Call')}><Icon name="phone" size={16} /> {L('কল', 'Call')}</a>
          <a className="btn-ghost sm" href={`sms:${m.phone}`}>SMS</a>
          <a className="btn-ghost sm" href={`https://wa.me/${waNumber(m.phone)}`} target="_blank" rel="noreferrer">WhatsApp</a></span>}
      </div>)}
    </div>
    {canWrite && <Field label={L('লিখে জানান', 'Write to them')} hint={L('জোনাল ম্যানেজারের নোটিফিকেশনে যাবে, আপনার নাম ও হাবসহ', 'Goes to their notifications with your name and hub')}>
      <textarea rows={3} maxLength={500} value={text} onChange={e => setText(e.target.value)} placeholder={L('যেমন: হাবে আজ ৩ জন রাইডার কম, পার্সেল জমে আছে', 'e.g. three riders short today, parcels piling up')} /></Field>}
    {zm.sent_today > 0 && <p className="muted small">{L(`গত ২৪ ঘণ্টায় ${zm.sent_today}টি বার্তা পাঠিয়েছেন`, `${zm.sent_today} notes sent in the last 24 hours`)}</p>}
    {err && <p className="da-error">{err}</p>}
  </Modal>
}
