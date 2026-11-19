import { useState, type ReactNode } from 'react'
import { Icon } from '../../components/Icon'
import { usePrefs } from '../../lib/prefs'
import { ASSET_KIND, CONDITION, DIR, DIR_GRID, ROOM_KIND, type Asset, type Desk, type Room } from '../../lib/office'
import type { Ctx } from './OfficeOps'

/**
 * বাস্তব মোড — the office drawn like a real floor plan, seen from above:
 * walls, floors (tiles, wood, concrete…), the front door, every desk with its monitor/PC/chair and the person sitting there,
 * fans that turn, bulbs that glow, AC, cylinder, bed… Broken things are greyed with a red mark, lost ones are a faint outline.
 * "রাত" switches the lights off: only rooms with a working bulb stay lit.
 * Everything is drawn from the same rows as the map (rooms, desks, assets) — nothing extra is stored.
 */

// ---------------------------------------------------------------- the drawings (48×48)
const ART: Record<string, ReactNode> = {
  fan: <><g className="ofr-spin">{[0, 120, 240].map(a => <ellipse key={a} cx="24" cy="11" rx="4.2" ry="11" fill="#8b5a2b" stroke="#5c3a1a" strokeWidth=".8" transform={`rotate(${a} 24 24)`} />)}</g>
    <circle cx="24" cy="24" r="5.5" fill="#e5e7eb" stroke="#6b7280" strokeWidth="1.2" /><circle cx="24" cy="24" r="2" fill="#9ca3af" /></>,
  light: <><circle className="ofr-halo" cx="24" cy="24" r="22" fill="url(#ofr-glow)" /><circle cx="24" cy="24" r="9.5" fill="#fffbeb" stroke="#f59e0b" strokeWidth="1.6" />
    <path d="M21 22h6M21 25h6" stroke="#f59e0b" strokeWidth="1.2" strokeLinecap="round" /></>,
  ac: <><rect x="3" y="12" width="42" height="15" rx="3.5" fill="#f8fafc" stroke="#94a3b8" strokeWidth="1.3" />
    <path d="M7 22h34M7 24.5h34" stroke="#cbd5e1" strokeWidth="1" /><circle cx="39" cy="16.5" r="1.4" fill="#22c55e" />
    <path className="ofr-air" d="M12 31c2 3 0 6 2 9M24 31c2 3 0 6 2 9M36 31c2 3 0 6 2 9" stroke="#7dd3fc" strokeWidth="1.6" fill="none" strokeLinecap="round" /></>,
  cctv: <><rect x="8" y="6" width="5" height="10" rx="1" fill="#9ca3af" /><rect x="9" y="14" width="26" height="13" rx="3" fill="#f3f4f6" stroke="#6b7280" strokeWidth="1.2" transform="rotate(18 22 20)" />
    <circle cx="33" cy="26" r="4.5" fill="#111827" /><circle cx="33" cy="26" r="2" fill="#1e3a8a" /><circle className="ofr-blink" cx="16" cy="19" r="1.6" fill="#ef4444" /></>,
  monitor: <><rect x="5" y="7" width="38" height="25" rx="2.5" fill="#111827" /><rect x="7.5" y="9.5" width="33" height="20" rx="1" fill="url(#ofr-screen)" />
    <path d="M10 14h14M10 18h20M10 22h10" stroke="#e0f2fe" strokeWidth="1.3" opacity=".7" strokeLinecap="round" /><path d="M21 32h6l2 7H19z" fill="#374151" /><rect x="14" y="39" width="20" height="3" rx="1.5" fill="#4b5563" /></>,
  pc: <><rect x="13" y="4" width="22" height="40" rx="2.5" fill="#1f2937" stroke="#0b0f19" /><rect x="16" y="8" width="16" height="3" rx="1" fill="#374151" />
    <rect x="16" y="13" width="16" height="3" rx="1" fill="#374151" /><circle cx="24" cy="36" r="2.4" fill="none" stroke="#60a5fa" strokeWidth="1.4" /><circle className="ofr-blink slow" cx="24" cy="36" r="1" fill="#60a5fa" /></>,
  keyboard: <><rect x="2" y="16" width="44" height="16" rx="2.5" fill="#d1d5db" stroke="#6b7280" />
    {[0, 1, 2].map(r => Array.from({ length: 10 }, (_, c) => <rect key={`${r}${c}`} x={4.5 + c * 4} y={18.5 + r * 3.6} width="3" height="2.6" rx=".5" fill="#f9fafb" />))}
    <rect x="12" y="29" width="24" height="1.8" rx=".6" fill="#f9fafb" /></>,
  mouse: <><path d="M24 12v8" stroke="#6b7280" strokeWidth="1.3" /><rect x="15" y="14" width="18" height="26" rx="9" fill="#e5e7eb" stroke="#6b7280" strokeWidth="1.2" />
    <path d="M24 14v10M15.5 24h17" stroke="#9ca3af" strokeWidth="1" /></>,
  printer: <><rect x="12" y="6" width="24" height="12" fill="#fff" stroke="#9ca3af" /><rect x="4" y="16" width="40" height="18" rx="3" fill="#6b7280" />
    <rect x="4" y="16" width="40" height="5" rx="2" fill="#9ca3af" /><rect x="11" y="30" width="26" height="12" fill="#fff" stroke="#9ca3af" />
    <path d="M14 34h20M14 37h14" stroke="#cbd5e1" /><circle cx="38" cy="25" r="1.6" fill="#22c55e" /></>,
  laptop: <><path d="M9 8h30a2 2 0 0 1 2 2v20H7V10a2 2 0 0 1 2-2z" fill="#374151" /><rect x="10" y="11" width="28" height="16" fill="url(#ofr-screen)" />
    <path d="M3 31h42l-3 6H6z" fill="#9ca3af" /><rect x="20" y="32" width="8" height="1.6" rx=".8" fill="#6b7280" /></>,
  ups: <><rect x="10" y="6" width="28" height="38" rx="3" fill="#111827" /><rect x="15" y="11" width="18" height="8" rx="1" fill="#14532d" />
    <text x="24" y="17.5" textAnchor="middle" fontSize="6" fill="#4ade80" fontFamily="monospace">230V</text><circle cx="24" cy="32" r="3.5" fill="none" stroke="#22c55e" strokeWidth="1.5" /></>,
  router: <><path d="M14 20 10 5M34 20l4-15" stroke="#374151" strokeWidth="2.2" strokeLinecap="round" /><rect x="5" y="20" width="38" height="14" rx="4" fill="#f9fafb" stroke="#9ca3af" />
    {[0, 1, 2, 3].map(i => <circle key={i} className={`ofr-blink d${i}`} cx={13 + i * 7} cy="27" r="1.6" fill="#22c55e" />)}</>,
  scanner: <><rect x="3" y="18" width="42" height="16" rx="3" fill="#9ca3af" /><rect x="3" y="14" width="42" height="7" rx="2.5" fill="#d1d5db" stroke="#6b7280" />
    <rect x="8" y="24" width="32" height="5" rx="1" fill="#1e293b" /><rect className="ofr-scan" x="8" y="24" width="3" height="5" fill="#a5f3fc" /></>,
  chair: <><path d="M10 14a14 10 0 0 1 28 0" fill="none" stroke="#1e3a8a" strokeWidth="5" strokeLinecap="round" /><circle cx="24" cy="27" r="13" fill="#1e40af" /><circle cx="24" cy="27" r="9" fill="#2563eb" /></>,
  chair_plastic: <><path d="M10 14a14 10 0 0 1 28 0" fill="none" stroke="#b91c1c" strokeWidth="5" strokeLinecap="round" /><rect x="11" y="15" width="26" height="24" rx="6" fill="#dc2626" />
    <path d="M16 22h16M16 27h16M16 32h16" stroke="#fca5a5" strokeWidth="1.2" /></>,
  chair_exec: <><path d="M7 15a17 12 0 0 1 34 0" fill="none" stroke="#0b0f19" strokeWidth="7" strokeLinecap="round" /><rect x="5" y="19" width="5" height="16" rx="2.5" fill="#1f2937" />
    <rect x="38" y="19" width="5" height="16" rx="2.5" fill="#1f2937" /><circle cx="24" cy="28" r="14" fill="#111827" /><circle cx="24" cy="28" r="10" fill="#292524" /></>,
  table: <><rect x="3" y="9" width="42" height="30" rx="3" fill="#a0703e" stroke="#6b4423" strokeWidth="1.3" /><path d="M6 17h36M6 25h36M6 33h36" stroke="#8b5e34" strokeWidth=".8" opacity=".6" /></>,
  weight_machine: <><rect x="4" y="22" width="40" height="18" rx="2" fill="#9ca3af" stroke="#4b5563" /><rect x="7" y="25" width="34" height="12" fill="#d1d5db" />
    <rect x="16" y="6" width="16" height="12" rx="2" fill="#1f2937" /><text x="24" y="14.5" textAnchor="middle" fontSize="6" fill="#f87171" fontFamily="monospace">2.5kg</text><path d="M24 18v4" stroke="#4b5563" strokeWidth="2" /></>,
  mobile: <><rect x="15" y="4" width="18" height="40" rx="4" fill="#111827" /><rect x="17" y="8" width="14" height="30" rx="1.5" fill="url(#ofr-screen)" /><circle cx="24" cy="41" r="1.3" fill="#6b7280" /></>,
  ip_phone: <><rect x="4" y="12" width="40" height="28" rx="4" fill="#374151" /><path d="M7 14c0-4 5-6 9-6h16c4 0 9 2 9 6v4H7z" fill="#1f2937" />
    <rect x="22" y="20" width="18" height="8" rx="1" fill="#93c5fd" />{[0, 1, 2].map(r => [0, 1, 2].map(c => <rect key={`${r}${c}`} x={8 + c * 4.5} y={21 + r * 5} width="3.2" height="3.2" rx=".6" fill="#9ca3af" />))}</>,
  lock: <><path d="M15 22v-7a9 9 0 0 1 18 0v7" fill="none" stroke="#9ca3af" strokeWidth="4" /><rect x="10" y="21" width="28" height="22" rx="4" fill="#ca8a04" />
    <circle cx="24" cy="30" r="3" fill="#713f12" /><path d="M24 31v6" stroke="#713f12" strokeWidth="2.2" /></>,
  dvr: <><rect x="3" y="16" width="42" height="16" rx="2" fill="#1f2937" /><rect x="7" y="20" width="14" height="5" rx="1" fill="#0f172a" />
    {[0, 1, 2, 3].map(i => <circle key={i} className={`ofr-blink d${i}`} cx={27 + i * 4.5} cy="22.5" r="1.3" fill={i ? '#22c55e' : '#ef4444'} />)}</>,
  cable: <><circle cx="24" cy="24" r="16" fill="none" stroke="#1f2937" strokeWidth="3" /><circle cx="24" cy="24" r="11" fill="none" stroke="#374151" strokeWidth="3" />
    <circle cx="24" cy="24" r="6" fill="none" stroke="#4b5563" strokeWidth="3" /><path d="M38 30c4 3 6 8 6 12" stroke="#1f2937" strokeWidth="3" fill="none" /></>,
  bedding: <><rect x="4" y="3" width="40" height="42" rx="3" fill="#7c4a24" /><rect x="6" y="5" width="36" height="38" rx="2" fill="#f1f5f9" />
    <rect x="9" y="8" width="13" height="8" rx="3" fill="#fff" stroke="#cbd5e1" /><rect x="26" y="8" width="13" height="8" rx="3" fill="#fff" stroke="#cbd5e1" />
    <rect x="6" y="20" width="36" height="23" rx="2" fill="#60a5fa" /><path d="M6 25h36" stroke="#3b82f6" strokeWidth="2" /></>,
  stove: <><rect x="3" y="10" width="42" height="28" rx="3" fill="#374151" stroke="#111827" />
    {[14, 34].map(x => <g key={x}><circle cx={x} cy="24" r="8" fill="#1f2937" stroke="#6b7280" /><circle className="ofr-flame" cx={x} cy="24" r="5" fill="none" stroke="#3b82f6" strokeWidth="2.4" strokeDasharray="2 1.6" /></g>)}</>,
  cylinder: <><rect x="20" y="3" width="8" height="5" rx="1" fill="#6b7280" /><rect x="15" y="7" width="18" height="5" rx="2" fill="#9ca3af" />
    <rect x="11" y="11" width="26" height="33" rx="10" fill="#dc2626" stroke="#991b1b" /><rect x="11" y="22" width="26" height="5" fill="#fbbf24" opacity=".85" /><path d="M16 15c2-2 4-2 6-2" stroke="#fca5a5" strokeWidth="2" strokeLinecap="round" /></>,
}
const CEILING = new Set(['fan', 'light', 'ac', 'cctv'])
const ON_DESK = new Set(['monitor', 'keyboard', 'mouse', 'laptop', 'printer', 'ip_phone', 'mobile', 'scanner'])
const BESIDE_DESK = new Set(['pc', 'ups'])

