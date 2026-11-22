import { askReason } from '../../components/ask'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { Badge, Field, Modal, useLoad } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { org, type Position } from '../../lib/hr'
import { PersonPicker, type RefPerson } from '../../components/PersonPicker'
import { Icon } from '../../components/Icon'
import { Combo } from '../../components/inputs'
import { refs, type HubPerson } from '../../lib/refs'
import { useOrg } from './common'
import { extraFriendly, fields, PROSPECT_STATUS, referrals, showValue, type CField, type Option, type PCol, type Prospect } from '../../lib/extra'

/** Custom profile fields of one employee, grouped by section (company fields + this zone's fields). */
export function ExtraFields({ employee, zoneId, self = false, onSaved }: { employee: string; zoneId: string | null; self?: boolean; onSaved?: (m: string) => void }) {
  const { can } = useAuth()
  const { L, lang } = usePrefs()
  const data = useLoad(async () => {
    const [s, f, v] = await Promise.all([fields.sections(), fields.all(), fields.values(employee)])
    return { s, f, v }
  }, [employee])
  const [edit, setEdit] = useState(false)
  if (!data.data) return null
  const vals = new Map(data.data.v.map(x => [x.field_id, x.value]))
  const visible = data.data.f.filter(f => f.is_visible && (!f.zone_id || f.zone_id === zoneId) && (self || !f.view_permission || can(f.view_permission)))
  if (!visible.length) return null
  const editable = visible.filter(f => can(f.edit_permission ?? 'hr.employee.edit') && ['text', 'textarea', 'number', 'date', 'dropdown', 'multi_select', 'checkbox'].includes(f.field_type))
  const sections = data.data.s.filter(s => visible.some(f => f.section_id === s.id))
  return <section className="panel">
    <div className="da-bar"><h2 style={{ margin: 0 }}>{L('আরও তথ্য', 'More information')}</h2>
      {editable.length > 0 && <button className="secondary sm" onClick={() => setEdit(true)}>{L('সম্পাদনা', 'Edit')}</button>}</div>
    {sections.map(s => <div key={s.id}>
      <h3>{lang === 'bn' && s.name_bn ? s.name_bn : s.name}</h3>
      <dl className="hr-kv">{visible.filter(f => f.section_id === s.id).map(f => <span key={f.id} style={{ display: 'contents' }}>
        <dt>{lang === 'bn' && f.label_bn ? f.label_bn : f.label}{f.zone_id ? <span className="muted small"> · {L('এরিয়া', 'area')}</span> : null}</dt>
        <dd>{showValue(f, vals.get(f.id), lang)}</dd></span>)}</dl>
    </div>)}
    {edit && <EditValues employee={employee} list={editable} values={vals} onClose={() => setEdit(false)}
      onDone={() => { setEdit(false); void data.reload(); onSaved?.(L('তথ্য সেভ হয়েছে', 'Saved')) }} />}
  </section>
}

