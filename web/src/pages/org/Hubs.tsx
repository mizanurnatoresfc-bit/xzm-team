import { useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { OsmMap, gmapLink, gps, num, type MapPin } from '../../components/OsmMap'
import { autoCode, hrFriendly, org, type Hub, type Zone } from '../../lib/hr'
import { HUB_TYPES, hubDir, type ImportRow, type Region } from '../../lib/hubdir'
import { ArchiveModal } from './OrgSetup'

const UN = 'Unassigned'
const isNum = (c: string | null | undefined) => !!c && /^\d+$/.test(String(c).trim())
const codeOf = (h: { code: string }) => (isNum(h.code) ? `#${h.code}` : '—')
const errText = (e: unknown) => (e instanceof Error && !('code' in e) ? e.message : hrFriendly(e))
type EditRow = Partial<Hub> & { lat?: string; lng?: string }

export function Hubs() {
  const { can } = useAuth()
  const { toast, node } = useToast()
  const data = useLoad(async () => {
    const [orgs, regions, zones, hubs, imports, staff] = await Promise.all([
      org.organizations(), hubDir.regions().catch(() => [] as Region[]), org.zones(), org.hubs(true),
      hubDir.importRows().catch(() => [] as ImportRow[]), hubDir.staffCounts().catch(() => ({} as Record<string, number>))])
    return { orgs, regions, zones, hubs, imports, staff }
  }, [])
  const d = data.data
  const [region, setRegion] = useState('')
  const [area, setArea] = useState('')
  const [st, setSt] = useState<'all' | 'active' | 'inactive'>('all')
  const [q, setQ] = useState('')
  const [showArch, setShowArch] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [detail, setDetail] = useState<Hub | null>(null)
  const [edit, setEdit] = useState<{ row: EditRow; isNew: boolean; orig?: Hub } | null>(null)
  const [loc, setLoc] = useState<{ hub: Hub; lat: string; lng: string; wifi: string } | null>(null)
  const [stat, setStat] = useState<Hub | null>(null)
  const [arch, setArch] = useState<Hub | null>(null)
  const [unit, setUnit] = useState<{ kind: 'region' | 'area'; row: Partial<Region & Zone>; isNew: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const zoneById = useMemo(() => Object.fromEntries((d?.zones ?? []).map(z => [z.id, z])), [d])
  const regionById = useMemo(() => Object.fromEntries((d?.regions ?? []).map(r => [r.id, r])), [d])
  const live = useMemo(() => (d?.hubs ?? []).filter(h => !h.archived_at), [d])
  const pending = useMemo(() => (d?.imports ?? []).filter(r => !r.applied_at), [d])
  const rows = useMemo(() => (d?.hubs ?? []).filter(h => {
    if (!showArch && h.archived_at) return false
    const z = zoneById[h.zone_id]
    if (area && h.zone_id !== area) return false
    if (region && z?.region_id !== region) return false
    if (st !== 'all' && h.status !== st) return false
    const s = q.trim().toLowerCase()
    if (s && !`${h.name} ${h.name_bn ?? ''} ${h.code} ${h.phone ?? ''} ${h.address ?? ''}`.toLowerCase().includes(s)) return false
    return true
  }), [d, showArch, area, region, st, q, zoneById])
  const pins: MapPin[] = useMemo(() => [
    ...rows.filter(h => num(h.latitude) !== null && num(h.longitude) !== null).map(h => ({ id: h.id, lat: num(h.latitude)!, lng: num(h.longitude)!,
      label: isNum(h.code) ? `#${h.code}` : h.name, tone: (h.status === 'active' && !h.archived_at ? 'ok' : 'off') as MapPin['tone'] })),
    ...pending.filter(r => (!area || r.zone_id === area) && num(r.latitude) !== null).map(r => ({ id: `imp-${r.id}`, lat: num(r.latitude)!, lng: num(r.longitude)!,
      label: `#${r.code}?`, tone: 'wait' as const })),
  ], [rows, pending, area])
  const stats = {
    total: live.length, active: live.filter(h => h.status === 'active').length, off: live.filter(h => h.status !== 'active').length,
    mapped: live.filter(h => num(h.latitude) !== null).length, wait: pending.length,
  }

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true); setErr('')
    try { await fn(); toast(ok); await data.reload(); return true } catch (e) { setErr(errText(e)); return false } finally { setBusy(false) }
  }
  function openEdit(h?: Hub) {
    setErr('')
    if (h) setEdit({ isNew: false, orig: h, row: { ...h, lat: gps(h.latitude), lng: gps(h.longitude) } })
    else setEdit({ isNew: true, row: { zone_id: area || (d?.zones.length === 1 ? d.zones[0].id : ''), lat: '', lng: '' } })
  }
  async function saveHub() {
    if (!edit) return
    const r = edit.row, o = edit.orig
    const ok = await run(async () => {
      const code = String(r.code ?? '').trim()
      if (!code) throw new Error('হাব কোড নম্বর দিন')
      if (!String(r.name ?? '').trim()) throw new Error('হাবের নাম দিন')
      if (!r.zone_id) throw new Error('এরিয়া বেছে নিন')
      const row: Record<string, unknown> = { code, name: String(r.name).trim(), name_bn: r.name_bn?.trim() || null, zone_id: r.zone_id,
        phone: r.phone?.trim() || null, address: r.address?.trim() || null, hub_type: r.hub_type || null, ops_zone: r.ops_zone?.trim() || null }
      // GPS is sent only when it was actually changed (never rewritten by accident).
      const la = (r.lat ?? '').trim(), ln = (r.lng ?? '').trim()
      if (!o || la !== gps(o.latitude) || ln !== gps(o.longitude)) {
        if ((la === '') !== (ln === '')) throw new Error('Latitude ও Longitude দুটোই দিন')
        if (la && (num(la) === null || Math.abs(Number(la)) > 90 || num(ln) === null || Math.abs(Number(ln)) > 180)) throw new Error('GPS ঠিক নয়')
        row.latitude = la || null; row.longitude = ln || null
      }
      if (o) await org.update('hubs', o.id, row); else await org.insert('hubs', { ...row, status: 'active' })
    }, edit.isNew ? 'নতুন হাব যোগ হয়েছে' : 'হাবের তথ্য সেভ হয়েছে')
    if (ok) setEdit(null)
  }
  async function saveLoc() {
    if (!loc) return
    const la = loc.lat.trim(), ln = loc.lng.trim()
    const wifi = loc.wifi.trim()
    if (new TextEncoder().encode(wifi).length > 32) { setErr('Wi-Fi নাম ৩২ বাইটের মধ্যে দিন'); return }
    if ((la !== '' || ln !== '') && (num(la) === null || num(ln) === null || Math.abs(Number(la)) > 90 || Math.abs(Number(ln)) > 180)) {
      setErr('GPS ঠিক নয়')
      return
    }
    const changes: Record<string, unknown> = { trip_wifi_ssid: wifi || null }
    if (la !== gps(loc.hub.latitude) || ln !== gps(loc.hub.longitude)) {
      changes.latitude = la || null
      changes.longitude = ln || null
    }
    if (await run(() => org.update('hubs', loc.hub.id, changes), 'লোকেশন ও Wi-Fi সেটিংস সেভ হয়েছে')) setLoc(null)
  }
  function myLocation() {
    if (!navigator.geolocation) { setErr('এই ফোন/ব্রাউজারে লোকেশন পাওয়া যায় না'); return }
    setErr('')
    navigator.geolocation.getCurrentPosition(p => setLoc(l => l && { ...l, lat: p.coords.latitude.toFixed(7), lng: p.coords.longitude.toFixed(7) }),
      () => setErr('লোকেশন পাওয়া যায়নি — ফোনের Location চালু করে অনুমতি দিন'), { enableHighAccuracy: true, timeout: 15000 })
  }
  async function saveUnit() {
    if (!unit) return
    const r = unit.row
    const ok = await run(async () => {
      const name = String(r.name ?? '').trim(); if (!name) throw new Error('নাম দিন')
      const base: Record<string, unknown> = { name, name_bn: r.name_bn?.trim() || null }
      if (unit.kind === 'region') {
        if (unit.isNew) await hubDir.saveRegion({ ...base, code: autoCode(name), organization_id: d?.orgs[0]?.id } as Partial<Region>)
        else await hubDir.saveRegion(base as Partial<Region>, r.id)
      } else {
        base.region_id = r.region_id || null
        if (unit.isNew) await org.insert('zones', { ...base, code: autoCode(name), organization_id: d?.orgs[0]?.id })
        else await org.update('zones', String(r.id), base)
      }
    }, 'সেভ হয়েছে')
    if (ok) setUnit(null)
  }

  const areaLabel = (zid: string) => zoneById[zid]?.name ?? ''
  const regionLabel = (zid: string) => regionById[zoneById[zid]?.region_id ?? '']?.name ?? UN

  return <AppShell title="হাব তালিকা ও ম্যাপ" subtitle="রিজিওন → এরিয়া → হাব। কিছু মোছা হয় না — বন্ধ বা আর্কাইভ করুন।"
    actions={can('org.hub.create') && d?.zones.length ? <button onClick={() => openEdit()}>+ নতুন হাব</button> : null}>
    {node}
    {data.error ? <p className="da-error">{hrFriendly(data.error)}</p> : null}
    {data.loading && !d ? <p className="muted">লোড হচ্ছে…</p> : null}
    {d ? <>
      <div className="da-stats hd-stats">
        <button className={`da-stat${st === 'all' ? ' on' : ''}`} onClick={() => setSt('all')}><span className="ri"><Icon name="hub" /></span><span className="lbl">মোট হাব</span><span className="val">{stats.total}</span></button>
        <button className={`da-stat${st === 'active' ? ' on' : ''}`} onClick={() => setSt('active')}><span className="ri ok"><Icon name="check" /></span><span className="lbl">চালু</span><span className="val">{stats.active}</span></button>
        <button className={`da-stat${st === 'inactive' ? ' on' : ''}`} onClick={() => setSt('inactive')}><span className="ri bad"><Icon name="x" /></span><span className="lbl">বন্ধ</span><span className="val">{stats.off}</span></button>
        <div className="da-stat"><span className="ri"><Icon name="map" /></span><span className="lbl">ম্যাপে আছে</span><span className="val">{stats.mapped}</span></div>
      </div>

      <section className="panel hd-tree">
        <div className="da-bar"><strong>রিজিওন → এরিয়া</strong>
          <div className="row">
            {can('org.region.create') && <button className="secondary sm" onClick={() => { setErr(''); setUnit({ kind: 'region', isNew: true, row: {} }) }}>+ রিজিওন</button>}
            {can('org.zone.create') && <button className="secondary sm" onClick={() => { setErr(''); setUnit({ kind: 'area', isNew: true, row: { region_id: region || d.regions[0]?.id } }) }}>+ এরিয়া</button>}
          </div></div>
        <div className="hd-regions">
          {[...d.regions, ...(d.zones.some(z => !z.region_id) ? [{ id: '', name: 'রিজিওন ঠিক করা হয়নি' } as Region] : [])].map(rg =>
            <div key={rg.id || 'none'} className={`hd-region${region === rg.id && rg.id ? ' on' : ''}`}>
              <div className="hd-rhead">
                <button className="linkish" onClick={() => { setRegion(region === rg.id ? '' : rg.id); setArea('') }}><Icon name="globe" /> {rg.name}</button>
                {rg.id && can('org.region.edit') && <button className="icon-btn" aria-label="রিজিওন এডিট" onClick={() => { setErr(''); setUnit({ kind: 'region', isNew: false, row: { ...rg } }) }}><Icon name="edit" /></button>}
              </div>
              <div className="hd-areas">
                {d.zones.filter(z => (z.region_id ?? '') === rg.id).map(z => <div key={z.id} className={`hd-area${area === z.id ? ' on' : ''}`}>
                  <button className="linkish" onClick={() => setArea(area === z.id ? '' : z.id)}><Icon name="map" /> {z.name}
                    <span className="cnt">{live.filter(h => h.zone_id === z.id).length} হাব</span></button>
                  {can('org.zone.edit') && <button className="icon-btn" aria-label="এরিয়া এডিট" onClick={() => { setErr(''); setUnit({ kind: 'area', isNew: false, row: { ...z } }) }}><Icon name="edit" /></button>}
                </div>)}
              </div>
            </div>)}
        </div>
      </section>

      {pending.length > 0 && <ImportPanel rows={pending} hubs={live} can={can('org.hub.edit') || can('org.hub.create')}
        onDone={async (msg) => { toast(msg); await data.reload() }} />}

      <section className="panel">
        <div className="da-bar"><strong>ম্যাপ</strong><span className="muted sm">সবুজ = চালু · ধূসর = বন্ধ · কমলা = মিলানো বাকি · একই GPS-এ একাধিক হাব একসাথে দেখায়</span></div>
        <OsmMap pins={pins} selected={sel} onSelect={id => { if (id.startsWith('imp-')) return; setSel(id); const h = d.hubs.find(x => x.id === id); if (h) setDetail(h) }} />
      </section>

      <section className="panel">
        <div className="hd-filters">
          <input placeholder="খুঁজুন: নাম, #কোড, ফোন…" value={q} onChange={e => setQ(e.target.value)} />
          <select aria-label="রিজিওন" value={region} onChange={e => { setRegion(e.target.value); setArea('') }}><option value="">সব রিজিওন</option>{d.regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          <select aria-label="এরিয়া" value={area} onChange={e => setArea(e.target.value)}><option value="">সব এরিয়া</option>{d.zones.filter(z => !region || z.region_id === region).map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select>
          <label className={`chip-toggle${showArch ? ' on' : ''}`}><input type="checkbox" checked={showArch} onChange={e => setShowArch(e.target.checked)} /> আর্কাইভ</label>
        </div>
        <DataTable title="হাব তালিকা" file="hubs" rows={rows} rowKey={h => h.id} onRowClick={h => { setSel(h.id); setDetail(h) }}
          empty={<p className="muted">কোনো হাব পাওয়া যায়নি।</p>}
          cols={[
            { key: 'code', label: 'কোড', value: h => codeOf(h), render: h => <strong>{codeOf(h)}</strong> },
            { key: 'name', label: 'নাম', render: h => <>{h.name}{h.name_bn && <span className="sec">{h.name_bn}</span>}</> },
            { key: 'area', label: 'এরিয়া', value: h => areaLabel(h.zone_id) },
            { key: 'type', label: 'ধরন', value: h => h.hub_type || UN },
            { key: 'zone', label: 'জোন', value: h => h.ops_zone || UN },
            { key: 'phone', label: 'ফোন', value: h => h.phone ?? '' },
            { key: 'staff', label: 'কর্মী', value: h => d.staff[h.id] ?? 0 },
            { key: 'gps', label: 'GPS', value: h => (num(h.latitude) !== null ? `${gps(h.latitude)}, ${gps(h.longitude)}` : ''),
              render: h => num(h.latitude) !== null ? <span className="mono sm">{gps(h.latitude)}, {gps(h.longitude)}</span> : <span className="muted">নেই</span> },
            { key: 'st', label: 'অবস্থা', value: h => h.archived_at ? 'আর্কাইভ' : h.status === 'active' ? 'চালু' : 'বন্ধ',
              render: h => h.archived_at ? <Badge tone="neutral">আর্কাইভ</Badge> : h.status === 'active' ? <Badge tone="ok">চালু</Badge> : <Badge tone="bad">বন্ধ</Badge> },
          ]} />
      </section>
    </> : null}

    {detail && d && <Modal title={`${detail.name} ${codeOf(detail)}`} wide onClose={() => setDetail(null)}
      actions={<div className="row hd-acts">
        {!detail.archived_at && can('org.hub.edit') && <>
          <button className="soft" onClick={() => { const h = detail; setDetail(null); openEdit(h) }}><Icon name="edit" /> এডিট</button>
          <button className="secondary" onClick={() => { const h = detail; setDetail(null); setErr(''); setLoc({ hub: h, lat: gps(h.latitude), lng: gps(h.longitude), wifi: h.trip_wifi_ssid ?? '' }) }}><Icon name="map" /> লোকেশন ও Wi-Fi</button>
          <button className="secondary" onClick={() => { const h = detail; setDetail(null); setErr(''); setStat(h) }}>{detail.status === 'active' ? 'বন্ধ করুন' : 'চালু করুন'}</button></>}
        {!detail.archived_at && can('org.hub.archive') && <button className="danger" onClick={() => { const h = detail; setDetail(null); setErr(''); setArch(h) }}>আর্কাইভ</button>}
        <button onClick={() => setDetail(null)}>ঠিক আছে</button></div>}>
      <dl className="hd-dl">
        <dt>হাব কোড</dt><dd><strong>{codeOf(detail)}</strong></dd>
        <dt>নাম</dt><dd>{detail.name}{detail.name_bn ? ` · ${detail.name_bn}` : ''}</dd>
        <dt>রিজিওন</dt><dd>{regionLabel(detail.zone_id)}</dd>
        <dt>এরিয়া</dt><dd>{areaLabel(detail.zone_id)}</dd>
        <dt>হাবের ধরন</dt><dd>{detail.hub_type || UN}</dd>
        <dt>জোন</dt><dd>{detail.ops_zone || UN}</dd>
        <dt>ফোন</dt><dd>{detail.phone ? <a href={`tel:${detail.phone}`}>{detail.phone}</a> : '—'}</dd>
        <dt>ঠিকানা</dt><dd>{detail.address || '—'}</dd>
        <dt>কর্মী</dt><dd>{d.staff[detail.id] ?? 0} জন</dd>
        <dt>অবস্থা</dt><dd>{detail.archived_at ? 'আর্কাইভ' : detail.status === 'active' ? 'চালু' : 'বন্ধ'}</dd>
        <dt>GPS</dt><dd>{num(detail.latitude) !== null ? <><span className="mono">{gps(detail.latitude)}, {gps(detail.longitude)}</span>{' '}
          <a href={gmapLink(num(detail.latitude)!, num(detail.longitude)!)} target="_blank" rel="noreferrer">Google Maps ↗</a></> : 'দেওয়া হয়নি'}</dd>
      </dl>
      {num(detail.latitude) !== null && <OsmMap height={220} pins={[{ id: detail.id, lat: num(detail.latitude)!, lng: num(detail.longitude)!, label: codeOf(detail) }]}
        focus={{ lat: num(detail.latitude)!, lng: num(detail.longitude)! }} />}
    </Modal>}

    {edit && d && <Modal title={edit.isNew ? 'নতুন হাব' : 'হাব এডিট'} onClose={() => setEdit(null)}
      actions={<><button className="secondary" onClick={() => setEdit(null)}>বাতিল</button><button disabled={busy} onClick={() => void saveHub()}>সেভ</button></>}>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label="হাব কোড নম্বর" hint="যেমন 80 — সব জায়গায় দেখাবে &quot;নাম #80&quot;"><input inputMode="numeric" value={edit.row.code ?? ''} onChange={e => setEdit({ ...edit, row: { ...edit.row, code: e.target.value } })} /></Field>
        <Field label="নাম"><input value={edit.row.name ?? ''} onChange={e => setEdit({ ...edit, row: { ...edit.row, name: e.target.value } })} /></Field>
        <Field label="নাম (বাংলা)"><input value={edit.row.name_bn ?? ''} onChange={e => setEdit({ ...edit, row: { ...edit.row, name_bn: e.target.value } })} /></Field>
        <Field label="এরিয়া"><select value={edit.row.zone_id ?? ''} onChange={e => setEdit({ ...edit, row: { ...edit.row, zone_id: e.target.value } })}>
          <option value="">বেছে নিন…</option>{d.zones.map(z => <option key={z.id} value={z.id}>{z.name}{z.region_id ? ` — ${regionById[z.region_id]?.name ?? ''}` : ''}</option>)}</select></Field>
        <Field label="হাবের ধরন"><select value={edit.row.hub_type ?? ''} onChange={e => setEdit({ ...edit, row: { ...edit.row, hub_type: e.target.value } })}>
          <option value="">{UN}</option>{[...new Set([...HUB_TYPES, ...(edit.row.hub_type ? [edit.row.hub_type] : [])])].map(t => <option key={t} value={t}>{t}</option>)}</select></Field>
        <Field label="জোন" hint="ফাঁকা = Unassigned"><input value={edit.row.ops_zone ?? ''} placeholder={UN} onChange={e => setEdit({ ...edit, row: { ...edit.row, ops_zone: e.target.value } })} /></Field>
        <Field label="ফোন"><input inputMode="tel" value={edit.row.phone ?? ''} onChange={e => setEdit({ ...edit, row: { ...edit.row, phone: e.target.value } })} /></Field>
        <Field label="ঠিকানা" wide><textarea rows={2} value={edit.row.address ?? ''} onChange={e => setEdit({ ...edit, row: { ...edit.row, address: e.target.value } })} /></Field>
        <Field label="Latitude"><input inputMode="decimal" value={edit.row.lat ?? ''} placeholder="24.4124350" onChange={e => setEdit({ ...edit, row: { ...edit.row, lat: e.target.value } })} /></Field>
        <Field label="Longitude"><input inputMode="decimal" value={edit.row.lng ?? ''} placeholder="89.0024500" onChange={e => setEdit({ ...edit, row: { ...edit.row, lng: e.target.value } })} /></Field>
      </div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}

    {loc && <Modal title={`লোকেশন ও Wi-Fi — ${loc.hub.name} ${codeOf(loc.hub)}`} wide onClose={() => setLoc(null)}
      actions={<><button className="secondary" onClick={() => setLoc(null)}>বাতিল</button><button disabled={busy} onClick={() => void saveLoc()}>সেভ</button></>}>
      <p className="muted sm">ম্যাপে ট্যাপ করে পিন বসান, অথবা নম্বর লিখুন, অথবা হাবে দাঁড়িয়ে "আমার লোকেশন" চাপুন।</p>
      <OsmMap height={300} onPick={(lat, lng) => setLoc({ ...loc, lat: lat.toFixed(7), lng: lng.toFixed(7) })}
        pins={num(loc.lat) !== null && num(loc.lng) !== null ? [{ id: 'p', lat: Number(loc.lat), lng: Number(loc.lng), label: codeOf(loc.hub), tone: 'sel' }] : []}
        focus={num(loc.hub.latitude) !== null ? { lat: num(loc.hub.latitude)!, lng: num(loc.hub.longitude)! } : null} />
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 10 }}>
        <Field label="Latitude"><input inputMode="decimal" value={loc.lat} onChange={e => setLoc({ ...loc, lat: e.target.value })} /></Field>
        <Field label="Longitude"><input inputMode="decimal" value={loc.lng} onChange={e => setLoc({ ...loc, lng: e.target.value })} /></Field>
        <Field label="হাবের Wi-Fi নাম (SSID)" hint="ফোনের Wi-Fi তালিকায় যে নাম দেখা যায় সেটি দিন।" wide>
          <input maxLength={32} value={loc.wifi} onChange={e => setLoc({ ...loc, wifi: e.target.value })} />
        </Field>
      </div>
      <div className="row"><button type="button" className="secondary" onClick={myLocation}><Icon name="map" /> আমার লোকেশন</button>
        {num(loc.lat) !== null && num(loc.lng) !== null && <a className="btn-link" href={gmapLink(Number(loc.lat), Number(loc.lng))} target="_blank" rel="noreferrer">Google Maps-এ দেখুন ↗</a>}</div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}

    {stat && <Modal title={stat.status === 'active' ? 'হাব বন্ধ করবেন?' : 'হাব চালু করবেন?'} onClose={() => setStat(null)}
      actions={<><button className="secondary" onClick={() => setStat(null)}>বাতিল</button>
        <button className={stat.status === 'active' ? 'danger' : ''} disabled={busy} onClick={() => void run(() => org.update('hubs', stat.id, { status: stat.status === 'active' ? 'inactive' : 'active' }),
          stat.status === 'active' ? 'হাব বন্ধ করা হয়েছে' : 'হাব চালু করা হয়েছে').then(ok => { if (ok) setStat(null) })}>{stat.status === 'active' ? 'বন্ধ করুন' : 'চালু করুন'}</button></>}>
      <p><strong>{stat.name} {codeOf(stat)}</strong></p>
      <p className="muted">{stat.status === 'active' ? 'বন্ধ হাব তালিকায় থাকবে, তথ্য মুছবে না। পরে আবার চালু করা যাবে।' : 'হাবটি আবার চালু তালিকায় আসবে।'}</p>
      {err && <p className="da-error">{err}</p>}
    </Modal>}

    {arch && <ArchiveModal what={`${arch.name} ${codeOf(arch)}`} busy={busy} err={err} onClose={() => setArch(null)}
      onOk={reason => void run(() => org.archive('hubs', arch.id, reason.trim()), 'আর্কাইভ করা হয়েছে — তথ্য মুছে যায়নি').then(ok => { if (ok) setArch(null) })} />}

    {unit && d && <Modal title={`${unit.isNew ? 'নতুন' : ''} ${unit.kind === 'region' ? 'রিজিওন' : 'এরিয়া'}${unit.isNew ? '' : ' এডিট'}`} onClose={() => setUnit(null)}
      actions={<><button className="secondary" onClick={() => setUnit(null)}>বাতিল</button><button disabled={busy} onClick={() => void saveUnit()}>সেভ</button></>}>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label="নাম"><input value={unit.row.name ?? ''} placeholder={unit.kind === 'region' ? 'Rajshahi Region' : 'Natore Area'} onChange={e => setUnit({ ...unit, row: { ...unit.row, name: e.target.value } })} /></Field>
        <Field label="নাম (বাংলা)"><input value={unit.row.name_bn ?? ''} onChange={e => setUnit({ ...unit, row: { ...unit.row, name_bn: e.target.value } })} /></Field>
        {unit.kind === 'area' && <Field label="কোন রিজিওনের নিচে" wide><select value={unit.row.region_id ?? ''} onChange={e => setUnit({ ...unit, row: { ...unit.row, region_id: e.target.value } })}>
          <option value="">ঠিক করা হয়নি</option>{d.regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>}
      </div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </AppShell>
}

function ImportPanel({ rows, hubs, can, onDone }: { rows: ImportRow[]; hubs: Hub[]; can: boolean; onDone: (msg: string) => Promise<void> }) {
  const [pick, setPick] = useState<Record<string, string>>({})
  const [names, setNames] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState<Record<string, string>>({})
  // Hubs that can still take a number code: no numeric code yet.
  const free = hubs.filter(h => !isNum(h.code))
  async function apply(r: ImportRow) {
    const target = pick[r.id] ?? (r.suggested_hub_id && free.some(h => h.id === r.suggested_hub_id) ? r.suggested_hub_id : '')
    setBusy(r.id); setErr({ ...err, [r.id]: '' })
    try {
      const res = await hubDir.apply(r.id, target || null, target ? undefined : names[r.id])
      await onDone(`#${r.code} বসানো হয়েছে${res.notes?.length ? ' — ' + res.notes.join('; ') : ''}`)
    } catch (e) { setErr({ ...err, [r.id]: errText(e) }) } finally { setBusy('') }
  }
  return <section className="panel hd-import">
    <div className="da-bar"><strong>তালিকা থেকে মিলানো বাকি: {rows.length}টি</strong>
      <span className="muted sm">আইডি, ফোন ও জিপিএস তালিকার মতোই বসবে। চালু হাবে শুধু ফাঁকা ঘর ভরবে।</span></div>
    <div className="hd-imp-list">
      {rows.map(r => {
        const target = pick[r.id] ?? (r.suggested_hub_id && free.some(h => h.id === r.suggested_hub_id) ? r.suggested_hub_id : '')
        return <div key={r.id} className="hd-imp">
          <div className="hd-imp-top"><strong>#{r.code}</strong><span className="mono sm">{r.phone}</span></div>
          <div className="sm">{r.address || <span className="muted">ঠিকানা নেই</span>}</div>
          <div className="mono sm muted">{gps(r.latitude)}, {gps(r.longitude)}</div>
          {r.suggest_note && <div className="sm hd-hint">💡 {r.suggest_note}</div>}
          {can ? <div className="hd-imp-act">
            <select value={target} onChange={e => setPick({ ...pick, [r.id]: e.target.value })}>
              <option value="">➕ নতুন হাব তৈরি করুন</option>
              {free.map(h => <option key={h.id} value={h.id}>{h.name} — এই হাবে বসাও</option>)}
            </select>
            {!target && <input placeholder="নতুন হাবের নাম" value={names[r.id] ?? ''} onChange={e => setNames({ ...names, [r.id]: e.target.value })} />}
            <button disabled={busy === r.id || (!target && !(names[r.id] ?? '').trim())} onClick={() => void apply(r)}>{busy === r.id ? '…' : 'বসাও'}</button>
          </div> : null}
          {err[r.id] && <p className="da-error">{err[r.id]}</p>}
        </div>
      })}
    </div>
  </section>
}
