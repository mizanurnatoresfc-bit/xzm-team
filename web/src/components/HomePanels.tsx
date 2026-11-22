import { useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { dutiesApi, hubApi } from '../lib/hub'
import { hubLabel, org } from '../lib/hr'
import { hrReq } from '../lib/hrreq'
import { usePrefs } from '../lib/prefs'
import { supabase } from '../lib/supabase'
import { useLoad } from '../pages/accounts/ui'
import { Icon } from './Icon'

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const ATT: Record<string, [string, string, string]> = {
  present: ['উপস্থিত', 'Present', 'g'], late: ['দেরিতে', 'Late', 'o'], half_day: ['অর্ধদিবস', 'Half day', 'o'], absent: ['অনুপস্থিত', 'Absent', 'r'],
  leave: ['ছুটি', 'Leave', 'p'], holiday: ['সরকারি ছুটি', 'Holiday', 'b'], weekly_off: ['সাপ্তাহিক ছুটি', 'Weekly off', 'b'],
}

/** "আমি" view: my attendance today, my duties, my route and the actions a staff member needs. */
export function MyDayPanel() {
  const { L, n } = usePrefs()
  const d = useLoad(async () => {
    const me = await hrReq.myEmployee().catch(() => null)
    if (!me) return null
    const [att, duties, routes] = await Promise.all([
      supabase.from('attendance_records').select('status, check_in').eq('employee_id', me.id).eq('work_date', today()).maybeSingle().then(r => r.data as { status: string; check_in: string | null } | null),
      dutiesApi.mine(me.id).catch(() => []),
      supabase.from('rider_routes').select('hub_routes(name, areas)').eq('employee_id', me.id).is('effective_to', null)
        .then(r => ((r.data ?? []) as unknown as Array<{ hub_routes: { name: string; areas: string[] } | null }>).map(x => x.hub_routes).filter(Boolean) as Array<{ name: string; areas: string[] }>),
    ])
    return { me, att, duties, routes }
  }, [])
  const v = d.data
  const a = v?.att ? ATT[v.att.status] : null
  return <section className="panel myday">
    <div className="da-bar"><h2 style={{ margin: 0 }}>{L('আমার আজকের দিন', 'My day')}</h2><Link to="/app/me" className="small">{L('প্রোফাইল', 'Profile')} →</Link></div>
    {d.loading && !v ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p> : !v ? <p className="muted">{L('আপনার লগইনের সাথে কর্মী প্রোফাইল যুক্ত নেই।', 'No staff profile is linked to your login.')}</p> : <>
      <div className={`myday-att t-${a?.[2] ?? 'warn'}`}>
        <span className="ma-ic"><Icon name={a ? 'check' : 'clock'} size={22} /></span>
        <div><small>{L('আজকের হাজিরা', "Today's attendance")}</small><b>{a ? L(a[0], a[1]) : L('এখনো দেওয়া হয়নি', 'Not marked yet')}</b>
          {v.att?.check_in && <small>{new Date(v.att.check_in).toLocaleTimeString('bn-BD', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' })}</small>}</div>
      </div>
      <div className="myday-grid">
        <div className="myday-box"><h3><Icon name="tasks" size={16} /> {L('আমার দায়িত্ব', 'My duties')} <span className="cnt">{n(v.duties.length)}</span></h3>
          {v.duties.length ? <ul>{v.duties.slice(0, 5).map(x => <li key={x.id}>{x.title}</li>)}</ul> : <p className="muted small">{L('কোনো দায়িত্ব লেখা নেই', 'No duties written')}</p>}</div>
        <div className="myday-box"><h3><Icon name="map" size={16} /> {L('আমার রুট', 'My route')}</h3>
          {v.routes.length ? v.routes.map((r, i) => <div key={i}><b className="small">{r.name}</b><div className="myday-chips">{r.areas.slice(0, 8).map(x => <span key={x}>{x}</span>)}</div></div>)
            : <p className="muted small">{L('রুট দেওয়া হয়নি', 'No route assigned')}</p>}</div>
      </div>
      <div className="myday-acts">
        <Link to="/app/hr/leave" className="ma t-p"><Icon name="log" size={18} />{L('ছুটি চাই', 'Ask leave')}</Link>
        <Link to="/app/hr/requests" className="ma t-o"><Icon name="form" size={18} />{L('আইডি রিকুয়েস্ট', 'ID request')}</Link>
        <Link to="/app/accounts/mine" className="ma t-g"><Icon name="wallet" size={18} />{L('আমার হিসাব', 'My accounts')}</Link>
        <Link to="/app/me" className="ma t-b"><Icon name="user" size={18} />{L('প্রোফাইল', 'Profile')}</Link>
      </div>
    </>}
  </section>
}

/** "হাব" view: one hub at a glance, with a hub picker for people who look after several. */
export function HubTodayPanel() {
  const { L, n } = usePrefs()
  const { can } = useAuth()
  const hubs = useLoad(() => org.hubs().catch(() => []), [])
  const [hub, setHub] = useState<string>(() => { try { return sessionStorage.getItem('xzm_hub') || '' } catch { return '' } })
  useEffect(() => {
    const list = hubs.data ?? []
    if (!list.length) return
    if (!hub || !list.some(h => h.id === hub)) {
      void hrReq.myEmployee().then(me => setHub(me?.hub_id && list.some(h => h.id === me.hub_id) ? me.hub_id : list[0].id)).catch(() => setHub(list[0].id))
    }
  }, [hubs.data, hub])
  const pick = (id: string) => { setHub(id); try { sessionStorage.setItem('xzm_hub', id) } catch { /* ignore */ } }
  const d = useLoad(async () => {
    if (!hub) return null
    const team = await hubApi.team(hub, 'active').catch(() => [])
    const [att, pickups, sheet] = await Promise.all([
      hubApi.attendance(today(), team.map(t => t.id)).catch(() => []),
      can('ops.pickup.view') || can('ops.pickup_as_hub_manager.create') ? hubApi.pickups(hub, today()).catch(() => []) : Promise.resolve([]),
      supabase.from('da_sessions').select('status').eq('hub_id', hub).eq('account_date', today()).maybeSingle().then(r => (r.data as { status: string } | null)?.status ?? null),
    ])
    const c = (s: string) => att.filter(a => a.status === s).length
    return { staff: team.length, present: c('present') + c('half_day'), late: c('late'), absent: c('absent') + c('leave'), notMarked: Math.max(team.length - att.length, 0), pickups: pickups.length, sheet }
  }, [hub])
  const v = d.data
  const SHEET: Record<string, [string, string]> = { open: ['খোলা', 'g'], submitted: ['যাচাইয়ের অপেক্ষায়', 'o'], correction: ['সংশোধন লাগবে', 'r'], approved: ['অনুমোদিত', 'b'] }
  const cur = hubs.data?.find(h => h.id === hub)
  const pct = v && v.staff ? Math.round((v.present + v.late) * 100 / v.staff) : 0
  return <section className="panel hubtoday">
    <div className="da-bar"><h2 style={{ margin: 0 }}>{L('আজ আমার হাব', 'My hub today')}</h2>
      {(hubs.data?.length ?? 0) > 1 ? <select className="ht-pick" value={hub} onChange={e => pick(e.target.value)}>{hubs.data!.map(h => <option key={h.id} value={h.id}>{hubLabel(h)}</option>)}</select>
        : cur && <b className="small">{hubLabel(cur)}</b>}</div>
    {!v ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p> : <>
      {/* attendance at a glance: how much of the team is marked present, and what is still open */}
      <div className="ht-att">
        <Link to="/app/hub/attendance" className="ht-ring" style={{ '--p': pct } as CSSProperties} aria-label={L(`উপস্থিত ${n(pct)}%`, `${pct}% present`)}><span>{n(pct)}%</span></Link>
        <div className="ht-att-t"><small>{L('আজকের হাজিরা', "Today's attendance")}</small>
          <b>{n(v.present + v.late)} <i>/ {n(v.staff)} {L('জন', 'staff')}</i></b>
          <div className="ht-tags">
            <Link to="/app/hub/attendance" className="t-ok">{L('উপস্থিত', 'Present')} {n(v.present)}</Link>
            <Link to="/app/hub/late" className="t-need">{L('দেরি', 'Late')} {n(v.late)}</Link>
            {v.absent > 0 && <Link to="/app/hub/attendance" className="t-bad">{L('অনুপস্থিত / ছুটি', 'Absent / leave')} {n(v.absent)}</Link>}
            {v.notMarked > 0 && <Link to="/app/hub/attendance" className="t-bad">{L('হাজিরা বাকি', 'Not marked')} {n(v.notMarked)}</Link>}
          </div></div>
      </div>
      <div className="net-kpis two">
        <Link to="/app/hub/team" className="nk"><span className="nk-i b"><Icon name="users" size={20} /></span><b>{n(v.staff)}</b><small>{L('কর্মী', 'Staff')}</small></Link>
        <Link to="/app/hub/pickup" className="nk"><span className="nk-i p"><Icon name="box" size={20} /></span><b>{n(v.pickups)}</b><small>{L('আজ পিকআপ', 'Pickups')}</small></Link>
      </div>
      <Link to="/app/accounts/daily" className={`ht-sheet t-${v.sheet ? SHEET[v.sheet]?.[1] ?? 'g' : 'r'}`}><Icon name="ledger" size={18} />
        <span>{L('আজকের হিসাব খাতা', "Today's daily sheet")}: <b>{v.sheet ? L(SHEET[v.sheet]?.[0] ?? v.sheet, v.sheet) : L('এখনো খোলা হয়নি', 'Not opened yet')}</b></span><Icon name="chev" size={16} /></Link>
      <div className="myday-acts">
        <Link to="/app/hub/attendance" className="ma t-g"><Icon name="cal" size={18} />{L('হাজিরা দিন', 'Attendance')}</Link>
        <Link to="/app/hub/late" className="ma t-o"><Icon name="clock" size={18} />{L('দেরি লিখুন', 'Late')}</Link>
        <Link to="/app/hub/pickup" className="ma t-b"><Icon name="box" size={18} />{L('পিকআপ', 'Pickup')}</Link>
        <Link to="/app/hr/requests" className="ma t-p"><Icon name="form" size={18} />{L('এইচআর রিকুয়েস্ট', 'HR request')}</Link>
      </div>
    </>}
  </section>
}
