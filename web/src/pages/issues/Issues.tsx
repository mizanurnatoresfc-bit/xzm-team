import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { PersonPicker, type RefPerson } from '../../components/PersonPicker'
import { hrFriendly } from '../../lib/hr'
import { ACTION_BN, EMOJIS, KIND_BN, ORDER_ACTION_BN, ORDER_STATUS_BN, PRIORITY_BN, isOrder, issues, type GroupHub, type InCharge, type IssueDetail, type IssueKind, type IssueRow, type OrderKind, type Panels, type Post, type Priority, type Who } from '../../lib/issues'
import { readLabel } from '../../lib/ocr'
import { duplicates } from '../../lib/validate'
import { Combo, DupNote, useDuplicates } from '../../components/inputs'
import { useAuth } from '../../auth/AuthProvider'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'

type Tab = 'mine' | 'check' | 'given' | 'group' | 'hub' | 'orders'
const errText = (e: unknown) => (e instanceof Error && !('code' in e) ? e.message : hrFriendly(e))
const when = (s: string) => new Date(s).toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const TONE = { open: 'info', in_progress: 'warn', solved: 'ok', approved: 'ok', cancelled: 'neutral' } as const
const STATUS_BN = { open: 'নতুন', in_progress: 'কাজ চলছে', solved: 'সমাধান — চেক বাকি', approved: 'অনুমোদিত', cancelled: 'বাতিল' } as const
/** Status in the words of the kind: an order is prepared, sent and received; an issue is worked, solved and checked. */
const statusText = (kind: string, status: keyof typeof STATUS_BN) => (isOrder(kind) ? ORDER_STATUS_BN : STATUS_BN)[status]

