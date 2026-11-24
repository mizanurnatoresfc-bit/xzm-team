import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { PersonPicker, type RefPerson } from '../../components/PersonPicker'
import { hrFriendly } from '../../lib/hr'
import { ACTION_BN, EMOJIS, KIND_BN, ORDER_ACTION_BN, ORDER_STATUS_BN, PRIORITY_BN, isOrder, issues, type GroupHub, type ZoneGroup, type InCharge, type IssueDetail, type IssueKind, type IssueRow, type OrderKind, type Panels, type Post, type Priority, type Who } from '../../lib/issues'
import { readLabel } from '../../lib/ocr'
import { duplicates, matches } from '../../lib/validate'
import { Combo, DupNote, useDuplicates } from '../../components/inputs'
import { useAuth } from '../../auth/AuthProvider'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'

/** Which conversations the list shows. ("tab" in the address, as before.) */
type Filter = 'all' | 'mine' | 'check' | 'given' | 'group' | 'zone' | 'hub' | 'orders'
const FILTERS: Filter[] = ['all', 'mine', 'check', 'given', 'group', 'zone', 'hub', 'orders']
const errText = (e: unknown) => (e instanceof Error && !('code' in e) ? e.message : hrFriendly(e))
const when = (s: string) => new Date(s).toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
/** Like a chat list: the time for today, the date for older. */
const short = (s: string) => {
  const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
  const d = new Date(s)
  return d.toLocaleString('bn-BD', day(d) === day(new Date()) ? { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' } : { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short' })
}
const TONE = { open: 'info', in_progress: 'warn', solved: 'ok', approved: 'ok', cancelled: 'neutral' } as const
const STATUS_BN = { open: 'নতুন', in_progress: 'কাজ চলছে', solved: 'সমাধান — চেক বাকি', approved: 'অনুমোদিত', cancelled: 'বাতিল' } as const
/** Status in the words of the kind: an order is prepared, sent and received; an issue is worked, solved and checked. */
const statusText = (kind: string, status: keyof typeof STATUS_BN) => (isOrder(kind) ? ORDER_STATUS_BN : STATUS_BN)[status]
const KIND_ICON: Record<IssueKind, string> = { parcel: '📦', vehicle: '🛵', staff: '👤', cash: '💵', other: '📝', store: '🧰', it: '💻' }
/** True when the next step is this person's: their job to finish, or their turn to check. */
const myTurn = (r: IssueRow) => (r.is_mine && (r.status === 'open' || r.status === 'in_progress')) || ((r.can_review ?? r.is_giver) && r.status === 'solved')

// ------------------------------------------------------------------ each person's own settings (kept on this device)
type Ui = { view: 'chat' | 'board'; first: Filter; dense: boolean; refresh: number; enterSends: boolean; groupsOnTop: boolean }
const UI0: Ui = { view: 'chat', first: 'all', dense: false, refresh: 60, enterSends: true, groupsOnTop: true }
const UI_KEY = 'xzm_issues_ui'
function loadUi(): Ui {
  try {
    const u = { ...UI0, ...(JSON.parse(localStorage.getItem(UI_KEY) || '{}') as Partial<Ui>) }
    return { ...u, view: u.view === 'board' ? 'board' : 'chat', first: FILTERS.includes(u.first) ? u.first : 'all', refresh: [0, 30, 60, 120].includes(u.refresh) ? u.refresh : 60 }
  } catch { return UI0 }
}
function useUi() {
  const [ui, set] = useState(loadUi)
  const save = useCallback((p: Partial<Ui>) => set(u => { const n = { ...u, ...p }; try { localStorage.setItem(UI_KEY, JSON.stringify(n)) } catch { /* private window: the choice lasts until the page closes */ } return n }), [])
  return [ui, save] as const
}
/** Runs `fn` every so many seconds while the page is in front (0 = never). */
function useEvery(seconds: number, fn: () => void) {
  const f = useRef(fn)
  useEffect(() => { f.current = fn })
  useEffect(() => {
    if (!seconds) return
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') f.current() }, seconds * 1000)
    return () => window.clearInterval(t)
  }, [seconds])
}
const uniq = (rows: IssueRow[]) => [...new Map(rows.map(r => [r.id, r])).values()]

