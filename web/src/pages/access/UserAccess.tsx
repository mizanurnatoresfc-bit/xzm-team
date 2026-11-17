// One person's access: the roles they hold and the hubs / zones each role is limited to, what they can do in
// the end, and their own permissions on top of (or taken away from) the roles.
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth, type ViewAs } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { access, accessFriendly, type Override } from '../../lib/access'
import { userFriendly, users, type RoleGrant, type UserRow } from '../../lib/users'
import { AccountBadge } from '../users/common'
import { isSuperGrant, PlaceChip, PlacePicker, placeText, roleName, useAccessBase, type PlacePick } from './common'
import { OwnAccess } from './OwnAccess'

const denied = (e: unknown) => /42501|Not authori/i.test(String((e as { code?: string; message?: string })?.code ?? '') + String((e as { message?: string })?.message ?? e))

export function UserAccess() {
  const { id = '' } = useParams()
  const { grants, session, can, setViewAs } = useAuth()
  const { L, n, lang } = usePrefs()
  const nav = useNavigate()
  const { toast, node } = useToast()
  const sup = isSuperGrant(grants)
  const base = useAccessBase(id)
  const list = useLoad(() => users.list(), [id])
  // null = the database part is not installed yet
  const ov = useLoad<Override[] | null>(() => access.overrides(id, true).catch(e => { if (denied(e)) return [] as Override[]; throw e }), [id])
  const dbGrants = useLoad(() => access.userGrants(id).catch(() => null), [id])
  const [scope, setScope] = useState<null | { role: string | null }>(null)
  const [drop, setDrop] = useState<null | { role: string; rows: RoleGrant[] }>(null)
  const u = list.data?.find(x => x.id === id)
  const self = id === session?.user.id
  const reload = () => { void list.reload(); void ov.reload(); void dbGrants.reload() }
  const fmt = (v: string | null) => (v ? new Date(v).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

  // one line per role, with every place it is held at
  const byRole = useMemo(() => {
    const m = new Map<string, RoleGrant[]>()
    for (const g of u?.roles ?? []) m.set(g.role_id, [...(m.get(g.role_id) ?? []), g])
    return [...m.entries()]
  }, [u])
  const targetSuper = !!u?.roles.some(r => r.is_super)
  const mayAssign = can('system.user_role.create') && !self
  const mayRemove = can('system.user_role.edit') && !self

  /** The menu, buttons and pages the way this person gets them (this device, this tab; data still loads as the Super Admin). */
  function preview(codes: string[]) {
    if (!u) return
    const lists = u.roles.map(r => (r.is_super ? null : base.menuByRole[r.role_id] ?? null))
    const menu = !lists.length || lists.some(x => x === null) ? null : [...new Set(lists.flatMap(x => x ?? []))]
    const next: ViewAs = { id: `user:${u.id}`, name: u.full_name || u.email || '', permissions: codes, is_super: targetSuper, panels: null, view: null, menu }
    setViewAs(next); nav('/app')
  }

  const back = <Link to="/app/access/users">← {L('ইউজারের অ্যাক্সেস', 'User access')}</Link>
  if (!u) return <AppShell title={L('ইউজারের অ্যাক্সেস', 'User access')} subtitle={back}>
    {list.error ? <p className="da-error">{userFriendly(list.error)}</p> : <p className="muted">{list.loading ? L('লোড হচ্ছে…', 'Loading…') : L('অ্যাকাউন্ট পাওয়া যায়নি।', 'Account not found.')}</p>}
  </AppShell>

  return <AppShell title={u.full_name || u.email || L('ইউজার', 'User')} subtitle={<>{back} · {u.email}</>}
    actions={<Link className="ax-btn" to={`/app/users/${u.id}`}><Icon name="key" size={15} />{L('অ্যাকাউন্ট (পাসওয়ার্ড, চালু/বন্ধ)', 'Account (password, on/off)')}</Link>}>
    {node}
    {self && <p className="notice">{L('এটা আপনার নিজের অ্যাকাউন্ট — নিজের রোল বা অনুমতি নিজে বদলানো যায় না।', 'This is your own account — you cannot change your own roles or permissions.')}</p>}

    <section className="panel ax-person">
      <span className="ax-av" aria-hidden="true">{(u.full_name || u.email || '?').slice(0, 2).toUpperCase()}</span>
      <div className="tx"><b>{u.full_name || '—'}</b>
        <span className="muted small">{u.email}{u.employee_code ? <> · <Link to={`/app/hr/employees/${u.employee_id}`}>{L('আইডি', 'ID')} {u.employee_code}</Link></> : null} · {L('শেষ লগইন', 'Last sign-in')}: {fmt(u.last_login_at)}</span>
        <span className="ax-facts"><AccountBadge u={u} />{targetSuper && <Badge tone="bad">{L('সুপার অ্যাডমিন — সব ক্ষমতা', 'Super Admin — full control')}</Badge>}</span></div>
    </section>

    <section className="panel" id="roles">
      <div className="da-bar"><h2 style={{ margin: 0 }}>{L('রোল ও তথ্যের সীমা (হাব / জোন)', 'Roles & data limits (hub / zone)')}</h2>
        {mayAssign && u.status === 'active' && <button className="sm" onClick={() => setScope({ role: null })}>+ {L('রোল দিন', 'Add a role')}</button>}</div>
      <p className="muted small">{L('একটি রোল যে জায়গায় দেওয়া, তার অনুমতি শুধু সেই জায়গার তথ্যে খাটে: পুরো কোম্পানি, কিছু জোন, বা কিছু হাব। এর বাইরের তথ্য ডাটাবেসই দেয় না।',
        'A role’s permissions apply only to the data of the place it is held at: the whole company, some zones, or some hubs. The database itself gives nothing outside it.')}</p>
      {!byRole.length ? <p className="notice">{L('কোনো রোল নেই — এই অ্যাকাউন্ট লগইন করলেও কিছু দেখতে পাবে না।', 'No role — this account sees nothing after signing in.')}</p>
        : <div className="ax-urole-list">{byRole.map(([rid, rows]) => {
          const r = base.roleById[rid]
          const off = r && r.status !== 'active'
          return <div key={rid} className={`ax-urole${off ? ' off' : ''}`} data-role={rows[0].code}>
            <div className="hd"><span className="i"><Icon name={rows[0].is_super ? 'key' : 'shield'} size={18} /></span>
              <span className="tx"><b>{roleName(rows[0], lang)}</b>
                <small>{rows[0].is_super ? L('সব অনুমতি, সব জায়গায়', 'Every permission, everywhere') : r ? `${n(r.permission_count)} ${L('টি অনুমতি', 'permissions')}` : ''}{off ? ` · ${L('রোলটি এখন বন্ধ রাখা', 'this role is switched off')}` : ''}</small></span>
              <span className="acts">
                {sup && r && !r.is_super && <Link className="small" to={`/app/access/role/${rid}`}>{L('রোল খুলুন', 'Open role')}</Link>}
                {mayAssign && <button className="secondary sm" onClick={() => setScope({ role: rid })}><Icon name="map" size={14} />{L('সীমা বদলান', 'Change limit')}</button>}
                {mayRemove && <button className="danger sm" onClick={() => setDrop({ role: rid, rows })}>{L('সরান', 'Remove')}</button>}</span></div>
            <div className="places"><span className="muted small">{L('তথ্যের সীমা:', 'Data limit:')}</span>
              {rows.map(g => <span key={g.id} className="pl"><PlaceChip g={g} />{g.valid_to ? <small className="muted">{L('পর্যন্ত', 'until')} {g.valid_to}</small> : null}</span>)}</div>
          </div> })}</div>}
    </section>

    <OwnAccess u={u} base={base} rows={ov.data} loading={ov.loading} dbGrants={dbGrants.data ?? null} sup={sup} self={self} targetSuper={targetSuper}
      onSaved={msg => { toast(msg); reload() }} onPreview={sup && !self ? preview : undefined} />

    {scope && <ScopeModal u={u} roleId={scope.role} base={base} onClose={() => setScope(null)} onDone={msg => { toast(msg); setScope(null); reload() }} />}
    {drop && <DropRole u={u} rows={drop.rows} onClose={() => setDrop(null)} onDone={msg => { toast(msg); setDrop(null); reload() }} />}
  </AppShell>
}

const pkey = (s: string, z: string | null, h: string | null) => `${s}|${z ?? ''}|${h ?? ''}`

/** Give a role, or change where one is held: whole company, some zones (zone-wise) or some hubs (hub-wise). */
function ScopeModal({ u, roleId, base, onClose, onDone }: { u: UserRow; roleId: string | null; base: ReturnType<typeof useAccessBase>; onClose: () => void; onDone: (msg: string) => void }) {
  const { L, n, lang } = usePrefs()
  const [role, setRole] = useState(roleId ?? '')
  const current = useMemo(() => u.roles.filter(g => g.role_id === role), [u, role])
  const start = (rows: RoleGrant[]): PlacePick => ({ all: !rows.length ? false : rows.some(g => g.scope_type === 'global'),
    zones: rows.filter(g => g.scope_type === 'zone' && g.zone_id).map(g => g.zone_id!), hubs: rows.filter(g => g.scope_type === 'hub' && g.hub_id).map(g => g.hub_id!) })
  const [pick, setPick] = useState<PlacePick>(() => start(u.roles.filter(g => g.role_id === (roleId ?? ''))))
  const [until, setUntil] = useState(''); const [reason, setReason] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const r = base.roleById[role]
  const choices = (base.data?.list ?? []).filter(x => !x.archived_at && x.status === 'active')
  const want = pick.all ? [{ s: 'global' as const, z: null as string | null, h: null as string | null }]
    : [...pick.zones.map(z => ({ s: 'zone' as const, z, h: null as string | null })), ...pick.hubs.map(h => ({ s: 'hub' as const, z: null as string | null, h }))]
  const add = want.filter(w => !current.some(c => pkey(c.scope_type, c.zone_id, c.hub_id) === pkey(w.s, w.z, w.h)))
  const remove = current.filter(c => !want.some(w => pkey(c.scope_type, c.zone_id, c.hub_id) === pkey(w.s, w.z, w.h)))
  const chooseRole = (v: string) => { setRole(v); setPick(start(u.roles.filter(g => g.role_id === v))); setErr('') }

  async function go() {
    setErr('')
    if (!role) return setErr(L('রোল বেছে নিন', 'Choose a role'))
    if (!want.length) return setErr(L('অন্তত একটি জোন বা হাব বাছুন — অথবা “পুরো কোম্পানি”', 'Choose at least one zone or hub — or “Whole company”'))
    if (!add.length && !remove.length) return setErr(L('কিছু বদলানো হয়নি', 'Nothing changed'))
    if (remove.length && !reason.trim()) return setErr(L('কোনো জায়গা বাদ দিলে কারণ লিখতে হবে', 'Removing a place needs a reason'))
    setBusy(true)
    let ok = 0; const bad: string[] = []
    // new places first, so the person is never left with nothing in between
    for (const w of add) {
      try { await users.assign(u.id, role, w.s, w.z, w.h, until || null); ok++ } catch (e) { bad.push(accessFriendly(e, userFriendly)) }
    }
    if (!bad.length) for (const c of remove) {
      try { await users.revoke(c.id, reason.trim()); ok++ } catch (e) { bad.push(accessFriendly(e, userFriendly)) }
    }
    setBusy(false)
    if (bad.length) return setErr(`${ok ? L(`${n(ok)}টি হয়েছে; `, `${ok} done; `) : ''}${L('হয়নি', 'failed')}: ${[...new Set(bad)].join(' · ')}`)
    onDone(L('তথ্যের সীমা সেভ হয়েছে', 'Data limit saved'))
  }

  return <Modal wide title={roleId ? `${L('তথ্যের সীমা বদলান', 'Change the data limit')} — ${roleName(r, lang)}` : L('রোল দিন', 'Add a role')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void go()}>{busy ? L('সেভ হচ্ছে…', 'Saving…') : L('সেভ করুন', 'Save')}</button></>}>
    <p className="muted small"><b>{u.full_name || u.email}</b> — {L('এই রোলের অনুমতি শুধু নিচে বাছা জায়গার তথ্যে খাটবে।', 'this role’s permissions will apply only to the data of the places chosen below.')}</p>
    {!roleId && <Field label={L('রোল', 'Role')}><select value={role} onChange={e => chooseRole(e.target.value)}><option value="">{L('বেছে নিন…', 'Choose…')}</option>
      {choices.map(x => <option key={x.id} value={x.id}>{roleName(x, lang)}{x.is_super ? ` — ${L('সব ক্ষমতা', 'full control')}` : ''}</option>)}</select></Field>}
    {r?.is_super && <p className="notice">{L('সুপার অ্যাডমিন শুধু পুরো কোম্পানির জন্যই দেওয়া যায় — এই রোলে কোনো সীমা খাটে না।', 'Super Admin can only be given for the whole company — no limit applies to it.')}</p>}
    <PlacePicker value={r?.is_super ? { all: true, zones: [], hubs: [] } : pick} onChange={setPick} onlyAll={!!r?.is_super} />
    <div className="hr-form" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', marginTop: 10 }}>
      <Field label={L('নতুন জায়গার শেষ তারিখ (ঐচ্ছিক)', 'End date for new places (optional)')} hint={L('অস্থায়ী দায়িত্ব হলে', 'For temporary duty')}><input type="date" value={until} onChange={e => setUntil(e.target.value)} /></Field>
      {remove.length > 0 && <Field label={L('বাদ দেওয়ার কারণ', 'Reason for removing')} required><input value={reason} onChange={e => setReason(e.target.value)} placeholder={L('যেমন: অন্য হাবে বদলি', 'e.g. transferred to another hub')} /></Field>}
    </div>
    {(add.length > 0 || remove.length > 0) && <p className="ax-change">
      {add.length > 0 && <span className="plus">+ {L('যোগ হবে', 'will be added')}: {n(add.length)}</span>}
      {remove.length > 0 && <span className="minus">− {L('বাদ যাবে', 'will be removed')}: {remove.map(c => placeText(c, L)).join(' · ')}</span>}</p>}
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}

