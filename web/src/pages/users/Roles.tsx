import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { ACTION_LABEL, ACTIONS, MODULE_LABEL, RESOURCE_LABEL, roles, type Permission, type RoleRow } from '../../lib/roles'
import { userFriendly } from '../../lib/users'

const isSuper = (grants: { is_super: boolean; scope_type: string }[]) => grants.some(g => g.is_super && g.scope_type === 'global')

/** List of roles. */
export function Roles() {
  const { grants } = useAuth()
  const { L, n, lang } = usePrefs()
  const nav = useNavigate()
  const list = useLoad(() => roles.list(), [])
  const sup = isSuper(grants)
  const rows = (list.data ?? []).filter(r => !r.archived_at)
  return <AppShell title={L('রোল ও অনুমতি', 'Roles & permissions')}
    subtitle={L('কোন রোল কী দেখবে আর কী করতে পারবে — এখানে ঠিক করুন। মেনু আর সব নিয়ম এই অনুমতি মেনেই চলে।', 'Decide what each role can see and do. The menu and every rule follow these permissions.')}
    actions={sup ? <button onClick={() => nav('/app/roles/new')}>+ {L('নতুন রোল', 'New role')}</button> : null}>
    {!sup && <p className="notice">{L('রোল বানানো বা অনুমতি বদলানো শুধু সুপার অ্যাডমিন পারেন। আপনি দেখতে পারেন।', 'Only the Super Admin can create roles or change permissions. You can view them.')}</p>}
    {list.error ? <p className="da-error">{userFriendly(list.error)}</p> : null}
    <section className="panel">
      <DataTable<RoleRow> title={L('রোল তালিকা', 'Roles')} file="roles" rows={rows} rowKey={r => r.id} onRowClick={r => nav(`/app/roles/${r.id}`)}
        empty={<p className="muted">{list.loading ? L('লোড হচ্ছে…', 'Loading…') : L('কোনো রোল নেই', 'No roles')}</p>} cols={[
          { key: 'name', label: L('রোল', 'Role'), value: r => lang === 'bn' && r.name_bn ? r.name_bn : r.name,
            render: r => <><strong>{lang === 'bn' && r.name_bn ? r.name_bn : r.name}</strong>{r.description && <span className="sec">{r.description}</span>}</> },
          { key: 'type', label: L('ধরন', 'Type'), value: r => r.is_super ? 'super' : r.is_system ? 'system' : 'custom',
            render: r => r.is_super ? <Badge tone="bad">{L('সব ক্ষমতা', 'Full control')}</Badge> : r.is_system ? <Badge tone="neutral">{L('শুরুর রোল', 'Built-in')}</Badge> : <Badge tone="info">{L('নিজের বানানো', 'Custom')}</Badge> },
          { key: 'perms', label: L('অনুমতি', 'Permissions'), value: r => r.is_super ? L('সব', 'All') : n(r.permission_count) },
          { key: 'users', label: L('ইউজার', 'Users'), value: r => n(r.user_count) },
        ]} />
    </section>
  </AppShell>
}

