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

export function OsmMap({ pins, height = 340, selected, onSelect, onPick, focus, lines = [], circles = [], tags = 'all' }: {
  pins: MapPin[]; height?: number; selected?: string | null; onSelect?: (id: string) => void
  onPick?: (lat: number, lng: number) => void; focus?: { lat: number; lng: number } | null
  lines?: MapLine[]; circles?: MapCircle[]; tags?: 'all' | 'selected'
}) {
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(360)
  const [view, setView] = useState<{ z: number; lat: number; lng: number } | null>(null)
  const drag = useRef<{ x: number; y: number; moved: boolean; cx: number; cy: number } | null>(null)

  useEffect(() => {
    const el = box.current; if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth || 360)); ro.observe(el); setW(el.clientWidth || 360)
    return () => ro.disconnect()
  }, [])

  // Fit all pins once (and whenever the focus point changes).
  const fitPts = [...pins.map(p => [p.lat, p.lng] as [number, number]), ...lines.flatMap(l => l.points.length > 2 ? [l.points[0], l.points[l.points.length - 1]] : l.points)]
  const key = fitPts.map(p => `${p[0]},${p[1]}`).join('|')
  const [refit, setRefit] = useState(0)
  useEffect(() => {
    if (focus) { setView({ z: 15, lat: focus.lat, lng: focus.lng }); return }
    if (!fitPts.length) { setView({ z: 9, lat: 24.42, lng: 89.0 }); return }
    const lats = fitPts.map(p => p[0]), lngs = fitPts.map(p => p[1])
    const [a, b, c, d] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)]
    let z = 16
    while (z > 3 && (wx(d, z) - wx(c, z) > w - 60 || wy(a, z) - wy(b, z) > height - 60)) z--
    setView({ z, lat: (a + b) / 2, lng: (c + d) / 2 })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, focus?.lat, focus?.lng, w, height, refit])

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

  const zoom = (dz: number) => setView(v => v && { ...v, z: Math.max(3, Math.min(18, v.z + dz)) })
  function down(e: RPointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('.osm-pin,.osm-ctl,.osm-attr')) return
    drag.current = { x: e.clientX, y: e.clientY, moved: false, cx, cy }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function move(e: RPointerEvent<HTMLDivElement>) {
    const d = drag.current; if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
    if (d.moved) setView({ z, lng: lngOf(d.cx - dx, z), lat: latOf(d.cy - dy, z) })
  }
  function up(e: RPointerEvent<HTMLDivElement>) {
    const d = drag.current; drag.current = null
    if (!d || d.moved || !onPick) return
    const r = e.currentTarget.getBoundingClientRect()
    onPick(+latOf(top + e.clientY - r.top, z).toFixed(7), +lngOf(left + e.clientX - r.left, z).toFixed(7))
  }

  return <div ref={box} className={`osm${onPick ? ' pick' : ''}`} style={{ height }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null }}>
    {tiles.map(t => <img key={`${z}/${t.x}/${t.y}`} alt="" draggable={false} className="osm-tile"
      src={`https://tile.openstreetmap.org/${z}/${((t.x % n) + n) % n}/${t.y}.png`}
      style={{ left: t.x * T - left, top: t.y * T - top }} />)}
    {(lines.length > 0 || circles.length > 0) && <svg className="osm-svg" width={w} height={height} viewBox={`0 0 ${w} ${height}`}>
      {circles.map(c => { const mpp = (156543.03392 * Math.cos((c.lat * Math.PI) / 180)) / 2 ** z
        return <circle key={c.id} cx={wx(c.lng, z) - left} cy={wy(c.lat, z) - top} r={Math.max(c.m / mpp, 4)} fill={c.color} fillOpacity=".14" stroke={c.color} strokeWidth="1.5" /> })}
      {lines.map(l => l.points.length > 1 && <polyline key={l.id} fill="none" stroke={l.color} strokeWidth={l.width ?? 4} strokeOpacity={l.opacity ?? 0.85}
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
