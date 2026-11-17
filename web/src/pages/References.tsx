// রেফারেন্স তালিকা — যে কেউ লোক যোগ, বদল বা সরানোর অনুরোধ দেয়; HR অনুমোদন দিলে তালিকায় দেখায়, তার আগে "অপেক্ষায়"।
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { AppShell } from '../components/AppShell'
import { Contact } from '../components/Contact'
import { Icon } from '../components/Icon'
import { Combo } from '../components/inputs'
import { Badge, Field, Modal, useLoad, useToast } from './accounts/ui'
import { useOrg } from './hr/common'
import { referrals, type RefRequest } from '../lib/extra'
import { ACTION_BN, refFriendly, refs, type HubPerson, type RefRow } from '../lib/refs'

type Tab = 'list' | 'mine' | 'approve' | 'staff'
type Form = { id?: string; mode: 'hub' | 'manual'; zone: string; hub: string; person: HubPerson | null; name: string; position: string; phone: string; hubName: string; note: string }
const when = (t: string | null) => t ? new Date(t).toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''

export function References() {
  const { can, session } = useAuth()
  const o = useOrg()
  const { toast, node } = useToast()
  const [sp, setSp] = useSearchParams()
  const approver = can('hr.reference.approve')
  const tab = (sp.get('tab') as Tab) || 'list'
  const setTab = (t: Tab) => setSp(t === 'list' ? {} : { tab: t }, { replace: true })
  const data = useLoad(() => refs.list(), [])
  const me = session?.user.id
  // "যিনি এনেছেন" asked from profiles — HR decides here; askers see their own.
  const staffReq = useLoad(() => referrals.referenceRequests().catch(() => [] as RefRequest[]), [])
  const sr = staffReq.data ?? []
  const srWait = sr.filter(r => r.can_decide)
  const rows = data.data ?? []
  const listed = rows.filter(r => r.status === 'active' && (r.approval === 'approved' || r.pending_action !== 'add'))
  const mine = rows.filter(r => r.requested_by === me && (r.pending_action || r.approval === 'rejected' || r.decided_at))
    .sort((a, b) => (b.requested_at ?? '').localeCompare(a.requested_at ?? ''))
  const waiting = rows.filter(r => r.pending_action).sort((a, b) => (a.requested_at ?? '').localeCompare(b.requested_at ?? ''))
  const [q, setQ] = useState(''); const [zoneF, setZoneF] = useState('')
  const shown = listed.filter(r => (!zoneF || r.zone_id === zoneF) && (!q.trim() || `${r.name} ${r.position ?? ''} ${r.phone ?? ''} ${r.hub_name ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())))
  const [f, setF] = useState<Form | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const [pick, setPick] = useState<string[]>([])
  const hubPeople = useLoad(() => f?.mode === 'hub' && f.hub ? refs.hubPeople(f.hub) : Promise.resolve([] as HubPerson[]), [f?.mode, f?.hub])
  const hubs = useMemo(() => (o.data?.hubs ?? []).filter(h => !f?.zone || h.zone_id === f.zone), [o.data, f?.zone])

  const blank = (): Form => ({ mode: 'hub', zone: '', hub: '', person: null, name: '', position: '', phone: '', hubName: '', note: '' })
  const editOf = (r: RefRow): Form => ({ id: r.id, mode: 'manual', zone: r.zone_id ?? '', hub: r.hub_id ?? '', person: null, name: r.name, position: r.position ?? '', phone: r.phone ?? '', hubName: r.hub_name ?? '', note: '' })
  async function save() {
    if (!f) return
    setErr('')
    if (f.mode === 'hub' && !f.person) return setErr('হাব বেছে কাউকে বাছুন, অথবা "নিজে লিখুন"')
    if (f.mode === 'manual' && f.name.trim().length < 2) return setErr('নাম লিখুন')
    setBusy(true)
    try {
      const input = f.mode === 'hub' && f.person ? { employee: f.person.id, hub: f.hub || null, zone: f.zone || null, note: f.note }
        : { name: f.name, position: f.position, phone: f.phone, hub: f.hub || null, hubName: f.hubName || (o.names.hub[f.hub] ?? ''), zone: f.zone || null, note: f.note }
      if (f.id) await refs.edit(f.id, input); else await refs.add(input)
      setF(null); await data.reload()
      toast(approver ? 'অনুরোধ জমা হয়েছে — অনুমোদন ট্যাবে আছে' : 'অনুরোধ জমা হয়েছে — এইচআর অনুমোদন দিলে তালিকায় দেখাবে')
    } catch (e) { setErr(refFriendly(e)) } finally { setBusy(false) }
  }
  async function remove(r: RefRow) {
    const why = (window.prompt(`"${r.name}" কেন সরাতে চান?`) ?? '').trim(); if (!why) return
    try { await refs.remove(r.id, why); await data.reload(); toast('সরানোর অনুরোধ জমা হয়েছে') } catch (e) { toast(refFriendly(e)) }
  }
  async function decideStaff(ids: string[], ok: boolean) {
    let note: string | null = null
    if (!ok) { note = (window.prompt('কেন হবে না? (যিনি চেয়েছেন তিনি দেখবেন)') ?? '').trim(); if (!note) return }
    try { const n = await referrals.decideReference(ids, ok, note ?? undefined); await staffReq.reload(); toast(`${n.toLocaleString('bn-BD')}টা ${ok ? 'অনুমোদিত — প্রোফাইলে বসেছে' : 'বাতিল'}`) } catch (e) { toast(refFriendly(e)) }
  }
  async function decide(ids: string[], ok: boolean) {
    let note: string | null = null
    if (!ok) { note = (window.prompt('কেন হবে না? (যিনি চেয়েছেন তিনি দেখবেন)') ?? '').trim(); if (!note) return }
    try { const n = await refs.decide(ids, ok, note); setPick([]); await data.reload(); toast(`${n.toLocaleString('bn-BD')}টা ${ok ? 'অনুমোদিত' : 'বাতিল'}`) } catch (e) { toast(refFriendly(e)) }
  }

  const Person = ({ r, children }: { r: RefRow; children?: React.ReactNode }) => <article className="rf-card">
    <span className="rf-av">{r.name.slice(0, 1)}</span>
    <div className="rf-t"><b>{r.name}</b><span className="muted small">{[r.position, r.hub_name].filter(Boolean).join(' · ') || '—'}</span>
      {r.phone && <Contact phone={r.phone} />}
      {r.pending_action && <span className="rf-wait"><Icon name="clock" size={12} /> {ACTION_BN[r.pending_action]} — HR অনুমোদনের অপেক্ষায়
        {r.pending_action === 'edit' && r.pending_data && <> · নতুন: {[r.pending_data.name, r.pending_data.position, r.pending_data.phone, r.pending_data.hub_name].filter(Boolean).join(' · ')}</>}
        {r.pending_note && <> · {r.pending_note}</>}</span>}
    </div>
    {children}
  </article>

  return <AppShell title="রেফারেন্স তালিকা" subtitle="যে কেউ নাম যোগ করতে পারেন — HR অনুমোদন দিলে সবাই দেখবেন">{node}
    <div className="rq-tabs">
      <button type="button" className={`rq-tab${tab === 'list' ? ' on' : ''}`} onClick={() => setTab('list')}><Icon name="users" size={16} />তালিকা <b className="rf-n">{listed.length}</b></button>
      <button type="button" className={`rq-tab${tab === 'mine' ? ' on' : ''}`} onClick={() => setTab('mine')}><Icon name="clock" size={16} />আমার অনুরোধ{mine.some(r => r.pending_action) && <b className="rf-n warn">{mine.filter(r => r.pending_action).length}</b>}</button>
      {(srWait.length > 0 || sr.length > 0 || approver) && <button type="button" className={`rq-tab${tab === 'staff' ? ' on' : ''}`} onClick={() => setTab('staff')}><Icon name="usercheck" size={16} />যিনি এনেছেন{srWait.length > 0 && <b className="rf-n warn">{srWait.length}</b>}</button>}
      {approver && <button type="button" className={`rq-tab${tab === 'approve' ? ' on' : ''}`} onClick={() => setTab('approve')}><Icon name="check" size={16} />অনুমোদন{waiting.length > 0 && <b className="rf-n warn">{waiting.length}</b>}</button>}
    </div>
    {data.error ? <p className="da-error">{refFriendly(data.error)}</p> : null}

    {tab === 'list' && <section className="panel">
      <div className="rf-bar"><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="নাম, পদবি, নম্বর বা হাব দিয়ে খুঁজুন…" />
        <select value={zoneF} onChange={e => setZoneF(e.target.value)} aria-label="জোন"><option value="">সব জোন</option>{o.data?.zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select>
        <button onClick={() => { setErr(''); setF(blank()) }}><Icon name="plus" size={16} />নাম যোগ করুন</button></div>
      {!data.data ? <p className="muted">লোড হচ্ছে…</p> : !shown.length ? <p className="muted">কেউ নেই। "নাম যোগ করুন" দিয়ে শুরু করুন।</p> :
        <div className="rf-list">{shown.map(r => <Person key={r.id} r={r}>{!r.pending_action && <span className="row-acts">
          <button className="secondary sm" aria-label="বদলান" onClick={() => { setErr(''); setF(editOf(r)) }}><Icon name="edit" size={14} /></button>
          <button className="secondary sm" aria-label="সরান" onClick={() => void remove(r)}><Icon name="trash" size={14} /></button></span>}</Person>)}</div>}
    </section>}

    {tab === 'mine' && <section className="panel">
      {!mine.length ? <p className="muted">আপনার কোনো অনুরোধ নেই।</p> : <div className="rf-list">{mine.map(r => <Person key={r.id} r={r}>
        <div className="rf-st">{r.pending_action ? <Badge tone="warn">অপেক্ষায়</Badge> : r.approval === 'rejected' ? <Badge tone="bad">হবে না</Badge> : <Badge tone="ok">অনুমোদিত</Badge>}
          <span className="muted small">{when(r.requested_at)}</span>
          {r.decision_note && <span className="small">{r.decided_by_name}: {r.decision_note}</span>}
          {r.pending_action === 'add' && <span className="row-acts"><button className="secondary sm" onClick={() => { setErr(''); setF(editOf(r)) }}><Icon name="edit" size={14} />বদলান</button>
            <button className="secondary sm" onClick={() => void remove(r)}>তুলে নিন</button></span>}</div></Person>)}</div>}
    </section>}

    {tab === 'approve' && approver && <section className="panel">
      {!waiting.length ? <p className="muted">অপেক্ষায় কিছু নেই।</p> : <>
        <div className="rf-bar"><label className="small rf-all"><input type="checkbox" checked={pick.length === waiting.length} onChange={e => setPick(e.target.checked ? waiting.map(r => r.id) : [])} /> সব বাছুন</label>
          <span className="spacer" />
          <button className="secondary sm" disabled={!pick.length} onClick={() => void decide(pick, false)}>হবে না</button>
          <button className="sm" disabled={!pick.length} onClick={() => void decide(pick, true)}><Icon name="check" size={14} />অনুমোদন ({pick.length.toLocaleString('bn-BD')})</button></div>
        <div className="rf-list">{waiting.map(r => <Person key={r.id} r={r}>
          <div className="rf-st"><Badge tone={r.pending_action === 'remove' ? 'bad' : r.pending_action === 'edit' ? 'info' : 'warn'}>{ACTION_BN[r.pending_action ?? 'add']}</Badge>
            <span className="muted small">{r.requested_by_name} · {when(r.requested_at)}</span>
            <span className="row-acts"><input type="checkbox" aria-label="বাছুন" checked={pick.includes(r.id)} onChange={e => setPick(p => e.target.checked ? [...p, r.id] : p.filter(x => x !== r.id))} />
              <button className="secondary sm" onClick={() => void decide([r.id], false)}>হবে না</button>
              <button className="sm" onClick={() => void decide([r.id], true)}><Icon name="check" size={14} />অনুমোদন</button></span></div></Person>)}</div></>}
    </section>}

    {tab === 'staff' && <section className="panel">
      <p className="muted small">কর্মীরা নিজের প্রোফাইল থেকে, বা ম্যানেজার তাঁর কর্মীর প্রোফাইল থেকে "যিনি এনেছেন" দেন। অনুমোদন দিলে কর্মীর প্রোফাইলে বসে যায়।</p>
      {!sr.length ? <p className="muted">কিছু নেই।</p> : <div className="rf-list">{sr.map(r => <article key={r.id} className="rf-card">
        <span className="rf-av">{r.employee.name.slice(0, 1)}</span>
        <div className="rf-t"><b>{r.employee.name}{r.employee.code ? <span className="muted small"> #{r.employee.code}</span> : null}</b>
          {r.action === 'remove' && <span className="small bad">রেফারেন্স সরানোর অনুরোধ</span>}
          <span className="small">{r.action === 'remove' ? 'সরাবে' : 'যিনি এনেছেন'}: <b style={{ display: 'inline' }}>{r.person.name}</b> {[r.person.code && `#${r.person.code}`, r.person.position, r.person.hub].filter(Boolean).join(' · ')}{r.person.kind === 'manual' ? ' (নিজে লেখা)' : ''}</span>
          {r.person.mobile && <Contact phone={r.person.mobile} />}
          {r.note && <span className="muted small">নোট: {r.note}</span>}</div>
        <div className="rf-st">{r.status === 'pending' ? <Badge tone="warn">অপেক্ষায়</Badge> : r.status === 'approved' ? <Badge tone="ok">অনুমোদিত</Badge> : r.status === 'rejected' ? <Badge tone="bad">হবে না</Badge> : <Badge tone="neutral">বদলানো</Badge>}
          <span className="muted small">{r.by} · {when(r.at)}</span>
          {r.decision_note && <span className="small">{r.decided_by}: {r.decision_note}</span>}
          {r.can_decide && <span className="row-acts"><button className="secondary sm" onClick={() => void decideStaff([r.id], false)}>হবে না</button>
            <button className="sm" onClick={() => void decideStaff([r.id], true)}><Icon name="check" size={14} />অনুমোদন</button></span>}</div>
      </article>)}</div>}
    </section>}

    {f && <Modal wide title={f.id ? 'রেফারেন্স বদলের অনুরোধ' : 'রেফারেন্সে নাম যোগ'} onClose={() => setF(null)}
      actions={<><button className="secondary" onClick={() => setF(null)}>বাতিল</button><button disabled={busy} onClick={() => void save()}>{busy ? '…' : 'অনুরোধ পাঠান'}</button></>}>
      {!f.id && <div className="rp-seg" style={{ marginBottom: 12 }}>
        <button type="button" className={f.mode === 'hub' ? 'on' : ''} onClick={() => setF({ ...f, mode: 'hub' })}><Icon name="hub" size={14} />জোন → হাব → লোক</button>
        <button type="button" className={f.mode === 'manual' ? 'on' : ''} onClick={() => setF({ ...f, mode: 'manual' })}><Icon name="edit" size={14} />নিজে লিখুন</button></div>}
      <div className="hr-form rq-form">
        <Field label="জোন"><select value={f.zone} onChange={e => setF({ ...f, zone: e.target.value, hub: '', person: null })}><option value="">সব জোন</option>
          {o.data?.zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>
        <Field label="হাব"><Combo value={f.hub} onChange={v => setF({ ...f, hub: v, person: null, hubName: f.hubName || (o.names.hub[v] ?? '') })} options={hubs.map(h => ({ value: h.id, label: h.name }))} /></Field>
        {f.mode === 'hub' ? <Field label="লোক" wide hint={f.person ? [f.person.employee_code && `আইডি ${f.person.employee_code}`, f.person.post, f.person.mobile].filter(Boolean).join(' · ') : undefined}>
          <Combo value={f.person?.id ?? ''} disabled={!f.hub} onChange={v => setF({ ...f, person: hubPeople.data?.find(x => x.id === v) ?? null })}
            placeholder={!f.hub ? 'আগে হাব বাছুন' : hubPeople.loading ? 'লোড হচ্ছে…' : 'নাম, আইডি বা মোবাইল লিখে খুঁজুন…'}
            options={(hubPeople.data ?? []).map(p => ({ value: p.id, label: p.full_name, keywords: p.mobile ?? '', sub: [p.employee_code && `#${p.employee_code}`, p.post].filter(Boolean).join(' · ') }))} /></Field>
          : <>
            <Field label="নাম" required><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="পদবি"><input list="rf-posts" value={f.position} onChange={e => setF({ ...f, position: e.target.value })} placeholder="যেমন দোকান মালিক / হাব ম্যানেজার" /></Field>
            <Field label="নাম্বার"><input inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} placeholder="01XXXXXXXXX" /></Field>
            <Field label="হাবের নাম" hint="তালিকায় না থাকলে নিজে লিখুন"><input value={f.hubName} onChange={e => setF({ ...f, hubName: e.target.value })} /></Field>
            <datalist id="rf-posts">{o.data?.positions.map(p => <option key={p.id} value={p.name_bn || p.name} />)}</datalist></>}
        <Field label="নোট (ঐচ্ছিক)" wide><input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder="HR-কে কিছু বলার থাকলে" /></Field>
      </div>
      <p className="muted small"><Icon name="clock" size={12} /> এইচআর অনুমোদন দিলে তবেই তালিকায় সবাই দেখবেন; ততক্ষণ "আমার অনুরোধ"-এ অপেক্ষায় থাকবে।</p>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </AppShell>
}
