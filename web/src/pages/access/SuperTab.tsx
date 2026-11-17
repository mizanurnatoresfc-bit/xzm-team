// Super Admin — full control: who holds it, what it guarantees, and the tools only a Super Admin uses.
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { ViewAsPicker } from '../../components/ViewAs'
import { Badge, Field, Modal, useToast } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { accessFriendly, type Override } from '../../lib/access'
import { download, xlsxBlob } from '../../lib/xlsx'
import { userFriendly, users, type RoleGrant, type UserRow } from '../../lib/users'
import { AccountBadge } from '../users/common'
import type { CenterData } from './AccessCenter'
import { moduleName, permName, placeText, roleName } from './common'

export function SuperTab({ d }: { d: CenterData }) {
  const { L, n, lang } = usePrefs()
  const { session } = useAuth()
  const nav = useNavigate()
  const { toast, node } = useToast()
  const [asRole, setAsRole] = useState(false)
  const [add, setAdd] = useState(false)
  const [drop, setDrop] = useState<null | { u: UserRow; g: RoleGrant }>(null)
  const people = useMemo(() => (d.people ?? []).filter(u => !u.archived_at), [d.people])
  const supers = people.filter(u => u.roles.some(r => r.is_super))
  const superRole = (d.base.data?.list ?? []).find(r => r.is_super && !r.archived_at)
  const live = d.overrides.filter(o => o.live)
  const fmt = (v: string | null) => (v ? new Date(v).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

  /** Every role against every permission, as one Excel sheet. */
  function exportMatrix() {
    const list = (d.base.data?.list ?? []).filter(r => !r.archived_at)
    const perms = d.base.data?.perms ?? []
    const heads = [L('মডিউল', 'Module'), L('অনুমতি', 'Permission'), L('কোড', 'Code'), ...list.map(r => roleName(r, lang))]
    const rows = perms.map(p => [moduleName(p.module, lang), permName(p, p.code, lang), p.code, ...list.map(r => (r.is_super || r.permissions.includes(p.code) ? '✓' : ''))])
    download(xlsxBlob(L('রোল ও অনুমতির ছক', 'Roles & permissions matrix'), new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' }), heads, rows), 'roles-permissions-matrix.xlsx')
  }

  const rules: Array<[string, string]> = [
    ['সুপার অ্যাডমিনের সব অনুমতি সবসময় থাকে — সব মডিউল, সব সাব-মেনু, সব হাব ও জোনে।', 'A Super Admin always holds every permission — every module, sub-menu, hub and zone.'],
    ['এই ক্ষমতা কমানো যায় না: সুপার অ্যাডমিনের জন্য কোনো অনুমতি বন্ধ করা, পাতা লুকানো বা হাব/জোনে সীমিত করা — কোনোটাই খাটে না।', 'It cannot be reduced: switching a permission off, hiding a page or limiting to a hub / zone never applies to a Super Admin.'],
    ['রোল বানানো, রোলের অনুমতি বা পাতা বদলানো, কাউকে আলাদা অনুমতি দেওয়া/বন্ধ করা — শুধু সুপার অ্যাডমিনই পারেন। ডাটাবেস নিজে এটা যাচাই করে।', 'Creating roles, changing a role’s permissions or pages, giving or switching off a personal permission — only a Super Admin can. The database itself checks this.'],
    ['সুপার অ্যাডমিন রোল শুধু আরেকজন সুপার অ্যাডমিনই দিতে বা সরাতে পারেন, আর শেষ সুপার অ্যাডমিনকে সরানো বা বন্ধ করা যায় না।', 'Only a Super Admin gives or removes the Super Admin role, and the last one can never be removed or switched off.'],
    ['সুপার অ্যাডমিনের প্রতিটি বদল “বদলের ইতিহাস”-এ লেখা থাকে — মুছে ফেলা যায় না।', 'Every change a Super Admin makes is written in the change history — it cannot be erased.'],
  ]

  return <>
    {node}
    <section className="panel ax-super">
      <div className="ax-super-h"><span className="i"><Icon name="key" size={26} /></span>
        <div><h2>{L('সুপার অ্যাডমিন — পূর্ণ নিয়ন্ত্রণ', 'Super Admin — full control')}</h2>
          <p className="muted">{d.sup ? L('আপনি সুপার অ্যাডমিন। এই পাতার সব কিছু আপনার হাতে।', 'You are a Super Admin. Everything on these pages is in your hands.') : L('আপনি সুপার অ্যাডমিন নন — এখানে শুধু দেখতে পারেন।', 'You are not a Super Admin — you can only look here.')}</p></div></div>
      <ul className="ax-rules">{rules.map(([bn, en]) => <li key={en}><Icon name="check" size={16} />{L(bn, en)}</li>)}</ul>
    </section>

    <section className="panel">
      <div className="da-bar"><h2 style={{ margin: 0 }}>{L('যাঁরা সুপার অ্যাডমিন', 'Who is a Super Admin')} <span className="count-pill">{n(supers.length)}</span></h2>
        {d.sup && superRole && <button className="sm" onClick={() => setAdd(true)}>+ {L('আরেকজনকে সুপার অ্যাডমিন করুন', 'Make someone a Super Admin')}</button>}</div>
      {supers.length === 1 && <p className="notice">{L('সুপার অ্যাডমিন মাত্র একজন। তাঁর পাসওয়ার্ড হারালে বা অ্যাকাউন্ট লক হলে কেউ ঠিক করতে পারবে না — বিশ্বস্ত আরেকজনকে রাখুন।', 'There is only one Super Admin. If that password is lost or the account locks, nobody can fix it — keep a second trusted one.')}</p>}
      {!d.people ? <p className="muted">{d.peopleError ? userFriendly(d.peopleError) : L('লোড হচ্ছে…', 'Loading…')}</p>
        : <ul className="ax-people big">{supers.map(u => { const g = u.roles.find(r => r.is_super)!; const me = u.id === session?.user.id
          return <li key={u.id}><span className="ax-av" aria-hidden="true">{(u.full_name || u.email || '?').slice(0, 2).toUpperCase()}</span>
            <span className="tx"><b>{u.full_name || '—'}{me ? ` (${L('আপনি', 'you')})` : ''}</b><small>{u.email} · {L('শেষ লগইন', 'last sign-in')}: {fmt(u.last_login_at)}</small></span>
            <AccountBadge u={u} />
            <Link to={`/app/access/user/${u.id}`} className="small">{L('দেখুন', 'Open')}</Link>
            {d.sup && !me && supers.length > 1 && <button className="danger sm" onClick={() => setDrop({ u, g })}>{L('সরান', 'Remove')}</button>}</li> })}</ul>}
    </section>

    <section className="panel">
      <h2>{L('সুপার অ্যাডমিনের টুল', 'Super Admin tools')}</h2>
      <div className="ax-toolgrid">
        {d.sup && <button type="button" className="ax-tool" onClick={() => setAsRole(true)}><span className="i"><Icon name="eye" size={20} /></span><span className="tx"><b>{L('রোল হিসেবে দেখুন', 'View as a role')}</b><small>{L('একটা রোল বেছে দেখুন মেনু, পাতা ও বোতাম ওই রোল কেমন পায়', 'Pick a role and see the menu, pages and buttons the way it gets them')}</small></span></button>}
        <button type="button" className="ax-tool" data-export-matrix onClick={exportMatrix}><span className="i"><Icon name="xls" size={20} /></span><span className="tx"><b>{L('রোল × অনুমতির ছক (এক্সেল)', 'Roles × permissions matrix (Excel)')}</b><small>{L('কোন রোলে কোন অনুমতি আছে — এক পাতায়', 'Which role holds which permission — on one sheet')}</small></span></button>
        <button type="button" className="ax-tool" onClick={() => nav('/app/access/history')}><span className="i"><Icon name="log" size={20} /></span><span className="tx"><b>{L('বদলের ইতিহাস', 'Change history')}</b><small>{L('কে কখন কী বদলেছে', 'Who changed what and when')}</small></span></button>
        <button type="button" className="ax-tool" onClick={() => nav('/app/role-dashboards')}><span className="i"><Icon name="chart" size={20} /></span><span className="tx"><b>{L('রোল অনুযায়ী ড্যাশবোর্ড', 'Dashboard by role')}</b><small>{L('কোন রোল হোম পেজে কী দেখবে', 'What each role sees on its home page')}</small></span></button>
        <button type="button" className="ax-tool" onClick={() => nav('/app/users')}><span className="i"><Icon name="users" size={20} /></span><span className="tx"><b>{L('ইউজার ও লগইন', 'Users & logins')}</b><small>{L('লগইন বানানো, পাসওয়ার্ড রিসেট, অ্যাকাউন্ট চালু/বন্ধ', 'Create logins, reset passwords, switch accounts on or off')}</small></span></button>
      </div>
    </section>

    {d.installed && <section className="panel">
      <h2>{L('সব ব্যক্তিগত অনুমতি (যাঁদের রোলের বাইরে আলাদা কিছু আছে)', 'Every personal permission (people who differ from their roles)')}</h2>
      <DataTable<Override> title={L('ব্যক্তিগত অনুমতি', 'Personal permissions')} file="personal-permissions" rows={live} rowKey={o => o.id} onRowClick={o => nav(`/app/access/user/${o.user_id}#own`)} phoneView="list"
        empty={<p className="muted">{L('কারও আলাদা অনুমতি নেই — সবাই শুধু নিজের রোল অনুযায়ী চলছেন।', 'Nobody has a personal permission — everyone follows their roles.')}</p>} cols={[
          { key: 'user', label: L('কার', 'Person'), value: o => o.user_name },
          { key: 'kind', label: L('ধরন', 'Kind'), value: o => (o.effect === 'grant' ? L('বাড়তি', 'Extra') : L('বন্ধ', 'Off')), render: o => (o.effect === 'grant' ? <Badge tone="ok">+ {L('বাড়তি', 'Extra')}</Badge> : <Badge tone="bad">− {L('বন্ধ', 'Off')}</Badge>) },
          { key: 'perm', label: L('অনুমতি', 'Permission'), primary: true, value: o => permName(d.base.catalog.byCode[o.permission], o.permission, lang) },
          { key: 'where', label: L('কোথায়', 'Where'), value: o => (o.effect === 'deny' ? L('সব জায়গায়', 'Everywhere') : placeText(o, L)) },
          { key: 'until', label: L('মেয়াদ', 'Until'), value: o => o.valid_to ?? '' },
          { key: 'reason', label: L('কারণ', 'Reason'), value: o => o.reason },
          { key: 'by', label: L('দিয়েছেন', 'Given by'), value: o => o.created_by_name ?? '' },
        ]} />
    </section>}

    {asRole && <ViewAsPicker onClose={() => setAsRole(false)} />}
    {add && superRole && <AddSuper people={people.filter(u => u.status === 'active' && !u.roles.some(r => r.is_super))} roleId={superRole.id} onClose={() => setAdd(false)}
      onDone={() => { setAdd(false); toast(L('সুপার অ্যাডমিন করা হয়েছে', 'Made a Super Admin')); d.reloadPeople() }} />}
    {drop && <DropSuper u={drop.u} g={drop.g} onClose={() => setDrop(null)} onDone={() => { setDrop(null); toast(L('সুপার অ্যাডমিন থেকে সরানো হয়েছে', 'Removed from Super Admin')); d.reloadPeople() }} />}
  </>
}

function AddSuper({ people, roleId, onClose, onDone }: { people: UserRow[]; roleId: string; onClose: () => void; onDone: () => void }) {
  const { L } = usePrefs()
  const [q, setQ] = useState(''); const [pick, setPick] = useState<UserRow | null>(null); const [sure, setSure] = useState(false)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const s = q.trim().toLowerCase()
  const hits = people.filter(u => !s || `${u.full_name} ${u.email ?? ''} ${u.employee_code ?? ''}`.toLowerCase().includes(s)).slice(0, 8)
  async function go() {
    if (!pick) return setErr(L('একজনকে বেছে নিন', 'Choose a person'))
    if (!sure) return setErr(L('নিচের ঘরে টিক দিন', 'Tick the box below'))
    setBusy(true); setErr('')
    try { await users.assign(pick.id, roleId, 'global'); onDone() } catch (e) { setErr(accessFriendly(e, userFriendly)) } finally { setBusy(false) }
  }
  return <Modal title={L('আরেকজনকে সুপার অ্যাডমিন করুন', 'Make someone a Super Admin')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button className="danger" disabled={busy} onClick={() => void go()}>{L('সুপার অ্যাডমিন করুন', 'Make Super Admin')}</button></>}>
    {pick ? <p className="ax-picked-user"><b>{pick.full_name || pick.email}</b> <span className="muted small">{pick.email}</span> <button type="button" className="link small" onClick={() => { setPick(null); setSure(false) }}>{L('বদলান', 'Change')}</button></p>
      : <><Field label={L('কাকে', 'Who')}><input type="search" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={L('নাম, ইমেইল বা আইডি লিখুন…', 'Type a name, email or ID…')} /></Field>
        <ul className="ax-people pick">{hits.map(u => <li key={u.id}><button type="button" className="secondary" onClick={() => setPick(u)}><span className="tx"><b>{u.full_name || u.email}</b><small>{u.email}</small></span></button></li>)}
          {!hits.length && <li className="muted small">{L('কাউকে পাওয়া যায়নি', 'Nobody found')}</li>}</ul></>}
    <label className="da-check"><input type="checkbox" checked={sure} onChange={e => setSure(e.target.checked)} />
      {L('আমি বুঝেছি: এই ব্যক্তি সব তথ্য দেখতে, সব কিছু বদলাতে এবং অন্যের অনুমতিও ঠিক করতে পারবেন।', 'I understand: this person will see all data, change everything, and set other people’s permissions too.')}</label>
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}

function DropSuper({ u, g, onClose, onDone }: { u: UserRow; g: RoleGrant; onClose: () => void; onDone: () => void }) {
  const { L } = usePrefs()
  const [reason, setReason] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function go() {
    if (!reason.trim()) return setErr(L('কারণ লিখুন', 'Enter a reason'))
    setBusy(true); setErr('')
    try { await users.revoke(g.id, reason.trim()); onDone() } catch (e) { setErr(accessFriendly(e, userFriendly)) } finally { setBusy(false) }
  }
  return <Modal title={L('সুপার অ্যাডমিন থেকে সরাবেন?', 'Remove from Super Admin?')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button className="danger" disabled={busy} onClick={() => void go()}>{L('সরান', 'Remove')}</button></>}>
    <p><strong>{u.full_name || u.email}</strong></p>
    <p className="muted small">{L('সরালে তাঁর শুধু অন্য রোলগুলো (যদি থাকে) থেকে যাবে। শেষ সুপার অ্যাডমিনকে ডাটাবেস সরাতে দেয় না।', 'Only their other roles (if any) remain. The database refuses to remove the last Super Admin.')}</p>
    <Field label={L('কারণ', 'Reason')}><input value={reason} onChange={e => setReason(e.target.value)} /></Field>
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}
