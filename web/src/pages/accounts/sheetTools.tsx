// The sheet as a tool: a ⋮ menu on every part (add a line, print this part, Excel of this part, lay out its
// columns, switch it off), own columns with values per line, and the bank part (report IDs, deposits, slips).
import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  da, num, taka, dateBn, timeBn, todayDhaka, NOTE_METHOD,
  type Sheet, type DaSettings, type Layout, type SectionLayout, type BankCharge, type ReportId, type Deposit,
} from '../../lib/dailyAccounts'
import { xlsxBlob, download } from '../../lib/xlsx'
import { MATCH_LABEL } from '../../lib/accountsGuide'
import { findAmount, readImage } from '../../lib/ocr'
import { LearnButton } from '../../components/Learn'
import { Badge, Modal, Field, ErrorNote, Stat } from './ui'

// ---------------------------------------------------------------------------- the parts of the sheet
export const SECTIONS: Array<{ key: string; label: string }> = [
  { key: 'riders', label: 'রাইডার-ভিত্তিক হিসাব' },
  { key: 'payment', label: 'মার্চেন্ট ক্যাশ পেমেন্ট' },
  { key: 'expense', label: 'যাতায়াত ও হাব কর্মীর খরচ' },
  { key: 'claims', label: 'কর্মীদের জমা দেওয়া বিল' },
  { key: 'notes', label: 'জমা ও নোট' },
  { key: 'reports', label: 'আপডেট রিপোর্ট আইডি' },
  { key: 'deposits', label: 'ব্যাংক ডিপোজিট' },
]

export const layoutOf = (settings: DaSettings, key: string): SectionLayout => (settings['da.layout'] ?? {})[key] ?? {}
export const isOff = (settings: DaSettings, key: string) => !!layoutOf(settings, key).off

// ---------------------------------------------------------------------------- applying the layout to the tables
/** Hides columns and renames headers in every table marked data-sec="…", also after the table re-renders. */
export function useApplyLayout(root: RefObject<HTMLElement | null>, layout: Layout, ready: unknown) {
  useEffect(() => {
    const el = root.current
    if (!el) return
    const apply = () => {
      el.querySelectorAll<HTMLTableElement>('table[data-sec]').forEach(table => {
        const cfg = layout[table.dataset.sec ?? ''] ?? {}
        const hidden = new Set(cfg.hidden ?? [])
        const heads = Array.from(table.querySelectorAll<HTMLTableCellElement>('thead tr:first-child > th'))
        const hide: boolean[] = []
        heads.forEach((th, i) => {
          if (th.dataset.orig === undefined) th.dataset.orig = (th.textContent ?? '').trim()
          const orig = th.dataset.orig
          const label = cfg.labels?.[orig]
          if (label && th.children.length === 0 && th.textContent !== label) th.textContent = label
          if (!label && th.children.length === 0 && orig && th.textContent !== orig) th.textContent = orig
          hide[i] = !!orig && hidden.has(orig)
          th.style.display = hide[i] ? 'none' : ''
        })
        table.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach(tr => {
          if (tr.cells.length !== heads.length) return
          Array.from(tr.cells).forEach((td, i) => { td.style.display = hide[i] ? 'none' : '' })
        })
      })
    }
    apply()
    const mo = new MutationObserver(() => apply())
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    return () => mo.disconnect()
  }, [root, layout, ready])
}

// ---------------------------------------------------------------------------- print and Excel of one part
function tableOf(sectionEl: HTMLElement | null) {
  return sectionEl?.querySelector<HTMLTableElement>('table') ?? null
}
const visible = (c: HTMLElement) => c.style.display !== 'none' && !c.classList.contains('no-print')

export function exportSection(sectionEl: HTMLElement | null, title: string, subtitle: string) {
  const table = tableOf(sectionEl)
  if (!table) return
  const heads = Array.from(table.querySelectorAll<HTMLTableCellElement>('thead tr:first-child > th'))
  const keep = heads.map(visible)
  const rows: Array<Array<string | number | null>> = []
  table.querySelectorAll<HTMLTableRowElement>('tbody tr, tfoot tr').forEach(tr => {
    const cells = Array.from(tr.cells)
    if (cells.length === heads.length) rows.push(cells.filter((_, i) => keep[i]).map(c => cleanCell(c.innerText)))
    else rows.push(cells.filter(visible).map(c => cleanCell(c.innerText)))
  })
  const names = heads.filter((_, i) => keep[i]).map(h => (h.textContent ?? '').trim())
  download(xlsxBlob(title, subtitle, names, rows), `${title.replace(/[^\p{L}\p{N}]+/gu, '-')}.xlsx`)
}
const cleanCell = (t: string) => {
  const v = t.replace(/\s+/g, ' ').trim()
  const plain = v.replace(/[৳,\s]/g, '').replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d)))
  return /^-?\d+(\.\d+)?$/.test(plain) ? Number(plain) : v
}

export function printSection(sectionEl: HTMLElement | null, title: string) {
  if (!sectionEl) return
  const old = document.title
  sectionEl.classList.add('print-solo'); document.body.classList.add('printing-solo'); document.title = title
  const done = () => {
    sectionEl.classList.remove('print-solo'); document.body.classList.remove('printing-solo'); document.title = old
    window.removeEventListener('afterprint', done)
  }
  window.addEventListener('afterprint', done)
  window.print()
}

// ---------------------------------------------------------------------------- the ⋮ menu
type MenuItem = { label: string; onClick: () => void; danger?: boolean; hide?: boolean }

export function DotMenu({ items, label = 'আরও' }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [open])
  const shown = items.filter(i => !i.hide)
  return <div className="dot-menu no-print" ref={box}>
    <button type="button" className="icon" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>⋮</button>
    {open && <div className="dot-pop" role="menu">
      {shown.map(i => <button key={i.label} type="button" role="menuitem" className={i.danger ? 'mi danger-text' : 'mi'}
        onClick={() => { setOpen(false); i.onClick() }}>{i.label}</button>)}
    </div>}
  </div>
}

