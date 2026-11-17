import { useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { extraFriendly, fields, makeCode, parseOptions, referrals, TYPE_LABEL, type CField, type PCol } from '../../lib/extra'
import { useOrg } from './common'
import { Formats } from './Formats'

/** Company policy screen: extra profile fields and extra columns for the "people in hand" list,
 *  for the whole company (Head Office) or one zone (Zonal Manager). */
export function FieldSettings() {
  const { can, grants } = useAuth()
  const { L, lang } = usePrefs()
  const o = useOrg()
  const { toast, node } = useToast()
  const [tab, setTab] = useState<'fields' | 'columns' | 'formats'>(can('hr.profile_field.configure') ? 'fields' : 'columns')
  const data = useLoad(async () => {
    const [s, f, c] = await Promise.all([fields.sections(), fields.all(), referrals.columns()])
    return { s, f, c }
  }, [])
  const [addF, setAddF] = useState(false); const [addC, setAddC] = useState(false)
  const [archive, setArchive] = useState<{ kind: 'field' | 'column'; id: string; label: string } | null>(null)
  const global = (perm: string) => grants.some(g => (g.is_super || g.permission_code === perm) && g.scope_type === 'global')
  const zoneName = (z: string | null) => z ? o.names.zone[z] ?? L('অন্য এরিয়া', 'Other area') : L('পুরো কোম্পানি', 'Whole company')
  const lbl = (x: { label: string; label_bn: string | null }) => lang === 'bn' && x.label_bn ? x.label_bn : x.label

  return <AppShell title={L('প্রোফাইলের ঘর ও কলাম', 'Profile fields & columns')}
    subtitle={L('কোম্পানির নিয়ম অনুযায়ী কর্মীর প্রোফাইলে নতুন ঘর আর রেফারেন্সের তালিকায় নতুন কলাম যোগ করুন। হেড অফিস পুরো কোম্পানির জন্য, জোনাল ম্যানেজার নিজের এরিয়াের জন্য।',
      'Add profile fields and referral-list columns to match company policy. Head Office for the whole company, Zonal Managers for their own zone.')}>
    {node}
    {!can('hr.profile_field.configure') && !can('hr.referral.configure') && <p className="notice">{L('এই পাতা ব্যবহারের অনুমতি আপনার নেই।', 'You do not have permission to use this page.')}</p>}
    <div className="row" style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
      {can('hr.profile_field.configure') && <button className={tab === 'fields' ? '' : 'secondary'} onClick={() => setTab('fields')}>{L('প্রোফাইলের ঘর', 'Profile fields')}</button>}
      {can('hr.referral.configure') && <button className={tab === 'columns' ? '' : 'secondary'} onClick={() => setTab('columns')}>{L('হাতে থাকা লোকের কলাম', 'People-in-hand columns')}</button>}
      {can('hr.profile_field.configure') && <button className={tab === 'formats' ? '' : 'secondary'} onClick={() => setTab('formats')}>{L('এক্সপোর্ট / ইমপোর্ট ফরম্যাট', 'Export / import formats')}</button>}
    </div>
    {data.error ? <p className="da-error">{extraFriendly(data.error)}</p> : null}

    {tab === 'fields' && <section className="panel">
      <div className="da-bar"><h2 style={{ margin: 0 }}>{L('প্রোফাইলের ঘর', 'Profile fields')}</h2><button onClick={() => setAddF(true)}>+ {L('নতুন ঘর', 'New field')}</button></div>
      {!data.data?.f.length ? <p className="muted">{L('এখনো কোনো ঘর নেই। যেমন: রক্তের গ্রুপ, বাইক নম্বর, ব্যাংক হিসাব, শিক্ষাগত যোগ্যতা।', 'No fields yet. E.g. blood group, bike number, bank account, education.')}</p> :
        data.data.s.filter(s => data.data!.f.some(f => f.section_id === s.id)).map(s => <div key={s.id}>
          <h3>{lang === 'bn' && s.name_bn ? s.name_bn : s.name}</h3>
          <div className="da-table-wrap"><table className="da-table"><thead><tr><th>{L('ঘর', 'Field')}</th><th>{L('ধরন', 'Type')}</th><th>{L('কার জন্য', 'For')}</th><th>{L('বাধ্যতামূলক', 'Required')}</th><th>{L('কে দেখবে', 'Who sees')}</th><th /></tr></thead>
            <tbody>{data.data!.f.filter(f => f.section_id === s.id).map(f => <tr key={f.id}>
              <td><strong>{lbl(f)}</strong>{f.options?.length ? <span className="sec">{f.options.map(x => x.label).join(', ')}</span> : null}</td>
              <td>{TYPE_LABEL[f.field_type] ? L(...TYPE_LABEL[f.field_type]) : f.field_type}</td>
              <td>{f.zone_id ? <Badge tone="info">{zoneName(f.zone_id)}</Badge> : zoneName(null)}</td>
              <td>{f.is_required ? L('হ্যাঁ', 'Yes') : L('না', 'No')}</td>
              <td className="small">{f.view_permission === 'hr.employee_sensitive.view' ? L('শুধু এইচআর (গোপন)', 'HR only (private)') : L('যিনি কর্মীকে দেখতে পারেন', 'Anyone who can see the employee')}</td>
              <td style={{ textAlign: 'right' }}>{(f.zone_id ? can('hr.profile_field.configure') : global('hr.profile_field.configure')) && <button className="secondary sm" onClick={() => setArchive({ kind: 'field', id: f.id, label: lbl(f) })}>{L('সরান', 'Remove')}</button>}</td>
            </tr>)}</tbody></table></div></div>)}
    </section>}

    {tab === 'columns' && <section className="panel">
      <div className="da-bar"><h2 style={{ margin: 0 }}>{L('হাতে থাকা লোকের তালিকার বাড়তি কলাম', 'Extra columns for the people-in-hand list')}</h2><button onClick={() => setAddC(true)}>+ {L('নতুন কলাম', 'New column')}</button></div>
      <p className="muted small">{L('নাম, মোবাইল, কোন পদের জন্য, এলাকা, অবস্থা — এগুলো সবসময় থাকে। এর বাইরে যা লাগবে যোগ করুন (যেমন: বাইক আছে কিনা, বয়স, অভিজ্ঞতা)।',
        'Name, mobile, position, area and status are always there. Add anything else you need (e.g. has a bike, age, experience).')}</p>
      {!data.data?.c.length ? <p className="muted">{L('কোনো বাড়তি কলাম নেই।', 'No extra columns.')}</p> :
        <div className="da-table-wrap"><table className="da-table"><thead><tr><th>{L('কলাম', 'Column')}</th><th>{L('ধরন', 'Type')}</th><th>{L('কার জন্য', 'For')}</th><th /></tr></thead>
          <tbody>{data.data.c.map((c: PCol) => <tr key={c.id}><td><strong>{lbl(c)}</strong>{c.options?.length ? <span className="sec">{c.options.map(x => x.label).join(', ')}</span> : null}</td>
            <td>{TYPE_LABEL[c.field_type] ? L(...TYPE_LABEL[c.field_type]) : c.field_type}</td><td>{c.zone_id ? <Badge tone="info">{zoneName(c.zone_id)}</Badge> : zoneName(null)}</td>
            <td style={{ textAlign: 'right' }}>{(c.zone_id ? can('hr.referral.configure') : global('hr.referral.configure')) && <button className="secondary sm" onClick={() => setArchive({ kind: 'column', id: c.id, label: lbl(c) })}>{L('সরান', 'Remove')}</button>}</td></tr>)}</tbody></table></div>}
    </section>}

    {tab === 'formats' && <Formats toast={toast} />}

    {addF && data.data && <NewItem kind="field" sections={data.data.s} canGlobal={global('hr.profile_field.configure')} zones={o.data?.zones ?? []}
      onClose={() => setAddF(false)} onDone={() => { setAddF(false); toast(L('নতুন ঘর যোগ হয়েছে', 'Field added')); void data.reload() }} />}
    {addC && <NewItem kind="column" sections={[]} canGlobal={global('hr.referral.configure')} zones={o.data?.zones ?? []}
      onClose={() => setAddC(false)} onDone={() => { setAddC(false); toast(L('নতুন কলাম যোগ হয়েছে', 'Column added')); void data.reload() }} />}
    {archive && <Modal title={L(`"${archive.label}" সরাবেন?`, `Remove "${archive.label}"?`)} onClose={() => setArchive(null)}
      actions={<><button className="secondary" onClick={() => setArchive(null)}>{L('বাতিল', 'Cancel')}</button>
        <button className="danger" onClick={() => void (async () => {
          try {
            if (archive.kind === 'field') await fields.update(archive.id, { archived_at: new Date().toISOString() } as Partial<CField>)
            else await referrals.archiveColumn(archive.id)
            setArchive(null); toast(L('সরানো হয়েছে — আগের তথ্য মুছে যায়নি', 'Removed — old data is kept')); void data.reload()
          } catch (e) { toast(extraFriendly(e)) }
        })()}>{L('সরান', 'Remove')}</button></>}>
      <p className="muted small">{L('নতুন করে আর দেখা/লেখা যাবে না, তবে আগের তথ্য ইতিহাসে থেকে যাবে।', 'It will no longer be shown or filled in; earlier data stays in the history.')}</p>
    </Modal>}
  </AppShell>
}

function NewItem({ kind, sections, canGlobal, zones, onClose, onDone }: { kind: 'field' | 'column'; sections: Array<{ id: string; name: string; name_bn: string | null; code: string }>
  canGlobal: boolean; zones: Array<{ id: string; name: string }>; onClose: () => void; onDone: () => void }) {
  const { L, lang } = usePrefs()
  const [f, setF] = useState({ label: '', label_bn: '', type: 'text', options: '', required: false, section: sections.find(s => s.code === 'other')?.id ?? sections[0]?.id ?? '',
    zone: canGlobal ? '' : zones[0]?.id ?? '', privateField: false, newSection: '' })
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const types = kind === 'field' ? ['text', 'textarea', 'number', 'date', 'dropdown', 'multi_select', 'checkbox'] : ['text', 'number', 'date', 'dropdown']
  async function go() {
    setErr('')
    const label = f.label.trim() || f.label_bn.trim()
    if (!label) return setErr(L('ঘরের নাম দিন', 'Enter a name'))
    const options = ['dropdown', 'multi_select'].includes(f.type) ? parseOptions(f.options) : []
    if (['dropdown', 'multi_select'].includes(f.type) && !options.length) return setErr(L('কমা দিয়ে বিকল্পগুলো লিখুন', 'List the choices, separated by commas'))
    setBusy(true)
    try {
      const code = makeCode(f.label.trim() || 'field')
      if (kind === 'field') {
        let section = f.section
        if (section === '__new') {
          if (!f.newSection.trim()) throw new Error(L('নতুন অংশের নাম দিন', 'Name the new section'))
          await fields.createSection(f.newSection.trim(), f.newSection.trim())
          section = (await fields.sections()).find(s => s.name === f.newSection.trim())?.id ?? ''
        }
        await fields.create({ section_id: section, code, label, label_bn: f.label_bn.trim() || null, field_type: f.type, options, is_required: !f.zone && f.required,
          zone_id: f.zone || null, view_permission: f.privateField ? 'hr.employee_sensitive.view' : null, sort_order: 100 })
      } else {
        await referrals.createColumn({ code, label, label_bn: f.label_bn.trim() || null, field_type: f.type, options, zone_id: f.zone || null })
      }
      onDone()
    } catch (e) { setErr(e instanceof Error && /[ঀ-৿]/.test(e.message) ? e.message : extraFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title={kind === 'field' ? L('নতুন প্রোফাইলের ঘর', 'New profile field') : L('নতুন কলাম', 'New column')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void go()}>{L('যোগ করুন', 'Add')}</button></>}>
    <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Field label={L('নাম (বাংলা)', 'Name (Bangla)')}><input value={f.label_bn} onChange={e => setF({ ...f, label_bn: e.target.value })} placeholder={L('যেমন: রক্তের গ্রুপ', 'e.g. রক্তের গ্রুপ')} /></Field>
      <Field label={L('নাম (ইংরেজি)', 'Name (English)')}><input value={f.label} onChange={e => setF({ ...f, label: e.target.value })} placeholder="Blood group" /></Field>
      <Field label={L('ধরন', 'Type')}><select value={f.type} onChange={e => setF({ ...f, type: e.target.value })}>{types.map(t => <option key={t} value={t}>{L(...TYPE_LABEL[t])}</option>)}</select></Field>
      <Field label={L('কার জন্য', 'For')}><select value={f.zone} onChange={e => setF({ ...f, zone: e.target.value })}>
        {canGlobal && <option value="">{L('পুরো কোম্পানি', 'Whole company')}</option>}
        {zones.map(z => <option key={z.id} value={z.id}>{L('শুধু এরিয়া: ', 'Area only: ')}{z.name}</option>)}</select></Field>
      {['dropdown', 'multi_select'].includes(f.type) && <Field wide label={L('বিকল্পগুলো (কমা দিয়ে)', 'Choices (comma separated)')}><input value={f.options} onChange={e => setF({ ...f, options: e.target.value })} placeholder="A+, A-, B+, B-, O+, O-, AB+, AB-" /></Field>}
      {kind === 'field' && <>
        <Field label={L('কোন অংশে', 'Section')}><select value={f.section} onChange={e => setF({ ...f, section: e.target.value })}>
          {sections.map(s => <option key={s.id} value={s.id}>{lang === 'bn' && s.name_bn ? s.name_bn : s.name}</option>)}<option value="__new">+ {L('নতুন অংশ', 'New section')}</option></select></Field>
        {f.section === '__new' && <Field label={L('নতুন অংশের নাম', 'New section name')}><input value={f.newSection} onChange={e => setF({ ...f, newSection: e.target.value })} /></Field>}
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} disabled={!!f.zone} checked={!f.zone && f.required} onChange={e => setF({ ...f, required: e.target.checked })} />
          {L('বাধ্যতামূলক (আইডি আবেদনে লাগবে)', 'Required (needed for ID application)')}{f.zone ? <span className="muted small"> — {L('এরিয়াের ঘর ঐচ্ছিক', 'zone fields are optional')}</span> : null}</label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.privateField} onChange={e => setF({ ...f, privateField: e.target.checked })} />
          {L('গোপন — শুধু এইচআর (এনআইডি দেখার অনুমতি যাঁদের) দেখবে', 'Private — only HR with sensitive-data access')}</label>
      </>}
    </div>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}
