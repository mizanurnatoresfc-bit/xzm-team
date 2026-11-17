import { useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { Badge, Field, Modal, useLoad } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { customFields } from '../../lib/staffAdmin'
import { colLabel, EXPORT_FIELDS, fieldLabel, formatFriendly, staffAdmin, type Format, type FormatCol } from '../../lib/staffAdmin'
import type { CField } from '../../lib/extra'
import { useOrg } from './common'

/** Export/import formats: the company's own column layouts, company-wide or per zone. */
export function Formats({ toast }: { toast: (m: string) => void }) {
  const { can, grants } = useAuth()
  const { L, lang } = usePrefs()
  const o = useOrg()
  const data = useLoad(async () => {
    const [list, custom] = await Promise.all([staffAdmin.formats(), customFields()])
    return { list, custom }
  }, [])
  const [edit, setEdit] = useState<Partial<Format> | null>(null)
  const [drop, setDrop] = useState<Format | null>(null)
  const globalRight = grants.some(g => (g.is_super || g.permission_code === 'hr.profile_field.configure') && g.scope_type === 'global')
  const zoneName = (z: string | null) => z ? o.names.zone[z] ?? L('অন্য এরিয়া', 'Other area') : L('পুরো কোম্পানি', 'Whole company')
  const mayEdit = (f: Format) => f.zone_id ? can('hr.profile_field.configure') : globalRight

  return <section className="panel">
    <div className="da-bar"><h2 style={{ margin: 0 }}>{L('এক্সপোর্ট / ইমপোর্ট ফরম্যাট', 'Export / import formats')}</h2>
      {can('hr.profile_field.configure') && <button onClick={() => setEdit({ purpose: 'both', columns: [], zone_id: globalRight ? null : (o.data?.zones[0]?.id ?? null) })}>+ {L('নতুন ফরম্যাট', 'New format')}</button>}</div>
    <p className="muted small">{L('কোন কলামগুলো, কোন ক্রমে আর কী নামে এক্সেলে যাবে — সেটাই ফরম্যাট। একই ফরম্যাট ইমপোর্টেও কলাম মিলিয়ে নিতে কাজে লাগে।',
      'A format is which columns go to Excel, in which order and under which heading. The same format also matches columns when importing.')}</p>
    {data.error ? <p className="da-error">{formatFriendly(data.error)}</p> : null}
    {!data.data?.list.length ? <p className="muted">{data.loading ? L('লোড হচ্ছে…', 'Loading…') : L('কোনো ফরম্যাট নেই।', 'No formats yet.')}</p> :
      <div className="da-table-wrap"><table className="da-table">
        <thead><tr><th>{L('ফরম্যাট', 'Format')}</th><th>{L('কাজে লাগে', 'Used for')}</th><th>{L('কার জন্য', 'For')}</th><th>{L('কলাম', 'Columns')}</th><th /></tr></thead>
        <tbody>{data.data.list.map(f => <tr key={f.id}>
          <td><strong>{lang === 'bn' && f.name_bn ? f.name_bn : f.name}</strong>{f.is_default ? <> <Badge tone="ok">{L('ডিফল্ট', 'Default')}</Badge></> : null}</td>
          <td>{f.purpose === 'export' ? L('শুধু এক্সপোর্ট', 'Export only') : f.purpose === 'import' ? L('শুধু ইমপোর্ট', 'Import only') : L('দুটোতেই', 'Both')}</td>
          <td>{f.zone_id ? <Badge tone="info">{zoneName(f.zone_id)}</Badge> : zoneName(null)}</td>
          <td className="small">{f.columns.map(c => colLabel(c, lang)).join(' · ')}</td>
          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{mayEdit(f) && <>
            <button className="secondary sm" onClick={() => setEdit(f)}>{L('বদলান', 'Edit')}</button>{' '}
            <button className="secondary sm" onClick={() => setDrop(f)}>{L('সরান', 'Remove')}</button></>}</td>
        </tr>)}</tbody></table></div>}

    {edit && data.data && <FormatEditor f={edit} custom={data.data.custom} canGlobal={globalRight} zones={o.data?.zones ?? []}
      onClose={() => setEdit(null)} onDone={m => { setEdit(null); toast(m); void data.reload() }} />}
    {drop && <Modal title={L(`"${lang === 'bn' && drop.name_bn ? drop.name_bn : drop.name}" সরাবেন?`, `Remove "${drop.name}"?`)} onClose={() => setDrop(null)}
      actions={<><button className="secondary" onClick={() => setDrop(null)}>{L('বাতিল', 'Cancel')}</button>
        <button className="danger" onClick={() => void (async () => {
          try { await staffAdmin.archiveFormat(drop.id); setDrop(null); toast(L('ফরম্যাট সরানো হয়েছে', 'Format removed')); void data.reload() }
          catch (e) { toast(formatFriendly(e)) }
        })()}>{L('সরান', 'Remove')}</button></>}>
      <p className="muted small">{L('এক্সপোর্টের তালিকা থেকে চলে যাবে। আগের এক্সপোর্ট করা ফাইলে কোনো প্রভাব পড়বে না।', 'It disappears from the export list. Files you already exported are unaffected.')}</p>
    </Modal>}
  </section>
}

function FormatEditor({ f, custom, canGlobal, zones, onClose, onDone }: {
  f: Partial<Format>; custom: CField[]; canGlobal: boolean; zones: Array<{ id: string; name: string }>
  onClose: () => void; onDone: (m: string) => void
}) {
  const { L, lang } = usePrefs()
  const [name, setName] = useState(f.name ?? '')
  const [nameBn, setNameBn] = useState(f.name_bn ?? '')
  const [purpose, setPurpose] = useState<Format['purpose']>(f.purpose ?? 'both')
  const [zone, setZone] = useState(f.zone_id ?? '')
  const [isDefault, setIsDefault] = useState(f.is_default ?? false)
  const [cols, setCols] = useState<FormatCol[]>(f.columns ?? [])
  const [add, setAdd] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)

  const available: Array<[string, string]> = [
    ...EXPORT_FIELDS.map(([v]) => [v, fieldLabel(v, lang, custom)] as [string, string]),
    ...custom.map(c => [`cf:${c.code}`, `${L('প্রোফাইলের ঘর', 'Profile field')}: ${lang === 'bn' && c.label_bn ? c.label_bn : c.label}`] as [string, string]),
  ].filter(([v]) => !cols.some(c => c.field === v))

  const addCol = (field: string) => {
    if (!field) return
    const e = EXPORT_FIELDS.find(x => x[0] === field)
    const cf = custom.find(x => `cf:${x.code}` === field)
    setCols([...cols, { field, label: e ? e[2] : cf?.label ?? field, label_bn: e ? e[1] : cf?.label_bn ?? undefined }])
    setAdd('')
  }
  const move = (i: number, d: -1 | 1) => {
    const j = i + d; if (j < 0 || j >= cols.length) return
    const c = [...cols]; const [x] = c.splice(i, 1); c.splice(j, 0, x); setCols(c)
  }
  const setLabel = (i: number, key: 'label' | 'label_bn', v: string) => {
    const c = [...cols]; c[i] = { ...c[i], [key]: v }; setCols(c)
  }

  async function save() {
    setErr('')
    if (!name.trim() && !nameBn.trim()) return setErr(L('ফরম্যাটের নাম দিন', 'Name the format'))
    if (!cols.length) return setErr(L('অন্তত একটা কলাম যোগ করুন', 'Add at least one column'))
    setBusy(true)
    try {
      await staffAdmin.saveFormat({ id: f.id, name: name.trim() || nameBn.trim(), name_bn: nameBn.trim() || null,
        purpose, zone_id: zone || null, is_default: isDefault, columns: cols })
      onDone(L('ফরম্যাট সেভ হয়েছে', 'Format saved'))
    } catch (e) { setErr(formatFriendly(e)) } finally { setBusy(false) }
  }

  return <Modal wide title={f.id ? L('ফরম্যাট বদলান', 'Edit format') : L('নতুন ফরম্যাট', 'New format')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ করুন', 'Save')}</button></>}>
    <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Field label={L('নাম (বাংলা)', 'Name (Bangla)')}><input value={nameBn} onChange={e => setNameBn(e.target.value)} placeholder={L('যেমন: ব্যাংক ফাইল', 'e.g. ব্যাংক ফাইল')} /></Field>
      <Field label={L('নাম (ইংরেজি)', 'Name (English)')}><input value={name} onChange={e => setName(e.target.value)} placeholder="Bank file" /></Field>
      <Field label={L('কাজে লাগবে', 'Used for')}><select value={purpose} onChange={e => setPurpose(e.target.value as Format['purpose'])}>
        <option value="both">{L('এক্সপোর্ট ও ইমপোর্ট', 'Export and import')}</option>
        <option value="export">{L('শুধু এক্সপোর্ট', 'Export only')}</option>
        <option value="import">{L('শুধু ইমপোর্ট', 'Import only')}</option></select></Field>
      <Field label={L('কার জন্য', 'For')}><select value={zone} onChange={e => setZone(e.target.value)}>
        {canGlobal && <option value="">{L('পুরো কোম্পানি', 'Whole company')}</option>}
        {zones.map(z => <option key={z.id} value={z.id}>{L('শুধু এরিয়া: ', 'Area only: ')}{z.name}</option>)}</select></Field>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
        {L('এটাই ডিফল্ট ফরম্যাট', 'Make this the default')}</label>
    </div>

    <h3>{L('কলামগুলো', 'Columns')}</h3>
    {!cols.length ? <p className="muted">{L('এখনো কোনো কলাম নেই।', 'No columns yet.')}</p> :
      <div className="da-table-wrap"><table className="da-table">
        <thead><tr><th>#</th><th>{L('কোন তথ্য', 'Field')}</th><th>{L('এক্সেলে নাম (বাংলা)', 'Heading (Bangla)')}</th><th>{L('এক্সেলে নাম (ইংরেজি)', 'Heading (English)')}</th><th /></tr></thead>
        <tbody>{cols.map((c, i) => <tr key={c.field}>
          <td className="muted small">{i + 1}</td>
          <td>{fieldLabel(c.field, lang, custom)}</td>
          <td><input value={c.label_bn ?? ''} aria-label={`${c.field} bn`} onChange={e => setLabel(i, 'label_bn', e.target.value)} /></td>
          <td><input value={c.label ?? ''} aria-label={`${c.field} en`} onChange={e => setLabel(i, 'label', e.target.value)} /></td>
          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
            <button className="secondary sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={L('উপরে', 'Up')}>↑</button>{' '}
            <button className="secondary sm" disabled={i === cols.length - 1} onClick={() => move(i, 1)} aria-label={L('নিচে', 'Down')}>↓</button>{' '}
            <button className="secondary sm" onClick={() => setCols(cols.filter((_, k) => k !== i))}>{L('সরান', 'Remove')}</button></td>
        </tr>)}</tbody></table></div>}
    <Field label={L('কলাম যোগ করুন', 'Add a column')}>
      <select value={add} onChange={e => addCol(e.target.value)}>
        <option value="">{L('বেছে নিন…', 'Choose…')}</option>
        {available.map(([v, lbl]) => <option key={v} value={v}>{lbl}</option>)}
      </select></Field>
    <p className="muted small">{L('“(গোপন)” লেখা কলামগুলো শুধু তাঁরাই দেখতে পাবেন যাঁদের এনআইডি দেখার অনুমতি আছে; বাকিদের ঘর খালি আসবে।',
      'Columns marked “(private)” only fill in for people allowed to see NIDs; for others they come out blank.')}</p>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}
