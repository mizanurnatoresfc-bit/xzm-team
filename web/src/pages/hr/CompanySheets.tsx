import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { refreshShellCounts } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { Combo } from '../../components/inputs'
import { DIRECT_KINDS, addFormFields, bandOf, buildSheet, companySheets, downloadSheet, joinSrc, learnLayout, mergeLearnt, sheetFriendly, srcGroups, srcLabel, srcParts,
  type Built, type CompanySheet, type SheetCol, type SrcCtx } from '../../lib/companySheet'
import type { CField } from '../../lib/extra'
import { KINDS, STATUS, fmtName, hrReq, type FieldType, type ReqFormat, type ReqKind, type ReqStatus } from '../../lib/hrreq'
import { readWorkbook, type BookSheet } from '../../lib/sheetRead'
import { customFields } from '../../lib/staffAdmin'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'
import { useOrg } from './common'

type Range = 'today' | '7d' | 'month' | 'lastmonth' | 'all' | 'custom'
const RANGES: Record<Range, string> = { today: 'আজ', '7d': '৭ দিন', month: 'এই মাস', lastmonth: 'গত মাস', all: 'সব সময়', custom: 'তারিখ বেছে' }
const STAFF_STATUS: Array<[string, string]> = [['applicant', 'আইডির অপেক্ষায়'], ['active', 'সক্রিয়'], ['inactive', 'নিষ্ক্রিয়'], ['', 'সবাই']]
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const ymd = (d: Date) => d.toLocaleDateString('en-CA')
function rangeDates(range: Range, from: string, to: string): [string | null, string | null] {
  const t = today(); const d = new Date(t + 'T00:00:00')
  switch (range) {
    case 'today': return [t, t]
    case '7d': d.setDate(d.getDate() - 6); return [ymd(d), t]
    case 'month': return [t.slice(0, 8) + '01', t]
    case 'lastmonth': return [ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)), ymd(new Date(d.getFullYear(), d.getMonth(), 0))]
    case 'custom': return [from || null, to || null]
    default: return [null, null]
  }
}
const sheetName = (s: Pick<CompanySheet, 'name' | 'name_bn'>) => s.name_bn?.trim() || s.name
const sourceText = (s: Pick<CompanySheet, 'source' | 'kind'>) => (s.source === 'staff' ? 'কর্মী তালিকা থেকে' : `${KINDS[s.kind ?? 'custom']?.bn ?? ''} রিকুয়েস্ট থেকে`)

