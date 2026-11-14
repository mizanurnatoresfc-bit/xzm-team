import { useMemo, useState, type ReactNode } from 'react'
import { download, xlsxBlob } from '../lib/xlsx'
import { usePrefs } from '../lib/prefs'
import { Icon } from './Icon'

export type Col<T> = { key: string; label: string; render?: (r: T) => ReactNode; value?: (r: T) => string | number | null; className?: string; noExport?: boolean }

/** Table with the demo's list tools: S/L, mark / unmark rows, print, Excel and PDF (print to PDF) of all or marked rows. */
export function DataTable<T>({ title, rows, cols, rowKey, onRowClick, empty, file }: {
  title: string; rows: T[] | null | undefined; cols: Array<Col<T>>; rowKey: (r: T) => string; onRowClick?: (r: T) => void; empty?: ReactNode; file?: string
}) {
  const { L, n } = usePrefs()
  const [marked, setMarked] = useState<Set<string>>(new Set())
  const list = useMemo(() => rows ?? [], [rows])
  const keys = useMemo(() => new Set(list.map(rowKey)), [list, rowKey])
  const mk = new Set([...marked].filter(k => keys.has(k)))
  const pick = () => mk.size ? list.filter(r => mk.has(rowKey(r))) : list
  const exp = cols.filter(c => !c.noExport)
  const cell = (c: Col<T>, r: T) => { const v = c.value ? c.value(r) : (r as Record<string, unknown>)[c.key]; return v === null || v === undefined ? '' : (v as string | number) }
  const scope = () => mk.size ? L(`${n(mk.size)}টি চিহ্নিত সারি`, `${mk.size} marked rows`) : L(`সব ${n(list.length)}টি সারি`, `all ${list.length} rows`)
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
  if (rows && !list.length) return <>{empty ?? <p className="muted">{L('কিছু নেই।', 'Nothing here yet.')}</p>}</>
  const all = list.length > 0 && mk.size === list.length
  return <>
    <div className="list-tools no-print">
      <span className="cnt"><b>{n(list.length)}</b>{L('টি', ' rows')}{mk.size ? <em>{L(` · ${n(mk.size)} চিহ্নিত`, ` · ${mk.size} marked`)}</em> : null}</span>
      <span className="grow" />
      <div className="tool-group" role="group" aria-label={L('তালিকার কাজ', 'List tools')}>
        <button type="button" className={`tb${mk.size ? ' on' : ''}`} onClick={() => setMarked(mk.size ? new Set() : new Set(list.map(rowKey)))}
          title={mk.size ? L('চিহ্ন তুলুন', 'Unmark all') : L('সব চিহ্নিত', 'Mark all')} aria-label={mk.size ? L('চিহ্ন তুলুন', 'Unmark all') : L('সব চিহ্নিত', 'Mark all')}>
          <Icon name={mk.size ? 'uncheck' : 'checkall'} size={16} /><span className="tl">{mk.size ? L('তুলুন', 'Unmark') : L('সব', 'All')}</span></button>
        <button type="button" className="tb" onClick={() => print(false)} disabled={!list.length} title={L('প্রিন্ট', 'Print')} aria-label={L('প্রিন্ট', 'Print')}><Icon name="print" size={16} /><span className="tl">{L('প্রিন্ট', 'Print')}</span></button>
        <button type="button" className="tb xls" onClick={excel} disabled={!list.length} title="Excel" aria-label="Excel"><Icon name="xls" size={16} /><span className="tl">Excel</span></button>
        <button type="button" className="tb pdf" onClick={() => print(true)} disabled={!list.length} title="PDF" aria-label="PDF"><Icon name="pdf" size={16} /><span className="tl">PDF</span></button>
      </div>
    </div>
    <div className="da-table-wrap"><table className="da-table"><thead><tr>
      <th className="ck no-print"><input type="checkbox" aria-label={L('সব চিহ্নিত', 'Mark all')} checked={all} onChange={e => setMarked(e.target.checked ? new Set(list.map(rowKey)) : new Set())} /></th>
      <th>S/L</th>{cols.map(c => <th key={c.key} className={c.className}>{c.label}</th>)}</tr></thead>
      <tbody>{list.map((r, i) => { const k = rowKey(r); const on = mk.has(k); return <tr key={k} className={`${onRowClick ? 'click' : ''}${on ? ' marked' : ''}`} onClick={() => onRowClick?.(r)}>
        <td className="ck no-print" onClick={e => e.stopPropagation()}><input type="checkbox" aria-label={L(`সারি ${i + 1} চিহ্নিত`, `Mark row ${i + 1}`)} checked={on}
          onChange={e => { const s = new Set(mk); if (e.target.checked) s.add(k); else s.delete(k); setMarked(s) }} /></td>
        <td className="muted sl">{n(i + 1)}</td>{cols.map(c => <td key={c.key} className={c.className} data-label={c.label || undefined}>{c.render ? c.render(r) : String(cell(c, r) || '—')}</td>)}</tr> })}</tbody></table></div>
  </>
}
