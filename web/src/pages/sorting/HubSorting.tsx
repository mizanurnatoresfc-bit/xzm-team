import { useEffect, useState } from 'react'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { RouteViz } from '../../components/RouteViz'
import { hrFriendly } from '../../lib/hr'
import { usePrefs } from '../../lib/prefs'
import { REPORT_KIND, REPORT_STATUS, ROUTE_KIND, sorting, telHref, type FullRoute, type ReportKind } from '../../lib/sorting'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'
import { AnalysisBox, CrewList, RoutesMap, startPoint } from './routeParts'

/**
 * হাব ↔ শটিং — for a hub's managers AND staff: the sorting routes that come to the hub with the people on them
 * (name and number, tap to call), the center's instructions, and "রিপোর্ট টু শটিং" with parcel photos or text.
 * Staff open their own hub (by their employee record); managers may pick any hub they manage.
 */
const KEY = 'xzm_hub_sorting'
const MAX_PHOTOS = 6

/** Phone photos are large: make them at most 1600 px JPEG before upload. */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.size < 600_000) return file
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/jpeg', 0.82))
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file
  } catch { return file }
}

export function HubSorting() {
  const { L, n, lang } = usePrefs()
  const { toast, node } = useToast()
  const hubs = useLoad(() => sorting.panelHubs(), [])
  const [hub, setHub] = useState(() => { try { return sessionStorage.getItem(KEY) || '' } catch { return '' } })
  useEffect(() => {
    const list = hubs.data ?? []
    if (list.length && (!hub || !list.some(h => h.hub_id === hub))) setHub(list[0].hub_id)
  }, [hubs.data, hub])
  useEffect(() => { try { if (hub) sessionStorage.setItem(KEY, hub) } catch { /* ignore */ } }, [hub])
  const p = useLoad(() => hubs.data ? sorting.hubPanel(hub || null) : Promise.resolve(null), [hub, hubs.data])
  const v = p.data
  const urls = useLoad(() => sorting.reportPhotoUrls((v?.reports ?? []).flatMap(r => r.photos)).catch(() => ({} as Record<string, string>)), [v])
  const mine = (v?.routes ?? []).filter(r => r.mine)
  const others = (v?.routes ?? []).filter(r => !r.mine)
  const start = startPoint(v?.center, v?.routes ?? [])

  type F = { kind: ReportKind; route: string; body: string; tracking: string; parcels: string; files: File[] }
  const [f, setF] = useState<F | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const [mapOn, setMapOn] = useState(false)
  async function send() {
    if (!f || !v) return
    if (!f.body.trim() && !f.files.length) return setErr(L('কী হয়েছে লিখুন বা ছবি দিন', 'Write what happened or add a photo'))
    setBusy(true); setErr('')
    try {
      const photos: string[] = []
      for (const file of f.files) photos.push(await sorting.uploadReportPhoto(await shrink(file)))
      const cnt = f.parcels.trim() === '' ? null : Number(f.parcels)
      await sorting.submitReport({ hub: v.hub.id, kind: f.kind, body: f.body.trim() || null, photos, tracking: f.tracking.trim() || null,
        parcels: cnt !== null && !Number.isNaN(cnt) ? cnt : null, route: f.route || null })
      setF(null); await p.reload(); toast(L('শটিংয়ে রিপোর্ট পাঠানো হয়েছে', 'Report sent to sorting'))
    } catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  const when = (t: string) => new Date(t).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  const times = (r: FullRoute) => [r.depart_time && `${L('শটিং ছাড়ে', 'Leaves sorting')} ${r.depart_time.slice(0, 5)}`, r.return_time && `${L('ফেরে', 'Back')} ${r.return_time.slice(0, 5)}`].filter(Boolean).join(' · ')

  return <AppShell title={L('শটিং রুট ও রিপোর্ট', 'Sorting routes & reports')} subtitle={v ? `${v.hub.name}${v.center ? ` · ${v.center.name}` : ''}` : undefined}>
    <div className="hs">{node}
      {(hubs.data?.length ?? 0) > 1 && <section className="da-filters panel no-print hub-top">
        <Field label={L('হাব', 'Hub')}><select value={hub} onChange={e => setHub(e.target.value)}>
          {hubs.data!.map(h => <option key={h.hub_id} value={h.hub_id}>{h.hub_name}{h.mine ? ` (${L('আমার হাব', 'my hub')})` : ''}</option>)}</select></Field></section>}
      {hubs.error || p.error ? <p className="da-error">{hrFriendly(hubs.error || p.error)}</p>
      : hubs.data && !hubs.data.length ? <p className="notice">{L('আপনার হাব পাওয়া যায়নি, অথবা হাবটি এখনো কোনো শটিং সেন্টারের সাথে যুক্ত নয়।', 'Your hub was not found, or it is not linked to a sorting center yet.')}</p>
      : !v ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>
      : <>
        {v.center ? <div className="hs-center">
            <span className="i"><Icon name="hub" size={22} /></span>
            <div className="tx"><small>{L('আপনার শটিং সেন্টার', 'Your sorting center')}</small><b>{v.center.name}</b>{v.center.address && <span>{v.center.address}</span>}</div>
            {v.center.phone && <a className="crew-call" href={telHref(v.center.phone)}><Icon name="phone" size={14} />{v.center.phone}</a>}
          </div>
          : <p className="notice">{L('এই হাব এখনো কোনো শটিং সেন্টারে এসাইন নেই — জোনাল ম্যানেজারকে জানান।', 'This hub is not assigned to a sorting center yet — tell your zonal manager.')}</p>}

        {v.center && <button type="button" className="sp-cta hs-cta" onClick={() => { setErr(''); setF({ kind: 'wrong', route: mine[0]?.id ?? '', body: '', tracking: '', parcels: '', files: [] }) }}>
          <Icon name="upload" size={20} />{L('শটিংকে রিপোর্ট দিন — ছবি বা লিখে', 'Report to sorting — photo or text')}</button>}

        <h2 className="sd-h">{L('আমার হাবের রুট ও লোকজন', 'My hub’s routes & people')}</h2>
        {!mine.length ? <p className="muted">{L('এই হাবে থামে এমন কোনো রুট এখনো দেওয়া হয়নি।', 'No route stops at this hub yet.')}</p>
        : mine.map(r => { const st = r.stops.find(s => s.hub_id === v.hub.id)
          const here = r.crew.filter(c => st && c.stop_id === st.id), wide = r.crew.filter(c => !c.stop_id)
          return <article key={r.id} className="route-card hs-route">
            <header><span className="ti"><Icon name={r.kind === 'linehaul' ? 'truck' : 'map'} size={18} /></span>
              <div style={{ flex: 1, minWidth: 0 }}><b>{r.name}</b><div className="muted small">{[L(ROUTE_KIND[r.kind][0], ROUTE_KIND[r.kind][1]), r.vehicle, times(r)].filter(Boolean).join(' · ')}</div></div>
              {st?.arrive_time && <span className="hs-eta"><small>{L('আপনার হাবে', 'At your hub')}</small><b>{st.arrive_time.slice(0, 5)}</b></span>}</header>
            {(r.instructions || st?.instructions) && <div className="route-note"><Icon name="note" size={14} /><div>
              {r.instructions && <div>{r.instructions}</div>}{st?.instructions && <div><b>{L('আপনার হাবের জন্য:', 'For your hub:')}</b> {st.instructions}</div>}</div></div>}
            {here.length > 0 && <div><small className="muted">{L('আপনার হাবের দায়িত্বে', 'For your hub')}</small><CrewList crew={here} /></div>}
            <div><small className="muted">{L('রুটের লোক (ড্রাইভার, হেল্পার, ম্যানেজার)', 'Route people (driver, helper, manager)')}</small><CrewList crew={wide} /></div>
            <RouteViz start={v.center?.name ?? L('শটিং', 'Sorting')} lanes={[{ id: r.id, code: r.code, name: r.name,
              stops: r.stops.map(s => ({ id: s.id, label: s.label, tone: s.hub_id === v.hub.id ? 'warn' as const : undefined,
                flag: s.hub_id === v.hub.id ? L('আপনার হাব', 'Your hub') : s.arrive_time?.slice(0, 5) })) }]} />
            <AnalysisBox route={r} start={start} compact />
          </article> })}

        {others.length > 0 && <>
          <h2 className="sd-h">{L('সেন্টারের অন্য রুট — নির্দেশনা ও বিস্তারিত', 'The center’s other routes — instructions & details')}</h2>
          {others.map(r => <details key={r.id} className="hs-more"><summary><b>{r.name}</b><span className="muted small">{[r.stops.map(s => s.label).join(' → '), times(r)].filter(Boolean).join(' · ')}</span></summary>
            {r.instructions && <p className="route-note"><Icon name="note" size={14} />{r.instructions}</p>}
            <CrewList crew={r.crew.filter(c => !c.stop_id)} />
          </details>)}
        </>}

        {(v.routes.length > 0) && <div className="row-acts" style={{ margin: '12px 0' }}>
          <button type="button" className="secondary" onClick={() => setMapOn(!mapOn)}><Icon name="map" size={15} />{mapOn ? L('ম্যাপ বন্ধ', 'Hide map') : L('সব রুট ম্যাপে দেখুন', 'See all routes on the map')}</button></div>}
        {mapOn && <section className="panel"><RoutesMap center={v.center} routes={v.routes} highlightHub={v.hub.id} height={320} /></section>}

        <h2 className="sd-h">{L('হাব টু শটিং রিপোর্ট', 'Hub to sorting reports')}</h2>
        {!v.reports.length ? <p className="muted">{L('এখনো কোনো রিপোর্ট দেওয়া হয়নি।', 'No reports yet.')}</p>
        : <div className="rep-list">{v.reports.map(r => <article key={r.id} className="rep-card">
            <header><span className={`rep-ic k-${r.kind}`}><Icon name={REPORT_KIND[r.kind][2]} size={16} /></span>
              <div className="rep-h"><b>{L(REPORT_KIND[r.kind][0], REPORT_KIND[r.kind][1])}{r.parcel_count != null ? ` · ${n(r.parcel_count)} ${L('টি', '')}` : ''}</b>
                <small className="muted">#{r.no} · {when(r.created_at)}{r.reporter_name ? ` · ${r.reporter_name}` : ''}{r.route_name ? ` · ${r.route_name}` : ''}</small></div>
              <Badge tone={REPORT_STATUS[r.status][2]}>{L(REPORT_STATUS[r.status][0], REPORT_STATUS[r.status][1])}</Badge></header>
            {r.body && <p className="pre-wrap">{r.body}</p>}
            {r.tracking && <p className="muted small">{L('ট্র্যাকিং', 'Tracking')}: {r.tracking}</p>}
            {r.photos.length > 0 && <div className="rep-photos">{r.photos.map(ph => urls.data?.[ph] ? <a key={ph} href={urls.data[ph]} target="_blank" rel="noreferrer"><img src={urls.data[ph]} alt={L('পার্সেলের ছবি', 'Parcel photo')} loading="lazy" /></a>
              : <span key={ph} className="rep-ph-wait"><Icon name="eye" size={16} /></span>)}</div>}
            {r.reply && <p className="rep-reply"><b>{L('শটিংয়ের উত্তর', 'Sorting replied')}{r.replied_by_name ? ` (${r.replied_by_name})` : ''}:</b> {r.reply}</p>}
          </article>)}</div>}
      </>}
    </div>

    {f && v && <Modal title={L('শটিংকে রিপোর্ট', 'Report to sorting')} onClose={() => setF(null)}
      actions={<><button className="secondary" onClick={() => setF(null)}>{L('বাতিল', 'Cancel')}</button>
        <button disabled={busy} onClick={() => void send()}>{busy ? L('পাঠানো হচ্ছে…', 'Sending…') : L('পাঠান', 'Send')}</button></>}>
      <div className="rep-kinds">{(Object.keys(REPORT_KIND) as ReportKind[]).map(k => <button key={k} type="button" className={f.kind === k ? 'sm' : 'secondary sm'} onClick={() => setF({ ...f, kind: k })}>
        <Icon name={REPORT_KIND[k][2]} size={14} />{L(REPORT_KIND[k][0], REPORT_KIND[k][1])}</button>)}</div>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label={L('কোন রুটের গাড়ি', 'Which route')}><select value={f.route} onChange={e => setF({ ...f, route: e.target.value })}><option value="">—</option>
          {v.routes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <Field label={L('কয়টা পার্সেল', 'How many parcels')}><input inputMode="numeric" value={f.parcels} onChange={e => setF({ ...f, parcels: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label={L('কী হয়েছে', 'What happened')} wide><textarea rows={3} autoFocus value={f.body} onChange={e => setF({ ...f, body: e.target.value })}
          placeholder={L('যেমন: আজ সকালের ব্যাগে ৩টা পার্সেল অন্য হাবের এসেছে', 'e.g. 3 parcels in this morning’s bag belong to another hub')} /></Field>
        <Field label={L('ট্র্যাকিং / কনসাইনমেন্ট নম্বর', 'Tracking / consignment numbers')} wide><input value={f.tracking} onChange={e => setF({ ...f, tracking: e.target.value })} placeholder={L('কমা দিয়ে আলাদা করুন', 'separate with commas')} /></Field>
        <Field label={L(`পার্সেলের ছবি (সর্বোচ্চ ${n(MAX_PHOTOS)}টি)`, `Parcel photos (up to ${MAX_PHOTOS})`)} wide hint={f.files.length ? L(`${n(f.files.length)}টি ছবি বাছা হয়েছে`, `${f.files.length} photos chosen`) : undefined}>
          <input type="file" accept="image/*" multiple onChange={e => setF({ ...f, files: [...f.files, ...Array.from(e.target.files ?? [])].slice(0, MAX_PHOTOS) })} /></Field>
      </div>
      {f.files.length > 0 && <div className="rep-photos">{f.files.map((x, i) => <span key={i} className="rep-ph-new"><img src={URL.createObjectURL(x)} alt="" />
        <button type="button" className="secondary sm" aria-label={L('সরান', 'Remove')} onClick={() => setF({ ...f, files: f.files.filter((_, j) => j !== i) })}><Icon name="x" size={12} /></button></span>)}</div>}
      <p className="muted small">{L('শটিং সেন্টারের দায়িত্বে যারা আছেন তারা সাথে সাথে নোটিফিকেশন পাবেন। উত্তর দিলে এখানে দেখাবে।', 'The sorting center’s people are notified at once. Their reply shows here.')}</p>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </AppShell>
}