/** "কোম্পানি শিট": pick the company's layout, see it filled from the system, download it as the company's own Excel. */
export function CompanySheets() {
  const { can } = useAuth()
  const canConfig = can('hr.request.configure')
  const { toast, node } = useToast()
  const base = useLoad(async () => {
    const [sheets, formats, custom] = await Promise.all([companySheets.list(), hrReq.formats().catch(() => [] as ReqFormat[]), customFields()])
    return { sheets, formats, custom }
  }, [])
  const [pick, setPick] = useState('')
  const [edit, setEdit] = useState<{ sheet: CompanySheet | null } | null>(null)
  const [drop, setDrop] = useState<CompanySheet | null>(null)
  const [reason, setReason] = useState('')
  const sheets = base.data?.sheets ?? []
  const sheet = sheets.find(s => s.id === pick) ?? sheets[0] ?? null

  if (base.error) return <section className="panel"><p className="da-error">{sheetFriendly(base.error)}</p></section>
  if (!base.data) return <p className="muted">লোড হচ্ছে…</p>
  return <>
    {node}
    <section className="panel">
      <div className="da-bar"><div><strong>কোম্পানির শিট</strong>
        <div className="muted small">কোম্পানি যে ফরম্যাটে ফাইল চায় সেটা বেছে নিন — সিস্টেমের তথ্য নিজে বসে যাবে, তারপর এক্সেল নামান।</div></div>
        {canConfig && <button className="sm" onClick={() => setEdit({ sheet: null })}><Icon name="upload" size={14} />নতুন ফরম্যাট (ফাইল থেকে)</button>}</div>
      {!sheets.length ? <p className="muted">এখনো কোনো শিট নেই।{canConfig ? ' কোম্পানির এক্সেল ফাইলটা দিন — কলামগুলো নিজে চিনে নেবে।' : ' হেড অফিসকে বানিয়ে দিতে বলুন।'}</p> :
        <div className="cs-list" role="tablist" aria-label="কোম্পানির শিট">{sheets.map(s => <button key={s.id} type="button" role="tab" aria-selected={sheet?.id === s.id}
          className={`cs-item${sheet?.id === s.id ? ' on' : ''}`} onClick={() => setPick(s.id)}>
          <span className="qi"><Icon name="xls" size={18} /></span>
          <span className="cs-item-t"><b>{sheetName(s)}</b><small>{sourceText(s)} · {s.columns.length}টি কলাম</small></span></button>)}</div>}
      {sheet && canConfig && <div className="cs-acts">
        <button className="soft sm" onClick={() => setEdit({ sheet })}><Icon name="edit" size={14} />ফরম্যাট বদলেছে? নতুন ফাইল দিন / কলাম ঠিক করুন</button>
        <button className="danger sm" onClick={() => { setReason(''); setDrop(sheet) }}>সরান</button></div>}
    </section>

    {sheet && <Fill key={sheet.id} sheet={sheet} custom={base.data.custom} formats={base.data.formats} toast={toast} />}

    {edit && <Editor sheet={edit.sheet} formats={base.data.formats} custom={base.data.custom} taken={sheets.filter(s => s.id !== edit.sheet?.id).map(s => s.name.toLowerCase())}
      onClose={() => setEdit(null)} onDone={async m => { setEdit(null); toast(m); await base.reload() }} />}
    {drop && <Modal title={`"${sheetName(drop)}" সরাবেন?`} onClose={() => setDrop(null)}
      actions={<><button className="secondary" onClick={() => setDrop(null)}>বাতিল</button>
        <button className="danger" onClick={() => void companySheets.archive(drop.id, reason.trim()).then(async () => { setDrop(null); toast('শিট সরানো হয়েছে'); await base.reload() }).catch(e => toast(sheetFriendly(e)))}>সরান</button></>}>
      <p className="muted small">তালিকা থেকে চলে যাবে। আগে নামানো ফাইল বা রিকুয়েস্টের কিছু বদলাবে না।</p>
      <Field label="কারণ (ঐচ্ছিক)"><input value={reason} onChange={e => setReason(e.target.value)} placeholder="যেমন: কোম্পানি এই ফরম্যাট আর নেয় না" /></Field>
    </Modal>}
  </>
}