function Defs() {
  return <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true"><defs>
    <radialGradient id="ofr-glow"><stop offset="0" stopColor="#fde68a" stopOpacity=".95" /><stop offset=".45" stopColor="#fcd34d" stopOpacity=".45" /><stop offset="1" stopColor="#fbbf24" stopOpacity="0" /></radialGradient>
    <linearGradient id="ofr-screen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#38bdf8" /><stop offset="1" stopColor="#1d4ed8" /></linearGradient>
  </defs></svg>
}

function Thing({ a, size = 40, copy = 0 }: { a: Asset; size?: number; copy?: number }) {
  const { L } = usePrefs()
  const k = ASSET_KIND[a.kind] ? a.kind : 'other'
  const title = `${a.name || L(ASSET_KIND[k][0], ASSET_KIND[k][1])}${a.brand ? ` · ${a.brand}` : ''}${a.serial_no ? ` · ${a.serial_no}` : ''} — ${L(CONDITION[a.condition][0], CONDITION[a.condition][1])}`
  return <span className={`ofr-t t-${k} c-${a.condition}`} title={copy ? undefined : title} aria-label={copy ? undefined : title} aria-hidden={copy ? true : undefined}
    style={{ width: size, height: size, animationDelay: `${copy * -0.37}s` }}>
    {ART[k] ? <svg viewBox="0 0 48 48" width={size} height={size}>{ART[k]}</svg> : <span className="ofr-gen"><Icon name={ASSET_KIND[k]?.[2] ?? 'box'} size={Math.round(size * .5)} /></span>}
    {a.condition !== 'good' && <i className="ofr-mark">{a.condition === 'repair' ? '!' : a.condition === 'lost' ? '?' : '×'}</i>}
  </span>
}

