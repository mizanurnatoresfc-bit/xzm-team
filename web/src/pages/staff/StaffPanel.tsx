import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { pageAllowed } from '../../lib/menu'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { AttendanceGaps } from '../../components/AttendanceGaps'
import { HubCarRoute } from '../../components/HubCarRoute'
import { PeopleSheet } from '../../components/PeopleSheet'
import { DailyOpsCard } from '../../components/DailyOpsCard'
import { PersonalMenu, useWfCounts } from '../../components/PersonalMenu'
import { WorkforceAlerts } from '../../components/WorkforceAlerts'
import { RiderSendCard } from '../../components/RiderQuick'
import { da, addDays, todayDhaka, type Claim } from '../../lib/dailyAccounts'
import { dashboard } from '../../lib/dashboard'
import { referrals } from '../../lib/extra'
import { dutiesApi } from '../../lib/hub'
import { hrReq } from '../../lib/hrreq'
import { hr } from '../../lib/hr'
import { issues } from '../../lib/issues'
import { usePrefs } from '../../lib/prefs'
import { supabase } from '../../lib/supabase'
import { fleet } from '../../lib/fleet'
import { useLiveLoad, wf } from '../../lib/workforce'
import { selfAtt, selfAttFriendly, type MyAttToday } from '../../lib/selfAtt'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'

