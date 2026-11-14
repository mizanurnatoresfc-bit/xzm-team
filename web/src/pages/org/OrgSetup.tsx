import { useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { hrFriendly, nameMap, org, type Department, type Hub, type Position, type Zone } from '../../lib/hr'

type Kind = 'zones' | 'hubs' | 'departments' | 'positions'
const LEVEL: Record<string, string> = { hub: 'হাব পর্যায়', zone: 'জোন পর্যায়', head_office: 'হেড অফিস' }
const KIND: Record<Kind, { label: string; one: string; perm: string }> = {
  zones: { label: 'জোন', one: 'জোন', perm: 'zone' }, hubs: { label: 'হাব', one: 'হাব', perm: 'hub' },
  departments: { label: 'বিভাগ', one: 'বিভাগ', perm: 'department' }, positions: { label: 'পদবি', one: 'পদবি', perm: 'position' },
}
type Row = (Zone | Hub | Department | Position) & Record<string, unknown>

export function OrgSetup() {
  const { can } = useAuth()
  const [tab, setTab] = useState<Kind>('zones')
  const [showArchived, setShowArchived] = useState(false)
  const { toast, node } = useToast()
  const data = useLoad(async () => {
    const [orgs, zones, hubs, departments, positions] = await Promise.all([org.organizations(), org.zones(true), org.hubs(true), org.departments(true), org.positions(true)])
    return { orgs, zones, hubs, departments, positions }
  }, [])
  const [edit, setEdit] = useState<{ row: Partial<Row>; isNew: boolean } | null>(null)
  const [arch, setArch] = useState<Row | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const d = data.data
  const zoneName = useMemo(() => nameMap(d?.zones), [d])
  const deptName = useMemo(() => nameMap(d?.departments), [d])
  const counts = useMemo(() => ({ zones: d?.zones.filter(z => !z.archived_at).length ?? 0, hubs: d?.hubs.filter(z => !z.archived_at).length ?? 0,
    departments: d?.departments.filter(z => !z.archived_at).length ?? 0, positions: d?.positions.filter(z => !z.archived_at).length ?? 0 }), [d])
  const orgRow = d?.orgs[0]
  const rows = ((d?.[tab] ?? []) as Row[]).filter(r => showArchived || !r.archived_at)
  const perm = KIND[tab].perm

  async function saveOrg(form: FormData) {
    setBusy(true); setErr('')
    try {
      await org.insert('organizations', { code: String(form.get('code')).trim().toUpperCase(), name: String(form.get('name')).trim(),
        name_bn: String(form.get('name_bn') || '').trim() || null, phone: String(form.get('phone') || '').trim() || null })
      toast('প্রতিষ্ঠান তৈরি হয়েছে'); await data.reload()
    } catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  async function save() {
    if (!edit) return
    const r = edit.row; setBusy(true); setErr('')
    try {
      const base: Record<string, unknown> = { code: String(r.code ?? '').trim().toUpperCase(), name: String(r.name ?? '').trim(), name_bn: (r.name_bn as string)?.trim() || null }
      if (!base.code || !base.name) throw new Error('কোড ও নাম দিন')
      if (tab === 'zones' || tab === 'hubs') { base.phone = (r.phone as string)?.trim() || null; base.address = (r.address as string)?.trim() || null }
      if (tab === 'zones' || tab === 'departments') base.organization_id = orgRow?.id
      if (tab === 'hubs') { if (!r.zone_id) throw new Error('জোন বেছে নিন'); base.zone_id = r.zone_id }
      if (tab === 'positions') { if (!r.department_id) throw new Error('বিভাগ বেছে নিন'); base.department_id = r.department_id; base.level = String(r.level ?? 'hub') }
      if (edit.isNew) await org.insert(tab, base); else await org.update(tab, String(r.id), base)
      toast(edit.isNew ? `${KIND[tab].one} যোগ হয়েছে` : 'পরিবর্তন সেভ হয়েছে'); setEdit(null); await data.reload()
    } catch (e) { setErr(e instanceof Error && !('code' in e) ? e.message : hrFriendly(e)) } finally { setBusy(false) }
  }
  async function doArchive(reason: string) {
    if (!arch) return
    if (!reason.trim()) { setErr('কারণ লিখুন'); return }
    setBusy(true); setErr('')
    try { await org.archive(tab, arch.id, reason.trim()); toast('আর্কাইভ করা হয়েছে — তথ্য মুছে যায়নি'); setArch(null); await data.reload() }
    catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }

  return <AppShell title="প্রতিষ্ঠান সেটআপ" subtitle="জোন, হাব, বিভাগ ও পদবি। কিছু মুছে ফেলা হয় না — বন্ধ করতে আর্কাইভ করুন।"
    actions={orgRow && can(`org.${perm}.create`) ? <button onClick={() => { setErr(''); setEdit({ row: {}, isNew: true }) }}>+ নতুন {KIND[tab].one}</button> : null}>
    {node}
    {data.error ? <p className="da-error">{hrFriendly(data.error)}</p> : null}
    {data.loading && !d ? <p className="muted">লোড হচ্ছে…</p> : null}
    {d && !orgRow ? <section className="panel">
      <h2>প্রথমে প্রতিষ্ঠান তৈরি করুন</h2>
      <p className="muted">একবারই করতে হয়। এরপর জোন, হাব, বিভাগ ও পদবি যোগ করা যাবে।</p>
      {can('org.organization.create') ? <form onSubmit={e => { e.preventDefault(); void saveOrg(new FormData(e.currentTarget)) }} className="hr-form">
        <Field label="কোড (ইংরেজি)"><input name="code" required defaultValue="XZM" /></Field>
        <Field label="নাম"><input name="name" required defaultValue="XZM-TEAM" /></Field>
        <Field label="নাম (বাংলা)"><input name="name_bn" /></Field>
        <Field label="ফোন"><input name="phone" inputMode="tel" /></Field>
        <div className="row" style={{ alignSelf: 'end' }}><button disabled={busy}>তৈরি করুন</button></div>
        {err && <p className="da-error">{err}</p>}
      </form> : <p className="notice">প্রতিষ্ঠান তৈরির অনুমতি আপনার নেই। Super Admin-কে বলুন।</p>}
    </section> : null}
    {d && orgRow ? <>
      <div className="da-stats" style={{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
        {(Object.keys(KIND) as Kind[]).map(k => <button key={k} className={`da-stat${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>
          <span className="ri"><Icon name={{ zones: 'map', hubs: 'hub', departments: 'org', positions: 'users' }[k]} /></span><span className="lbl">{KIND[k].label}</span><span className="val">{counts[k]}</span></button>)}
      </div>
      <section className="panel">
        <div className="da-bar"><strong>{orgRow.name}</strong>
          <label className="da-check" style={{ margin: 0 }}><input type="checkbox" style={{ width: 'auto', margin: 0 }} checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> আর্কাইভ করাগুলোও দেখান</label></div>
        <DataTable title={KIND[tab].label} file={tab} rows={rows} rowKey={r => r.id}
          empty={<p className="muted">এখনো কোনো {KIND[tab].one} নেই।{tab === 'hubs' && !counts.zones ? ' আগে একটি জোন যোগ করুন।' : ''}{tab === 'positions' && !counts.departments ? ' আগে একটি বিভাগ যোগ করুন।' : ''}</p>}
          cols={[
            { key: 'code', label: 'কোড', render: r => <strong>{r.code}</strong> },
            { key: 'name', label: 'নাম', render: r => <>{r.name}{r.name_bn && <span className="sec">{r.name_bn}</span>}</> },
            ...(tab === 'hubs' ? [{ key: 'zone', label: 'জোন', value: (r: Row) => zoneName[(r as Hub).zone_id] ?? '' }] : []),
            ...(tab === 'positions' ? [{ key: 'dept', label: 'বিভাগ', value: (r: Row) => deptName[(r as Position).department_id] ?? '' },
              { key: 'level', label: 'পর্যায়', value: (r: Row) => LEVEL[String((r as Record<string, unknown>).level ?? 'hub')] ?? '' }] : []),
            ...(tab === 'zones' || tab === 'hubs' ? [{ key: 'phone', label: 'ফোন', value: (r: Row) => (r as Zone).phone ?? '' }] : []),
            { key: 'st', label: 'অবস্থা', value: r => r.archived_at ? 'আর্কাইভ' : 'সক্রিয়', render: r => r.archived_at ? <Badge tone="neutral">আর্কাইভ</Badge> : <Badge tone="ok">সক্রিয়</Badge> },
            { key: 'act', label: '', noExport: true, className: 'r no-print', render: r => !r.archived_at && <div className="row" style={{ justifyContent: 'flex-end' }}>
              {can(`org.${perm}.edit`) && <button className="secondary sm" onClick={() => { setErr(''); setEdit({ row: { ...r }, isNew: false }) }}>সম্পাদনা</button>}
              {can(`org.${perm}.archive`) && <button className="secondary sm" onClick={() => { setErr(''); setArch(r) }}>আর্কাইভ</button>}</div> },
          ]} />
      </section>
    </> : null}
    {edit && <Modal title={edit.isNew ? `নতুন ${KIND[tab].one}` : `${KIND[tab].one} সম্পাদনা`} onClose={() => setEdit(null)}
      actions={<><button className="secondary" onClick={() => setEdit(null)}>বাতিল</button><button disabled={busy} onClick={() => void save()}>সেভ</button></>}>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label="কোড (ইংরেজি, যেমন NAT)"><input value={String(edit.row.code ?? '')} onChange={e => setEdit({ ...edit, row: { ...edit.row, code: e.target.value } })} /></Field>
        <Field label="নাম"><input value={String(edit.row.name ?? '')} onChange={e => setEdit({ ...edit, row: { ...edit.row, name: e.target.value } })} /></Field>
        <Field label="নাম (বাংলা)"><input value={String(edit.row.name_bn ?? '')} onChange={e => setEdit({ ...edit, row: { ...edit.row, name_bn: e.target.value } })} /></Field>
        {tab === 'hubs' && <Field label="জোন"><select value={String(edit.row.zone_id ?? '')} onChange={e => setEdit({ ...edit, row: { ...edit.row, zone_id: e.target.value } })}>
          <option value="">বেছে নিন…</option>{d?.zones.filter(z => !z.archived_at).map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>}
        {tab === 'positions' && <Field label="বিভাগ"><select value={String(edit.row.department_id ?? '')} onChange={e => setEdit({ ...edit, row: { ...edit.row, department_id: e.target.value } })}>
          <option value="">বেছে নিন…</option>{d?.departments.filter(z => !z.archived_at).map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>}
        {tab === 'positions' && <Field label="কোন পর্যায়ের পদ" hint="জোন/হেড অফিস পর্যায়ের পদের কর্মী (যেমন জোনাল ম্যানেজার) হাবের ফিক্সড স্টাফ হিসাবে দেখাবে না।">
          <select value={String(edit.row.level ?? 'hub')} onChange={e => setEdit({ ...edit, row: { ...edit.row, level: e.target.value } })}>
            {Object.entries(LEVEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>}
        {(tab === 'zones' || tab === 'hubs') && <>
          <Field label="ফোন"><input inputMode="tel" value={String(edit.row.phone ?? '')} onChange={e => setEdit({ ...edit, row: { ...edit.row, phone: e.target.value } })} /></Field>
          <Field label="ঠিকানা" wide><input value={String(edit.row.address ?? '')} onChange={e => setEdit({ ...edit, row: { ...edit.row, address: e.target.value } })} /></Field></>}
      </div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
    {arch && <ArchiveModal what={`${arch.name} (${arch.code})`} busy={busy} err={err} onClose={() => setArch(null)} onOk={doArchive} />}
  </AppShell>
}

export function ArchiveModal({ what, busy, err, onClose, onOk, title = 'আর্কাইভ করবেন?', okLabel = 'আর্কাইভ' }:
  { what: string; busy: boolean; err: string; onClose: () => void; onOk: (reason: string) => void; title?: string; okLabel?: string }) {
  const [reason, setReason] = useState('')
  return <Modal title={title} onClose={onClose} actions={<><button className="secondary" onClick={onClose}>বাতিল</button>
    <button className="danger" disabled={busy || !reason.trim()} onClick={() => onOk(reason)}>{okLabel}</button></>}>
    <p><strong>{what}</strong></p>
    <Field label="কারণ (আবশ্যক, অডিট লগে থাকবে)"><textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} /></Field>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}
