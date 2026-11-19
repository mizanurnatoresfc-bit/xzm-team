import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { Badge, Field, Modal, Stat, useLoad, useToast } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { autoCode, hrFriendly } from '../../lib/hr'
import { sorting, type EmpLite } from '../../lib/sorting'
import {
  ASSET_KIND, CONDITION, DESK_DEFAULT, DIR, DIR_GRID, office, OFFICE_PARTS, PLACE_KIND, ROOM_DEFAULT, ROOM_KIND,
  type Asset, type OfficeSec, type Desk, type PlaceKind, type Property, type Room,
} from '../../lib/office'
import { POWER } from '../../lib/officeOps'
import { Bills, LendModal, NoticeModal, Notices, People, Power, Rent, roomSplit, Security, useLoans, Zone, type Ctx } from './OfficeOps'
import { useOrg } from '../hr/common'
import { EmpPicker, empLabel } from '../sorting/Sorting'

type Sec = OfficeSec
const SECTIONS = OFFICE_PARTS
const PKEY = 'xzm_office_property'

export function Office() {
  const { section } = useParams()
  const { can } = useAuth()
  const { L } = usePrefs()
  const o = useOrg()
  const props = useLoad(() => office.properties(), [])
  const [pid, setPid] = useState(() => { try { return sessionStorage.getItem(PKEY) || '' } catch { return '' } })
  const list = props.data ?? []
  useEffect(() => { if (list.length && !list.some(p => p.id === pid)) setPid(list[0].id) }, [list, pid])
  useEffect(() => { try { if (pid) sessionStorage.setItem(PKEY, pid) } catch { /* ignore */ } }, [pid])
  const p = list.find(x => x.id === pid) ?? null
  const rooms = useLoad(() => p ? office.rooms(p.id) : Promise.resolve([] as Room[]), [p?.id])
  const desks = useLoad(() => p ? office.desks(p.id) : Promise.resolve([] as Desk[]), [p?.id])
  const assets = useLoad(() => p && can('office.asset.view') ? office.assets(p.id) : Promise.resolve([] as Asset[]), [p?.id])
  const ids = [...(rooms.data ?? []).map(r => r.responsible_id), ...(desks.data ?? []).map(d => d.responsible_id), ...(assets.data ?? []).map(a => a.holder_id)]
  const key = [...new Set(ids.filter(Boolean) as string[])].sort().join(',')
  const emps = useLoad(() => sorting.employeesByIds(key ? key.split(',') : []).catch(() => [] as EmpLite[]), [key])
  const emp = useMemo(() => Object.fromEntries((emps.data ?? []).map(e => [e.id, e])) as Record<string, EmpLite>, [emps.data])
  const sec = SECTIONS.find(s => s.key === section)
  if (!sec) return <Navigate to="/app/office/overview" replace />
  const tabs = SECTIONS.filter(s => s.perms.some(x => can(x)))
  const reload = async () => { await Promise.all([rooms.reload(), desks.reload(), assets.reload()]) }

  const hubName = (id: string | null) => (id && o.names.hub[id]) || ''
  const reloadPlaces = async () => { await props.reload() }

  return <AppShell title={L(sec.bn, sec.en)} subtitle={p ? `${p.name} · ${L(PLACE_KIND[p.kind][0], PLACE_KIND[p.kind][1])}` : undefined}>
    <section className="da-filters panel no-print hub-top">
      {sec.key !== 'places' && <Field label={L('অফিস / আবাসিক', 'Office / residence')}><select value={pid} onChange={e => setPid(e.target.value)}>
        {list.map(x => <option key={x.id} value={x.id}>{PLACE_KIND[x.kind][2]} {x.name}</option>)}</select></Field>}
      <nav className="hub-tabs" aria-label={L('আমার অফিস', 'My office')}>
        {tabs.map(t => <Link key={t.key} to={`/app/office/${t.key}`} className={t.key === sec.key ? 'on' : ''}><Icon name={t.icon} size={15} /><span>{L(t.bn, t.en)}</span></Link>)}
      </nav>
    </section>
    {props.error ? <p className="da-error">{hrFriendly(props.error)}</p> : null}
    {!sec.perms.some(x => can(x)) ? <p className="notice">{L('এই পাতা দেখার অনুমতি আপনার রোলে নেই।', 'Your role may not open this page.')}</p>
      : sec.key === 'places' ? <Places list={list} reload={async () => { await props.reload() }} />
      : props.data && !list.length ? <p className="notice">{L('এখনো কোনো অফিস বা আবাসিক যোগ হয়নি।', 'No office or residence yet.')} <Link to="/app/office/places">{L('যোগ করুন →', 'Add one →')}</Link></p>
      : !p ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>
      : <Body sec={sec.key} ctx={{ p, all: list, hubName, rooms: rooms.data ?? [], desks: desks.data ?? [], assets: assets.data ?? [], emp, reload, reloadPlaces }} />}
  </AppShell>
}

function Body({ sec, ctx }: { sec: Sec; ctx: Ctx }) {
  switch (sec) {
    case 'overview': return <Overview ctx={ctx} />
    case 'rooms': return <Rooms ctx={ctx} />
    case 'desks': return <Desks ctx={ctx} />
    case 'assets': return <Assets ctx={ctx} />
    case 'rent': return <Rent ctx={ctx} />
    case 'bills': return <Bills ctx={ctx} />
    case 'power': return <Power ctx={ctx} />
    case 'security': return <Security ctx={ctx} />
    case 'people': return <People ctx={ctx} />
    case 'notices': return <Notices ctx={ctx} />
    case 'zone': return <Zone ctx={ctx} />
    default: return null
  }
}

const ask = (q: string) => (window.prompt(q) ?? '').trim()

