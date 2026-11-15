import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { PersonPicker, type RefPerson } from '../../components/PersonPicker'
import { hrFriendly } from '../../lib/hr'
import { ACTION_BN, EMOJIS, KIND_BN, PRIORITY_BN, issues, type GroupHub, type IssueDetail, type IssueKind, type IssueRow, type Panels, type Post, type Priority, type Who } from '../../lib/issues'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'

type Tab = 'mine' | 'check' | 'given' | 'group' | 'hub'
const errText = (e: unknown) => (e instanceof Error && !('code' in e) ? e.message : hrFriendly(e))
const when = (s: string) => new Date(s).toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const TONE = { open: 'info', in_progress: 'warn', solved: 'ok', approved: 'ok', cancelled: 'neutral' } as const
const STATUS_BN = { open: 'নতুন', in_progress: 'কাজ চলছে', solved: 'সমাধান — চেক বাকি', approved: 'অনুমোদিত', cancelled: 'বাতিল' } as const

export function Issues() {
  const [sp, setSp] = useSearchParams()
  const { toast, node } = useToast()
  const panels = useLoad(() => issues.panels(), [])
  const groups = useLoad(() => issues.groupHubs(), [])
  const [creating, setCreating] = useState<string | null>(null)
  const p: Panels = panels.data ?? { mine: [], to_check: [], given: [], waiting_for_check_of_mine: [], hub: [] }
  const tab = (sp.get('tab') as Tab) || (p.to_check.length ? 'check' : p.mine.length ? 'mine' : 'group')
  const open = sp.get('id')
  const go = (t: Tab) => { const n = new URLSearchParams(sp); n.set('tab', t); n.delete('id'); setSp(n, { replace: true }) }
  const openIssue = (id: string | null) => { const n = new URLSearchParams(sp); if (id) n.set('id', id); else n.delete('id'); setSp(n, { replace: true }) }
  const refresh = () => { void panels.reload(); void groups.reload() }
  const hubs = groups.data ?? []
  const tabs: Array<[Tab, string, number, string]> = [
    ['mine', 'আমার কাজ', p.mine.length, 'tasks'], ['check', 'চেক বাকি', p.to_check.length, 'check'], ['given', 'আমি দিয়েছি', p.given.length, 'form'],
    ['group', 'হাব গ্রুপ', hubs.reduce((a, h) => a + h.unseen, 0), 'users'], ['hub', 'হাবের সব ইস্যু', p.hub.length, 'grid']]
  const late = [...p.mine, ...p.given].filter(r => r.overdue).length
  const tiles: Array<[Tab, string, number, string]> = [['mine', 'আমার কাজ', p.mine.length, late ? 'warn' : ''], ['check', 'চেক বাকি', p.to_check.length, p.to_check.length ? 'bad' : ''], ['given', 'আমি দিয়েছি', p.given.length, '']]
  return <AppShell title="ইস্যু ও ফলো-আপ" subtitle="কাজ দিন, সমাধান চেক করে অনুমোদন দিন — অনুমোদন না হলে ইস্যু প্যানেলেই থাকে">
    <div className="is-tiles">{tiles.map(([k, l, c, tone]) => <button key={k} type="button" className={`is-tile ${tone}${tab === k ? ' on' : ''}`} onClick={() => go(k)}><b>{c}</b><span>{l}</span></button>)}</div>
    <div className="rq-tabs">{tabs.map(([k, l, c, ic]) => <button key={k} type="button" className={`rq-tab${tab === k ? ' on' : ''}`} onClick={() => go(k)}>
      <Icon name={ic} size={16} />{l}{c > 0 ? ` (${c})` : ''}</button>)}
    {hubs.length > 0 && <button type="button" className="rq-tab" onClick={() => setCreating(hubs[0].hub_id)}><Icon name="plus" size={16} />নতুন ইস্যু</button>}</div>
    {panels.error ? <p className="da-error">{errText(panels.error)}</p> : null}
    {tab === 'mine' && <>
      <List rows={p.mine} empty="আপনাকে দেওয়া কোনো কাজ বাকি নেই" onOpen={openIssue} onChanged={() => { refresh(); toast('হয়েছে') }} />
      {p.waiting_for_check_of_mine.length > 0 && <><h3 className="muted" style={{ margin: '16px 0 6px' }}>সমাধান জানিয়েছেন — যিনি দিয়েছেন তার চেকের অপেক্ষায়</h3>
        <List rows={p.waiting_for_check_of_mine} empty="" onOpen={openIssue} onChanged={() => { refresh(); toast('হয়েছে') }} /></>}</>}
    {tab === 'check' && <List rows={p.to_check} empty="চেক করার মতো সমাধান করা কোনো ইস্যু নেই" onOpen={openIssue} onChanged={() => { refresh(); toast('হয়েছে') }} />}
    {tab === 'given' && <List rows={p.given} empty="আপনার দেওয়া কোনো কাজ এখন চলছে না" onOpen={openIssue} onChanged={() => { refresh(); toast('হয়েছে') }} />}
    {tab === 'hub' && <List rows={p.hub} empty="হাবে অন্য কোনো খোলা ইস্যু নেই" onOpen={openIssue} onChanged={() => { refresh(); toast('হয়েছে') }} />}
    {tab === 'group' && <Group hubs={hubs} onOpenIssue={openIssue} onNew={h => setCreating(h)} />}
    {open && <Detail id={open} onClose={() => openIssue(null)} onChanged={() => { refresh(); toast('হয়েছে') }} />}
    {creating && <NewIssue hubs={hubs} hub={creating} onClose={() => setCreating(null)} onDone={id => { setCreating(null); refresh(); toast('ইস্যু তৈরি হয়েছে'); openIssue(id) }} />}
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
    <div className="head"><span className="no">{r.issue_no}</span><Badge tone={TONE[r.status]}>{STATUS_BN[r.status]}</Badge>
      {r.priority !== 'normal' && <Badge tone={r.priority === 'low' ? 'neutral' : 'bad'}>{PRIORITY_BN[r.priority]}</Badge>}
      {r.overdue && <Badge tone="bad">সময় পার</Badge>}{r.reopen_count > 0 && <Badge tone="warn">ফেরত {r.reopen_count}</Badge>}
      <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>{when(r.created_at)}</span></div>
    <div className="ttl" onClick={() => onOpen(r.id)}>{r.title}</div>
    <div className="meta"><span>{KIND_BN[r.kind]} · {r.hub}{r.parcel_ref ? ` · ${r.parcel_ref}` : ''}</span>
      <span>কাকে: {r.assignee ? `${r.assignee}${r.assignee_code ? ` (${r.assignee_code})` : ''}` : 'কাউকে দেওয়া হয়নি'}{r.assigned_by_nodi ? ' · নদী AI বেছেছে' : ''}</span>
      <span>কে দিয়েছে: {r.assigned_by_name ?? '—'}</span></div>
    <div className="acts">
      {r.is_mine && r.status === 'open' && <button type="button" disabled={busy === r.id} onClick={() => void quick(r, 'start')}>▶ শুরু করলাম</button>}
      {r.is_mine && (r.status === 'open' || r.status === 'in_progress') && <button type="button" onClick={() => onOpen(r.id)}>✔ সমাধান জানান</button>}
      {r.is_giver && r.status === 'solved' && <button type="button" disabled={busy === r.id} onClick={() => void quick(r, 'approve')}>✔ অনুমোদন</button>}
      {r.is_giver && r.status === 'solved' && <button type="button" className="secondary" onClick={() => onOpen(r.id)}>↩ ফেরত / দেখুন</button>}
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
  async function act(a: 'start' | 'solve' | 'approve' | 'reopen' | 'cancel') {
    setErr(''); if (needNote(a) && !note.trim()) { setErr('কারণ লিখুন'); return }
    if (a === 'solve' && !note.trim() && !file) { setErr('কী করা হয়েছে লিখুন বা ছবি দিন'); return }
    setBusy(true)
    try {
      const photo = file && i ? await issues.uploadPhoto(i.hub_id, file) : null
      await issues.act(id, a, note, photo); setNote(''); setFile(null); await d.reload(); await p.reload(); onChanged()
    } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  async function doAssign() {
    if (person?.kind !== 'employee') { setErr('সিস্টেমের কাউকে বাছুন'); return }
    setBusy(true); setErr('')
    try { await issues.assign(id, person.id, note); setAssign(false); setPerson(null); await d.reload(); await p.reload(); onChanged() } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  const live = i && (i.status === 'open' || i.status === 'in_progress' || i.status === 'solved')
  return <Modal wide title={i ? `${i.issue_no} · ${i.title}` : 'ইস্যু'} onClose={onClose} actions={<>
    {live && mine && i.status === 'open' && <button type="button" disabled={busy} onClick={() => void act('start')}>কাজ শুরু করলাম</button>}
    {live && mine && (i.status === 'open' || i.status === 'in_progress') && <button type="button" disabled={busy} onClick={() => void act('solve')}>সমাধান হয়েছে</button>}
    {live && giver && i.status === 'solved' && <button type="button" disabled={busy} onClick={() => void act('approve')}>চেক করেছি — অনুমোদন</button>}
    {live && giver && i.status === 'solved' && <button type="button" className="secondary" disabled={busy} onClick={() => void act('reopen')}>ঠিক হয়নি — ফেরত</button>}
    {live && giver && <button type="button" className="secondary" onClick={() => setAssign(a => !a)}>অন্যকে দিন</button>}
    {live && giver && <button type="button" className="secondary" disabled={busy} onClick={() => void act('cancel')}>বাতিল</button>}
    <button type="button" className="secondary" onClick={onClose}>বন্ধ</button></>}>
    {d.loading && !x ? <p className="muted">লোড হচ্ছে…</p> : null}
    {d.error ? <p className="da-error">{errText(d.error)}</p> : null}
    {x && i && <>
      <p><Badge tone={TONE[i.status]}>{i.status_bn}</Badge> {KIND_BN[i.kind]} · {i.hub} · কাকে: {i.assignee ?? 'কাউকে দেওয়া হয়নি'}{i.assignee_code ? ` (${i.assignee_code})` : ''} · কে দিয়েছে: {i.assigned_by_name ?? '—'}</p>
      {i.body && <p style={{ whiteSpace: 'pre-wrap' }}>{i.body}</p>}
      {i.parcel_ref && <p className="muted">পার্সেল আইডি: <strong>{i.parcel_ref}</strong>{x.parcel ? ` · ${String(x.parcel.customer_name ?? '')} · ${String(x.parcel.status ?? '')}` : ' · (এই হাবের পার্সেল তালিকায় পাওয়া যায়নি)'}</p>}
      {i.photo_path && <Photo path={i.photo_path} />}
      {i.solved_note && <p><strong>সমাধান:</strong> {i.solved_note}</p>}{i.solve_photo && <Photo path={i.solve_photo} />}
      {live && (mine || giver) && <Field label={mine && !giver ? 'কী করেছেন (সমাধানে লাগবে) / ছবি' : 'মন্তব্য (ফেরত বা বাতিলে কারণ লাগবে)'} wide>
        <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} />
        <input type="file" accept="image/*" capture="environment" onChange={e => setFile(e.target.files?.[0] ?? null)} /></Field>}
      {assign && <Field label="নতুন কাকে দেবেন" wide><PersonPicker value={person} onChange={setPerson} /><button type="button" disabled={busy} onClick={() => void doAssign()}>এই ব্যক্তিকে দিন</button></Field>}
      {err && <p className="da-error" role="alert">{err}</p>}
      <h4 style={{ margin: '12px 0 4px' }}>ইতিহাস</h4>
      <ul style={{ margin: 0, paddingLeft: 18 }}>{x.events.map(e => <li key={e.id}><strong>{ACTION_BN[e.action] ?? e.action}</strong> — {e.by_name}{e.note ? `: ${e.note}` : ''} <span className="muted">· {when(e.at)}</span></li>)}</ul>
    </>}
  </Modal>
}

function Photo({ path }: { path: string }) {
  const u = useLoad(() => issues.photoUrl(path), [path])
  return u.data ? <a href={u.data} target="_blank" rel="noreferrer"><img src={u.data} alt="ছবি" style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 8, margin: '6px 0' }} /></a> : null
}

