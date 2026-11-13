import { useEffect, useState } from 'react'
import { Badge, Field } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { SCOPE_LABEL, users, type AssignableRole, type RoleGrant, type Scope, type UserRow } from '../../lib/users'
import { useOrg } from '../hr/common'

export type RolePick = { scope: Scope; zone: string; hub: string; role: string }
export const emptyPick: RolePick = { scope: 'hub', zone: '', hub: '', role: '' }

/** Scope → zone/hub → role. The role list shows only roles this admin may hand out there. */
export function RoleScopePicker({ value, onChange }: { value: RolePick; onChange: (v: RolePick) => void }) {
  const { L, lang } = usePrefs()
  const o = useOrg()
  const [roles, setRoles] = useState<AssignableRole[] | null>(null)
  const ready = value.scope === 'global' || (value.scope === 'zone' && value.zone) || (value.scope === 'hub' && value.hub)
  useEffect(() => {
    let alive = true
    setRoles(null)
    if (!ready) return
    users.assignable(value.scope, value.zone, value.hub).then(r => { if (alive) setRoles(r) }).catch(() => { if (alive) setRoles([]) })
    return () => { alive = false }
  }, [value.scope, value.zone, value.hub, ready])
  const set = (p: Partial<RolePick>) => onChange({ ...value, ...p })
  return <>
    <Field label={L('কোথায় কাজ করবেন', 'Works where')}>
      <select value={value.scope} onChange={e => set({ scope: e.target.value as Scope, zone: '', hub: '', role: '' })}>
        {(Object.keys(SCOPE_LABEL) as Scope[]).map(s => <option key={s} value={s}>{L(...SCOPE_LABEL[s])}</option>)}
      </select></Field>
    {value.scope === 'zone' && <Field label={L('জোন', 'Zone')}><select value={value.zone} onChange={e => set({ zone: e.target.value, role: '' })}>
      <option value="">{L('বেছে নিন…', 'Choose…')}</option>{o.data?.zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>}
    {value.scope === 'hub' && <Field label={L('হাব', 'Hub')}><select value={value.hub} onChange={e => set({ hub: e.target.value, role: '' })}>
      <option value="">{L('বেছে নিন…', 'Choose…')}</option>{o.data?.hubs.map(h => <option key={h.id} value={h.id}>{h.name}{o.names.zone[h.zone_id] ? ` · ${o.names.zone[h.zone_id]}` : ''}</option>)}</select></Field>}
    <Field label={L('রোল', 'Role')} hint={ready && roles && !roles.length ? L('এই জায়গায় আপনি কোনো রোল দিতে পারেন না', 'You cannot grant any role here') : undefined}>
      <select value={value.role} disabled={!ready || !roles} onChange={e => set({ role: e.target.value })}>
        <option value="">{!ready ? L('আগে জায়গা বেছে নিন', 'Choose the place first') : !roles ? L('লোড হচ্ছে…', 'Loading…') : L('বেছে নিন…', 'Choose…')}</option>
        {roles?.map(r => <option key={r.id} value={r.id}>{lang === 'bn' && r.name_bn ? r.name_bn : r.name}</option>)}
      </select></Field>
    {o.data && value.scope === 'hub' && !o.data.hubs.length && <p className="notice" style={{ gridColumn: '1 / -1' }}>{L('আগে “জোন, হাব ও পদ” পাতায় হাব যোগ করুন, অথবা “পুরো কোম্পানি” বেছে নিন।', 'Add a hub first on “Zones, hubs & posts”, or choose “Whole company”.')}</p>}
  </>
}

export function roleText(r: RoleGrant, lang: string) {
  const name = lang === 'bn' && r.name_bn ? r.name_bn : r.name
  return r.scope_type === 'global' ? name : `${name} · ${r.hub ?? r.zone ?? ''}`
}

export function RoleChips({ roles }: { roles: RoleGrant[] }) {
  const { L, lang } = usePrefs()
  if (!roles.length) return <span className="muted small">{L('কোনো রোল নেই', 'No role')}</span>
  return <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
    {roles.map(r => <span key={r.id} className={`rb ${r.is_super || r.code === 'admin' ? 'rb-super' : r.scope_type === 'zone' ? 'rb-zone' : r.scope_type === 'hub' ? 'rb-hub' : 'rb-acct'}`}>{roleText(r, lang)}</span>)}
  </span>
}

export function AccountBadge({ u }: { u: Pick<UserRow, 'status' | 'locked' | 'must_change_password' | 'archived_at'> }) {
  const { L } = usePrefs()
  if (u.archived_at) return <Badge tone="neutral">{L('আর্কাইভ', 'Archived')}</Badge>
  if (u.status !== 'active') return <Badge tone="bad">{L('বন্ধ', 'Disabled')}</Badge>
  if (u.locked) return <Badge tone="warn">{L('লক (ভুল পাসওয়ার্ড)', 'Locked')}</Badge>
  if (u.must_change_password) return <Badge tone="info">{L('পাসওয়ার্ড বদলানো বাকি', 'Must set password')}</Badge>
  return <Badge tone="ok">{L('সক্রিয়', 'Active')}</Badge>
}

/** One-time display of a temporary password, with copy. */
export function PasswordNote({ email, password }: { email: string; password: string }) {
  const { L } = usePrefs()
  const [copied, setCopied] = useState(false)
  const text = `${L('লগইন', 'Login')}: ${typeof location !== 'undefined' ? location.origin : ''}/staff/login\n${L('ইমেইল', 'Email')}: ${email}\n${L('পাসওয়ার্ড', 'Password')}: ${password}`
  return <div className="panel" style={{ background: 'var(--surface-2, transparent)' }}>
    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 15 }}>{text}</pre>
    <button className="secondary sm" style={{ marginTop: 8 }} onClick={() => { void navigator.clipboard?.writeText(text).then(() => setCopied(true)) }}>
      {copied ? L('কপি হয়েছে', 'Copied') : L('কপি করুন', 'Copy')}</button>
    <p className="muted small" style={{ marginBottom: 0 }}>{L('এই পাসওয়ার্ড আর দেখানো হবে না। স্টাফকে নিজে হাতে দিন — প্রথম লগইনে তাঁকে নতুন পাসওয়ার্ড দিতে হবে।',
      'This password is not shown again. Give it to the staff member in person — they must set a new one at first login.')}</p>
  </div>
}
