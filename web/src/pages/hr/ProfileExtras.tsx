import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { Badge, Field, Modal, useLoad } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { org, type Position } from '../../lib/hr'
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
        <dt>{lang === 'bn' && f.label_bn ? f.label_bn : f.label}{f.zone_id ? <span className="muted small"> · {L('জোন', 'zone')}</span> : null}</dt>
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
  const ref = useLoad(() => referrals.referrerOf(employee).catch(() => null), [employee])
  const brought = useLoad(() => referrals.brought(employee).catch(() => []), [employee])
  const pros = useLoad(async () => {
    const [list, cols, pos] = await Promise.all([referrals.prospects(employee).catch(() => [] as Prospect[]), referrals.columns().catch(() => [] as PCol[]), org.positions().catch(() => [] as Position[])])
    return { list, cols: cols.filter(c => !c.zone_id || c.zone_id === zoneId), pos }
  }, [employee, zoneId])
  const [setting, setSetting] = useState(false)
  const [editP, setEditP] = useState<Partial<Prospect> | null>(null)
  const canSetRef = can('hr.referral.edit') || can('hr.employee.edit')
  const canEditP = self || can('hr.referral.edit')
  const posName = (id: string | null) => pros.data?.pos.find(p => p.id === id)?.name ?? '—'
  const byPos = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of brought.data ?? []) m[r.position_name ?? '—'] = (m[r.position_name ?? '—'] ?? 0) + 1
    return Object.entries(m)
  }, [brought.data])

  return <section className="panel">
    <div className="da-bar"><h2 style={{ margin: 0 }}>{L('রেফারেন্স', 'Referrals')}</h2>
      {canSetRef && !self && <button className="secondary sm" onClick={() => setSetting(true)}>{L('রেফারেন্স ঠিক করুন', 'Set referrer')}</button>}</div>
    <p>{L('যিনি এনেছেন:', 'Referred by:')} {ref.data ? <strong>{ref.data.full_name} <span className="muted">({ref.data.employee_code})</span></strong> : <span className="muted">{L('দেওয়া নেই', 'Not set')}</span>}</p>

    <h3>{self ? L('আমি যাঁদের এনেছি', 'People I brought') : L('যাঁদের এনেছেন', 'People they brought')} <span className="muted small">({n(brought.data?.length ?? 0)})</span></h3>
    {byPos.length > 0 && <div className="da-mini" style={{ marginBottom: 8 }}>{byPos.map(([p, c]) => <span key={p}>{p}: <strong>{n(c)}</strong></span>)}</div>}
    {!brought.data?.length ? <p className="muted">{L('এখনো কেউ নেই।', 'Nobody yet.')}</p> :
      <div className="da-table-wrap"><table className="da-table"><thead><tr><th>{L('আইডি', 'ID')}</th><th>{L('নাম', 'Name')}</th><th>{L('পদবি', 'Position')}</th><th>{L('হাব', 'Hub')}</th><th>{L('অবস্থা', 'Status')}</th></tr></thead>
        <tbody>{brought.data.map(r => <tr key={r.id}><td>{r.employee_code ?? '—'}</td>
          <td>{self ? r.full_name : <Link to={`/app/hr/employees/${r.id}`}>{r.full_name}</Link>}</td><td>{r.position_name ?? '—'}</td>
          <td>{r.hub_name ?? '—'}{r.zone_name ? <span className="sec">{r.zone_name}</span> : null}</td>
          <td><Badge tone={r.status === 'active' ? 'ok' : r.status === 'applicant' ? 'info' : 'neutral'}>{r.status === 'active' ? L('সক্রিয়', 'Active') : r.status === 'applicant' ? L('আবেদন', 'Applicant') : r.status}</Badge></td></tr>)}</tbody></table></div>}

    <div className="da-bar" style={{ marginTop: 14 }}><h3 style={{ margin: 0 }}>{L('হাতে থাকা লোক (যোগ দিতে পারেন)', 'People in hand (could join)')} <span className="muted small">({n(pros.data?.list.length ?? 0)})</span></h3>
      {canEditP && <button className="sm" onClick={() => setEditP({ referrer_id: employee, status: 'available', extra: {} })}>+ {L('যোগ করুন', 'Add')}</button>}</div>
    {!pros.data?.list.length ? <p className="muted">{L('কোনো নাম রাখা নেই। কোন পদের জন্য কাকে আনতে পারেন — এখানে লিখে রাখুন।', 'No one listed. Note here whom you could bring and for which position.')}</p> :
      <div className="da-table-wrap"><table className="da-table"><thead><tr><th>{L('নাম', 'Name')}</th><th>{L('মোবাইল', 'Mobile')}</th><th>{L('কোন পদের জন্য', 'For position')}</th><th>{L('এলাকা', 'Area')}</th>
        {pros.data.cols.map(c => <th key={c.id}>{lang === 'bn' && c.label_bn ? c.label_bn : c.label}</th>)}<th>{L('অবস্থা', 'Status')}</th><th /></tr></thead>
        <tbody>{pros.data.list.map(p => <tr key={p.id}><td>{p.full_name}{p.note ? <span className="sec">{p.note}</span> : null}</td><td>{p.mobile ?? '—'}</td><td>{posName(p.position_id)}</td><td>{p.area ?? '—'}</td>
          {pros.data!.cols.map(c => <td key={c.id}>{showValue(c, p.extra?.[c.code], lang)}</td>)}
          <td><Badge tone={PROSPECT_STATUS[p.status][1]}>{PROSPECT_STATUS[p.status][0]}</Badge></td>
          <td style={{ textAlign: 'right' }}>{canEditP && <button className="secondary sm" onClick={() => setEditP(p)}>{L('বদলান', 'Edit')}</button>}</td></tr>)}</tbody></table></div>}

    {setting && <SetReferrer employee={employee} current={ref.data?.employee_code ?? ''} onClose={() => setSetting(false)}
      onDone={() => { setSetting(false); void ref.reload(); onSaved?.(L('রেফারেন্স সেভ হয়েছে', 'Referrer saved')) }} />}
    {editP && pros.data && <ProspectForm p={editP} cols={pros.data.cols} positions={pros.data.pos} onClose={() => setEditP(null)}
      onDone={m => { setEditP(null); void pros.reload(); onSaved?.(m) }} />}
  </section>
}

