import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { download, xlsxBlob } from '../lib/xlsx'
import { usePrefs } from '../lib/prefs'
import { Icon } from './Icon'
import { MultiCombo } from './inputs'

export type Col<T> = { key: string; label: string; render?: (r: T) => ReactNode; value?: (r: T) => string | number | null; className?: string; noExport?: boolean
  /** The column that names the row — the heading of a card or list line. Default: the first data column. */
  primary?: boolean
  /** Not drawn on screen, but searched, filtered, printed and exported (e.g. an ID that is shown under the name). */
  hidden?: boolean }
export type ViewKind = 'table' | 'card' | 'list'

// What the person chose for each list (view, rows per page, sorting, filters), kept on this device.
type Saved = { view?: ViewKind; size?: number; sort?: { key: string; dir: 1 | -1 } | null; filters?: Record<string, string | string[]> }
const STORE = 'xzm_dataview'
function readSaved(id: string | undefined): Saved {
  if (!id) return {}
  try { return (JSON.parse(localStorage.getItem(STORE) || '{}') as Record<string, Saved>)[id] ?? {} } catch { return {} }
}
function writeSaved(id: string | undefined, v: Saved) {
  if (!id) return
  try {
    const all = JSON.parse(localStorage.getItem(STORE) || '{}') as Record<string, Saved>
    all[id] = v
    const keys = Object.keys(all); if (keys.length > 80) delete all[keys[0]]
    localStorage.setItem(STORE, JSON.stringify(all))
  } catch { /* private mode */ }
}
const SIZES = [25, 50, 100]
const VIEW_ICON: Record<ViewKind, string> = { table: 'table', card: 'grid', list: 'menu' }

/** One list, several views: table, cards or compact lines of the same rows — with search, sorting, quick filters,
 *  pages, mark / unmark, print, Excel and PDF. Search, filters and sorting also decide what is printed or exported. */