/** The ⋮ of one part of the sheet. */
export function SectionMenu({ sec, title, s, settings, onAdd, addLabel, onLayoutSaved }: {
  sec: string; title: string; s: Sheet; settings: DaSettings; onAdd?: () => void; addLabel?: string
  onLayoutSaved: (msg: string) => Promise<void>
}) {
  const [dlg, setDlg] = useState(false)
  const el = () => document.querySelector(`table[data-sec="${sec}"]`)?.closest<HTMLElement>('section') ?? null
  const sub = `${s.hub.name} · ${dateBn(s.session.account_date)} · হিসাব নং ${num(s.session.no)}`
  return <>
    <DotMenu label={`${title} — আরও`} items={[
      { label: addLabel ?? '＋ নতুন লাইন', onClick: () => onAdd?.(), hide: !onAdd || !s.can_edit },
      { label: 'এই অংশ প্রিন্ট / পিডিএফ', onClick: () => printSection(el(), `${title} — ${sub}`) },
      { label: 'এই অংশ এক্সেলে', onClick: () => exportSection(el(), title, sub) },
      { label: 'কলাম সাজান (দেখান, লুকান, নাম বদল, নতুন কলাম)', onClick: () => setDlg(true), hide: !s.can_layout },
      { label: 'এই অংশ বন্ধ করুন', danger: true, hide: !s.can_layout, onClick: () => {
        if (!window.confirm(`"${title}" অংশটা সবার জন্য বন্ধ হবে। হিসাব সেটিংস থেকে আবার চালু করা যাবে।`)) return
        const all: Layout = { ...(settings['da.layout'] ?? {}) }
        all[sec] = { ...(all[sec] ?? {}), off: true }
        void da.configure('da.layout', all).then(() => onLayoutSaved(`"${title}" বন্ধ করা হলো`))
      } },
    ]} />
    {dlg && <LayoutDialog sec={sec} title={title} settings={settings} onClose={() => setDlg(false)}
      onSaved={async () => { setDlg(false); await onLayoutSaved('কলাম সাজানো সংরক্ষিত') }} />}
  </>
}

/** Show, hide and rename the columns of one part, and add columns of one's own. */
function LayoutDialog({ sec, title, settings, onClose, onSaved }: {
  sec: string; title: string; settings: DaSettings; onClose: () => void; onSaved: () => Promise<void>
}) {
  const cur = layoutOf(settings, sec)
  const table = document.querySelector<HTMLTableElement>(`table[data-sec="${sec}"]`)
  const heads = Array.from(table?.querySelectorAll<HTMLTableCellElement>('thead tr:first-child > th') ?? [])
    .map(th => th.dataset.orig ?? (th.textContent ?? '').trim()).filter(Boolean)
  const own = new Set((cur.extra ?? []).map(x => x.label))
  const builtIn = heads.filter(h => !own.has(h) && !(cur.extra ?? []).some(x => cur.labels?.[x.label] === h))
  const [hidden, setHidden] = useState<string[]>(cur.hidden ?? [])
  const [labels, setLabels] = useState<Record<string, string>>(cur.labels ?? {})
  const [extra, setExtra] = useState(cur.extra ?? [])
  const [nw, setNw] = useState('')
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false)

  function addCol() {
    const label = nw.trim()
    if (!label) return
    const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'col'
    let key = `x_${base}`.slice(0, 32); let n = 2
    while (extra.some(x => x.key === key)) key = `x_${base}_${n++}`.slice(0, 32)
    setExtra([...extra, { key, label }]); setNw('')
  }
  async function save() {
    setBusy(true); setErr(null)
    try {
      const cleanLabels = Object.fromEntries(Object.entries(labels).filter(([k, v]) => v.trim() && v.trim() !== k).map(([k, v]) => [k, v.trim()]))
      const all: Layout = { ...(settings['da.layout'] ?? {}) }
      all[sec] = { ...cur, hidden, labels: cleanLabels, extra }
      await da.configure('da.layout', all)
      await onSaved()
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  return <Modal title={`কলাম সাজান — ${title}`} wide onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>বাতিল</button><button disabled={busy} onClick={() => void save()}>{busy ? 'সেভ হচ্ছে…' : 'সেভ — সবার জন্য'}</button></>}>
    <p className="muted small">টিক তুলে দিলে কলাম লুকাবে। নামের ঘরে নতুন নাম লিখলে সেই নামে দেখাবে। সব হাবের খাতায় একই রকম হবে।</p>
    <div className="lay-list">
      {builtIn.map(h => <div key={h} className="lay-row">
        <label className="da-check" style={{ margin: 0 }}><input type="checkbox" checked={!hidden.includes(h)}
          onChange={e => setHidden(e.target.checked ? hidden.filter(x => x !== h) : [...hidden, h])} /> {h}</label>
        <input aria-label={`${h} — নতুন নাম`} placeholder="নতুন নাম (ঐচ্ছিক)" value={labels[h] ?? ''}
          onChange={e => setLabels({ ...labels, [h]: e.target.value })} />
      </div>)}
      {builtIn.length === 0 && <p className="muted small">এই অংশে এখনো কোনো টেবিল দেখা যাচ্ছে না — অংশটা খুলে আবার চেষ্টা করুন।</p>}
    </div>
    <h3>নিজের কলাম</h3>
    <p className="muted small">যেমন: পয়েন্ট, গাড়ি নং, রেফারেন্স। প্রতিটা লাইনে এই ঘরে লেখা যাবে।</p>
    <div className="lay-list">
      {extra.map(x => <div key={x.key} className="lay-row">
        <input aria-label="কলামের নাম" value={x.label} onChange={e => setExtra(extra.map(y => y.key === x.key ? { ...y, label: e.target.value } : y))} />
        <button type="button" className="danger sm" onClick={() => setExtra(extra.filter(y => y.key !== x.key))}>বাদ</button>
      </div>)}
      <div className="lay-row"><input placeholder="নতুন কলামের নাম" value={nw} onChange={e => setNw(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCol() } }} />
        <button type="button" className="secondary sm" onClick={addCol}>＋ কলাম</button></div>
    </div>
    <ErrorNote error={err} />
  </Modal>
}