/** Create or edit one role: names + permission matrix. */
export function RoleEditor() {
  const { id = 'new' } = useParams()
  const { grants, refreshGrants } = useAuth()
  const { L, n, lang } = usePrefs()
  const nav = useNavigate()
  const { toast, node } = useToast()
  const data = useLoad(async () => {
    const [list, perms] = await Promise.all([roles.list(), roles.permissions()])
    return { list, perms }
  }, [id])
  const role = data.data?.list.find(r => r.id === id) ?? null
  const isNew = id === 'new'
  const canEdit = isSuper(grants) && !role?.is_super && !role?.archived_at
  const [f, setF] = useState({ name: '', name_bn: '', description: '' })
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [archive, setArchive] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!data.data) return
    // Super Admin always holds every permission: show them all ticked (read-only).
    if (role) { setF({ name: role.name, name_bn: role.name_bn ?? '', description: role.description ?? '' }); setSel(new Set(role.is_super ? (data.data.perms ?? []).map(p => p.code) : role.permissions)) }
    else { setF({ name: '', name_bn: '', description: '' }); setSel(new Set()) }
    setDirty(false)
  }, [data.data, role?.id])

  // module -> resource -> action -> code
  const groups = useMemo(() => {
    const g: Record<string, Record<string, Record<string, Permission>>> = {}
    for (const p of data.data?.perms ?? []) {
      const key = `${p.module}.${p.resource}`
      const label = `${RESOURCE_LABEL[key] ?? ''} ${p.resource} ${p.description ?? ''}`.toLowerCase()
      if (q.trim() && !label.includes(q.trim().toLowerCase())) continue
      ;((g[p.module] ??= {})[p.resource] ??= {})[p.action] = p
    }
    return g
  }, [data.data, q])

  const toggle = (codes: string[], on: boolean) => {
    if (!canEdit) return
    setSel(s => { const x = new Set(s); codes.forEach(c => on ? x.add(c) : x.delete(c)); return x }); setDirty(true)
  }
  const copyFrom = (rid: string) => { const r = data.data?.list.find(x => x.id === rid); if (r) { setSel(new Set(r.permissions)); setDirty(true) } }

  async function save() {
    setErr('')
    if (!f.name.trim()) return setErr(L('রোলের ইংরেজি নাম দিন', 'Enter the role name'))
    setBusy(true)
    try {
      const rid = await roles.save(isNew ? null : id, f.name.trim(), f.name_bn.trim(), f.description.trim(), [...sel])
      await refreshGrants().catch(() => undefined)
      toast(L('রোল সেভ হয়েছে', 'Role saved')); setDirty(false)
      if (isNew) nav(`/app/roles/${rid}`, { replace: true }); else void data.reload()
    } catch (e) { setErr(userFriendly(e)) } finally { setBusy(false) }
  }

  const title = isNew ? L('নতুন রোল', 'New role') : role ? (lang === 'bn' && role.name_bn ? role.name_bn : role.name) : L('রোল', 'Role')
  if (!isNew && data.data && !role) return <AppShell title={title}><p className="muted">{L('রোল পাওয়া যায়নি।', 'Role not found.')}</p><Link to="/app/roles">← {L('রোল তালিকা', 'Roles')}</Link></AppShell>

  return <AppShell title={title} subtitle={<Link to="/app/roles">← {L('রোল তালিকা', 'Roles')}</Link>}
    actions={canEdit ? <>
      {role && !role.is_system && <button className="danger" onClick={() => setArchive(true)}>{L('আর্কাইভ', 'Archive')}</button>}
      <button disabled={busy || (!dirty && !isNew)} onClick={() => void save()}>{busy ? L('সেভ হচ্ছে…', 'Saving…') : L('সেভ করুন', 'Save')}</button>
    </> : null}>
    {node}
    {role?.is_super && <p className="notice">{L('সুপার অ্যাডমিনের সব অনুমতি সবসময় থাকে — এটা বদলানো যায় না।', 'The Super Admin always has every permission; it cannot be changed.')}</p>}
    {role?.archived_at && <p className="notice">{L('এই রোল আর্কাইভ করা — আর কাউকে দেওয়া যাবে না।', 'This role is archived and cannot be given to anyone.')}</p>}
    {!isSuper(grants) && <p className="notice">{L('শুধু দেখতে পারছেন — বদলাতে পারেন শুধু সুপার অ্যাডমিন।', 'View only — only the Super Admin can change roles.')}</p>}
    {err && <p className="da-error">{err}</p>}

    <section className="panel">
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label={L('রোলের নাম (ইংরেজি)', 'Role name (English)')} hint={role ? undefined : L('যেমন: Hub Cashier', 'e.g. Hub Cashier')}>
          <input value={f.name} disabled={!canEdit} onChange={e => { setF({ ...f, name: e.target.value }); setDirty(true) }} /></Field>
        <Field label={L('রোলের নাম (বাংলা)', 'Role name (Bangla)')}><input value={f.name_bn} disabled={!canEdit} onChange={e => { setF({ ...f, name_bn: e.target.value }); setDirty(true) }} /></Field>
        <Field wide label={L('বিবরণ', 'Description')}><input value={f.description} disabled={!canEdit} onChange={e => { setF({ ...f, description: e.target.value }); setDirty(true) }} /></Field>
        {canEdit && isNew && <Field label={L('অন্য রোল থেকে অনুমতি কপি', 'Copy permissions from')}>
          <select defaultValue="" onChange={e => e.target.value && copyFrom(e.target.value)}><option value="">—</option>
            {data.data?.list.filter(r => !r.is_super && !r.archived_at).map(r => <option key={r.id} value={r.id}>{lang === 'bn' && r.name_bn ? r.name_bn : r.name}</option>)}</select></Field>}
      </div>
    </section>

    {<section className="panel">
      <div className="da-bar"><h2 style={{ margin: 0 }}>{L('অনুমতি', 'Permissions')} <span className="muted small">({n(sel.size)} {L('টি বাছাই', 'selected')})</span></h2>
        <input type="search" placeholder={L('অনুমতি খুঁজুন…', 'Search permissions…')} value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 260 }} /></div>
      <p className="muted small">{L('“দেখা” না দিলে ওই পাতা মেনুতেই আসবে না। জোন/হাবের রোলে অনুমতি শুধু সেই জোন/হাবের তথ্যে খাটে।',
        'Without “View” the page does not appear in the menu. For zone/hub roles the permission applies only to that zone/hub.')}</p>
      {Object.entries(groups).map(([mod, res]) => {
        const all = Object.values(res).flatMap(a => Object.values(a).map(p => p.code))
        const on = all.filter(c => sel.has(c)).length
        const acts = ACTIONS.filter(a => Object.values(res).some(r => r[a]))
        return <div key={mod} style={{ marginTop: 14 }}>
          <div className="da-bar" style={{ marginBottom: 6 }}>
            <strong>{MODULE_LABEL[mod] ? L(...MODULE_LABEL[mod]) : mod} <span className="muted small">{n(on)}/{n(all.length)}</span></strong>
            {canEdit && <span style={{ display: 'flex', gap: 6 }}>
              <button className="secondary sm" onClick={() => toggle(all, true)}>{L('সব দিন', 'All')}</button>
              <button className="secondary sm" onClick={() => toggle(all, false)}>{L('সব তুলুন', 'None')}</button></span>}
          </div>
          <div className="da-table-wrap"><table className="da-table perm-table">
            <thead><tr><th>{L('বিষয়', 'Area')}</th>{acts.map(a => <th key={a} style={{ textAlign: 'center' }}>{ACTION_LABEL[a] ? L(...ACTION_LABEL[a]) : a}</th>)}</tr></thead>
            <tbody>{Object.entries(res).map(([r, byAct]) => {
              const codes = Object.values(byAct).map(p => p.code)
              const rowOn = codes.every(c => sel.has(c))
              return <tr key={r}>
                <td><label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: canEdit ? 'pointer' : 'default' }}>
                  <input type="checkbox" style={{ width: 'auto' }} disabled={!canEdit} checked={rowOn} onChange={e => toggle(codes, e.target.checked)} />
                  <span>{RESOURCE_LABEL[`${mod}.${r}`] ?? r}<span className="sec">{Object.values(byAct)[0]?.description ?? ''}</span></span></label></td>
                {acts.map(a => <td key={a} style={{ textAlign: 'center' }}>{byAct[a]
                  ? <input type="checkbox" style={{ width: 'auto' }} title={byAct[a].description ?? byAct[a].code} aria-label={`${RESOURCE_LABEL[`${mod}.${r}`] ?? r} ${a}`}
                      disabled={!canEdit} checked={sel.has(byAct[a].code)} onChange={e => toggle([byAct[a].code], e.target.checked)} />
                  : <span className="muted">·</span>}</td>)}
              </tr>
            })}</tbody></table></div>
        </div>
      })}
    </section>}

    {archive && role && <ArchiveRole role={role} onClose={() => setArchive(false)} onDone={() => nav('/app/roles')} />}
  </AppShell>
}

function ArchiveRole({ role, onClose, onDone }: { role: RoleRow; onClose: () => void; onDone: () => void }) {
  const { L } = usePrefs()
  const [reason, setReason] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function go() {
    if (!reason.trim()) return setErr(L('কারণ লিখুন', 'Enter a reason'))
    setBusy(true); setErr('')
    try { await roles.archive(role.id, reason.trim()); onDone() } catch (e) { setErr(userFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title={L('রোল আর্কাইভ করবেন?', 'Archive this role?')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button className="danger" disabled={busy} onClick={() => void go()}>{L('আর্কাইভ', 'Archive')}</button></>}>
    <p className="muted small">{L('যাঁদের এই রোল আছে, আগে তাঁদের থেকে সরাতে হবে। আর্কাইভ করা রোল ইতিহাসে থেকে যায়।', 'Remove it from every user first. Archived roles stay in the history.')}</p>
    <Field label={L('কারণ', 'Reason')}><input value={reason} onChange={e => setReason(e.target.value)} /></Field>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}
