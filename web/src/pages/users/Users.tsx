import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Field, Modal, Stat, useLoad } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { strongEnough, tempPassword, userFriendly, users, type UserRow } from '../../lib/users'
import { AccountBadge, emptyPick, PasswordNote, RoleChips, RoleScopePicker, roleText, type RolePick } from './common'

const when = (v: string | null, lang: string) => v ? new Date(v).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

export function Users() {
  const { can } = useAuth()
  const { L, n, lang } = usePrefs()
  const nav = useNavigate()
  const list = useLoad(() => users.list(), [])
  const [q, setQ] = useState('')
  const [st, setSt] = useState('')
  const [open, setOpen] = useState(false)
  const rows = useMemo(() => (list.data ?? []).filter(u => {
    const s = q.trim().toLowerCase()
    if (s && !`${u.full_name} ${u.email ?? ''} ${u.phone ?? ''} ${u.employee_code ?? ''} ${u.roles.map(r => `${r.name} ${r.name_bn ?? ''} ${r.hub ?? ''} ${r.zone ?? ''}`).join(' ')}`.toLowerCase().includes(s)) return false
    if (st === 'active') return u.status === 'active' && !u.locked && !u.archived_at
    if (st === 'off') return u.status !== 'active' || !!u.archived_at
    if (st === 'locked') return u.locked
    if (st === 'norole') return !u.roles.length
    return true
  }), [list.data, q, st])
  const all = list.data ?? []
  return <AppShell title={L('ইউজার ও রোল', 'Users & roles')}
    subtitle={L('কে লগইন করতে পারবে, আর কোন এরিয়া/হাবে কী কাজ করতে পারবে — এখান থেকে ঠিক করুন।', 'Decide who can sign in, and what they may do in which zone or hub.')}
    actions={can('system.user.create') ? <button onClick={() => setOpen(true)}>+ {L('নতুন লগইন অ্যাকাউন্ট', 'New login account')}</button> : null}>
    <div className="da-stats">
      <Stat icon="users" label={L('মোট অ্যাকাউন্ট', 'Accounts')} value={n(all.length)} />
      <Stat icon="check" tone="ok" label={L('সক্রিয়', 'Active')} value={n(all.filter(u => u.status === 'active' && !u.archived_at).length)} />
      <Stat icon="key" tone="warn" label={L('লক / পাসওয়ার্ড বাকি', 'Locked / password pending')} value={n(all.filter(u => u.locked || u.must_change_password).length)} />
      <Stat icon="shield" label={L('রোল ছাড়া', 'Without a role')} value={n(all.filter(u => !u.roles.length).length)} />
    </div>
    <section className="da-filters panel no-print">
      <Field label={L('খুঁজুন', 'Search')}><input placeholder={L('নাম, ইমেইল, মোবাইল, রোল বা হাব', 'Name, email, mobile, role or hub')} value={q} onChange={e => setQ(e.target.value)} /></Field>
      <Field label={L('অবস্থা', 'Status')}><select value={st} onChange={e => setSt(e.target.value)}>
        <option value="">{L('সব', 'All')}</option><option value="active">{L('সক্রিয়', 'Active')}</option><option value="off">{L('বন্ধ', 'Disabled')}</option>
        <option value="locked">{L('লক', 'Locked')}</option><option value="norole">{L('রোল ছাড়া', 'Without a role')}</option></select></Field>
    </section>
    {list.error ? <p className="da-error">{userFriendly(list.error)}</p> : null}
    <section className="panel">
      <div className="da-bar"><strong>{n(rows.length)} {L('টি অ্যাকাউন্ট', 'accounts')}</strong>{list.loading && <span className="muted small">{L('লোড হচ্ছে…', 'Loading…')}</span>}</div>
      <DataTable<UserRow> title={L('ইউজার তালিকা', 'User list')} file="users" rows={rows} rowKey={u => u.id} onRowClick={u => nav(`/app/users/${u.id}`)}
        empty={<p className="muted">{L('কোনো অ্যাকাউন্ট পাওয়া যায়নি।', 'No accounts found.')}</p>} cols={[
          { key: 'name', label: L('নাম', 'Name'), value: u => u.full_name, render: u => <><strong>{u.full_name || '—'}</strong><span className="sec">{u.email}</span></> },
          { key: 'phone', label: L('মোবাইল', 'Mobile'), value: u => u.phone ?? '' },
          { key: 'roles', label: L('রোল ও জায়গা', 'Role & place'), value: u => u.roles.map(r => roleText(r, lang)).join(', '), render: u => <RoleChips roles={u.roles} /> },
          { key: 'emp', label: L('কর্মী আইডি', 'Employee ID'), value: u => u.employee_code ?? '' },
          { key: 'last', label: L('শেষ লগইন', 'Last sign-in'), value: u => when(u.last_login_at, lang) },
          { key: 'status', label: L('অবস্থা', 'Status'), value: u => u.status, render: u => <AccountBadge u={u} /> },
        ]} />
    </section>
    {open && <NewAccount onClose={() => setOpen(false)} onDone={() => void list.reload()} />}
  </AppShell>
}