// ---------------------------------------------------------------------------- own columns
export function ExtraHeads({ settings, sec }: { settings: DaSettings; sec: string }) {
  return <>{(layoutOf(settings, sec).extra ?? []).map(x => <th key={x.key}>{x.label}</th>)}</>
}
export function ExtraBlanks({ settings, sec }: { settings: DaSettings; sec: string }) {
  return <>{(layoutOf(settings, sec).extra ?? []).map(x => <td key={x.key} />)}</>
}
export function ExtraCells({ s, settings, sec, row, reload }: {
  s: Sheet; settings: DaSettings; sec: string; row: string; reload: (m?: string) => Promise<void>
}) {
  const cols = layoutOf(settings, sec).extra ?? []
  const val = (col: string) => s.cells?.find(c => c.section === sec && c.row_id === row && c.col === col)?.value ?? ''
  async function edit(col: string, label: string) {
    const v = window.prompt(label, val(col))
    if (v === null) return
    try { await da.setCell(s.session.id, sec, row, col, v); await reload('সংরক্ষিত') }
    catch (e) { window.alert(String((e as Error).message ?? e)) }
  }
  return <>{cols.map(x => <td key={x.key} data-l={x.label}>
    {s.can_edit ? <button type="button" className="link cell-edit" onClick={() => void edit(x.key, x.label)}>{val(x.key) || <span className="muted">＋</span>}</button>
      : val(x.key) || '—'}</td>)}</>
}

// ---------------------------------------------------------------------------- the bank charge, worked out here too
export const DEFAULT_CHARGE: BankCharge = { limit: 100000, low: 20, high: 100, vat: 15, off_days: [5, 6], holidays: [], transport: 60 }
export function bankOff(cfg: BankCharge, date: string) {
  const dow = ((new Date(`${date}T00:00:00`).getDay() + 6) % 7) + 1
  return (cfg.off_days ?? []).map(String).includes(String(dow)) || (cfg.holidays ?? []).includes(date)
}
export function chargeFor(cfg: BankCharge, amount: number, method: string, date: string) {
  if (method !== 'bank' || amount <= 0 || bankOff(cfg, date)) return 0
  const fee = amount <= cfg.limit ? cfg.low : cfg.high
  return Math.round(fee * (1 + cfg.vat / 100) * 100) / 100
}

// ---------------------------------------------------------------------------- the bank part
type RDraft = { id?: string; no: string; amount: string; remarks: string; text?: string; file?: File | null }
type DDraft = { id?: string; amount: string; method: string; bank: string; ref: string; date: string; people: string
  transport: string; charge: string; byHand: boolean; slip: string | null; remarks: string }

