// Small shared pieces of the attendance page's hub and zone parts (AttendancePage).
// Nothing here talks to the database except `useHubList` (the hubs / zones the person may see — the same call every hub page makes)
// Every rule stays in the database.
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { Icon } from '../../components/Icon'
import { addDays, todayDhaka } from '../../lib/dailyAccounts'
import { hubLabel, org } from '../../lib/hr'
import { usePrefs, type Lang } from '../../lib/prefs'
import { download, xlsxBlob } from '../../lib/xlsx'
import { RECORD_META, wfFriendly, type IsoDate, type MarkStatus } from '../../lib/workforce'
import { Badge, Field, Modal, useLoad } from '../accounts/ui'
import '../../workforce-manager.css'

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral'

// ------------------------------------------------------------------ dates (Dhaka calendar days, 'YYYY-MM-DD')
export const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`
export const prevMonth = (iso: string) => monthStart(addDays(monthStart(iso), -1))
export const monthEnd = (iso: string) => { const d = new Date(`${monthStart(iso)}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10) }
/** This month first, then the months before it. */
export const lastMonths = (today: string, count = 12) => { const out: string[] = []; let m = monthStart(today); for (let i = 0; i < count; i++) { out.push(m); m = prevMonth(m) } return out }
const dateText = (iso: string, lang: Lang, o: Intl.DateTimeFormatOptions) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'UTC', ...o })
/** "১৭ নভেম্বর" */
export const fmtDay = (iso: string, lang: Lang) => dateText(iso, lang, { day: 'numeric', month: 'long' })
/** "সোমবার, ১৭ নভেম্বর" */
export const fmtLong = (iso: string, lang: Lang) => dateText(iso, lang, { weekday: 'long', day: 'numeric', month: 'long' })
/** "সোম" */
export const fmtWeekday = (iso: string, lang: Lang) => dateText(iso, lang, { weekday: 'short' })
const BN_DIGITS = '০১২৩৪৫৬৭৮৯'
/** The day of a timestamp on the Dhaka calendar: "১৭ নভেম্বর". */
export const fmtTsDay = (ts: string, lang: Lang) => new Date(ts).toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'long' })
/** The time of a timestamp on the Dhaka clock: "সকাল ১০:১৫" / "10:15 am". */
export const fmtTime = (ts: string, lang: Lang) => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ts))
  const h = Number(p.find(x => x.type === 'hour')?.value) % 24; const m = p.find(x => x.type === 'minute')?.value ?? '00'
  if (lang === 'en') return `${h % 12 || 12}:${m} ${h < 12 ? 'am' : 'pm'}`
  const part = h >= 4 && h < 12 ? 'সকাল' : h < 16 ? 'দুপুর' : h < 18 ? 'বিকেল' : h < 20 ? 'সন্ধ্যা' : 'রাত'
  return `${part} ${`${h % 12 || 12}:${m}`.replace(/\d/g, d => BN_DIGITS[+d])}`
}
/** A moment on the Dhaka clock: "১৭ নভেম্বর, সকাল ১০:১৫". */
export const fmtStamp = (ts: string | null | undefined, lang: Lang) => !ts ? '—' : `${fmtTsDay(ts, lang)}, ${fmtTime(ts, lang)}`
export const monthName = (ym: string, lang: Lang) => dateText(`${ym.slice(0, 7)}-01`, lang, { month: 'long', year: 'numeric' })

export type HubOpt = { id: string; name: string; zone_id: string | null }
export type ZoneOpt = { id: string; name: string }
/** Hubs and zones the person may see (row security decides), hubs shown with their number code like everywhere else. */
export function useHubList() {
  return useLoad(async () => {
    const [hubs, zones] = await Promise.all([org.hubs(), org.zones()])
    return {
      hubs: hubs.filter(h => !h.archived_at).map((h): HubOpt => ({ id: h.id, name: hubLabel(h), zone_id: h.zone_id })),
      zones: zones.filter(z => !z.archived_at).map((z): ZoneOpt => ({ id: z.id, name: z.name })),
    }
  }, [])
}