function SetReferrer({ employee, current, onClose, onDone }: { employee: string; current: string; onClose: () => void; onDone: () => void }) {
  const { L } = usePrefs()
  const [code, setCode] = useState(current)
  const [who, setWho] = useState<{ full_name: string; position_name: string | null; hub_name: string | null } | null | 'none'>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!code.trim()) { setWho(null); return }
    const t = window.setTimeout(() => { referrals.lookup(code.trim()).then(r => setWho(r ?? 'none')).catch(() => setWho('none')) }, 350)
    return () => window.clearTimeout(t)
  }, [code])
  async function go() {
    setErr(''); setBusy(true)
    try { await referrals.setReferrer(employee, code.trim()); onDone() } catch (e) { setErr(extraFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title={L('কে এনেছেন (রেফারেন্স)', 'Who referred (reference)')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy || who === 'none'} onClick={() => void go()}>{L('সেভ করুন', 'Save')}</button></>}>
    <Field label={L('রেফারেন্সের এমপ্লয়ি আইডি', "Referrer's Employee ID")} hint={L('খালি রেখে সেভ করলে রেফারেন্স মুছে যাবে', 'Save empty to remove')}>
      <input value={code} onChange={e => setCode(e.target.value)} placeholder="101" autoFocus /></Field>
    {who && who !== 'none' && <p className="da-ok">{who.full_name}{who.position_name ? ` · ${who.position_name}` : ''}{who.hub_name ? ` · ${who.hub_name}` : ''}</p>}
    {who === 'none' && <p className="da-error">{L('এই আইডির কোনো কর্মী পাওয়া যায়নি', 'No employee with this ID')}</p>}
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

function ProspectForm({ p, cols, positions, onClose, onDone }: { p: Partial<Prospect>; cols: PCol[]; positions: Position[]; onClose: () => void; onDone: (m: string) => void }) {
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