/** Up to 4 drawn copies, then a ×n tag. */
function Many({ a, size }: { a: Asset; size?: number }) {
  const { n } = usePrefs()
  const show = a.kind === 'cable' ? 1 : Math.min(a.quantity, 4)
  return <span className="ofr-many">{Array.from({ length: show }, (_, i) => <Thing key={i} a={a} size={size} copy={i} />)}
    {(a.kind === 'cable' || a.quantity > 4) && <b className="ofr-q">×{n(a.quantity)}</b>}</span>
}

function DeskView({ d, items, who }: { d: Desk; items: Asset[]; who: string | null }) {
  const { L, n } = usePrefs()
  const top = items.filter(a => ON_DESK.has(a.kind))
  const side = items.filter(a => BESIDE_DESK.has(a.kind))
  const seat = items.find(a => a.kind.startsWith('chair'))
  const rest = items.filter(a => !ON_DESK.has(a.kind) && !BESIDE_DESK.has(a.kind) && a !== seat)
  return <div className="ofr-desk" title={`${d.name}${who ? ` — ${who}` : ''}`}>
    <div className="ofr-deskrow">
      <div className="ofr-top">{top.length ? top.map(a => <Many key={a.id} a={a} size={a.kind === 'monitor' || a.kind === 'printer' ? 40 : 30} />)
        : <span className="ofr-empty">{L('টেবিল খালি', 'Empty desk')}</span>}</div>
      {side.length > 0 && <div className="ofr-side">{side.map(a => <Many key={a.id} a={a} size={34} />)}</div>}
    </div>
    <div className="ofr-seat">
      {seat ? <Thing a={seat} size={38} /> : <Thing a={{ id: 'c', kind: 'chair', name: L('চেয়ার', 'Chair'), condition: 'good', quantity: 1 } as Asset} size={38} copy={1} />}
      {who ? <span className="ofr-person" title={who}>{who.slice(0, 1).toUpperCase()}</span> : null}
      {rest.map(a => <Many key={a.id} a={a} size={30} />)}
    </div>
    <span className={`ofr-tag${who ? '' : ' none'}`}><b>{d.name}</b> {who ?? L('কেউ নেই', 'nobody')} · {n(items.length)}</span>
  </div>
}

