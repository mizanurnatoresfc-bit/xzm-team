import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, type ViewAs } from '../auth/AuthProvider'
import { menuApi } from '../lib/menu'
import { Badge, Modal, useLoad } from '../pages/accounts/ui'
import { dashboard, type RoleDashboard } from '../lib/dashboard'
import { roles, type RoleRow } from '../lib/roles'
import { usePrefs } from '../lib/prefs'
import { Icon } from './Icon'

/** Super Admin only: pick a role and see the menu, dashboard, buttons and pages the way that role does. */
export function ViewAsPicker({ onClose }: { onClose: () => void }) {
  const { viewAs, setViewAs } = useAuth()
  const { L, n, lang } = usePrefs()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const list = useLoad(async () => {
    const [rs, layouts, menus] = await Promise.all([roles.list(), dashboard.roleLayouts().catch(() => [] as RoleDashboard[]), menuApi.roles().catch(() => [])])
    return { rs: rs.filter(r => !r.archived_at), layouts: Object.fromEntries(layouts.map(l => [l.role_id, l])) as Record<string, RoleDashboard>,
      menus: Object.fromEntries(menus.map(m => [m.role_id, m.menu])) as Record<string, string[] | null> }
  }, [])
  const label = (r: RoleRow) => lang === 'bn' && r.name_bn ? r.name_bn : r.name
  const shown = (list.data?.rs ?? []).filter(r => !q.trim() || `${r.name} ${r.name_bn ?? ''} ${r.code}`.toLowerCase().includes(q.trim().toLowerCase()))
  function pick(r: RoleRow) {
    const lay = list.data?.layouts[r.id]
    const next: ViewAs = { id: r.id, name: label(r), permissions: r.permissions ?? [], is_super: r.is_super, panels: lay ? lay.panels : null, view: lay?.default_view ?? null, menu: list.data?.menus[r.id] ?? null }
    setViewAs(next); onClose(); nav('/app')
  }
  return <Modal title={L('রোল হিসেবে দেখুন', 'View as a role')} onClose={onClose}
    actions={<>{viewAs && <button className="secondary" onClick={() => { setViewAs(null); onClose() }}>{L('সুপার অ্যাডমিনে ফিরুন', 'Back to Super Admin')}</button>}
      <button className="secondary" onClick={onClose}>{L('বন্ধ', 'Close')}</button></>}>
    <p className="muted small">{L('একটা রোল বাছুন — মেনু, ড্যাশবোর্ড, বোতাম ও পাতা ওই রোলের মতো দেখাবে। তথ্য আপনার নিজের (সুপার অ্যাডমিন) হিসেবেই আসে, তাই ওই রোলের হাব/জোনের সীমা এখানে দেখা যায় না। শুধু এই ডিভাইসে, এই ট্যাবে।',
      'Pick a role — the menu, dashboard, buttons and pages look the way that role sees them. Data still loads as you (Super Admin), so the role’s hub/zone limits are not shown. This device and tab only.')}</p>
    <input type="search" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={L('রোল খুঁজুন…', 'Search roles…')} />
    {list.error ? <p className="da-error">{L('রোলের তালিকা আনা যায়নি', 'Could not load the roles')}</p> : null}
    {list.loading && <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>}
    <ul className="duty-list" style={{ maxHeight: '50vh', overflow: 'auto' }}>{shown.map(r => <li key={r.id} className="duty" style={{ cursor: 'pointer' }} onClick={() => pick(r)}>
      <Icon name="shield" size={18} />
      <div style={{ flex: 1, minWidth: 0 }}><b>{label(r)}</b> {viewAs?.id === r.id && <Badge tone="info">{L('এখন দেখছেন', 'Viewing now')}</Badge>}
        <div className="muted small">{r.is_super ? L('সব ক্ষমতা', 'Full control') : `${n(r.permission_count)} ${L('টি অনুমতি', 'permissions')}`} · {n(r.user_count)} {L('জন ইউজার', 'users')}</div></div>
      <Icon name="chev" size={14} /></li>)}
      {!list.loading && !shown.length && <li className="muted">{L('কোনো রোল পাওয়া যায়নি', 'No role found')}</li>}</ul>
  </Modal>
}

/** Shown on every page while a role is being previewed, with the way back. */
export function ViewAsBar({ onChange }: { onChange: () => void }) {
  const { viewAs, setViewAs } = useAuth()
  const { L } = usePrefs()
  if (!viewAs) return null
  return <div className="viewas-bar no-print" role="status">
    <Icon name="shield" size={16} />
    <span className="vt">{L('দেখছেন যেভাবে দেখে:', 'Viewing as:')} <b>{viewAs.name}</b></span>
    <button type="button" className="secondary sm" onClick={onChange}>{L('রোল বদলান', 'Change role')}</button>
    <button type="button" className="sm" onClick={() => setViewAs(null)}>{L('বন্ধ করুন', 'Exit')}</button>
  </div>
}