export function DataTable<T>({ title, rows, cols: allCols, rowKey, onRowClick, empty, file, prefKey, views = ['table', 'card', 'list'], search = true, bulk, phoneView, canExport = true, canPrint = true, beforeOutput }: {
  title: string; rows: T[] | null | undefined; cols: Array<Col<T>>; rowKey: (r: T) => string; onRowClick?: (r: T) => void; empty?: ReactNode; file?: string
  /** Name under which this list's view choices are remembered (default: `file`). */
  prefKey?: string; views?: ViewKind[]
  /** false = the page has its own search box. */ search?: boolean
  /** Actions for the marked rows; shown in a bar while anything is marked. `clear` unmarks everything. */
  bulk?: (marked: T[], clear: () => void) => ReactNode
  /** The view a phone starts in, until the person picks one (a wide table is a long scroll on a phone). */
  phoneView?: ViewKind
  /** false hides Excel and PDF / Print (the page decides from the person's permissions). Default: shown. */
  canExport?: boolean; canPrint?: boolean
  /** Called before an Excel / PDF / print; return false (or throw) to stop it — e.g. to log it in the database first. */
  beforeOutput?: (format: 'excel' | 'pdf' | 'print', rows: number) => Promise<boolean> | boolean
}) {
  const { L, n } = usePrefs()
  const id = prefKey ?? file
  const [marked, setMarked] = useState<Set<string>>(new Set())
  const [saved, setSavedS] = useState<Saved>(() => readSaved(id))
  const save = (patch: Saved) => setSavedS(prev => { const next = { ...prev, ...patch }; writeSaved(id, next); return next })
  const [q, setQ] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [page, setPage] = useState(0)
  const source = useMemo(() => rows ?? [], [rows])
  const exp = allCols.filter(c => !c.noExport)
  const cols = useMemo(() => allCols.filter(c => !c.hidden), [allCols])
  const cell = (c: Col<T>, r: T) => { const v = c.value ? c.value(r) : (r as Record<string, unknown>)[c.key]; return v === null || v === undefined || typeof v === 'object' ? '' : (v as string | number) }
  const onPhone = typeof matchMedia === 'function' && matchMedia('(max-width:700px)').matches
  const view: ViewKind = saved.view && views.includes(saved.view) ? saved.view : onPhone && phoneView && views.includes(phoneView) ? phoneView : views[0]
  const size = SIZES.includes(saved.size ?? 0) ? saved.size! : 50
  const big = source.length > 8
  // Columns with a handful of repeating values (status, hub, post…) become one-tap filters.
  const filterable = useMemo(() => !big ? [] : exp.map(c => {
    const vals = new Set<string>(); for (const r of source) { vals.add(String(cell(c, r))); if (vals.size > 14) break }
    vals.delete('')
    return vals.size >= 2 && vals.size <= 14 && vals.size < source.length ? { c, vals: [...vals].sort((x, y) => x.localeCompare(y, 'bn')) } : null
  }).filter((x): x is { c: Col<T>; vals: string[] } => !!x),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [source, cols, big])
  // A remembered filter only counts while its value still exists in the list.
  const filters: Record<string, string[]> = Object.fromEntries(Object.entries(saved.filters ?? {})
    .map(([k, v]) => [k, (Array.isArray(v) ? v : [v]).filter(x => filterable.some(f => f.c.key === k && f.vals.includes(x)))] as [string, string[]])
    .filter(([, v]) => v.length))
  const sort = saved.sort && cols.some(c => c.key === saved.sort!.key) ? saved.sort : null
  const list = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    let out = source.filter(r => {
      for (const [k, v] of Object.entries(filters)) { const c = allCols.find(x => x.key === k); if (c && !v.includes(String(cell(c, r)))) return false }
      if (!words.length) return true
      const text = exp.map(c => String(cell(c, r))).join(' ').toLowerCase()
      return words.every(w => text.includes(w))
    })
    if (sort) {
      const c = cols.find(x => x.key === sort.key)!
      out = [...out].sort((x, y) => {
        const a = cell(c, x), b = cell(c, y)
        const d = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'bn', { numeric: true })
        return d * sort.dir
      })
    }
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, q, JSON.stringify(filters), sort?.key, sort?.dir, cols])
  const pages = Math.max(1, Math.ceil(list.length / size))
  const pg = Math.min(page, pages - 1)
  useEffect(() => { setPage(0) }, [q, JSON.stringify(filters), size])
  const shown = list.slice(pg * size, pg * size + size)
  const keys = useMemo(() => new Set(list.map(rowKey)), [list, rowKey])
  const mk = new Set([...marked].filter(k => keys.has(k)))
  const pick = () => mk.size ? list.filter(r => mk.has(rowKey(r))) : list
  const narrowed = list.length !== source.length
  const scope = () => mk.size ? L(`${n(mk.size)}টি চিহ্নিত সারি`, `${mk.size} marked rows`)
    : narrowed ? L(`${n(list.length)}টি সারি (ফিল্টার করা)`, `${list.length} filtered rows`) : L(`সব ${n(list.length)}টি সারি`, `all ${list.length} rows`)
  const canSort = (c: Col<T>) => !!c.value || (source[0] !== undefined && typeof (source[0] as Record<string, unknown>)[c.key] !== 'object' && (source[0] as Record<string, unknown>)[c.key] !== undefined)
  const toggleSort = (c: Col<T>) => save({ sort: sort?.key !== c.key ? { key: c.key, dir: 1 } : sort.dir === 1 ? { key: c.key, dir: -1 } : null })
  const setFilter = (k: string, v: string[]) => { const f = { ...filters }; if (v.length) f[k] = v; else delete f[k]; save({ filters: f }) }
  const activeFilters = Object.keys(filters).length
  const toggleMark = (k: string, on: boolean) => { const s = new Set(mk); if (on) s.add(k); else s.delete(k); setMarked(s) }
  const show = (c: Col<T>, r: T): ReactNode => c.render ? c.render(r) : String(cell(c, r) || '—')
  const titleCol = cols.find(c => c.primary) ?? cols.find(c => !c.noExport) ?? cols[0]
  async function out(format: 'excel' | 'pdf' | 'print', go: () => void) {
    if (beforeOutput) { try { if (await beforeOutput(format, pick().length) === false) return } catch { return } }
    go()
  }
  function excel() {
    const data = pick().map((r, i) => [i + 1, ...exp.map(c => cell(c, r))])
    download(xlsxBlob(`XZM-TEAM — ${title}`, `${scope()} · ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}`, ['S/L', ...exp.map(c => c.label)], data),
      `XZM-TEAM-${(file ?? title).replace(/[^\wঀ-৿-]+/g, '-')}.xlsx`)
  }
  function print(pdf: boolean) {
    const box = document.createElement('div'); box.id = 'print-box'
    const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
    box.innerHTML = `<h2 style="margin:0">XZM-TEAM — ${esc(title)}</h2><p style="margin:2px 0 10px">${esc(scope())} · ${esc(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' }))}${pdf ? ' · ' + esc(L('প্রিন্ট উইন্ডোতে “Save as PDF” বেছে নিন', 'choose “Save as PDF” in the print window')) : ''}</p>
      <table><thead><tr><th>S/L</th>${exp.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${pick().map((r, i) => `<tr><td>${i + 1}</td>${exp.map(c => `<td>${esc(cell(c, r))}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    const host = document.querySelector('.app-main') ?? document.body; host.appendChild(box); document.body.classList.add('print-list')
    const old = document.title; document.title = `XZM-TEAM-${title}`
    const done = () => { box.remove(); document.body.classList.remove('print-list'); document.title = old; window.removeEventListener('afterprint', done) }
    window.addEventListener('afterprint', done); setTimeout(() => window.print(), 50)
  }
  if (rows && !source.length) return <>{empty ?? <p className="muted">{L('কিছু নেই।', 'Nothing here yet.')}</p>}</>
  const all = list.length > 0 && mk.size === list.length
  const viewName: Record<ViewKind, string> = { table: L('টেবিল', 'Table'), card: L('কার্ড', 'Cards'), list: L('তালিকা', 'List') }
  const mark = (r: T, i: number) => { const k = rowKey(r); return <input type="checkbox" aria-label={L(`সারি ${i + 1} চিহ্নিত`, `Mark row ${i + 1}`)} checked={mk.has(k)}
    onClick={e => e.stopPropagation()} onChange={e => toggleMark(k, e.target.checked)} /> }
  return <>
    <div className="list-tools no-print">
      <span className="cnt">{L('মোট ', '')}<b>{n(list.length)}</b>{L('টি', ' rows')}{narrowed ? <em>{L(` / ${n(source.length)}`, ` of ${source.length}`)}</em> : null}{mk.size ? <em>{L(` · ${n(mk.size)} চিহ্নিত`, ` · ${mk.size} marked`)}</em> : null}</span>
      {big && search && <input type="search" className="dv-search" value={q} onChange={e => setQ(e.target.value)} placeholder={L('এই তালিকায় খুঁজুন…', 'Search this list…')} aria-label={L('এই তালিকায় খুঁজুন', 'Search this list')} />}
      <span className="grow" />
      {filterable.length > 0 && <button type="button" className={`secondary sm dv-fbtn${showFilters || activeFilters ? ' on' : ''}`} aria-expanded={showFilters} onClick={() => setShowFilters(v => !v)}>
        <Icon name="search" size={14} />{L('ফিল্টার', 'Filter')}{activeFilters ? ` (${n(activeFilters)})` : ''}</button>}
      {views.length > 1 && <div className="tool-group" role="group" aria-label={L('কীভাবে দেখবেন', 'View')}>
        {views.map(v => <button key={v} type="button" className={`tb${view === v ? ' on' : ''}`} aria-pressed={view === v} title={viewName[v]} aria-label={viewName[v]} onClick={() => save({ view: v })}>
          <Icon name={VIEW_ICON[v]} size={16} /><span className="tl">{viewName[v]}</span></button>)}
      </div>}
      <div className="tool-group" role="group" aria-label={L('তালিকার কাজ', 'List tools')}>
        <button type="button" className={`tb${mk.size ? ' on' : ''}`} onClick={() => setMarked(mk.size ? new Set() : new Set(list.map(rowKey)))}
          title={mk.size ? L('চিহ্ন তুলুন', 'Unmark all') : L('সব চিহ্নিত', 'Mark all')} aria-label={mk.size ? L('চিহ্ন তুলুন', 'Unmark all') : L('সব চিহ্নিত', 'Mark all')}>
          <Icon name={mk.size ? 'uncheck' : 'checkall'} size={16} /><span className="tl">{mk.size ? L('তুলুন', 'Unmark') : L('সব', 'All')}</span></button>
        {canPrint && <button type="button" className="tb" onClick={() => void out('print', () => print(false))} disabled={!list.length} title={L('প্রিন্ট', 'Print')} aria-label={L('প্রিন্ট', 'Print')}><Icon name="print" size={16} /><span className="tl">{L('প্রিন্ট', 'Print')}</span></button>}
        {canExport && <button type="button" className="tb xls" onClick={() => void out('excel', excel)} disabled={!list.length} title="Excel" aria-label="Excel"><Icon name="xls" size={16} /><span className="tl">Excel</span></button>}
        {canExport && <button type="button" className="tb pdf" onClick={() => void out('pdf', () => print(true))} disabled={!list.length} title="PDF" aria-label="PDF"><Icon name="pdf" size={16} /><span className="tl">PDF</span></button>}
      </div>
    </div>
    {bulk && mk.size > 0 && <div className="dv-bulk no-print" role="region" aria-label={L('চিহ্নিত সারির কাজ', 'Actions for marked rows')}>
      <strong>{L(`${n(mk.size)}টি চিহ্নিত`, `${mk.size} marked`)}</strong>{bulk(list.filter(r => mk.has(rowKey(r))), () => setMarked(new Set()))}</div>}
    {(showFilters || activeFilters > 0) && filterable.length > 0 && <div className="dv-filters no-print">
      {filterable.map(({ c, vals }) => <div key={c.key} className="dv-f"><span>{c.label}</span>
        <MultiCombo label={c.label} values={filters[c.key] ?? []} onChange={v => setFilter(c.key, v)} options={vals.map(v => ({ value: v, label: v }))} placeholder={L('সব', 'All')} /></div>)}
      {(activeFilters > 0 || sort) && <button type="button" className="link small" onClick={() => save({ filters: {}, sort: null })}>{L('ফিল্টার ও সাজানো মুছুন', 'Clear filters & sorting')}</button>}
    </div>}
    {source.length > 0 && !list.length && <p className="muted">{L('খোঁজা বা ফিল্টারের সাথে কিছু মিলছে না।', 'Nothing matches the search or filters.')} <button type="button" className="link" onClick={() => { setQ(''); save({ filters: {} }) }}>{L('সব দেখান', 'Show all')}</button></p>}
    {view === 'table' && <div className="da-table-wrap"><table className="da-table"><thead><tr>
      <th className="ck no-print"><input type="checkbox" aria-label={L('সব চিহ্নিত', 'Mark all')} checked={all} onChange={e => setMarked(e.target.checked ? new Set(list.map(rowKey)) : new Set())} /></th>
      <th>S/L</th>{cols.map(c => canSort(c)
        ? <th key={c.key} className={`${c.className ?? ''} dv-sort`} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
            <button type="button" onClick={() => toggleSort(c)} title={L('সাজান', 'Sort')}>{c.label}<span className="dv-arrow">{sort?.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : ''}</span></button></th>
        : <th key={c.key} className={c.className}>{c.label}</th>)}</tr></thead>
      <tbody>{shown.map((r, j) => { const i = pg * size + j; const k = rowKey(r); const on = mk.has(k); return <tr key={k} className={`${onRowClick ? 'click' : ''}${on ? ' marked' : ''}`} onClick={() => onRowClick?.(r)}>
        <td className="ck no-print" onClick={e => e.stopPropagation()}>{mark(r, i)}</td>
        <td className="muted sl">{n(i + 1)}</td>{cols.map(c => <td key={c.key} className={c.className} data-label={c.label || undefined}>{show(c, r)}</td>)}</tr> })}</tbody></table></div>}
    {view === 'card' && <div className="dv-cards">{shown.map((r, j) => { const i = pg * size + j; const k = rowKey(r); return <article key={k} className={`dv-card${onRowClick ? ' click' : ''}${mk.has(k) ? ' marked' : ''}`} onClick={() => onRowClick?.(r)}>
      <header><span className="no-print">{mark(r, i)}</span><b>{show(titleCol, r)}</b><span className="muted small">{n(i + 1)}</span></header>
      <dl>{cols.filter(c => c !== titleCol).map(c => <div key={c.key} className={c.noExport ? 'act' : ''}>{c.label && !c.noExport ? <dt>{c.label}</dt> : null}<dd>{show(c, r)}</dd></div>)}</dl>
    </article> })}</div>}
    {view === 'list' && <ul className="dv-list">{shown.map((r, j) => { const i = pg * size + j; const k = rowKey(r); return <li key={k} className={`${onRowClick ? 'click' : ''}${mk.has(k) ? ' marked' : ''}`} onClick={() => onRowClick?.(r)}>
      <span className="no-print">{mark(r, i)}</span>
      <div className="dv-line"><b>{show(titleCol, r)}</b>
        <span className="dv-sub">{exp.filter(c => c !== titleCol && !c.hidden).map(c => { const v = cell(c, r); return v === '' ? null : <span key={c.key}><i>{c.label}</i> {c.render ? c.render(r) : String(v)}</span> })}</span></div>
      <span className="dv-acts">{cols.filter(c => c.noExport && c !== titleCol).map(c => <span key={c.key}>{show(c, r)}</span>)}</span>
    </li> })}</ul>}
    {list.length > SIZES[0] && <div className="dv-pager no-print">
      <label>{L('প্রতি পাতায়', 'Per page')} <select value={size} onChange={e => save({ size: Number(e.target.value) })}>{SIZES.map(s => <option key={s} value={s}>{n(s)}</option>)}</select></label>
      <span className="grow" />
      <button type="button" className="secondary sm" disabled={pg === 0} onClick={() => setPage(pg - 1)}>{L('আগের', 'Previous')}</button>
      <span className="muted small">{L(`পাতা ${n(pg + 1)} / ${n(pages)}`, `Page ${pg + 1} of ${pages}`)}</span>
      <button type="button" className="secondary sm" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>{L('পরের', 'Next')}</button>
    </div>}
  </>
}