// ------------------------------------------------------------------ fill + preview + download
function Fill({ sheet, custom, formats, toast }: { sheet: CompanySheet; custom: CField[]; formats: ReqFormat[]; toast: (m: string) => void }) {
  const { can } = useAuth()
  const o = useOrg()
  const isReq = sheet.source === 'requests'
  const [range, setRange] = useState<Range>('month')
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const [hub, setHub] = useState('')
  const [statuses, setStatuses] = useState<ReqStatus[]>(['submitted', 'processing'])
  const [status, setStatus] = useState('applicant')
  const hasDirect = isReq && DIRECT_KINDS.includes(sheet.kind ?? 'custom')
  const [direct, setDirect] = useState(true)                                  // also what was done straight in the system, with no request
  const [off, setOff] = useState<Set<string>>(new Set())                       // rows left out
  const [typed, setTyped] = useState<Record<string, string>>({})              // hand-typed cells: "rowId|col" → text
  const [cell, setCell] = useState<string | null>(null)
  const [mark, setMark] = useState(false)
  const [busy, setBusy] = useState(false)
  const [d1, d2] = rangeDates(range, from, to)
  const q = useLoad<Built>(() => buildSheet(sheet, isReq ? { from: d1, to: d2, hub: hub || null, statuses, withDirect: hasDirect && direct, custom } : { hub: hub || null, status: status || null, custom }),
    [sheet.id, d1, d2, hub, statuses.join(','), status, direct])
  useEffect(() => { setOff(new Set()) }, [q.data])
  const rows = q.data?.rows ?? []
  const chosen = rows.filter(r => !off.has(r.id))
  const val = (r: { id: string; cells: Array<string | number> }, ci: number) => typed[`${r.id}|${ci}`] ?? r.cells[ci]
  const band = useMemo(() => bandOf(sheet), [sheet])
  const empty = chosen.reduce((n, r) => n + r.cells.filter((_, ci) => val(r, ci) === '').length, 0)
  const emptyCols = sheet.columns.map((c, ci) => (chosen.length && chosen.every(r => val(r, ci) === '') ? c.head : '')).filter(Boolean)
  const waiting = chosen.filter(r => r.status === 'submitted')
  const canDecide = can('hr.request.approve')
  const form = isReq ? formats.find(f => f.id === sheet.format_id) ?? formats.find(f => f.kind === sheet.kind) : undefined
  const toggle = (s: ReqStatus) => setStatuses(l => (l.includes(s) ? l.filter(x => x !== s) : [...l, s]))

  async function go() {
    if (!chosen.length) return
    setBusy(true)
    try {
      const file = downloadSheet(sheet, chosen.map(r => r.cells.map((_, ci) => val(r, ci))))
      let moved = 0
      if (mark && canDecide) {
        for (const r of waiting) { try { await hrReq.update(r.id, 'processing', `কোম্পানিতে পাঠানো হয়েছে — ${sheet.name}`); moved++ } catch { /* another person may have moved it already */ } }
        if (moved) { refreshShellCounts(); await q.reload() }
      }
      toast(`${file} নামানো হয়েছে — ${chosen.length} সারি${moved ? ` · ${moved}টা রিকুয়েস্ট এখন “কাজ চলছে”` : ''}`)
    } catch (e) { toast(sheetFriendly(e)) } finally { setBusy(false) }
  }

  return <section className="panel">
    <div className="da-bar"><h2 style={{ margin: 0 }}>{sheetName(sheet)} <span className="count-pill">{chosen.length}</span></h2>
      <button disabled={busy || !chosen.length} onClick={() => void go()}><Icon name="xls" size={16} />{busy ? 'তৈরি হচ্ছে…' : `এক্সেল নামান (${chosen.length})`}</button></div>
    <div className="cs-filters">
      {isReq && <div className="rp-seg">{(Object.keys(RANGES) as Range[]).map(k => <button key={k} type="button" className={range === k ? 'on' : ''} onClick={() => setRange(k)}>{RANGES[k]}</button>)}</div>}
      <div className="cs-hub"><Combo value={hub} onChange={setHub} placeholder="সব হাব" label="হাব" options={(o.data?.hubs ?? []).map(h => ({ value: h.id, label: h.name }))} /></div>
      {isReq ? (Object.keys(STATUS) as ReqStatus[]).map(k => <label key={k} className={`chip-toggle${statuses.includes(k) ? ' on' : ''}`}>
          <input type="checkbox" checked={statuses.includes(k)} onChange={() => toggle(k)} />{STATUS[k].bn}</label>)
        : STAFF_STATUS.map(([k, l]) => <button key={k} type="button" className={`chip-toggle${status === k ? ' on' : ''}`} aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>)}
      {hasDirect && <label className={`chip-toggle cs-direct${direct ? ' on' : ''}`} title="কর্মী তালিকা থেকে সরাসরি যে বদলি / চালু / বন্ধ করা হয়েছে, রিকুয়েস্ট ছাড়াই">
        <input type="checkbox" checked={direct} onChange={e => setDirect(e.target.checked)} />সিস্টেমে সরাসরি করা</label>}
    </div>
    {isReq && range === 'custom' && <div className="rp-dates"><Field label="থেকে"><input type="date" value={from} max={today()} onChange={e => setFrom(e.target.value)} /></Field>
      <Field label="পর্যন্ত"><input type="date" value={to} max={today()} onChange={e => setTo(e.target.value)} /></Field></div>}

    {q.error ? <p className="da-error">{sheetFriendly(q.error)}</p> : !q.data ? <p className="muted">তথ্য আনা হচ্ছে…</p> : !rows.length
      ? <p className="muted">{isReq ? `এই বাছাইয়ে কোনো ${KINDS[sheet.kind ?? 'custom']?.bn ?? ''} রিকুয়েস্ট${hasDirect && direct ? ' বা সিস্টেমে করা বদল' : ''} নেই। তারিখ বা অবস্থা বদলে দেখুন — অথবা “নতুন রিকুয়েস্ট” থেকে আগে জমা দিন।` : 'এই বাছাইয়ে কোনো কর্মী নেই। উপরে “সক্রিয়” বা “সবাই” বেছে দেখুন।'}</p> : <>
      <p className="muted small cs-note">{empty ? <>{empty}টা ঘর খালি{emptyCols.length ? <> — পুরো খালি কলাম: <b>{emptyCols.slice(0, 6).join(', ')}{emptyCols.length > 6 ? ` +${emptyCols.length - 6}` : ''}</b></> : null}। </> : 'সব ঘর ভরা। '}
        যে কোনো ঘরে চাপ দিয়ে হাতে লিখে নিতে পারেন (শুধু এই ফাইলে যাবে)।{q.data.hidden ? ` ${q.data.hidden} জনের তথ্য দেখার অনুমতি নেই, তাঁরা বাদ।` : ''}</p>
      <div className="cs-wrap"><table className="cs-grid no-bn">
        <thead>
          {band.topRows > 0 && <tr className="cs-band"><th />{(() => { const out = []; let c = 0
            while (c < sheet.columns.length) { const t = band.top.find(x => x.c0 === c)
              if (t) { out.push(<th key={c} colSpan={t.c1 - t.c0 + 1}>{t.text}</th>); c = t.c1 + 1 } else { out.push(<th key={c} className="cs-none" />); c++ } }
            return out })()}</tr>}
          <tr><th className="cs-tick"><input type="checkbox" aria-label="সব সারি" checked={chosen.length === rows.length} onChange={e => setOff(e.target.checked ? new Set() : new Set(rows.map(r => r.id)))} /></th>
            {sheet.columns.map((c, i) => <th key={i}>{c.head}</th>)}</tr>
        </thead>
        <tbody>{rows.map(r => { const out = off.has(r.id); const sl = out ? '' : chosen.indexOf(r) + 1
          return <tr key={r.id} className={`${out ? 'cs-out' : ''}${r.direct ? ' cs-direct-row' : ''}`} title={r.direct ? 'সিস্টেমে সরাসরি করা — রিকুয়েস্ট ছাড়া' : undefined}>
            <td className="cs-tick"><input type="checkbox" aria-label={r.label} checked={!out} onChange={() => setOff(s => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n })} /></td>
            {sheet.columns.map((c, ci) => { const k = `${r.id}|${ci}`; const isSl = srcParts(c.src)[0] === 'sl'; const v = isSl ? sl : val(r, ci)
              return cell === k ? <td key={ci} className="cs-edit"><input autoFocus defaultValue={String(v)} aria-label={`${r.label} — ${c.head}`}
                  onBlur={e => { const t = e.target.value; setTyped(m => { const n = { ...m }; if (t === String(r.cells[ci])) delete n[k]; else n[k] = t; return n }); setCell(null) }}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setCell(null) }} /></td>
                : <td key={ci} className={`${v === '' ? 'cs-empty' : ''}${k in typed ? ' cs-typed' : ''}`} tabIndex={isSl || out ? undefined : 0}
                    onClick={() => { if (!isSl && !out) setCell(k) }} onKeyDown={e => { if (e.key === 'Enter' && !isSl && !out) setCell(k) }}>{String(v)}</td> })}
          </tr> })}</tbody>
      </table></div>
      {isReq && canDecide && waiting.length > 0 && <label className="da-check cs-mark"><input type="checkbox" style={{ width: 'auto' }} checked={mark} onChange={e => setMark(e.target.checked)} />
        {' '}নামানোর পর “জমা হয়েছে” থাকা {waiting.length}টা রিকুয়েস্টকে “কাজ চলছে” করে দিন (কোম্পানিতে পাঠানো হয়েছে)</label>}
    </>}
    {isReq && form && <p className="muted small">এই শিটের সারি আসে <b>{fmtName(form)}</b> রিকুয়েস্ট থেকে{hasDirect ? ' — আর “সিস্টেমে সরাসরি করা” চালু থাকলে কর্মী তালিকা থেকে সরাসরি করা বদলও (বাঁ পাশে নীল দাগ)' : ''}। ফর্মে যে ঘরগুলো আছে সেগুলো ম্যানেজার জমা দেওয়ার সময় ভরেন; কর্মীর নাম, মোবাইল, এনআইডি, বেতন আসে তাঁর প্রোফাইল থেকে।</p>}
  </section>
}

