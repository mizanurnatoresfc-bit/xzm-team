import { usePrefs } from '../lib/prefs'

/** One lane per route: the start on the left, then each stop in order along a line. */
export type Lane = { id: string; code: string; name: string; sub?: string; stops: Array<{ id: string; label: string; flag?: string; tone?: 'warn' | 'bad' }>; tail?: string }

const W = 760, LEFT = 150, RIGHT = 20, LANE = 92

function trim(s: string, max: number) { return s.length > max ? s.slice(0, max - 1) + '…' : s }

/**
 * Drawn route map (no map service needed): the start point, a lane per route, stops in order.
 * Used for Sorting → hub routes (stops = hubs) and Rider routes (stops = areas).
 */
export function RouteViz({ start, lanes, empty }: { start: string; lanes: Lane[]; empty?: string }) {
  const { L, n } = usePrefs()
  if (!lanes.length) return <p className="muted">{empty ?? L('দেখানোর মতো রুট নেই।', 'No routes to draw.')}</p>
  const H = 40 + lanes.length * LANE
  const midY = 40 + (lanes.length * LANE) / 2 - 10
  return <div className="route-viz"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={L('রুটের ছবি', 'Route map')} fontSize="12">
    {/* start node */}
    <g>
      <rect x="8" y={midY - 26} width="118" height="52" rx="12" fill="var(--primary)" />
      <text x="67" y={midY - 4} textAnchor="middle" fill="#fff" fontWeight="700" fontSize="13">{trim(start, 16)}</text>
      <text x="67" y={midY + 14} textAnchor="middle" fill="#fff" opacity=".85" fontSize="11">{L(`${n(lanes.length)}টা রুট`, `${lanes.length} routes`)}</text>
    </g>
    {lanes.map((ln, i) => {
      const y = 50 + i * LANE + 26
      const k = Math.max(ln.stops.length, 1)
      const span = W - LEFT - RIGHT - 30
      const step = span / k
      const xs = ln.stops.map((_, j) => LEFT + 30 + step * j + step / 2)
      const lastX = xs.length ? xs[xs.length - 1] : LEFT + 30
      const maxLabel = Math.max(6, Math.floor(step / 7))
      return <g key={ln.id}>
        {/* connector from start to the lane */}
        <path d={`M126 ${midY} C ${LEFT - 6} ${midY}, ${LEFT - 30} ${y}, ${LEFT + 6} ${y}`} fill="none" stroke="var(--border)" strokeWidth="2" />
        <text x={LEFT + 8} y={y - 30} fill="var(--text)" fontWeight="700">{trim(`${ln.code} · ${ln.name}`, 48)}</text>
        {ln.sub && <text x={LEFT + 8} y={y - 16} fill="var(--muted)" fontSize="11">{trim(ln.sub, 80)}</text>}
        <line x1={LEFT + 6} y1={y} x2={lastX} y2={y} stroke="var(--primary)" strokeWidth="3" strokeLinecap="round" opacity=".55" />
        {ln.stops.map((s, j) => <g key={s.id}>
          <circle cx={xs[j]} cy={y} r="9" fill={s.tone === 'bad' ? 'var(--cds-chart-status-critical, #dc2626)' : s.tone === 'warn' ? 'var(--cds-chart-status-warning, #ea580c)' : 'var(--surface)'}
            stroke="var(--primary)" strokeWidth="2.5"><title>{`${j + 1}. ${s.label}${s.flag ? ' · ' + s.flag : ''}`}</title></circle>
          <text x={xs[j]} y={y + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill={s.tone ? '#fff' : 'var(--primary)'}>{n(j + 1)}</text>
          <text x={xs[j]} y={y + 26} textAnchor="middle" fill="var(--text)" fontSize="11">{trim(s.label, maxLabel)}</text>
          {s.flag && <text x={xs[j]} y={y + 40} textAnchor="middle" fill="var(--muted)" fontSize="10">{trim(s.flag, maxLabel)}</text>}
        </g>)}
        {ln.tail && <text x={W - RIGHT} y={y - 16} textAnchor="end" fill="var(--muted)" fontSize="11">{trim(ln.tail, 40)}</text>}
      </g>
    })}
  </svg></div>
}
