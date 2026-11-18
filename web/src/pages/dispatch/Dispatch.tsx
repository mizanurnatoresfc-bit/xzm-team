import { useState } from 'react'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { dispatch, DISPATCH_STATUS, type DispatchCtx, type DispatchItemIn, type DispatchRow } from '../../lib/dispatch'
import { hrFriendly } from '../../lib/hr'
import { usePrefs } from '../../lib/prefs'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'

const msg = (e: unknown) => { const m = e instanceof Error ? e.message : (e as { message?: string })?.message ?? ''; return /[ঀ-৿]/.test(m) ? m : hrFriendly(e) }

/**
 * রুট থেকে পাঠাচ্ছি / আসছে — one page, two tabs. "পাঠাচ্ছি": the person on a route says what is going to another hub or the
 * sorting centre (parcel count, bags, office items, sorting-list items). "আসছে": what is coming to a hub or centre the person
 * may receive for; they confirm it or object with the count they found. Everything goes through the dispatch_* functions.
 */
export function Dispatch() {
  const { L } = usePrefs()
  const [tab, setTab] = useState<'send' | 'in'>('send')
  const { toast, node } = useToast()
  return <AppShell title={L('রুট থেকে পাঠাচ্ছি', 'Sending from my route')} subtitle={L('পার্সেল ও জিনিস — গন্তব্য হাব বা শটিং কেন্দ্র দেখে বুঝে নেবে', 'Parcels and items — the receiving hub or centre sees them and confirms')}>
    {node}
    <div className="seg dp-seg" role="tablist" aria-label={L('পাঠাচ্ছি / আসছে', 'Sending / incoming')}>
      <button type="button" role="tab" aria-selected={tab === 'send'} className={tab === 'send' ? 'on' : ''} onClick={() => setTab('send')}><Icon name="truck" size={16} />{L('পাঠাচ্ছি', 'Sending')}</button>
      <button type="button" role="tab" aria-selected={tab === 'in'} className={tab === 'in' ? 'on' : ''} onClick={() => setTab('in')}><Icon name="box" size={16} />{L('আসছে', 'Incoming')}</button>
    </div>
    {tab === 'send' ? <SendTab say={toast} /> : <IncomingTab say={toast} />}
  </AppShell>
}