export function Issues() {
  const [sp, setSp] = useSearchParams()
  const { toast, node } = useToast()
  const [ui, setUi] = useUi()
  const panels = useLoad(() => issues.panels(), [])
  const groups = useLoad(() => issues.groupHubs(), [])
  const zones = useLoad(() => issues.zoneGroups(), [])
  const [creating, setCreating] = useState<string | null>(null)
  const [residential, setResidential] = useState(false)
  const [ordering, setOrdering] = useState<OrderKind | null>(null)
  const [q, setQ] = useState('')
  const [settings, setSettings] = useState(false)
  const [desk, setDesk] = useState(false)
  const p: Panels = panels.data ?? { mine: [], to_check: [], given: [], waiting_for_check_of_mine: [], hub: [] }
  const hubs = groups.data ?? []
  const asked = sp.get('tab') as Filter | null
  const filter: Filter = asked && FILTERS.includes(asked) ? asked : ui.first
  const open = sp.get('id')
  const group = hubs.find(h => h.hub_id === sp.get('g')) ?? null
  const zoneList = zones.data ?? []
  const zone = zoneList.find(z => z.zone_id === sp.get('z')) ?? null
  const put = (f: (n: URLSearchParams) => void) => { const n = new URLSearchParams(sp); f(n); setSp(n, { replace: true }) }
  const go = (t: Filter) => put(n => n.set('tab', t))
  const openIssue = (id: string | null) => put(n => { n.delete('g'); n.delete('z'); if (id) n.set('id', id); else n.delete('id') })
  const openGroup = (h: string) => put(n => { n.delete('id'); n.delete('z'); n.set('g', h) })
  const openZone = (z: string) => put(n => { n.delete('id'); n.delete('g'); n.set('z', z) })
  const closeChat = () => put(n => { n.delete('id'); n.delete('g'); n.delete('z') })
  const refresh = () => { void panels.reload(); void groups.reload(); void zones.reload() }
  const changed = () => { refresh(); toast('হয়েছে') }
  useEvery(ui.refresh, refresh)
  // A shortcut link (/app/issues?new=1) opens the new-issue form at once.
  useEffect(() => {
    if (!sp.get('new') || !hubs.length) return
    setResidential(sp.get('new') === 'residential')
    setCreating(c => c ?? hubs.find(h => h.hub_id === sp.get('hub'))?.hub_id ?? hubs[0].hub_id)
    const n = new URLSearchParams(sp); n.delete('new'); n.delete('hub'); setSp(n, { replace: true })
  }, [sp, hubs, setSp])
  // ...and /app/issues?order=store (or it) opens the order form.
  useEffect(() => {
    const k = sp.get('order')
    if (!k || !hubs.length) return
    setOrdering(isOrder(k) ? k : 'store')
    const n = new URLSearchParams(sp); n.delete('order'); n.set('tab', 'orders'); setSp(n, { replace: true })
  }, [sp, hubs, setSp])

  // Every open issue / order this person can see, whichever panel it sits in — newest first.
  const everything = uniq([...p.to_check, ...p.mine, ...p.waiting_for_check_of_mine, ...p.given, ...p.hub]).sort((a, b) => b.created_at.localeCompare(a.created_at))
  const ids = (rows: IssueRow[]) => new Set(rows.map(r => r.id))
  const inFilter: Record<Exclude<Filter, 'all' | 'group' | 'zone'>, (r: IssueRow) => boolean> = {
    mine: (s => (r: IssueRow) => s.has(r.id))(ids([...p.mine, ...p.waiting_for_check_of_mine])), check: (s => (r: IssueRow) => s.has(r.id))(ids(p.to_check)),
    given: (s => (r: IssueRow) => s.has(r.id))(ids(p.given)), hub: (s => (r: IssueRow) => s.has(r.id))(ids(p.hub)), orders: r => isOrder(r.kind) }
  const count = (f: Exclude<Filter, 'all' | 'group' | 'zone'>) => everything.filter(inFilter[f]).length
  const rows = (filter === 'group' || filter === 'zone' ? [] : filter === 'all' ? everything : everything.filter(inFilter[filter]))
    .filter(r => matches(`${r.title} ${r.issue_no} ${r.assignee ?? ''} ${r.assignee_code ?? ''} ${r.hub ?? ''} ${r.parcel_ref ?? ''} ${r.assigned_by_name ?? ''}`, q))
  const shownHubs = hubs.filter(h => matches(`${h.hub_name} ${h.hub_code}`, q))
  const unseen = hubs.reduce((a, h) => a + h.unseen, 0)
  const shownZones = zoneList.filter(z => matches(`${z.zone_name} ${z.zone_code}`, q))
  const zoneUnseen = zoneList.reduce((a, z) => a + z.unseen, 0)
  const late = everything.filter(r => r.overdue && (r.is_mine || r.is_giver)).length
  const chips: Array<[Filter, string, number, string]> = [['all', 'সব', everything.length, ''], ['mine', 'আমার কাজ', count('mine'), late ? 'warn' : ''], ['check', 'চেক বাকি', count('check'), count('check') ? 'bad' : ''],
    ['given', 'আমি দিয়েছি', count('given'), ''], ['group', 'হাব গ্রুপ', unseen, unseen ? 'bad' : ''], ['zone', 'জোন গ্রুপ', zoneUnseen, zoneUnseen ? 'bad' : ''], ['hub', 'হাবের সব', count('hub'), ''], ['orders', 'অর্ডার', count('orders'), '']]
  const EMPTY: Record<Filter, string> = { all: 'এখন কোনো খোলা ইস্যু নেই', mine: 'আপনাকে দেওয়া কোনো কাজ বাকি নেই', check: 'চেক করার মতো সমাধান করা কোনো ইস্যু নেই', given: 'আপনার দেওয়া কোনো কাজ এখন চলছে না',
    group: 'আপনার জন্য কোনো হাব গ্রুপ নেই', zone: 'আপনার জন্য কোনো জোন গ্রুপ নেই', hub: 'হাবে অন্য কোনো খোলা ইস্যু নেই', orders: 'এখন কোনো স্টোর / আইটি অর্ডার খোলা নেই' }

  const bar = <div className="mg-bar">
    <label className="mg-search"><Icon name="search" size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="খুঁজুন — নাম, আইডি, হাব…" aria-label="ইস্যু খুঁজুন" /></label>
    {hubs.length > 0 && <button type="button" className="mg-ic primary" title="নতুন ইস্যু" aria-label="নতুন ইস্যু" onClick={() => setCreating(group?.hub_id ?? hubs[0].hub_id)}><Icon name="plus" size={18} /></button>}
    {hubs.length > 0 && <button type="button" className="mg-ic" title="স্টোর / আইটি অর্ডার দিন" aria-label="স্টোর / আইটি অর্ডার দিন" onClick={() => setOrdering('store')}><Icon name="box" size={18} /></button>}
    <div className="mg-view" role="group" aria-label="চেহারা">
      <button type="button" className={ui.view === 'chat' ? 'on' : ''} aria-pressed={ui.view === 'chat'} onClick={() => setUi({ view: 'chat' })}>চ্যাট</button>
      <button type="button" className={ui.view === 'board' ? 'on' : ''} aria-pressed={ui.view === 'board'} onClick={() => setUi({ view: 'board' })}>বোর্ড</button></div>
    <button type="button" className="mg-ic" title="আমার সেটিং" aria-label="আমার সেটিং" onClick={() => setSettings(true)}><Icon name="gear" size={18} /></button>
  </div>
  const chipRow = <div className="mg-chips">{chips.filter(([k]) => (ui.view === 'chat' || (k !== 'group' && k !== 'zone')) && (k !== 'zone' || zoneList.length > 0)).map(([k, l, c, tone]) => <button key={k} type="button" className={`mg-chip ${tone}${filter === k ? ' on' : ''}`} aria-pressed={filter === k} onClick={() => go(k)}>
    {l}{c > 0 && <b>{c}</b>}</button>)}</div>
  const deskRow = filter === 'orders' && <button type="button" className="mg-desk" onClick={() => setDesk(true)}><Icon name="user" size={15} /> স্টোর / আইটি অর্ডার কে পাবেন — দেখুন</button>
  const groupRows = shownHubs.map(h => <button key={h.hub_id} type="button" className={`mg-row grp${group?.hub_id === h.hub_id ? ' on' : ''}`} onClick={() => openGroup(h.hub_id)}>
    <span className="mg-av hub">{h.hub_name.slice(0, 1)}</span>
    <span className="mg-tx"><b>{h.hub_name} গ্রুপ</b><small>{h.open_issues > 0 ? `${h.open_issues}টি খোলা ইস্যু` : 'হাবের সবার সাথে কথা'}</small></span>
    <span className="mg-end">{h.unseen > 0 && <i className="mg-n">{h.unseen}</i>}</span></button>)
  const zoneRows = shownZones.map(z => <button key={z.zone_id} type="button" className={`mg-row zgrp${zone?.zone_id === z.zone_id ? ' on' : ''}`} onClick={() => openZone(z.zone_id)}>
    <span className="mg-av zone">{z.zone_name.slice(0, 1)}</span>
    <span className="mg-tx"><b>{z.zone_name} — জোন গ্রুপ</b><small>{`${z.hubs}টি হাবের সবাই`}</small></span>
    <span className="mg-end">{z.unseen > 0 && <i className="mg-n">{z.unseen}</i>}</span></button>)
  const showGroups = filter === 'all' || filter === 'group', showZones = filter === 'all' || filter === 'zone'
  const chat = zone ? <GroupChat key={'z' + zone.zone_id} room={zoneRoom(zone)} ui={ui} onBack={closeChat} onOpenIssue={openIssue} onSeen={() => void zones.reload()} />
    : group ? <GroupChat key={group.hub_id} room={hubRoom(group)} ui={ui} onBack={closeChat} onOpenIssue={openIssue} onNew={() => setCreating(group.hub_id)} onSeen={() => void groups.reload()} />
    : open ? <IssueChat key={open} id={open} row={everything.find(r => r.id === open)} refresh={ui.refresh} onBack={closeChat} onChanged={changed} /> : null

  return <AppShell title="ইস্যু ও ফলো-আপ" subtitle="কাজ দিন, সমাধান চেক করে অনুমোদন দিন — অনুমোদন না হলে ইস্যু তালিকাতেই থাকে">
    {panels.error ? <p className="da-error">{errText(panels.error)}</p> : null}
    {ui.view === 'chat' ? <div className={`mg${chat ? ' has-open' : ''}${ui.dense ? ' dense' : ''}`}>
      <aside className="mg-side">
        {bar}{chipRow}
        <div className="mg-list">
          {deskRow}
          {ui.groupsOnTop && showZones && zoneRows}
          {ui.groupsOnTop && showGroups && groupRows}
          {rows.map(r => <Conv key={r.id} r={r} on={open === r.id} onOpen={() => openIssue(r.id)} />)}
          {!ui.groupsOnTop && showGroups && groupRows}
          {!ui.groupsOnTop && showZones && zoneRows}
          {!rows.length && !(shownHubs.length && showGroups) && !(shownZones.length && showZones) && <div className="is-empty"><Icon name="check" size={28} /><p>{q ? 'কিছু মেলেনি' : panels.loading && !panels.data ? 'লোড হচ্ছে…' : EMPTY[filter]}</p></div>}
        </div>
      </aside>
      <section className="mg-main">{chat ?? <div className="mg-none"><Icon name="note" size={38} /><b>একটি ইস্যু বা গ্রুপ বেছে নিন</b>
        <p>বাম পাশের তালিকা থেকে যেটায় চাপবেন সেটির পুরো কথা এখানে খুলবে।</p>
        {hubs.length > 0 && <button type="button" onClick={() => setCreating(hubs[0].hub_id)}><Icon name="plus" size={15} /> নতুন ইস্যু</button>}</div>}</section>
    </div> : <div className={`bd${ui.dense ? ' dense' : ''}`}>
      {bar}{chipRow}{deskRow}
      {(shownHubs.length > 0 || shownZones.length > 0) && <div className="bd-groups">{shownZones.map(z => <button key={z.zone_id} type="button" className="mg-chip" onClick={() => openZone(z.zone_id)}>🗺 {z.zone_name} জোন গ্রুপ{z.unseen > 0 && <b>{z.unseen}</b>}</button>)}{shownHubs.map(h => <button key={h.hub_id} type="button" className="mg-chip" onClick={() => openGroup(h.hub_id)}>💬 {h.hub_name} গ্রুপ{h.unseen > 0 && <b>{h.unseen}</b>}</button>)}</div>}
      <Board rows={rows} empty={q ? 'কিছু মেলেনি' : EMPTY[filter === 'group' || filter === 'zone' ? 'all' : filter]} open={open} onOpen={openIssue} onChanged={changed} />
      {chat && <><div className="mg-shade" onClick={closeChat} /><aside className="mg-drawer">{chat}</aside></>}
    </div>}
    {settings && <UiSettings ui={ui} onChange={setUi} onClose={() => setSettings(false)} />}
    {desk && <Modal wide title="স্টোর / আইটি অর্ডার কে পাবেন" onClose={() => setDesk(false)} actions={<button type="button" onClick={() => setDesk(false)}>বন্ধ</button>}>
      <OrderDesk canOrder={hubs.length > 0} onOrder={k => { setDesk(false); setOrdering(k) }} /></Modal>}
    {creating && <NewIssue hubs={hubs} hub={creating} residential={residential} onClose={() => { setCreating(null); setResidential(false) }} onDone={id => { setCreating(null); setResidential(false); refresh(); toast('ইস্যু তৈরি হয়েছে'); openIssue(id) }} />}
    {ordering && <NewOrder hubs={hubs} kind={ordering} onClose={() => setOrdering(null)} onDone={id => { setOrdering(null); refresh(); toast('অর্ডার দেওয়া হয়েছে'); put(n => { n.set('tab', 'orders'); n.delete('g'); n.set('id', id) }) }} />}
    {node}
  </AppShell>
}