function EditValues({ employee, list, values, onClose, onDone }: { employee: string; list: CField[]; values: Map<string, unknown>; onClose: () => void; onDone: () => void }) {
  const { L, lang } = usePrefs()
  const [f, setF] = useState<Record<string, unknown>>(() => Object.fromEntries(list.map(x => [x.id, values.get(x.id) ?? (x.field_type === 'multi_select' ? [] : x.field_type === 'checkbox' ? false : '')])))
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function save() {
    setErr(''); setBusy(true)
    try {
      for (const x of list) {
        let v = f[x.id]
        if (x.field_type === 'number') v = v === '' ? '' : Number(v)
        const before = values.get(x.id)
        if (JSON.stringify(v) === JSON.stringify(before) || v === '' || (Array.isArray(v) && !v.length && before === undefined)) continue
        if (x.field_type === 'number' && Number.isNaN(v)) throw new Error(L(`"${x.label_bn || x.label}" ঘরে সংখ্যা দিন`, `Enter a number for "${x.label}"`))
        await fields.saveValue(employee, x.id, v, values.has(x.id))
      }
      onDone()
    } catch (e) { setErr(extraFriendly(e)) } finally { setBusy(false) }
  }
  const lbl = (x: CField) => (lang === 'bn' && x.label_bn ? x.label_bn : x.label) + (x.is_required ? ' *' : '')
  const optL = (o: Option) => lang === 'bn' && o.label_bn ? o.label_bn : o.label
  return <Modal wide title={L('আরও তথ্য সম্পাদনা', 'Edit more information')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ করুন', 'Save')}</button></>}>
    <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
      {list.map(x => <Field key={x.id} label={lbl(x)} wide={x.field_type === 'textarea'}>
        {x.field_type === 'textarea' ? <textarea rows={3} value={String(f[x.id] ?? '')} onChange={e => setF({ ...f, [x.id]: e.target.value })} />
          : x.field_type === 'dropdown' ? <select value={String(f[x.id] ?? '')} onChange={e => setF({ ...f, [x.id]: e.target.value })}><option value="">—</option>{x.options.map(o => <option key={o.value} value={o.value}>{optL(o)}</option>)}</select>
          : x.field_type === 'multi_select' ? <span style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>{x.options.map(o => { const cur = (f[x.id] as string[]) ?? []; return <label key={o.value} style={{ display: 'flex', gap: 4, alignItems: 'center', fontWeight: 400 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={cur.includes(o.value)} onChange={e => setF({ ...f, [x.id]: e.target.checked ? [...cur, o.value] : cur.filter(c => c !== o.value) })} />{optL(o)}</label> })}</span>
          : x.field_type === 'checkbox' ? <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400 }}><input type="checkbox" style={{ width: 'auto' }} checked={f[x.id] === true} onChange={e => setF({ ...f, [x.id]: e.target.checked })} />{L('হ্যাঁ', 'Yes')}</label>
          : <input type={x.field_type === 'number' ? 'number' : x.field_type === 'date' ? 'date' : 'text'} value={String(f[x.id] ?? '')} onChange={e => setF({ ...f, [x.id]: e.target.value })} />}
      </Field>)}
    </div>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

/** Who referred this employee, whom they brought, and the people they have in hand. */
export function ReferralPanel({ employee, zoneId, self = false, onSaved }: { employee: string; zoneId: string | null; self?: boolean; onSaved?: (m: string) => void }) {
  const { can } = useAuth()
  const { L, n, lang } = usePrefs()
  const ref = useLoad(() => referrals.referenceOf(employee).catch(() => null), [employee])
  const brought = useLoad(() => referrals.brought(employee).catch(() => []), [employee])
  const pros = useLoad(async () => {
    const [list, cols, pos] = await Promise.all([referrals.prospects(employee).catch(() => [] as Prospect[]), referrals.columns().catch(() => [] as PCol[]), org.positions().catch(() => [] as Position[])])
    return { list, cols: cols.filter(c => !c.zone_id || c.zone_id === zoneId), pos }
  }, [employee, zoneId])
  const [setting, setSetting] = useState(false)
  const bPend = useLoad(() => referrals.broughtPending(employee).catch(() => []), [employee])
  const [pick, setPick] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const [changeOf, setChangeOf] = useState<string | null>(null)
  const pending = useLoad(() => referrals.pendingReference(employee).catch(() => null), [employee])
  const [editP, setEditP] = useState<Partial<Prospect> | null>(null)
  const canSetRef = can('hr.referral.edit') || can('hr.employee.edit')
  // Everyone else (the staff member on their own profile, a manager on their staff) asks; HR approves.
  const canAsk = !canSetRef && (self || can('hr.employee.view'))
  const canEditP = self || can('hr.referral.edit')
  // "যাঁদের এনেছেন": add many, change, remove many — HR at once, others wait for HR.
  const canBrought = canSetRef || self || can('hr.employee.view')
  async function removeMany(ids: string[]) {
    const why = (await askReason(L(`${n(ids.length)} জনের রেফারেন্স সরাবেন?`, `Remove the reference of ${ids.length}?`), { ok: L('সরান', 'Remove') })) ?? ''; if (!why) return
    try {
      const r = await referrals.referenceMany(ids, 'remove', employee, why)
      setPick([]); void brought.reload(); void bPend.reload()
      onSaved?.(r.waiting ? L(`${n(r.waiting)} জন সরানোর অনুরোধ এইচআর-এ গেছে`, `${r.waiting} sent to HR`) : L(`${n(r.applied)} জন সরানো হয়েছে`, `${r.applied} removed`))
    } catch (e) { onSaved?.(e instanceof Error && /[ঀ-৿]/.test(e.message) ? e.message : extraFriendly(e)) }
  }
  const posName = (id: string | null) => pros.data?.pos.find(p => p.id === id)?.name ?? '—'
  const byPos = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of brought.data ?? []) m[r.position_name ?? '—'] = (m[r.position_name ?? '—'] ?? 0) + 1
    return Object.entries(m)
  }, [brought.data])

  return <section className="panel">
    <div className="da-bar"><h2 style={{ margin: 0 }}>{L('রেফারেন্স', 'Referrals')}</h2>
      {(canSetRef && !self || canAsk) && <button className="soft sm" onClick={() => setSetting(true)}><Icon name="edit" size={14} />{ref.data ? L('রেফারেন্স বদলান', 'Change') : L('রেফারেন্স দিন', 'Set referrer')}</button>}</div>
    <div className="ref-who">{ref.data ? <>
      <span className={`pp-av${ref.data.kind === 'manual' ? ' m' : ''}`}>{ref.data.name.slice(0, 1).toUpperCase()}</span>
      <div style={{ minWidth: 0, flex: 1 }}><small className="muted">{L('যিনি এনেছেন', 'Referred by')}</small>
        <b>{ref.data.kind === 'employee' && !self ? <Link to={`/app/hr/employees/${ref.data.id}`}>{ref.data.name}</Link> : ref.data.name}</b>
        <small>{[ref.data.code && `আইডি ${ref.data.code}`, ref.data.position, ref.data.hub && (ref.data.hub_code && /^\d+$/.test(ref.data.hub_code) ? `${ref.data.hub} #${ref.data.hub_code}` : ref.data.hub), ref.data.mobile].filter(Boolean).join(' · ')}</small>
        {ref.data.kind === 'manual' && <span className="pp-tag">{L('নিজে লেখা', 'Written by hand')}</span>}</div>
      {ref.data.mobile && <a className="ec-call static" href={`tel:${ref.data.mobile}`} aria-label="call"><Icon name="phone" size={16} /></a>}</>
      : <span className="muted">{L('যিনি এনেছেন: দেওয়া নেই', 'Referred by: not set')}</span>}</div>
    {pending.data && <div className="ref-wait"><Badge tone={pending.data.action === 'remove' ? 'bad' : 'warn'}>{pending.data.action === 'remove' ? L('সরানো — অপেক্ষায়', 'Removal waiting') : L('অপেক্ষায়', 'Waiting')}</Badge>
      <span><b>{pending.data.person.name}</b> {[pending.data.person.position, pending.data.person.hub].filter(Boolean).join(' · ')}
        <small className="muted"> — {L('এইচআর অনুমোদন দিলে বসবে', 'shows once HR approves')}{pending.data.by ? ` · ${pending.data.by}` : ''}</small></span>
      {pending.data.can_decide && <Link className="soft sm btn-link" to="/app/references?tab=staff">{L('দেখুন', 'Review')}</Link>}</div>}

    <div className="da-bar" style={{ marginTop: 6 }}><h3 style={{ margin: 0 }}>{self ? L('আমি যাঁদের এনেছি', 'People I brought') : L('যাঁদের এনেছেন', 'People they brought')} <span className="muted small">({n(brought.data?.length ?? 0)})</span></h3>
      {canBrought && <span className="row-acts">
        {pick.length > 0 && <button className="secondary sm" onClick={() => void removeMany(pick)}><Icon name="x" size={14} />{L('সরান', 'Remove')} ({n(pick.length)})</button>}
        <button className="sm" onClick={() => setAdding(true)}>+ {L('যোগ করুন', 'Add')}</button></span>}</div>
    {(bPend.data?.length ?? 0) > 0 && <div className="br-wait">{bPend.data!.map(r => <div key={r.id} className="ref-wait">
      <Badge tone={r.action === 'remove' ? 'bad' : 'warn'}>{r.action === 'remove' ? L('সরানো — অপেক্ষায়', 'Removal waiting') : L('যোগ — অপেক্ষায়', 'Add waiting')}</Badge>
      <span><b>{r.employee.name}</b>{r.employee.code ? ` #${r.employee.code}` : ''} <small className="muted">{[r.employee.position, r.employee.hub, r.by].filter(Boolean).join(' · ')}</small></span>
      {r.can_decide && <Link className="soft sm btn-link" to="/app/references?tab=staff">{L('দেখুন', 'Review')}</Link>}</div>)}</div>}
    {byPos.length > 0 && <div className="da-mini" style={{ marginBottom: 8 }}>{byPos.map(([p, c]) => <span key={p}>{p}: <strong>{n(c)}</strong></span>)}</div>}
    {!brought.data?.length ? <p className="muted">{L('এখনো কেউ নেই।', 'Nobody yet.')}</p> :
      <div className="br-cards">{canBrought && brought.data.length > 1 && <label className="br-row all"><input type="checkbox" checked={pick.length === brought.data.length}
          onChange={e => setPick(e.target.checked ? brought.data!.map(r => r.id) : [])} /><span className="small">{L('সব বাছুন', 'Select all')}</span></label>}
        {brought.data.map(r => <div key={r.id} className={`br-row${pick.includes(r.id) ? ' sel' : ''}`}>
          {canBrought && <input type="checkbox" aria-label={L('বাছুন', 'Select')} checked={pick.includes(r.id)} onChange={e => setPick(p => e.target.checked ? [...p, r.id] : p.filter(x => x !== r.id))} />}
          <span className="br-who"><b>{self ? r.full_name : <Link to={`/app/hr/employees/${r.id}`}>{r.full_name}</Link>}</b>{r.employee_code ? <small className="muted"> #{r.employee_code}</small> : null}
            <small className="muted">{[r.position_name, r.hub_name, r.zone_name].filter(Boolean).join(' · ')}</small></span>
          <Badge tone={r.status === 'active' ? 'ok' : r.status === 'applicant' ? 'info' : 'neutral'}>{r.status === 'active' ? L('সক্রিয়', 'Active') : r.status === 'applicant' ? L('আবেদন', 'Applicant') : r.status}</Badge>
          {canBrought && <span className="br-acts"><button className="icon-btn" aria-label={L('বদলান', 'Change')} title={L('রেফারেন্স বদলান', 'Change referrer')} onClick={() => setChangeOf(r.id)}><Icon name="edit" size={16} /></button>
            <button className="icon-btn" aria-label={L('সরান', 'Remove')} title={L('সরান', 'Remove')} onClick={() => void removeMany([r.id])}><Icon name="x" size={16} /></button></span>}
        </div>)}</div>}

    <div className="da-bar" style={{ marginTop: 14 }}><h3 style={{ margin: 0 }}>{L('হাতে থাকা লোক (যোগ দিতে পারেন)', 'People in hand (could join)')} <span className="muted small">({n(pros.data?.list.length ?? 0)})</span></h3>
      {canEditP && <button className="sm" onClick={() => setEditP({ referrer_id: employee, status: 'available', extra: {} })}>+ {L('যোগ করুন', 'Add')}</button>}</div>
    {!pros.data?.list.length ? <p className="muted">{L('কোনো নাম রাখা নেই। কোন পদের জন্য কাকে আনতে পারেন — এখানে লিখে রাখুন।', 'No one listed. Note here whom you could bring and for which position.')}</p> :
      <div className="da-table-wrap"><table className="da-table"><thead><tr><th>{L('নাম', 'Name')}</th><th>{L('মোবাইল', 'Mobile')}</th><th>{L('কোন পদের জন্য', 'For position')}</th><th>{L('এলাকা', 'Area')}</th>
        {pros.data.cols.map(c => <th key={c.id}>{lang === 'bn' && c.label_bn ? c.label_bn : c.label}</th>)}<th>{L('অবস্থা', 'Status')}</th><th /></tr></thead>
        <tbody>{pros.data.list.map(p => <tr key={p.id}><td>{p.full_name}{p.note ? <span className="sec">{p.note}</span> : null}</td><td>{p.mobile ?? '—'}</td><td>{posName(p.position_id)}</td><td>{p.area ?? '—'}</td>
          {pros.data!.cols.map(c => <td key={c.id}>{showValue(c, p.extra?.[c.code], lang)}</td>)}
          <td><Badge tone={PROSPECT_STATUS[p.status][1]}>{PROSPECT_STATUS[p.status][0]}</Badge></td>
          <td style={{ textAlign: 'right' }}>{canEditP && <button className="secondary sm" onClick={() => setEditP(p)}>{L('বদলান', 'Edit')}</button>}</td></tr>)}</tbody></table></div>}

    {setting && <SetReferrer employee={employee} ask={canAsk} current={ref.data ? (ref.data.kind === 'employee' ? { kind: 'employee', id: ref.data.id!, code: ref.data.code ?? null, name: ref.data.name, hub: ref.data.hub ?? '', position: ref.data.position ?? '', mobile: ref.data.mobile }
        : { kind: 'manual', name: ref.data.name, code: ref.data.code ?? '', hub: ref.data.hub ?? '', position: ref.data.position ?? '', mobile: ref.data.mobile ?? '' }) : null} onClose={() => setSetting(false)}
      onDone={() => { setSetting(false); void ref.reload(); void pending.reload()
        onSaved?.(canAsk ? L('পাঠানো হয়েছে — এইচআর অনুমোদন দিলে দেখাবে', 'Sent — shows once HR approves') : L('রেফারেন্স সেভ হয়েছে', 'Referrer saved')) }} />}
    {adding && <AddBrought referrer={employee} onClose={() => setAdding(false)} onDone={m => { setAdding(false); void brought.reload(); void bPend.reload(); onSaved?.(m) }} />}
    {changeOf && <SetReferrer employee={changeOf} ask={!canSetRef} current={{ kind: 'employee', id: employee, code: null, name: L('এই প্রোফাইল', 'This profile'), hub: '', position: '' }}
      onClose={() => setChangeOf(null)} onDone={() => { setChangeOf(null); void brought.reload(); void bPend.reload()
        onSaved?.(canSetRef ? L('রেফারেন্স বদলানো হয়েছে', 'Referrer changed') : L('পাঠানো হয়েছে — এইচআর অনুমোদন দিলে বদলাবে', 'Sent — changes once HR approves')) }} />}
    {editP && pros.data && <ProspectForm p={editP} cols={pros.data.cols} positions={pros.data.pos} onClose={() => setEditP(null)}
      onDone={m => { setEditP(null); void pros.reload(); onSaved?.(m) }} />}
  </section>
}

