import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { SCOPE_LABEL, strongEnough, tempPassword, userFriendly, users, type RoleGrant, type UserRow } from '../../lib/users'
import { AccountBadge, emptyPick, PasswordNote, RoleScopePicker, roleText, type RolePick } from './common'

export function UserDetail() {
  const { id = '' } = useParams()
  const { can, session } = useAuth()
  const { L, n, lang } = usePrefs()
  const list = useLoad(() => users.list(), [id])
  const logins = useLoad(() => users.logins(id), [id])
  const { toast, node } = useToast()
  const [modal, setModal] = useState<null | 'status' | 'assign' | 'reset' | { revoke: RoleGrant }>(null)
  const u = list.data?.find(x => x.id === id)
  const fmt = (v: string | null) => v ? new Date(v).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
  const reload = () => { void list.reload(); void logins.reload() }
  const self = id === session?.user.id
  const manage = !!u?.can_manage

  async function unlock() {
    try { await users.unlock(id); toast(L('লক খোলা হয়েছে', 'Unlocked')); reload() } catch (e) { toast(userFriendly(e)) }
  }

  if (!u) return <AppShell title={L('ইউজার', 'User')}>
    {list.error ? <p className="da-error">{userFriendly(list.error)}</p> : <p className="muted">{list.loading ? L('লোড হচ্ছে…', 'Loading…') : L('অ্যাকাউন্ট পাওয়া যায়নি।', 'Account not found.')}</p>}
    <Link to="/app/users">← {L('ইউজার তালিকা', 'User list')}</Link>
  </AppShell>

  return <AppShell title={u.full_name || u.email || L('ইউজার', 'User')} subtitle={<><Link to="/app/users">← {L('ইউজার তালিকা', 'User list')}</Link> · {u.email}</>}
    actions={manage ? <>
      {u.locked && <button className="secondary" onClick={() => void unlock()}>{L('লক খুলুন', 'Unlock')}</button>}
      <button className="secondary" onClick={() => setModal('reset')}>{L('পাসওয়ার্ড রিসেট', 'Reset password')}</button>
      <button className={u.status === 'active' ? 'danger' : ''} onClick={() => setModal('status')}>{u.status === 'active' ? L('অ্যাকাউন্ট বন্ধ করুন', 'Disable account') : L('আবার চালু করুন', 'Enable account')}</button>
    </> : null}>
    {node}
    {self && <p className="notice">{L('এটা আপনার নিজের অ্যাকাউন্ট। নিজের অ্যাকাউন্ট বন্ধ বা নিজের রোল বদলানো যায় না — অন্য একজন অ্যাডমিন করবেন।', 'This is your own account. You cannot disable it or change your own roles — another admin must.')}</p>}
    {!self && !manage && <p className="notice">{!can('system.user.edit') ? L('আপনি শুধু দেখতে পারেন। অ্যাকাউন্ট বদলাতে অ্যাডমিনের অনুমতি লাগে।', 'You can only view. Changing accounts needs admin rights.')
      : L('এই অ্যাকাউন্টে এমন রোল আছে যা আপনি দিতে পারেন না, তাই এটা বদলানোর অনুমতি নেই।', 'This account holds a role you cannot grant, so you cannot change it.')}</p>}

    <section className="panel">
      <h2>{L('অ্যাকাউন্ট', 'Account')}</h2>
      <dl className="hr-kv">
        <dt>{L('অবস্থা', 'Status')}</dt><dd><AccountBadge u={u} />{u.locked && u.locked_until ? <span className="muted small"> {L('খুলবে', 'until')} {fmt(u.locked_until)}</span> : null}</dd>
        <dt>{L('ইমেইল', 'Email')}</dt><dd>{u.email ?? '—'}</dd>
        <dt>{L('মোবাইল', 'Mobile')}</dt><dd>{u.phone ?? '—'}</dd>
        <dt>{L('কর্মী', 'Employee')}</dt><dd>{u.employee_id ? <Link to={`/app/hr/employees/${u.employee_id}`}>{u.employee_code ?? L('প্রোফাইল দেখুন', 'Open profile')}</Link> : L('যুক্ত নয়', 'Not linked')}</dd>
        <dt>{L('শেষ লগইন', 'Last sign-in')}</dt><dd>{fmt(u.last_login_at)}</dd>
        <dt>{L('ভুল পাসওয়ার্ড (পরপর)', 'Failed attempts')}</dt><dd>{n(u.failed_login_count)}</dd>
        <dt>{L('তৈরি', 'Created')}</dt><dd>{fmt(u.created_at)}</dd>
      </dl>
    </section>

    <section className="panel">
      <div className="da-bar"><h2 style={{ margin: 0 }}>{L('রোল ও জায়গা', 'Roles & places')}</h2>
        {can('system.user_role.create') && !self && u.status === 'active' && <button className="sm" onClick={() => setModal('assign')}>+ {L('রোল দিন', 'Add role')}</button>}</div>
      {!u.roles.length ? <p className="muted">{L('কোনো রোল নেই — এই অ্যাকাউন্ট লগইন করলেও কিছু দেখতে পাবে না।', 'No role — this account sees nothing after signing in.')}</p> :
        <div className="da-table-wrap"><table className="da-table"><thead><tr><th>{L('রোল', 'Role')}</th><th>{L('জায়গা', 'Place')}</th><th>{L('থেকে', 'From')}</th><th>{L('পর্যন্ত', 'Until')}</th><th /></tr></thead>
          <tbody>{u.roles.map(r => <tr key={r.id}>
            <td><strong>{lang === 'bn' && r.name_bn ? r.name_bn : r.name}</strong>{r.is_super && <> <Badge tone="bad">{L('সব ক্ষমতা', 'Full control')}</Badge></>}</td>
            <td>{r.scope_type === 'global' ? L(...SCOPE_LABEL.global) : r.hub ?? r.zone}</td>
            <td>{r.valid_from}</td><td>{r.valid_to ?? '—'}</td>
            <td style={{ textAlign: 'right' }}>{can('system.user_role.edit') && !self && <button className="secondary sm" onClick={() => setModal({ revoke: r })}>{L('সরান', 'Remove')}</button>}</td>
          </tr>)}</tbody></table></div>}
    </section>

    <section className="panel">
      <h2>{L('লগইন ইতিহাস', 'Sign-in history')}</h2>
      {!logins.data?.length ? <p className="muted">{L('এখনো কোনো লগইন নেই।', 'No sign-ins yet.')}</p> :
        <div className="da-table-wrap"><table className="da-table"><thead><tr><th>{L('সময়', 'Time')}</th><th>{L('ফল', 'Result')}</th><th>IP</th></tr></thead>
          <tbody>{logins.data.map(e => <tr key={e.id}><td>{fmt(e.occurred_at)}</td>
            <td>{e.success ? <Badge tone="ok">{L('সফল', 'OK')}</Badge> : <Badge tone="bad">{L('ব্যর্থ', 'Failed')}</Badge>}</td><td className="muted small">{e.ip_address ?? '—'}</td></tr>)}</tbody></table></div>}
    </section>

    {modal === 'status' && <StatusModal u={u} onClose={() => setModal(null)} onDone={m => { toast(m); setModal(null); reload() }} />}
    {modal === 'assign' && <AssignModal u={u} onClose={() => setModal(null)} onDone={() => { toast(L('রোল দেওয়া হয়েছে', 'Role added')); setModal(null); reload() }} />}
    {modal === 'reset' && <ResetModal u={u} onClose={() => { setModal(null); reload() }} />}
    {modal && typeof modal === 'object' && <RevokeModal r={modal.revoke} label={roleText(modal.revoke, lang)} onClose={() => setModal(null)} onDone={() => { toast(L('রোল সরানো হয়েছে', 'Role removed')); setModal(null); reload() }} />}
  </AppShell>
}

