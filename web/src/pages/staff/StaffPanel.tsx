import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { NodiGaps } from '../../components/NodiGaps'
import { da, addDays, todayDhaka, type Claim } from '../../lib/dailyAccounts'
import { dashboard } from '../../lib/dashboard'
import { referrals } from '../../lib/extra'
import { dutiesApi } from '../../lib/hub'
import { hrReq } from '../../lib/hrreq'
import { issues } from '../../lib/issues'
import { usePrefs } from '../../lib/prefs'
import { supabase } from '../../lib/supabase'
import { Badge, useLoad } from '../accounts/ui'

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
  const { can, session } = useAuth()
  const today = todayDhaka()
  const d = useLoad(async () => {
    const [home, me] = await Promise.all([quiet(dashboard.home(), null), quiet(hrReq.myEmployee(), null)])
    const [acc, claims, panels, groups, att, duties, routes, hand, brought] = await Promise.all([
      quiet(da.myAccounts(addDays(today, -30), today), null),
      quiet(da.myClaims(30), [] as Claim[]),
      quiet(issues.panels(), null),
      quiet(issues.groupHubs(), []),
      me ? quiet(supabase.from('attendance_records').select('status, check_in').eq('employee_id', me.id).eq('work_date', today).maybeSingle()
        .then(r => r.data as { status: string; check_in: string | null } | null), null) : null,
      me ? quiet(dutiesApi.mine(me.id), []) : [],
      me ? quiet(supabase.from('rider_routes').select('hub_routes(name, areas)').eq('employee_id', me.id).is('effective_to', null)
        .then(r => ((r.data ?? []) as unknown as Array<{ hub_routes: { name: string; areas: string[] } | null }>).map(x => x.hub_routes).filter(Boolean) as Array<{ name: string; areas: string[] }>), []) : [],
      me ? quiet(referrals.prospects(me.id).then(x => x.length), 0) : 0,
      me ? quiet(referrals.brought(me.id).then(x => x.length), 0) : 0,
    ])
    return { home, me, acc, claims, panels, groups, att, duties, routes, hand, brought }
  }, [])
  const v = d.data
  const duties = v?.duties ?? [], routes = v?.routes ?? []   // a database function may answer null instead of an empty list
  const name = v?.home?.me?.name || v?.me?.full_name || session?.user.user_metadata?.full_name || L('স্টাফ', 'Staff')
  const who = [v?.home?.me?.employee_code && `${L('আইডি', 'ID')} ${v.home.me.employee_code}`, v?.home?.me?.position, v?.home?.me?.hub].filter(Boolean).join(' · ')
  const day = new Date().toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', weekday: 'long', day: 'numeric', month: 'long' })
  const taka = (x: number) => `৳ ${n(Math.round(x))}`

  const lines = v?.acc?.my_lines ?? []
  const mine = lines.filter(l => l.account_date === today)
  const sum = (f: (l: (typeof lines)[number]) => number, rows = mine) => rows.reduce((a, l) => a + f(l), 0)
  const due = sum(l => Number(l.line.due), lines)
  const a = v?.att ? ATT[v.att.status] : null
  const claims = v?.claims ?? []
  const waitingBills = claims.filter(c => (c.status ?? 'submitted') === 'submitted')
  const myIssues = (v?.panels?.mine ?? []).filter(i => i.status === 'open' || i.status === 'in_progress')
  const given = v?.panels?.given ?? []
  const unseen = (v?.groups ?? []).reduce((s, g) => s + g.unseen, 0)
  const people = (c: number) => (c ? L(`${n(c)} জন`, `${c} people`) : L('এখনো কেউ নেই', 'Nobody yet'))
  const desk = can('hr.request.create') ? null : '/app/hr/requests?tab=new&do='   // the plain-words staff desk; others keep these on their profile
  const canLeave = can('hr.leave.create') || can('hr.leave.view')

  const row = (to: string | null, tone: string, icon: string, title: string, sub: string, end?: ReactNode) => {
    const body = <><span className={`nv-av sd-i ${tone}`}><Icon name={icon} size={22} /></span>
      <span className="tx"><b>{title}</b><span>{sub}</span></span>
      {end ?? (to ? <Icon name="chev" size={18} /> : <span className="sp-soon">{L('শীঘ্রই', 'Soon')}</span>)}</>
    return to ? <Link to={to} className="nv-row">{body}</Link> : <div className="nv-row none" aria-disabled="true">{body}</div>
  }
  const cnt = (c: number, tone: 'warn' | 'bad' | 'info' = 'warn') => c > 0 ? <span className="end"><Badge tone={tone}>{n(c)}</Badge></span> : undefined

  return <AppShell title={L('স্টাফ প্যানেল', 'Staff panel')} subtitle={who || L('আমার আজকের সব কাজ এক জায়গায়', 'My whole day in one place')}>
    <div className="sd sp">
      <Link to="/app/me" className="sp-hero">
        <span className="nv-av">{String(name).slice(0, 1).toUpperCase()}</span>
        <span className="tx"><small>{day}</small><b>{name}</b>{who && <span>{who}</span>}</span>
        <span className={`sp-att t-${a?.[2] ?? 'w'}`}><Icon name={a ? 'check' : 'clock'} size={15} />{a ? L(a[0], a[1]) : L('হাজিরা বাকি', 'Not marked')}</span>
      </Link>
      {d.loading && !v && <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>}

      <h2 className="sd-h">{L('আমার হিসাব', 'My accounts')}</h2>
      <div className="sp-tiles">
        <Link to="/app/accounts/mine" className="sp-tile t-b"><span className="i"><Icon name="box" size={20} /></span><b>{n(sum(l => l.line.pickup_qty))}</b><small>{L('আজকের পিকআপ', 'Pickups today')}</small></Link>
        <Link to="/app/accounts/mine" className="sp-tile t-g"><span className="i"><Icon name="truck" size={20} /></span><b>{n(sum(l => l.line.delivery_qty))}</b><small>{L('আজকের ডেলিভারি', 'Deliveries today')}</small></Link>
        <div className="sp-tile t-o off"><span className="i"><Icon name="back" size={20} /></span><b>—</b><small>{L('আজকের রিটার্ন', 'Returns today')}</small><span className="sp-soon">{L('শীঘ্রই', 'Soon')}</span></div>
        <Link to="/app/accounts/mine" className="sp-tile t-p"><span className="i"><Icon name="cash" size={20} /></span><b>{taka(sum(l => Number(l.line.amount)))}</b><small>{L('আজকের টাকা', 'Money today')}</small></Link>
      </div>
      <div className="nv-rows">
        {row('/app/accounts/mine', 'g', 'wallet', L('আমার হিসাব', 'My accounts'), mine.length ? L('আজকের হিসাব খাতায় উঠেছে', "Today's line is on the sheet") : L('আজ এখনো আমার নামে হিসাব ওঠেনি', 'No line in my name yet today'))}
        {row('/app/accounts/mine', due > 0 ? 'o' : 'b', 'ledger', L('আমার আগের হিসাব', 'My earlier accounts'), due > 0 ? L(`৩০ দিনে বকেয়া ${taka(due)}`, `Due in 30 days ${taka(due)}`) : L('৭ দিন, ৩০ দিন, এ মাস বা তারিখ বেছে', '7 days, 30 days, this month or pick dates'))}
      </div>

      <h2 className="sd-h">{L('আজকের হাজিরা', "Today's attendance")}</h2>
      <div className={`sp-card t-${a?.[2] ?? 'w'}`}>
        <span className="i"><Icon name={a ? 'check' : 'clock'} size={24} /></span>
        <div className="tx"><b>{a ? L(a[0], a[1]) : L('আজকের হাজিরা এখনো ওঠেনি', 'Not marked yet today')}</b>
          <span>{v?.att?.check_in ? `${L('হাবে এসেছেন', 'Arrived')} · ${new Date(v.att.check_in).toLocaleTimeString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' })}`
            : a ? L('হাব ম্যানেজার হাজিরা তুলেছেন', 'Marked by the hub manager') : L('হাবে এলে হাব ম্যানেজার হাজিরা তুলবেন', 'The hub manager marks it when you arrive')}</span></div>
      </div>
      <div className="nv-rows">
        {row(null, 'g', 'check', L('হাবে এসেছি — হাজিরা দিই', 'I am at the hub — mark me'), L('নিজে হাজিরা দেওয়া এখনো চালু হয়নি', 'Marking yourself is not switched on yet'))}
        {canLeave ? row('/app/hr/leave', 'p', 'log', L('আজ আসিনি — ছুটির আবেদন', 'Not coming — ask for leave'), L('কারণ লিখে ছুটির আবেদন দিন', 'Write the reason and apply for leave'))
          : row(null, 'p', 'log', L('আজ আসিনি — কারণ জানাই', 'Not coming — give the reason'), L('হাব ম্যানেজারকে জানান', 'Tell your hub manager'), <span />)}
      </div>
      <NodiGaps />

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

      <h2 className="sd-h">{L('আমার অভিযোগ', 'My complaint')}</h2>
      <div className="nv-rows">
        {row('/app/issues?new=1', 'r', 'alert', L('অভিযোগ জানান', 'Make a complaint'), L('লিখে বা ছবি দিয়ে — হাবের ইস্যু হিসেবে যাবে', 'Write it or add a photo — it goes in as a hub issue'))}
        {row('/app/issues?tab=given', 'b', 'eye', L('আমি যা জানিয়েছি', 'What I reported'), given.length ? L(`${n(given.length)}টি চলছে`, `${given.length} open`) : L('এখন কিছু চলছে না', 'Nothing open now'))}
      </div>

      <h2 className="sd-h">{L('ইস্যু ও যোগাযোগ', 'Issues & contact')}</h2>
      <div className="nv-rows">
        {row('/app/issues?tab=mine', 'o', 'tasks', L('আমাকে দেওয়া ইস্যু', 'Issues given to me'), myIssues.length ? L(`${n(myIssues.length)}টি কাজ বাকি`, `${myIssues.length} to do`) : L('কোনো কাজ বাকি নেই', 'Nothing to do'), cnt(myIssues.length, myIssues.some(i => i.overdue) ? 'bad' : 'warn'))}
        {row('/app/issues?tab=group', 'g', 'hub', L('হাব গ্রুপ', 'Hub group'), unseen ? L(`${n(unseen)}টি নতুন মেসেজ`, `${unseen} new messages`) : L('হাবের সবার সাথে কথা', 'Talk with everyone at the hub'), cnt(unseen, 'info'))}
        {row(null, 'b', 'map', L('জোন গ্রুপ', 'Zone group'), L('জোনের সব হাবের গ্রুপ', 'The group for every hub in the zone'))}
        {row(null, 'p', 'phone', L('জোনাল ম্যানেজার', 'Zonal manager'), L('সরাসরি জোনাল ম্যানেজারকে জানান', 'Reach the zonal manager directly'))}
      </div>

      <h2 className="sd-h">{L('আমার লোক', 'My people')}</h2>
      <div className="nv-rows">
        {row(desk ? desk + 'hand' : '/app/me', 'b', 'plus', L('আমার হাতে লোক আছে', 'I have people in hand'), `${L('কাজ করতে চায় এমন কারো নাম দিন', 'Add someone who wants work')} · ${people(v?.hand ?? 0)}`)}
        {row(desk ? desk + 'brought' : '/app/me', 'g', 'users', L('আমি যাদের দিয়েছি', 'People I brought'), `${L('আমার আনা লোকের তালিকা', 'Who joined through me')} · ${people(v?.brought ?? 0)}`)}
      </div>
    </div>
  </AppShell>
}
