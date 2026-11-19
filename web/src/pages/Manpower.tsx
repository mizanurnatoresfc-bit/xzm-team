import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { AppShell } from '../components/AppShell'
import { DataTable } from '../components/DataTable'
import { Icon } from '../components/Icon'
import { Badge, Field, Modal, Stat, useLoad, useToast } from './accounts/ui'
import { hrFriendly } from '../lib/hr'
import { hrReq } from '../lib/hrreq'
import { MP_STATUS, manpower, type Manpower as Mp, type MpStatus } from '../lib/manpower'
import { useOrg } from './hr/common'

const bn = (x: number | null | undefined) => x == null ? '—' : x.toLocaleString('bn-BD')

/** "লোক লাগবে": every staff member can ask for people for their hub; zonal/HR approve; the hub or zone is told. */
export function Manpower() {
  const { can } = useAuth()
  const o = useOrg()
  const { toast, node } = useToast()
  const [sp, setSp] = useSearchParams()
  const me = useLoad(() => hrReq.myEmployee().catch(() => null), [])
  const list = useLoad(() => manpower.list(), [])
  const [st, setSt] = useState<'open' | 'all' | MpStatus>('open')
  // the bottom menu's + → লোক চাই opens straight on the form
  const [form, setForm] = useState(false)
  useEffect(() => { if (sp.get('new') === '1') setForm(true) }, [sp])
  const [dec, setDec] = useState<Mp | null>(null)
  const [close, setClose] = useState<Mp | null>(null)
  const openId = sp.get('id')
  const rows = useMemo(() => (list.data ?? []).filter(r => st === 'all' ? true : st === 'open' ? ['submitted', 'approved'].includes(r.status) : r.status === st), [list.data, st])
  const all = list.data ?? []
  const pos = (id: string | null) => id ? o.names.pos[id] ?? '' : 'যেকোনো পদ'
  const approver = can('hr.request.approve')
  useEffect(() => {
    if (!openId || !list.data) return
    const r = list.data.find(x => x.id === openId)
    if (r && r.status === 'submitted' && approver) setDec(r)
  }, [openId, list.data, approver])
  const reload = async (m: string) => { toast(m); setSp(new URLSearchParams(), { replace: true }); await list.reload() }

  return <AppShell title="লোক লাগবে" subtitle="হাবে লোকের দরকার হলে এখানে জানান — পিকআপ, ডেলিভারি, বড় পার্সেল আর সমস্যা লিখে। অনুমোদন হলে হাব বা জোনের সবাই নোটিফিকেশন পাবেন, পরিচিত কেউ থাকলে রেফার করবেন।"
    actions={<button className="hide-phone-plus" onClick={() => setForm(true)}><Icon name="plus" size={16} />লোক চাই</button>}>
    {node}
    <div className="da-stats">
      <Stat icon="clock" tone={all.some(r => r.status === 'submitted') ? 'warn' : undefined} label="অনুমোদনের অপেক্ষায়" value={bn(all.filter(r => r.status === 'submitted').length)} />
      <Stat icon="search" label="লোক খোঁজা চলছে" value={bn(all.filter(r => r.status === 'approved').length)}
        sub={`মোট ${bn(all.filter(r => r.status === 'approved').reduce((a, r) => a + Math.max(r.needed - r.filled, 0), 0))} জন দরকার`} />
      <Stat icon="check" tone="ok" label="লোক পাওয়া গেছে" value={bn(all.filter(r => r.status === 'filled').length)} />
    </div>
    <section className="da-filters panel no-print">
      <div className="da-seg">{([['open', 'চলমান'], ['submitted', 'অপেক্ষায়'], ['approved', 'অনুমোদিত'], ['filled', 'পূরণ হয়েছে'], ['all', 'সব']] as const).map(([k, l]) =>
        <button key={k} className={st === k ? '' : 'secondary'} onClick={() => setSt(k)}>{l}</button>)}</div>
    </section>
    <section className="panel">
      {list.error ? <p className="da-error">{hrFriendly(list.error)}</p> : null}
      <DataTable<Mp> title="লোক লাগবে" file="manpower-requests" rows={rows} rowKey={r => r.id}
        empty={<p className="muted">{list.loading ? 'লোড হচ্ছে…' : 'এখন কোনো চাহিদা নেই।'}</p>}
        cols={[
          { key: 'no', label: 'নম্বর', value: r => r.request_no },
          { key: 'date', label: 'তারিখ', value: r => r.created_at.slice(0, 10) },
          { key: 'hub', label: 'হাব', value: r => o.names.hub[r.hub_id] ?? '', render: r => <><b>{o.names.hub[r.hub_id] ?? ''}</b>{r.scope === 'zone' && <span className="sec">পুরো জোনে জানানো</span>}</> },
          { key: 'pos', label: 'পদ', value: r => pos(r.position_id) },
          { key: 'need', label: 'কতজন', value: r => r.needed, render: r => <b>{bn(r.needed)}{r.filled ? <span className="muted small"> (পাওয়া {bn(r.filled)})</span> : null}</b> },
          { key: 'why', label: 'কেন', value: r => r.reason, render: r => <div className="small pre-wrap" style={{ maxWidth: 320 }}>{r.reason}{r.other_issues && <div className="muted">সমস্যা: {r.other_issues}</div>}</div> },
          { key: 'pick', label: 'দৈনিক পিকআপ', value: r => r.daily_pickup ?? '' },
          { key: 'del', label: 'দৈনিক ডেলিভারি', value: r => r.daily_delivery ?? '' },
          { key: 'big', label: 'বড় পার্সেল', value: r => r.big_parcels ?? '' },
          { key: 'st', label: 'অবস্থা', value: r => MP_STATUS[r.status][0], render: r => <><Badge tone={MP_STATUS[r.status][1]}>{MP_STATUS[r.status][0]}</Badge>
            {r.decision_note && <div className="muted small">{r.decision_note}</div>}
            {r.status === 'approved' && r.notified_count > 0 && <div className="muted small">{bn(r.notified_count)} জনকে জানানো হয়েছে</div>}</> },
          { key: 'act', label: '', noExport: true, render: r => <span className="row-acts">
            {r.status === 'submitted' && approver && <button className="sm" onClick={() => setDec(r)}>সিদ্ধান্ত দিন</button>}
            {r.status === 'approved' && <Link className="btn-ghost" to="/app/hr/requests?tab=new">লোক আছে → রেফার</Link>}
            {r.status === 'approved' && approver && <button className="secondary sm" onClick={() => setClose(r)}>বন্ধ করুন</button>}
            {r.status === 'submitted' && me.data && r.submitter_employee_id === me.data.id &&
              <button className="secondary sm" onClick={() => void manpower.close(r.id, 'cancelled', null, '').then(() => reload('তুলে নেওয়া হয়েছে'), e => toast(hrFriendly(e)))}>তুলে নিন</button>}
          </span> },
        ]} />
    </section>
    {form && <RequestForm myHub={me.data?.hub_id ?? null} myPost={me.data?.position_id ?? null} onClose={() => { setForm(false); if (sp.get('new')) setSp(new URLSearchParams(), { replace: true }) }} onDone={async () => { setForm(false); await reload('চাহিদা জমা হয়েছে — অনুমোদনকারীকে জানানো হয়েছে') }} />}
    {dec && <DecideForm r={dec} onClose={() => { setDec(null); setSp(new URLSearchParams(), { replace: true }) }} onDone={async n => { setDec(null); await reload(n >= 0 ? `সেভ হয়েছে — ${bn(n)} জনকে নোটিফিকেশন গেছে` : 'বাতিল করা হয়েছে') }} />}
    {close && <CloseForm r={close} onClose={() => setClose(null)} onDone={async () => { setClose(null); await reload('বন্ধ করা হয়েছে') }} />}
  </AppShell>
}