function NewAccount({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { L } = usePrefs()
  const free = useLoad(() => users.freeEmployees().catch(() => []), [])
  const [f, setF] = useState({ employee: '', name: '', email: '', phone: '', password: tempPassword() })
  const [pick, setPick] = useState<RolePick>(emptyPick)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ email: string; password: string; warning?: string | null } | null>(null)

  function chooseEmployee(id: string) {
    const e = free.data?.find(x => x.id === id)
    setF({ ...f, employee: id, name: e ? e.full_name : f.name, phone: e?.mobile ?? f.phone, email: e?.email ?? f.email })
    if (e?.hub_id) setPick({ scope: 'hub', zone: '', hub: e.hub_id, role: '' })
  }
  async function go() {
    setErr('')
    if (f.name.trim().length < 2) return setErr(L('পূর্ণ নাম দিন', 'Enter the full name'))
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return setErr(L('সঠিক ইমেইল দিন', 'Enter a valid email'))
    if (!strongEnough(f.password)) return setErr(L('পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের, অক্ষর ও সংখ্যা দুটোই লাগবে', 'Password: at least 8 characters with letters and digits'))
    if (!pick.role) return setErr(L('জায়গা ও রোল বেছে নিন', 'Choose the place and role'))
    setBusy(true)
    try {
      const r = await users.create({ email: f.email.trim(), full_name: f.name.trim(), phone: f.phone.trim(), password: f.password,
        role_id: pick.role, scope_type: pick.scope, zone_id: pick.scope === 'zone' ? pick.zone : null, hub_id: pick.scope === 'hub' ? pick.hub : null,
        employee_id: f.employee || null })
      setDone({ email: f.email.trim(), password: f.password, warning: r.warning }); onDone()
    } catch (e) { setErr(userFriendly(e)) } finally { setBusy(false) }
  }

  if (done) return <Modal title={L('অ্যাকাউন্ট তৈরি হয়েছে', 'Account created')} onClose={onClose} actions={<button onClick={onClose}>{L('ঠিক আছে', 'Done')}</button>}>
    <PasswordNote email={done.email} password={done.password} />
    {done.warning && <p className="notice">{userFriendly(done.warning)}</p>}
  </Modal>

  return <Modal wide title={L('নতুন লগইন অ্যাকাউন্ট', 'New login account')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void go()}>{busy ? L('তৈরি হচ্ছে…', 'Creating…') : L('অ্যাকাউন্ট তৈরি করুন', 'Create account')}</button></>}>
    <p className="muted small">{L('স্টাফ এই ইমেইল আর পাসওয়ার্ড দিয়ে লগইন করবেন। প্রথম লগইনে তাঁকে নিজের পাসওয়ার্ড বসাতে হবে — তার আগে কিছুই খুলবে না।',
      'Staff sign in with this email and password. At first sign-in they must set their own password — nothing opens before that.')}</p>
    <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
      {!!free.data?.length && <Field wide label={L('কর্মী (ঐচ্ছিক)', 'Employee (optional)')} hint={L('কর্মী বেছে নিলে নাম, মোবাইল আর হাব নিজে থেকে বসবে', 'Picking an employee fills name, mobile and hub')}>
        <select value={f.employee} onChange={e => chooseEmployee(e.target.value)}><option value="">{L('— কর্মীর সাথে যুক্ত নয় —', '— not linked to an employee —')}</option>
          {free.data.map(e => <option key={e.id} value={e.id}>{e.employee_code} · {e.full_name}</option>)}</select></Field>}
      <Field label={L('পূর্ণ নাম', 'Full name')}><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
      <Field label={L('ইমেইল (লগইন)', 'Email (login)')}><input type="email" autoComplete="off" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
      <Field label={L('মোবাইল', 'Mobile')}><input inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} placeholder="01711000000" /></Field>
      <Field label={L('অস্থায়ী পাসওয়ার্ড', 'Temporary password')}>
        <span style={{ display: 'flex', gap: 6 }}><input autoComplete="new-password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} style={{ flex: 1 }} />
          <button type="button" className="secondary sm" onClick={() => setF({ ...f, password: tempPassword() })}>{L('নতুন', 'New')}</button></span></Field>
      <RoleScopePicker value={pick} onChange={setPick} />
    </div>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}
