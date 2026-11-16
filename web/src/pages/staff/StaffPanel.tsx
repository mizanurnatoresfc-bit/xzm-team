import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { pageAllowed } from '../../lib/menu'
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
import { fleet } from '../../lib/fleet'
import { selfAtt, selfAttFriendly, type MyAttToday } from '../../lib/selfAtt'
import { distText, getFix, PLACE, presence, type Presence } from '../../lib/presence'
import { daily, dailyFriendly, type MyDay } from '../../lib/daily'
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
    const [acc, claims, panels, groups, att, duties, routes, hand, brought, car, myDay] = await Promise.all([
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
      quiet(daily.myDay(), null as MyDay),
    ])
    return { home, me, acc, claims, panels, groups, att, duties, routes, hand, brought, car, myDay }
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
  const [locating, setLocating] = useState(false)
  const [here, setHere] = useState<Presence | null | 'none'>(null)
  async function give(kind: 'present' | 'absent', note?: string) {
    setBusy(true); setAttErr('')
    try {
      // "হাবে এসেছি" carries the phone's location (Wi-Fi or mobile data) so the manager sees whether the person is at the hub.
      let fix = null
      if (kind === 'present') { setLocating(true); fix = await getFix(); setLocating(false) }
      await selfAtt.mark(kind, note, fix); setAbsent(null); await d.reload()
      toast(kind === 'present' ? L('হাজিরা দেওয়া হয়েছে — ম্যানেজারের অনুমোদনের অপেক্ষায়', 'Given — waiting for the manager') : L('হাব ম্যানেজারকে জানানো হয়েছে', 'Your hub manager has been told'))
    } catch (e) { setAttErr(selfAttFriendly(e)) } finally { setBusy(false); setLocating(false) }
  }
  async function whereAmI() {
    setBusy(true); setAttErr(''); setLocating(true)
    try { const fix = await getFix(); setLocating(false); setHere((await presence.check(fix)) ?? 'none') }
    catch (e) { setAttErr(selfAttFriendly(e)) } finally { setBusy(false); setLocating(false) }
  }
  const placeLine = (st: string | null | undefined, dist: number | null | undefined, wifi: boolean | undefined) => {
    const p = st ? PLACE[st as keyof typeof PLACE] : null
    if (!p && !wifi) return null
    return <span className="place-line">{p && <span className={`place-chip t-${p[2]}`}><Icon name="map" size={13} />{L(p[0], p[1])}{dist != null && st !== 'at_hub' ? ` · ${distText(dist, L, n)}` : ''}</span>}
      {wifi && <span className="place-chip t-ok"><Icon name="globe" size={13} />{L('হাবের ওয়াইফাই', 'Hub Wi-Fi')}</span>}</span>
  }
  // Today's work note and suggestion (goes to the zonal manager's midnight report).
  const [dn, setDn] = useState<{ work: string; suggestion: string } | null>(null)
  const [dnMsg, setDnMsg] = useState('')
  useEffect(() => { const x = v?.myDay?.note; setDn({ work: x?.work ?? '', suggestion: x?.suggestion ?? '' }) }, [v?.myDay])
  async function saveNote() {
    if (!dn) return
    setBusy(true); setDnMsg('')
    try { await daily.saveMyDay(dn.work, dn.suggestion); await d.reload(); toast(L('সেভ হয়েছে — রাত ১২টার রিপোর্টে যাবে', 'Saved — it goes in the midnight report')) }
    catch (e) { setDnMsg(dailyFriendly(e)) } finally { setBusy(false) }
  }
  const [cu, setCu] = useState<{ id: string; delivered: string } | null>(null)
  async function coverDone() {
    if (!cu || cu.delivered.trim() === '') return
    setBusy(true); setDnMsg('')
    try { await daily.coverUpdate(cu.id, Number(cu.delivered), null); setCu(null); await d.reload(); toast(L('ডেলিভারি জানানো হয়েছে', 'Delivery sent')) }
    catch (e) { setDnMsg(dailyFriendly(e)) } finally { setBusy(false) }
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
      <Link to="/app/me" className="sp-hero">
        <span className="nv-av">{String(name).slice(0, 1).toUpperCase()}</span>
        <span className="tx"><small>{day}</small><b>{name}</b>{who && <span>{who}</span>}</span>
        <span className={`sp-att t-${attTone}`}><Icon name={a ? 'check' : 'clock'} size={15} />{a ? L(a[0], a[1]) : waiting ? L('অনুমোদন বাকি', 'Waiting') : L('হাজিরা বাকি', 'Not marked')}</span>
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
      <div className={`sp-card t-${attTone}`} id="sp-att">
        <span className="i"><Icon name={a ? 'check' : returned ? 'alert' : 'clock'} size={24} /></span>
        <div className="tx"><b>{attTitle}</b><span>{attSub}</span>
          {mark?.kind === 'present' && placeLine(mark.place_status, mark.distance_m, mark.wifi_match)}</div>
      </div>
      {locating && <p className="muted small">{L('ফোনের লোকেশন নেওয়া হচ্ছে… (লোকেশন চালু রাখুন)', 'Getting the phone’s location… (keep location on)')}</p>}
      {attErr && <p className="da-error">{attErr}</p>}
      {!rec && <div className="nv-rows">
        {act('g', 'check', waiting?.kind === 'present' ? L('হাজিরা আবার দিন', 'Give it again') : L('হাবে এসেছি — হাজিরা দিই', 'I am at the hub — mark me'),
          L('চাপলেই হাজিরা যাবে, হাব ম্যানেজার অনুমোদন দেবেন', 'One tap; your hub manager approves it'), () => void give('present'), busy || !v?.me)}
        {act('p', 'log', L('আজ আসব না — কারণ জানাই', 'Not coming — give the reason'), L('কারণ লিখুন, হাব ম্যানেজার দেখবেন', 'Write the reason for your hub manager'),
          () => { setAttErr(''); setAbsent(waiting?.kind === 'absent' ? waiting.note ?? '' : '') }, busy || !v?.me)}
      </div>}
      <div className="nv-rows">{act('b', 'map', L('আমি কি হাবে আছি? দেখুন', 'Am I at the hub? Check'),
        L('ওয়াইফাই বা মোবাইল ডাটা — যেভাবেই হোক, ফোনের লোকেশন দিয়ে হাবের সাথে মিলিয়ে দেখায়', 'On Wi-Fi or mobile data — compares the phone’s location with the hub'), () => void whereAmI(), busy)}</div>
      {here && <div className={`sp-card t-${here === 'none' ? 'w' : here.status === 'at_hub' || here.wifi ? 'g' : here.status === 'far' ? 'r' : 'w'}`}>
        <span className="i"><Icon name="map" size={24} /></span>
        <div className="tx">{here === 'none' ? <><b>{L('আপনার হাব পাওয়া যায়নি', 'Your hub was not found')}</b><span>{L('প্রোফাইলে হাব দেওয়া নেই', 'No hub on your profile')}</span></> : <>
          <b>{here.hub_name}: {L(PLACE[here.status][0], PLACE[here.status][1])}{here.distance_m != null ? ` · ${distText(here.distance_m, L, n)}` : ''}</b>
          <span>{[here.wifi ? L('হাবের ওয়াইফাই থেকে আছেন', 'You are on the hub’s Wi-Fi') : here.hub_has_wifi ? L('হাবের ওয়াইফাইতে নেই (মোবাইল ডাটা বা অন্য নেট)', 'Not on the hub’s Wi-Fi') : null,
            here.status === 'no_gps' ? L('ফোনের লোকেশন চালু করে অনুমতি দিন', 'Turn on location and allow it') : null,
            here.status === 'hub_no_gps' ? L('হাবের লোকেশন এখনো সেট করা হয়নি — ম্যানেজারকে জানান', 'The hub’s location is not set yet — tell your manager') : null,
            here.accuracy_m != null && here.accuracy_m > 100 ? L(`লোকেশন আনুমানিক (±${n(here.accuracy_m)} মি)`, `Location is rough (±${here.accuracy_m} m)`) : null].filter(Boolean).join(' · ')}</span></>}</div>
      </div>}
      {canLeave && ok('/app/hr/leave') && <div className="nv-rows">{row('/app/hr/leave', 'b', 'cal', L('ছুটির আবেদন', 'Apply for leave'), L('কয়েক দিনের ছুটি লাগলে এখান থেকে', 'For leave of one or more days'))}</div>}
      {absent !== null && <Modal title={L('আজ আসব না', 'Not coming today')} onClose={() => setAbsent(null)}
        actions={<><button className="secondary" onClick={() => setAbsent(null)}>{L('বাতিল', 'Cancel')}</button>
          <button disabled={busy || !absent.trim()} onClick={() => void give('absent', absent.trim())}>{busy ? L('পাঠানো হচ্ছে…', 'Sending…') : L('জানিয়ে দিন', 'Send')}</button></>}>
        <Field label={L('কেন আসছেন না *', 'Why are you not coming *')}><textarea id="sp-absent" rows={3} autoFocus value={absent} placeholder={L('যেমন: জ্বর, ডাক্তার দেখাতে যাচ্ছি', 'e.g. fever, going to the doctor')} onChange={e => setAbsent(e.target.value)} /></Field>
        <p className="muted small">{L('হাব ম্যানেজার অনুমোদন দিলে আজ "অনুপস্থিত" হিসেবে খাতায় উঠবে।', 'Once your hub manager approves, today goes on the register as absent.')}</p>
        {attErr && <p className="da-error">{attErr}</p>}
      </Modal>}
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

      <div className="nv-rows">{row('/app/hub-sorting', 'b', 'truck', L('শটিং রুট ও রিপোর্ট টু শটিং', 'Sorting routes & report to sorting'),
        L('শটিংয়ের গাড়ির ড্রাইভার, হেল্পার, ম্যানেজারের নাম ও নাম্বার · পার্সেলের ছবি দিয়ে শটিংকে জানান', 'Names and numbers of the sorting vehicle’s driver, helper, manager · tell sorting with a parcel photo'))}</div>

      {(v?.myDay?.covers ?? []).map(c => <div key={c.id} className="sp-card t-w">
        <span className="i"><Icon name="map" size={24} /></span>
        <div className="tx"><b>{L(`আজ ${c.for}-এর বদলে "${c.route}" রুট আপনার`, `Today you cover "${c.route}" for ${c.for}`)}</b>
          {c.areas.length > 0 && <div className="myday-chips">{c.areas.slice(0, 10).map(a => <span key={a}>{a}</span>)}</div>}
          <span>{c.sheet ? L(`হিসাব খাতায় ডেলিভারি ${n(c.sheet.delivery)}টি`, `${c.sheet.delivery} delivered on the sheet`)
            : c.delivered != null ? L(`ডেলিভারি জানানো হয়েছে: ${n(c.delivered)}টি`, `Delivery sent: ${c.delivered}`) : L('শেষে কয়টা ডেলিভারি হলো জানান', 'Tell how many were delivered at the end')}{c.note ? ` · ${c.note}` : ''}</span>
          {!c.sheet && (cu?.id === c.id
            ? <span className="row-acts"><input inputMode="numeric" style={{ width: 110 }} value={cu.delivered} placeholder={L('কয়টা', 'How many')} onChange={e => setCu({ id: c.id, delivered: e.target.value.replace(/\D/g, '') })} />
                <button className="sm" disabled={busy} onClick={() => void coverDone()}>{L('পাঠান', 'Send')}</button></span>
            : <button className="secondary sm" style={{ alignSelf: 'flex-start' }} onClick={() => setCu({ id: c.id, delivered: c.delivered?.toString() ?? '' })}>{L('ডেলিভারি জানান', 'Report delivery')}</button>)}
        </div></div>)}

      {v?.myDay && dn && <div className="sp-box sp-note"><h3><Icon name="note" size={16} />{L('আজকের কাজ ও পরামর্শ', "Today's work & suggestion")}</h3>
        <Field label={L('আজ কী কী করলাম', 'What I did today')}><textarea rows={2} value={dn.work} onChange={e => setDn({ ...dn, work: e.target.value })}
          placeholder={L('যেমন: ৪২টা ডেলিভারি, ৩টা রিটার্ন, বাজার এলাকায় ২টা ঠিকানা পাওয়া যায়নি', 'e.g. 42 delivered, 3 returned, 2 addresses not found')} /></Field>
        <Field label={L('পরামর্শ / সমস্যা', 'Suggestion / problem')}><textarea rows={2} value={dn.suggestion} onChange={e => setDn({ ...dn, suggestion: e.target.value })}
          placeholder={L('যেমন: বাজার রুটে আরেকজন রাইডার লাগবে', 'e.g. the market route needs one more rider')} /></Field>
        <div className="row-acts"><button className="sm" disabled={busy || (!dn.work.trim() && !dn.suggestion.trim())} onClick={() => void saveNote()}>{L('সেভ', 'Save')}</button>
          <span className="muted small">{v.myDay.note ? L('সেভ করা আছে · রাত ১২টার আগে বদলানো যায়', 'Saved · can change until midnight') : L('জোনাল ম্যানেজার রাত ১২টার রিপোর্টে দেখবেন', 'The zonal manager sees it in the midnight report')}</span></div>
        {dnMsg && <p className="da-error">{dnMsg}</p>}
      </div>}

      {(v?.car?.vehicles.length ?? 0) > 0 && <div className="nv-rows">{row('/app/fleet/mine', 'o', 'truck', `${L('আমার গাড়ি', 'My vehicle')} — ${v!.car!.vehicles[0].name}`,
        L('হাব রিপোর্ট, তেল/স্লিপ, সার্ভিস রিকুইজিশন, গ্যারেজ বিল ও খরচ', 'Hub report, fuel slip, service request, garage bills and costs'))}</div>}

      {ok('/app/issues') && <>
      <h2 className="sd-h">{L('আমার অভিযোগ', 'My complaint')}</h2>
      <div className="nv-rows">
        {row('/app/issues?new=1', 'r', 'alert', L('অভিযোগ জানান', 'Make a complaint'), L('লিখে বা ছবি দিয়ে — হাবের ইস্যু হিসেবে যাবে', 'Write it or add a photo — it goes in as a hub issue'))}
        {row('/app/issues?tab=given', 'b', 'eye', L('আমি যা জানিয়েছি', 'What I reported'), given.length ? L(`${n(given.length)}টি চলছে`, `${given.length} open`) : L('এখন কিছু চলছে না', 'Nothing open now'))}
      </div>
      </>}

      <h2 className="sd-h">{L('ইস্যু ও যোগাযোগ', 'Issues & contact')}</h2>
      <div className="nv-rows">
        {row('/app/issues?tab=mine', 'o', 'tasks', L('আমাকে দেওয়া ইস্যু', 'Issues given to me'), myIssues.length ? L(`${n(myIssues.length)}টি কাজ বাকি`, `${myIssues.length} to do`) : L('কোনো কাজ বাকি নেই', 'Nothing to do'), cnt(myIssues.length, myIssues.some(i => i.overdue) ? 'bad' : 'warn'))}
        {row('/app/issues?tab=group', 'g', 'hub', L('হাব গ্রুপ', 'Hub group'), unseen ? L(`${n(unseen)}টি নতুন মেসেজ`, `${unseen} new messages`) : L('হাবের সবার সাথে কথা', 'Talk with everyone at the hub'), cnt(unseen, 'info'))}
        {row(null, 'b', 'map', L('জোন গ্রুপ', 'Zone group'), L('জোনের সব হাবের গ্রুপ', 'The group for every hub in the zone'))}
        {row(null, 'p', 'phone', L('জোনাল ম্যানেজার', 'Zonal manager'), L('সরাসরি জোনাল ম্যানেজারকে জানান', 'Reach the zonal manager directly'))}
      </div>

      {ok(desk ? desk + 'hand' : '/app/me') && <>
      <h2 className="sd-h">{L('আমার লোক', 'My people')}</h2>
      <div className="nv-rows">
        {row(desk ? desk + 'hand' : '/app/me', 'b', 'plus', L('আমার হাতে লোক আছে', 'I have people in hand'), `${L('কাজ করতে চায় এমন কারো নাম দিন', 'Add someone who wants work')} · ${people(v?.hand ?? 0)}`)}
        {row(desk ? desk + 'brought' : '/app/me', 'g', 'users', L('আমি যাদের দিয়েছি', 'People I brought'), `${L('আমার আনা লোকের তালিকা', 'Who joined through me')} · ${people(v?.brought ?? 0)}`)}
      </div>
      </>}
    </div>
  </AppShell>
}
