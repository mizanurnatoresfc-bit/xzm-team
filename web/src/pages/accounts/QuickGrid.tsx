import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { friendly } from '../../lib/dailyAccounts'

/**
 * A sheet you type straight into, like Excel.
 *  - every cell is an input; a blank line is always waiting at the bottom
 *  - Enter / ↓ / ↑ move between lines, Tab moves along the line
 *  - a line is saved by itself when you leave it (blur, or Enter), once its required cells are filled
 *  - Bengali digits are turned into ordinary digits as you type
 */
export type GCol = {
  key: string; label: string; type?: 'text' | 'number' | 'select'; width?: number; ro?: boolean; req?: boolean
  options?: Array<[string, string]>; placeholder?: string; calc?: (v: Vals) => string; list?: string; total?: boolean
}
export type Vals = Record<string, string>
type Draft = { k: string; id?: string; v: Vals; base: string; state: 'idle' | 'saving' | 'ok' | 'err'; err?: string }
const BN = '০১২৩৪৫৬৭৮৯'
const ascii = (s: string) => s.replace(/[০-৯]/g, c => String(BN.indexOf(c)))
const sig = (v: Vals) => JSON.stringify(v)
let seq = 0

export function QuickGrid({ cols, rows, blank, ready, save, onSaved, lookup, onRemove, editable = true, empty }: {
  cols: GCol[]; rows: Array<{ id: string; v: Vals }>; blank: () => Vals
  ready: (v: Vals) => string | null            // null = ready to save, otherwise why not (not shown unless the line was touched)
  save: (v: Vals, id?: string) => Promise<void>
  onSaved: () => Promise<void>
  lookup?: { key: string; run: (value: string) => Promise<Vals> }
  onRemove?: (id: string) => void
  editable?: boolean; empty?: string
}) {
  const [drafts, setDrafts] = useState<Draft[]>([])
  const ref = useRef<Draft[]>([]); ref.current = drafts
  const box = useRef<HTMLDivElement>(null)
  const saving = useRef(new Set<string>())
  const fresh = useCallback((): Draft => { const v = blank(); return { k: `n${++seq}`, v, base: sig(v), state: 'idle' } }, [blank])

  // Bring in what the server has; keep lines the person is still typing.
  useEffect(() => {
    setDrafts(cur => {
      const byId = new Map(cur.filter(d => d.id).map(d => [d.id!, d]))
      const out: Draft[] = rows.map(r => {
        const old = byId.get(r.id)
        if (old && sig(old.v) !== old.base) return old                      // unsaved edits stay
        return { k: r.id, id: r.id, v: r.v, base: sig(r.v), state: old?.state === 'ok' ? 'ok' : 'idle' }
      })
      const typing = cur.filter(d => !d.id && (sig(d.v) !== d.base || d.state === 'saving' || d.state === 'err'))
      return [...out, ...(editable ? (typing.length ? typing : [fresh()]) : [])]
    })
  }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (k: string, f: (d: Draft) => Draft) => setDrafts(cur => cur.map(d => d.k === k ? f(d) : d))

  async function commit(k: string): Promise<boolean> {
    const d = ref.current.find(x => x.k === k)
    if (!d || saving.current.has(k) || sig(d.v) === d.base || ready(d.v) !== null) return false
    saving.current.add(k); patch(k, x => ({ ...x, state: 'saving', err: undefined }))
    try {
      await save(d.v, d.id)
      if (d.id) patch(k, x => ({ ...x, base: sig(d.v), state: 'ok' }))
      else setDrafts(cur => { const rest = cur.filter(x => x.k !== k); return rest.some(x => !x.id) ? rest : [...rest, fresh()] })
      await onSaved(); return true
    } catch (e) { patch(k, x => ({ ...x, state: 'err', err: friendly(e) })); return false }
    finally { saving.current.delete(k) }
  }

  async function runLookup(k: string, value: string) {
    if (!lookup || !value.trim()) return
    try { const extra = await lookup.run(value); patch(k, x => ({ ...x, v: { ...x.v, ...extra } })) } catch { /* the save will say what is wrong */ }
  }

  const focus = (r: number, c: number) => {
    const el = box.current?.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`)
    if (el) { el.focus(); if (el instanceof HTMLInputElement) el.select() }
  }
  function key(e: KeyboardEvent, r: number, c: number, k: string) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const last = r >= ref.current.length - 1
      // let a pending lookup (the ID cell) finish writing its name before the line is saved
      const done = new Promise<boolean>(res => window.setTimeout(() => void commit(k).then(res), 60))
      if (!last) focus(r + 1, c)
      else void done.then(ok => { if (ok) window.setTimeout(() => focus(ref.current.length - 1, 0), 0) })
    }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focus(Math.min(r + 1, ref.current.length - 1), c) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focus(Math.max(r - 1, 0), c) }
  }

  const sum = (key: string) => rows.reduce((a, r) => a + (+ascii(r.v[key] ?? '') || 0), 0)
  return <div className="qg-wrap" ref={box}>
    <table className="qg"><thead><tr><th className="qn">#</th>{cols.map(c => <th key={c.key} style={c.width ? { minWidth: c.width } : undefined} className={c.type === 'number' ? 'r' : ''}>{c.label}</th>)}<th className="qs" /></tr></thead>
      <tbody>{drafts.map((d, r) => {
        const dirty = sig(d.v) !== d.base
        return <tr key={d.k} className={`${d.id ? '' : 'new'}${d.state === 'err' ? ' err' : ''}${dirty ? ' dirty' : ''}`}
          onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) void commit(d.k) }}>
          <td className="qn">{d.id ? r + 1 : '＋'}</td>
          {cols.map((c, ci) => {
            const val = c.calc ? c.calc(d.v) : d.v[c.key] ?? ''
            const ro = !editable || c.ro || !!c.calc
            const set = (x: string) => patch(d.k, y => ({ ...y, state: 'idle', v: { ...y.v, [c.key]: c.type === 'number' ? ascii(x).replace(/[^0-9.\-]/g, '') : x } }))
            return <td key={c.key} className={c.type === 'number' ? 'r' : ''}>
              {c.type === 'select'
                ? <select data-r={r} data-c={ci} value={val} disabled={ro} onChange={e => set(e.target.value)} onKeyDown={e => key(e, r, ci, d.k)}>{(c.options ?? []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                : <input data-r={r} data-c={ci} value={val} readOnly={ro} tabIndex={ro ? -1 : 0} placeholder={ro ? '' : c.placeholder} list={c.list}
                    inputMode={c.type === 'number' ? 'decimal' : undefined} autoComplete="off"
                    onChange={e => set(e.target.value)} onKeyDown={e => key(e, r, ci, d.k)}
                    onBlur={e => { if (lookup && c.key === lookup.key) void runLookup(d.k, e.target.value) }} />}
            </td> })}
          <td className="qs">{d.state === 'saving' ? '…' : d.state === 'err' ? <span className="bad" title={d.err}>⚠</span> : d.state === 'ok' && !dirty ? <span className="ok">✓</span>
            : dirty && ready(d.v) !== null && d.v && Object.values(d.v).some(x => x) && d.id ? <span className="muted" title={ready(d.v) ?? ''}>…</span> : null}
            {d.id && editable && onRemove && <button type="button" className="qx" aria-label="বাদ দিন" onClick={() => onRemove(d.id!)}>✕</button>}</td>
          {d.state === 'err' && d.err && <td className="qerr" colSpan={cols.length + 2}>{d.err}</td>}
        </tr> })}
        {!drafts.length && empty && <tr><td colSpan={cols.length + 2} className="muted">{empty}</td></tr>}</tbody>
      {cols.some(c => c.total) && rows.length > 0 && <tfoot><tr><td className="qn" />{cols.map(c => <td key={c.key} className="r">{c.total ? <b>{sum(c.key).toLocaleString('bn-BD')}</b> : ''}</td>)}<td /></tr></tfoot>}
    </table></div>
}