export function BankPanel({ s, settings, reload, onLayoutSaved }: { s: Sheet; settings: DaSettings; reload: (m?: string) => Promise<void>
  onLayoutSaved: (m: string) => Promise<void> }) {
  const cfg = settings['da.bank_charge'] ?? DEFAULT_CHARGE
  const reports = s.report_ids ?? []
  const deposits = s.deposits ?? []
  const [r, setR] = useState<RDraft | null>(null)
  const [d, setD] = useState<DDraft | null>(null)
  const [drop, setDrop] = useState<{ kind: 'report' | 'deposit'; id: string; what: string } | null>(null)
  const [why, setWhy] = useState('')
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [slipFile, setSlipFile] = useState<File | null>(null)
  const [reading, setReading] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Deposit | null>(null)
  const [cNote, setCNote] = useState('')
  const canConfirm = s.can_edit || s.can_verify

  const reportTotal = reports.reduce((a, x) => a + x.amount, 0)
  const merchant = s.merchant_payments.reduce((a, m) => a + m.amount, 0)
  const expense = s.expenses.reduce((a, x) => a + x.amount, 0)
  const charges = deposits.reduce((a, x) => a + x.charge, 0)
  const transport = deposits.reduce((a, x) => a + x.transport, 0)
  const totalExpense = merchant + expense + charges + transport
  const bankAmount = reportTotal - totalExpense
  const deposited = deposits.reduce((a, x) => a + x.amount, 0)
  const due = Math.round((bankAmount - deposited) * 100) / 100
  const slipsMissing = deposits.filter(x => !x.slip_path).length
  const done = !!s.session.bank_done_at

  const blankD = (): DDraft => {
    const date = s.session.account_date
    const amount = bankAmount > 0 ? bankAmount : 0
    return { amount: amount ? String(amount) : '', method: 'bank', bank: '', ref: '', date, people: '', remarks: '',
      transport: String(bankOff(cfg, date) ? 0 : cfg.transport ?? 0), charge: '', byHand: false, slip: null }
  }
  const autoCharge = d ? chargeFor(cfg, +d.amount || 0, d.method, d.date) : 0

  async function saveR() {
    if (!r) return
    setBusy(true); setErr(null)
    try {
      const id = await da.saveReport({ session: s.session.id, reportNo: r.no, amount: +r.amount || 0, remarks: r.remarks || null, id: r.id })
      const rid = id || r.id
      // the report's screenshot / PDF / text stays with its ID (saved under this hub and date, as this sheet is)
      if (rid && (r.file || r.text?.trim())) {
        const path = r.file ? await da.upload(s.session.id, r.file, settings['da.bill_upload']) : null
        await da.reportAttach(rid, path, r.text?.trim() || null)
      }
      setR(null); await reload('রিপোর্ট আইডি সংরক্ষিত')
    }
    catch (e) { setErr(e) } finally { setBusy(false) }
  }
  /** Proposes the report ID and amount from the pasted text or a screenshot; the person checks them. */
  async function readReport() {
    if (!r) return
    setReading('রিপোর্ট পড়া হচ্ছে…'); setErr(null)
    try {
      let text = r.text ?? ''
      if (!text.trim() && r.file?.type.startsWith('image/')) text = (await readImage(r.file, 'eng')).text
      if (!text.trim()) { setErr(new Error('পড়ার মতো লেখা নেই — রিপোর্টের লেখা পেস্ট করুন বা স্ক্রিনশট দিন (পিডিএফ থেকে নিজে লিখুন)।')); return }
      const latin = text.replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d)))
      const id = latin.match(/#\s?(\d{4,})/) ?? latin.match(/report\s*(?:id|no\.?)?\s*[:#]?\s*(\d{4,})/i)
      const amount = findAmount(latin)
      setR(x => x && ({ ...x, no: x.no || (id ? '#' + id[1] : ''), amount: x.amount || (amount !== null ? String(amount) : ''), text: x.text || text.slice(0, 20000) }))
    } catch (e) { setErr(e) } finally { setReading(null) }
  }
  /** Reads the slip with OCR and records MATCH / NOT MATCH / NEEDS REVIEW — never a confirmation. */
  async function readSlip(depId: string, f: File | null) {
    setReading('স্লিপ পড়া হচ্ছে…')
    try {
      if (f && f.type.startsWith('image/')) {
        const o = await readImage(f, 'eng')
        await da.slipRead(depId, findAmount(o.text.replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d)))), o.confidence)
      } else await da.slipRead(depId, null, null)
    } catch { await da.slipRead(depId, null, null).catch(() => undefined) } finally { setReading(null) }
  }
  async function doConfirm(undo = false) {
    if (!confirm) return
    setBusy(true); setErr(null)
    try { await da.confirmDeposit(confirm.id, !undo, cNote || null); setConfirm(null); setCNote(''); await reload(undo ? 'নিশ্চয়তা তুলে নেওয়া হলো' : 'ব্যাংকে জমা নিশ্চিত হয়েছে') }
    catch (e) { setErr(e) } finally { setBusy(false) }
  }
  async function saveD() {
    if (!d) return
    setBusy(true); setErr(null)
    try {
      const saved = da.saveDeposit({ session: s.session.id, amount: +d.amount || 0, method: d.method, bank: d.bank || null, ref: d.ref || null,
        slip: d.slip, date: d.date, transport: d.transport === '' ? null : +d.transport, charge: d.byHand ? +d.charge || 0 : null,
        people: d.people || null, remarks: d.remarks || null, id: d.id })
      const id = await saved
      if (slipFile && d.slip) await readSlip(id, slipFile)
      setD(null); setSlipFile(null); await reload('ডিপোজিট সংরক্ষিত')
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  async function slip(f: File, dep?: Deposit) {
    setUploading(true); setErr(null)
    try {
      const path = await da.upload(s.session.id, f, settings['da.bill_upload'])
      if (dep) {
        await da.saveDeposit({ session: s.session.id, amount: dep.amount, method: dep.method, bank: dep.bank_name, ref: dep.ref_no, slip: path,
          date: dep.deposited_on, transport: dep.transport, charge: dep.charge_auto ? null : dep.charge, people: dep.people, remarks: dep.remarks, id: dep.id })
        await readSlip(dep.id, f)
        await reload('স্লিপ আপলোড হয়েছে — মিলিয়ে দেখা হলো')
      } else { setSlipFile(f); setD(x => x && ({ ...x, slip: path })) }
    } catch (e) { setErr(e) } finally { setUploading(false) }
  }
  async function finish() {
    setBusy(true); setErr(null)
    try { await da.bankDone(s.session.id); await reload('আজকের ব্যাংক টাস্ক সম্পন্ন') } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  async function remove() {
    if (!drop) return
    try {
      if (drop.kind === 'report') await da.removeReport(drop.id, why); else await da.removeDeposit(drop.id, why)
      setDrop(null); setWhy(''); await reload('বাদ দেওয়া হয়েছে')
    } catch (e) { setErr(e) }
  }
  const editR = (x: ReportId) => setR({ id: x.id, no: x.report_no, amount: String(x.amount), remarks: x.remarks ?? '' })
  const editD = (x: Deposit) => setD({ id: x.id, amount: String(x.amount), method: x.method, bank: x.bank_name ?? '', ref: x.ref_no ?? '',
    date: x.deposited_on, people: x.people ?? '', transport: String(x.transport), charge: String(x.charge), byHand: !x.charge_auto, slip: x.slip_path, remarks: x.remarks ?? '' })

  return <>
    <section className="panel" id="sec-reports">
      <div className="da-bar"><h2>আপডেট রিপোর্ট আইডি</h2>
        <div className="row no-print"><LearnButton module="daily_report" />{s.can_edit && <button onClick={() => { setErr(null); setR({ no: '', amount: '', remarks: '' }) }}>＋ রিপোর্ট আইডি</button>}
          <SectionMenu sec="reports" title="আপডেট রিপোর্ট আইডি" s={s} settings={settings} onAdd={() => setR({ no: '', amount: '', remarks: '' })} addLabel="＋ রিপোর্ট আইডি" onLayoutSaved={onLayoutSaved} /></div></div>
      <div className="da-table-wrap"><table className="da-table" data-sec="reports">
        <thead><tr><th>S/L</th><th>রিপোর্ট আইডি</th><th className="r">টোটাল এমাউন্ট</th><th>মন্তব্য</th><ExtraHeads settings={settings} sec="reports" /><th className="no-print" /></tr></thead>
        <tbody>{reports.map((x, i) => <tr key={x.id}>
          <td data-l="S/L">{num(i + 1)}</td><td data-l="রিপোর্ট আইডি"><b>{x.report_no}</b></td><td data-l="টাকা" className="r">{taka(x.amount)}</td><td data-l="মন্তব্য">{x.remarks ?? ''}{x.file_path ? <> · <SlipLink path={x.file_path} /></> : null}{x.raw_text ? <span className="sec" title={x.raw_text.slice(0, 400)}>রিপোর্টের লেখা আছে</span> : null}</td>
          <ExtraCells s={s} settings={settings} sec="reports" row={x.id} reload={reload} />
          <td className="no-print">{s.can_edit && <span className="row"><button className="secondary sm" onClick={() => editR(x)}>এডিট</button>
            <button className="danger sm" onClick={() => setDrop({ kind: 'report', id: x.id, what: `${x.report_no} · ${taka(x.amount)}` })}>বাদ</button></span>}</td></tr>)}
          {reports.length === 0 && <tr><td colSpan={5} className="muted">মেইন সাইটের আপডেট রিপোর্ট আইডি আর টোটাল এমাউন্ট লিখুন।</td></tr>}</tbody>
        {reports.length > 0 && <tfoot><tr><td colSpan={2}>মোট ({num(reports.length)} টি)</td><td className="r">{taka(reportTotal)}</td><td /><ExtraBlanks settings={settings} sec="reports" /><td className="no-print" /></tr></tfoot>}
      </table></div>
    </section>

    <section className="panel" id="sec-summary">
      <h2>ব্যাংকের হিসাব</h2>
      <div className="da-stats">
        <Stat label="মোট টাকা (রিপোর্ট)" value={taka(reportTotal)} />
        <Stat label="মোট খরচ" value={taka(totalExpense)} sub={`পেমেন্ট ${taka(merchant)} · খরচ ${taka(expense)} · চার্জ ${taka(charges)} · যাতায়াত ${taka(transport)}`} />
        <Stat label="মোট ব্যাংক এমাউন্ট" value={taka(bankAmount)} sub="মোট টাকা − মোট খরচ" />
        <Stat label="ব্যাংক ডিপোজিট" value={taka(deposited)} />
        <Stat label={due === 0 ? 'বকেয়া নেই' : due > 0 ? 'বকেয়া আছে' : 'বেশি জমা'} value={taka(Math.abs(due))} tone={due === 0 ? 'ok' : 'warn'} />
      </div>
      {reports.length === 0 && <p className="muted small">রিপোর্ট আইডি না দিলে "মোট টাকা" ০ থাকবে।</p>}
    </section>

    <section className="panel" id="sec-deposits">
      <div className="da-bar"><h2>ব্যাংক ডিপোজিট ও স্লিপ {done ? <Badge tone="ok">টাস্ক সম্পন্ন · {timeBn(s.session.bank_done_at)}</Badge> : null}</h2>
        <div className="row no-print"><LearnButton module="bank" />{s.can_edit && <button onClick={() => { setErr(null); setD(blankD()) }}>＋ ডিপোজিট</button>}
          <SectionMenu sec="deposits" title="ব্যাংক ডিপোজিট" s={s} settings={settings} onAdd={() => setD(blankD())} addLabel="＋ ডিপোজিট" onLayoutSaved={onLayoutSaved} /></div></div>
      <p className="muted small">চার্জ: ৳ {num(cfg.limit)} পর্যন্ত {taka(chargeFor(cfg, 1, 'bank', '2000-01-03'))}, তার বেশি হলে {taka(chargeFor(cfg, cfg.limit + 1, 'bank', '2000-01-03'))} (ভ্যাট {num(cfg.vat)}% সহ) · ছুটির দিনে চার্জ ও যাতায়াত নেই</p>
      <ErrorNote error={err && !d && !r ? err : null} />
      {reading && <p className="muted small" role="status">{reading}</p>}
      <div className="da-table-wrap"><table className="da-table" data-sec="deposits">
        <thead><tr><th>নং</th><th>মাধ্যম</th><th>ব্যাংক</th><th className="r">টাকা</th><th className="r">চার্জ</th><th className="r">যাতায়াত</th><th>কে গেছেন</th><th>তারিখ</th><th>রেফ নং</th><th>স্লিপ</th><th>স্লিপ মিল · ব্যাংকে নিশ্চিত</th><ExtraHeads settings={settings} sec="deposits" /><th className="no-print" /></tr></thead>
        <tbody>{deposits.map((x, i) => <tr key={x.id}>
          <td data-l="নং">{num(i + 1)}</td><td data-l="মাধ্যম">{NOTE_METHOD[x.method] ?? x.method}</td><td data-l="ব্যাংক">{x.bank_name ?? '—'}</td>
          <td data-l="টাকা" className="r"><b>{taka(x.amount)}</b></td>
          <td data-l="চার্জ" className="r">{taka(x.charge)}{!x.charge_auto && <span className="sec">হাতে লেখা</span>}</td>
          <td data-l="যাতায়াত" className="r">{taka(x.transport)}</td><td data-l="কে গেছেন">{x.people ?? '—'}</td>
          <td data-l="তারিখ">{dateBn(x.deposited_on)}</td><td data-l="রেফ নং">{x.ref_no ?? '—'}</td>
          <td data-l="স্লিপ">{x.slip_path ? <SlipLink path={x.slip_path} /> : s.can_edit
            ? <label className="secondary sm upload-btn no-print">{uploading ? 'আপলোড…' : 'স্লিপ দিন'}<input type="file" hidden accept="image/png,image/jpeg,application/pdf"
                onChange={e => { const f = e.target.files?.[0]; if (f) void slip(f, x) }} /></label> : <Badge tone="warn">বাকি</Badge>}</td>
          <td data-l="স্লিপ মিল · ব্যাংকে নিশ্চিত" className="dp-check">{x.slip_path ? <>
            {x.slip_match ? <Badge tone={MATCH_LABEL[x.slip_match][1] as 'ok' | 'bad' | 'warn'}>{MATCH_LABEL[x.slip_match][0]}</Badge> : <Badge tone="warn">পড়া হয়নি</Badge>}
            <span className="sec">{x.slip_ocr_amount !== null && x.slip_ocr_amount !== undefined ? `স্লিপে ${taka(x.slip_ocr_amount)}${x.slip_ocr_confidence ? ` (${num(x.slip_ocr_confidence)}%)` : ''} · ` : ''}
              স্লিপ দিয়েছেন {x.slip_uploaded_by_name ?? '—'}{x.slip_uploaded_at ? ` · ${timeBn(x.slip_uploaded_at)}` : ''}</span>
            {x.bank_confirmed_at ? <span className="sec ok">✓ ব্যাংকে নিশ্চিত — {x.bank_confirmed_by_name ?? ''} · {timeBn(x.bank_confirmed_at)}{x.bank_confirm_note ? ` · “${x.bank_confirm_note}”` : ''}</span>
              : canConfirm && <button type="button" className="secondary sm no-print" onClick={() => { setErr(null); setCNote(''); setConfirm(x) }}>ব্যাংকে নিশ্চিত করুন</button>}
            {x.bank_confirmed_at && canConfirm && <button type="button" className="link small no-print" onClick={() => { setErr(null); setCNote(''); setConfirm(x) }}>তুলে নিন</button>}
          </> : '—'}</td>
          <ExtraCells s={s} settings={settings} sec="deposits" row={x.id} reload={reload} />
          <td className="no-print">{s.can_edit && <span className="row"><button className="secondary sm" onClick={() => editD(x)}>এডিট</button>
            <button className="danger sm" onClick={() => setDrop({ kind: 'deposit', id: x.id, what: `${taka(x.amount)} · ${x.bank_name ?? NOTE_METHOD[x.method]}` })}>বাদ</button></span>}</td></tr>)}
          {deposits.length === 0 && <tr><td colSpan={12} className="muted">ব্যাংকে টাকা জমা দেওয়ার পর এখানে লিখুন, স্লিপের ছবি দিন।</td></tr>}</tbody>
        {deposits.length > 0 && <tfoot><tr><td colSpan={3}>মোট ({num(deposits.length)} টি)</td><td className="r">{taka(deposited)}</td><td className="r">{taka(charges)}</td><td className="r">{taka(transport)}</td><td colSpan={5} /><ExtraBlanks settings={settings} sec="deposits" /><td className="no-print" /></tr></tfoot>}
      </table></div>
      {s.can_edit && !done && <div className="row no-print" style={{ marginTop: 10 }}>
        <button disabled={busy || deposits.length === 0 || slipsMissing > 0} onClick={() => void finish()}>টাস্ক সম্পন্ন করুন</button>
        <span className="muted small">{deposits.length === 0 ? 'আগে ডিপোজিট লিখুন।' : slipsMissing > 0 ? `${num(slipsMissing)}টা স্লিপ বাকি।` : due !== 0 ? `সতর্কতা: হিসাবে ${taka(Math.abs(due))} ${due > 0 ? 'কম' : 'বেশি'} জমা।` : 'সব মিলেছে।'}</span>
      </div>}
    </section>

    {r && <Modal title={r.id ? 'রিপোর্ট আইডি এডিট' : 'আপডেট রিপোর্ট আইডি'} onClose={() => setR(null)}
      actions={<><button className="secondary" onClick={() => setR(null)}>বাতিল</button><button disabled={busy || !r.no.trim()} onClick={() => void saveR()}>সেভ</button></>}>
      <div className="da-grid3">
        <Field label="রিপোর্ট আইডি *"><input autoFocus value={r.no} placeholder="#731417" onChange={e => setR({ ...r, no: e.target.value })} /></Field>
        <Field label="টোটাল এমাউন্ট *"><input type="number" min={0} value={r.amount} onChange={e => setR({ ...r, amount: e.target.value })} /></Field>
        <Field label="মন্তব্য"><input value={r.remarks} onChange={e => setR({ ...r, remarks: e.target.value })} /></Field>
      </div>
      <div className="da-grid3">
        <Field label="রিপোর্টের স্ক্রিনশট বা পিডিএফ" hint="ছবি থেকে আইডি ও টাকা পড়ার চেষ্টা হয়; পিডিএফ হলে নিজে লিখুন"><input type="file" accept="image/png,image/jpeg,application/pdf"
          onChange={e => setR({ ...r, file: e.target.files?.[0] ?? null })} /></Field>
        <Field label="রিপোর্টের লেখা (কপি করে পেস্ট)" wide><textarea rows={3} value={r.text ?? ''} onChange={e => setR({ ...r, text: e.target.value })} placeholder="মেইন সাইটের রিপোর্ট থেকে কপি করা লেখা" /></Field>
      </div>
      <div className="row"><button type="button" className="secondary" disabled={!!reading || (!r.file && !r.text?.trim())} onClick={() => void readReport()}>{reading ?? 'লেখা/ছবি থেকে আইডি ও টাকা পড়ুন'}</button>
        <span className="muted small">পড়া মান মিলিয়ে নিন — রিপোর্টের তারিখ ও হাব এই খাতার সাথে মিলছে কিনা দেখুন।</span></div>
      <ErrorNote error={err} />
    </Modal>}

    {confirm && <Modal title={confirm.bank_confirmed_at ? 'ব্যাংকে জমার নিশ্চয়তা তুলে নেবেন?' : 'ব্যাংকে জমা নিশ্চিত করুন'} onClose={() => setConfirm(null)}
      actions={<><button className="secondary" onClick={() => setConfirm(null)}>বাতিল</button>
        {confirm.bank_confirmed_at ? <button className="danger" disabled={busy} onClick={() => void doConfirm(true)}>তুলে নিন</button>
          : <button disabled={busy || (confirm.slip_match !== 'match' && !cNote.trim())} onClick={() => void doConfirm()}>নিশ্চিত করছি</button>}</>}>
      <p><b>{taka(confirm.amount)}</b> · {confirm.bank_name ?? NOTE_METHOD[confirm.method]} · {dateBn(confirm.deposited_on)}{confirm.ref_no ? ` · রেফ ${confirm.ref_no}` : ''}</p>
      {!confirm.bank_confirmed_at && <>
        <p className="notice">OCR-এ পড়া টাকা ব্যাংকে জমার প্রমাণ নয়। স্লিপ নিজে দেখে (সম্ভব হলে ব্যাংক স্টেটমেন্ট/মেসেজ মিলিয়ে) তারপর নিশ্চিত করুন — আপনার নাম ও সময় রেকর্ডে থাকবে।</p>
        {confirm.slip_path && <p><SlipLink path={confirm.slip_path} /> স্লিপ দেখুন · {confirm.slip_match ? MATCH_LABEL[confirm.slip_match][0] : 'পড়া হয়নি'}</p>}
        <Field label={confirm.slip_match === 'match' ? 'মন্তব্য (ইচ্ছা হলে)' : 'মন্তব্য * — মেলেনি/পড়া যায়নি, কীভাবে মিলিয়েছেন লিখুন'}>
          <textarea rows={2} value={cNote} onChange={e => setCNote(e.target.value)} placeholder="যেমন: ব্যাংকের মেসেজে ৯৭,৪৫০ জমা দেখেছি" /></Field>
      </>}
      <ErrorNote error={err} />
    </Modal>}

    {d && <Modal title={d.id ? 'ডিপোজিট এডিট' : 'ব্যাংক ডিপোজিট'} wide onClose={() => setD(null)}
      actions={<><button className="secondary" onClick={() => setD(null)}>বাতিল</button><button disabled={busy || uploading || !(+d.amount > 0)} onClick={() => void saveD()}>সেভ</button></>}>
      <div className="da-grid3">
        <Field label="টাকা *" hint={bankAmount > 0 ? `ব্যাংক এমাউন্ট: ${taka(bankAmount)}` : undefined}><input type="number" min={1} value={d.amount} onChange={e => setD({ ...d, amount: e.target.value })} /></Field>
        <Field label="মাধ্যম"><select value={d.method} onChange={e => setD({ ...d, method: e.target.value, transport: e.target.value === 'bank' && !bankOff(cfg, d.date) ? String(cfg.transport ?? 0) : '0' })}>
          {['bank', 'bkash', 'nagad', 'rocket', 'other'].map(m => <option key={m} value={m}>{NOTE_METHOD[m] ?? m}</option>)}</select></Field>
        <Field label="তারিখ"><input type="date" max={todayDhaka()} value={d.date} onChange={e => setD({ ...d, date: e.target.value, transport: d.method === 'bank' && !bankOff(cfg, e.target.value) ? String(cfg.transport ?? 0) : '0' })} /></Field>
        <Field label="ব্যাংকের নাম"><input value={d.bank} onChange={e => setD({ ...d, bank: e.target.value })} /></Field>
        <Field label="কে গেছেন"><input value={d.people} placeholder="নাম, কমা দিয়ে" onChange={e => setD({ ...d, people: e.target.value })} /></Field>
        <Field label="যাতায়াত" hint={bankOff(cfg, d.date) ? 'ছুটির দিন — অটো ০, লাগলে লিখুন' : undefined}><input type="number" min={0} value={d.transport} onChange={e => setD({ ...d, transport: e.target.value })} /></Field>
        <Field label="ব্যাংক চার্জ" hint={d.byHand ? 'হাতে লেখা' : `অটো: ${taka(autoCharge)}${bankOff(cfg, d.date) ? ' (ছুটির দিন)' : ''}`}>
          {d.byHand ? <input type="number" min={0} value={d.charge} onChange={e => setD({ ...d, charge: e.target.value })} /> : <input readOnly value={num(autoCharge)} />}
          <button type="button" className="link" onClick={() => setD({ ...d, byHand: !d.byHand, charge: String(autoCharge) })}>{d.byHand ? 'অটোতে ফিরুন' : 'হাতে লিখুন'}</button></Field>
        <Field label="রেফ নং (স্লিপের)"><input value={d.ref} onChange={e => setD({ ...d, ref: e.target.value })} /></Field>
        <Field label="ব্যাংক স্লিপ" hint={uploading ? 'আপলোড হচ্ছে…' : d.slip ? 'আপলোড হয়েছে' : 'ছবি বা পিডিএফ'}>
          <input type="file" accept="image/png,image/jpeg,application/pdf" onChange={e => { const f = e.target.files?.[0]; if (f) void slip(f) }} /></Field>
        <Field label="মন্তব্য" wide><input value={d.remarks} onChange={e => setD({ ...d, remarks: e.target.value })} /></Field>
      </div>
      {(+d.amount || 0) > 0 && bankAmount > 0 && Math.abs((+d.amount || 0) - (bankAmount - deposited + (d.id ? deposits.find(x => x.id === d.id)?.amount ?? 0 : 0))) > 0.5 &&
        <p className="notice">খাতার হিসাবে জমা হওয়ার কথা {taka(bankAmount - deposited + (d.id ? deposits.find(x => x.id === d.id)?.amount ?? 0 : 0))} — এমাউন্ট আরেকবার দেখুন।</p>}
      <ErrorNote error={err} />
    </Modal>}

    {drop && <Modal title="বাদ দেবেন?" onClose={() => setDrop(null)}
      actions={<><button className="secondary" onClick={() => setDrop(null)}>না</button><button className="danger" disabled={!why.trim()} onClick={() => void remove()}>বাদ দিন</button></>}>
      <p>{drop.what}</p><Field label="কারণ *"><input autoFocus value={why} onChange={e => setWhy(e.target.value)} /></Field>
      <p className="muted small">মুছে যায় না — "বাদ" হিসেবে কারণসহ রেকর্ডে থাকে।</p><ErrorNote error={err} />
    </Modal>}
  </>
}

function SlipLink({ path }: { path: string }) {
  const [bad, setBad] = useState(false)
  return <button type="button" className="link" onClick={() => void da.fileUrl(path).then(u => window.open(u, '_blank', 'noopener')).catch(() => setBad(true))}>
    {bad ? 'খোলা যায়নি' : 'দেখুন ✓'}</button>
}

// ---------------------------------------------------------------------------- settings: bank charge and layout
export function BankChargeCard({ value, onSave }: { value: BankCharge | undefined; onSave: (v: BankCharge) => Promise<void> }) {
  const [v, setV] = useState<BankCharge>(value ?? DEFAULT_CHARGE)
  const [test, setTest] = useState('568652')
  const [hol, setHol] = useState((value?.holidays ?? []).join(', '))
  const days = [[1, 'সোম'], [2, 'মঙ্গল'], [3, 'বুধ'], [4, 'বৃহস্পতি'], [5, 'শুক্র'], [6, 'শনি'], [7, 'রবি']] as const
  const off = (v.off_days ?? []).map(Number)
  const withVat = (fee: number) => Math.round(fee * (1 + v.vat / 100) * 100) / 100
  const t = +test || 0
  return <section className="panel"><h2>ব্যাংক চার্জ (টাকার এমাউন্ট অনুযায়ী)</h2>
    <p className="muted small">ব্যাংক চার্জ বদলালে এখানে নতুন এমাউন্ট দিন। আগের দিনের ডিপোজিট আগের চার্জেই থাকবে।</p>
    <div className="da-grid3">
      <Field label="সীমা (টাকা)"><input type="number" min={0} value={v.limit} onChange={e => setV({ ...v, limit: +e.target.value || 0 })} /></Field>
      <Field label="সীমা পর্যন্ত চার্জ" hint={`ভ্যাটসহ ${taka(withVat(v.low))}`}><input type="number" min={0} value={v.low} onChange={e => setV({ ...v, low: +e.target.value || 0 })} /></Field>
      <Field label="সীমার বেশি হলে চার্জ" hint={`ভ্যাটসহ ${taka(withVat(v.high))}`}><input type="number" min={0} value={v.high} onChange={e => setV({ ...v, high: +e.target.value || 0 })} /></Field>
      <Field label="ভ্যাট %"><input type="number" min={0} max={100} value={v.vat} onChange={e => setV({ ...v, vat: +e.target.value || 0 })} /></Field>
      <Field label="ব্যাংকে যাতায়াত (অটো)"><input type="number" min={0} value={v.transport ?? 0} onChange={e => setV({ ...v, transport: +e.target.value || 0 })} /></Field>
      <Field label="কার্যকর তারিখ"><input type="date" value={v.effective_from ?? ''} onChange={e => setV({ ...v, effective_from: e.target.value || null })} /></Field>
    </div>
    <h3>ছুটির দিন (চার্জ ও যাতায়াত নেই)</h3>
    <div className="da-chips">{days.map(([n, l]) => <label key={n} className="da-check"><input type="checkbox" checked={off.includes(n)}
      onChange={e => setV({ ...v, off_days: e.target.checked ? [...off, n].sort() : off.filter(x => x !== n) })} /> {l}</label>)}</div>
    <Field label="ব্যাংক ছুটি (তারিখ, কমা দিয়ে)" hint="যেমন: 2026-12-16, 2026-12-25"><input value={hol} onChange={e => setHol(e.target.value)} /></Field>
    <div className="row" style={{ marginTop: 10 }}>
      <Field label="যাচাই — জমার টাকা"><input type="number" value={test} onChange={e => setTest(e.target.value)} /></Field>
      <b>চার্জ কাটবে: {taka(t <= 0 ? 0 : withVat(t <= v.limit ? v.low : v.high))}</b>
    </div>
    <button style={{ marginTop: 10 }} onClick={() => void onSave({ ...v, holidays: hol.split(/[,\s]+/).map(x => x.trim()).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)) })}>সেভ</button>
  </section>
}