export function Issues() {
  const [sp, setSp] = useSearchParams()
  const { toast, node } = useToast()
  const panels = useLoad(() => issues.panels(), [])
  const groups = useLoad(() => issues.groupHubs(), [])
  const [creating, setCreating] = useState<string | null>(null)
  const [ordering, setOrdering] = useState<OrderKind | null>(null)
  const p: Panels = panels.data ?? { mine: [], to_check: [], given: [], waiting_for_check_of_mine: [], hub: [] }
  const tab = (sp.get('tab') as Tab) || (p.to_check.length ? 'check' : p.mine.length ? 'mine' : 'group')
  const open = sp.get('id')
  const go = (t: Tab) => { const n = new URLSearchParams(sp); n.set('tab', t); n.delete('id'); setSp(n, { replace: true }) }
  const openIssue = (id: string | null) => { const n = new URLSearchParams(sp); if (id) n.set('id', id); else n.delete('id'); setSp(n, { replace: true }) }
  const refresh = () => { void panels.reload(); void groups.reload() }
  const hubs = groups.data ?? []
  // A shortcut link (/app/issues?new=1) opens the new-issue form at once.
  useEffect(() => {
    if (!sp.get('new') || !hubs.length) return
    setCreating(c => c ?? hubs[0].hub_id)
    const n = new URLSearchParams(sp); n.delete('new'); setSp(n, { replace: true })
  }, [sp, hubs, setSp])
  // ...and /app/issues?order=store (or it) opens the order form.
  useEffect(() => {
    const k = sp.get('order')
    if (!k || !hubs.length) return
    setOrdering(isOrder(k) ? k : 'store')
    const n = new URLSearchParams(sp); n.delete('order'); n.set('tab', 'orders'); setSp(n, { replace: true })
  }, [sp, hubs, setSp])
  // Every open Store / IT order this person can see, whichever panel it sits in.
  const orders = [...new Map([...p.mine, ...p.waiting_for_check_of_mine, ...p.to_check, ...p.given, ...p.hub].filter(r => isOrder(r.kind)).map(r => [r.id, r])).values()]
  const tabs: Array<[Tab, string, number, string]> = [
    ['mine', 'আমার কাজ', p.mine.length, 'tasks'], ['check', 'চেক বাকি', p.to_check.length, 'check'], ['given', 'আমি দিয়েছি', p.given.length, 'form'],
    ['group', 'হাব গ্রুপ', hubs.reduce((a, h) => a + h.unseen, 0), 'users'], ['hub', 'হাবের সব ইস্যু', p.hub.length, 'grid'], ['orders', 'স্টোর / আইটি অর্ডার', orders.length, 'box']]
  const late = [...p.mine, ...p.given].filter(r => r.overdue).length
  const tiles: Array<[Tab, string, number, string]> = [['mine', 'আমার কাজ', p.mine.length, late ? 'warn' : ''], ['check', 'চেক বাকি', p.to_check.length, p.to_check.length ? 'bad' : ''], ['given', 'আমি দিয়েছি', p.given.length, '']]
  return <AppShell title="ইস্যু ও ফলো-আপ" subtitle="কাজ দিন, সমাধান চেক করে অনুমোদন দিন — অনুমোদন না হলে ইস্যু প্যানেলেই থাকে">
    <div className="is-tiles">{tiles.map(([k, l, c, tone]) => <button key={k} type="button" className={`is-tile ${tone}${tab === k ? ' on' : ''}`} onClick={() => go(k)}><b>{c}</b><span>{l}</span></button>)}</div>
    <div className="rq-tabs">{tabs.map(([k, l, c, ic]) => <button key={k} type="button" className={`rq-tab${tab === k ? ' on' : ''}`} onClick={() => go(k)}>
      <Icon name={ic} size={16} />{l}{c > 0 ? ` (${c})` : ''}</button>)}
    {hubs.length > 0 && <button type="button" className="rq-tab" onClick={() => setCreating(hubs[0].hub_id)}><Icon name="plus" size={16} />নতুন ইস্যু</button>}
    {hubs.length > 0 && <button type="button" className="rq-tab" onClick={() => setOrdering('store')}><Icon name="box" size={16} />স্টোর / আইটি অর্ডার দিন</button>}</div>
    {panels.error ? <p className="da-error">{errText(panels.error)}</p> : null}
    {tab === 'mine' && <>
      <List rows={p.mine} empty="আপনাকে দেওয়া কোনো কাজ বাকি নেই" onOpen={openIssue} onChanged={() => { refresh(); toast('হয়েছে') }} />
      {p.waiting_for_check_of_mine.length > 0 && <><h3 className="muted" style={{ margin: '16px 0 6px' }}>সমাধান জানিয়েছেন — যিনি দিয়েছেন তার চেকের অপেক্ষায়</h3>
        <List rows={p.waiting_for_check_of_mine} empty="" onOpen={openIssue} onChanged={() => { refresh(); toast('হয়েছে') }} /></>}</>}
    {tab === 'check' && <List rows={p.to_check} empty="চেক করার মতো সমাধান করা কোনো ইস্যু নেই" onOpen={openIssue} onChanged={() => { refresh(); toast('হয়েছে') }} />}
    {tab === 'given' && <List rows={p.given} empty="আপনার দেওয়া কোনো কাজ এখন চলছে না" onOpen={openIssue} onChanged={() => { refresh(); toast('হয়েছে') }} />}
    {tab === 'hub' && <List rows={p.hub} empty="হাবে অন্য কোনো খোলা ইস্যু নেই" onOpen={openIssue} onChanged={() => { refresh(); toast('হয়েছে') }} />}
    {tab === 'group' && <Group hubs={hubs} onOpenIssue={openIssue} onNew={h => setCreating(h)} />}
    {tab === 'orders' && <>
      <OrderDesk canOrder={hubs.length > 0} onOrder={setOrdering} />
      <List rows={orders} empty="এখন কোনো স্টোর / আইটি অর্ডার খোলা নেই" onOpen={openIssue} onChanged={() => { refresh(); toast('হয়েছে') }} /></>}
    {open && <Detail id={open} onClose={() => openIssue(null)} onChanged={() => { refresh(); toast('হয়েছে') }} />}
    {creating && <NewIssue hubs={hubs} hub={creating} onClose={() => setCreating(null)} onDone={id => { setCreating(null); refresh(); toast('ইস্যু তৈরি হয়েছে'); openIssue(id) }} />}
    {ordering && <NewOrder hubs={hubs} kind={ordering} onClose={() => setOrdering(null)} onDone={id => { setOrdering(null); refresh(); toast('অর্ডার দেওয়া হয়েছে'); go('orders'); openIssue(id) }} />}
    {node}
  </AppShell>
}