// ------------------------------------------------------------------ the list (one line per issue, like a chat list)
function Conv({ r, on, onOpen }: { r: IssueRow; on: boolean; onOpen: () => void }) {
  return <button type="button" className={`mg-row s-${r.status}${on ? ' on' : ''}${myTurn(r) ? ' turn' : ''}`} onClick={onOpen}>
    <span className="mg-av">{KIND_ICON[r.kind]}</span>
    <span className="mg-tx"><b>{r.title}</b>
      <small>{r.overdue && <em className="late">সময় পার · </em>}{r.priority === 'high' || r.priority === 'urgent' ? <em className="late">{PRIORITY_BN[r.priority]} · </em> : null}{statusText(r.kind, r.status)} · {r.assignee ?? 'কাউকে দেওয়া হয়নি'}</small>
      <small className="more">{r.issue_no} · {r.hub}{r.parcel_ref ? ` · ${r.parcel_ref}` : ''}</small></span>
    <span className="mg-end"><time>{short(r.created_at)}</time>{myTurn(r) && <i className="mg-dot" title="আপনার পালা" />}</span>
  </button>
}

// ------------------------------------------------------------------ the board (new -> working -> waiting for the check)
function Board({ rows, empty, open, onOpen, onChanged }: { rows: IssueRow[]; empty: string; open: string | null; onOpen: (id: string) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  async function quick(r: IssueRow, a: 'start' | 'approve') {
    setBusy(r.id); setErr('')
    try { await issues.act(r.id, a); onChanged() } catch (e) { setErr(errText(e)) } finally { setBusy('') }
  }
  const cols: Array<['open' | 'in_progress' | 'solved', string]> = [['open', 'নতুন'], ['in_progress', 'কাজ চলছে'], ['solved', 'সমাধান হয়েছে — চেক বাকি']]
  if (!rows.length) return <div className="is-empty"><Icon name="check" size={28} /><p>{empty}</p></div>
  return <>{err && <p className="da-error" role="alert">{err}</p>}<div className="bd-cols">{cols.map(([s, label]) => { const list = rows.filter(r => r.status === s); return <section key={s} className={`bd-col s-${s}`}>
    <h3>{label}<b>{list.length}</b></h3>
    {list.map(r => <div key={r.id} className={`bd-card${r.overdue ? ' late' : ''}${open === r.id ? ' on' : ''}${myTurn(r) ? ' turn' : ''}`}>
      <button type="button" className="bd-open" onClick={() => onOpen(r.id)}>
        <span className="t"><i>{KIND_ICON[r.kind]}</i>{r.title}</span>
        <small>{r.issue_no} · {r.hub}{r.parcel_ref ? ` · ${r.parcel_ref}` : ''}</small>
        <small>কাকে: {r.assignee ? `${r.assignee}${r.assignee_code ? ` (${r.assignee_code})` : ''}` : 'কাউকে দেওয়া হয়নি'}{r.assigned_by_nodi ? ' · নদী AI বেছেছে' : ''} · দিয়েছে: {r.assigned_by_name ?? '—'}</small>
        <span className="tags">{r.priority !== 'normal' && <Badge tone={r.priority === 'low' ? 'neutral' : 'bad'}>{PRIORITY_BN[r.priority]}</Badge>}{r.overdue && <Badge tone="bad">সময় পার</Badge>}
          {r.reopen_count > 0 && <Badge tone="warn">ফেরত {r.reopen_count}</Badge>}<time>{short(r.created_at)}</time></span></button>
      {r.is_mine && r.status === 'open' && <button type="button" className="sm" disabled={busy === r.id} onClick={() => void quick(r, 'start')}>{isOrder(r.kind) ? '▶ প্রস্তুত করছি' : '▶ শুরু করলাম'}</button>}
      {r.is_mine && r.status === 'in_progress' && <button type="button" className="sm" onClick={() => onOpen(r.id)}>{isOrder(r.kind) ? '✔ পাঠিয়েছি' : '✔ সমাধান জানান'}</button>}
      {(r.can_review ?? r.is_giver) && r.status === 'solved' && <button type="button" className="sm" disabled={busy === r.id} onClick={() => void quick(r, 'approve')}>{isOrder(r.kind) ? '✔ পেয়েছি' : '✔ অনুমোদন'}</button>}
    </div>)}
    {!list.length && <p className="bd-none">কিছু নেই</p>}
  </section> })}</div></>
}

// ------------------------------------------------------------------ one issue, as a conversation
function IssueChat({ id, row, refresh, onBack, onChanged }: { id: string; row?: IssueRow; refresh: number; onBack: () => void; onChanged: () => void }) {
  const d = useLoad(() => issues.detail(id), [id])
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [assign, setAssign] = useState(false)
  const [person, setPerson] = useState<RefPerson | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const x: IssueDetail | null = d.data
  const i = x?.issue
  const mine = !!row?.is_mine
  const giver = !!row?.is_giver
  const order = !!i && isOrder(i.kind)
  const reviewer = i?.can_review ?? row?.can_review ?? giver
  const n = x?.events.length ?? 0
  useEvery(refresh, () => { if (!busy) void d.reload() })
  useEffect(() => { body.current?.scrollTo({ top: body.current.scrollHeight }) }, [n])
  async function act(a: 'start' | 'solve' | 'approve' | 'reopen' | 'cancel') {
    setErr(''); if ((a === 'reopen' || a === 'cancel') && !note.trim()) { setErr('নিচের বাক্সে কারণ লিখুন'); return }
    if (a === 'solve' && !note.trim() && !file && !order) { setErr('কী করা হয়েছে লিখুন বা ছবি দিন'); return }
    setBusy(true)
    try {
      const photo = file && i ? await issues.uploadPhoto(i.hub_id, file) : null
      // "Sent" on an order needs no typing: a plain note is filled in.
      await issues.act(id, a, a === 'solve' && order && !note.trim() && !file ? 'পাঠানো হয়েছে' : note, photo); setNote(''); setFile(null); await d.reload(); onChanged()
    } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  async function doAssign() {
    if (person?.kind !== 'employee') { setErr('সিস্টেমের কাউকে বাছুন'); return }
    setBusy(true); setErr('')
    try { await issues.assign(id, person.id, note); setAssign(false); setPerson(null); setNote(''); await d.reload(); onChanged() } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  const live = !!i && (i.status === 'open' || i.status === 'in_progress' || i.status === 'solved')
  // Whose side of the conversation a step sits on: the one who does the job, or the one who gave it.
  const side = (a: string) => {
    if (a === 'assigned' || a === 'assigned_by_nodi') return 'sys'
    const doer = a === 'started' || a === 'solved'
    return (mine && !giver ? doer : !doer) ? 'me' : 'them'
  }
  const lastSolved = x ? [...x.events].reverse().find(e => e.action === 'solved')?.id : undefined
  return <div className="mg-chat">
    <header className="mg-head">
      <button type="button" className="mg-ic back" aria-label="ফিরে যান" onClick={onBack}><Icon name="back" size={18} /></button>
      <span className="mg-av">{i ? KIND_ICON[i.kind] : '…'}</span>
      <div className="mg-tx"><b>{i ? i.title : 'ইস্যু'}</b>
        {i && <small>{i.issue_no} · {KIND_BN[i.kind]} · {i.hub} · কাকে: {i.assignee ?? 'কাউকে দেওয়া হয়নি'}{i.assignee_code ? ` (${i.assignee_code})` : ''}</small>}</div>
      {i && <Badge tone={TONE[i.status]}>{order ? ORDER_STATUS_BN[i.status] : i.status_bn}</Badge>}
    </header>
    <div className="mg-body" ref={body}>
      {d.loading && !x ? <p className="muted">লোড হচ্ছে…</p> : null}
      {d.error ? <p className="da-error">{errText(d.error)}</p> : null}
      {!d.loading && !d.error && !x && <p className="muted">ইস্যুটি পাওয়া যায়নি, অথবা দেখার অনুমতি নেই।</p>}
      {x && i && x.events.map(e => { const s = side(e.action); const label = (order ? ORDER_ACTION_BN[e.action] : undefined) ?? ACTION_BN[e.action] ?? e.action
        if (s === 'sys') return <p key={e.id} className="mg-sys">{label}{e.note ? ` — ${e.note}` : ''} · {e.by_name} · {when(e.at)}</p>
        const first = e.action === 'created'
        return <div key={e.id} className={`mg-msg ${s} a-${e.action}`}>
          <div className="mg-b"><strong>{label}</strong>
            {first ? <>{<span className="tx">{i.body || i.title}</span>}{i.parcel_ref && <span className="ref">পার্সেল আইডি: <b>{i.parcel_ref}</b>{x.parcel ? ` · ${String(x.parcel.customer_name ?? '')} · ${String(x.parcel.status ?? '')}` : ''}</span>}{i.photo_path && <Photo path={i.photo_path} />}</>
              : <>{e.note && <span className="tx">{e.note}</span>}{e.id === lastSolved && i.solve_photo && <Photo path={i.solve_photo} />}</>}</div>
          <small>{e.by_name} · {when(e.at)}</small></div> })}
      {i && !live && <p className="mg-sys">{i.status === 'cancelled' ? 'এই ইস্যু বাতিল করা হয়েছে' : order ? 'অর্ডার শেষ — পাওয়া গেছে' : 'চেক শেষ — ইস্যু বন্ধ'}</p>}
    </div>
    {live && (mine || giver || (reviewer && i.status === 'solved')) && <footer className="mg-foot">
      {assign && <div className="mg-assign"><PersonPicker value={person} onChange={setPerson} /><button type="button" className="sm" disabled={busy} onClick={() => void doAssign()}>এই ব্যক্তিকে দিন</button></div>}
      {err && <p className="da-error" role="alert">{err}</p>}
      <div className="mg-in">
        <label className={`mg-ic clip${file ? ' has' : ''}`} title="ছবি দিন"><input type="file" accept="image/*" className="is-file" onChange={e => { setFile(e.target.files?.[0] ?? null); e.target.value = '' }} /><Icon name="upload" size={18} /></label>
        <textarea rows={1} value={note} onChange={e => setNote(e.target.value)} aria-label="মন্তব্য"
          placeholder={order ? (mine && !giver ? 'কীভাবে পাঠালেন (ঐচ্ছিক)' : 'মন্তব্য — পাইনি বা বাতিলে কারণ লাগবে') : mine && !giver ? 'কী করেছেন লিখুন (সমাধানে লাগবে)' : 'মন্তব্য — ফেরত বা বাতিলে কারণ লাগবে'} /></div>
      {file && <p className="mg-file">📎 {file.name} <button type="button" className="link small" onClick={() => setFile(null)}>সরান</button></p>}
      <div className="mg-acts">
        {mine && i.status === 'open' && <button type="button" className="secondary" disabled={busy} onClick={() => void act('start')}>{order ? '▶ প্রস্তুত করছি' : '▶ কাজ শুরু করলাম'}</button>}
        {mine && (i.status === 'open' || i.status === 'in_progress') && <button type="button" disabled={busy} onClick={() => void act('solve')}>{order ? '✔ পাঠিয়েছি' : '✔ সমাধান হয়েছে'}</button>}
        {reviewer && i.status === 'solved' && <button type="button" disabled={busy} onClick={() => void act('approve')}>{order ? '✔ পেয়েছি' : '✔ ঠিক আছে — অনুমোদন'}</button>}
        {reviewer && i.status === 'solved' && <button type="button" className="secondary" disabled={busy} onClick={() => void act('reopen')}>{order ? '↩ পাইনি / ভুল এসেছে' : '↩ ঠিক হয়নি — ফেরত'}</button>}
        {giver && <button type="button" className="secondary" onClick={() => setAssign(a => !a)}>অন্যকে দিন</button>}
        {giver && <button type="button" className="secondary" disabled={busy} onClick={() => void act('cancel')}>বাতিল</button>}
      </div>
    </footer>}
  </div>
}

function Photo({ path }: { path: string }) {
  const u = useLoad(() => issues.photoUrl(path), [path])
  return u.data ? <a href={u.data} target="_blank" rel="noreferrer"><img src={u.data} alt="ছবি" style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 8, margin: '6px 0', display: 'block' }} /></a> : null
}

// ------------------------------------------------------------------ a group (a hub's or a zone's), as a chat
/** What the chat needs from a group; the hub group and the zone group differ only in these. */
type Room = {
  name: string; sub: string; av: 'hub' | 'zone'
  feed: () => Promise<Post[]>; post: (body: string, photo: string | null) => Promise<unknown>; upload: (f: File) => Promise<string>
  react: (post: string, e: string) => Promise<unknown>; markSeen: (ids: string[]) => Promise<unknown>
  seenBy: (post: string) => Promise<Who[]>; reactedBy: (post: string) => Promise<Who[]>
}
const hubRoom = (h: GroupHub): Room => ({
  name: `${h.hub_name} গ্রুপ`, sub: h.open_issues > 0 ? `${h.open_issues}টি খোলা ইস্যু` : 'হাবের সবার সাথে কথা', av: 'hub',
  feed: () => issues.feed(h.hub_id), post: (b, p) => issues.post(h.hub_id, b, p), upload: f => issues.uploadPhoto(h.hub_id, f),
  react: issues.react, markSeen: issues.markSeen, seenBy: issues.seenBy, reactedBy: issues.reactedBy,
})
const zoneRoom = (z: ZoneGroup): Room => ({
  name: `${z.zone_name} — জোন গ্রুপ`, sub: `জোনের ${z.hubs}টি হাবের সবার সাথে কথা`, av: 'zone',
  feed: () => issues.zoneFeed(z.zone_id), post: (b, p) => issues.zonePost(z.zone_id, b, p), upload: f => issues.uploadZonePhoto(z.zone_id, f),
  react: issues.zoneReact, markSeen: issues.zoneMarkSeen, seenBy: issues.zoneSeenBy, reactedBy: issues.zoneReactedBy,
})
function GroupChat({ room, ui, onBack, onOpenIssue, onNew, onSeen }: { room: Room; ui: Ui; onBack: () => void; onOpenIssue: (id: string) => void; onNew?: () => void; onSeen: () => void }) {
  const feed = useLoad(() => room.feed(), [])
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [pick, setPick] = useState('')
  const [who, setWho] = useState<{ title: string; rows: Who[] } | null>(null)
  const seenSent = useRef(new Set<string>())
  const body = useRef<HTMLDivElement>(null)
  const posts = [...(feed.data ?? [])].reverse()   // newest at the bottom, like a chat
  const lastId = posts[posts.length - 1]?.id
  useEvery(ui.refresh, () => { if (!busy) void feed.reload() })
  useEffect(() => { body.current?.scrollTo({ top: body.current.scrollHeight }) }, [lastId])
  // Opening the group marks the posts on screen as seen.
  useEffect(() => {
    const ids = (feed.data ?? []).filter(p => !p.seen_by_me && !seenSent.current.has(p.id)).map(p => p.id)
    if (!ids.length) return
    ids.forEach(i => seenSent.current.add(i)); void room.markSeen(ids).then(onSeen).catch(() => ids.forEach(i => seenSent.current.delete(i)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.data])
  async function send() {
    if (busy || (!text.trim() && !file)) return
    setErr(''); setBusy(true)
    try { const photo = file ? await room.upload(file) : null; await room.post(text, photo); setText(''); setFile(null); await feed.reload() } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  function key(e: KeyboardEvent<HTMLTextAreaElement>) { if (ui.enterSends && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }
  async function react(p: Post, e: string) { setPick(''); try { await room.react(p.id, e); await feed.reload() } catch (x) { setErr(errText(x)) } }
  async function showSeen(p: Post) { try { setWho({ title: 'যারা দেখেছে', rows: await room.seenBy(p.id) }) } catch (x) { setErr(errText(x)) } }
  async function showReacts(p: Post) { try { setWho({ title: 'কে কী রিঅ্যাক্ট দিয়েছে', rows: await room.reactedBy(p.id) }) } catch (x) { setErr(errText(x)) } }
  return <div className="mg-chat">
    <header className="mg-head">
      <button type="button" className="mg-ic back" aria-label="ফিরে যান" onClick={onBack}><Icon name="back" size={18} /></button>
      <span className={`mg-av ${room.av}`}>{room.name.slice(0, 1)}</span>
      <div className="mg-tx"><b>{room.name}</b><small>{room.sub}</small></div>
      {onNew && <button type="button" className="sm" onClick={onNew}><Icon name="plus" size={14} /> এই হাবে ইস্যু</button>}
    </header>
    <div className="mg-body" ref={body}>
      {feed.loading && !feed.data ? <p className="muted">লোড হচ্ছে…</p> : null}
      {feed.error ? <p className="da-error">{errText(feed.error)}</p> : null}
      {feed.data && !feed.data.length && <p className="mg-sys">গ্রুপে এখনো কিছু নেই — প্রথম বার্তাটি লিখুন</p>}
      {posts.map(p => <div key={p.id} className={`mg-msg ${p.mine ? 'me' : 'them'}${p.is_nodi ? ' nodi' : ''}`}>
        {!p.mine && <span className="mg-av sm">{p.is_nodi ? '🤖' : (p.author_name || '?').slice(0, 1)}</span>}
        <div className="mg-col">
          {!p.mine && <small className="by">{p.is_nodi ? 'নদী AI' : p.author_name}</small>}
          <div className="mg-b">{p.body && <span className="tx">{p.body}</span>}
            {p.photo_path && <Photo path={p.photo_path} />}
            {p.issue && <button type="button" className="mg-link" onClick={() => onOpenIssue(p.issue!.id)}>
              <strong>{p.issue.issue_no}</strong> · {p.issue.title}<br /><Badge tone={TONE[p.issue.status]}>{STATUS_BN[p.issue.status]}</Badge> <span>{p.issue.assignee ?? 'কাউকে দেওয়া হয়নি'}</span></button>}</div>
          <div className="mg-rx">
            {EMOJIS.filter(e => p.reactions[e]).map(e => <button key={e} type="button" className={p.reactions[e].mine ? 'on' : ''} onClick={() => void react(p, e)}>{e} {p.reactions[e].n}</button>)}
            <button type="button" aria-label="রিঅ্যাক্ট দিন" aria-expanded={pick === p.id} onClick={() => setPick(v => v === p.id ? '' : p.id)}>🙂+</button>
            {Object.keys(p.reactions).length > 0 && <button type="button" onClick={() => void showReacts(p)}>কে?</button>}
            <button type="button" onClick={() => void showSeen(p)}><Icon name="eye" size={12} /> {p.seen_count}</button>
            <time>{short(p.created_at)}</time></div>
          {pick === p.id && <div className="mg-pick">{EMOJIS.map(e => <button key={e} type="button" onClick={() => void react(p, e)}>{e}</button>)}</div>}
        </div></div>)}
    </div>
    <footer className="mg-foot">
      {err && <p className="da-error" role="alert">{err}</p>}
      {file && <p className="mg-file">📎 {file.name} <button type="button" className="link small" onClick={() => setFile(null)}>সরান</button></p>}
      <div className="mg-in">
        <label className={`mg-ic clip${file ? ' has' : ''}`} title="ছবি দিন"><input type="file" accept="image/*" className="is-file" onChange={e => { setFile(e.target.files?.[0] ?? null); e.target.value = '' }} /><Icon name="upload" size={18} /></label>
        <textarea rows={1} placeholder="গ্রুপে লিখুন…" aria-label="গ্রুপে লিখুন" value={text} onChange={e => setText(e.target.value)} onKeyDown={key} />
        <button type="button" className="mg-send" disabled={busy || (!text.trim() && !file)} onClick={() => void send()}>পাঠান</button></div>
    </footer>
    {who && <Modal title={who.title} onClose={() => setWho(null)} actions={<button type="button" onClick={() => setWho(null)}>বন্ধ</button>}>
      {who.rows.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{who.rows.map((w, k) => <li key={k}>{w.emoji ? `${w.emoji} ` : ''}{w.full_name}{w.employee_code ? ` (${w.employee_code})` : ''} <span className="muted">· {when(w.seen_at ?? w.at ?? '')}</span></li>)}</ul> : <p className="muted">কেউ নেই</p>}
    </Modal>}
  </div>
}

// ------------------------------------------------------------------ "my settings" for this page
function Seg<T extends string | number | boolean>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<[T, ReactNode]> }) {
  return <div className="da-seg">{options.map(([v, l]) => <button key={String(v)} type="button" className={value === v ? '' : 'secondary'} aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}</div>
}
function UiSettings({ ui, onChange, onClose }: { ui: Ui; onChange: (p: Partial<Ui>) => void; onClose: () => void }) {
  return <Modal title="আমার সেটিং — ইস্যু ও ফলো-আপ" onClose={onClose} actions={<><button type="button" onClick={onClose}>ঠিক আছে</button>
    <button type="button" className="secondary" onClick={() => onChange(UI0)}>আগের মতো করুন</button></>}>
    <div className="mg-set">
      <div><b>চেহারা</b><small>চ্যাট: মেসেঞ্জারের মতো তালিকা ও কথা। বোর্ড: কাজ কোন ধাপে আছে তা কলামে।</small>
        <Seg value={ui.view} onChange={v => onChange({ view: v })} options={[['chat', '💬 চ্যাট'], ['board', '🗂 বোর্ড']]} /></div>
      <div><b>পাতা খুললে প্রথমে যা দেখাবে</b>
        <select value={ui.first} onChange={e => onChange({ first: e.target.value as Filter })}>
          <option value="all">সব</option><option value="mine">আমার কাজ</option><option value="check">চেক বাকি</option><option value="given">আমি দিয়েছি</option>
          <option value="group">হাব গ্রুপ</option><option value="zone">জোন গ্রুপ</option><option value="hub">হাবের সব ইস্যু</option><option value="orders">স্টোর / আইটি অর্ডার</option></select></div>
      <div><b>তালিকার আকার</b><Seg value={ui.dense} onChange={v => onChange({ dense: v })} options={[[false, 'বড় (আরামদায়ক)'], [true, 'ছোট (বেশি দেখা যায়)']]} /></div>
      <div><b>হাব গ্রুপ তালিকার কোথায়</b><Seg value={ui.groupsOnTop} onChange={v => onChange({ groupsOnTop: v })} options={[[true, 'উপরে'], [false, 'নিচে']]} /></div>
      <div><b>নিজে থেকে নতুন তথ্য আনা</b><small>পাতা খোলা থাকলে কত সময় পরপর নতুন ইস্যু ও বার্তা আসবে।</small>
        <Seg value={ui.refresh} onChange={v => onChange({ refresh: v })} options={[[30, '৩০ সেকেন্ড'], [60, '১ মিনিট'], [120, '২ মিনিট'], [0, 'বন্ধ']]} /></div>
      <div><b>গ্রুপে Enter চাপলে</b><Seg value={ui.enterSends} onChange={v => onChange({ enterSends: v })} options={[[true, 'বার্তা চলে যাবে'], [false, 'নতুন লাইন হবে']]} /></div>
      <p className="muted small" style={{ margin: 0 }}>এই সেটিং শুধু আপনার এই ফোন / কম্পিউটারে থাকে — অন্য কারো পাতা বদলায় না।</p>
    </div>
  </Modal>
}

// ------------------------------------------------------------------ new issue
/** Fast path: give the label screenshot (choose, drop, paste or camera), the parcel ID is read from it, pick who gets it. */
function NewIssue({ hubs, hub: h0, residential, onClose, onDone }: { hubs: GroupHub[]; hub: string; residential: boolean; onClose: () => void; onDone: (id: string) => void }) {
  const [hub, setHub] = useState(h0)
  const [room, setRoom] = useState('')
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
    if (residential) return
    if (!img) { setScan({ state: 'idle', ids: [], pct: 0 }); return }
    setScan({ state: 'reading', ids: [], pct: 0 })
    void readLabel(img, pct => { if (latest.current === img) setScan(v => v.state === 'reading' ? { ...v, pct } : v) }).then(ids => {
      if (latest.current !== img) return
      setScan({ state: ids.length ? 'done' : 'failed', ids, pct: 1 })
      // Only fills an empty box: an ID the person typed is never replaced.
      if (ids.length) setF(v => v.parcel.trim() ? v : { ...v, parcel: ids[0] })
    }).catch(() => { if (latest.current === img) setScan({ state: 'failed', ids: [], pct: 0 }) })
  }, [residential])
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
    if (residential && (!room.trim() || !f.title.trim() || !f.body.trim())) { setErr('ফ্ল্যাট ও রুম, সমস্যার নাম এবং বিস্তারিত লিখুন'); return }
    if (!f.title.trim() && !f.parcel.trim() && !file) { setErr('লেবেলের ছবি দিন, পার্সেল আইডি দিন বা কী সমস্যা লিখুন'); return }
    setBusy(true)
    try {
      const photo = file ? await issues.uploadPhoto(hub, file) : null
      onDone(await issues.create({ hub, title: residential ? 'আবাসিক: ' + f.title.trim() : f.title, body: residential ? room.trim() + '\n' + f.body.trim() : f.body, kind: residential ? 'other' : f.kind, parcel_ref: residential ? '' : f.parcel, photo, assignee: person?.kind === 'employee' ? person.id : null,
        due: f.due ? new Date(f.due).toISOString() : null, priority: f.priority }))
    } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  return <Modal wide title={residential ? "আবাসিক ইস্যু জানান" : "নতুন ইস্যু / কাজ দিন"} onClose={onClose} actions={<><button type="button" disabled={busy} onClick={() => void save()}>{busy ? 'হচ্ছে…' : person ? 'ইস্যু তৈরি করে কাজ দিন' : 'ইস্যু তৈরি করুন'}</button><button type="button" className="secondary" onClick={onClose}>বাতিল</button></>}>
    <label className={`is-drop${preview ? ' has' : ''}`} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); take(e.dataTransfer.files?.[0] ?? null) }}>
      <input type="file" accept="image/*" className="is-file" onChange={e => { take(e.target.files?.[0] ?? null); e.target.value = '' }} />
      {preview ? <img src={preview} alt="লেবেলের ছবি" /> : <><Icon name="scan" size={30} /><b>{residential ? "সমস্যার ছবি দিন (ঐচ্ছিক)" : "পার্সেল লেবেলের স্ক্রিনশট / ছবি দিন"}</b>
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
      {!residential && <Field label="পার্সেল আইডি" hint="ছবি দিলে নিজে পড়ে বসানোর চেষ্টা করে; ভুল হলে ঠিক করে দিন"><input value={f.parcel} onChange={e => setF({ ...f, parcel: e.target.value })} />
        {same.length > 0 && <DupNote>এই পার্সেলে আগে থেকেই ইস্যু খোলা আছে: {same.map(x => `${x.issue_no} (${STATUS_BN[x.status as keyof typeof STATUS_BN] ?? x.status})`).join(', ')} — আবার দিলে দুটো হবে।</DupNote>}</Field>}
      <Field label="হাব"><select value={hub} onChange={e => setHub(e.target.value)}>{hubs.map(h => <option key={h.hub_id} value={h.hub_id}>{h.hub_name}</option>)}</select></Field>
      {residential && <Field label="ফ্ল্যাট ও রুম" required wide><input value={room} onChange={e => setRoom(e.target.value)} /></Field>}
      <Field label="কী সমস্যা" wide hint={residential ? undefined : "না লিখলে পার্সেল আইডি দিয়েই ইস্যুর নাম হবে"}><input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder={residential ? "যেমন: রুমের ফ্যান চলছে না" : "যেমন: কাস্টমার ফোন ধরছে না"} /></Field>
      {residential ? <Field label="বিস্তারিত" required wide><textarea value={f.body} onChange={e => setF({ ...f, body: e.target.value })} /></Field> : <Field label="কাকে দেবেন" wide hint="এখন না বাছলে পরে দেওয়া যাবে"><PersonPicker value={person} onChange={setPerson} /></Field>}
    </div>
    {!residential && <button type="button" className="link" aria-expanded={more} onClick={() => setMore(m => !m)}>{more ? '▾ কম দেখান' : '▸ আরও তথ্য (ধরন, গুরুত্ব, শেষ সময়, বিস্তারিত)'}</button>}
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
