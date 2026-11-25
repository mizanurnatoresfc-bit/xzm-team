import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Field, useLoad, useToast } from './accounts/ui'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { AppShell, myRoles } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { Combo } from '../components/inputs'
import { hubLabel, org } from '../lib/hr'
import { hrReq } from '../lib/hrreq'
import { ATTENDANCE_ZONE } from '../lib/menu'
import { resolveWorkHub, saveWorkHub, useWorkHub } from '../lib/workHub'
import { usePrefs } from '../lib/prefs'
import './my-permissions.css'

const MODULE: Record<string, [string, string, string]> = {
  hr: ['স্টাফ ম্যানেজমেন্ট', 'Staff management', 'users'], sorting: ['শটিং সেন্টার', 'Sorting center', 'truck'], office: ['অফিস ম্যানেজমেন্ট', 'Office', 'home'], da: ['হিসাব ম্যানেজমেন্ট', 'Accounts', 'book'], ops: ['অপারেশন ও পিকআপ', 'Operations & pickups', 'truck'],
  zonal: ['জোনাল ও হাব', 'Zonal & hub', 'map'], org: ['এরিয়া, হাব ও পদ', 'Zones, hubs & posts', 'org'], system: ['সিস্টেম', 'System', 'shield'],
}
const ACTION: Record<string, [string, string]> = {
  view: ['দেখা', 'View'], create: ['যোগ', 'Add'], edit: ['এডিট', 'Edit'], archive: ['ডিলিট/আর্কাইভ', 'Delete/archive'], approve: ['অনুমোদন', 'Approve'],
  reject: ['বাতিল', 'Reject'], export: ['এক্সপোর্ট', 'Export'], print: ['প্রিন্ট', 'Print'], configure: ['সেটিংস', 'Configure'],
}
const ACT_TONE: Record<string, string> = { view: 'b-info', create: 'b-ok', edit: 'b-warn', archive: 'b-bad', approve: 'b-ok', reject: 'b-bad' }