// ------------------------------------------------------------------ new issue
function NewIssue({ hubs, hub: h0, onClose, onDone }: { hubs: GroupHub[]; hub: string; onClose: () => void; onDone: (id: string) => void }) {
  const [hub, setHub] = useState(h0)
  const [f, setF] = useState({ title: '', body: '', parcel: '', kind: 'parcel' as IssueKind, priority: 'normal' as Priority, due: '' })
  const [person, setPerson] = useState<RefPerson | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function save() {
    setErr('')
    if (!f.title.trim() && !f.parcel.trim() && !file) { setErr('কী সমস্যা লিখুন, পার্সেল আইডি দিন বা ছবি দিন'); return }
    setBusy(true)
    try {
      const photo = file ? await issues.uploadPhoto(hub, file) : null
      onDone(await issues.create({ hub, title: f.title, body: f.body, kind: f.kind, parcel_ref: f.parcel, photo, assignee: person?.kind === 'employee' ? person.id : null,
        due: f.due ? new Date(f.due).toISOString() : null, priority: f.priority }))
    } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  return <Modal wide title="নতুন ইস্যু / কাজ দিন" onClose={onClose} actions={<><button type="button" disabled={busy} onClick={() => void save()}>{busy ? 'হচ্ছে…' : 'ইস্যু তৈরি করুন'}</button><button type="button" className="secondary" onClick={onClose}>বাতিল</button></>}>
    <div className="da-form">
      <Field label="হাব"><select value={hub} onChange={e => setHub(e.target.value)}>{hubs.map(h => <option key={h.hub_id} value={h.hub_id}>{h.hub_name}</option>)}</select></Field>
      <Field label="ধরন"><select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as IssueKind })}>{Object.entries(KIND_BN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="পার্সেল আইডি" hint="দিলে ওই পার্সেলের রাইডারকে কাজ চলে যায় (কাউকে না বাছলে)"><input value={f.parcel} onChange={e => setF({ ...f, parcel: e.target.value })} /></Field>
      <Field label="গুরুত্ব"><select value={f.priority} onChange={e => setF({ ...f, priority: e.target.value as Priority })}>{Object.entries(PRIORITY_BN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="কী সমস্যা" wide><input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="বিস্তারিত" wide><textarea rows={2} value={f.body} onChange={e => setF({ ...f, body: e.target.value })} /></Field>
      <Field label="শেষ সময় (ঐচ্ছিক)"><input type="datetime-local" value={f.due} onChange={e => setF({ ...f, due: e.target.value })} /></Field>
      <Field label="ছবি (পার্সেল লেবেল / সমস্যা)"><input type="file" accept="image/*" capture="environment" onChange={e => setFile(e.target.files?.[0] ?? null)} /></Field>
      <Field label="কাকে দেবেন" wide hint="না বাছলে পার্সেলের রাইডার, নাহলে পরে দেওয়া যাবে"><PersonPicker value={person} onChange={setPerson} /></Field>
    </div>
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