function StatusModal({ u, onClose, onDone }: { u: UserRow; onClose: () => void; onDone: (msg: string) => void }) {
  const { L } = usePrefs()
  const off = u.status === 'active'
  const [reason, setReason] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function go() {
    if (!reason.trim()) return setErr(L('কারণ লিখুন', 'Enter a reason'))
    setBusy(true); setErr('')
    try { await users.setStatus(u.id, !off, reason.trim()); onDone(off ? L('অ্যাকাউন্ট বন্ধ হয়েছে', 'Account disabled') : L('অ্যাকাউন্ট চালু হয়েছে', 'Account enabled')) }
    catch (e) { setErr(userFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title={off ? L('অ্যাকাউন্ট বন্ধ করবেন?', 'Disable this account?') : L('অ্যাকাউন্ট আবার চালু করবেন?', 'Enable this account?')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button className={off ? 'danger' : ''} disabled={busy} onClick={() => void go()}>{off ? L('বন্ধ করুন', 'Disable') : L('চালু করুন', 'Enable')}</button></>}>
    <p className="muted small">{off ? L('বন্ধ করলে সাথে সাথে কোনো তথ্য দেখতে পারবেন না এবং আর লগইন করতে পারবেন না। রোলগুলো থেকে যাবে, পরে আবার চালু করা যাবে।',
      'Disabling stops all data access at once and blocks sign-in. Roles are kept, so you can enable it again later.') : L('চালু করলে আগের রোলগুলো নিয়েই আবার কাজ করতে পারবেন।', 'Enabling restores access with the existing roles.')}</p>
    <Field label={L('কারণ', 'Reason')}><input value={reason} onChange={e => setReason(e.target.value)} placeholder={off ? L('যেমন: চাকরি ছেড়েছেন', 'e.g. left the company') : ''} /></Field>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

function AssignModal({ u, onClose, onDone }: { u: UserRow; onClose: () => void; onDone: () => void }) {
  const { L } = usePrefs()
  const [pick, setPick] = useState<RolePick>(emptyPick)
  const [until, setUntil] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function go() {
    if (!pick.role) return setErr(L('জায়গা ও রোল বেছে নিন', 'Choose the place and role'))
    setBusy(true); setErr('')
    try { await users.assign(u.id, pick.role, pick.scope, pick.scope === 'zone' ? pick.zone : null, pick.scope === 'hub' ? pick.hub : null, until || null); onDone() }
    catch (e) { setErr(userFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title={L('রোল দিন', 'Add a role')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void go()}>{L('রোল দিন', 'Add role')}</button></>}>
    <p className="muted small">{L('একজনের একাধিক রোল থাকতে পারে, যেমন দুটি হাবের হাব ম্যানেজার। তালিকায় শুধু সেই রোলগুলো আসে যা আপনি ওই জায়গায় দিতে পারেন।',
      'One person may hold several roles, e.g. Hub Manager of two hubs. The list shows only roles you may grant at that place.')}</p>
    <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <RoleScopePicker value={pick} onChange={setPick} />
      <Field label={L('শেষ তারিখ (ঐচ্ছিক)', 'End date (optional)')} hint={L('অস্থায়ী দায়িত্ব হলে', 'For temporary duty')}><input type="date" value={until} onChange={e => setUntil(e.target.value)} /></Field>
    </div>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

function RevokeModal({ r, label, onClose, onDone }: { r: RoleGrant; label: string; onClose: () => void; onDone: () => void }) {
  const { L } = usePrefs()
  const [reason, setReason] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function go() {
    if (!reason.trim()) return setErr(L('কারণ লিখুন', 'Enter a reason'))
    setBusy(true); setErr('')
    try { await users.revoke(r.id, reason.trim()); onDone() } catch (e) { setErr(userFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title={L('রোল সরাবেন?', 'Remove this role?')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button className="danger" disabled={busy} onClick={() => void go()}>{L('সরান', 'Remove')}</button></>}>
    <p><strong>{label}</strong></p>
    <p className="muted small">{L('সরানো রোল ইতিহাসে থেকে যায় (কে, কবে, কেন)।', 'Removed roles stay in the history (who, when, why).')}</p>
    <Field label={L('কারণ', 'Reason')}><input value={reason} onChange={e => setReason(e.target.value)} placeholder={L('যেমন: অন্য হাবে বদলি', 'e.g. transferred to another hub')} /></Field>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

function ResetModal({ u, onClose }: { u: UserRow; onClose: () => void }) {
  const { L } = usePrefs()
  const [pw, setPw] = useState(tempPassword())
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false)
  async function go() {
    if (!strongEnough(pw)) return setErr(L('পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের, অক্ষর ও সংখ্যা দুটোই লাগবে', 'Password: at least 8 characters with letters and digits'))
    setBusy(true); setErr('')
    try { await users.resetPassword(u.id, pw); setDone(true) } catch (e) { setErr(userFriendly(e)) } finally { setBusy(false) }
  }
  if (done) return <Modal title={L('নতুন পাসওয়ার্ড', 'New password')} onClose={onClose} actions={<button onClick={onClose}>{L('ঠিক আছে', 'Done')}</button>}>
    <PasswordNote email={u.email ?? ''} password={pw} />
  </Modal>
  return <Modal title={L('পাসওয়ার্ড রিসেট', 'Reset password')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void go()}>{L('রিসেট করুন', 'Reset')}</button></>}>
    <p className="muted small">{L('নতুন অস্থায়ী পাসওয়ার্ড বসবে, লক খুলে যাবে। পরের লগইনে তাঁকে নিজের পাসওয়ার্ড দিতে হবে।',
      'A new temporary password is set and any lock is cleared. They must choose their own password at next sign-in.')}</p>
    <Field label={L('অস্থায়ী পাসওয়ার্ড', 'Temporary password')}>
      <span style={{ display: 'flex', gap: 6 }}><input value={pw} onChange={e => setPw(e.target.value)} style={{ flex: 1 }} />
        <button type="button" className="secondary sm" onClick={() => setPw(tempPassword())}>{L('নতুন', 'New')}</button></span></Field>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}
