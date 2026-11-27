import { useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { usePrefs } from '../../lib/prefs'
import { routePdfAreaMatcher } from '../../lib/routePdfAreas'
import { hasGps, placeName, type RouteHub } from '../../lib/routes'
import { placeToStop, usePlaces } from '../zonal/RoutePlaces'
import type { PaneCtx } from './panes'

type Parcel = { id: number; area: string | null }
type Import = { id: string; name: string; day: string; rider: string; rows: Parcel[]; warning: boolean }

const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '')
const keyOf = (day: string, id: number) => day + ':' + id

function uniqueParcels(files: Import[]) {
  const rows = new Map<string, Parcel>()
  for (const file of files) {
    for (const row of file.rows) {
      const key = keyOf(file.day, row.id)
      if (!rows.get(key)?.area || row.area) rows.set(key, row)
    }
  }
  return rows
}

export function RouteParcelPdfs({ c }: { c: PaneCtx }) {
  const { session } = useAuth()
  const { L } = usePrefs()
  const catalog = usePlaces()
  const hubs = c.o?.hubs ?? []
  if (!hubs.length || !session) return <p>{L('এই জোনে কোনো হাব পাওয়া যায়নি।', 'No hubs are available in this zone.')}</p>
  return <div>
    {hubs.filter(hub => !c.hub || c.hub === hub.id).map(hub =>
      <HubPdfPanel key={session.user.id + ':' + hub.id} c={c} hub={hub} account={session.user.id} catalog={catalog} />)}
  </div>
}