function DropRole({ u, rows, onClose, onDone }: { u: UserRow; rows: RoleGrant[]; onClose: () => void; onDone: (msg: string) => void }) {
  const { L, lang } = usePrefs()
  const [reason, setReason] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function go() {
    if (!reason.trim()) return setErr(L('কারণ লিখুন', 'Enter a reason'))
    setBusy(true); setErr('')
    try { for (const g of rows) await users.revoke(g.id, reason.trim()); onDone(L('রোল সরানো হয়েছে', 'Role removed')) }
    catch (e) { setErr(accessFriendly(e, userFriendly)) } finally { setBusy(false) }
  }
  return <Modal title={L('রোল সরাবেন?', 'Remove this role?')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button className="danger" disabled={busy} onClick={() => void go()}>{L('সরান', 'Remove')}</button></>}>
    <p><strong>{roleName(rows[0], lang)}</strong> — {u.full_name || u.email}</p>
    <p className="ax-chips">{rows.map(g => <PlaceChip key={g.id} g={g} />)}</p>
    <p className="muted small">{L('সব জায়গা থেকে এই রোল সরে যাবে। সরানো রোল ইতিহাসে থেকে যায় (কে, কবে, কেন)।', 'The role is removed from every place. Removed roles stay in the history (who, when, why).')}</p>
    <Field label={L('কারণ', 'Reason')}><input value={reason} onChange={e => setReason(e.target.value)} /></Field>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}