// ---------------------------------------------------------------- overview: visual layout + checks
function Overview({ ctx }: { ctx: Ctx }) {
  const { L, n } = usePrefs()
  const floors = [...new Set(ctx.rooms.map(r => r.floor))].sort((a, b) => a - b)
  const [floor, setFloor] = useState<number | null>(null)
  const fl = floor ?? floors[0] ?? 1
  const inFloor = ctx.rooms.filter(r => r.floor === fl)
  const itemsOf = (room: string) => ctx.assets.filter(a => a.room_id === room && !a.desk_id)
  const desksOf = (room: string) => ctx.desks.filter(d => d.room_id === room)
  const bad = ctx.assets.filter(a => a.condition !== 'good')
  const split = roomSplit(ctx.rooms)
  // Smart checks: what someone walking the office would notice.
  const checks: Array<[string, 'warn' | 'bad' | 'info']> = []
  for (const d of ctx.desks) {
    if (!d.responsible_id) checks.push([L(`${d.name}: দায়িত্বে কেউ নেই`, `${d.name}: nobody responsible`), 'warn'])
    const have = new Set(ctx.assets.filter(a => a.desk_id === d.id).map(a => a.kind))
    const miss = DESK_DEFAULT.filter(k => !have.has(k))
    if (miss.length && miss.length < DESK_DEFAULT.length) checks.push([L(`${d.name}: ${miss.map(k => ASSET_KIND[k][0]).join(', ')} নেই`, `${d.name}: no ${miss.map(k => ASSET_KIND[k][1]).join(', ')}`), 'info'])
  }
  for (const r of ctx.rooms) {
    const have = new Set(ctx.assets.filter(a => a.room_id === r.id).map(a => a.kind))
    const miss = (ROOM_DEFAULT[r.kind] ?? []).filter(k => !have.has(k))
    if (miss.length) checks.push([L(`${r.name}: ${miss.map(k => ASSET_KIND[k][0]).join(', ')} লেখা নেই`, `${r.name}: no ${miss.map(k => ASSET_KIND[k][1]).join(', ')} listed`), 'info'])
    if (r.kind === 'kitchen' && have.has('cylinder') && r.direction === 'ne') checks.push([L(`${r.name}: উত্তর-পূর্ব কোণে রান্নাঘর — সিলিন্ডারের বাতাস চলাচল দেখে নিন`, `${r.name}: kitchen in the north-east — check ventilation for the cylinder`), 'info'])
  }
  if (ctx.p.kind === 'office' && split.living > 0) checks.push([L(`অফিসের ${n(split.living)}টা রুম থাকার কাজে — "কারা থাকেন"-এ নাম লিখে রাখুন`, `${split.living} room(s) of this office are lived in — list who under "Who lives here"`), 'info'])
  for (const r of ctx.rooms) {
    const w = ctx.assets.filter(a => a.room_id === r.id && a.condition === 'good').reduce((s, a) => s + a.quantity * (a.watt ?? POWER[a.kind]?.[0] ?? 0), 0)
    if (w >= 2000) checks.push([L(`${r.name}: এক রুমে ${n(w)} ওয়াটের লোড — একই লাইনে/মাল্টিপ্লাগে সব না দিয়ে ভাগ করে দিন`, `${r.name}: ${w} W in one room — split it across lines`), 'warn'])
  }
  for (const a of bad) checks.push([`${a.name}${a.serial_no ? ` (${a.serial_no})` : ''}: ${L(CONDITION[a.condition][0], CONDITION[a.condition][1])}`, a.condition === 'repair' ? 'warn' : 'bad'])
  return <>
    <div className="da-stats">
      <Stat icon="grid" label={L('রুম', 'Rooms')} value={n(ctx.rooms.length)} sub={L(`অফিস ${n(split.office)} · আবাসিক ${n(split.living)} · অন্য ${n(split.other)}`, `office ${split.office} · living ${split.living} · other ${split.other}`)} />
      <Stat icon="table" label={L('ডেস্ক', 'Desks')} value={n(ctx.desks.length)} sub={L(`${n(ctx.desks.filter(d => !d.responsible_id).length)}টা দায়িত্বহীন`, `${ctx.desks.filter(d => !d.responsible_id).length} unassigned`)} />
      <Stat icon="box" label={L('রিসোর্স', 'Resources')} value={n(ctx.assets.reduce((s, a) => s + a.quantity, 0))} />
      <Stat icon="alert" tone={bad.length ? 'warn' : 'ok'} label={L('মেরামত / নষ্ট / হারানো', 'Repair / broken / lost')} value={n(bad.length)} />
    </div>
    <section className="panel">
      <div className="da-bar"><h2>{L('অফিসের নকশা (দিক অনুযায়ী)', 'Layout by direction')}</h2>
        {floors.length > 1 && <span className="da-seg">{floors.map(f => <button key={f} className={f === fl ? 'sm' : 'secondary sm'} onClick={() => setFloor(f)}>{L(`${n(f)} তলা`, `Floor ${f}`)}</button>)}</span>}</div>
      {!ctx.rooms.length ? <p className="muted">{L('রুম যোগ করলে এখানে দিক অনুযায়ী নকশা দেখাবে।', 'Add rooms to see the layout here.')} <Link to="/app/office/rooms">{L('রুম যোগ করুন →', 'Add rooms →')}</Link></p> : <>
        <p className="ofm-help"><Icon name="map" size={15} /><span>{L('উপরের দিক উত্তর ধরে আঁকা — যেমন ম্যাপে থাকে। প্রতিটা খোপ বাড়ির একটা দিক; রুমে চাপলে নিচে তার বিস্তারিত দেখাবে।', 'Drawn with north at the top, like a map. Each box is one side of the building; tap a room to see its details below.')}
          {ctx.p.front_direction ? <> {L(`সবুজ দাগের খোপটা সামনের দিক (${DIR[ctx.p.front_direction]?.[0] ?? ''}) — ঢোকার দরজা।`, `The green box is the front (${DIR[ctx.p.front_direction]?.[1] ?? ''}) — the entrance.`)}</> : null}</span></p>
        <div className="ofm">
          <span className="ofm-c n">{L('উত্তর', 'N')}</span><span className="ofm-c s">{L('দক্ষিণ', 'S')}</span>
          <span className="ofm-c w">{L('পশ্চিম', 'W')}</span><span className="ofm-c e">{L('পূর্ব', 'E')}</span>
          <div className="ofm-grid">{DIR_GRID.map(d => { const rs = inFloor.filter(r => r.direction === d); const front = ctx.p.front_direction === d
            return <div key={d} className={`ofm-cell${rs.length ? '' : ' empty'}${front ? ' front' : ''}`}>
              <span className="ofm-dir">{L(DIR[d][0], DIR[d][1])}</span>
              {rs.map(r => { const broken = ctx.assets.some(a => a.room_id === r.id && a.condition !== 'good')
                return <a key={r.id} href={`#room-${r.id}`} className={`ofm-room k-${r.kind}`} title={L(ROOM_KIND[r.kind]?.[0] ?? '', ROOM_KIND[r.kind]?.[1] ?? '')}>
                  <Icon name={ROOM_KIND[r.kind]?.[2] ?? 'form'} size={14} /><span>{r.name}</span>{broken && <i className="ofm-dot" aria-label={L('নষ্ট জিনিস আছে', 'Has broken items')} />}</a> })}
              {front && <span className="ofm-door">{L('সামনে · দরজা', 'Front · door')}</span>}
            </div> })}</div>
        </div>
        <div className="ofm-legend">{[...new Set(inFloor.map(r => r.kind))].map(k => <span key={k} className={`k-${k}`}><i />{L(ROOM_KIND[k]?.[0] ?? k, ROOM_KIND[k]?.[1] ?? k)}</span>)}
          {inFloor.some(r => ctx.assets.some(a => a.room_id === r.id && a.condition !== 'good')) && <span className="bad"><i />{L('নষ্ট / মেরামত দরকার', 'Broken / needs repair')}</span>}</div>

        <div className="ofm-cards">{DIR_GRID.flatMap(d => inFloor.filter(r => r.direction === d)).map(r => { const items = itemsOf(r.id); const desks = desksOf(r.id)
          return <article key={r.id} id={`room-${r.id}`} className={`ofm-card k-${r.kind}`}>
            <header><span className="ofm-ic"><Icon name={ROOM_KIND[r.kind]?.[2] ?? 'form'} size={18} /></span>
              <span className="tx"><b>{r.name}</b><small>{L(ROOM_KIND[r.kind]?.[0] ?? '', ROOM_KIND[r.kind]?.[1] ?? '')} · {L(DIR[r.direction]?.[0] ?? '', DIR[r.direction]?.[1] ?? '')}</small></span></header>
            <div className="ofm-who"><Icon name="user" size={13} />{r.responsible_id ? ctx.emp[r.responsible_id]?.full_name ?? '—' : <span className="muted">{L('দায়িত্বে কেউ নেই', 'Nobody responsible')}</span>}</div>
            {items.length > 0 && <div className="ofm-items">{items.map(a => <span key={a.id} className={a.condition !== 'good' ? 'bad' : ''}>{ASSET_KIND[a.kind]?.[0] ?? a.name}{a.quantity > 1 ? ` ×${n(a.quantity)}` : ''}</span>)}</div>}
            {desks.length > 0 && <ul className="ofm-desks">{desks.map(dk => <li key={dk.id}><Icon name="table" size={13} /><b>{dk.name}</b>
              <span>{dk.responsible_id ? ctx.emp[dk.responsible_id]?.full_name : <span className="bad">{L('কেউ নেই', 'nobody')}</span>}</span>
              <small className="muted">{n(ctx.assets.filter(a => a.desk_id === dk.id).length)} {L('জিনিস', 'items')}</small></li>)}</ul>}
            {!items.length && !desks.length && <small className="muted">{L('এই রুমে কোনো জিনিস লেখা নেই', 'Nothing listed in this room')}</small>}
          </article> })}</div>
        {ctx.desks.some(d => !d.room_id) && <p className="muted small">{L('রুম ছাড়া ডেস্ক', 'Desks without a room')}: {ctx.desks.filter(d => !d.room_id).map(d => d.name).join(', ')}</p>}
      </>}
    </section>
    <section className="panel">
      <h2>{L('যা চোখে পড়ার মতো', 'Worth a look')} <span className="count-pill">{n(checks.length)}</span></h2>
      <p className="muted small">{L('ডাটা দেখে নিজে থেকে বের করা — কোথায় দায়িত্ব নেই, কী জিনিস লেখা বাকি, কী নষ্ট।', 'Worked out from the data: missing owners, missing items, broken things.')}</p>
      {checks.length ? <ul className="duty-list">{checks.map(([t, tone], i) => <li key={i} className="duty"><Badge tone={tone}>{tone === 'bad' ? '!' : tone === 'warn' ? '•' : 'i'}</Badge> <span>{t}</span></li>)}</ul>
        : <p className="muted">{L('সব ঠিক আছে।', 'All good.')}</p>}
    </section>
  </>
}