/**
 * স্টাফ প্যানেল — one phone screen for a staff member's own day, in the order the owner asked for:
 * my accounts, today's attendance, my bill, my route and duties, my complaint, issues and contact, my people.
 * It only reads what the person may already see and links into the pages that do the work; nothing new is stored.
 * A row marked "শীঘ্রই" has no database behind it yet.
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
    const [acc, claims, panels, groups, att, duties, routes, hand, brought, car] = await Promise.all([
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
    ])
    return { home, me, acc, claims, panels, groups, att, duties, routes, hand, brought, car }
  }, [])
  const v = d.data
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
  const moneyToday = sum(l => Number(l.line.amount))
  const week = Array.from({ length: 7 }, (_, i) => { const dd = addDays(today, i - 6); return lines.filter(l => l.account_date === dd).reduce((a, l) => a + Number(l.line.amount), 0) })
  const weekMax = Math.max(1, ...week)
  const pickToday = sum(l => l.line.pickup_qty), delToday = sum(l => l.line.delivery_qty)
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
  const [hideAmt, setHideAmt] = useState(() => { try { return localStorage.getItem('xzm_hide_amt') !== '0' } catch { return true } })
  const toggleAmt = () => setHideAmt(h => { const v = !h; try { localStorage.setItem('xzm_hide_amt', v ? '1' : '0') } catch { /* ignore */ } return v })
  const [nudgeOff, setNudgeOff] = useState(() => { try { return sessionStorage.getItem('xzm_nudge_off') === '1' } catch { return false } })
  const [people, setPeople] = useState<'hand' | 'gave' | null>(null)
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

  return <AppShell title={L('স্টাফ প্যানেল', 'Staff panel')} subtitle={who || L('আমার আজকের সব কাজ এক জায়গায়', 'My whole day in one place')}>
    <div className="sd sp">
      {node}
      {!rec && !waiting && <div className="sp-alert r" role="alert">
        <span className="ai"><Icon name={returned ? 'alert' : 'clock'} size={24} /></span>
        <div><b>{returned ? L('হাজিরা ফেরত দেওয়া হয়েছে', 'Attendance was returned') : L('আজকের হাজিরা এখনো দেননি', 'Attendance not given yet')}</b>
          <p>{returned ? `${L('কারণ', 'Reason')}: ${returned.decide_note ?? ''}` : L('হাবে এসে হাজিরা দিন, নইলে আজ অনুপস্থিত ধরা হতে পারে।', 'Give it at the hub, or today may count as absent.')}</p>
          <div className="ab"><button type="button" className="gbtn" disabled={busy || !v?.me} onClick={() => void give('present')}><Icon name="check" size={17} />{L('হাজিরা দিন', 'Give attendance')}</button>
            <button type="button" className="gbtn ghost" disabled={busy || !v?.me} onClick={() => { setAttErr(''); setAbsent('') }}>{L('আজ আসব না', 'Not coming')}</button></div></div></div>}
      {profilePct !== null && profilePct < 100 && !nudgeOff && <div className="sp-alert y">
        <span className="ai"><Icon name="user" size={24} /></span>
        <div><b>{L(`আপনার প্রোফাইল ${n(profilePct)}% পূর্ণ`, `Your profile is ${profilePct}% complete`)}</b>
          <p>{L('ছবি, এনআইডি ও জরুরি যোগাযোগ নিজেই দিন — সাথে সাথে সেভ হবে।', 'Add photo, NID and emergency contact yourself — it saves at once.')}</p>
          <div className="ab"><Link to="/app/me/complete" className="gbtn">{L('প্রোফাইল পূর্ণ করুন', 'Complete profile')}</Link>
            <button type="button" className="gbtn ghost" onClick={() => { setNudgeOff(true); try { sessionStorage.setItem('xzm_nudge_off', '1') } catch { /* ignore */ } }}>{L('এখন নয়', 'Not now')}</button></div></div></div>}

      <div className="sp-date">{day}</div>
      <Link to="/app/me" className="sp-hello">{L('স্বাগতম', 'Welcome')}, {name}</Link>
      {who && <div className="sp-who">{who}</div>}
      <div className="sp-two2">
        {ok('/app/accounts/mine') && <Link to="/app/accounts/mine?bill=1" className="gbtn"><Icon name="plus" size={19} />{L('বিল দিন', 'Put up a bill')}</Link>}
        {canLeave && ok('/app/hr/leave') ? <Link to="/app/hr/leave" className="gbtn out"><Icon name="cal" size={19} />{L('ছুটির আবেদন', 'Apply for leave')}</Link>
          : ok('/app/workforce/attendance') ? <Link to="/app/workforce/attendance" className="gbtn out"><Icon name="cal" size={19} />{L('আমার উপস্থিতি', 'My attendance')}</Link> : <span />}
      </div>

      {/* the wallet card: today's account, hidden until the eye is tapped */}
      <section className="sp-wal" aria-label={L('আজকের হিসাব', "Today's account")}>
        <i className="ring" /><i className="ring r2" /><i className="ring r3" />
        <div className="row"><span className="k"><Icon name="wallet" size={22} />{L('আজকের হিসাব', "Today's account")}</span><span className="chipg">BDT</span></div>
        <div className="amt"><b>{hideAmt ? '৳ ●●●●●●' : taka(moneyToday)}</b>
          <button type="button" className="eye" onClick={toggleAmt} aria-pressed={!hideAmt} aria-label={hideAmt ? L('টাকা দেখান', 'Show amount') : L('টাকা লুকান', 'Hide amount')}><Icon name={hideAmt ? 'eye' : 'eyeoff'} size={22} /></button></div>
        <div className="wk" role="img" aria-label={L('গত ৭ দিনের টাকা', 'Money, last 7 days')}>{week.map((x, i) => <i key={i} style={{ height: `${Math.max(8, (x / weekMax) * 100)}%` }} />)}</div>
        <hr />
        <div className="row small"><span className="muted">{L('হাবে জমা দিতে হবে', 'To hand over at the hub')}</span><b>{hideAmt ? '৳ ●●●' : taka(moneyToday)} · {n(delToday)} {L('ডেলিভারি', 'deliveries')}</b></div>
        <div className="mb">
          <Link to="/app/accounts/mine" className="c1"><small>{L('পিকআপ', 'Pickups')}</small><b>{n(pickToday)}</b></Link>
          <Link to={ok('/app/me') ? '/app/me' : '/app/staff'} className="rt"><small>{L('আমার রুট', 'My route')}</small>
            <svg className="mini" viewBox="0 0 140 76" aria-hidden="true"><path d="M12 62 C30 52 36 24 62 30 S100 52 122 12" fill="none" stroke="var(--border)" strokeWidth="5" strokeLinecap="round" /><path d="M12 62 C30 52 36 24 62 30 S90 44 98 38" fill="none" stroke="var(--primary)" strokeWidth="5" strokeLinecap="round" /><circle cx="12" cy="62" r="6" fill="var(--text)" /><circle cx="98" cy="38" r="7" fill="var(--primary)" stroke="var(--surface)" strokeWidth="3" /><circle cx="122" cy="12" r="6" fill="none" stroke="var(--muted)" strokeWidth="3" /></svg>
            <span className="rn">{routes[0]?.name ?? L('রুট দেওয়া হয়নি', 'No route yet')}</span></Link>
          <Link to="/app/accounts/mine" className="c2"><small>{L('ডেলিভারি', 'Deliveries')}</small><b>{n(delToday)}</b></Link>
        </div>
        <div className="btns"><Link to="/app/accounts/mine" className="gbtn deep"><Icon name="receipt" size={18} />{L('হিসাবের বিস্তারিত', 'Details')}</Link>
          <Link to="/app/accounts/mine" className="gbtn out"><Icon name="ledger" size={18} />{due > 0 ? L(`বকেয়া ${taka(due)}`, `Due ${taka(due)}`) : L('আগের হিসাব', 'Earlier')}</Link></div>
      </section>
      <RiderSendCard onSent={() => d.reload()} />

      <HubCarRoute level="staff" />

      {ok(desk ? desk + 'hand' : '/app/me') && <>
      <h2 className="sd-h">{L('আমার লোক', 'My people')}</h2>
      <div className="sp-ppl">
        {([['hand', 'plus', v?.hand ?? 0, L('আমার হাতে লোক আছে', 'People I have in hand'), L('কাজ করতে চায় এমন কারো নাম দিন', 'Add someone who wants work'), 'hand'],
          ['gave', 'users', v?.brought ?? 0, L('আমি যাদের দিয়েছি', 'People I brought'), L('আমার আনা লোকের তালিকা', 'Who joined through me'), 'brought']] as const).map(([k, ic, cnt, t, sub, dk]) =>
          v?.me ? <button key={k} type="button" className="pc" onClick={() => setPeople(k)}><span className="i"><Icon name={ic} size={20} /></span><b>{n(cnt)}</b><span className="t">{t}</span><span className="s">{sub}</span></button>
            : <Link key={k} to={desk ? desk + dk : '/app/me'} className="pc"><span className="i"><Icon name={ic} size={20} /></span><b>{n(cnt)}</b><span className="t">{t}</span><span className="s">{sub}</span></Link>)}
      </div>
      </>}

      <div className="wf-under"><PersonalMenu variant="card" /><WorkforceAlerts /></div>
      {d.loading && !v && <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>}
      {profilePct !== null && profilePct < 100 && <Link to="/app/me/complete" className="sp-card t-w mpc-nudge">
        <span className="i"><Icon name="user" size={24} /></span>
        <div className="tx"><b>{L(`আমার প্রোফাইল ${n(profilePct)}% পূর্ণ — বাকিটা দিন`, `My profile is ${profilePct}% complete — finish it`)}</b>
          <span>{L('ছবি, এনআইডি, জরুরি যোগাযোগ — নিজেই দিন, সাথে সাথে সেভ হবে', 'Photo, NID, emergency contact — add them yourself, they save at once')}</span></div>
        <Icon name="chev" size={18} /></Link>}

      <h2 className="sd-h">{L('আমার হিসাব', 'My accounts')}</h2>
      <div className="nv-rows">
        {row('/app/accounts/mine', 'g', 'wallet', L('আমার হিসাব', 'My accounts'), mine.length ? L('আজকের হিসাব খাতায় উঠেছে', "Today's line is on the sheet") : L('আজ এখনো আমার নামে হিসাব ওঠেনি', 'No line in my name yet today'))}
        {row('/app/accounts/mine', due > 0 ? 'o' : 'b', 'ledger', L('আমার আগের হিসাব', 'My earlier accounts'), due > 0 ? L(`৩০ দিনে বকেয়া ${taka(due)}`, `Due in 30 days ${taka(due)}`) : L('৭ দিন, ৩০ দিন, এ মাস বা তারিখ বেছে', '7 days, 30 days, this month or pick dates'))}
      </div>

      {opsHere && <section id="wf-ops" className="wf-ops-sec">
        <h2 className="sd-h">{L('আজকের কাজের হিসাব', "Today's work count")}</h2>
        <DailyOpsCard />
      </section>}

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
      {people && v?.me && <PeopleSheet mode={people} employee={v.me.id} onClose={() => setPeople(null)} onChanged={() => void d.reload()} />}
      {absent !== null && <Modal title={L('আজ আসব না', 'Not coming today')} onClose={() => setAbsent(null)}
        actions={<><button className="secondary" onClick={() => setAbsent(null)}>{L('বাতিল', 'Cancel')}</button>
          <button disabled={busy || !absent.trim()} onClick={() => void give('absent', absent.trim())}>{busy ? L('পাঠানো হচ্ছে…', 'Sending…') : L('জানিয়ে দিন', 'Send')}</button></>}>
        <Field label={L('কেন আসছেন না *', 'Why are you not coming *')}><textarea id="sp-absent" rows={3} autoFocus value={absent} placeholder={L('যেমন: জ্বর, ডাক্তার দেখাতে যাচ্ছি', 'e.g. fever, going to the doctor')} onChange={e => setAbsent(e.target.value)} /></Field>
        <p className="muted small">{L('হাব ম্যানেজার অনুমোদন দিলে আজ "অনুপস্থিত" হিসেবে খাতায় উঠবে।', 'Once your hub manager approves, today goes on the register as absent.')}</p>
        {attErr && <p className="da-error">{attErr}</p>}
      </Modal>}
      <AttendanceGaps />

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

      <h2 className="sd-h">{L('আমার রুট ও দায়িত্ব', 'My route & duties')}</h2>
      <div className="sp-two">
        <div className="sp-box"><h3><Icon name="map" size={16} />{L('আমার রুট', 'My route')}</h3>
          {routes.length ? routes.map((r, i) => <div key={i}><b>{r.name}</b><div className="myday-chips">{r.areas.slice(0, 12).map(x => <span key={x}>{x}</span>)}</div></div>)
            : <p className="muted small">{L('রুট দেওয়া হয়নি', 'No route given')}</p>}</div>
        <div className="sp-box"><h3><Icon name="tasks" size={16} />{L('আমার দায়িত্ব', 'My duties')}{duties.length ? <span className="cnt">{n(duties.length)}</span> : null}</h3>
          {duties.length ? <ul>{duties.slice(0, 6).map(x => <li key={x.id}>{x.title}</li>)}</ul>
            : <p className="muted small">{L('কোনো দায়িত্ব লেখা নেই', 'No duties written')}</p>}</div>
      </div>

      {ok('/app/issues') && <>
      <h2 className="sd-h">{L('আমার অভিযোগ', 'My complaint')}</h2>
      <div className="nv-rows">
        {row('/app/issues?new=1', 'r', 'alert', L('অভিযোগ জানান', 'Make a complaint'), L('লিখে বা ছবি দিয়ে — হাবের ইস্যু হিসেবে যাবে', 'Write it or add a photo — it goes in as a hub issue'))}
        {row('/app/issues?tab=given', 'b', 'eye', L('আমি যা জানিয়েছি', 'What I reported'), given.length ? L(`${n(given.length)}টি চলছে`, `${given.length} open`) : L('এখন কিছু চলছে না', 'Nothing open now'))}
      </div>
      </>}

      <>
      <h2 className="sd-h">{L('আরও কাজ', 'More work')}</h2>
      <div className="nv-rows">
        {can('office.notice.create') && row('/app/office/notices', 'r', 'bell', L('নষ্ট / লাগবে জানান', 'Report broken / needed'), L('অফিসের নষ্ট বা দরকারি জিনিস জোনাল ম্যানেজারকে জানান', 'Tell the zonal manager what is broken or needed'))}
        {(can('sorting.fuel.view') || can('sorting.fuel.create')) && row('/app/sorting/fuel', 'o', 'receipt', L('তেলের স্লিপ ও খরচ', 'Fuel slips & expenses'), L('তেলের স্লিপ ও খরচের রিকুয়েস্ট', 'Fuel slips and expense requests'))}
        {(can('sorting.driver.view') || can('sorting.driver.create')) && row('/app/sorting/drivers', 'p', 'truck', L('ড্রাইভার রিপোর্ট', 'Driver report'), L('আজকের ট্রিপের রিপোর্ট দিন', "Give today's trip report"))}
        {(can('sorting.parcel.view') || can('sorting.parcel.create')) && row('/app/sorting/parcels', 'b', 'box', L('পার্সেল আদান-প্রদান', 'Parcel handover'), L('শটিং ও হাবের মধ্যে পার্সেল বুঝে নেওয়া ও দেওয়া', 'Receive and hand over parcels'))}
        {row('/app/references', 'g', 'users', L('রেফারেন্স তালিকা', 'Reference list'), L('যাঁদের রেফারেন্স দিয়েছেন', 'People you gave as reference'))}
        {row('/app/training', 'b', 'book', L('ট্রেনিং সেন্টার', 'Training centre'), L('আপনার কাজের ধাপে ধাপে নির্দেশনা', 'Step-by-step help for your work'))}
        {row('/app/me/permissions', 'p', 'shield', L('আমার অনুমতি', 'My permissions'), L('আমি কী কী করতে পারি', 'What I may do'))}
      </div>
      </>

      <h2 className="sd-h">{L('ইস্যু ও যোগাযোগ', 'Issues & contact')}</h2>
      <div className="nv-rows">
        {row('/app/issues?tab=mine', 'o', 'tasks', L('আমাকে দেওয়া ইস্যু', 'Issues given to me'), myIssues.length ? L(`${n(myIssues.length)}টি কাজ বাকি`, `${myIssues.length} to do`) : L('কোনো কাজ বাকি নেই', 'Nothing to do'), cnt(myIssues.length, myIssues.some(i => i.overdue) ? 'bad' : 'warn'))}
        {row('/app/issues?tab=group', 'g', 'hub', L('হাব গ্রুপ', 'Hub group'), unseen ? L(`${n(unseen)}টি নতুন মেসেজ`, `${unseen} new messages`) : L('হাবের সবার সাথে কথা', 'Talk with everyone at the hub'), cnt(unseen, 'info'))}
        {row(null, 'b', 'map', L('জোন গ্রুপ', 'Zone group'), L('জোনের সব হাবের গ্রুপ', 'The group for every hub in the zone'))}
        {row(null, 'p', 'phone', L('জোনাল ম্যানেজার', 'Zonal manager'), L('সরাসরি জোনাল ম্যানেজারকে জানান', 'Reach the zonal manager directly'))}
      </div>

    </div>
  </AppShell>
}
