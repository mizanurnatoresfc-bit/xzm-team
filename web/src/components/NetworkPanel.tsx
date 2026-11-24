import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { usePrefs } from '../lib/prefs'
import { useLoad } from '../pages/accounts/ui'
import { Icon } from './Icon'
import { OsmMap, num, type MapPin } from './OsmMap'

type H = { id: string; zone_id: string; code: string; name: string; status: string; latitude: number | null; longitude: number | null }
const isNum = (c: string) => /^\d+$/.test(String(c ?? '').trim())

/** Dashboard: Region → Area → Hub at a glance — hubs on a map, staff and today's attendance per hub. */
export function NetworkPanel() {
  const { can } = useAuth()
  const { L, n } = usePrefs()
  const nav = useNavigate()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
  const data = useLoad(async () => {
    const q = <T,>(p: PromiseLike<{ data: unknown; error: unknown }>) => Promise.resolve(p).then(r => (r.error ? [] : (r.data ?? [])) as T[]).catch(() => [] as T[])
    const [regions, zones, hubs, emps, att] = await Promise.all([
      q<{ id: string; name: string }>(supabase.from('regions').select('id,name').is('archived_at', null).order('name')),
      q<{ id: string; name: string; region_id: string | null }>(supabase.from('zones').select('id,name,region_id').is('archived_at', null).order('name')),
      q<H>(supabase.from('hubs').select('id,zone_id,code,name,status,latitude,longitude').is('archived_at', null).order('name')),
      can('hr.employee.view') ? q<{ id: string; hub_id: string | null }>(supabase.from('employees').select('id,hub_id').is('archived_at', null).eq('status', 'active').limit(5000)) : Promise.resolve([]),
      can('hr.attendance.view') ? q<{ employee_id: string; status: string }>(supabase.from('attendance_records').select('employee_id,status').eq('work_date', today).limit(5000)) : Promise.resolve([]),
    ])
    return { regions, zones, hubs, emps, att }
  }, [])
  const d = data.data

  const per = useMemo(() => {
    const m: Record<string, { staff: number; present: number; late: number; absent: number }> = {}
    if (!d) return m
    const hubOf: Record<string, string> = {}
    for (const e of d.emps) if (e.hub_id) { hubOf[e.id] = e.hub_id; (m[e.hub_id] ??= { staff: 0, present: 0, late: 0, absent: 0 }).staff++ }
    for (const a of d.att) {
      const h = hubOf[a.employee_id]; if (!h) continue
      const x = (m[h] ??= { staff: 0, present: 0, late: 0, absent: 0 })
      if (a.status === 'present' || a.status === 'half_day') x.present++
      else if (a.status === 'late') x.late++
      else if (a.status === 'absent') x.absent++
    }
    return m
  }, [d])

  if (!can('org.hub.view')) return null
  if (!d) return <section className="panel"><p className="muted">{L('হাবের তথ্য লোড হচ্ছে…', 'Loading hubs…')}</p></section>

  const active = d.hubs.filter(h => h.status === 'active')
  const staff = d.emps.length
  const came = Object.values(per).reduce((s, x) => s + x.present + x.late, 0)
  const late = Object.values(per).reduce((s, x) => s + x.late, 0)
  const marked = d.att.length
  const pins: MapPin[] = d.hubs.filter(h => num(h.latitude) !== null && num(h.longitude) !== null)
    .map(h => ({ id: h.id, lat: num(h.latitude)!, lng: num(h.longitude)!, label: isNum(h.code) ? `#${h.code}` : h.name, tone: h.status === 'active' ? 'ok' : 'off' }))
  const showAtt = can('hr.attendance.view') && staff > 0

  return <section className="panel net-panel">
    <div className="da-bar"><h2 style={{ margin: 0 }}>{L('আমার নেটওয়ার্ক', 'My network')}</h2>
      <Link to="/app/org/hubs" className="small">{L('হাব তালিকা ও ম্যাপ', 'Hub list & map')} →</Link></div>

    <div className="net-path">
      {d.regions.map(r => <span key={r.id} className="np"><Icon name="globe" size={14} /> {r.name}</span>)}
      {d.zones.map(z => <span key={z.id} className="np a"><Icon name="map" size={14} /> {z.name} · {n(d.hubs.filter(h => h.zone_id === z.id).length)} {L('হাব', 'hubs')}</span>)}
    </div>

    <div className="net-kpis">
      <Link to="/app/org/hubs" className="nk"><span className="nk-i g"><Icon name="hub" size={20} /></span><b>{n(active.length)}</b><small>{L('চালু হাব', 'Active hubs')}{active.length !== d.hubs.length ? ` / ${n(d.hubs.length)}` : ''}</small></Link>
      {staff > 0 && <Link to="/app/staff/list" className="nk"><span className="nk-i b"><Icon name="users" size={20} /></span><b>{n(staff)}</b><small>{L('সক্রিয় কর্মী', 'Active staff')}</small></Link>}
      {showAtt && <Link to="/app/attendance?view=hub" className="nk"><span className="nk-i g"><Icon name="check" size={20} /></span><b>{n(came)}</b><small>{L('আজ উপস্থিত', 'Present today')}</small></Link>}
      {showAtt && <Link to="/app/attendance?view=hub" className="nk"><span className="nk-i o"><Icon name="clock" size={20} /></span><b>{n(late)}</b><small>{L('আজ দেরি', 'Late today')}</small></Link>}
      {showAtt && <Link to="/app/attendance?view=hub" className={`nk${staff - marked > 0 ? ' warn' : ''}`}><span className="nk-i r"><Icon name="alert" size={20} /></span><b>{n(Math.max(staff - marked, 0))}</b><small>{L('হাজিরা বাকি', 'Not marked')}</small></Link>}
    </div>

    <div className="net-grid">
      <div className="net-map"><OsmMap pins={pins} height={300} onSelect={() => nav('/app/org/hubs')} /></div>
      <div className="net-hubs">
        {d.hubs.map(h => {
          const x = per[h.id] ?? { staff: 0, present: 0, late: 0, absent: 0 }
          const pct = x.staff ? Math.round(((x.present + x.late) / x.staff) * 100) : 0
          return <Link key={h.id} to="/app/org/hubs" className={`net-hub${h.status !== 'active' ? ' off' : ''}`}>
            <div className="nh-top"><strong>{h.name}</strong>{isNum(h.code) && <span className="nh-code">#{h.code}</span>}</div>
            <div className="nh-meta">
              <span><Icon name="users" size={13} /> {n(x.staff)}</span>
              {showAtt && <span className="ok"><Icon name="check" size={13} /> {n(x.present + x.late)}</span>}
              {showAtt && x.late > 0 && <span className="lt"><Icon name="clock" size={13} /> {n(x.late)}</span>}
              {num(h.latitude) === null && <span className="nogps">{L('GPS নেই', 'No GPS')}</span>}
              {h.status !== 'active' && <span className="nogps">{L('বন্ধ', 'Closed')}</span>}
            </div>
            {showAtt && <div className="nh-bar"><i style={{ width: `${pct}%` }} /></div>}
          </Link>
        })}
      </div>
    </div>
  </section>
}