// ---------------------------------------------------------------- places (offices & residences)
function Places({ list, reload }: { list: Property[]; reload: () => Promise<void> }) {
  const { can } = useAuth()
  const { L } = usePrefs()
  const o = useOrg()
  const { toast, node } = useToast()
  type F = Partial<Property> & { id?: string }
  const [f, setF] = useState<F | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function save() {
    if (!f) return
    if (!f.name?.trim() || !f.zone_id) return setErr(L('নাম ও এরিয়া দিন', 'Give name and area'))
    setBusy(true); setErr('')
    try {
      await office.saveProperty({ code: autoCode(f.name, f.code), name: f.name.trim(), kind: f.kind ?? 'office', zone_id: f.zone_id, hub_id: f.hub_id || null,
        address: f.address || null, floor_note: f.floor_note || null, owner_name: f.owner_name || null, owner_phone: f.owner_phone || null,
        rent: f.rent ? Number(f.rent) : null, front_direction: f.front_direction || null, note: f.note || null,
        advance: f.advance ? Number(f.advance) : null, capacity: f.capacity ? Number(f.capacity) : null }, f.id)
      setF(null); await reload(); toast(L('সেভ হয়েছে', 'Saved'))
    } catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  async function fromHubs() {
    setBusy(true); setErr('')
    try { const n = await office.createHubOffices(null); await reload(); toast(n ? L(`${n.toLocaleString('bn-BD')}টি হাবের অফিস তৈরি হয়েছে (ঠিকানাসহ)`, `${n} hub offices created`) : L('সব হাবের অফিস আগেই আছে', 'Every hub already has an office')) }
    catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  async function remove(x: Property) {
    const r = ask(L(`"${x.name}" সরানোর কারণ`, `Why remove "${x.name}"?`)); if (!r) return
    try { await office.archiveProperty(x.id, r); await reload() } catch (e) { setErr(hrFriendly(e)) }
  }
  return <section className="panel">{node}
    <div className="da-bar"><h2>{L('অফিস ও আবাসিক', 'Offices & residences')}</h2>
      <span className="row-acts">
        {can('office.property.create') && <button className="secondary" disabled={busy} onClick={() => void fromHubs()}><Icon name="hub" size={15} />{L('হাব থেকে অফিস তৈরি', 'Offices from hubs')}</button>}
        {can('office.property.create') && <button onClick={() => { setErr(''); setF({ kind: 'office', code: '', name: '', zone_id: o.data?.zones[0]?.id }) }}><Icon name="plus" size={15} />{L('নতুন যোগ', 'Add')}</button>}</span></div>
    <p className="muted small">{L('হাবের ঠিকানা এখানে রাখা হয়: হাবের অফিসের ঠিকানা বদলালে হাবের ঠিকানাও বদলে যায়।', 'Hub addresses live here: changing a hub office address changes the hub address too.')}</p>
    {err && !f && <p className="da-error">{err}</p>}
    <DataTable<Property> title={L('অফিস ও আবাসিক', 'Offices & residences')} file="office-places" rows={list} rowKey={r => r.id}
      empty={<p className="muted">{L('এখনো কিছু যোগ হয়নি।', 'Nothing yet.')}</p>}
      cols={[
        { key: 'kind', label: L('ধরন', 'Kind'), value: r => L(PLACE_KIND[r.kind][0], PLACE_KIND[r.kind][1]),
          render: r => <Badge tone={r.kind === 'office' ? 'info' : 'neutral'}>{PLACE_KIND[r.kind][2]} {L(PLACE_KIND[r.kind][0], PLACE_KIND[r.kind][1])}</Badge> },
        { key: 'name', label: L('নাম', 'Name'), value: r => r.name },
        { key: 'hub', label: L('হাব', 'Hub'), value: r => r.hub_id ? o.names.hub[r.hub_id] ?? '' : '' },
        { key: 'addr', label: L('ঠিকানা', 'Address'), value: r => r.address ?? '' },
        { key: 'owner', label: L('মালিক', 'Owner'), value: r => [r.owner_name, r.owner_phone].filter(Boolean).join(' · ') },
        { key: 'rent', label: L('ভাড়া', 'Rent'), className: 'r', value: r => r.rent ?? '' },
        { key: 'act', label: '', noExport: true, render: r => <span className="row-acts">
          {can('office.property.edit') && <button className="secondary sm" onClick={() => { setErr(''); setF({ ...r }) }}><Icon name="edit" size={14} /></button>}
          {can('office.property.archive') && <button className="secondary sm" onClick={() => void remove(r)}><Icon name="trash" size={14} /></button>}</span> },
      ]} />
    {f && <Modal wide title={f.id ? L('এডিট', 'Edit') : L('নতুন অফিস / আবাসিক ফ্ল্যাট / গ্যারেজ', 'New office / residence / garage')} onClose={() => setF(null)}
      actions={<><button className="secondary" onClick={() => setF(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ', 'Save')}</button></>}>
      <div className="hr-form">
        <Field label={L('ধরন', 'Kind')} hint={f.kind !== 'office' ? L('হাব বেছে দিলে এটা ওই হাবের সাথে যুক্ত থাকবে', 'Pick the hub to attach it to') : undefined}><select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as PlaceKind })}>
          {(Object.keys(PLACE_KIND) as PlaceKind[]).map(k => <option key={k} value={k}>{PLACE_KIND[k][2]} {L(PLACE_KIND[k][0], PLACE_KIND[k][1])}</option>)}</select></Field>
        <Field label={L('নাম', 'Name')}><input value={f.name ?? ''} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={L('এরিয়া', 'Area')}><select value={f.zone_id ?? ''} onChange={e => setF({ ...f, zone_id: e.target.value, hub_id: null })}>
          {o.data?.zones.filter(z => !z.archived_at).map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>
        <Field label={L('হাব (ইচ্ছা হলে)', 'Hub (optional)')}><select value={f.hub_id ?? ''} onChange={e => { const h = o.data?.hubs.find(x => x.id === e.target.value); setF({ ...f, hub_id: e.target.value || null, name: f.name || h?.name || '', address: f.address || h?.address || '' }) }}><option value="">—</option>
          {o.data?.hubs.filter(h => !h.archived_at && h.zone_id === f.zone_id).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
        <Field label={L('বাড়ির সামনের দিক', 'Front faces')}><select value={f.front_direction ?? ''} onChange={e => setF({ ...f, front_direction: e.target.value || null })}><option value="">—</option>
          {Object.entries(DIR).filter(([k]) => k !== 'c').map(([k, v]) => <option key={k} value={k}>{L(v[0], v[1])}</option>)}</select></Field>
        <Field label={L('ঠিকানা', 'Address')} wide><input value={f.address ?? ''} onChange={e => setF({ ...f, address: e.target.value })} /></Field>
        <Field label={L('তলা / ফ্ল্যাট', 'Floor / flat')}><input value={f.floor_note ?? ''} onChange={e => setF({ ...f, floor_note: e.target.value })} placeholder={L('যেমন ৩য় তলা, ফ্ল্যাট B', 'e.g. 3rd floor, flat B')} /></Field>
        <Field label={L('বাড়ির মালিক', 'Owner')}><input value={f.owner_name ?? ''} onChange={e => setF({ ...f, owner_name: e.target.value })} /></Field>
        <Field label={L('মালিকের ফোন', 'Owner phone')}><input inputMode="tel" value={f.owner_phone ?? ''} onChange={e => setF({ ...f, owner_phone: e.target.value })} /></Field>
        <Field label={L('মাসিক ভাড়া (৳)', 'Monthly rent (৳)')}><input inputMode="decimal" value={f.rent ?? ''} onChange={e => setF({ ...f, rent: e.target.value as unknown as number })} /></Field>
        <Field label={L('এডভান্স (৳)', 'Advance (৳)')}><input inputMode="decimal" value={f.advance ?? ''} onChange={e => setF({ ...f, advance: e.target.value as unknown as number })} /></Field>
        <Field label={f.kind === 'residence' ? L('কয়জন থাকতে পারেন', 'Sleeps how many') : f.kind === 'office' ? L('কয়জন বসতে পারেন', 'Seats how many') : L('কয়টা গাড়ি ধরে', 'Holds how many vehicles')}>
          <input inputMode="numeric" value={f.capacity ?? ''} onChange={e => setF({ ...f, capacity: e.target.value as unknown as number })} /></Field>
        <Field label={L('নোট', 'Note')} wide><input value={f.note ?? ''} onChange={e => setF({ ...f, note: e.target.value })} placeholder={f.kind === 'auto_garage' ? L('যেমন: কয়টা চার্জিং পয়েন্ট, মাসিক চার্জ', 'e.g. charging points, monthly charge') : ''} /></Field>
      </div>
      <p className="muted small">{L('চুক্তির মেয়াদ, চুক্তির ছবি ও মাসের ভাড়া — "ভাড়া ও চুক্তি" ট্যাবে।', 'Contract dates, its photo and the month’s rent — under "Rent & contract".')}</p>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </section>
}

// ---------------------------------------------------------------- rooms
function Rooms({ ctx }: { ctx: Ctx }) {
  const { can } = useAuth()
  const { L, n } = usePrefs()
  const { toast, node } = useToast()
  type F = { id?: string; name: string; kind: string; direction: string; floor: string; resp: EmpLite | null; note: string; defaults: boolean }
  const [f, setF] = useState<F | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const edit = can('office.property.edit') || can('office.property.create')
  async function save() {
    if (!f) return
    if (!f.name.trim()) return setErr(L('রুমের নাম দিন', 'Give the room name'))
    setBusy(true); setErr('')
    try {
      const id = await office.saveRoom({ property_id: ctx.p.id, name: f.name.trim(), kind: f.kind, direction: f.direction, floor: Number(f.floor) || 1,
        responsible_id: f.resp?.id ?? null, note: f.note.trim() || null }, f.id)
      if (!f.id && f.defaults && can('office.asset.edit')) await office.addDefaults(ctx.p.id, ROOM_DEFAULT[f.kind] ?? [], { room_id: id })
      setF(null); await ctx.reload(); toast(L('সেভ হয়েছে', 'Saved'))
    } catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  async function remove(r: Room) {
    const why = ask(L(`"${r.name}" সরানোর কারণ`, `Why remove "${r.name}"?`)); if (!why) return
    try { await office.archiveRoom(r.id, why); await ctx.reload() } catch (e) { setErr(hrFriendly(e)) }
  }
  return <section className="panel">{node}
    <div className="da-bar"><h2>{L('ফ্ল্যাটের বিবরণ', 'Flat details')} <span className="count-pill">{n(ctx.rooms.length)}</span></h2>
      {edit && <button onClick={() => { setErr(''); setF({ name: '', kind: 'room', direction: 'c', floor: '1', resp: null, note: '', defaults: true }) }}><Icon name="plus" size={15} />{L('রুম যোগ', 'Add room')}</button>}</div>
    {err && !f && <p className="da-error">{err}</p>}
    {!ctx.rooms.length ? <p className="muted">{L('গ্যারেজ, রুম, রান্নাঘর, বাথরুম, অফিস রুম — কোনটা কোন দিকে, যোগ করুন।', 'Add garage, rooms, kitchen, bathroom, office room — and which side each is on.')}</p> :
      <div className="route-cards">{ctx.rooms.map(r => { const items = ctx.assets.filter(a => a.room_id === r.id)
        return <article key={r.id} className="route-card">
          <header><span className="ti"><Icon name={ROOM_KIND[r.kind]?.[2] ?? 'form'} size={18} /></span><div style={{ flex: 1, minWidth: 0 }}><b>{r.name}</b>
            <div className="muted small">{L(ROOM_KIND[r.kind]?.[0] ?? r.kind, ROOM_KIND[r.kind]?.[1] ?? r.kind)} · {L(DIR[r.direction][0], DIR[r.direction][1])} · {L(`${n(r.floor)} তলা`, `floor ${r.floor}`)}
              {r.responsible_id && ` · ${ctx.emp[r.responsible_id]?.full_name ?? ''}`}</div></div>
            {edit && <span className="row-acts">
              <button className="secondary sm" onClick={() => { setErr(''); setF({ id: r.id, name: r.name, kind: r.kind, direction: r.direction, floor: String(r.floor), resp: r.responsible_id ? ctx.emp[r.responsible_id] ?? null : null, note: r.note ?? '', defaults: false }) }}><Icon name="edit" size={14} /></button>
              {can('office.property.archive') && <button className="secondary sm" onClick={() => void remove(r)}><Icon name="trash" size={14} /></button>}</span>}</header>
          <div className="chips">{items.length ? items.map(a => <span key={a.id} className={`chip${a.condition !== 'good' ? ' bad' : ''}`}>{ASSET_KIND[a.kind]?.[0] ?? a.name}{a.quantity > 1 ? ` ×${n(a.quantity)}` : ''}</span>)
            : <span className="muted small">{L('কোনো জিনিস লেখা নেই', 'No items listed')}</span>}</div>
          {r.note && <div className="muted small">{r.note}</div>}
        </article> })}</div>}
    {f && <Modal title={f.id ? L('রুম এডিট', 'Edit room') : L('রুম যোগ', 'Add room')} onClose={() => setF(null)}
      actions={<><button className="secondary" onClick={() => setF(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ', 'Save')}</button></>}>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label={L('ধরন', 'Kind')}><select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value, name: f.name || L(ROOM_KIND[e.target.value][0], ROOM_KIND[e.target.value][1]) })}>
          {Object.entries(ROOM_KIND).map(([k, v]) => <option key={k} value={k}>{L(v[0], v[1])}</option>)}</select></Field>
        <Field label={L('নাম', 'Name')}><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder={L('যেমন রুম ১', 'e.g. Room 1')} /></Field>
        <Field label={L('কোন দিকে', 'Which side')}><select value={f.direction} onChange={e => setF({ ...f, direction: e.target.value })}>
          {Object.entries(DIR).map(([k, v]) => <option key={k} value={k}>{L(v[0], v[1])}</option>)}</select></Field>
        <Field label={L('তলা', 'Floor')}><input inputMode="numeric" value={f.floor} onChange={e => setF({ ...f, floor: e.target.value })} /></Field>
        <EmpPicker label={L('দেখাশোনার দায়িত্বে (আইডি)', 'Looked after by (ID)')} value={f.resp} onPick={e => setF({ ...f, resp: e })} />
        <Field label={L('নোট', 'Note')}><input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      {!f.id && (ROOM_DEFAULT[f.kind] ?? []).length > 0 && can('office.asset.edit') && <label className="small" style={{ margin: '10px 0 0' }}>
        <input type="checkbox" style={{ width: 'auto', margin: '0 6px 0 0' }} checked={f.defaults} onChange={e => setF({ ...f, defaults: e.target.checked })} />
        {L('সাধারণ জিনিসগুলো একসাথে যোগ করুন', 'Add the usual items')}: {(ROOM_DEFAULT[f.kind] ?? []).map(k => L(ASSET_KIND[k][0], ASSET_KIND[k][1])).join(', ')}</label>}
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </section>
}

// ---------------------------------------------------------------- desks
function Desks({ ctx }: { ctx: Ctx }) {
  const { can } = useAuth()
  const { L, n } = usePrefs()
  const { toast, node } = useToast()
  type F = { id?: string; code: string; name: string; room: string; resp: EmpLite | null; duty: string; note: string; defaults: boolean }
  const [f, setF] = useState<F | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const edit = can('office.property.edit') || can('office.property.create')
  const roomName = Object.fromEntries(ctx.rooms.map(r => [r.id, r.name])) as Record<string, string>
  async function save() {
    if (!f) return
    if (!f.name.trim()) return setErr(L('ডেস্কের নাম দিন', 'Give the desk name'))
    setBusy(true); setErr('')
    try {
      const id = await office.saveDesk({ property_id: ctx.p.id, code: f.code.trim() || autoCode(f.name), name: f.name.trim(), room_id: f.room || null,
        responsible_id: f.resp?.id ?? null, duty: f.duty.trim() || null, note: f.note.trim() || null }, f.id)
      if (!f.id && f.defaults && can('office.asset.edit')) await office.addDefaults(ctx.p.id, DESK_DEFAULT, { desk_id: id, room_id: f.room || null, holder_id: f.resp?.id ?? null })
      setF(null); await ctx.reload(); toast(L('সেভ হয়েছে', 'Saved'))
    } catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  async function remove(d: Desk) {
    const why = ask(L(`"${d.name}" সরানোর কারণ`, `Why remove "${d.name}"?`)); if (!why) return
    try { await office.archiveDesk(d.id, why); await ctx.reload() } catch (e) { setErr(hrFriendly(e)) }
  }
  const next = ctx.desks.length + 1
  return <section className="panel">{node}
    <div className="da-bar"><h2>{L('ডেস্ক ও দায়িত্ব', 'Desks & responsibility')} <span className="count-pill">{n(ctx.desks.length)}</span></h2>
      {edit && <button onClick={() => { setErr(''); setF({ code: '', name: L(`ডেস্ক ${n(next)}`, `Desk ${next}`), room: ctx.rooms.find(r => r.kind === 'office_room')?.id ?? '', resp: null, duty: '', note: '', defaults: true }) }}>
        <Icon name="plus" size={15} />{L('ডেস্ক যোগ', 'Add desk')}</button>}</div>
    {err && !f && <p className="da-error">{err}</p>}
    {!ctx.desks.length ? <p className="muted">{L('ডেস্ক যোগ করলে মনিটর, পিসি, কিবোর্ড, মাউস, জি-প্রিন্টার একসাথে যোগ হবে, আর কে দায়িত্বে তা দেবেন।', 'Adding a desk adds monitor, PC, keyboard, mouse and G-printer, and you name who is responsible.')}</p> :
      <div className="route-cards">{ctx.desks.map(d => { const items = ctx.assets.filter(a => a.desk_id === d.id)
        return <article key={d.id} className="route-card">
          <header><span className="ti"><Icon name="table" size={18} /></span><div style={{ flex: 1, minWidth: 0 }}><b>{d.name}</b>
            <div className="muted small">{d.room_id ? roomName[d.room_id] : L('রুম দেওয়া হয়নি', 'No room')}</div></div>
            {edit && <span className="row-acts">
              <button className="secondary sm" onClick={() => { setErr(''); setF({ id: d.id, code: d.code, name: d.name, room: d.room_id ?? '', resp: d.responsible_id ? ctx.emp[d.responsible_id] ?? null : null, duty: d.duty ?? '', note: d.note ?? '', defaults: false }) }}><Icon name="edit" size={14} />{L('এসাইন / এডিট', 'Assign / edit')}</button>
              {can('office.property.archive') && <button className="secondary sm" onClick={() => void remove(d)}><Icon name="trash" size={14} /></button>}</span>}</header>
          <div className="desk-owner">{d.responsible_id ? <><Icon name="user" size={14} /> <b>{empLabel(ctx.emp[d.responsible_id])}</b></> : <span className="bad">{L('দায়িত্বে কেউ নেই', 'Nobody responsible')}</span>}
            {d.duty && <div className="muted small pre-wrap">{d.duty}</div>}</div>
          <div className="chips">{items.length ? items.map(a => <span key={a.id} className={`chip${a.condition !== 'good' ? ' bad' : ''}`}><Icon name={ASSET_KIND[a.kind]?.[2] ?? 'form'} size={12} />{ASSET_KIND[a.kind]?.[0] ?? a.name}</span>)
            : <span className="muted small">{L('কোনো জিনিস নেই', 'No items')}</span>}</div>
        </article> })}</div>}
    {f && <Modal title={f.id ? L('ডেস্ক এসাইন / এডিট', 'Assign / edit desk') : L('ডেস্ক যোগ', 'Add desk')} onClose={() => setF(null)}
      actions={<><button className="secondary" onClick={() => setF(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ', 'Save')}</button></>}>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label={L('নাম', 'Name')}><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={L('কোন রুমে', 'Room')}><select value={f.room} onChange={e => setF({ ...f, room: e.target.value })}><option value="">—</option>
          {ctx.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <EmpPicker label={L('দায়িত্বে (এমপ্লয়ি আইডি)', 'Responsible (employee ID)')} value={f.resp} onPick={e => setF({ ...f, resp: e })} />
        <Field label={L('দায়িত্ব / কাজ', 'Duty')} wide><textarea rows={3} value={f.duty} onChange={e => setF({ ...f, duty: e.target.value })} placeholder={L('যেমন: ডাটা এন্ট্রি, প্রিন্ট, হিসাব', 'e.g. data entry, printing, accounts')} /></Field>
      </div>
      {!f.id && can('office.asset.edit') && <label className="small" style={{ margin: '10px 0 0' }}>
        <input type="checkbox" style={{ width: 'auto', margin: '0 6px 0 0' }} checked={f.defaults} onChange={e => setF({ ...f, defaults: e.target.checked })} />
        {L('মনিটর, পিসি, কিবোর্ড, মাউস, জি-প্রিন্টার একসাথে যোগ করুন', 'Add monitor, PC, keyboard, mouse, G-printer')}</label>}
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </section>
}

// ---------------------------------------------------------------- assets
function Assets({ ctx }: { ctx: Ctx }) {
  const { can } = useAuth()
  const { L, n } = usePrefs()
  const { toast, node } = useToast()
  const [cond, setCond] = useState('')
  type F = { id?: string; kind: string; name: string; room: string; desk: string; qty: string; condition: Asset['condition']; brand: string; serial: string
    holder: EmpLite | null; date: string; price: string; note: string; watt: string; hours: string; spec: string }
  const [f, setF] = useState<F | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const [rep, setRep] = useState<{ a: Asset | null; kind: 'broken' | 'need' } | null>(null)
  const [lend, setLend] = useState<Asset | null>(null)
  const loans = useLoans(ctx.p.id)
  const mineOut = loans.list.filter(l => l.from_property_id === ctx.p.id); const mineIn = loans.list.filter(l => l.to_property_id === ctx.p.id)
  const canRep = can('office.notice.create')
  const roomName = Object.fromEntries(ctx.rooms.map(r => [r.id, r.name])) as Record<string, string>
  const deskName = Object.fromEntries(ctx.desks.map(d => [d.id, d.name])) as Record<string, string>
  const rows = ctx.assets.filter(a => !cond || a.condition === cond)
  const edit = can('office.asset.edit')
  async function save() {
    if (!f) return
    if (!f.name.trim()) return setErr(L('নাম দিন', 'Give a name'))
    setBusy(true); setErr('')
    try {
      const desk = ctx.desks.find(d => d.id === f.desk)
      await office.saveAsset({ property_id: ctx.p.id, kind: f.kind, name: f.name.trim(), room_id: f.room || desk?.room_id || null, desk_id: f.desk || null,
        quantity: Math.max(1, Number(f.qty) || 1), condition: f.condition, brand: f.brand.trim() || null, serial_no: f.serial.trim() || null,
        holder_id: f.holder?.id ?? null, purchase_date: f.date || null, price: f.price ? Number(f.price) : null, note: f.note.trim() || null,
        watt: f.watt ? Number(f.watt) : null, hours_per_day: f.hours ? Number(f.hours) : null, spec: f.spec.trim() || null }, f.id)
      setF(null); await ctx.reload(); toast(L('সেভ হয়েছে', 'Saved'))
    } catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  async function remove(a: Asset) {
    const why = ask(L(`"${a.name}" সরানোর কারণ`, `Why remove "${a.name}"?`)); if (!why) return
    try { await office.archiveAsset(a.id, why); await ctx.reload() } catch (e) { setErr(hrFriendly(e)) }
  }
  const byKind = Object.entries(ctx.assets.reduce((m, a) => { m[a.kind] = (m[a.kind] ?? 0) + a.quantity; return m }, {} as Record<string, number>)).sort((a, b) => b[1] - a[1])
  return <>{node}
    <section className="panel">
      <div className="da-bar"><h2>{L('অফিসের রিসোর্স', 'Office resources')} <span className="count-pill">{n(ctx.assets.reduce((s, a) => s + a.quantity, 0))}</span></h2><span className="row-acts">
        <select value={cond} onChange={e => setCond(e.target.value)} aria-label={L('অবস্থা', 'Condition')}><option value="">{L('সব অবস্থা', 'All')}</option>
          {Object.entries(CONDITION).map(([k, v]) => <option key={k} value={k}>{L(v[0], v[1])}</option>)}</select>
        {edit && <button onClick={() => { setErr(''); setF({ kind: 'monitor', name: ASSET_KIND.monitor[0], room: '', desk: '', qty: '1', condition: 'good', brand: '', serial: '', holder: null, date: '', price: '', note: '', watt: '', hours: '', spec: '' }) }}>
          <Icon name="plus" size={15} />{L('জিনিস যোগ', 'Add item')}</button>}
        {canRep && <button className="secondary" onClick={() => setRep({ a: null, kind: 'need' })}><Icon name="bell" size={15} />{L('কিছু লাগবে', 'Need something')}</button>}</span></div>
      <p className="muted small">{L('প্রতিটা জিনিসের পাশে "নষ্ট" চাপলে জোনাল ম্যানেজারের কাছে রিপোর্ট যায়; "লাগবে" দিয়ে আরও চাওয়া যায়। তালিকায় যা নেই তা "অন্যান্য" ধরনে নিজের নাম দিয়ে যোগ করুন।', 'Tap "Broken" beside an item to report it to the zonal manager; "Needed" asks for more. Anything not in the list goes under "Other" with its own name.')}</p>
      <div className="team-cards">{byKind.map(([k, c]) => <div key={k} className="team-card static"><span className="ti"><Icon name={ASSET_KIND[k]?.[2] ?? 'form'} size={20} /></span>
        <span className="tn">{L(ASSET_KIND[k]?.[0] ?? k, ASSET_KIND[k]?.[1] ?? k)}</span><span className="tc">{n(c)}</span></div>)}</div>
      {mineOut.length > 0 && <p className="small">{L('অন্য হাব ব্যবহার করছে (গোনা এই অফিসের নামেই)', 'Used by other hubs (still counted here)')}: {mineOut.map(l => `${l.asset_name} ${n(l.quantity)} → ${l.to_name}`).join(' · ')}</p>}
      {mineIn.length > 0 && <p className="small">{L('অন্যের জিনিস এখানে ব্যবহার হচ্ছে', 'Borrowed from others')}: {mineIn.map(l => `${l.asset_name} ${n(l.quantity)} (${l.from_name})`).join(' · ')}</p>}
    </section>
    <section className="panel">
      {err && !f && <p className="da-error">{err}</p>}
      <DataTable<Asset> title={`${L('রিসোর্স', 'Resources')} — ${ctx.p.name}`} file={`office-assets-${ctx.p.code}`} rows={rows} rowKey={r => r.id}
        empty={<p className="muted">{L('কিছু নেই।', 'Nothing here.')}</p>}
        cols={[
          { key: 'kind', label: L('ধরন', 'Kind'), value: r => L(ASSET_KIND[r.kind]?.[0] ?? r.kind, ASSET_KIND[r.kind]?.[1] ?? r.kind) },
          { key: 'name', label: L('নাম', 'Name'), value: r => r.name, render: r => <><strong>{r.name}</strong>{(r.brand || r.serial_no || r.spec || r.watt) && <span className="sec">{[r.spec, r.brand, r.serial_no, r.watt ? `${n(r.watt)}W` : null].filter(Boolean).join(' · ')}</span>}
            {loans.out[r.id] ? <span className="sec">{mineOut.filter(l => l.asset_id === r.id).map(l => L(`${l.to_name} ${n(l.quantity)}টি ব্যবহার করছে`, `${l.to_name} uses ${l.quantity}`)).join(', ')}</span> : null}</> },
          { key: 'where', label: L('কোথায়', 'Where'), value: r => [r.desk_id && deskName[r.desk_id], r.room_id && roomName[r.room_id]].filter(Boolean).join(' · ') },
          { key: 'qty', label: L('সংখ্যা', 'Qty'), className: 'r', value: r => n(r.quantity) },
          { key: 'holder', label: L('কার কাছে', 'Held by'), value: r => empLabel(ctx.emp[r.holder_id ?? '']) },
          { key: 'cond', label: L('অবস্থা', 'Condition'), value: r => L(CONDITION[r.condition][0], CONDITION[r.condition][1]),
            render: r => <Badge tone={CONDITION[r.condition][2]}>{L(CONDITION[r.condition][0], CONDITION[r.condition][1])}</Badge> },
          ...(edit || canRep ? [{ key: 'act', label: '', noExport: true, render: (r: Asset) => <span className="row-acts">
            {canRep && r.condition !== 'broken' && <button className="secondary sm oo-bad" onClick={() => setRep({ a: r, kind: 'broken' })}>{L('নষ্ট', 'Broken')}</button>}
            {canRep && <button className="secondary sm" onClick={() => setRep({ a: r, kind: 'need' })}>{L('লাগবে', 'Needed')}</button>}
            {edit && <button className="secondary sm" title={L('অন্য অফিসে দিন', 'Lend to another office')} onClick={() => setLend(r)}><Icon name="hub" size={14} /></button>}
            {edit && <button className="secondary sm" onClick={() => { setErr(''); setF({ id: r.id, kind: r.kind, name: r.name, room: r.room_id ?? '', desk: r.desk_id ?? '', qty: String(r.quantity), condition: r.condition,
              brand: r.brand ?? '', serial: r.serial_no ?? '', holder: r.holder_id ? ctx.emp[r.holder_id] ?? null : null, date: r.purchase_date ?? '', price: r.price?.toString() ?? '', note: r.note ?? '',
              watt: r.watt?.toString() ?? '', hours: r.hours_per_day?.toString() ?? '', spec: r.spec ?? '' }) }}><Icon name="edit" size={14} /></button>}
            {edit && <button className="secondary sm" onClick={() => void remove(r)}><Icon name="trash" size={14} /></button>}</span> }] : []),
        ]} />
    </section>
    {f && <Modal wide title={f.id ? L('জিনিস এডিট', 'Edit item') : L('জিনিস যোগ', 'Add item')} onClose={() => setF(null)}
      actions={<><button className="secondary" onClick={() => setF(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ', 'Save')}</button></>}>
      <div className="hr-form">
        <Field label={L('ধরন', 'Kind')}><select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value, name: f.id ? f.name : L(ASSET_KIND[e.target.value][0], ASSET_KIND[e.target.value][1]) })}>
          {Object.entries(ASSET_KIND).map(([k, v]) => <option key={k} value={k}>{L(v[0], v[1])}</option>)}</select></Field>
        <Field label={L('নাম', 'Name')}><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={L('সংখ্যা', 'Quantity')}><input inputMode="numeric" value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} /></Field>
        <Field label={L('রুম', 'Room')}><select value={f.room} onChange={e => setF({ ...f, room: e.target.value })}><option value="">—</option>
          {ctx.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <Field label={L('ডেস্ক', 'Desk')}><select value={f.desk} onChange={e => setF({ ...f, desk: e.target.value })}><option value="">—</option>
          {ctx.desks.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        <Field label={L('অবস্থা', 'Condition')}><select value={f.condition} onChange={e => setF({ ...f, condition: e.target.value as Asset['condition'] })}>
          {Object.entries(CONDITION).map(([k, v]) => <option key={k} value={k}>{L(v[0], v[1])}</option>)}</select></Field>
        <Field label={L('ব্র্যান্ড', 'Brand')}><input value={f.brand} onChange={e => setF({ ...f, brand: e.target.value })} /></Field>
        <Field label={L('সিরিয়াল / ট্যাগ নম্বর', 'Serial / tag no.')}><input value={f.serial} onChange={e => setF({ ...f, serial: e.target.value })} /></Field>
        <EmpPicker label={L('কার কাছে (আইডি)', 'Held by (ID)')} value={f.holder} onPick={e => setF({ ...f, holder: e })} />
        <Field label={L('কেনার তারিখ', 'Bought on')}><input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <Field label={L('দাম (৳)', 'Price (৳)')}><input inputMode="decimal" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} /></Field>
        <Field label={L('মাপ / ধরন', 'Size / type')} hint={L('যেমন টেবিল ৪×২ ফুট, DVR ৮ পোর্ট', 'e.g. table 4×2 ft, DVR 8 ports')}><input value={f.spec} onChange={e => setF({ ...f, spec: e.target.value })} /></Field>
        <Field label={L('ওয়াট (W)', 'Watt (W)')} hint={POWER[f.kind] ? L(`না লিখলে ${n(POWER[f.kind][0])}W ধরা হবে`, `${POWER[f.kind][0]}W assumed if blank`) : L('বিদ্যুতে চললে লিখুন', 'if it runs on electricity')}><input inputMode="numeric" value={f.watt} onChange={e => setF({ ...f, watt: e.target.value })} /></Field>
        <Field label={L('দিনে কত ঘণ্টা চলে', 'Hours a day')}><input inputMode="decimal" value={f.hours} onChange={e => setF({ ...f, hours: e.target.value })} placeholder={POWER[f.kind] ? String(POWER[f.kind][1]) : ''} /></Field>
        <Field label={L('নোট', 'Note')}><input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
    {rep && <NoticeModal property={ctx.p} asset={rep.a} kind={rep.kind} onClose={() => setRep(null)} onDone={(no, c) => { setRep(null); void ctx.reload()
      toast(c ? L(`${no} — জোনাল ম্যানেজারকে জানানো হয়েছে`, `${no} — the zonal manager was told`) : L(`${no} জমা হয়েছে`, `${no} saved`)) }} />}
    {lend && <LendModal ctx={ctx} asset={lend} lentOut={loans.out[lend.id] ?? 0} onClose={() => setLend(null)} onDone={() => { setLend(null); void loans.reload(); toast(L('দেওয়া হয়েছে — গোনা এই অফিসের নামেই থাকবে', 'Lent — still counted here')) }} />}
  </>
}