// ------------------------------------------------------------------ period chips
export type Preset = 'today' | 'yesterday' | '7d' | 'month' | 'last' | 'open' | 'custom'
const PRESET_LABEL: Record<Preset, [string, string]> = {
  today: ['আজ', 'Today'], yesterday: ['গতকাল', 'Yesterday'], '7d': ['৭ দিন', '7 days'], month: ['এ মাস', 'This month'],
  last: ['গত মাস', 'Last month'], open: ['এ মাস ও গত মাস', 'This and last month'], custom: ['তারিখ বাছুন', 'Pick dates'],
}
export function rangeOf(p: Preset, today: string, custom: { from: string; to: string }): { from: IsoDate; to: IsoDate } {
  switch (p) {
    case 'today': return { from: today, to: today }
    case 'yesterday': { const y = addDays(today, -1); return { from: y, to: y } }
    case '7d': return { from: addDays(today, -6), to: today }
    case 'month': return { from: monthStart(today), to: today }
    case 'last': { const m = prevMonth(today); return { from: m, to: monthEnd(m) } }
    case 'open': return { from: prevMonth(today), to: today }
    default: return custom
  }
}
export function useRange(initial: Preset) {
  const today = todayDhaka()
  const [preset, setPreset] = useState<Preset>(initial)
  const [custom, setCustom] = useState({ from: monthStart(today), to: today })
  const r = rangeOf(preset, today, custom)
  return { preset, setPreset, custom, setCustom, from: r.from, to: r.to, today }
}
export type RangeState = ReturnType<typeof useRange>

export function RangeBar({ r, presets }: { r: RangeState; presets: Preset[] }) {
  const { L } = usePrefs()
  const set = (patch: Partial<{ from: string; to: string }>) => r.setCustom(c => {
    const v = { ...c, ...patch }
    return v.to < v.from ? (patch.from ? { from: v.from, to: v.from } : { from: v.to, to: v.to }) : v
  })
  return <div className="wm-range no-print">
    <div className="wm-chips" role="group" aria-label={L('সময়', 'Period')}>
      {presets.map(p => <button key={p} type="button" className={`wm-chip${r.preset === p ? ' on' : ''}`} aria-pressed={r.preset === p} onClick={() => r.setPreset(p)}>
        {L(PRESET_LABEL[p][0], PRESET_LABEL[p][1])}</button>)}
    </div>
    {r.preset === 'custom' && <div className="wm-dates">
      <Field label={L('থেকে', 'From')}><input type="date" value={r.custom.from} max={r.today} onChange={e => e.target.value && set({ from: e.target.value })} /></Field>
      <Field label={L('পর্যন্ত', 'To')}><input type="date" value={r.custom.to} max={r.today} onChange={e => e.target.value && set({ to: e.target.value })} /></Field>
    </div>}
  </div>
}

// ------------------------------------------------------------------ small widgets
export function ChipTabs<K extends string>({ tabs, value, onChange, label }: {
  tabs: Array<{ key: K; label: string; count?: number; tone?: 'warn' | 'bad' }>; value: K; onChange: (k: K) => void; label: string
}) {
  const { n } = usePrefs()
  return <div className="wm-chips wm-tabs no-print" role="tablist" aria-label={label}>
    {tabs.map(t => <button key={t.key} type="button" role="tab" aria-selected={value === t.key} className={`wm-chip${value === t.key ? ' on' : ''}`} onClick={() => onChange(t.key)}>
      {t.label}{t.count ? <b className={t.tone ?? 'warn'}>{n(t.count)}</b> : null}</button>)}
  </div>
}

export function LiveDot({ on }: { on: boolean }) {
  const { L } = usePrefs()
  return on ? <span className="wm-live" role="status" title={L('লাইভ — বদল নিজে থেকেই আসে', 'Live — changes arrive by themselves')}><i aria-hidden="true" />{L('লাইভ', 'Live')}</span> : null
}

/** Name, code and post with a round initial. */
export function Who({ name, code, position, extra }: { name: string; code?: string | null; position?: string | null; extra?: ReactNode }) {
  const { n } = usePrefs()
  return <span className="wm-who"><span className="wm-av" aria-hidden="true">{(name || '?').trim().charAt(0)}</span>
    <span className="wm-wt"><b>{name}</b><small>{[code ? n(code) : null, position].filter(Boolean).join(' · ')}</small></span>{extra}</span>
}

export function Notice({ children }: { children: ReactNode }) { return <p className="notice wm-note" role="status">{children}</p> }
export function Empty({ children }: { children: ReactNode }) { return <p className="muted wm-empty">{children}</p> }
export function Loading() { const { L } = usePrefs(); return <p className="muted wm-empty" role="status">{L('লোড হচ্ছে…', 'Loading…')}</p> }

/** A section card with a heading, optional right-side tools and a body. */
export function Section({ title, hint, tools, children, id }: { title: string; hint?: ReactNode; tools?: ReactNode; children: ReactNode; id?: string }) {
  return <section className="panel wm-sec" id={id}>
    <div className="wm-sec-h"><h2>{title}</h2>{tools ? <div className="wm-sec-t no-print">{tools}</div> : null}</div>
    {hint ? <p className="muted small wm-hint">{hint}</p> : null}
    {children}
  </section>
}