// ------------------------------------------------------------------ lists
function List({ rows, empty, onOpen, onChanged }: { rows: IssueRow[]; empty: string; onOpen: (id: string) => void; onChanged?: () => void }) {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  async function quick(r: IssueRow, a: 'start' | 'approve') {
    setBusy(r.id); setErr('')
    try { await issues.act(r.id, a); onChanged?.() } catch (e) { setErr(errText(e)) } finally { setBusy('') }
  }
  if (!rows.length) return empty ? <div className="is-empty"><Icon name="check" size={28} /><p>{empty}</p></div> : null
  return <>{err && <p className="da-error" role="alert">{err}</p>}<div className="is-list">{rows.map(r => <div key={r.id} className={`is-card s-${r.status}${r.overdue ? ' late' : ''}`}>
    <div className="head"><span className="no">{r.issue_no}</span><Badge tone={TONE[r.status]}>{statusText(r.kind, r.status)}</Badge>
      {r.priority !== 'normal' && <Badge tone={r.priority === 'low' ? 'neutral' : 'bad'}>{PRIORITY_BN[r.priority]}</Badge>}
      {r.overdue && <Badge tone="bad">সময় পার</Badge>}{r.reopen_count > 0 && <Badge tone="warn">ফেরত {r.reopen_count}</Badge>}
      <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>{when(r.created_at)}</span></div>
    <div className="ttl" onClick={() => onOpen(r.id)}>{r.title}</div>
    <div className="meta"><span>{KIND_BN[r.kind]} · {r.hub}{r.parcel_ref ? ` · ${r.parcel_ref}` : ''}</span>
      <span>কাকে: {r.assignee ? `${r.assignee}${r.assignee_code ? ` (${r.assignee_code})` : ''}` : 'কাউকে দেওয়া হয়নি'}{r.assigned_by_nodi ? ' · নদী AI বেছেছে' : ''}</span>
      <span>কে দিয়েছে: {r.assigned_by_name ?? '—'}</span></div>
    <div className="acts">
      {r.is_mine && r.status === 'open' && <button type="button" disabled={busy === r.id} onClick={() => void quick(r, 'start')}>{isOrder(r.kind) ? '▶ প্রস্তুত করছি' : '▶ শুরু করলাম'}</button>}
      {r.is_mine && (r.status === 'open' || r.status === 'in_progress') && <button type="button" onClick={() => onOpen(r.id)}>{isOrder(r.kind) ? '✔ পাঠিয়েছি' : '✔ সমাধান জানান'}</button>}
      {r.is_giver && r.status === 'solved' && <button type="button" disabled={busy === r.id} onClick={() => void quick(r, 'approve')}>{isOrder(r.kind) ? '✔ পেয়েছি' : '✔ অনুমোদন'}</button>}
      {r.is_giver && r.status === 'solved' && <button type="button" className="secondary" onClick={() => onOpen(r.id)}>{isOrder(r.kind) ? '↩ পাইনি / দেখুন' : '↩ ফেরত / দেখুন'}</button>}
      {!(r.is_mine && r.status !== 'solved') && !(r.is_giver && r.status === 'solved') && <button type="button" className="secondary" onClick={() => onOpen(r.id)}>খুলুন</button>}
    </div></div>)}</div></>
}

