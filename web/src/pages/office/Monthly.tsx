// মাসিক ভাড়া ও বিল — the month at a glance for every place the person may see: for each hub its offices, residences and garages,
// the rent (fixed, or — for an auto garage — worked out from the "yes" days), the wifi / electricity / water / gas / other bills written so far,
// and how many vehicles the hub has. Read-only: it only reads; changes are made on each place's own pages.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { DataTable } from '../../components/DataTable'
import { Stat, useLoad } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { autos, PLACE_KIND, scopeOf, scopePath, type AutoTotal, type OfficeScope, type Property } from '../../lib/office'
import { BILL_KIND, ops, opsFriendly, type Bill, type BillKind } from '../../lib/officeOps'
import { supabase } from '../../lib/supabase'
import { useOfficeOutput } from './useOutput'

const dhaka = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const OTHER: BillKind[] = ['electricity', 'wifi', 'water', 'gas', 'other']

type Line = { p: Property; hub: string; rent: number; auto: boolean; by: Record<BillKind, number>; other: number; total: number }
type HubLine = { key: string; hub: string; offices: number; residences: number; garages: number; vehicles: number | null; rent: number; by: Record<BillKind, number>; other: number; total: number }
const zero = () => Object.fromEntries(Object.keys(BILL_KIND).map(k => [k, 0])) as Record<BillKind, number>