// ------------------------------------------------------------------ editor: learn a layout from the company's file, point each column at its source
type ECol = SheetCol & { sample?: string; state?: 'kept' | 'new' | 'unsure'; newLabel?: string }
const NEW_TYPES: Record<string, FieldType> = { '__new:text': 'text', '__new:number': 'number', '__new:date': 'date' }

function Editor({ sheet, formats, custom, taken, onClose, onDone }: { sheet: CompanySheet | null; formats: ReqFormat[]; custom: CField[]; taken: string[]
  onClose: () => void; onDone: (m: string) => Promise<void> }) {
  const [name, setName] = useState(sheet?.name ?? '')
  const [nameBn, setNameBn] = useState(sheet?.name_bn ?? '')
  const [source, setSource] = useState<'requests' | 'staff'>(sheet?.source ?? 'requests')
  const [kind, setKind] = useState<ReqKind>(sheet?.kind ?? 'id_transfer')
  const [formatId, setFormatId] = useState(sheet?.format_id ?? '')
  const [title, setTitle] = useState(sheet?.title ?? '')
  const [titleAt, setTitleAt] = useState<[number, number] | null>(sheet?.title_at ?? null)
  const [cols, setCols] = useState<ECol[]>(sheet?.columns ?? [])
  const [fileName, setFileName] = useState(sheet?.file_name ?? '')
  const [book, setBook] = useState<BookSheet[] | null>(null)
  const [tab, setTab] = useState(0)
  const [dropped, setDropped] = useState<SheetCol[]>([])
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const ofKind = formats.filter(f => f.kind === kind)
  const form = source === 'requests' ? formats.find(f => f.id === formatId && f.kind === kind) ?? ofKind[0] : undefined
  const ctx: SrcCtx = useMemo(() => ({ source, fields: form?.fields ?? [], custom }), [source, form, custom])
  const groups = useMemo(() => srcGroups(ctx), [ctx])
  const known = useMemo(() => new Set(groups.flatMap(g => g.items.map(i => i[0]))), [groups])

  function apply(sh: BookSheet, keepFrom: SheetCol[], c: SrcCtx) {
    const learnt = learnLayout(sh)
    const m = mergeLearnt(learnt, keepFrom, c)
    setCols(m.cols); setDropped(m.dropped); setTitle(learnt.title); setTitleAt(learnt.title_at)
  }
  async function onFile(f: File | undefined) {
    if (!f) return
    setErr('')
    try {
      const b = await readWorkbook(f)
      const usable = b.filter(s => s.rows.some(r => r.filter(Boolean).length > 1))
      if (!usable.length) throw new Error('ফাইলে কোনো শিরোনামের সারি পাওয়া যায়নি')
      setBook(usable); setTab(0); setFileName(f.name)
      if (!name.trim()) setName(f.name.replace(/\.xlsx$/i, '').replace(/^[0-9a-f]{8}-/i, '').replace(/[-_]+/g, ' ').trim())
      apply(usable[0], sheet?.columns ?? [], ctx)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    if (input.current) input.current.value = ''
  }
  // A new sheet read from a file: when the kind of sheet changes, guess the sources again for it.
  function reguess(next: SrcCtx) { if (book && !sheet) apply(book[tab], [], next) }
  const setCol = (i: number, p: Partial<ECol>) => setCols(l => l.map((c, k) => (k === i ? { ...c, ...p } : c)))
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= cols.length) return
    setCols(l => { const n = [...l]; [n[i], n[j]] = [n[j], n[i]]; return n }); setTitleAt(null) }
  const setPart = (i: number, at: 0 | 1, v: string) => {
    const parts = srcParts(cols[i].src)
    if (at === 0) { parts[0] = v === 'fixed:' ? 'fixed:' : v; if (v.startsWith('__new:') || v === 'sl' || v === 'blank' || v.startsWith('fixed:')) parts.length = 1 }
    else if (v) parts[1] = v; else parts.splice(1, 1)
    setCol(i, { src: v.startsWith('__new:') && at === 0 ? v : (parts[0]?.startsWith('fixed:') ? parts[0] : joinSrc(parts)), state: undefined, newLabel: v.startsWith('__new:') ? (cols[i].newLabel ?? [cols[i].group, cols[i].head].filter(Boolean).join(' — ')) : undefined })
  }

  async function save() {
    setErr('')
    const nm = name.trim() || nameBn.trim()
    if (!nm) return setErr('শিটের নাম দিন')
    if (taken.includes(nm.toLowerCase())) return setErr('এই নামে একটা শিট আগেই আছে — অন্য নাম দিন')
    if (!cols.length) return setErr('কোম্পানির ফাইলটা দিন, অথবা অন্তত একটা কলাম যোগ করুন')
    if (cols.some(c => !c.head.trim())) return setErr('প্রতিটা কলামের শিরোনাম দিন')
    if (cols.some(c => c.src === 'fixed:')) return setErr('“একই লেখা” বেছেছেন যে কলামে, সেখানে লেখাটা দিন')
    const fresh = cols.map((c, i) => ({ c, i })).filter(x => x.c.src.startsWith('__new:'))
    if (fresh.length && !form) return setErr('এই ধরনের কোনো রিকুয়েস্ট ফর্ম নেই — আগে “ফরম্যাট সেটিং”-এ ফর্ম বানান')
    if (fresh.some(x => !(x.c.newLabel ?? '').trim())) return setErr('ফর্মের নতুন ঘরগুলোর নাম দিন')
    setBusy(true)
    try {
      const keys = fresh.length && form ? await addFormFields(form, fresh.map(x => ({ label: x.c.newLabel!.trim(), type: NEW_TYPES[x.c.src] ?? 'text' }))) : []
      const columns: SheetCol[] = cols.map((c, i) => { const k = fresh.findIndex(x => x.i === i)
        return { head: c.head.trim(), group: c.group?.trim() || undefined, src: k >= 0 ? `req:${keys[k]}` : c.src, w: c.w } })
      await companySheets.save({ id: sheet?.id, name: nm, name_bn: nameBn.trim() || null, source, kind: source === 'requests' ? kind : null,
        format_id: source === 'requests' && formatId && ofKind.some(f => f.id === formatId) ? formatId : null, title: title.trim() || null, title_at: titleAt, columns, file_name: fileName || null })
      await onDone(`শিট সেভ হয়েছে${keys.length ? ` — ${fmtName(form)} ফর্মে ${keys.length}টা নতুন ঘর যোগ হয়েছে` : ''}`)
    } catch (e) { setErr(sheetFriendly(e)) } finally { setBusy(false) }
  }

  const unsure = cols.filter(c => c.state === 'unsure').length, added = cols.filter(c => c.state === 'new').length
  return <Modal wide title={sheet ? `${sheetName(sheet)} — ফরম্যাট ঠিক করুন` : 'নতুন কোম্পানি শিট'} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>বাতিল</button><button disabled={busy} onClick={() => void save()}>{busy ? 'সেভ হচ্ছে…' : 'সেভ করুন'}</button></>}>
    <div className="cs-drop">
      <input ref={input} type="file" accept=".xlsx" hidden onChange={e => void onFile(e.target.files?.[0])} />
      <button type="button" className="soft" onClick={() => input.current?.click()}><Icon name="upload" size={16} />{sheet ? 'কোম্পানির নতুন ফাইল দিন' : 'কোম্পানির এক্সেল ফাইল দিন'}</button>
      <span className="muted small">{fileName ? <>ফাইল: <b>{fileName}</b> · </> : null}{sheet ? 'যে কলাম আগের মতোই আছে তার উৎস ঠিক থাকবে; শুধু নতুনগুলো দেখে নেবেন।' : 'শিরোনামের সারি, উপরের বড় শিরোনাম আর কলামের ক্রম নিজে পড়ে নেবে।'}</span>
    </div>
    {book && book.length > 1 && <div className="rp-seg cs-tabs">{book.map((b, i) => <button key={i} type="button" className={tab === i ? 'on' : ''}
      onClick={() => { setTab(i); try { apply(b, sheet?.columns ?? [], ctx) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } }}>{b.name || `শিট ${i + 1}`}</button>)}</div>}

    <div className="hr-form">
      <Field label="শিটের নাম (ইংরেজি)" required><input value={name} onChange={e => setName(e.target.value)} placeholder="ID Transfer Information" /></Field>
      <Field label="বাংলা নাম"><input value={nameBn} onChange={e => setNameBn(e.target.value)} placeholder="আইডি বদলির শিট" /></Field>
      <Field label="সারি আসবে কোথা থেকে" hint={source === 'staff' ? 'কর্মী তালিকার প্রতি জন এক সারি' : 'জমা পড়া প্রতিটা রিকুয়েস্ট এক সারি'}>
        <select value={source} disabled={!!sheet} onChange={e => { const v = e.target.value as 'requests' | 'staff'; setSource(v); reguess({ source: v, fields: v === 'requests' ? (ofKind[0]?.fields ?? []) : [], custom }) }}>
          <option value="requests">রিকুয়েস্ট থেকে</option><option value="staff">কর্মী তালিকা থেকে</option></select></Field>
      {source === 'requests' && <Field label="কোন রিকুয়েস্ট">
        <select value={kind} disabled={!!sheet} onChange={e => { const v = e.target.value as ReqKind; setKind(v); setFormatId(''); reguess({ source, fields: formats.find(f => f.kind === v)?.fields ?? [], custom }) }}>
          {(Object.keys(KINDS) as ReqKind[]).map(k => <option key={k} value={k}>{KINDS[k].bn}</option>)}</select></Field>}
      {source === 'requests' && ofKind.length > 1 && <Field label="কোন ফর্ম"><select value={formatId} onChange={e => setFormatId(e.target.value)}>
        <option value="">এই ধরনের সব ফর্ম</option>{ofKind.map(f => <option key={f.id} value={f.id}>{fmtName(f)}</option>)}</select></Field>}
      <Field label="উপরের বড় শিরোনাম" wide><input value={title} onChange={e => setTitle(e.target.value)} placeholder="যেমন: Admin & Rider ID Transfer Format" /></Field>
    </div>

    <h3 className="rq-h3">কলামগুলো ({cols.length})</h3>
    {(unsure > 0 || added > 0 || dropped.length > 0) && <p className="notice small">
      {added > 0 && <>{added}টা নতুন কলাম নিজে চিনে নেওয়া হয়েছে। </>}
      {unsure > 0 && <><b>{unsure}টা কলামের তথ্য সিস্টেমে পাওয়া যায়নি</b> — সেগুলো খালি থাকবে (নামানোর আগে হাতে লেখা যাবে){source === 'requests' ? ', অথবা “ফর্মে নতুন ঘর বানান” বেছে দিন — তখন ম্যানেজার জমা দেওয়ার সময়ই ভরবেন' : ', অথবা আগে “প্রোফাইলের ঘর” পাতায় ঘরটা বানিয়ে এখানে বেছে দিন'}। </>}
      {dropped.length > 0 && <>নতুন ফাইলে আর নেই: <b>{dropped.map(c => c.head).join(', ')}</b>।</>}</p>}
    {!cols.length ? <p className="muted">এখনো কোনো কলাম নেই — উপরে ফাইল দিন।</p> : <div className="cs-wrap"><table className="cs-map no-bn">
      <thead><tr><th>#</th><th>গ্রুপ শিরোনাম</th><th>কলামের শিরোনাম</th><th>তথ্য আসবে</th><th>না থাকলে</th><th /></tr></thead>
      <tbody>{cols.map((c, i) => { const parts = c.src.startsWith('__new:') ? [c.src] : srcParts(c.src); const p0 = parts[0] ?? 'blank'; const fixed = p0.startsWith('fixed:')
        const single = p0 === 'sl' || p0 === 'blank' || fixed || p0.startsWith('__new:')
        return <tr key={i} className={c.state === 'unsure' ? 'cs-unsure' : c.state === 'new' ? 'cs-new' : ''}>
          <td className="muted small">{i + 1}</td>
          <td><input value={c.group ?? ''} aria-label={`কলাম ${i + 1} গ্রুপ`} placeholder="—" onChange={e => { setCol(i, { group: e.target.value }); setTitleAt(null) }} /></td>
          <td><input value={c.head} aria-label={`কলাম ${i + 1} শিরোনাম`} onChange={e => setCol(i, { head: e.target.value })} />
            {c.sample ? <small className="muted">ফাইলে যেমন: {c.sample.slice(0, 40)}</small> : null}
            {c.state === 'new' && <Badge tone="info">নতুন</Badge>}{c.state === 'unsure' && <Badge tone="warn">সিস্টেমে নেই</Badge>}</td>
          <td><select value={fixed ? 'fixed:' : p0} aria-label={`কলাম ${i + 1} উৎস`} onChange={e => setPart(i, 0, e.target.value)}>
              {!fixed && !known.has(p0) && <option value={p0}>{srcLabel(p0, ctx)}</option>}
              {groups.map(g => <optgroup key={g.label} label={g.label}>{g.items.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>)}</select>
            {fixed && <input value={p0.slice(6)} aria-label={`কলাম ${i + 1} লেখা`} placeholder="যে লেখা বসবে" onChange={e => setCol(i, { src: `fixed:${e.target.value}` })} />}
            {p0.startsWith('__new:') && <input value={c.newLabel ?? ''} aria-label={`কলাম ${i + 1} ফর্মের ঘরের নাম`} placeholder="ফর্মে ঘরের নাম" onChange={e => setCol(i, { newLabel: e.target.value })} />}</td>
          <td>{!single && <select value={parts[1] ?? ''} aria-label={`কলাম ${i + 1} বিকল্প উৎস`} onChange={e => setPart(i, 1, e.target.value)}>
              <option value="">—</option>
              {parts[1] && !known.has(parts[1]) && <option value={parts[1]}>{srcLabel(parts[1], ctx)}</option>}
              {groups.filter(g => g.label !== 'ফর্মে নেই?').map(g => <optgroup key={g.label} label={g.label}>{g.items.filter(([v]) => v !== 'sl' && v !== 'blank' && v !== 'fixed:').map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>)}</select>}
            {parts.length > 2 && <small className="muted">+ {parts.slice(2).map(p => srcLabel(p, ctx)).join(', ')}</small>}</td>
          <td className="cs-btns"><button type="button" className="icon-btn" aria-label="উপরে" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button type="button" className="icon-btn" aria-label="নিচে" disabled={i === cols.length - 1} onClick={() => move(i, 1)}>↓</button>
            <button type="button" className="icon-btn" aria-label="কলাম সরান" onClick={() => { setCols(l => l.filter((_, k) => k !== i)); setTitleAt(null) }}><Icon name="trash" size={16} /></button></td>
        </tr> })}</tbody></table></div>}
    <button type="button" className="soft sm" onClick={() => setCols(l => [...l, { head: '', src: 'blank' }])}><Icon name="plus" size={14} />কলাম যোগ করুন</button>
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}