// ------------------------------------------------------------------ one issue
function Detail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const d = useLoad(() => issues.detail(id), [id])
  const p = useLoad(() => issues.panels(), [id])
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [assign, setAssign] = useState(false)
  const [person, setPerson] = useState<RefPerson | null>(null)
  const x: IssueDetail | null = d.data
  const i = x?.issue
  const mine = p.data?.mine.some(r => r.id === id) || p.data?.waiting_for_check_of_mine.some(r => r.id === id)
  const giver = p.data?.given.some(r => r.id === id) || p.data?.to_check.some(r => r.id === id)
  const needNote = (a: string) => a === 'reopen' || a === 'cancel'
  const order = !!i && isOrder(i.kind)
  async function act(a: 'start' | 'solve' | 'approve' | 'reopen' | 'cancel') {
    setErr(''); if (needNote(a) && !note.trim()) { setErr('কারণ লিখুন'); return }
    if (a === 'solve' && !note.trim() && !file && !order) { setErr('কী করা হয়েছে লিখুন বা ছবি দিন'); return }
    setBusy(true)
    try {
      const photo = file && i ? await issues.uploadPhoto(i.hub_id, file) : null
      // "Sent" on an order needs no typing: a plain note is filled in.
      await issues.act(id, a, a === 'solve' && order && !note.trim() && !file ? 'পাঠানো হয়েছে' : note, photo); setNote(''); setFile(null); await d.reload(); await p.reload(); onChanged()
    } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  async function doAssign() {
    if (person?.kind !== 'employee') { setErr('সিস্টেমের কাউকে বাছুন'); return }
    setBusy(true); setErr('')
    try { await issues.assign(id, person.id, note); setAssign(false); setPerson(null); await d.reload(); await p.reload(); onChanged() } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  const live = i && (i.status === 'open' || i.status === 'in_progress' || i.status === 'solved')
  return <Modal wide title={i ? `${i.issue_no} · ${i.title}` : 'ইস্যু'} onClose={onClose} actions={<>
    {live && mine && i.status === 'open' && <button type="button" disabled={busy} onClick={() => void act('start')}>{order ? 'প্রস্তুত করছি' : 'কাজ শুরু করলাম'}</button>}
    {live && mine && (i.status === 'open' || i.status === 'in_progress') && <button type="button" disabled={busy} onClick={() => void act('solve')}>{order ? 'পাঠিয়েছি' : 'সমাধান হয়েছে'}</button>}
    {live && giver && i.status === 'solved' && <button type="button" disabled={busy} onClick={() => void act('approve')}>{order ? 'পেয়েছি' : 'চেক করেছি — অনুমোদন'}</button>}
    {live && giver && i.status === 'solved' && <button type="button" className="secondary" disabled={busy} onClick={() => void act('reopen')}>{order ? 'পাইনি / ভুল এসেছে' : 'ঠিক হয়নি — ফেরত'}</button>}
    {live && giver && <button type="button" className="secondary" onClick={() => setAssign(a => !a)}>অন্যকে দিন</button>}
    {live && giver && <button type="button" className="secondary" disabled={busy} onClick={() => void act('cancel')}>বাতিল</button>}
    <button type="button" className="secondary" onClick={onClose}>বন্ধ</button></>}>
    {d.loading && !x ? <p className="muted">লোড হচ্ছে…</p> : null}
    {d.error ? <p className="da-error">{errText(d.error)}</p> : null}
    {x && i && <>
      <p><Badge tone={TONE[i.status]}>{order ? ORDER_STATUS_BN[i.status] : i.status_bn}</Badge> {KIND_BN[i.kind]} · {i.hub} · কাকে: {i.assignee ?? 'কাউকে দেওয়া হয়নি'}{i.assignee_code ? ` (${i.assignee_code})` : ''} · কে দিয়েছে: {i.assigned_by_name ?? '—'}</p>
      {i.body && <p style={{ whiteSpace: 'pre-wrap' }}>{i.body}</p>}
      {i.parcel_ref && <p className="muted">পার্সেল আইডি: <strong>{i.parcel_ref}</strong>{x.parcel ? ` · ${String(x.parcel.customer_name ?? '')} · ${String(x.parcel.status ?? '')}` : ''}</p>}
      {i.photo_path && <Photo path={i.photo_path} />}
      {i.solved_note && <p><strong>{order ? 'পাঠানোর নোট:' : 'সমাধান:'}</strong> {i.solved_note}</p>}{i.solve_photo && <Photo path={i.solve_photo} />}
      {live && (mine || giver) && <Field label={order ? (mine && !giver ? 'কীভাবে পাঠালেন (ঐচ্ছিক) / ছবি' : 'মন্তব্য (পাইনি বা বাতিলে কারণ লাগবে)') : mine && !giver ? 'কী করেছেন (সমাধানে লাগবে) / ছবি' : 'মন্তব্য (ফেরত বা বাতিলে কারণ লাগবে)'} wide>
        <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} />
        <input type="file" accept="image/*" onChange={e => setFile(e.target.files?.[0] ?? null)} /></Field>}
      {assign && <Field label="নতুন কাকে দেবেন" wide><PersonPicker value={person} onChange={setPerson} /><button type="button" disabled={busy} onClick={() => void doAssign()}>এই ব্যক্তিকে দিন</button></Field>}
      {err && <p className="da-error" role="alert">{err}</p>}
      <h4 style={{ margin: '12px 0 4px' }}>ইতিহাস</h4>
      <ul style={{ margin: 0, paddingLeft: 18 }}>{x.events.map(e => <li key={e.id}><strong>{(order ? ORDER_ACTION_BN[e.action] : undefined) ?? ACTION_BN[e.action] ?? e.action}</strong> — {e.by_name}{e.note ? `: ${e.note}` : ''} <span className="muted">· {when(e.at)}</span></li>)}</ul>
    </>}
  </Modal>
}

function Photo({ path }: { path: string }) {
  const u = useLoad(() => issues.photoUrl(path), [path])
  return u.data ? <a href={u.data} target="_blank" rel="noreferrer"><img src={u.data} alt="ছবি" style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 8, margin: '6px 0' }} /></a> : null
}