export function Monthly({ places, hubName }: { places: Property[]; hubName: (id: string | null) => string }) {
  const { can } = useAuth()
  const { L, n, lang } = usePrefs()
  const go = useNavigate()
  const outPlaces = useOfficeOutput('monthly-places'), outHubs = useOfficeOutput('monthly-hubs')
  const [month, setMonth] = useState(() => dhaka().slice(0, 7))
  const [side, setSide] = useState<'all' | OfficeScope>('all')
  const first = `${month}-01`
  const seeBills = can('office.bill.view')
  const ids = places.map(p => p.id).sort().join(',')
  const bills = useLoad(() => seeBills ? ops.billsOfMonth(ids ? ids.split(',') : [], first) : Promise.resolve([] as Bill[]), [ids, first, seeBills])
  const auto = useLoad(() => autos.totals(first).catch(() => [] as AutoTotal[]), [first, ids])
  // How many vehicles each hub has (the fleet module); a role without access to it simply sees no number.
  const cars = useLoad(async () => {
    const { data, error } = await supabase.from('vehicles').select('hub_id').is('archived_at', null)
    if (error) return null
    const m: Record<string, number> = {}; for (const v of (data ?? []) as Array<{ hub_id: string | null }>) if (v.hub_id) m[v.hub_id] = (m[v.hub_id] ?? 0) + 1
    return m
  }, [])

  const shown = useMemo(() => places.filter(p => side === 'all' || scopeOf(p.kind) === side), [places, side])
  const lines: Line[] = useMemo(() => shown.map(p => {
    const mine = (bills.data ?? []).filter(b => b.property_id === p.id)
    const by = zero(); for (const b of mine) by[b.kind] += Number(b.amount)
    const isAuto = p.kind === 'auto_garage'
    // Rent: an auto garage's comes from the month's yes-days; any other place's is its fixed rent.
    const rent = isAuto ? Number((auto.data ?? []).find(t => t.property_id === p.id)?.amount ?? 0) : Number(p.rent ?? 0)
    const other = OTHER.reduce((s, k) => s + by[k], 0)
    return { p, hub: hubName(p.hub_id), rent, auto: isAuto, by, other, total: rent + other }
  }), [shown, bills.data, auto.data, hubName])

  const hubs: HubLine[] = useMemo(() => {
    const m = new Map<string, HubLine>()
    for (const l of lines) {
      const key = l.p.hub_id ?? '—'
      const h = m.get(key) ?? { key, hub: l.hub || L('হাব ছাড়া', 'No hub'), offices: 0, residences: 0, garages: 0, vehicles: l.p.hub_id && cars.data ? cars.data[l.p.hub_id] ?? 0 : null, rent: 0, by: zero(), other: 0, total: 0 }
      const sc = scopeOf(l.p.kind)
      if (sc === 'office') h.offices++; else if (sc === 'residential') h.residences++; else h.garages++
      h.rent += l.rent; h.other += l.other; h.total += l.total
      for (const k of OTHER) h.by[k] += l.by[k]
      m.set(key, h)
    }
    return [...m.values()].sort((a, b) => a.hub.localeCompare(b.hub))
  }, [lines, cars.data, L])

  const sum = (f: (l: Line) => number) => lines.reduce((s, l) => s + f(l), 0)
  const tk = (v: number) => v ? `৳ ${n(Math.round(v))}` : '—'
  const monthName = new Date(first + 'T00:00:00').toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { month: 'long', year: 'numeric' })
  const open = (p: Property) => { const sc = scopeOf(p.kind); go(scopePath(sc, p.kind === 'auto_garage' ? 'autos' : 'rent')) }
  const err = bills.error || auto.error
  const sides: Array<['all' | OfficeScope, string, string]> = [['all', 'সব', 'All'], ['office', 'হাব', 'Hub'], ['residential', 'আবাসিক', 'Residential'], ['garage', 'গ্যারেজ', 'Garage']]

  if (!places.length) return <section className="panel"><p className="notice">{L('এখনো কোনো জায়গা যোগ হয়নি — হাব, আবাসিক বা গ্যারেজ যোগ করলে এখানে মাসের হিসাব আসবে।', 'No place yet — add a hub, residence or garage and the month appears here.')}</p></section>
  return <>
    <section className="da-filters panel no-print">
      <label className="field"><span>{L('মাস', 'Month')}</span><input type="month" value={month} max={dhaka().slice(0, 7)} onChange={e => e.target.value && setMonth(e.target.value)} /></label>
      <span className="da-seg" role="group" aria-label={L('ধরন', 'Kind')}>{sides.map(([k, bn, en]) =>
        <button key={k} className={k === side ? 'sm' : 'secondary sm'} aria-pressed={k === side} onClick={() => setSide(k)}>{L(bn, en)}</button>)}</span>
    </section>
    <div className="da-stats">
      <Stat icon="home" label={L('জায়গা', 'Places')} value={n(lines.length)} sub={L(`হাব ${n(hubs.length)}টি`, `${hubs.length} hubs`)} />
      <Stat icon="cash" label={L(`${monthName}-এর ভাড়া`, `Rent, ${monthName}`)} value={tk(sum(l => l.rent))} />
      {seeBills && <Stat icon="receipt" label={L('বিদ্যুৎ · ওয়াইফাই · অন্য বিল', 'Electricity · wifi · other')} value={tk(sum(l => l.other))}
        sub={L(`বিদ্যুৎ ${tk(sum(l => l.by.electricity))} · ওয়াইফাই ${tk(sum(l => l.by.wifi))}`, `electricity ${tk(sum(l => l.by.electricity))} · wifi ${tk(sum(l => l.by.wifi))}`)} />}
      <Stat icon="chart" label={L('মোট খরচ', 'Total')} value={tk(sum(l => l.total))} />
    </div>
    {err ? <p className="da-error">{opsFriendly(err)}</p> : null}
    <section className="panel">
      <DataTable<HubLine> {...outHubs} title={L(`হাব অনুযায়ী — ${monthName}`, `By hub — ${monthName}`)} file="monthly-hubs" rows={hubs} rowKey={h => h.key} phoneView="card"
        cols={[
          { key: 'hub', label: L('হাব', 'Hub'), primary: true, value: h => h.hub, render: h => <strong>{h.hub}</strong> },
          { key: 'places', label: L('জায়গা', 'Places'), value: h => [h.offices && L(`হাব ${h.offices}`, `Hub ${h.offices}`), h.residences && L(`আবাসিক ${h.residences}`, `Residential ${h.residences}`), h.garages && L(`গ্যারেজ ${h.garages}`, `Garage ${h.garages}`)].filter(Boolean).join(' · '),
            render: h => [h.offices ? L(`হাব ${n(h.offices)}`, `Hub ${h.offices}`) : '', h.residences ? L(`আবাসিক ${n(h.residences)}`, `Residential ${h.residences}`) : '', h.garages ? L(`গ্যারেজ ${n(h.garages)}`, `Garage ${h.garages}`) : ''].filter(Boolean).join(' · ') },
          { key: 'vehicles', label: L('গাড়ি', 'Vehicles'), className: 'r', value: h => h.vehicles ?? '', render: h => h.vehicles == null ? '—' : n(h.vehicles) },
          { key: 'rent', label: L('ভাড়া', 'Rent'), className: 'r', value: h => h.rent || '', render: h => tk(h.rent) },
          ...(seeBills ? [
            { key: 'el', label: L('বিদ্যুৎ বিল', 'Electricity'), className: 'r', value: (h: HubLine) => h.by.electricity || '', render: (h: HubLine) => tk(h.by.electricity) },
            { key: 'wf', label: L('ওয়াইফাই বিল', 'Wifi'), className: 'r', value: (h: HubLine) => h.by.wifi || '', render: (h: HubLine) => tk(h.by.wifi) },
            { key: 'ot', label: L('পানি · গ্যাস · অন্য', 'Water · gas · other'), className: 'r', value: (h: HubLine) => h.by.water + h.by.gas + h.by.other || '', render: (h: HubLine) => tk(h.by.water + h.by.gas + h.by.other) },
          ] : []),
          { key: 'total', label: L('মোট', 'Total'), className: 'r', value: h => h.total || '', render: h => <strong>{tk(h.total)}</strong> },
        ]} />
    </section>
    <section className="panel">
      <DataTable<Line> {...outPlaces} title={L(`জায়গা অনুযায়ী — ${monthName}`, `By place — ${monthName}`)} file="monthly-places" rows={lines} rowKey={l => l.p.id} phoneView="card" onRowClick={l => open(l.p)}
        cols={[
          { key: 'name', label: L('জায়গা', 'Place'), primary: true, value: l => l.p.name, render: l => <><strong>{PLACE_KIND[l.p.kind][2]} {l.p.name}</strong>{l.hub && <span className="sec">{l.hub}</span>}</> },
          { key: 'hub', label: L('হাব', 'Hub'), hidden: true, value: l => l.hub },
          { key: 'kind', label: L('ধরন', 'Kind'), value: l => L(PLACE_KIND[l.p.kind][0], PLACE_KIND[l.p.kind][1]) },
          { key: 'rent', label: L('ভাড়া', 'Rent'), className: 'r', value: l => l.rent || '', render: l => l.rent ? <>{tk(l.rent)}{l.auto && <small className="muted"> · {L('দিন ধরে', 'by day')}</small>}</> : '—' },
          ...(seeBills ? [
            { key: 'el', label: L('বিদ্যুৎ বিল', 'Electricity'), className: 'r', value: (l: Line) => l.by.electricity || '', render: (l: Line) => tk(l.by.electricity) },
            { key: 'wf', label: L('ওয়াইফাই বিল', 'Wifi'), className: 'r', value: (l: Line) => l.by.wifi || '', render: (l: Line) => tk(l.by.wifi) },
            { key: 'ot', label: L('পানি · গ্যাস · অন্য', 'Water · gas · other'), className: 'r', value: (l: Line) => l.by.water + l.by.gas + l.by.other || '', render: (l: Line) => tk(l.by.water + l.by.gas + l.by.other) },
          ] : []),
          { key: 'total', label: L('মোট', 'Total'), className: 'r', value: l => l.total || '', render: l => <strong>{tk(l.total)}</strong> },
        ]} />
      <p className="muted small">{L('ভাড়া ঠিক করা আছে এমন জায়গায় নির্ধারিত ভাড়া; অটো গ্যারেজে মাসের "হ্যাঁ" দিন গুনে। বিল যা যা লেখা হয়েছে শুধু সেগুলোই আসে। জায়গায় চাপলে তার ভাড়া/অটোর পাতা খুলবে।',
        'Rent is the place’s fixed rent; for an auto garage it is worked out from the month’s "yes" days. Only the bills written so far appear. Tap a place to open its rent / autos page.')}</p>
    </section>
  </>
}