function HubPdfPanel({ c, hub, account, catalog }: { c: PaneCtx; hub: RouteHub; account: string; catalog: ReturnType<typeof usePlaces> }) {
  const { L, n, lang } = usePrefs()
  const places = useMemo(() => catalog.places.filter(place => !place.hidden && hasGps(place)), [catalog.places])
  const byId = useMemo(() => new Map(places.map(place => [place.id, place])), [places])
  const storeKey = 'xzm.route-parcel-pdfs.v1:' + account + ':' + hub.id
  const [files, setFiles] = useState<Import[]>(() => {
    try { const saved = JSON.parse(localStorage.getItem(storeKey) ?? '[]'); return Array.isArray(saved) ? saved : [] }
    catch { return [] }
  })
  const [fallback, setFallback] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<string[]>([])
  const [reviewFile, setReviewFile] = useState('')
  const [reviewArea, setReviewArea] = useState('')
  const [reviewParcel, setReviewParcel] = useState('')
  const [search, setSearch] = useState('')
  const editable = c.canEdit(hub.id)
  const filtered = files.filter(file => (!from || file.day >= from) && (!to || file.day <= to))
  const inbound = filtered.filter(file => !file.rider)
  const assigned = uniqueParcels(filtered.filter(file => file.rider))
  const incoming = uniqueParcels(inbound)
  const incomingDays = new Set(inbound.map(file => file.day))
  const reportDays = from && to && from <= to
    ? Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1 : null
  const found = [...incoming.keys()].filter(key => assigned.has(key)).length
  const areas = new Map<string, number>()
  for (const row of incoming.values()) if (row.area) areas.set(row.area, (areas.get(row.area) ?? 0) + 1)
  const hubRoutes = c.routes.filter(route => route.hub_id === hub.id)
  const review = files.find(file => file.id === reviewFile)

  function save(next: Import[]) {
    try {
      localStorage.setItem(storeKey, JSON.stringify(next))
      setFiles(next)
    } catch {
      setMessages(old => [...old, L('এই ব্রাউজারে ইতিহাস সেভ করা যায়নি।', 'Could not save history in this browser.')])
    }
  }

  async function upload(selected: File[], rider: string) {
    if (!selected.length || !editable || busy) return
    setBusy(true)
    setMessages([])
    const errors: string[] = []
    const added: Import[] = []
    const match = routePdfAreaMatcher(places)
    try {
      const { readPlanPdf } = await import('../../lib/planPdf')
      for (const file of selected) {
        try {
          const rows: import('../../lib/planPdf').PdfAreaRow[] = []
          const pdf = await readPlanPdf(file, rows)
          if ((pdf.kind === 'dispatch') === Boolean(rider)) {
            throw new Error(L('এই আপলোডের জন্য ভুল ধরনের PDF।', 'Wrong PDF type for this upload.'))
          }
          if (pdf.hub_text && !normalize(pdf.hub_text).includes(normalize(hub.name)) &&
            !normalize(hub.name).includes(normalize(pdf.hub_text))) {
            throw new Error(L('PDF-এর হাব নির্বাচিত হাবের সঙ্গে মিলছে না।', 'PDF hub does not match the selected hub.'))
          }
          const day = pdf.doc_date || fallback
          if (!day) throw new Error(L('PDF-এর তারিখ পাওয়া যায়নি। বিকল্প তারিখ বাছুন।', 'PDF date missing. Select a fallback date.'))
          added.push({ id: crypto.randomUUID(), name: file.name, day, rider, warning: pdf.warnings.includes('rows'),
            rows: rows.map(row => {
              const matches = [...match(row.text)]
              return { id: row.id, area: matches.length === 1 ? matches[0] : null }
            }) })
        } catch (error) {
          errors.push(file.name + ' · ' + (error instanceof Error ? error.message : String(error)))
        }
      }
      setMessages(errors)
      if (added.length) save([...files, ...added])
    } catch (error) {
      setMessages([error instanceof Error ? error.message : String(error)])
    } finally { setBusy(false) }
  }

  function picker(label: string, rider = '') {
    return <label className="rm-pdf-file small">{label}
      <input type="file" accept=".pdf,application/pdf" multiple disabled={!editable || busy || !catalog.data}
        onChange={event => { const selected = Array.from(event.target.files ?? []); event.target.value = ''; void upload(selected, rider) }} />
    </label>
  }

  return <section className="panel rm-pdf">
    <h2>{hub.name}</h2>
    <p className="small">{L('আমদানির ইতিহাস এই অ্যাকাউন্টের জন্য এই ব্রাউজারে থাকে। PDF ফাইল ও ঠিকানার লেখা সেভ হয় না।',
      'Import history stays in this browser for this account. PDF files and address text are discarded.')}</p>
    {picker(L('ইনকামিং PDF আপলোড', 'Upload incoming PDFs'))}
    <div className="rt-bar">
      <label>{L('বিকল্প PDF তারিখ', 'Fallback PDF date')} <input type="date" value={fallback} onChange={e => setFallback(e.target.value)} /></label>
      <label>{L('রিপোর্ট শুরু', 'Report from')} <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label>{L('রিপোর্ট শেষ', 'Report through')} <input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
    </div>
    {Boolean(catalog.error) && <button className="secondary sm" onClick={() => void catalog.reload()}>{L('এলাকার তালিকা আবার লোড করুন', 'Reload area catalog')}</button>}
    {catalog.loading && <p role="status">{L('এলাকার তালিকা লোড হচ্ছে…', 'Loading area catalog…')}</p>}
    {busy && <p role="status">{L('PDF পড়া হচ্ছে…', 'Reading PDFs…')}</p>}
    {messages.map((message, i) => <p key={i} role="alert" className="da-error">{message}</p>)}
    <dl className="rt-bar">
      <div><dt>{L('PDF পাওয়া দিন', 'Days with incoming PDFs')}</dt><dd>{n(incomingDays.size)}</dd></div>
      {reportDays !== null && <div><dt>{L('ইনকামিং PDF নেই এমন দিন', 'Days without incoming PDFs')}</dt><dd>{n(reportDays - incomingDays.size)}</dd></div>}
      <div><dt>{L('ইনকামিং', 'Incoming')}</dt><dd>{n(incoming.size)}</dd></div>
      <div><dt>{L('দৈনিক গড়', 'Daily average')}</dt><dd>{incomingDays.size ? n(Math.round(incoming.size / incomingDays.size)) : '—'}</dd></div>
      <div><dt>{L('রাইডারকে বরাদ্দ মিলেছে', 'Incoming matched to rider')}</dt><dd>{n(found)}</dd></div>
      <div><dt>{L('বরাদ্দের PDF মিলেনি', 'No rider PDF match')}</dt><dd>{n(incoming.size - found)}</dd></div>
      <div><dt>{L('এলাকা যাচাই বাকি', 'Area review pending')}</dt><dd>{n([...incoming.values()].filter(row => !row.area).length)}</dd></div>
    </dl>
    <h3>{L('ইনকামিং এলাকা', 'Incoming areas')}</h3>
    <ul>{[...areas].map(([id, count]) => {
      const place = byId.get(id)
      if (!place) return null
      const routes = hubRoutes.filter(route => route.stops.some(stop => stop.lat === place.lat && stop.lng === place.lng))
      return <li key={id}>{placeName(place, lang)} · {n(count)} · {routes.length ? routes.map(route =>
        [route.name, ...route.riders.map(rider => rider.name)].join(' / ')).join(', ') : L('মিলে যাওয়া রুট নেই', 'No matching route')}</li>
    })}</ul>
    <h3>{L('রাইডার PDF ও লোড', 'Rider PDFs and load')}</h3>
    {hub.staff.filter(staff => staff.rider).map(rider => {
      const reports = filtered.filter(file => file.rider === rider.id)
      const rows = uniqueParcels(reports)
      const daily = new Map<string, number>()
      for (const key of rows.keys()) {
        const day = key.split(':')[0]
        daily.set(day, (daily.get(day) ?? 0) + 1)
      }
      const days = daily.size
      const peak = [...daily.values()].reduce((highest, count) => Math.max(highest, count), 0)
      const riderAreas = new Set([...rows.values()].flatMap(row => row.area ? [row.area] : []))
      const stops = [...riderAreas].flatMap(id => {
        const place = byId.get(id)
        return place ? [placeToStop(place, lang)] : []
      })
      const limit = c.o?.rules.max_stops ?? 0
      return <div key={rider.id} className="rt-card">
        <strong>{rider.name}</strong>
        {picker(L('রাইডারের PDF যোগ করুন', 'Add rider PDFs'), rider.id)}
        <p>{L('অ্যাসাইন', 'Assigned')} {n(rows.size)} · {L('দিন', 'Days')} {n(days)} · {L('দৈনিক গড় লোড', 'Average daily load')} {days ? n(Math.round(rows.size / days)) : '—'}
          {' · '}{L('সর্বোচ্চ দৈনিক লোড', 'Peak daily load')} {days ? n(peak) : '—'}
          {' · '}{L('PDF-এ দেখা হাবের ইনকামিং এলাকার অংশ', 'Share of observed incoming areas')} {areas.size ? n(Math.round(100 * [...riderAreas].filter(id => areas.has(id)).length / areas.size)) + '%' : '—'}</p>
        <button type="button" className="secondary sm" disabled={!editable || !stops.length}
          onClick={() => c.edit({ hub_id: hub.id, name: rider.name, stops: stops.slice(0, limit) })}>{L('রুটের খসড়া খুলুন', 'Open route draft')}</button>
        {stops.length > limit && <p>{L('খসড়ায় প্রথম', 'Draft includes the first')} {n(limit)} {L('স্টপ থাকবে।', 'stops.')}</p>}
      </div>
    })}
    <h3>{L('আপলোড ইতিহাস', 'Upload history')}</h3>
    <ul>{[...filtered].reverse().map(file => <li key={file.id}>{file.day} · {file.name} · {n(file.rows.length)}
      {file.warning && <> · {L('PDF-এর ঘোষিত সংখ্যায় গরমিল', 'Declared count mismatch')}</>}
      {' '}<button className="secondary sm" type="button" disabled={!editable || busy} onClick={() => {
        setReviewFile(file.id); setReviewParcel(''); setReviewArea(''); setSearch('')
      }}>{L('এলাকা যাচাই', 'Review areas')}</button></li>)}</ul>
    {review && editable && <div className="rt-card">
      <h4>{review.name}</h4>
      <label>{L('অমিল পার্সেল আইডি', 'Unmatched parcel ID')}
        <select value={reviewParcel} onChange={e => setReviewParcel(e.target.value)}>
          <option value="">—</option>
          {review.rows.filter(row => !row.area).map(row => <option key={row.id} value={row.id}>{row.id}</option>)}
        </select>
      </label>
      <label>{L('এলাকার নাম লিখুন', 'Search area name')} <input value={search} onChange={e => { setSearch(e.target.value); setReviewArea('') }} /></label>
      <label>{L('এলাকা বাছুন', 'Pick area')}
        <select value={reviewArea} onChange={e => setReviewArea(e.target.value)}>
          <option value="">—</option>
          {search.trim() && places.filter(place => [place.name, place.name_bn].some(name => normalize(name ?? '').includes(normalize(search))))
            .slice(0, 50).map(place => <option key={place.id} value={place.id}>{placeName(place, lang)}</option>)}
        </select>
      </label>
      <button type="button" disabled={busy || !reviewParcel || !reviewArea} onClick={() => {
        save(files.map(file => file.id === review.id ? { ...file, rows: file.rows.map(row =>
          String(row.id) === reviewParcel ? { ...row, area: reviewArea } : row) } : file))
        setReviewParcel('')
      }}>{L('এলাকা সেভ করুন', 'Save area')}</button>
    </div>}
  </section>
}