function SendTab({ say }: { say: (m: string) => void }) {
  const { L, n } = usePrefs()
  const ctx = useLoad<DispatchCtx | null>(() => dispatch.context().catch(() => null), [])
  const mine = useLoad(() => dispatch.list('mine', 30).catch(() => [] as DispatchRow[]), [])
  const c = ctx.data
  const [route, setRoute] = useState(''); const [kind, setKind] = useState<'hub' | 'sorting'>('hub'); const [to, setTo] = useState('')
  const [parcels, setParcels] = useState(''); const [bags, setBags] = useState(''); const [note, setNote] = useState('')
  const [items, setItems] = useState<DispatchItemIn[]>([]); const [pickAsset, setPickAsset] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const routeId = route || (c?.routes.length === 1 ? c.routes[0].id : '')
  const dests = kind === 'hub' ? c?.hubs ?? [] : c?.centers ?? []
  const setQty = (name: string, qty: number) => setItems(x => qty <= 0 ? x.filter(i => i.name !== name) : x.map(i => i.name === name ? { ...i, qty } : i))
  const addSort = (name: string) => setItems(x => x.some(i => i.name === name) ? x : [...x, { kind: 'sorting_item', name, qty: 1 }])
  async function send() {
    setErr('')
    const p = Number(parcels || 0)
    if (!to) return setErr(kind === 'hub' ? L('কোন হাবে পাঠাচ্ছেন — বাছুন', 'Pick the hub') : L('কোন শটিং কেন্দ্রে — বাছুন', 'Pick the sorting centre'))
    if (!p && items.length === 0) return setErr(L('পার্সেলের সংখ্যা বা অন্তত একটি জিনিস দিন', 'Give a parcel count or at least one item'))
    setBusy(true)
    try {
      await dispatch.send({ route: routeId || null, toKind: kind, to, parcels: p, bags: bags ? Number(bags) : null, items, note: note.trim() })
      setParcels(''); setBags(''); setNote(''); setItems([]); say(L('পাঠানো জানানো হয়েছে — গন্তব্য বুঝে নিলে এখানে দেখাবে', 'Sent — you will see it here once it is received'))
      await mine.reload()
    } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }
  if (ctx.loading && !c) return <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>
  if (!c) return <p className="notice">{L('আপনার লগইনের সাথে কোনো হাবের কর্মী প্রোফাইল যুক্ত নেই, তাই পাঠানো যাবে না।', 'Your login has no staff profile at a hub, so you cannot send.')}</p>
  return <div className="dp">
    <section className="panel">
      <div className="da-bar"><h2 style={{ margin: 0 }}>{L('কী পাঠাচ্ছেন?', 'What are you sending?')}</h2><span className="muted small">{c.employee.hub}</span></div>
      <div className="dp-grid">
        <Field label={L('রুট', 'Route')}><select value={routeId} onChange={e => setRoute(e.target.value)}>
          <option value="">{c.routes.length ? L('রুট বাছুন…', 'Pick a route…') : L('রুট নেই', 'No route')}</option>{c.routes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <Field label={L('কোথায়', 'To')}><div className="seg" role="group"><button type="button" aria-pressed={kind === 'hub'} className={kind === 'hub' ? 'on' : ''} onClick={() => { setKind('hub'); setTo('') }}>{L('অন্য হাব', 'Another hub')}</button>
          <button type="button" aria-pressed={kind === 'sorting'} className={kind === 'sorting' ? 'on' : ''} onClick={() => { setKind('sorting'); setTo('') }}>{L('শটিং কেন্দ্র', 'Sorting centre')}</button></div></Field>
        <Field label={kind === 'hub' ? L('গন্তব্য হাব', 'Destination hub') : L('গন্তব্য শটিং কেন্দ্র', 'Destination centre')}><select value={to} onChange={e => setTo(e.target.value)}>
          <option value="">—</option>{dests.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        <Field label={L('পার্সেল (সংখ্যা)', 'Parcels (count)')}><input inputMode="numeric" value={parcels} onChange={e => setParcels(e.target.value.replace(/[^\d]/g, ''))} placeholder="20" /></Field>
        <Field label={L('ব্যাগ (সংখ্যা)', 'Bags (count)')}><input inputMode="numeric" value={bags} onChange={e => setBags(e.target.value.replace(/[^\d]/g, ''))} /></Field>
      </div>
      <h3 className="dp-h">{L('জিনিস', 'Items')}</h3>
      {kind === 'sorting' && <div className="dp-chips" aria-label={L('শটিং-তালিকার জিনিস', 'Sorting-list items')}>{c.sorting_items.map(s => <button key={s} type="button" className={`chip-toggle${items.some(i => i.name === s) ? ' on' : ''}`} aria-pressed={items.some(i => i.name === s)} onClick={() => items.some(i => i.name === s) ? setQty(s, 0) : addSort(s)}>{s}</button>)}</div>}
      <div className="dp-add"><select value={pickAsset} onChange={e => setPickAsset(e.target.value)} aria-label={L('অফিসের জিনিস', 'Office item')}>
        <option value="">{c.assets.length ? L('অফিসের জিনিস বাছুন…', 'Pick an office item…') : L('অফিসে জিনিস লেখা নেই', 'No office items listed')}</option>
        {c.assets.filter(a => !items.some(i => i.asset_id === a.id)).map(a => <option key={a.id} value={a.id}>{a.name}{a.quantity > 1 ? ` (${n(a.quantity)}টি আছে)` : ''}</option>)}</select>
        <button type="button" className="secondary" disabled={!pickAsset} onClick={() => { const a = c.assets.find(x => x.id === pickAsset); if (a) setItems(x => [...x, { kind: 'asset', name: a.name, qty: 1, asset_id: a.id }]); setPickAsset('') }}><Icon name="plus" size={16} />{L('যোগ', 'Add')}</button></div>
      {items.length > 0 && <div className="dp-items">{items.map(i => <div key={i.name + (i.asset_id ?? '')} className="dp-item"><span className="t"><b>{i.name}</b><small>{i.kind === 'asset' ? L('অফিসের জিনিস', 'Office item') : L('শটিং তালিকা', 'Sorting list')}</small></span>
        <span className="q"><button type="button" aria-label="−" onClick={() => setQty(i.name, i.qty - 1)}>−</button><b>{n(i.qty)}</b><button type="button" aria-label="+" onClick={() => setQty(i.name, i.qty + 1)}>+</button></span></div>)}</div>}
      <Field label={L('নোট (ইচ্ছা হলে)', 'Note (optional)')} wide><input value={note} onChange={e => setNote(e.target.value)} /></Field>
      {err && <p className="da-error" role="alert">{err}</p>}
      <button type="button" className="gbtn dp-go" disabled={busy} onClick={() => void send()}><Icon name="check" size={18} />{busy ? L('পাঠানো হচ্ছে…', 'Sending…') : L('পাঠাচ্ছি — জানিয়ে দিন', 'Send — tell them')}</button>
    </section>
    <h2 className="sd-h">{L('আমার পাঠানো', 'What I sent')}</h2>
    <RowList rows={mine.data ?? []} empty={L('গত ৩০ দিনে কিছু পাঠাননি।', 'Nothing sent in 30 days.')} />
  </div>
}

function IncomingTab({ say }: { say: (m: string) => void }) {
  const { L } = usePrefs()
  const inc = useLoad(() => dispatch.list('incoming', 30).catch(() => [] as DispatchRow[]), [])
  const [open, setOpen] = useState<DispatchRow | null>(null)
  return <div className="dp">
    <RowList rows={inc.data ?? []} empty={L('এখন কিছু আসছে না — আপনি যে হাব বা কেন্দ্রের জন্য বুঝে নিতে পারেন, সেখানে কেউ পাঠালে এখানে আসবে।', 'Nothing is coming — what is sent to a hub or centre you receive for shows here.')} receive={setOpen} />
    {open && <ReceiveModal row={open} onClose={() => setOpen(null)} onDone={m => { setOpen(null); say(m); void inc.reload() }} />}
  </div>
}

function RowList({ rows, empty, receive }: { rows: DispatchRow[]; empty: string; receive?: (r: DispatchRow) => void }) {
  const { L, n, lang } = usePrefs()
  if (!rows.length) return <p className="muted small" style={{ margin: '0 4px' }}>{empty}</p>
  const dm = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { day: 'numeric', month: 'short' })
  return <div className="dp-list">{rows.map(r => { const s = DISPATCH_STATUS[r.status]
    return <article key={r.id} className="dp-card">
      <div className="hd"><b>{r.route ? `${r.route} → ` : ''}{r.to ?? '—'}</b><Badge tone={s[2]}>{L(s[0], s[1])}</Badge></div>
      <div className="sub">#{n(r.no)} · {dm(r.date)} · {r.from_hub} → {r.to}{r.sender ? ` · ${r.sender}` : ''}</div>
      <div className="nums">{r.parcels > 0 && <span className="chip info">{L(`${n(r.parcels)}টি পার্সেল`, `${r.parcels} parcels`)}</span>}{r.bags ? <span className="chip info">{L(`${n(r.bags)}টি ব্যাগ`, `${r.bags} bags`)}</span> : null}
        {r.items.map(i => <span key={i.name} className="chip ok">{i.name} × {n(i.qty)}</span>)}</div>
      {r.note && <p className="small">{r.note}</p>}
      {r.status !== 'sent' && <p className={`small ${r.status === 'disputed' ? 'dp-bad' : 'muted'}`}>{r.received_by}{r.received_parcels !== null ? ` · ${L(`পেয়েছেন ${n(r.received_parcels)}টি`, `found ${r.received_parcels}`)}` : ''}{r.receive_note ? ` — ${r.receive_note}` : ''}</p>}
      {receive && r.can_receive && <button type="button" className="gbtn dp-rc" onClick={() => receive(r)}><Icon name="check" size={17} />{L('বুঝে নিলাম / আপত্তি', 'Receive / object')}</button>}
    </article> })}</div>
}

function ReceiveModal({ row, onClose, onDone }: { row: DispatchRow; onClose: () => void; onDone: (m: string) => void }) {
  const { L, n } = usePrefs()
  const [count, setCount] = useState(String(row.parcels)); const [note, setNote] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function go(ok: boolean) {
    setErr(''); setBusy(true)
    try { await dispatch.receive(row.id, ok, count === '' ? null : Number(count), note.trim()); onDone(ok ? L('বুঝে নেওয়া হয়েছে', 'Received') : L('আপত্তি জানানো হয়েছে', 'Objection sent')) }
    catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }
  return <Modal title={`#${n(row.no)} · ${row.from_hub} → ${row.to}`} onClose={onClose}
    actions={<><button className="secondary" disabled={busy} onClick={() => void go(false)}>{L('আপত্তি আছে', 'Object')}</button><button disabled={busy} onClick={() => void go(true)}>{L('ঠিক আছে — বুঝে নিলাম', 'All good — received')}</button></>}>
    <p className="muted small">{L(`পাঠিয়েছে ${n(row.parcels)}টি পার্সেল${row.items.length ? ' ও ' + row.items.map(i => `${i.name} × ${n(i.qty)}`).join(', ') : ''}`, `Sent ${row.parcels} parcels${row.items.length ? ' and ' + row.items.map(i => `${i.name} × ${i.qty}`).join(', ') : ''}`)}</p>
    <Field label={L('আপনি কয়টি পার্সেল পেয়েছেন', 'Parcels you found')}><input inputMode="numeric" value={count} onChange={e => setCount(e.target.value.replace(/[^\d]/g, ''))} /></Field>
    <Field label={L('নোট (সংখ্যা না মিললে বা আপত্তি হলে লিখুন)', 'Note (if the count differs or you object)')}><input value={note} onChange={e => setNote(e.target.value)} /></Field>
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}