function RoomView({ r, ctx, front }: { r: Room; ctx: Ctx; front: boolean }) {
  const { L } = usePrefs()
  const loose = ctx.assets.filter(a => a.room_id === r.id && !a.desk_id)
  const desks = ctx.desks.filter(d => d.room_id === r.id)
  const lit = loose.some(a => a.kind === 'light' && a.condition === 'good')
  const who = r.responsible_id ? ctx.emp[r.responsible_id]?.full_name : null
  return <div id={`room-${r.id}`} className={`ofr-room f-${r.kind}${lit ? ' lit' : ''}`}>
    <span className="ofr-plate"><Icon name={ROOM_KIND[r.kind]?.[2] ?? 'form'} size={13} /><b>{r.name}</b>{who && <small>{who}</small>}</span>
    <span className="ofr-dirtag">{L(DIR[r.direction]?.[0] ?? '', DIR[r.direction]?.[1] ?? '')}{front ? ` · ${L('সামনে · দরজা', 'front · door')}` : ''}</span>
    <div className="ofr-ceil">{loose.filter(a => CEILING.has(a.kind)).map(a => <Many key={a.id} a={a} size={a.kind === 'ac' ? 46 : a.kind === 'light' ? 50 : 42} />)}</div>
    <div className="ofr-floor">
      {desks.map(d => <DeskView key={d.id} d={d} who={d.responsible_id ? ctx.emp[d.responsible_id]?.full_name ?? null : null} items={ctx.assets.filter(a => a.desk_id === d.id)} />)}
      {loose.filter(a => !CEILING.has(a.kind)).map(a => <Many key={a.id} a={a} size={a.kind === 'bedding' ? 58 : a.kind === 'table' ? 52 : 38} />)}
      {!loose.length && !desks.length && <span className="ofr-empty">{L('কিছু লেখা নেই', 'Nothing listed')}</span>}
    </div>
  </div>
}