function SetReferrer({ employee, current, ask = false, onClose, onDone }: { employee: string; current: RefPerson | null; ask?: boolean; onClose: () => void; onDone: () => void }) {
  const { L } = usePrefs()
  const [v, setV] = useState<RefPerson | null>(current)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  async function go(clear = false) {
    setErr(''); setBusy(true)
    try {
      const x = clear ? null : v
      const manual = x?.kind === 'manual' ? { name: x.name, code: x.code, hub: x.hub, position: x.position, mobile: x.mobile } : null
      if (ask) await referrals.requestReference(employee, x?.kind === 'employee' ? x.id : null, manual, note)
      else await referrals.setReference(employee, x?.kind === 'employee' ? x.id : null, manual)
      onDone()
    } catch (e) { setErr(e instanceof Error && /[ঀ-৿]/.test(e.message) ? e.message : extraFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title={L('কে এনেছেন (রেফারেন্স)', 'Who referred (reference)')} onClose={onClose}
    actions={<>{current && !ask && <button className="danger" disabled={busy} onClick={() => void go(true)}>{L('রেফারেন্স মুছুন', 'Remove')}</button>}
      <button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button>
      <button disabled={busy || !v} onClick={() => void go()}>{ask ? L('এইচআর-এ পাঠান', 'Send to HR') : L('সেভ করুন', 'Save')}</button></>}>
    {ask ? <p className="muted small">{L('যিনি আপনাকে এনেছেন তাঁকে বাছুন: সিস্টেমের লোক হলে হাব → পদ → নাম বা আইডি দিয়ে; বাইরের লোক হলে নাম, পদবি, নম্বর, হাবের নাম নিজে লিখুন। এইচআর অনুমোদন দিলে প্রোফাইলে দেখাবে, তার আগে "অপেক্ষায়"।',
      'Pick who referred: a person in the system, or write an outside person by hand. It shows once HR approves; until then it is waiting.')}</p> :
    <p className="muted small">{L('ভুল রেফারেন্স থাকলে এখান থেকে ঠিক করুন। সিস্টেমের লোক হলে হাব → পদ → নাম বা আইডি দিয়ে বাছুন; বাইরের লোক হলে নিজে লিখুন।',
      'Fix a wrong reference here. Pick a person in the system, or write an outside person by hand.')}</p>}
    <PersonPicker value={v} onChange={setV} exclude={employee} />
    {ask && <label className="ref-note"><span className="muted small">{L('এইচআর-এর জন্য নোট (ইচ্ছা হলে)', 'Note for HR (optional)')}</span>
      <input value={note} onChange={e => setNote(e.target.value)} placeholder={L('যেমন: কীভাবে চেনেন', 'e.g. how you know them')} /></label>}
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

export function ProspectForm({ p, cols, positions, onClose, onDone }: { p: Partial<Prospect>; cols: PCol[]; positions: Position[]; onClose: () => void; onDone: (m: string) => void }) {
  const { L, lang } = usePrefs()
  const [f, setF] = useState<Partial<Prospect>>({ ...p, extra: { ...(p.extra ?? {}) } })
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const set = (k: keyof Prospect, v: unknown) => setF({ ...f, [k]: v })
  const setX = (k: string, v: unknown) => setF({ ...f, extra: { ...(f.extra ?? {}), [k]: v } })
  async function go(archive = false) {
    setErr('')
    if (!archive && (f.full_name ?? '').trim().length < 2) return setErr(L('নাম দিন', 'Enter the name'))
    setBusy(true)
    try {
      if (archive && p.id) { await referrals.archiveProspect(p.id); onDone(L('তালিকা থেকে সরানো হয়েছে', 'Removed')); return }
      const extra: Record<string, unknown> = {}
      for (const c of cols) { const v = f.extra?.[c.code]; if (v !== undefined && v !== '') extra[c.code] = c.field_type === 'number' ? Number(v) : v }
      await referrals.saveProspect({ id: p.id, referrer_id: p.referrer_id!, full_name: (f.full_name ?? '').trim(), mobile: (f.mobile ?? '').trim() || null,
        position_id: f.position_id || null, area: (f.area ?? '').trim() || null, note: (f.note ?? '').trim() || null, status: f.status ?? 'available', extra })
      onDone(L('সেভ হয়েছে', 'Saved'))
    } catch (e) { setErr(extraFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title={p.id ? L('তথ্য বদলান', 'Edit person') : L('হাতে থাকা লোক যোগ করুন', 'Add a person in hand')} onClose={onClose}
    actions={<>{p.id && <button className="secondary" disabled={busy} onClick={() => void go(true)}>{L('তালিকা থেকে সরান', 'Remove')}</button>}
      <button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void go()}>{L('সেভ করুন', 'Save')}</button></>}>
    <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Field label={L('নাম', 'Name')}><input value={f.full_name ?? ''} onChange={e => set('full_name', e.target.value)} /></Field>
      <Field label={L('মোবাইল', 'Mobile')}><input inputMode="tel" value={f.mobile ?? ''} onChange={e => set('mobile', e.target.value)} placeholder="01711000000" /></Field>
      <Field label={L('কোন পদের জন্য', 'For which position')}><select value={f.position_id ?? ''} onChange={e => set('position_id', e.target.value)}>
        <option value="">—</option>{positions.map(x => <option key={x.id} value={x.id}>{lang === 'bn' && x.name_bn ? x.name_bn : x.name}</option>)}</select></Field>
      <Field label={L('এলাকা', 'Area')}><input value={f.area ?? ''} onChange={e => set('area', e.target.value)} /></Field>
      {cols.map(c => <Field key={c.id} label={lang === 'bn' && c.label_bn ? c.label_bn : c.label}>
        {c.field_type === 'dropdown' ? <select value={String(f.extra?.[c.code] ?? '')} onChange={e => setX(c.code, e.target.value)}><option value="">—</option>
          {c.options.map(o => <option key={o.value} value={o.value}>{lang === 'bn' && o.label_bn ? o.label_bn : o.label}</option>)}</select>
          : <input type={c.field_type === 'number' ? 'number' : c.field_type === 'date' ? 'date' : 'text'} value={String(f.extra?.[c.code] ?? '')} onChange={e => setX(c.code, e.target.value)} />}</Field>)}
      <Field label={L('অবস্থা', 'Status')}><select value={f.status ?? 'available'} onChange={e => set('status', e.target.value)}>
        {(Object.keys(PROSPECT_STATUS) as Prospect['status'][]).map(s => <option key={s} value={s}>{PROSPECT_STATUS[s][0]}</option>)}</select></Field>
      <Field wide label={L('নোট', 'Note')}><input value={f.note ?? ''} onChange={e => set('note', e.target.value)} /></Field>
    </div>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

/** Add several people at once to "যাঁদের এনেছেন": pick a hub and tick names, or type many Employee IDs. */
function AddBrought({ referrer, onClose, onDone }: { referrer: string; onClose: () => void; onDone: (m: string) => void }) {
  const { L, n } = usePrefs()
  const o = useOrg()
  const [mode, setMode] = useState<'hub' | 'ids'>('hub')
  const [hub, setHub] = useState('')
  const [q, setQ] = useState('')
  const people = useLoad(() => hub ? refs.hubPeople(hub) : Promise.resolve([] as HubPerson[]), [hub])
  const [sel, setSel] = useState<Record<string, string>>({})   // id -> label
  const [codes, setCodes] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const list = (people.data ?? []).filter(p => p.id !== referrer && (!q.trim() || `${p.full_name} ${p.employee_code ?? ''} ${p.mobile ?? ''} ${p.post ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())))
  const toggle = (p: HubPerson, on: boolean) => setSel(s => { const x = { ...s }; if (on) x[p.id] = `${p.full_name}${p.employee_code ? ' #' + p.employee_code : ''}`; else delete x[p.id]; return x })
  async function addCodes() {
    setErr('')
    const all = [...new Set(codes.split(/[\s,;]+/).map(c => c.trim()).filter(Boolean))]
    const miss: string[] = []; const add: Record<string, string> = {}
    for (const c of all) {
      const r = await referrals.lookup(c).catch(() => null)
      if (!r || r.id === referrer) miss.push(c); else add[r.id] = `${r.full_name} #${r.employee_code}`
    }
    setSel(s => ({ ...s, ...add })); setCodes(miss.join(' '))
    if (miss.length) setErr(L(`এই আইডিগুলো পাওয়া যায়নি: ${miss.join(', ')}`, `Not found: ${miss.join(', ')}`))
  }
  async function go() {
    const ids = Object.keys(sel); if (!ids.length) return setErr(L('অন্তত একজন বাছুন', 'Pick at least one'))
    setErr(''); setBusy(true)
    try {
      const r = await referrals.referenceMany(ids, 'set', referrer, note)
      onDone([r.applied && L(`${n(r.applied)} জন যোগ হয়েছে`, `${r.applied} added`), r.waiting && L(`${n(r.waiting)} জন এইচআর অনুমোদনের অপেক্ষায়`, `${r.waiting} waiting for HR`)].filter(Boolean).join(' · '))
    } catch (e) { setErr(e instanceof Error && /[ঀ-৿]/.test(e.message) ? e.message : extraFriendly(e)) } finally { setBusy(false) }
  }
  const count = Object.keys(sel).length
  return <Modal wide title={L('যাঁদের এনেছেন — যোগ করুন', 'Add people brought')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button>
      <button disabled={busy || !count} onClick={() => void go()}>{busy ? '…' : L(`যোগ করুন (${n(count)})`, `Add (${count})`)}</button></>}>
    <div className="seg pp-modes">
      <button type="button" className={mode === 'hub' ? 'on' : ''} onClick={() => setMode('hub')}>{L('হাব থেকে বাছুন', 'From a hub')}</button>
      <button type="button" className={mode === 'ids' ? 'on' : ''} onClick={() => setMode('ids')}>{L('অনেক আইডি একসাথে', 'Many IDs')}</button></div>
    {mode === 'hub' ? <>
      <div className="hr-form pp-form">
        <Field label={L('হাব', 'Hub')}><Combo value={hub} onChange={setHub} options={(o.data?.hubs ?? []).map(h => ({ value: h.id, label: h.name }))} /></Field>
        <Field label={L('খুঁজুন', 'Search')}><input value={q} onChange={e => setQ(e.target.value)} disabled={!hub} placeholder={L('নাম, আইডি, মোবাইল, পদ', 'Name, ID, mobile, post')} /></Field></div>
      {hub && <div className="br-list">
        {list.length > 0 && <label className="br-row all"><input type="checkbox" checked={list.every(p => sel[p.id])} onChange={e => list.forEach(p => toggle(p, e.target.checked))} />
          <b>{L(`সব (${n(list.length)})`, `All (${list.length})`)}</b></label>}
        {people.loading ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p> : !list.length ? <p className="muted">{L('কাউকে পাওয়া যায়নি', 'Nobody found')}</p> :
          list.map(p => <label key={p.id} className="br-row"><input type="checkbox" checked={!!sel[p.id]} onChange={e => toggle(p, e.target.checked)} />
            <span><b>{p.full_name}</b> <small className="muted">{[p.employee_code && `#${p.employee_code}`, p.post, p.mobile].filter(Boolean).join(' · ')}</small></span></label>)}
      </div>}
    </> : <Field label={L('এমপ্লয়ি আইডি (কমা, স্পেস বা নতুন লাইনে আলাদা)', 'Employee IDs (comma, space or new line)')} wide>
      <textarea rows={3} value={codes} onChange={e => setCodes(e.target.value)} placeholder="10086, 10087, 10090" />
      <button type="button" className="soft sm" style={{ marginTop: 6 }} disabled={!codes.trim()} onClick={() => void addCodes()}>{L('খুঁজে যোগ করুন', 'Find and add')}</button></Field>}
    {count > 0 && <div className="br-chips">{Object.entries(sel).map(([id, label]) => <span key={id} className="br-chip">{label}
      <button type="button" aria-label={L('সরান', 'Remove')} onClick={() => setSel(s => { const x = { ...s }; delete x[id]; return x })}><Icon name="x" size={12} /></button></span>)}</div>}
    <label className="ref-note"><span className="muted small">{L('এইচআর-এর জন্য নোট (ইচ্ছা হলে)', 'Note for HR (optional)')}</span>
      <input value={note} onChange={e => setNote(e.target.value)} /></label>
    <p className="muted small"><Icon name="clock" size={12} /> {L('এইচআর ছাড়া অন্যরা দিলে এইচআর অনুমোদন দিলে তালিকায় বসবে; ততক্ষণ "অপেক্ষায়"।', 'Unless you are HR, it waits for HR approval.')}</p>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}