export function LayoutCard({ value, onSave }: { value: Layout | undefined; onSave: (v: Layout) => Promise<void> }) {
  const lay = value ?? {}
  const set = (key: string, patch: Partial<SectionLayout> | null) => {
    const next: Layout = { ...lay }
    if (patch === null) delete next[key]; else next[key] = { ...(next[key] ?? {}), ...patch }
    void onSave(next)
  }
  return <section className="panel"><h2>খাতার অংশ ও কলাম</h2>
    <p className="muted small">কোন অংশ খাতায় দেখাবে, আর কলাম কীভাবে সাজানো আছে। কলাম সাজাতে খাতার প্রতিটা অংশের ⋮ মেনু ব্যবহার করুন।</p>
    <div className="da-table-wrap"><table className="da-table">
      <thead><tr><th>অংশ</th><th>দেখাবে</th><th>লুকানো কলাম</th><th>নতুন নাম</th><th>নিজের কলাম</th><th /></tr></thead>
      <tbody>{SECTIONS.map(sec => { const c = lay[sec.key] ?? {}; return <tr key={sec.key}>
        <td data-l="অংশ"><b>{sec.label}</b></td>
        <td data-l="দেখাবে"><input type="checkbox" aria-label={`${sec.label} দেখাবে`} checked={!c.off} onChange={e => set(sec.key, { off: !e.target.checked })} /></td>
        <td data-l="লুকানো">{(c.hidden ?? []).join(', ') || '—'}</td>
        <td data-l="নতুন নাম">{Object.entries(c.labels ?? {}).map(([a, b]) => `${a} → ${b}`).join(', ') || '—'}</td>
        <td data-l="নিজের কলাম">{(c.extra ?? []).map(x => x.label).join(', ') || '—'}</td>
        <td><button className="secondary sm" disabled={!lay[sec.key]} onClick={() => { if (window.confirm('এই অংশ আগের মতো করবেন? নিজের কলামের লেখা খাতায় থেকে যাবে, শুধু দেখাবে না।')) set(sec.key, null) }}>আগের মতো</button></td>
      </tr> })}</tbody></table></div>
  </section>
}