// ------------------------------------------------------------------ labels
export const toneOfRecord = (code: string | null | undefined): Tone => (code && RECORD_META[code]?.tone) || 'neutral'
export const recordLabel = (code: string | null | undefined, lang: Lang) => { const m = code ? RECORD_META[code] : null; return m ? (lang === 'bn' ? m.bn : m.en) : code ?? '—' }
export const KIND_LABEL = { present: ['উপস্থিত', 'Present'], absent: ['অনুপস্থিত', 'Absent'] } as const
export const MARK_STATUS: Record<MarkStatus, { bn: string; en: string; tone: Tone }> = {
  waiting: { bn: 'অপেক্ষায়', en: 'Waiting', tone: 'info' }, approved: { bn: 'অনুমোদিত', en: 'Approved', tone: 'ok' }, rejected: { bn: 'ফেরত', en: 'Returned', tone: 'bad' },
}
export const siteText = (a: boolean | null | undefined, lang: Lang) =>
  a === true ? (lang === 'bn' ? 'ওয়েবসাইটে আবেদন করা আছে' : 'Applied on the website') : a === false ? (lang === 'bn' ? 'ওয়েবসাইটে আবেদন নেই' : 'No website application') : ''
/** The website application of an absent "applied on the website" date: "নম্বর 12345 · 3 নভেম্বর" ('' when there is none). */
export const siteDetail = (m: { site_ref?: string | null; site_applied_on?: string | null }, lang: Lang) =>
  m.site_ref ? `${lang === 'bn' ? 'নম্বর' : 'No.'} ${m.site_ref}${m.site_applied_on ? ` · ${fmtDay(m.site_applied_on, lang)}` : ''}` : ''

export function KindBadge({ k }: { k: 'present' | 'absent' }) { const { lang } = usePrefs(); return <Badge tone={k === 'present' ? 'ok' : 'bad'}>{KIND_LABEL[k][lang === 'bn' ? 0 : 1]}</Badge> }

/** Asks for a written reason (returning an input, rejecting an application, correcting a number). */
export function NoteDialog({ title, label, hint, confirm, danger, onClose, onConfirm, children }: {
  title: string; label: string; hint?: ReactNode; confirm: string; danger?: boolean; onClose: () => void; onConfirm: (note: string) => Promise<void>; children?: ReactNode
}) {
  const { L } = usePrefs()
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const go = async () => { setBusy(true); setErr(''); try { await onConfirm(note.trim()) } catch (e) { setErr(wfFriendly(e)); setBusy(false) } }
  return <Modal title={title} onClose={onClose} actions={<>
    <button type="button" className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button>
    <button type="button" className={danger ? 'danger' : ''} disabled={busy || !note.trim()} onClick={() => void go()}>{confirm}</button></>}>
    {hint ? <p className="muted small">{hint}</p> : null}
    {children}
    <Field label={label} required><textarea rows={3} value={note} onChange={e => setNote(e.target.value)} autoFocus /></Field>
    {err ? <p className="da-error" role="alert">{err}</p> : null}
  </Modal>
}

