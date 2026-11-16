import { Fragment, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { refreshShellCounts } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { hrFriendly, org, type Position } from '../../lib/hr'
import { PROSPECT_STATUS, referrals, type PCol, type Prospect } from '../../lib/extra'
import { STATUS, hrReq, type EmpRow, type HrRequest, type ReqField, type ReqFormat } from '../../lib/hrreq'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'
import { ProspectForm } from './ProfileExtras'
import { useOrg } from './common'

/**
 * The staff member's own desk, in plain words instead of format names:
 * my profile, people I have in hand, people I brought, "I will not work any more", "my panel is closed".
 * The two requests are the self-service ID INACTIVE / ID ACTIVE formats underneath; nothing new is stored.
 */
type Do = '' | 'hand' | 'brought' | 'leave' | 'active' | `f:${string}`
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const errText = (e: unknown) => (e instanceof Error && !('code' in e) ? e.message : hrFriendly(e))
const isOpen = (r: HrRequest) => r.status === 'submitted' || r.status === 'processing'

/** Plain wording for the boxes staff fill in themselves (the format's own label is used for anything else). */
const WORDS: Record<string, Record<string, string>> = {
  id_inactive: { last_date: 'শেষ কোন দিন পর্যন্ত কাজ করবেন', reason: 'কেন চাকরি ছাড়ছেন, লিখুন' },
  id_active: { effective_date: 'কবে থেকে চালু চান', reason: 'কী হয়েছে, লিখুন' },
}

export function StaffDesk({ me, formats, onSent }: { me: EmpRow; formats: ReqFormat[]; onSent: (id: string) => void }) {
  const o = useOrg()
  const [sp, setSp] = useSearchParams()
  const act = (sp.get('do') ?? '') as Do
  const go = (d: Do) => { const n = new URLSearchParams(sp); if (d) n.set('do', d); else n.delete('do'); setSp(n) }
  const link = (d: Do) => { const n = new URLSearchParams(sp); n.set('tab', 'new'); n.set('do', d); return `?${n.toString()}` }
  const info = useLoad(async () => {
    const [mine, hand, brought] = await Promise.all([hrReq.list().catch(() => [] as HrRequest[]),
      referrals.prospects(me.id).catch(() => [] as Prospect[]), referrals.brought(me.id).catch(() => [])])
    return { mine: mine.filter(r => r.employee_id === me.id), hand: hand.length, brought: brought.length }
  }, [me.id])
  const self = formats.filter(f => f.self_service && f.needs_employee)
  const leave = self.find(f => f.kind === 'id_inactive') ?? null
  const active = self.find(f => f.kind === 'id_active') ?? null
  const others = self.filter(f => f !== leave && f !== active)
  const waiting = (f: ReqFormat | null) => (f && info.data?.mine.find(r => r.format_id === f.id && isOpen(r))) || null
  const posName = o.names.pos[me.position_id ?? ''] ?? '', hubName = o.names.hub[me.hub_id ?? ''] ?? ''
  const count = (n: number | undefined) => (n ? `${n.toLocaleString('bn-BD')} জন` : 'এখনো কেউ নেই')

  if (act === 'hand') return <InHand me={me} onBack={() => go('')} onChanged={() => void info.reload()} />
  if (act === 'brought') return <Brought me={me} onBack={() => go('')} />

  const askRow = (f: ReqFormat | null, d: Do, tone: string, icon: string, title: string, sub: string) => {
    const w = waiting(f)
    if (w) return <Link to={`?tab=list&id=${w.id}`} className="nv-row"><span className={`nv-av sd-i ${tone}`}><Icon name={icon} size={22} /></span>
      <span className="tx"><b>{title}</b><span>আবেদন পাঠানো আছে · {w.request_no}</span></span>
      <span className="end"><Badge tone={STATUS[w.status].tone}>{STATUS[w.status].bn}</Badge></span></Link>
    if (!f) return <div className="nv-row none"><span className="nv-av"><Icon name={icon} size={22} /></span>
      <span className="tx"><b>{title}</b><span>এই আবেদন এখন বন্ধ আছে — হাব ম্যানেজারকে জানান</span></span></div>
    return <Link to={link(d)} className="nv-row"><span className={`nv-av sd-i ${tone}`}><Icon name={icon} size={22} /></span>
      <span className="tx"><b>{title}</b><span>{sub}</span></span><Icon name="chev" size={18} /></Link>
  }
  const open = act === 'leave' ? leave : act === 'active' ? active : act.startsWith('f:') ? others.find(f => f.id === act.slice(2)) ?? null : null

  return <div className="sd">
    <Link to="/app/me" className="sd-hero">
      <span className="nv-av">{me.full_name.slice(0, 1).toUpperCase()}</span>
      <span className="tx"><b>{me.full_name}</b>
        <span>{[me.employee_code && `আইডি ${me.employee_code}`, hubName, posName].filter(Boolean).join(' · ')}</span>
        <span className="go">আমার প্রোফাইল দেখুন <Icon name="chev" size={15} /></span></span>
    </Link>

    <h2 className="sd-h">আমার লোক</h2>
    <div className="nv-rows">
      <Link to={link('hand')} className="nv-row"><span className="nv-av sd-i b"><Icon name="plus" size={22} /></span>
        <span className="tx"><b>আমার হাতে লোক আছে</b><span>কাজ করতে চায় এমন কারো নাম দিন · {count(info.data?.hand)}</span></span><Icon name="chev" size={18} /></Link>
      <Link to={link('brought')} className="nv-row"><span className="nv-av sd-i g"><Icon name="users" size={22} /></span>
        <span className="tx"><b>আমি যাদের নিয়ে এসেছি</b><span>আমার আনা লোকের তালিকা · {count(info.data?.brought)}</span></span><Icon name="chev" size={18} /></Link>
    </div>

    <h2 className="sd-h">অফিসকে জানান</h2>
    <div className="nv-rows">
      {askRow(leave, 'leave', 'r', 'out', 'আমি চাকরি করবো না', 'চাকরি ছাড়ার আবেদন পাঠান')}
      {askRow(active, 'active', 'o', 'key', 'আমার প্যানেল বন্ধ হয়ে গিয়েছে', 'প্যানেল / আইডি আবার চালু করার আবেদন পাঠান')}
      {others.map(f => <Fragment key={f.id}>{askRow(f, `f:${f.id}`, 'p', 'form', f.name_bn || f.name, f.description || 'আবেদন পাঠান')}</Fragment>)}
    </div>
    <p className="muted small sd-note">আবেদন পাঠালে অফিস দেখে সিদ্ধান্ত জানাবে। কী হলো তা উপরে "আমার আবেদন"-এ দেখা যাবে।</p>

    {open && <Ask me={me} fmt={open} hubName={hubName} posName={posName} deptName={o.names.dept[me.department_id ?? ''] ?? ''}
      title={open === leave ? 'আমি চাকরি করবো না' : open === active ? 'আমার প্যানেল বন্ধ হয়ে গিয়েছে' : open.name_bn || open.name}
      lead={open === leave ? 'এই আবেদন অফিসে যাবে। অফিস অনুমোদন দিলে আপনার আইডি বন্ধ হবে।' : open === active ? 'এই আবেদন অফিসে যাবে। অফিস দেখে আপনার প্যানেল / আইডি চালু করে দেবে।' : open.description ?? ''}
      onClose={() => go('')} onDone={id => { refreshShellCounts(); onSent(id) }} />}
  </div>
}

// ------------------------------------------------------------------ one simple request
function Ask({ me, fmt, title, lead, hubName, posName, deptName, onClose, onDone }: { me: EmpRow; fmt: ReqFormat; title: string; lead: string
  hubName: string; posName: string; deptName: string; onClose: () => void; onDone: (id: string) => void }) {
  const known = (key: string | undefined): string => {
    switch (key) {
      case undefined: case '': return ''
      case 'hub': return hubName
      case 'position': return posName
      case 'department': return deptName
      default: return String((me as unknown as Record<string, unknown>)[key] ?? '')
    }
  }
  // "চাকরি ছেড়ে দিচ্ছি" is chosen for the person; they are not asked to pick a type.
  const fixed: Record<string, string> = {}
  if (fmt.kind === 'id_inactive') for (const f of fmt.fields) {
    const own = f.type === 'select' ? (f.options ?? []).find(x => /ছেড়ে/.test(x)) : undefined
    if (own) fixed[f.key] = own
  }
  const asked = fmt.fields.filter(f => !(f.key in fixed) && !known(f.prefill))
  const [data, setData] = useState<Record<string, string>>(() => Object.fromEntries(asked.filter(f => f.type === 'date' && f.required).map(f => [f.key, today()])))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const label = (f: ReqField) => WORDS[fmt.kind]?.[f.key] ?? f.label

  async function send() {
    setErr('')
    for (const f of asked) if (f.required && !String(data[f.key] ?? '').trim()) { setErr(`"${label(f)}" — এই ঘরটি পূরণ করুন`); return }
    const all: Record<string, string> = {}
    for (const f of fmt.fields) all[f.key] = f.key in fixed ? fixed[f.key] : known(f.prefill) || String(data[f.key] ?? '').trim()
    setBusy(true)
    try { onDone(await hrReq.submit({ format: fmt.id, employee: me.id, hub: me.hub_id, data: all, note: '' })) }
    catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }

  return <Modal title={title} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>বাতিল</button>
      <button className={fmt.kind === 'id_inactive' ? 'danger' : ''} disabled={busy} onClick={() => void send()}>{busy ? 'পাঠানো হচ্ছে…' : 'আবেদন পাঠান'}</button></>}>
    {lead && <p className={fmt.kind === 'id_inactive' ? 'notice' : 'muted'}>{lead}</p>}
    <div className="sd-who"><b>{me.full_name}</b><span className="muted small">{[me.employee_code && `আইডি ${me.employee_code}`, hubName, posName].filter(Boolean).join(' · ')}</span></div>
    <div className="sd-form">{asked.map(f => <Field key={f.key} label={`${label(f)}${f.required ? ' *' : ''}`}>
      {f.type === 'textarea' ? <textarea rows={3} value={data[f.key] ?? ''} onChange={e => setData(d => ({ ...d, [f.key]: e.target.value }))} />
        : f.type === 'select' ? <select value={data[f.key] ?? ''} onChange={e => setData(d => ({ ...d, [f.key]: e.target.value }))}><option value="">বেছে নিন…</option>
          {(f.options ?? []).map(x => <option key={x} value={x}>{x}</option>)}</select>
        : <input type={f.type === 'date' ? 'date' : 'text'} inputMode={f.type === 'phone' ? 'tel' : f.type === 'number' ? 'decimal' : undefined}
            value={data[f.key] ?? ''} onChange={e => setData(d => ({ ...d, [f.key]: e.target.value }))} />}
    </Field>)}</div>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

// ------------------------------------------------------------------ my people
function Back({ title, sub, onBack, action }: { title: string; sub: string; onBack: () => void; action?: ReactNode }) {
  return <div className="sd-top"><button type="button" className="secondary sm" onClick={onBack}><Icon name="back" size={16} />ফিরে যান</button>
    <div className="tx"><b>{title}</b><span className="muted small">{sub}</span></div>{action}</div>
}

function InHand({ me, onBack, onChanged }: { me: EmpRow; onBack: () => void; onChanged: () => void }) {
  const { toast, node } = useToast()
  const d = useLoad(async () => {
    const [list, cols, pos] = await Promise.all([referrals.prospects(me.id), referrals.columns().catch(() => [] as PCol[]), org.positions().catch(() => [] as Position[])])
    return { list, cols: cols.filter(c => !c.zone_id || c.zone_id === me.zone_id), pos }
  }, [me.id])
  const [edit, setEdit] = useState<Partial<Prospect> | null>(null)
  const posName = (id: string | null) => { const p = d.data?.pos.find(x => x.id === id); return p ? p.name_bn || p.name : '' }
  const add = () => setEdit({ referrer_id: me.id, status: 'available', extra: {} })
  return <div className="sd">
    {node}
    <Back title="আমার হাতে লোক আছে" sub="কাজ করতে চায় এমন যাদের চেনেন, তাদের নাম এখানে রাখুন" onBack={onBack}
      action={<button type="button" className="sm" disabled={!d.data} onClick={add}><Icon name="plus" size={16} />নাম দিন</button>} />
    {d.error ? <p className="da-error">{hrFriendly(d.error)}</p> : !d.data ? <p className="muted">লোড হচ্ছে…</p>
      : !d.data.list.length ? <div className="nv-empty panel"><Icon name="users" size={30} /><p>এখনো কারো নাম রাখা নেই।</p>
          <button type="button" onClick={add}><Icon name="plus" size={16} />প্রথম নাম দিন</button></div>
      : <div className="nv-rows">{d.data.list.map(p => <a key={p.id} href="#" className="nv-row" onClick={e => { e.preventDefault(); setEdit(p) }}>
          <span className="nv-av">{p.full_name.slice(0, 1).toUpperCase()}</span>
          <span className="tx"><b>{p.full_name}</b><span>{[p.mobile, posName(p.position_id), p.area].filter(Boolean).join(' · ') || 'তথ্য দেওয়া নেই'}</span></span>
          <span className="end"><Badge tone={PROSPECT_STATUS[p.status][1]}>{PROSPECT_STATUS[p.status][0]}</Badge></span></a>)}</div>}
    {edit && d.data && <ProspectForm p={edit} cols={d.data.cols} positions={d.data.pos} onClose={() => setEdit(null)}
      onDone={m => { setEdit(null); toast(m); void d.reload(); onChanged() }} />}
  </div>
}

function Brought({ me, onBack }: { me: EmpRow; onBack: () => void }) {
  const d = useLoad(() => referrals.brought(me.id), [me.id])
  const st = (s: string): [string, 'ok' | 'info' | 'neutral'] => s === 'active' ? ['কাজে আছেন', 'ok'] : s === 'applicant' ? ['আবেদন চলছে', 'info'] : ['এখন নেই', 'neutral']
  return <div className="sd">
    <Back title="আমি যাদের নিয়ে এসেছি" sub="আপনার রেফারেন্সে যারা যোগ দিয়েছেন" onBack={onBack} />
    {d.error ? <p className="da-error">{hrFriendly(d.error)}</p> : !d.data ? <p className="muted">লোড হচ্ছে…</p>
      : !d.data.length ? <div className="nv-empty panel"><Icon name="users" size={30} /><p>আপনার নামে এখনো কেউ যোগ দেননি।</p>
          <p className="small">কাউকে আনলে হাব ম্যানেজারকে বলুন — তাঁর প্রোফাইলে আপনার নাম রেফারেন্স হিসেবে বসালে এখানে দেখা যাবে।</p></div>
      : <div className="nv-rows">{d.data.map(r => <div key={r.id} className="nv-row">
          <span className="nv-av">{r.full_name.slice(0, 1).toUpperCase()}</span>
          <span className="tx"><b>{r.full_name}</b><span>{[r.employee_code && `আইডি ${r.employee_code}`, r.position_name, r.hub_name].filter(Boolean).join(' · ')}</span></span>
          <span className="end"><Badge tone={st(r.status)[1]}>{st(r.status)[0]}</Badge></span></div>)}</div>}
  </div>
}
