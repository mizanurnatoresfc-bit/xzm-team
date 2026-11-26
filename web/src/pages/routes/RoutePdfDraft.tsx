import { useState } from 'react'
import type { PdfAreaRow } from '../../lib/planPdf'
import { hasGps, placeName, type Place, type RouteStop } from '../../lib/routes'
import { usePrefs } from '../../lib/prefs'
import { placeToStop } from '../zonal/RoutePlaces'

type AreaCount = { place: Place; historical: number; incoming: number }
type Preview = { areas: AreaCount[]; unresolved: number; total: number; historicalDays: number; errors: string[] }
type Parcel = { matches: Set<string>; day: string | null }
const words = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim()
const sameStop = (a: RouteStop, b: RouteStop) => a.lat === b.lat && a.lng === b.lng

async function previewFiles(files: File[], places: Place[]): Promise<Preview> {
  const { readPlanPdf } = await import('../../lib/planPdf')
  const names = new Map<string, Set<string>>()
  for (const place of places) {
    for (const alias of [place.name, place.name_bn]) {
      const key = words(alias ?? '')
      if (key.length < 3) continue
      const ids = names.get(key) ?? new Set<string>()
      ids.add(place.id); names.set(key, ids)
    }
  }
  const aliases = [...names].map(([name, ids]) => ({ name, ids, compact: name.replace(/ /g, '') }))
  function match(text: string) {
    const normalized = words(text)
    const whole = ' ' + normalized + ' '
    const compact = normalized.replace(/ /g, '')
    let best = 0
    const matches = new Set<string>()
    for (const alias of aliases) {
      const size = alias.compact.length
      if (size < best) continue
      const exact = whole.includes(' ' + alias.name + ' ')
      // Mobile PDFs can insert spaces inside Bangla place names.
      const joined = size >= 5 && /[\u0980-\u09ff]/.test(alias.name) && compact.includes(alias.compact)
      if (!exact && !joined) continue
      if (size > best) { matches.clear(); best = size }
      for (const id of alias.ids) matches.add(id)
    }
    return matches
  }
  const historical = new Map<number, Parcel>()
  const incoming = new Map<number, Parcel>()
  const dates = new Set<string>()
  const errors: string[] = []
  for (const file of files) {
    try {
      const rows: PdfAreaRow[] = []
      const doc = await readPlanPdf(file, rows)
      const source = doc.kind === 'dispatch' ? incoming : historical
      if (source === historical && doc.doc_date) dates.add(doc.doc_date)
      for (const row of rows) {
        const entry = source.get(row.id) ?? { matches: new Set<string>(), day: doc.doc_date }
        for (const id of match(row.text)) entry.matches.add(id)
        if (doc.doc_date && (!entry.day || doc.doc_date < entry.day)) entry.day = doc.doc_date
        source.set(row.id, entry)
      }
    } catch (error) {
      errors.push(file.name + ': ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  const counts = new Map(places.map(place => [place.id, { place, historical: 0, incoming: 0 }]))
  let unresolved = 0
  for (const [key, parcels] of [['historical', historical], ['incoming', incoming]] as const) {
    for (const [parcelId, { matches, day }] of parcels) {
      const candidates = key === 'incoming' && !matches.size ? historical.get(parcelId)?.matches ?? matches : matches
      const id = candidates.size === 1 ? candidates.values().next().value : undefined
      const area = id ? counts.get(id) : undefined
      if (!area) unresolved++
      else if (key === 'incoming' || day) area[key]++
    }
  }
  return { areas: [...counts.values()].filter(a => a.historical || a.incoming).sort((a, b) => b.incoming - a.incoming || b.historical - a.historical),
    unresolved, total: historical.size + incoming.size, historicalDays: dates.size, errors }
}

export function RoutePdfDraft({ places, stops, maxStops, onAdd }: {
  places: Place[]; stops: RouteStop[]; maxStops: number; onAdd: (stops: RouteStop[]) => void
}) {
  const { L, n, lang } = usePrefs()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function read(files: File[]) {
    if (!files.length) return
    if (files.length > 40) { setError(L('একবারে সর্বোচ্চ ৪০টি PDF দিন।', 'Choose up to 40 PDFs at a time.')); return }
    setError(''); setBusy(true); setPreview(null); setSelected([])
    try { setPreview(await previewFiles(files, places.filter(place => !place.hidden && hasGps(place)))) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const areas = preview?.areas ?? []
  const included = (place: Place) => stops.some(stop => sameStop(stop, placeToStop(place, lang)))
  const totals = areas.filter(a => included(a.place)).reduce((sum, area) => ({
    historical: sum.historical + area.historical, incoming: sum.incoming + area.incoming,
  }), { historical: 0, incoming: 0 })
  const add = areas.filter(a => selected.includes(a.place.id) && !included(a.place)).reduce<RouteStop[]>((list, a) => {
    const stop = placeToStop(a.place, lang)
    return list.some(existing => sameStop(existing, stop)) ? list : [...list, stop]
  }, [])
  return <details className="rt-card">
    <summary><b>{L('PDF দিয়ে রুটের স্টপ বাছুন', 'Choose route stops from PDFs')}</b></summary>
    <p className="small">{L('এই হাবের রাইডার অ্যাসাইন ও ইনকামিং ডিসপ্যাচ PDF দিন। পরিচিত এলাকার মিল এই ডিভাইসেই দেখা হবে। এলাকা যাচাই করে স্টপ যোগ করুন।',
      'Upload the rider and incoming dispatch PDFs for this hub. Area matching runs on this device. Review the matches before adding stops.')}</p>
    <label className="small">{L('রাইডার ও ডিসপ্যাচ PDF', 'Rider and dispatch PDFs')}
      <input type="file" accept=".pdf,application/pdf" multiple disabled={busy}
        onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void read(files) }} />
    </label>
    {!places.length && <p className="small">{L('এলাকার তালিকা এখন পাওয়া যাচ্ছে না। PDF পড়া যাবে, তবে তালিকা লোড হলে মিল খুঁজতে আবার দিন।', 'The area catalog is unavailable. PDFs can be read now; reselect them after the catalog loads to match areas.')}</p>}
    {busy && <p role="status">{L('PDF পড়া হচ্ছে…', 'Reading PDFs…')}</p>}
    {error && <p className="da-error" role="alert">{error}</p>}
    {preview && <>
      {preview.errors.map((text, i) => <p key={i} className="da-error">{text}</p>)}
      <p className="small">{L('পড়া পার্সেল', 'Parcels read')} <b>{n(preview.total)}</b>{' · '}{L('এলাকা যাচাই বাকি', 'Area pending verification')} <b>{n(preview.unresolved)}</b></p>
      <p className="small">{L('বর্তমান স্টপে ইনকামিং', 'Incoming for current stops')} <b>{n(totals.incoming)}</b>
        {' · '}{L('দৈনিক গড়', 'Daily average')} <b>{preview.historicalDays ? n(Math.round(totals.historical / preview.historicalDays)) : '—'}</b>
        {' · '}{L('অ্যাসাইন PDF-এর দিন', 'Rider PDF days')} {n(preview.historicalDays)}</p>
      <div className="da-table-wrap"><table className="da-table">
        <thead><tr><th>{L('এলাকা', 'Area')}</th><th>{L('গড়', 'Average')}</th><th>{L('ইনকামিং', 'Incoming')}</th></tr></thead>
        <tbody>{areas.map(a => <tr key={a.place.id}><td><label>
          <input type="checkbox" checked={included(a.place) || selected.includes(a.place.id)} disabled={included(a.place)}
            onChange={e => setSelected(old => e.target.checked ? [...old, a.place.id] : old.filter(id => id !== a.place.id))} /> {placeName(a.place, lang)}
        </label></td><td>{preview.historicalDays ? n(Math.round(a.historical / preview.historicalDays)) : '—'}</td><td>{n(a.incoming)}</td></tr>)}</tbody>
      </table></div>
      {areas.length === 0 && <p>{L('পরিচিত কোনো এলাকা মেলেনি।', 'No catalogued areas matched.')}</p>}
      <button type="button" disabled={!add.length || stops.length + add.length > maxStops}
        onClick={() => { onAdd(add); setSelected([]) }}>{L('বাছাই করা এলাকা স্টপে যোগ করুন', 'Add selected areas as stops')}</button>
      {stops.length + add.length > maxStops && <p className="da-error">{L('রুটের সর্বোচ্চ স্টপের সীমা ছাড়িয়েছে।', 'The route stop limit would be exceeded.')}</p>}
    </>}
  </details>
}