/** What the signed-in person may do, grouped by part of the system, with the scope of each grant. */
export function MyPermissions() {
  const { can, grants, session } = useAuth()
  const { L, n } = usePrefs()
  const user = session?.user.id ?? ''
  const saved = useWorkHub(user)
  const { toast, node } = useToast()
  const [draftHub, setDraftHub] = useState<string | null>(null)
  const account = useLoad(async () => {
    const [employee, roles] = await Promise.all([hrReq.myEmployee().catch(() => null), myRoles(user)])
    return { employee, roles }
  }, [user])
  const roster = useLoad(async () => {
    const [hubs, zones] = await Promise.all([org.hubs(), org.zones().catch(() => [])])
    return { hubs: hubs.filter(hub => !hub.archived_at), zones: new Map(zones.map(zone => [zone.id, zone.name])) }
  }, [user])
  const hubs = roster.data?.hubs ?? []
  const current = resolveWorkHub(hubs, saved)
  const own = hubs.find(hub => hub.id === account.data?.employee?.hub_id)
  const roleNames = [...new Set(account.data?.roles.map(role => role.name).filter(Boolean))]
  const name = (session?.user.user_metadata?.full_name as string | undefined) || session?.user.email || '—'
  const candidate = draftHub ?? current?.id ?? ''
  const applyHub = (id: string) => {
    const hub = hubs.find(h => h.id === id)
    if (!hub) return
    if (saveWorkHub(user, id)) {
      setDraftHub(null)
      toast(L(`কাজের হাব সেট হয়েছে — ${hubLabel(hub)}`, `Working hub set to ${hubLabel(hub)}`))
    } else {
      toast(L('এই ডিভাইসে হাব সেভ করা যায়নি।', 'Could not save the hub on this device.'))
    }
  }
  const [q, setQ] = useState('')
  const isSuper = grants.some(g => g.is_super)
  // Super Admin holds every permission: list them all, not just the role's rows.
  const all = useLoad(async () => {
    if (!isSuper) return [] as Array<{ code: string }>
    const { data } = await supabase.from('permissions').select('code').order('code')
    return (data ?? []) as Array<{ code: string }>
  }, [isSuper])
  const rowsSrc = useMemo(() => isSuper ? (all.data ?? []).map(p => ({ permission_code: p.code, scope_type: 'global' as const })) : grants, [isSuper, all.data, grants])
  const groups = useMemo(() => {
    const m = new Map<string, Map<string, { actions: Set<string>; scopes: Set<string> }>>()
    for (const g of rowsSrc) {
      if (!g.permission_code) continue
      const parts = g.permission_code.split('.')
      const mod = parts[0]; const action = parts[parts.length - 1]; const res = parts.slice(1, -1).join('.') || mod
      if (q && !g.permission_code.toLowerCase().includes(q.toLowerCase())) continue
      const byRes = m.get(mod) ?? new Map(); m.set(mod, byRes)
      const cur = byRes.get(res) ?? { actions: new Set<string>(), scopes: new Set<string>() }
      cur.actions.add(action); cur.scopes.add(g.scope_type); byRes.set(res, cur)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [rowsSrc, q])
  const total = new Set(rowsSrc.map(g => g.permission_code).filter(Boolean)).size
  const scopeLabel = (s: string) => s === 'global' ? L('সব জায়গা', 'Everywhere') : s === 'zone' ? L('নিজের এরিয়া', 'Own zone') : L('নিজের হাব', 'Own hub')

  return <AppShell title={L('আমার অনুমতি', 'My permissions')} subtitle={L('আপনার অ্যাকাউন্টের অনুমতি ও কাজের হাব।', 'Your account access and working hub.')}>
    {node}
    {current && <div className="notice mp-current">
      <span>{L('কাজ করছেন', 'Working in')} <strong>{hubLabel(current)}</strong></span>
      <div className="mp-actions">
        {ATTENDANCE_ZONE.some(can) && <Link to="/app/attendance?view=zone">{L('আমার জোন', 'My zone')}</Link>}
        {own && own.id !== current.id && <button type="button" className="link" onClick={() => applyHub(own.id)}>{L('নিজের হাবে ফিরুন', 'Back to my own hub')}</button>}
      </div>
    </div>}
    <div className="mp-overview">
      <section className="panel">
        <h2><Icon name="user" size={18} />{L('অ্যাকাউন্ট', 'Account')}</h2>
        <dl className="mp-details">
          <div><dt>{L('নাম', 'Name')}</dt><dd>{name}</dd></div>
          <div><dt>{L('রোল', 'Roles')}</dt><dd className="mp-roles">{roleNames.length ? roleNames.map(role => <span key={role} className="da-badge b-info">{role}</span>) : '—'}</dd></div>
          <div><dt>{L('কার্যকর অনুমতি', 'Effective permissions')}</dt><dd>{n(total)}</dd></div>
        </dl>
      </section>
      <section className="panel">
        <h2><Icon name="hub" size={18} />{L('আমার হাব', 'My hub')}</h2>
        {roster.error ? <p role="alert">{L('হাবের তালিকা লোড করা যায়নি।', 'Could not load the hub list.')} <button type="button" className="link" onClick={() => void roster.reload()}>{L('আবার চেষ্টা করুন', 'Retry')}</button></p>
          : roster.loading ? <p className="muted">{L('হাবের তালিকা লোড হচ্ছে…', 'Loading hubs…')}</p>
          : hubs.length > 1 ? <>
            <div className="mp-switch">
              <Field label={L(`কাজের হাব (${n(hubs.length)}টি)`, `Working hub (${hubs.length} available)`)}>
                <Combo label={L('কাজের হাব', 'Working hub')} value={candidate} onChange={setDraftHub}
                  options={hubs.map(hub => ({ value: hub.id, label: hubLabel(hub), sub: hub.zone_id ? roster.data?.zones.get(hub.zone_id) : undefined }))}
                  clearable={false} searchFrom={2} placeholder={L('হাবের নাম বা নম্বর লিখুন', 'Search by hub name or number')} emptyText={L('কোনো হাব মেলেনি', 'No matching hubs')} />
              </Field>
              <button type="button" className="primary" disabled={!candidate || candidate === current?.id} onClick={() => applyHub(candidate)}>{L('বদলান', 'Switch')}</button>
            </div>
            <p className="small muted">{L('এই ডিভাইসে হাজিরা, ম্যানেজার প্যানেল ও হোমে এই হাবের তথ্য দেখাবে।', 'Attendance, the manager panel and Home use this hub on this device.')}</p>
          </> : current ? <p>{hubLabel(current)}</p> : <p className="muted">{L('কোনো হাব পাওয়া যায়নি।', 'No hubs available.')}</p>}
      </section>
    </div>
    {isSuper && <p className="notice">{L('আপনি সুপার অ্যাডমিন — সব জায়গায় যোগ, এডিট, সরানো ও ডিলিটের সব অনুমতি আপনার আছে। এই রোল কেউ কমাতে পারে না, আর শেষ সুপার অ্যাডমিনকে সরানো যায় না।', 'You are Super Admin — every add, edit, remove and delete permission everywhere. Nobody can reduce this role, and the last Super Admin cannot be removed.')}</p>}
    <section className="panel">
      <div className="da-bar"><h2>{L('কার্যকর অনুমতির তালিকা', 'Effective permissions')} <span className="count-pill">{n(total)}</span></h2>
        <input type="search" className="team-search" value={q} onChange={e => setQ(e.target.value)} placeholder={L('খুঁজুন…', 'Search…')} /></div>
      {!groups.length ? <p className="muted">{isSuper ? L('আলাদা তালিকা দরকার নেই।', 'No list needed.') : L('কোনো অনুমতি নেই।', 'No permissions.')}</p> :
        groups.map(([mod, byRes]) => { const meta = MODULE[mod] ?? [mod, mod, 'shield']; return <div key={mod} className="perm-grp">
          <h3><span className="perm-ic"><Icon name={meta[2]} size={18} /></span>{L(meta[0], meta[1])}</h3>
          <div className="perm-rows">{[...byRes.entries()].map(([res, v]) => <div key={res} className="perm-row">
            <span className="perm-res">{res.replace(/_/g, ' ')}</span>
            <span className="perm-acts">{[...v.actions].map(a => <span key={a} className={`da-badge ${ACT_TONE[a] ?? 'b-neutral'}`}>{ACTION[a] ? L(ACTION[a][0], ACTION[a][1]) : a}</span>)}</span>
            <span className="muted small">{[...v.scopes].map(scopeLabel).join(', ')}</span>
          </div>)}</div>
        </div> })}
    </section>
  </AppShell>
}
