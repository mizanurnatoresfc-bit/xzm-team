// Everyone who has a login: their roles, how far their data reaches (whole company / zones / hubs)
// and how many personal permissions they hold. A row opens that person's access page.
import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { DataTable } from '../../components/DataTable'
import { Badge, Field } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { reachOf } from '../../lib/access'
import { userFriendly, type UserRow } from '../../lib/users'
import { AccountBadge, RoleChips, roleText } from '../users/common'
import type { CenterData } from './AccessCenter'
import { roleName } from './common'

export function reachText(u: Pick<UserRow, 'roles'>, L: (bn: string, en: string) => string, n: (v: number | string) => string): string {
  if (u.roles.some(r => r.is_super)) return L('সব ক্ষমতা (সুপার অ্যাডমিন)', 'Full control (Super Admin)')
  const reach = reachOf(u.roles)
  if (reach === 'none') return L('রোল নেই', 'No role')
  if (reach === 'global') return L('পুরো কোম্পানি', 'Whole company')
  const zones = new Set(u.roles.filter(r => r.scope_type === 'zone').map(r => r.zone_id)).size
  const hubs = new Set(u.roles.filter(r => r.scope_type === 'hub').map(r => r.hub_id)).size
  return [zones ? `${n(zones)}${L('টি জোন', zones > 1 ? ' zones' : ' zone')}` : '', hubs ? `${n(hubs)}${L('টি হাব', hubs > 1 ? ' hubs' : ' hub')}` : ''].filter(Boolean).join(' + ')
}

export function UsersTab({ d }: { d: CenterData }) {
  const { L, n, lang } = usePrefs()
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const role = sp.get('role') ?? '', reach = sp.get('reach') ?? '', own = sp.get('own') === '1'
  const set = (k: string, v: string) => { const x = new URLSearchParams(sp); if (v) x.set(k, v); else x.delete(k); setSp(x, { replace: true }) }
  const ownBy = useMemo(() => {
    const m: Record<string, { plus: number; minus: number }> = {}
    for (const o of d.overrides) if (o.live) { const x = (m[o.user_id] ??= { plus: 0, minus: 0 }); if (o.effect === 'grant') x.plus++; else x.minus++ }
    return m
  }, [d.overrides])
  const rows = useMemo(() => (d.people ?? []).filter(u => {
    if (u.archived_at) return false
    if (role && !u.roles.some(r => r.role_id === role)) return false
    if (reach && (u.roles.some(r => r.is_super) ? 'super' : reachOf(u.roles)) !== reach) return false
    if (own && !ownBy[u.id]) return false
    return true
  }), [d.people, role, reach, own, ownBy])
  const roleList = (d.base.data?.list ?? []).filter(r => !r.archived_at)

  if (d.peopleError) return <p className="notice">{/42501|Not authori/i.test(String((d.peopleError as { message?: string })?.message ?? d.peopleError))
    ? L('ইউজারের তালিকা দেখার অনুমতি আপনার নেই (“ইউজার অ্যাকাউন্ট — দেখা” লাগে)।', 'You may not list accounts (needs “User accounts — View”).') : userFriendly(d.peopleError)}</p>

  return <>
    <section className="da-filters panel no-print">
      <Field label={L('রোল', 'Role')}><select value={role} onChange={e => set('role', e.target.value)}><option value="">{L('সব রোল', 'All roles')}</option>
        {roleList.map(r => <option key={r.id} value={r.id}>{roleName(r, lang)}</option>)}</select></Field>
      <Field label={L('তথ্য কতদূর দেখেন', 'How far the data reaches')}><select value={reach} onChange={e => set('reach', e.target.value)}>
        <option value="">{L('সব', 'All')}</option><option value="global">{L('পুরো কোম্পানি', 'Whole company')}</option><option value="zone">{L('জোনে সীমিত', 'Limited to zones')}</option>
        <option value="hub">{L('হাবে সীমিত', 'Limited to hubs')}</option><option value="none">{L('রোল নেই', 'No role')}</option><option value="super">{L('সুপার অ্যাডমিন', 'Super Admin')}</option></select></Field>
      <label className="da-check"><input type="checkbox" checked={own} onChange={e => set('own', e.target.checked ? '1' : '')} />{L('শুধু যাঁদের আলাদা (ব্যক্তিগত) অনুমতি আছে', 'Only people with personal permissions')}</label>
    </section>
    <section className="panel">
      <div className="da-bar"><strong>{n(rows.length)} {L('জন', 'people')}</strong>{!d.people && <span className="muted small">{L('লোড হচ্ছে…', 'Loading…')}</span>}</div>
      <DataTable<UserRow> title={L('ইউজারের অ্যাক্সেস', 'User access')} file="user-access" rows={rows} rowKey={u => u.id} onRowClick={u => nav(`/app/access/user/${u.id}`)} phoneView="card"
        empty={<p className="muted">{L('কাউকে পাওয়া যায়নি।', 'Nobody found.')}</p>} cols={[
          { key: 'name', label: L('নাম', 'Name'), value: u => u.full_name || u.email || '', render: u => <><strong>{u.full_name || '—'}</strong><span className="sec">{u.email}{u.employee_code ? ` · ${L('আইডি', 'ID')} ${u.employee_code}` : ''}</span></> },
          { key: 'roles', label: L('রোল ও জায়গা', 'Role & place'), value: u => u.roles.map(r => roleText(r, lang)).join(', '), render: u => <RoleChips roles={u.roles} /> },
          { key: 'reach', label: L('তথ্যের সীমা', 'Data limit'), value: u => reachText(u, L, n),
            render: u => { const k = u.roles.some(r => r.is_super) ? 'bad' : reachOf(u.roles) === 'global' ? 'warn' : reachOf(u.roles) === 'none' ? 'neutral' : 'ok'
              return <Badge tone={k}>{reachText(u, L, n)}</Badge> } },
          { key: 'own', label: L('ব্যক্তিগত অনুমতি', 'Personal'), value: u => (ownBy[u.id] ? `+${ownBy[u.id].plus} / -${ownBy[u.id].minus}` : ''),
            render: u => ownBy[u.id] ? <span className="ax-own">{ownBy[u.id].plus > 0 && <b className="plus">+{n(ownBy[u.id].plus)}</b>}{ownBy[u.id].minus > 0 && <b className="minus">−{n(ownBy[u.id].minus)}</b>}</span> : <span className="muted">—</span> },
          { key: 'status', label: L('অবস্থা', 'Status'), value: u => u.status, render: u => <AccountBadge u={u} /> },
        ]} />
    </section>
  </>
}