// ------------------------------------------------------------------ export
export function exportRows(title: string, sub: string, heads: string[], rows: Array<Array<string | number | null>>, file: string) {
  download(xlsxBlob(`XZM-TEAM — ${title}`, `${sub} · ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}`, heads, rows), `XZM-TEAM-${file.replace(/[^\wঀ-৿-]+/g, '-')}.xlsx`)
}
/** The browser's print window ("Save as PDF" there); only this table is printed (same mechanism as DataTable). */
export function printRows(title: string, sub: string, heads: string[], rows: Array<Array<string | number | null>>) {
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
  const box = document.createElement('div'); box.id = 'print-box'
  box.innerHTML = `<h2 style="margin:0">XZM-TEAM — ${esc(title)}</h2><p style="margin:2px 0 10px">${esc(sub)} · ${esc(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' }))}</p>
    <table><thead><tr>${heads.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  const host = document.querySelector('.app-main') ?? document.body; host.appendChild(box); document.body.classList.add('print-list')
  const old = document.title; document.title = `XZM-TEAM-${title}`
  const done = () => { box.remove(); document.body.classList.remove('print-list'); document.title = old; window.removeEventListener('afterprint', done) }
  window.addEventListener('afterprint', done); window.setTimeout(() => window.print(), 50)
}

// ------------------------------------------------------------------ the table: a real table on a wide screen, divided rows on a phone
export type WCol<T> = {
  key: string; label: string
  cell: (r: T, i: number) => ReactNode
  /** Plain value for sorting, Excel and print. Without it the column is only drawn on screen. */
  text?: (r: T) => string | number | null
  sort?: boolean
  num?: boolean
  /** The line that names the row: first column on a wide screen (kept in view while the table scrolls), card heading on a phone. */
  primary?: boolean
  foot?: ReactNode
  cls?: string
}
type SortState = { key: string; dir: 1 | -1 } | null

export function WmTable<T>({ cols, rows, rowKey, onRow, rowCls, title, file, sub, grid, empty, defaultSort, extraTools }: {
  cols: Array<WCol<T>>; rows: T[]; rowKey: (r: T) => string; onRow?: (r: T) => void; rowCls?: (r: T) => string
  title: string; file: string; sub?: string
  /** Phone: show the numbers as a small grid under the heading (for tables with many number columns). */
  grid?: boolean; empty?: ReactNode; defaultSort?: { key: string; dir: 1 | -1 }; extraTools?: ReactNode
}) {
  const { L, n } = usePrefs()
  const [sort, setSort] = useState<SortState>(defaultSort ?? null)
  const sortable = cols.filter(c => c.sort && c.text)
  const exp = cols.filter(c => c.text)
  const sc = sort ? cols.find(x => x.key === sort.key) : null
  const list = !sort || !sc?.text ? rows : [...rows].sort((a, b) => { const t = sc.text!, x = t(a), y = t(b)
    const d = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'bn', { numeric: true })
    return d * sort.dir })
  const toggle = (key: string) => setSort(s => !s || s.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null)
  const data = () => ({ heads: exp.map(c => c.label), rows: list.map(r => exp.map(c => c.text!(r))) })
  const subtitle = sub ?? L(`${n(list.length)}টি সারি`, `${list.length} rows`)
  const hasFoot = cols.some(c => c.foot !== undefined)
  const keyDown = (e: KeyboardEvent, r: T) => { if (onRow && (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onRow(r) } }
  if (!rows.length) return <>{empty ?? <Empty>{L('কিছু নেই।', 'Nothing here.')}</Empty>}</>
  return <div className="wm-tw">
    <div className="wm-tools no-print">
      <span className="wm-cnt">{L('মোট', 'Total')} <b>{n(list.length)}</b></span>
      {sortable.length > 0 && <span className="wm-sortsel">
        <select aria-label={L('সাজান', 'Sort by')} value={sort?.key ?? ''} onChange={e => setSort(e.target.value ? { key: e.target.value, dir: sort?.dir ?? 1 } : null)}>
          <option value="">{L('সাজান…', 'Sort…')}</option>
          {sortable.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
        {sort && <button type="button" className="secondary sm" aria-label={sort.dir === 1 ? L('ছোট থেকে বড়', 'Ascending') : L('বড় থেকে ছোট', 'Descending')}
          onClick={() => setSort({ ...sort, dir: sort.dir === 1 ? -1 : 1 })}>{sort.dir === 1 ? '↑' : '↓'}</button>}
      </span>}
      <span className="wm-grow" />
      {extraTools}
      {exp.length > 0 && <>
        <button type="button" className="secondary sm" aria-label={L('এক্সেল ফাইল', 'Excel file')} title={L('এক্সেল', 'Excel')} onClick={() => { const d = data(); exportRows(title, subtitle, d.heads, d.rows, file) }}><Icon name="xls" size={15} /><span className="wm-bl">{L('এক্সেল', 'Excel')}</span></button>
        <button type="button" className="secondary sm" aria-label={L('প্রিন্ট', 'Print')} title={L('প্রিন্ট', 'Print')} onClick={() => { const d = data(); printRows(title, subtitle, d.heads, d.rows) }}><Icon name="print" size={15} /><span className="wm-bl">{L('প্রিন্ট', 'Print')}</span></button></>}
    </div>
    <div className="wm-scroll" tabIndex={0} role="region" aria-label={title}>
      <table className={`wm-tbl${grid ? ' grid' : ''}`}>
        <thead><tr>{cols.map(c => <th key={c.key} scope="col" className={`${c.num ? 'num' : ''} ${c.primary ? 'pri' : ''} ${c.cls ?? ''}`}
          aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
          {c.sort && c.text ? <button type="button" className="wm-th" onClick={() => toggle(c.key)}>{c.label}<i aria-hidden="true">{sort?.key === c.key ? (sort.dir === 1 ? '↑' : '↓') : ''}</i></button> : c.label}</th>)}</tr></thead>
        <tbody>{list.map((r, i) => <tr key={rowKey(r)} className={`${onRow ? 'click' : ''} ${rowCls?.(r) ?? ''}`} tabIndex={onRow ? 0 : undefined}
          onClick={onRow ? () => onRow(r) : undefined} onKeyDown={onRow ? e => keyDown(e, r) : undefined}>
          {cols.map(c => <td key={c.key} data-label={c.label} className={`${c.num ? 'num' : ''} ${c.primary ? 'pri' : ''} ${c.cls ?? ''}`}>{c.cell(r, i)}</td>)}</tr>)}</tbody>
        {hasFoot && <tfoot><tr>{cols.map(c => <td key={c.key} data-label={c.label} className={`${c.num ? 'num' : ''} ${c.primary ? 'pri' : ''}`}>{c.foot}</td>)}</tr></tfoot>}
      </table>
    </div>
  </div>
}
