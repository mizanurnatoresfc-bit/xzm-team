import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'

/** A small OpenStreetMap view without any library: tiles, pins, zoom, drag, tap-to-pick. */
export type MapPin = { id: string; lat: number; lng: number; label: string; tone?: 'ok' | 'off' | 'wait' | 'sel'
  /** a numbered round badge (route stops) instead of the drop pin; `color` fills it, `square` marks a start (hub) */
  num?: string; color?: string; square?: boolean }
/** Lines drawn under the pins (route path), points as [lat, lng]. */
export type MapLine = { id: string; color: string; points: Array<[number, number]>; dashed?: boolean; width?: number; opacity?: number }
/** A circle of a real size in metres (a stop's reach radius, the phone's location accuracy). */
export type MapCircle = { id: string; lat: number; lng: number; m: number; color: string }

const T = 256
const wx = (lng: number, z: number) => ((lng + 180) / 360) * T * 2 ** z
const wy = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * T * 2 ** z
}
const lngOf = (x: number, z: number) => (x / (T * 2 ** z)) * 360 - 180
const latOf = (y: number, z: number) => {
  const n = Math.PI - (2 * Math.PI * y) / (T * 2 ** z)
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

export function OsmMap({ pins, height: wanted = 340, selected, onSelect, onPick, focus, lines = [], circles = [], tags = 'all', keepView = false, fitKey }: {
  pins: MapPin[]; height?: number; selected?: string | null; onSelect?: (id: string) => void
  onPick?: (lat: number, lng: number) => void; focus?: { lat: number; lng: number } | null
  lines?: MapLine[]; circles?: MapCircle[]; tags?: 'all' | 'selected'
  /** Editing maps: fit everything once, then leave the zoom and place alone while pins come and go (⤢ or a new `fitKey` fits again). */
  keepView?: boolean; fitKey?: string | number
}) {
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  const [view, setView] = useState<{ z: number; lat: number; lng: number } | null>(null)
  const drag = useRef<{ x: number; y: number; moved: boolean; cx: number; cy: number } | null>(null)
  const ptrs = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number } | null>(null)
  const multi = useRef(false)
  // On a phone the map never takes the whole screen, so the page can still be scrolled beside it.
  const height = w > 0 && w < 480 && typeof window !== 'undefined' ? Math.max(220, Math.min(wanted, Math.round(window.innerHeight * 0.58))) : wanted
  const size = useRef({ w: 360, h: height }); size.current = { w: w || 360, h: height }

  /** Zoom by `dz` steps, keeping the point under (px, py) — the pointer or the fingers — where it is. */
  const zoomAt = (dz: number, px?: number, py?: number) => setView(v => {
    if (!v) return v
    const z2 = Math.max(3, Math.min(18, v.z + dz)); if (z2 === v.z) return v
    const { w: W, h: H } = size.current
    const ox = (px ?? W / 2) - W / 2, oy = (py ?? H / 2) - H / 2, f = 2 ** (z2 - v.z)
    return { z: z2, lng: lngOf((wx(v.lng, v.z) + ox) * f - ox, z2), lat: latOf((wy(v.lat, v.z) + oy) * f - oy, z2) }
  })

  useEffect(() => {
    const el = box.current; if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth || 360)); ro.observe(el); setW(el.clientWidth || 360)
    // The mouse wheel zooms at the pointer (a native listener: React's own wheel listener cannot stop the page from scrolling).
    let acc = 0
    const wheel = (e: WheelEvent) => {
      e.preventDefault(); acc += e.deltaY
      if (Math.abs(acc) < 60) return
      const r = el.getBoundingClientRect(); zoomAt(acc < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top); acc = 0
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => { ro.disconnect(); el.removeEventListener('wheel', wheel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fit everything (pins and whole lines). A plain map fits again whenever its pins change; an editing map (keepView) only once.
  const key = [...pins.map(p => `${p.lat},${p.lng}`), ...lines.map(l => `${l.id}:${l.points.length}:${l.points[0]?.join(',') ?? ''}:${l.points[l.points.length - 1]?.join(',') ?? ''}`)].join('|')
  const [refit, setRefit] = useState(0)
  const fitted = useRef<{ refit: number; fitKey: string | number | undefined } | null>(null)
  useEffect(() => {
    if (!w) return
    const first = !fitted.current
    if (keepView && fitted.current && fitted.current.refit === refit && fitted.current.fitKey === fitKey) return
    const asked = !!fitted.current && (fitted.current.refit !== refit || fitted.current.fitKey !== fitKey)
    fitted.current = { refit, fitKey }
    if (focus && !asked) { if (first) setView({ z: 15, lat: focus.lat, lng: focus.lng }); return }
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity
    const see = (lat: number, lng: number) => { if (!isFinite(lat) || !isFinite(lng)) return; a = Math.min(a, lat); b = Math.max(b, lat); c = Math.min(c, lng); d = Math.max(d, lng) }
    pins.forEach(p => see(p.lat, p.lng)); lines.forEach(l => l.points.forEach(p => see(Number(p?.[0]), Number(p?.[1]))))
    if (!isFinite(a)) { setView({ z: 9, lat: 24.42, lng: 89.0 }); return }
    let z = 16
    while (z > 3 && (wx(d, z) - wx(c, z) > w - 60 || wy(a, z) - wy(b, z) > height - 60)) z--
    setView({ z, lat: (a + b) / 2, lng: (c + d) / 2 })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, w, height, refit, keepView, fitKey])
  // A new focus point (a found place, "my location") moves the map there; nothing else brings it back.
  const seenFocus = useRef<string | null>(null)
  useEffect(() => {
    const k = focus ? `${focus.lat},${focus.lng}` : null
    if (k === seenFocus.current) return
    const was = seenFocus.current; seenFocus.current = k
    if (focus && (was !== null || fitted.current)) setView({ z: 15, lat: focus.lat, lng: focus.lng })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.lat, focus?.lng, w])

  // Same GPS → one pin listing every hub there (they stay separate hubs).
  const groups = useMemo(() => {
    const m = new Map<string, MapPin[]>()
    for (const p of pins) { const k = `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`; m.set(k, [...(m.get(k) ?? []), p]) }
    return [...m.values()]
  }, [pins])

  if (!view) return <div ref={box} className="osm" style={{ height }} />
  const { z } = view
  const cx = wx(view.lng, z), cy = wy(view.lat, z)
  const left = cx - w / 2, top = cy - height / 2
  const tiles: Array<{ x: number; y: number }> = []
  const n = 2 ** z
  for (let tx = Math.floor(left / T); tx <= Math.floor((left + w) / T); tx++)
    for (let ty = Math.floor(top / T); ty <= Math.floor((top + height) / T); ty++)
      if (ty >= 0 && ty < n) tiles.push({ x: tx, y: ty })

  const zoom = (dz: number) => zoomAt(dz)
  const spread = () => { const [p, q] = [...ptrs.current.values()]; return { d: Math.hypot(p.x - q.x, p.y - q.y), x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } }
  function down(e: RPointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('.osm-pin,.osm-ctl,.osm-attr')) return
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    e.currentTarget.setPointerCapture(e.pointerId)
    // two fingers: zoom, and this touch is neither a drag nor a tap
    if (ptrs.current.size === 2) { drag.current = null; multi.current = true; pinch.current = { d: spread().d }; return }
    if (ptrs.current.size > 2) return
    drag.current = { x: e.clientX, y: e.clientY, moved: false, cx, cy }
  }
  function move(e: RPointerEvent<HTMLDivElement>) {
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current && ptrs.current.size === 2) {
      const s = spread(), ratio = s.d / Math.max(pinch.current.d, 1)
      if (ratio > 1.5 || ratio < 0.67) { const r = e.currentTarget.getBoundingClientRect(); zoomAt(ratio > 1 ? 1 : -1, s.x - r.left, s.y - r.top); pinch.current = { d: s.d } }
      return
    }
    const d = drag.current; if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
    if (d.moved) setView({ z, lng: lngOf(d.cx - dx, z), lat: latOf(d.cy - dy, z) })
  }
  function up(e: RPointerEvent<HTMLDivElement>) {
    ptrs.current.delete(e.pointerId)
    if (ptrs.current.size < 2) pinch.current = null
    const d = drag.current; drag.current = null
    if (multi.current) { if (!ptrs.current.size) multi.current = false; return }
    if (!d || d.moved || !onPick) return
    const r = e.currentTarget.getBoundingClientRect()
    onPick(+latOf(top + e.clientY - r.top, z).toFixed(7), +lngOf(left + e.clientX - r.left, z).toFixed(7))
  }

  return <div ref={box} className={`osm${onPick ? ' pick' : ''}`} style={{ height }} onPointerDown={down} onPointerMove={move} onPointerUp={up}
    onPointerCancel={e => { ptrs.current.delete(e.pointerId); if (ptrs.current.size < 2) pinch.current = null; if (!ptrs.current.size) multi.current = false; drag.current = null }}
    onDoubleClick={onPick ? undefined : e => { if ((e.target as HTMLElement).closest('.osm-pin,.osm-ctl,.osm-attr')) return
      const r = e.currentTarget.getBoundingClientRect(); zoomAt(1, e.clientX - r.left, e.clientY - r.top) }}>
    {tiles.map(t => <img key={`${z}/${t.x}/${t.y}`} alt="" draggable={false} className="osm-tile"
      src={`https://tile.openstreetmap.org/${z}/${((t.x % n) + n) % n}/${t.y}.png`}
      style={{ left: t.x * T - left, top: t.y * T - top }} />)}
    {(lines.length > 0 || circles.length > 0) && <svg className="osm-svg" width={w} height={height} viewBox={`0 0 ${w} ${height}`}>
      {circles.map(c => { const mpp = (156543.03392 * Math.cos((c.lat * Math.PI) / 180)) / 2 ** z
        return <circle key={c.id} cx={wx(c.lng, z) - left} cy={wy(c.lat, z) - top} r={Math.max(c.m / mpp, 4)} fill={c.color} fillOpacity=".14" stroke={c.color} strokeWidth="1.5" /> })}
      {lines.map(l => ({ ...l, points: l.points.filter(p => Array.isArray(p) && isFinite(Number(p[0])) && isFinite(Number(p[1]))) })).map(l => l.points.length > 1 && <polyline key={l.id} fill="none" stroke={l.color} strokeWidth={l.width ?? 4} strokeOpacity={l.opacity ?? 0.85}
        strokeLinecap="round" strokeLinejoin="round" strokeDasharray={l.dashed ? '7 7' : undefined}
        points={l.points.map(([la, ln]) => `${(wx(ln, z) - left).toFixed(1)},${(wy(la, z) - top).toFixed(1)}`).join(' ')} />)}
    </svg>}
    {groups.map(g => {
      const p = g[0]; const sel = g.some(x => x.id === selected)
      const showTag = tags === 'all' || sel
      return <button key={p.id} type="button" className={`osm-pin t-${sel ? 'sel' : p.tone ?? 'ok'}${p.num !== undefined ? ' num' : ''}${p.square ? ' sq' : ''}`} title={g.map(x => x.label).join(', ')}
        style={{ left: wx(p.lng, z) - left, top: wy(p.lat, z) - top }} onClick={() => onSelect?.(g.find(x => x.id !== selected)?.id ?? p.id)}>
        {p.num !== undefined ? <span className="badge" style={p.color ? { background: p.color } : undefined}>{g.map(x => x.num).join('·')}</span> : <span className="dot" />}
        {showTag && <span className="tag">{g.map(x => x.label).join(' · ')}</span>}
      </button>
    })}
    <div className="osm-ctl"><button type="button" onClick={() => zoom(1)} aria-label="বড়">+</button><button type="button" onClick={() => zoom(-1)} aria-label="ছোট">−</button>
      <button type="button" onClick={() => setRefit(x => x + 1)} aria-label="সব দেখান" title="সব দেখান">⤢</button></div>
    <a className="osm-attr" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
  </div>
}

export const gmapLink = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`
export const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v))
export const gps = (v: unknown) => { const x = num(v); return x === null ? '' : x.toFixed(7) }