// ------------------------------------------------------------------ new issue
/** Fast path: give the label screenshot (choose, drop, paste or camera), the parcel ID is read from it, pick who gets it. */
function NewIssue({ hubs, hub: h0, onClose, onDone }: { hubs: GroupHub[]; hub: string; onClose: () => void; onDone: (id: string) => void }) {
  const [hub, setHub] = useState(h0)
  const [f, setF] = useState({ title: '', body: '', parcel: '', kind: 'parcel' as IssueKind, priority: 'normal' as Priority, due: '' })
  const [person, setPerson] = useState<RefPerson | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [scan, setScan] = useState<{ state: 'idle' | 'reading' | 'done' | 'failed'; ids: string[]; pct: number }>({ state: 'idle', ids: [], pct: 0 })
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const latest = useRef<File | null>(null)
  const same = useDuplicates(f.parcel, duplicates.openIssuesByParcel, v => v.trim().length >= 4)

  const take = useCallback((img: File | null) => {
    setErr('')
    if (img && !img.type.startsWith('image/')) { setErr('শুধু ছবি দিন (JPG / PNG)'); return }
    latest.current = img; setFile(img)
    if (!img) { setScan({ state: 'idle', ids: [], pct: 0 }); return }
    setScan({ state: 'reading', ids: [], pct: 0 })
    void readLabel(img, pct => { if (latest.current === img) setScan(v => v.state === 'reading' ? { ...v, pct } : v) }).then(ids => {
      if (latest.current !== img) return
      setScan({ state: ids.length ? 'done' : 'failed', ids, pct: 1 })
      // Only fills an empty box: an ID the person typed is never replaced.
      if (ids.length) setF(v => v.parcel.trim() ? v : { ...v, parcel: ids[0] })
    }).catch(() => { if (latest.current === img) setScan({ state: 'failed', ids: [], pct: 0 }) })
  }, [])
  useEffect(() => {
    if (!file) { setPreview(''); return }
    const u = URL.createObjectURL(file); setPreview(u); return () => URL.revokeObjectURL(u)
  }, [file])
  // A copied screenshot can be pasted straight in (Ctrl+V).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const img = [...(e.clipboardData?.items ?? [])].find(i => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile()
      if (img) { e.preventDefault(); take(img) }
    }
    window.addEventListener('paste', onPaste); return () => window.removeEventListener('paste', onPaste)
  }, [take])

  async function save() {
    setErr('')
    if (!f.title.trim() && !f.parcel.trim() && !file) { setErr('লেবেলের ছবি দিন, পার্সেল আইডি দিন বা কী সমস্যা লিখুন'); return }
    setBusy(true)
    try {
      const photo = file ? await issues.uploadPhoto(hub, file) : null
      onDone(await issues.create({ hub, title: f.title, body: f.body, kind: f.kind, parcel_ref: f.parcel, photo, assignee: person?.kind === 'employee' ? person.id : null,
        due: f.due ? new Date(f.due).toISOString() : null, priority: f.priority }))
    } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  return <Modal wide title="নতুন ইস্যু / কাজ দিন" onClose={onClose} actions={<><button type="button" disabled={busy} onClick={() => void save()}>{busy ? 'হচ্ছে…' : person ? 'ইস্যু তৈরি করে কাজ দিন' : 'ইস্যু তৈরি করুন'}</button><button type="button" className="secondary" onClick={onClose}>বাতিল</button></>}>
    <label className={`is-drop${preview ? ' has' : ''}`} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); take(e.dataTransfer.files?.[0] ?? null) }}>
      <input type="file" accept="image/*" className="is-file" onChange={e => { take(e.target.files?.[0] ?? null); e.target.value = '' }} />
      {preview ? <img src={preview} alt="লেবেলের ছবি" /> : <><Icon name="scan" size={30} /><b>পার্সেল লেবেলের স্ক্রিনশট / ছবি দিন</b>
        <small>চাপ দিয়ে গ্যালারি থেকে বাছুন, টেনে আনুন, অথবা কপি করা স্ক্রিনশট পেস্ট করুন (Ctrl+V)</small></>}
    </label>
    <div className="is-drop-acts">
      <label className="btn-ghost sm"><input type="file" accept="image/*" capture="environment" className="is-file" onChange={e => { take(e.target.files?.[0] ?? null); e.target.value = '' }} /><Icon name="scan" size={14} /> ক্যামেরায় তুলুন</label>
      {file && <button type="button" className="secondary sm" onClick={() => take(null)}>ছবি সরান</button>}
      <span className="muted small" role="status">
        {scan.state === 'reading' && `ছবি থেকে আইডি পড়া হচ্ছে… ${Math.round(scan.pct * 100)}%`}
        {scan.state === 'failed' && 'ছবি থেকে আইডি পড়া যায়নি — নিচে নিজে লিখতে পারেন (না লিখলেও ছবি থাকবে)'}
        {scan.state === 'done' && 'ছবিতে পাওয়া আইডি — মিলিয়ে নিন:'}</span>
      {scan.state === 'done' && scan.ids.map(id => <button key={id} type="button" className={`secondary sm${f.parcel === id ? ' on' : ''}`} onClick={() => setF({ ...f, parcel: id })}>{id}</button>)}
    </div>
    <div className="da-form">
      <Field label="পার্সেল আইডি" hint="ছবি দিলে নিজে পড়ে বসানোর চেষ্টা করে; ভুল হলে ঠিক করে দিন"><input value={f.parcel} onChange={e => setF({ ...f, parcel: e.target.value })} />
        {same.length > 0 && <DupNote>এই পার্সেলে আগে থেকেই ইস্যু খোলা আছে: {same.map(x => `${x.issue_no} (${STATUS_BN[x.status as keyof typeof STATUS_BN] ?? x.status})`).join(', ')} — আবার দিলে দুটো হবে।</DupNote>}</Field>
      <Field label="হাব"><select value={hub} onChange={e => setHub(e.target.value)}>{hubs.map(h => <option key={h.hub_id} value={h.hub_id}>{h.hub_name}</option>)}</select></Field>
      <Field label="কী সমস্যা" wide hint="না লিখলে পার্সেল আইডি দিয়েই ইস্যুর নাম হবে"><input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="যেমন: কাস্টমার ফোন ধরছে না" /></Field>
      <Field label="কাকে দেবেন" wide hint="এখন না বাছলে পরে দেওয়া যাবে"><PersonPicker value={person} onChange={setPerson} /></Field>
    </div>
    <button type="button" className="link" aria-expanded={more} onClick={() => setMore(m => !m)}>{more ? '▾ কম দেখান' : '▸ আরও তথ্য (ধরন, গুরুত্ব, শেষ সময়, বিস্তারিত)'}</button>
    {more && <div className="da-form">
      <Field label="ধরন"><select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as IssueKind })}>{Object.entries(KIND_BN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="গুরুত্ব"><select value={f.priority} onChange={e => setF({ ...f, priority: e.target.value as Priority })}>{Object.entries(PRIORITY_BN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="শেষ সময় (ঐচ্ছিক)"><input type="datetime-local" value={f.due} onChange={e => setF({ ...f, due: e.target.value })} /></Field>
      <Field label="বিস্তারিত" wide><textarea rows={2} value={f.body} onChange={e => setF({ ...f, body: e.target.value })} /></Field>
    </div>}
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}

// ------------------------------------------------------------------ store / IT orders
const ORDER_NAME: Record<OrderKind, string> = { store: 'স্টোর', it: 'আইটি' }
const ORDER_HINT: Record<OrderKind, string> = {
  store: 'যেমন: পলি ব্যাগ ২০০টা, টেপ ১০টা, প্রিন্টার কাগজ ২ রিম',
  it: 'যেমন: স্ক্যানার কাজ করছে না — নতুন একটা লাগবে; অথবা প্রিন্টারের কালি ২টা',
}
function whoText(w: InCharge) { return `${w.name}${w.code ? ` (#${w.code})` : ''}${w.hub ? ` · ${w.hub}` : ''}` }

/** Top of the orders tab: the two order buttons, and who receives each kind (the admin can change it). */
function OrderDesk({ canOrder, onOrder }: { canOrder: boolean; onOrder: (k: OrderKind) => void }) {
  const { can } = useAuth()
  const inc = useLoad(() => issues.orderIncharge(), [])
  const [edit, setEdit] = useState<OrderKind | null>(null)
  const [person, setPerson] = useState<RefPerson | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const admin = can('system.settings.configure')
  async function save(kind: OrderKind, employee: string | null) {
    setBusy(true); setErr('')
    try { await issues.setOrderIncharge(kind, employee); setEdit(null); setPerson(null); await inc.reload() } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  return <section className="panel od-desk">
    <div className="od-kinds">{(['store', 'it'] as OrderKind[]).map(k => { const w = inc.data?.[k] ?? null; return <div key={k} className="od-kind">
      <div className="od-head"><b>{ORDER_NAME[k]} অর্ডার</b>
        {canOrder && <button type="button" className="sm" onClick={() => onOrder(k)}><Icon name="plus" size={14} /> অর্ডার দিন</button>}</div>
      <p className="muted small" style={{ margin: 0 }}>অর্ডার যাঁর কাছে যাবে: {inc.loading ? '…' : w ? <b>{whoText(w)}</b> : <span className="warn">কাউকে ঠিক করা হয়নি — অর্ডার জমা হবে, কিন্তু কারো কাছে যাবে না</span>}
        {w && !w.has_login && <span className="warn"> — এই কর্মীর লগইন নেই, তাই অর্ডার দেখতে পারবেন না</span>}</p>
      {admin && edit !== k && <button type="button" className="link small" onClick={() => { setEdit(k); setPerson(null); setErr('') }}>{w ? 'বদলান' : 'দায়িত্বে একজনকে ঠিক করুন'}</button>}
      {admin && edit === k && <div className="od-edit"><PersonPicker value={person} onChange={setPerson} />
        <div className="row-acts"><button type="button" className="sm" disabled={busy || person?.kind !== 'employee'} onClick={() => person?.kind === 'employee' && void save(k, person.id)}>সেভ করুন</button>
          {w && <button type="button" className="secondary sm" disabled={busy} onClick={() => void save(k, null)}>কাউকে রাখব না</button>}
          <button type="button" className="secondary sm" onClick={() => setEdit(null)}>বাতিল</button></div>
        <p className="muted small" style={{ margin: 0 }}>সিস্টেমের একজন সক্রিয় কর্মী বাছুন (নিজে লেখা নাম চলবে না)। অর্ডার দেখতে তাঁর লগইন থাকা লাগবে।</p></div>}
    </div> })}</div>
    {inc.error ? <p className="da-error">{errText(inc.error)}</p> : null}
    {err && <p className="da-error" role="alert">{err}</p>}
    <p className="muted small" style={{ margin: '8px 0 0' }}>হাব লিখে অর্ডার দেয় → দায়িত্বে থাকা ব্যক্তি “পাঠিয়েছি” দেন → হাব “পেয়েছি” দিলে অর্ডার শেষ। “পেয়েছি” না দেওয়া পর্যন্ত অর্ডার তালিকায় থাকে।</p>
  </section>
}

/** Order form: Store or IT, which hub, what is needed in the person's own words. It goes to the in-charge by itself. */
function NewOrder({ hubs, kind: k0, onClose, onDone }: { hubs: GroupHub[]; kind: OrderKind; onClose: () => void; onDone: (id: string) => void }) {
  const [kind, setKind] = useState<OrderKind>(k0)
  const [hub, setHub] = useState(hubs[0]?.hub_id ?? '')
  const [text, setText] = useState('')
  const [priority, setPriority] = useState<Priority>('normal')
  const [due, setDue] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [other, setOther] = useState(false)
  const [person, setPerson] = useState<RefPerson | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const inc = useLoad(() => issues.orderIncharge(), [])
  const who = inc.data?.[kind] ?? null
  const pickSomeone = other || (!inc.loading && !who)
  async function save() {
    setErr('')
    const body = text.trim()
    if (!hub) { setErr('হাব বেছে নিন'); return }
    if (!body) { setErr('কী কী লাগবে লিখুন'); return }
    setBusy(true)
    try {
      const photo = file ? await issues.uploadPhoto(hub, file) : null
      const first = body.split('\n')[0].trim()
      onDone(await issues.create({ hub, kind, title: `${KIND_BN[kind]}: ${first.length > 60 ? first.slice(0, 58) + '…' : first}`, body, photo, priority,
        assignee: pickSomeone && person?.kind === 'employee' ? person.id : null, due: due ? new Date(`${due}T18:00:00`).toISOString() : null }))
    } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  return <Modal wide title="স্টোর / আইটি অর্ডার" onClose={onClose} actions={<><button type="button" disabled={busy} onClick={() => void save()}>{busy ? 'হচ্ছে…' : 'অর্ডার দিন'}</button><button type="button" className="secondary" onClick={onClose}>বাতিল</button></>}>
    <div className="da-seg" role="group" aria-label="কোথায় অর্ডার">{(['store', 'it'] as OrderKind[]).map(k => <button key={k} type="button" className={kind === k ? '' : 'secondary'} aria-pressed={kind === k} onClick={() => setKind(k)}>{ORDER_NAME[k]}</button>)}</div>
    <div className="da-form" style={{ marginTop: 12 }}>
      <Field label="কোন হাবের জন্য" required><Combo value={hub} onChange={setHub} clearable={false} options={hubs.map(h => ({ value: h.hub_id, label: h.hub_name }))} /></Field>
      <Field label="গুরুত্ব"><select value={priority} onChange={e => setPriority(e.target.value as Priority)}>{Object.entries(PRIORITY_BN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="কী কী লাগবে" wide required hint="যেভাবে বলেন সেভাবেই লিখুন — জিনিসের নাম আর পরিমাণ"><textarea rows={4} value={text} onChange={e => setText(e.target.value)} placeholder={ORDER_HINT[kind]} /></Field>
      <Field label="কবে লাগবে (ঐচ্ছিক)"><input type="date" value={due} onChange={e => setDue(e.target.value)} /></Field>
      <Field label="ছবি (ঐচ্ছিক)"><input type="file" accept="image/*" onChange={e => setFile(e.target.files?.[0] ?? null)} /></Field>
    </div>
    <div className="od-to">
      {inc.loading ? <span className="muted small">লোড হচ্ছে…</span>
        : who && !other ? <><span>অর্ডার যাবে: <b>{whoText(who)}</b></span><button type="button" className="link small" onClick={() => setOther(true)}>অন্য কাউকে দিন</button></>
        : <><span className={who ? '' : 'warn'}>{who ? 'কাকে দেবেন বাছুন' : `${ORDER_NAME[kind]}ের দায়িত্বে কাউকে ঠিক করা হয়নি — নিচে একজনকে বাছুন, নাহলে অর্ডার জমা থাকবে আর পরে দেওয়া যাবে`}</span>
          {who && <button type="button" className="link small" onClick={() => { setOther(false); setPerson(null) }}>{whoText(who)}-কেই দিন</button>}</>}
    </div>
    {pickSomeone && <PersonPicker value={person} onChange={setPerson} />}
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}

// ------------------------------------------------------------------ hub group
function Group({ hubs, onOpenIssue, onNew }: { hubs: GroupHub[]; onOpenIssue: (id: string) => void; onNew: (hub: string) => void }) {
  const [hub, setHub] = useState('')
  const cur = hub || hubs[0]?.hub_id || ''
  const feed = useLoad(() => (cur ? issues.feed(cur) : Promise.resolve([] as Post[])), [cur])
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [err, setErr] = useState('')
  const [who, setWho] = useState<{ title: string; rows: Who[] } | null>(null)
  const seenSent = useRef(new Set<string>())
  // Opening the group marks the posts on screen as seen.
  useEffect(() => {
    const ids = (feed.data ?? []).filter(p => !p.seen_by_me && !seenSent.current.has(p.id)).map(p => p.id)
    if (!ids.length) return
    ids.forEach(i => seenSent.current.add(i)); void issues.markSeen(ids).catch(() => ids.forEach(i => seenSent.current.delete(i)))
  }, [feed.data])
  const send = useCallback(async () => {
    setErr('')
    try { const photo = file ? await issues.uploadPhoto(cur, file) : null; await issues.post(cur, text, photo); setText(''); setFile(null); await feed.reload() } catch (e) { setErr(errText(e)) }
  }, [cur, text, file, feed])
  async function react(p: Post, e: string) { try { await issues.react(p.id, e); await feed.reload() } catch (x) { setErr(errText(x)) } }
  async function showSeen(p: Post) { try { setWho({ title: 'যারা দেখেছে', rows: await issues.seenBy(p.id) }) } catch (x) { setErr(errText(x)) } }
  async function showReacts(p: Post) { try { setWho({ title: 'কে কী রিঅ্যাক্ট দিয়েছে', rows: await issues.reactedBy(p.id) }) } catch (x) { setErr(errText(x)) } }
  if (!hubs.length) return <p className="muted" style={{ padding: 16 }}>আপনার জন্য কোনো হাব গ্রুপ নেই</p>
  return <div>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '0 0 8px', flexWrap: 'wrap' }}>
      <select value={cur} onChange={e => setHub(e.target.value)}>{hubs.map(h => <option key={h.hub_id} value={h.hub_id}>{h.hub_name}{h.unseen ? ` (${h.unseen} নতুন)` : ''}</option>)}</select>
      <button type="button" onClick={() => onNew(cur)}><Icon name="plus" size={14} /> এই হাবে ইস্যু</button></div>
    <div className="is-composer">
      <textarea rows={2} placeholder="গ্রুপে লিখুন…" value={text} onChange={e => setText(e.target.value)} style={{ width: '100%' }} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
        <input type="file" accept="image/*" capture="environment" onChange={e => setFile(e.target.files?.[0] ?? null)} />
        <button type="button" disabled={!text.trim() && !file} onClick={() => void send()} style={{ marginLeft: 'auto' }}>পাঠান</button></div>
      {err && <p className="da-error" role="alert">{err}</p>}</div>
    {feed.loading && !feed.data ? <p className="muted">লোড হচ্ছে…</p> : null}
    <div style={{ display: 'grid', gap: 10 }}>{(feed.data ?? []).map(p => <div key={p.id} className={`is-post${p.is_nodi ? ' nodi' : ''}`}>
      <div className="who"><span className="is-av">{p.is_nodi ? '🤖' : (p.author_name || '?').slice(0, 1)}</span><div><strong>{p.is_nodi ? 'নদী AI' : p.author_name}</strong><div className="muted" style={{ fontSize: 12 }}>{when(p.created_at)}</div></div></div>
      {p.body && <p style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>{p.body}</p>}
      {p.photo_path && <Photo path={p.photo_path} />}
      {p.issue && <button type="button" className="secondary" style={{ textAlign: 'left', width: '100%' }} onClick={() => onOpenIssue(p.issue!.id)}>
        <strong>{p.issue.issue_no}</strong> · {p.issue.title} · <Badge tone={TONE[p.issue.status]}>{STATUS_BN[p.issue.status]}</Badge>
        <span className="muted"> · {p.issue.assignee ?? 'কাউকে দেওয়া হয়নি'}</span></button>}
      <div className="rx">
        {EMOJIS.map(e => { const r = p.reactions[e]; return <button key={e} type="button" className={r?.mine ? '' : 'secondary'} onClick={() => void react(p, e)}>{e}{r ? ` ${r.n}` : ''}</button> })}
        {Object.keys(p.reactions).length > 0 && <button type="button" className="secondary" onClick={() => void showReacts(p)}>কে?</button>}
        <button type="button" className="secondary" style={{ marginLeft: 'auto' }} onClick={() => void showSeen(p)}><Icon name="eye" size={14} /> {p.seen_count} জন দেখেছে</button></div>
    </div>)}
    {feed.data && !feed.data.length && <p className="muted" style={{ padding: 16 }}>গ্রুপে এখনো কিছু নেই</p>}</div>
    {who && <Modal title={who.title} onClose={() => setWho(null)} actions={<button type="button" onClick={() => setWho(null)}>বন্ধ</button>}>
      {who.rows.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{who.rows.map((w, k) => <li key={k}>{w.emoji ? `${w.emoji} ` : ''}{w.full_name}{w.employee_code ? ` (${w.employee_code})` : ''} <span className="muted">· {when(w.seen_at ?? w.at ?? '')}</span></li>)}</ul> : <p className="muted">কেউ নেই</p>}
    </Modal>}
  </div>
}