export function RealOffice({ ctx, rooms }: { ctx: Ctx; rooms: Room[] }) {
  const { L } = usePrefs()
  const [night, setNight] = useState(false)
  const at = (d: string) => rooms.filter(r => r.direction === d)
  // A column/row with no room shrinks to a strip of garden, so the building stays compact.
  const colUsed = [0, 1, 2].map(c => [0, 1, 2].some(r => at(DIR_GRID[r * 3 + c]).length))
  const rowUsed = [0, 1, 2].map(r => [0, 1, 2].some(c => at(DIR_GRID[r * 3 + c]).length))
  const front = ctx.p.front_direction
  const doorSide = !front ? null : front.startsWith('n') ? 'top' : front.startsWith('s') || front === 'c' ? 'bottom' : front === 'e' ? 'right' : 'left'
  const doorCol = !front ? 1 : front.endsWith('w') ? 0 : front.endsWith('e') && front !== 'e' ? 2 : front === 'e' ? 2 : front === 'w' ? 0 : 1
  const doorRow = !front ? 2 : front.startsWith('n') ? 0 : front.startsWith('s') || front === 'c' ? 2 : 1
  const pos = (i: number, used: boolean[]) => `${used.slice(0, i).reduce((s, u) => s + (u ? 3 : .55), 0) + (used[i] ? 1.5 : .275)}`
  const total = (used: boolean[]) => used.reduce((s, u) => s + (u ? 3 : .55), 0)

  return <div className={`ofr${night ? ' night' : ''}`}>
    <Defs />
    <div className="ofr-bar">
      <span className="ofr-hint"><Icon name="eye" size={14} />{L('উপর থেকে দেখা অফিস — জিনিসের উপর আঙুল/মাউস রাখলে নাম ও অবস্থা দেখাবে।', 'The office seen from above — hover or hold an item to see its name and state.')}</span>
      <button type="button" className={`ofr-night${night ? ' on' : ''}`} aria-pressed={night} onClick={() => setNight(v => !v)}>
        {night ? L('☀ দিন', '☀ Day') : L('🌙 রাত — আলো কোথায় জ্বলে?', '🌙 Night — where are the lights?')}</button>
    </div>
    <div className="ofr-scroll">
      <div className="ofr-site">
        <span className="ofr-compass" aria-hidden="true"><b>{L('উ', 'N')}</b><i /></span>
        <div className="ofr-bld" style={{ gridTemplateColumns: colUsed.map(u => u ? 'minmax(0,3fr)' : 'minmax(30px,.55fr)').join(' '), gridTemplateRows: rowUsed.map(u => u ? 'minmax(150px,auto)' : '40px').join(' ') }}>
          {DIR_GRID.map(d => { const rs = at(d)
            return <div key={d} className={`ofr-cell${rs.length ? '' : ' yard'}`} data-dir={L(DIR[d][0], DIR[d][1])}>
              {rs.map(r => <RoomView key={r.id} r={r} ctx={ctx} front={front === d} />)}</div> })}
          {doorSide && <span className={`ofr-door ${doorSide}`} style={doorSide === 'top' || doorSide === 'bottom'
            ? { left: `calc(${pos(doorCol, colUsed)} / ${total(colUsed)} * 100%)` } : { top: `calc(${pos(doorRow, rowUsed)} / ${total(rowUsed)} * 100%)` }}>
            <svg viewBox="0 0 40 40" width="40" height="40"><path d="M2 38V2a36 36 0 0 1 36 36" fill="none" stroke="#a16207" strokeWidth="1.4" strokeDasharray="3 2" /><rect x="0" y="0" width="4" height="38" fill="#a16207" /></svg>
            <b>{L('দরজা', 'Door')}</b></span>}
        </div>
      </div>
    </div>
    <div className="ofr-key">
      <span><span className="ofr-k spin" />{L('ঘুরছে = ভালো আছে', 'Turning = working')}</span>
      <span><i className="ofr-mark static">×</i>{L('নষ্ট', 'Broken')}</span>
      <span><i className="ofr-mark static r">!</i>{L('মেরামত লাগবে', 'Needs repair')}</span>
      <span><i className="ofr-mark static l">?</i>{L('হারানো (ঝাপসা)', 'Lost (faded)')}</span>
      <span><span className="ofr-person sm">ক</span>{L('ডেস্কে যিনি বসেন', 'Who sits at the desk')}</span>
    </div>
  </div>
}
