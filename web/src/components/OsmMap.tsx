import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'

/** A small OpenStreetMap view without any library: tiles, pins, zoom, drag, tap-to-pick. */
export type MapPin = { id: string; lat: number; lng: number; label: string; tone?: 'ok' | 'off' | 'wait' | 'sel' }

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

export function OsmMap({ pins, height = 340, selected, onSelect, onPick, focus }: {
  pins: MapPin[]; height?: number; selected?: string | null; onSelect?: (id: string) => void
  onPick?: (lat: number, lng: number) => void; focus?: { lat: number; lng: number } | null
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
  const key = pins.map(p => `${p.lat},${p.lng}`).join('|')
  useEffect(() => {
    if (focus) { setView({ z: 15, lat: focus.lat, lng: focus.lng }); return }
    if (!pins.length) { setView({ z: 9, lat: 24.42, lng: 89.0 }); return }
    const lats = pins.map(p => p.lat), lngs = pins.map(p => p.lng)
    const [a, b, c, d] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)]
    let z = 16
    while (z > 3 && (wx(d, z) - wx(c, z) > w - 60 || wy(a, z) - wy(b, z) > height - 60)) z--
    setView({ z, lat: (a + b) / 2, lng: (c + d) / 2 })
  }, [key, focus?.lat, focus?.lng, w, height])

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
    if ((e.target as HTMLElement).closest('.osm-pin,.osm-ctl')) return
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
    {groups.map(g => {
      const p = g[0]; const sel = g.some(x => x.id === selected)
      return <button key={p.id} type="button" className={`osm-pin t-${sel ? 'sel' : p.tone ?? 'ok'}`} title={g.map(x => x.label).join(', ')}
        style={{ left: wx(p.lng, z) - left, top: wy(p.lat, z) - top }} onClick={() => onSelect?.(g.find(x => x.id !== selected)?.id ?? p.id)}>
        <span className="dot" /><span className="tag">{g.map(x => x.label).join(' · ')}</span>
      </button>
    })}
    <div className="osm-ctl"><button type="button" onClick={() => zoom(1)} aria-label="বড়">+</button><button type="button" onClick={() => zoom(-1)} aria-label="ছোট">−</button></div>
    <a className="osm-attr" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
  </div>
}

export const gmapLink = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`
export const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v))
export const gps = (v: unknown) => { const x = num(v); return x === null ? '' : x.toFixed(7) }