function RequestForm({ myHub, myPost, onClose, onDone }: { myHub: string | null; myPost: string | null; onClose: () => void; onDone: () => Promise<void> }) {
  const { can } = useAuth()
  const o = useOrg()
  const [f, setF] = useState({ hub: myHub ?? '', position: '', needed: '1', reason: '', pickup: '', delivery: '', big: '', issues: '' })
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const anyHub = can('hr.request.create')
  const hubs = (o.data?.hubs ?? []).filter(h => anyHub || h.id === myHub)
  const num = (s: string) => s.trim() === '' ? null : Math.max(0, Math.round(Number(s.replace(/[^\d]/g, '')) || 0))
  async function save() {
    if (!f.hub) return setErr('হাব বেছে নিন')
    if (!num(f.needed)) return setErr('কতজন লাগবে লিখুন')
    if (f.reason.trim().length < 3) return setErr('কেন লাগবে লিখুন')
    setBusy(true); setErr('')
    try { await manpower.submit({ hub: f.hub, position: f.position || null, needed: num(f.needed)!, reason: f.reason.trim(), pickup: num(f.pickup), delivery: num(f.delivery), big: num(f.big), issues: f.issues.trim() }); await onDone() }
    catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title="লোক চাই" onClose={onClose} actions={<><button className="secondary" onClick={onClose}>বাতিল</button><button disabled={busy} onClick={() => void save()}>জমা দিন</button></>}>
    <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Field label="হাব"><select value={f.hub} onChange={e => setF({ ...f, hub: e.target.value })} disabled={!anyHub && !!myHub}>
        <option value="">বেছে নিন…</option>{hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
      <Field label="কোন পদে"><select value={f.position} onChange={e => setF({ ...f, position: e.target.value })}>
        <option value="">যেকোনো পদ</option>{o.data?.positions.filter(p => !p.archived_at).map(p => <option key={p.id} value={p.id}>{p.name_bn || p.name}{p.id === myPost ? ' (আমার পদ)' : ''}</option>)}</select></Field>
      <Field label="কতজন লাগবে"><input inputMode="numeric" value={f.needed} onChange={e => setF({ ...f, needed: e.target.value })} /></Field>
      <Field label="দৈনিক পিকআপ (গড়)"><input inputMode="numeric" value={f.pickup} onChange={e => setF({ ...f, pickup: e.target.value })} placeholder="যেমন ৪০০" /></Field>
      <Field label="দৈনিক ডেলিভারি (গড়)"><input inputMode="numeric" value={f.delivery} onChange={e => setF({ ...f, delivery: e.target.value })} placeholder="যেমন ৫২০" /></Field>
      <Field label="বড় পার্সেল (দৈনিক)"><input inputMode="numeric" value={f.big} onChange={e => setF({ ...f, big: e.target.value })} /></Field>
      <Field wide label="কেন লোক লাগবে (ব্যাখ্যা)"><textarea rows={3} value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} placeholder="যেমন: ২ জন রাইডার চলে গেছে, ডেলিভারি জমে যাচ্ছে" /></Field>
      <Field wide label="অন্যান্য সমস্যা"><textarea rows={2} value={f.issues} onChange={e => setF({ ...f, issues: e.target.value })} placeholder="যেমন: দূরের এরিয়া, বৃষ্টি, বাইক কম" /></Field>
    </div>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

function DecideForm({ r, onClose, onDone }: { r: Mp; onClose: () => void; onDone: (notified: number) => Promise<void> }) {
  const o = useOrg()
  const [status, setStatus] = useState<'approved' | 'rejected'>('approved')
  const [scope, setScope] = useState<'hub' | 'zone'>('hub')
  const [posts, setPosts] = useState<string[]>([])
  const [needed, setNeeded] = useState(String(r.needed))
  const [note, setNote] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true); setErr('')
    try { const n = await manpower.decide(r.id, status, note.trim(), scope, posts, Number(needed) || null); await onDone(status === 'approved' ? n : -1) }
    catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  const toggle = (id: string) => setPosts(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  return <Modal title={`লোক লাগবে ${r.request_no}`} onClose={onClose} actions={<><button className="secondary" onClick={onClose}>বাতিল</button><button disabled={busy} onClick={() => void go()}>সেভ</button></>}>
    <p><b>{o.names.hub[r.hub_id]}</b> · {r.position_id ? o.names.pos[r.position_id] : 'যেকোনো পদ'} · {bn(r.needed)} জন</p>
    <p className="small pre-wrap">{r.reason}</p>
    <p className="muted small">দৈনিক পিকআপ {bn(r.daily_pickup)} · ডেলিভারি {bn(r.daily_delivery)} · বড় পার্সেল {bn(r.big_parcels)}{r.other_issues ? ` · সমস্যা: ${r.other_issues}` : ''}</p>
    <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Field label="সিদ্ধান্ত"><select value={status} onChange={e => setStatus(e.target.value as 'approved' | 'rejected')}><option value="approved">অনুমোদন</option><option value="rejected">বাতিল</option></select></Field>
      {status === 'approved' && <>
        <Field label="কতজন (ঠিক করুন)"><input inputMode="numeric" value={needed} onChange={e => setNeeded(e.target.value)} /></Field>
        <Field label="কাদের জানাবেন"><select value={scope} onChange={e => setScope(e.target.value as 'hub' | 'zone')}><option value="hub">শুধু এই হাবের সবাই</option><option value="zone">পুরো জোনের সবাই</option></select></Field>
        <Field wide label="শুধু এই পদগুলোর লোকদের (কিছু না বাছলে সবাই)">
          <div className="focus-pick">{o.data?.positions.filter(p => !p.archived_at).map(p =>
            <button key={p.id} type="button" className={`focus-pill fc-${posts.includes(p.id) ? 'blue on' : 'gray'}`} onClick={() => toggle(p.id)}>{p.name_bn || p.name}</button>)}</div></Field>
      </>}
      <Field wide label={status === 'approved' ? 'নোট (ঐচ্ছিক)' : 'বাতিলের কারণ'}><input value={note} onChange={e => setNote(e.target.value)} /></Field>
    </div>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

function CloseForm({ r, onClose, onDone }: { r: Mp; onClose: () => void; onDone: () => Promise<void> }) {
  const [status, setStatus] = useState<'filled' | 'closed'>('filled')
  const [filled, setFilled] = useState(String(r.needed))
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  async function go() {
    try { await manpower.close(r.id, status, Number(filled) || 0, note.trim()); await onDone() } catch (e) { setErr(hrFriendly(e)) }
  }
  return <Modal title={`বন্ধ করুন — ${r.request_no}`} onClose={onClose} actions={<><button className="secondary" onClick={onClose}>বাতিল</button><button onClick={() => void go()}>সেভ</button></>}>
    <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Field label="ফলাফল"><select value={status} onChange={e => setStatus(e.target.value as 'filled' | 'closed')}><option value="filled">লোক পাওয়া গেছে</option><option value="closed">আর দরকার নেই</option></select></Field>
      <Field label="কতজন পাওয়া গেছে"><input inputMode="numeric" value={filled} onChange={e => setFilled(e.target.value)} /></Field>
      <Field wide label="নোট"><input value={note} onChange={e => setNote(e.target.value)} /></Field>
    </div>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}
