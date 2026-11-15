import { useMemo, useState } from 'react'
import { useLoad } from './accounts/ui'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { usePrefs } from '../lib/prefs'

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
  const { grants } = useAuth()
  const { L, n } = usePrefs()
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

  return <AppShell title={L('আমার অনুমতি', 'My permissions')} subtitle={L('আপনার রোল যা যা করতে পারে। বদলাতে হলে সুপার অ্যাডমিনকে বলুন।', 'What your roles allow. Ask the Super Admin to change it.')}>
    {isSuper && <p className="notice">{L('আপনি সুপার অ্যাডমিন — সব জায়গায় যোগ, এডিট, সরানো ও ডিলিটের সব অনুমতি আপনার আছে। এই রোল কেউ কমাতে পারে না, আর শেষ সুপার অ্যাডমিনকে সরানো যায় না।', 'You are Super Admin — every add, edit, remove and delete permission everywhere. Nobody can reduce this role, and the last Super Admin cannot be removed.')}</p>}
    <section className="panel">
      <div className="da-bar"><h2>{L('অনুমতির তালিকা', 'Permissions')} <span className="count-pill">{n(total)}</span></h2>
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
