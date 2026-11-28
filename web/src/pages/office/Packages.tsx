// Resource packages and the work done on them:
//  · PackagesModal — the zone's named sets of parts ("manager desk = PC + monitor + chair …"); only the zonal manager changes them.
//  · PartsReportModal — click a package (desk set) and tell what is wrong with each part, in one go. Every flagged part becomes its own
//    problem report: the zonal manager sees it at once and the hub manager verifies it (see Notices).
//  · AssignModal — responsibility in bulk: the ticked items, every item of one kind, or everything of the hub.
import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { Badge, Field, Modal } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { assignAssets, ASSET_KIND, packages, type Asset, type AssignMode, type OfficePackage, type Property } from '../../lib/office'
import { ops, opsFriendly } from '../../lib/officeOps'
import type { EmpLite } from '../../lib/sorting'
import { EmpPicker, empLabel } from '../sorting/Sorting'
import { askWith } from './askText'

const kindName = (L: (bn: string, en: string) => string, k: string) => ASSET_KIND[k] ? L(ASSET_KIND[k][0], ASSET_KIND[k][1]) : k

// ---------------------------------------------------------------- the zone's packages
type Draft = { id?: string; name: string; note: string; items: Record<string, number> }

export function PackagesModal({ property, list, onClose, onChanged }: { property: Property; list: OfficePackage[]; onClose: () => void; onChanged: () => Promise<void> | void }) {
  const { L, n } = usePrefs()
  const [d, setD] = useState<Draft | null>(null)
  const [add, setAdd] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const manage = list.length ? list.some(p => p.can_manage) : true   // the database refuses anyone else; an empty zone shows the button to try
  const parts = (items: Record<string, number>) => Object.entries(items).map(([k, c]) => `${kindName(L, k)} × ${n(c)}`).join(' · ')
  async function save() {
    if (!d) return
    if (!d.name.trim()) return setErr(L('প্যাকেজের নাম দিন', 'Give the package a name'))
    if (!Object.keys(d.items).length) return setErr(L('অন্তত একটা পার্ট যোগ করুন', 'Add at least one part'))
    setBusy(true); setErr('')
    try { await packages.save(property.zone_id, d.name.trim(), d.items, d.note.trim() || null, d.id); setD(null); await onChanged() }
    catch (e) { setErr(opsFriendly(e)) } finally { setBusy(false) }
  }
  async function remove(p: OfficePackage) {
    const why = await askWith(L)(L(`"${p.name}" সরানোর কারণ`, `Why remove "${p.name}"?`)); if (!why) return
    setErr('')
    try { await packages.archive(p.id, why); await onChanged() } catch (e) { setErr(opsFriendly(e)) }
  }
  return <Modal wide title={L('রিসোর্স প্যাকেজ', 'Resource packages')} onClose={() => { if (!busy) onClose() }}
    actions={d ? <><button className="secondary" disabled={busy} onClick={() => { setD(null); setErr('') }}>{L('পিছনে', 'Back')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ', 'Save')}</button></>
      : <button className="secondary" onClick={onClose}>{L('বন্ধ', 'Close')}</button>}>
    {!d ? <>
      <p className="muted small">{L('প্যাকেজ হলো নামওয়ালা একটা সেট — যেমন "ম্যানেজার ডেস্ক = পিসি + মনিটর + কিবোর্ড + মাউস + চেয়ার + টেবিল"। জোনের প্যাকেজ জোনাল ম্যানেজার বানান; হাব সেটা ডেস্কে বসায়।', 'A package is a named set of parts. The zonal manager makes the zone’s packages; hubs put them on desks.')}</p>
      {!list.length && <p className="muted">{L('এখনো কোনো প্যাকেজ নেই।', 'No package yet.')}</p>}
      <div className="oo-list">{list.map(p => <article key={p.id} className="oo-row">
        <div className="oo-main"><b>{p.name}</b><div className="small">{parts(p.items)}</div>{p.note && <div className="muted small">{p.note}</div>}</div>
        {p.can_manage && <div className="row-acts"><button className="secondary sm" onClick={() => { setErr(''); setD({ id: p.id, name: p.name, note: p.note ?? '', items: { ...p.items } }) }}>{L('এডিট', 'Edit')}</button>
          <button className="secondary sm" onClick={() => void remove(p)}>{L('সরান', 'Remove')}</button></div>}
      </article>)}</div>
      {manage && <p><button onClick={() => { setErr(''); setD({ name: '', note: '', items: { pc: 1, monitor: 1, chair: 1, table: 1 } }) }}><Icon name="plus" size={15} />{L('নতুন প্যাকেজ', 'New package')}</button></p>}
    </> : <>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label={L('প্যাকেজের নাম', 'Package name')}><input value={d.name} onChange={e => setD({ ...d, name: e.target.value })} placeholder={L('যেমন ম্যানেজার ডেস্ক', 'e.g. Manager desk')} /></Field>
        <Field label={L('নোট', 'Note')}><input value={d.note} onChange={e => setD({ ...d, note: e.target.value })} /></Field>
      </div>
      <div className="hr-form">{Object.entries(d.items).map(([k, c]) => <Field key={k} label={kindName(L, k)}>
        <div className="row-acts"><input type="number" min={1} max={999} step={1} value={c} onChange={e => setD({ ...d, items: { ...d.items, [k]: Math.max(1, Number(e.target.value) || 1) } })} />
          <button type="button" className="secondary sm" onClick={() => { const next = { ...d.items }; delete next[k]; setD({ ...d, items: next }) }}>{L('বাদ', 'Remove')}</button></div></Field>)}</div>
      <div className="row-acts">
        <Field label={L('পার্ট যোগ', 'Add a part')}><select value={add} onChange={e => setAdd(e.target.value)}><option value="">—</option>
          {Object.keys(ASSET_KIND).filter(k => !(k in d.items)).map(k => <option key={k} value={k}>{kindName(L, k)}</option>)}</select></Field>
        <button type="button" className="secondary sm" disabled={!add} onClick={() => { setD({ ...d, items: { ...d.items, [add]: 1 } }); setAdd('') }}>{L('যোগ', 'Add')}</button></div>
    </>}
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

// ---------------------------------------------------------------- click a package, report each part
export type Part = { id: string; name: string; kind: string }
type Mark = { on: boolean; type: 'broken' | 'repair' | 'lost'; note: string }
const TYPE: Record<Mark['type'], [string, string]> = { broken: ['নষ্ট', 'Broken'], repair: ['মেরামত লাগবে', 'Needs repair'], lost: ['হারিয়েছে', 'Lost'] }

export function PartsReportModal({ propertyId, title, parts, onClose, onDone }: { propertyId: string; title: string; parts: Part[]; onClose: () => void; onDone: (sent: number, all: boolean) => void }) {
  const { L } = usePrefs()
  const [marks, setMarks] = useState<Record<string, Mark>>({})
  const [urgent, setUrgent] = useState(false)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const mark = (id: string): Mark => marks[id] ?? { on: false, type: 'broken', note: '' }
  const set = (id: string, m: Partial<Mark>) => setMarks({ ...marks, [id]: { ...mark(id), ...m } })
  const flagged = parts.filter(p => mark(p.id).on)
  async function send() {
    if (!flagged.length) return setErr(L('যে পার্টে সমস্যা, সেটা টিক দিন', 'Tick the part that has a problem'))
    setBusy(true); setErr('')
    const failed: string[] = []; const sentIds = new Set<string>()
    for (const p of flagged) {
      const m = mark(p.id)
      try {
        await ops.noticeSend({ property: propertyId, kind: 'broken', title: `${p.name} — ${L(TYPE[m.type][0], TYPE[m.type][1])}`, asset: p.id, itemKind: p.kind, qty: 1, note: m.note.trim() || null, urgent })
        sentIds.add(p.id)
      } catch (e) { failed.push(`${p.name}: ${opsFriendly(e)}`) }
    }
    setBusy(false)
    // The parts that went are un-ticked, so a second press sends only the ones that failed.
    if (failed.length) { setErr(failed.join(' · ')); setMarks(Object.fromEntries(Object.entries(marks).map(([id, m]) => [id, sentIds.has(id) ? { ...m, on: false } : m]))) }
    if (sentIds.size) onDone(sentIds.size, !failed.length)
  }
  return <Modal wide title={L(`${title} — সমস্যা জানান`, `${title} — report a problem`)} onClose={() => { if (!busy) onClose() }}
    actions={<><button className="secondary" disabled={busy} onClick={onClose}>{L('বাতিল', 'Cancel')}</button>
      <button disabled={busy || !flagged.length} onClick={() => void send()}><Icon name="bell" size={14} />{L(`${flagged.length}টা রিপোর্ট পাঠান`, `Send ${flagged.length} report(s)`)}</button></>}>
    <p className="muted small">{L('প্রতিটা পার্টের পাশে সমস্যা থাকলে টিক দিন। প্রতিটা পার্টের আলাদা রিপোর্ট হবে: জোনাল ম্যানেজার সাথে সাথে দেখবেন, হাব ম্যানেজার যাচাই করবেন।', 'Tick every part that has a problem. Each part becomes its own report: the zonal manager sees it at once and the hub manager verifies it.')}</p>
    <div className="oo-list">{parts.map(p => { const m = mark(p.id)
      return <article key={p.id} className="oo-row">
        <div className="oo-main"><label className="oo-check"><input type="checkbox" checked={m.on} onChange={e => set(p.id, { on: e.target.checked })} /> <Icon name={ASSET_KIND[p.kind]?.[2] ?? 'form'} size={16} /> <b>{p.name}</b></label>
          {m.on && <div className="row-acts">
            <select value={m.type} onChange={e => set(p.id, { type: e.target.value as Mark['type'] })} aria-label={L('কী হয়েছে', 'What happened')}>
              {(Object.keys(TYPE) as Array<Mark['type']>).map(k => <option key={k} value={k}>{L(TYPE[k][0], TYPE[k][1])}</option>)}</select>
            <input value={m.note} onChange={e => set(p.id, { note: e.target.value })} placeholder={L('বিস্তারিত (ইচ্ছা হলে)', 'Details (optional)')} /></div>}</div>
        <Badge tone={m.on ? 'bad' : 'ok'}>{m.on ? L('সমস্যা', 'Problem') : L('ঠিক আছে', 'OK')}</Badge>
      </article> })}</div>
    <label className="small oo-check"><input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} />{L('জরুরি', 'Urgent')}</label>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

// ---------------------------------------------------------------- responsibility in bulk
export function AssignModal({ property, assets, ticked, onClose, onDone }: { property: Property; assets: Asset[]; ticked: Asset[]; onClose: () => void; onDone: (n: number, who: string | null) => void }) {
  const { L, n } = usePrefs()
  const free = assets.filter(a => !a.desk_id)                                  // items on a desk follow the desk's own set
  const kinds = [...new Set(free.map(a => a.kind))]
  const [mode, setMode] = useState<AssignMode>(ticked.length ? 'items' : 'kind')
  const [kind, setKind] = useState(kinds[0] ?? '')
  const [who, setWho] = useState<EmpLite | null>(null)
  const [clear, setClear] = useState(false)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const target = mode === 'items' ? ticked.filter(a => !a.desk_id) : mode === 'kind' ? free.filter(a => a.kind === kind) : free
  const onDesks = mode === 'items' ? ticked.length - target.length : 0
  async function go() {
    if (!clear && !who) return setErr(L('কাকে দেবেন, আইডি দিয়ে বেছে নিন', 'Choose the person by ID'))
    if (!target.length) return setErr(L('এতে কোনো জিনিস নেই', 'No item to change'))
    setBusy(true); setErr('')
    try { const c = await assignAssets(property.id, clear ? null : who!.id, mode, mode === 'items' ? target.map(a => a.id) : undefined, mode === 'kind' ? kind : undefined); onDone(c, clear ? null : empLabel(who ?? undefined)) }
    catch (e) { setErr(opsFriendly(e)) } finally { setBusy(false) }
  }
  const holders = new Set(target.map(a => a.holder_id).filter(Boolean) as string[])
  return <Modal title={L(`দায়িত্ব দিন — ${property.name}`, `Give responsibility — ${property.name}`)} onClose={() => { if (!busy) onClose() }}
    actions={<><button className="secondary" disabled={busy} onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void go()}>{clear ? L('দায়িত্ব সরান', 'Remove') : L('দায়িত্ব দিন', 'Give')}</button></>}>
    <div className="da-seg" style={{ marginBottom: 10 }}>
      {ticked.length > 0 && <button type="button" className={mode === 'items' ? 'sm' : 'secondary sm'} onClick={() => setMode('items')}>{L(`বাছাই করা ${n(ticked.length)}টা`, `${ticked.length} ticked`)}</button>}
      <button type="button" className={mode === 'kind' ? 'sm' : 'secondary sm'} onClick={() => setMode('kind')}>{L('একটা ধরনের সব', 'Every item of one kind')}</button>
      <button type="button" className={mode === 'all' ? 'sm' : 'secondary sm'} onClick={() => setMode('all')}>{L('পুরো হাবের সব', 'Everything here')}</button></div>
    {mode === 'kind' && <Field label={L('কোন ধরন', 'Which kind')}><select value={kind} onChange={e => setKind(e.target.value)}>
      {kinds.map(k => <option key={k} value={k}>{kindName(L, k)}</option>)}</select></Field>}
    <label className="small oo-check"><input type="checkbox" checked={clear} onChange={e => setClear(e.target.checked)} />{L('দায়িত্ব সরাতে চাই (কাউকে নয়)', 'Take responsibility away (nobody)')}</label>
    {!clear && <EmpPicker label={L('কাকে (এমপ্লয়ি আইডি)', 'To whom (employee ID)')} value={who} onPick={setWho} />}
    <p className="small">{L(`${n(target.length)}টা জিনিস বদলাবে`, `${target.length} item(s) will change`)}{holders.size > 0 && L(` — এখন ${n(holders.size)} জনের দায়িত্বে`, ` — held by ${holders.size} now`)}.
      {onDesks > 0 && <> {L(`${n(onDesks)}টা ডেস্কের জিনিস বাদ — সেগুলো ডেস্ক সেট থেকে বদলান।`, `${onDesks} desk item(s) left out — change them in the desk set.`)}</>}</p>
    <p className="muted small">{L('ডেস্কে বসানো জিনিস ডেস্কের নিজের দায়িত্বে থাকে, তাই এখানে আসে না।', 'Items placed on a desk follow the desk’s own person, so they are not changed here.')}</p>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}
