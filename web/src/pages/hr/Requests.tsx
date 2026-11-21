import { useEffect, useMemo, useState } from 'react'
import { Contact } from '../../components/Contact'
import { Combo } from '../../components/inputs'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell, refreshShellCounts } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { hr, hrFriendly } from '../../lib/hr'
import { FIELD_TYPES, KIND_HINT, KINDS, PREFILL, fmtName, STATUS, hrReq, slugKey, type EmpRow, type FieldType, type HrRequest, type ReqField,
  type ReqFormat, type ReqKind, type ReqStatus } from '../../lib/hrreq'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'
import { NewApplication, useOrg } from './common'
import { PersonPicker, type RefPerson } from '../../components/PersonPicker'
import { StaffDesk } from './StaffDesk'
import { CompanySheets } from './CompanySheets'

type Tab = 'new' | 'list' | 'report' | 'sheets' | 'settings'
const errText = (e: unknown) => (e instanceof Error && !('code' in e) ? e.message : hrFriendly(e))
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const when = (s: string) => new Date(s).toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

export function Requests() {
  const { can } = useAuth()
  const [sp, setSp] = useSearchParams()
  const canOthers = can('hr.request.create')
  const canDecide = can('hr.request.approve')
  const canConfig = can('hr.request.configure')
  // The company's own Excel layouts, filled from the requests: for everyone who handles other people's requests.
  const canSheets = canOthers || canDecide || canConfig || can('hr.request.view')
  const tab = (sp.get('tab') as Tab) || (sp.get('id') ? 'list' : 'new')
  const setTab = (t: Tab) => { const n = new URLSearchParams(sp); n.set('tab', t); n.delete('id'); setSp(n, { replace: true }) }
  // Staff who act only for themselves get a plain desk instead of the format picker.
  const tabs: Array<[Tab, string, string]> = [['new', canOthers ? 'নতুন রিকুয়েস্ট' : 'আবেদন করুন', canOthers ? 'plus' : 'grid'], ['list', canDecide ? 'অনুমোদন প্যানেল' : canOthers ? 'আমার রিকুয়েস্ট' : 'আমার আবেদন', 'check'],
    ['report', 'রিপোর্ট', 'chart'], ...(canSheets ? [['sheets', 'কোম্পানি শিট', 'xls'] as [Tab, string, string]] : []), ...(canConfig ? [['settings', 'ফরম্যাট সেটিং', 'gear'] as [Tab, string, string]] : [])]
  return <AppShell title={canOthers ? 'এইচআর ও অপারেশন রিকুয়েস্ট' : 'আমার আবেদন ও আমার লোক'} subtitle={canOthers ? 'হাব → স্টাফ → ফরম্যাট বাছুন; আগের তথ্য নিজে বসে যায়' : 'আমার প্রোফাইল, আমার লোক আর অফিসে আবেদন'}>
    <div className="rq-tabs">{tabs.map(([k, l, ic]) => <button key={k} type="button" className={`rq-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}><Icon name={ic} size={16} />{l}</button>)}</div>
    {tab === 'new' && <NewRequest onDone={id => { const n = new URLSearchParams(); n.set('tab', 'list'); n.set('id', id); setSp(n) }} />}
    {tab === 'list' && <RequestList openId={sp.get('id')} onOpen={id => { const n = new URLSearchParams(sp); if (id) n.set('id', id); else n.delete('id'); setSp(n, { replace: true }) }} />}
    {tab === 'report' && <Report />}
    {tab === 'sheets' && canSheets && <CompanySheets />}
    {tab === 'settings' && canConfig && <Settings />}
  </AppShell>
}

/** The kind as a coloured tag with its icon, in Bangla. */
function KindTag({ kind, label }: { kind: ReqKind; label?: string }) {
  const k = KINDS[kind] ?? KINDS.custom
  return <span className={`rq-kind-tag t-${k.tone}`}><Icon name={k.icon} size={12} />{label ?? k.bn}</span>
}

// ------------------------------------------------------------------ new request
const HUB_KEY = 'xzm_rq_hub'
const readHub = () => { try { return localStorage.getItem(HUB_KEY) || '' } catch { return '' } }
/** Who a kind of request is for: active staff for transfer / inactive, the others for active again. */
const fitsKind = (k: ReqKind | undefined, e: EmpRow) =>
  k === 'id_active' ? e.status !== 'active' : k === 'id_transfer' || k === 'id_inactive' ? e.status === 'active' : true
const EMP_ST: Record<string, [string, 'ok' | 'warn' | 'bad' | 'neutral']> = {
  active: ['সক্রিয়', 'ok'], inactive: ['নিষ্ক্রিয়', 'warn'], suspended: ['সাসপেন্ড', 'warn'], resigned: ['চাকরি ছেড়েছেন', 'neutral'], terminated: ['অব্যাহতি', 'bad'],
  pending: ['আইডির অপেক্ষায়', 'warn'], draft: ['খসড়া', 'neutral'],
}

function NewRequest({ onDone }: { onDone: (id: string) => void }) {
  const { can } = useAuth()
  const canOthers = can('hr.request.create')
  const o = useOrg()
  const base = useLoad(async () => ({ formats: await hrReq.formats(), me: await hrReq.myEmployee().catch(() => null),
    open: canOthers ? (await hrReq.list().catch(() => [] as HrRequest[])).filter(r => r.status === 'submitted' || r.status === 'processing') : [] }), [])
  const [hub, setHubRaw] = useState(readHub)
  const setHub = (v: string) => { setHubRaw(v); try { if (v) localStorage.setItem(HUB_KEY, v) } catch { /* private mode */ } }
  const [emp, setEmp] = useState<EmpRow | null>(null)
  const [fmtId, setFmtId] = useState('')
  const [data, setData] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [ref, setRef] = useState<RefPerson | null>(null)
  const [everyone, setEveryone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const me = base.data?.me ?? null
  const formats = (base.data?.formats ?? []).filter(f => canOthers || f.self_service)
  const fmt = formats.find(f => f.id === fmtId) ?? null
  const staff = useLoad(() => (canOthers && hub ? hrReq.hubStaff(hub) : Promise.resolve([] as EmpRow[])), [hub, canOthers])
  const hubs = o.data?.hubs ?? []

  useEffect(() => { if (!canOthers && me) { setEmp(me); setHubRaw(me.hub_id ?? '') } }, [canOthers, me])
  // A remembered hub that is gone, or none yet: start at one's own hub, or the only hub there is.
  useEffect(() => { if (!canOthers || !hubs.length) return
    if (!hubs.some(h => h.id === hub)) setHubRaw(me?.hub_id && hubs.some(h => h.id === me.hub_id) ? me.hub_id : hubs.length === 1 ? hubs[0].id : '') }, [hubs.length, me?.id])
  const hubName = (id: string | null) => o.names.hub[id ?? ''] ?? ''
  const posName = (id: string | null) => o.names.pos[id ?? ''] ?? ''

  const prefillOf = (key: string | undefined, e: EmpRow | null): string => {
    if (!key || !e) return ''
    switch (key) {
      case 'hub': return hubName(e.hub_id)
      case 'position': return posName(e.position_id)
      case 'department': return o.names.dept[e.department_id ?? ''] ?? ''
      case 'status': return e.status
      default: return String((e as unknown as Record<string, unknown>)[key] ?? '')
    }
  }
  useEffect(() => {
    if (!fmt) return
    const d: Record<string, string> = {}
    for (const f of fmt.fields) d[f.key] = f.prefill ? prefillOf(f.prefill, emp) : (data[f.key] ?? '')
    setData(d)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fmtId, emp?.id, o.data])

  const openByKind = (k: ReqKind) => (base.data?.open ?? []).filter(r => r.kind === k).length
  const pending = emp ? (base.data?.open ?? []).filter(r => r.employee_id === emp.id) : []
  const pick = (f: ReqFormat) => { setFmtId(f.id); setErr(''); if (emp && f.needs_employee && !fitsKind(f.kind, emp)) setEmp(null) }
  const list = (staff.data ?? []).filter(x => x.id !== me?.id && (everyone || !fmt || fitsKind(fmt.kind, x)))
  const hidden = (staff.data ?? []).length - list.length - (me && staff.data?.some(x => x.id === me.id) ? 1 : 0)

  async function submit() {
    if (!fmt) return
    setErr('')
    if (fmt.needs_employee && !emp) { setErr('স্টাফ বেছে নিন'); return }
    if (!fmt.needs_employee && !hub) { setErr('হাব বেছে নিন'); return }
    for (const f of fmt.fields) if (f.required && !String(data[f.key] ?? '').trim()) { setErr(`"${f.label}" ঘরটি পূরণ করুন`); return }
    if (fmt.kind === 'id_transfer' && emp && data.to_hub && data.to_hub === emp.hub_id) { setErr('একই হাবে বদলি হয় না — নতুন হাব বেছে নিন'); return }
    setBusy(true)
    try {
      const id = await hrReq.submit({ format: fmt.id, employee: fmt.needs_employee ? emp!.id : null, hub: fmt.needs_employee ? emp!.hub_id : hub, data, note,
        ref: ref?.kind === 'employee' ? { employee: ref.id, hub: ref.hub, position: ref.position }
          : ref ? { name: ref.name, code: ref.code, hub: ref.hub, position: ref.position } : undefined })
      refreshShellCounts(); onDone(id)
    } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }

  if (base.error) return <p className="da-error">{hrFriendly(base.error)}</p>
  if (!base.data) return <p className="muted">লোড হচ্ছে…</p>
  if (!canOthers && !me) return <section className="panel"><p className="notice">আপনার লগইনের সাথে কোনো কর্মী প্রোফাইল যুক্ত নেই। এইচআর-কে বলুন।</p></section>
  if (!canOthers && me) return <StaffDesk me={me} formats={formats} onSent={onDone} />

  const kindOf = (f: ReqFormat) => KINDS[f.kind] ?? KINDS.custom
  const st = emp ? EMP_ST[emp.status] ?? [emp.status, 'neutral' as const] : null
  const summary = fmt ? [fmtName(fmt), emp?.full_name, fmt.kind === 'id_transfer' && data.to_hub ? `→ ${hubName(data.to_hub)}` : null, !fmt.needs_employee ? hubName(hub) : null].filter(Boolean).join(' · ') : ''

  return <div className="rq-new">
    <section className="panel rq-card">
      <h2 className="rq-h"><span className="rq-step">১</span>কী করবেন? <span className="muted small">— একটা বেছে নিন</span></h2>
      <div className="rq-tiles">{formats.map(f => { const n = openByKind(f.kind)
        return <button key={f.id} type="button" className={`rq-tile t-${kindOf(f).tone}${fmtId === f.id ? ' on' : ''}`} aria-pressed={fmtId === f.id} onClick={() => pick(f)}>
          <span className="qi"><Icon name={kindOf(f).icon} size={20} /></span>
          <span className="rq-tile-t"><b>{fmtName(f)}</b>{(() => { const h = f.description || KIND_HINT[f.kind]; return h && h !== fmtName(f) ? <small>{h}</small> : null })()}<em className="rq-code">{f.name}</em></span>
          {n > 0 && <span className="rq-tile-n" title="অপেক্ষমাণ">{n}</span>}
          {fmtId === f.id && <span className="rq-tile-ok"><Icon name="check" size={14} /></span>}
        </button> })}</div>
      {!formats.length && <p className="muted">কোনো ফরম্যাট নেই।</p>}
    </section>

    {fmt && <section className="panel rq-card">
      <h2 className="rq-h"><span className="rq-step">২</span>{fmt.needs_employee ? 'কার জন্য?' : 'কোন হাবে?'}</h2>
      <Field label="হাব"><Combo value={hub} onChange={v => { setHub(v); setEmp(null) }} options={hubs.map(h => ({ value: h.id, label: h.name }))} /></Field>
      {fmt.needs_employee && <>
        <Field label="স্টাফ" hint={hub && hidden > 0 && !everyone
          ? <span>{fmt.kind === 'id_active' ? 'শুধু বন্ধ আইডি দেখাচ্ছে' : 'শুধু সক্রিয় আইডি দেখাচ্ছে'} · <button type="button" className="link-btn" onClick={() => setEveryone(true)}>সবাই দেখান ({hidden})</button></span> : undefined}>
          <Combo value={emp?.id ?? ''} disabled={!hub}
            onChange={v => setEmp(v === me?.id ? me : staff.data?.find(x => x.id === v) ?? null)}
            placeholder={hub ? (staff.loading ? 'লোড হচ্ছে…' : 'নাম, আইডি বা মোবাইল লিখে খুঁজুন…') : 'আগে হাব বাছুন'}
            options={[...(me && me.hub_id === hub ? [{ value: me.id, label: `★ আমি — ${me.full_name}`, sub: me.employee_code ? `#${me.employee_code}` : '' }] : []),
              ...list.map(x => ({ value: x.id, label: x.full_name, keywords: x.mobile ?? '',
                sub: [x.employee_code && `#${x.employee_code}`, posName(x.position_id), x.status !== 'active' ? EMP_ST[x.status]?.[0] ?? x.status : ''].filter(Boolean).join(' · ') }))]} /></Field>
        {emp && st && <div className="rq-pcard">
          <span className="rq-av">{emp.full_name.slice(0, 1)}</span>
          <div className="rq-pcard-t"><b>{emp.full_name}</b>
            <span className="muted small">{[emp.employee_code && `আইডি ${emp.employee_code}`, posName(emp.position_id), hubName(emp.hub_id)].filter(Boolean).join(' · ')}</span>
            {emp.mobile && <Contact phone={emp.mobile} />}</div>
          <Badge tone={st[1]}>{st[0]}</Badge>
          <button type="button" className="icon-btn" aria-label="বদলান" onClick={() => setEmp(null)}><Icon name="x" size={16} /></button>
        </div>}
        {pending.length > 0 && <p className="notice small">এই কর্মীর {pending.map(p => p.request_no).join(', ')} আগেই অপেক্ষায় আছে — আবার পাঠানোর আগে দেখে নিন।</p>}
        {emp && !fitsKind(fmt.kind, emp) && <p className="notice small">{fmt.kind === 'id_active' ? 'এই আইডি এখনই সক্রিয় আছে।' : 'এই আইডি এখন সক্রিয় নয়।'}</p>}
      </>}
    </section>}

    {fmt && (!fmt.needs_employee || emp) && <section className="panel rq-card">
      <h2 className="rq-h"><span className="rq-step">৩</span>তথ্য <span className="muted small">— তালা চিহ্নের ঘর আগের তথ্য থেকে বসেছে</span></h2>
      <div className="hr-form rq-form">
        {fmt.fields.map(f => <FieldInput key={f.key} f={f} value={data[f.key] ?? ''} locked={!!f.prefill && !!prefillOf(f.prefill, emp)}
          hubs={(o.data?.hubs ?? []).filter(h => !(f.key === 'to_hub' && emp && h.id === emp.hub_id))} positions={o.data?.positions ?? []} onChange={v => setData(d => ({ ...d, [f.key]: v }))} />)}
        <Field label="নোট (ঐচ্ছিক)" wide><textarea rows={2} value={note} onChange={e => setNote(e.target.value)} /></Field>
      </div>
    </section>}

    {fmt && (!fmt.needs_employee || emp) && <details className="panel rq-card rq-more">
      <summary><span className="rq-step sm">৪</span>রেফারেন্স যোগ করুন <span className="muted small">(ঐচ্ছিক — তাকে নোটিফিকেশন যাবে)</span>{ref && <Badge tone="ok">{ref.name}</Badge>}</summary>
      <PersonPicker value={ref} onChange={setRef} exclude={emp?.id} />
    </details>}

    {fmt && <div className="rq-submit">
      {err && <p className="da-error">{err}</p>}
      <div className="rq-submit-bar"><span className="rq-sum">{summary}</span>
        <button disabled={busy || (fmt.needs_employee && !emp)} onClick={() => void submit()}><Icon name="check" size={18} />{busy ? 'পাঠানো হচ্ছে…' : 'সাবমিট করুন'}</button></div>
    </div>}
  </div>
}

function FieldInput({ f, value, locked, onChange, hubs, positions }: { f: ReqField; value: string; locked: boolean; onChange: (v: string) => void
  hubs: Array<{ id: string; name: string }>; positions: Array<{ id: string; name: string }> }) {
  const label = `${f.label}${f.required ? ' *' : ''}`
  const hint = locked ? <span className="rq-lock"><Icon name="key" size={12} /> আগের তথ্য</span> : undefined
  const wide = f.type === 'textarea'
  let input
  switch (f.type) {
    case 'textarea': input = <textarea rows={3} value={value} readOnly={locked} onChange={e => onChange(e.target.value)} />; break
    case 'date': input = <input type="date" value={value} readOnly={locked} onChange={e => onChange(e.target.value)} />; break
    case 'number': input = <input inputMode="decimal" value={value} readOnly={locked} onChange={e => onChange(e.target.value)} />; break
    case 'phone': input = <input inputMode="tel" value={value} readOnly={locked} placeholder="01XXXXXXXXX" onChange={e => onChange(e.target.value)} />; break
    case 'select': input = <select value={value} disabled={locked} onChange={e => onChange(e.target.value)}><option value="">বেছে নিন…</option>
      {(f.options ?? []).map(x => <option key={x} value={x}>{x}</option>)}</select>; break
    case 'hub': input = <select value={value} disabled={locked} onChange={e => onChange(e.target.value)}><option value="">বেছে নিন…</option>
      {hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select>; break
    case 'position': input = <select value={value} disabled={locked} onChange={e => onChange(e.target.value)}><option value="">বেছে নিন…</option>
      {positions.map(h => <option key={h.id} value={h.name}>{h.name}</option>)}</select>; break
    default: input = <input value={value} readOnly={locked} onChange={e => onChange(e.target.value)} />
  }
  return <Field label={label} hint={hint} wide={wide}>{input}</Field>
}

// ------------------------------------------------------------------ list + approval
function RequestList({ openId, onOpen }: { openId: string | null; onOpen: (id: string | null) => void }) {
  const { can, session } = useAuth()
  const canDecide = can('hr.request.approve')
  const o = useOrg()
  const data = useLoad(async () => {
    const [rows, formats] = await Promise.all([hrReq.list(), hrReq.formats(true)])
    const ids = [...new Set(rows.flatMap(r => [r.employee_id, r.submitter_employee_id]).filter(Boolean) as string[])]
    const people = await hrReq.employeesByIds(ids).catch(() => [] as EmpRow[])
    return { rows, formats, people: Object.fromEntries(people.map(p => [p.id, p])) }
  }, [])
  const [st, setSt] = useState<'open' | 'all' | ReqStatus>(canDecide ? 'open' : 'all')
  const [kind, setKind] = useState<'' | ReqKind>('')
  const [mine, setMine] = useState(false)
  const d = data.data
  const fmtById = useMemo(() => Object.fromEntries((d?.formats ?? []).map(f => [f.id, f])), [d])
  const uid = session?.user.id
  const rows = (d?.rows ?? []).filter(r => (st === 'all' || (st === 'open' ? ['submitted', 'processing'].includes(r.status) : r.status === st))
    && (!kind || r.kind === kind) && (!mine || r.submitted_by === uid))
  const person = (r: HrRequest) => r.data.full_name || d?.people[r.employee_id ?? '']?.full_name || '—'
  const counts = (s: string) => (d?.rows ?? []).filter(r => s === 'open' ? ['submitted', 'processing'].includes(r.status) : s === 'all' || r.status === s).length
  const open = d?.rows.find(r => r.id === openId) ?? null

  if (data.error) return <p className="da-error">{hrFriendly(data.error)}</p>
  return <>
    <section className="panel">
      <div className="rq-chips">
        {([['open', 'অপেক্ষমাণ'], ['all', 'সব'], ['done', 'সম্পন্ন'], ['rejected', 'রিজেক্ট'], ['cancelled', 'তুলে নেওয়া']] as Array<[typeof st, string]>).map(([k, l]) =>
          <button key={k} type="button" className={`chip-toggle${st === k ? ' on' : ''}`} onClick={() => setSt(k)}>{l} <b>{counts(k)}</b></button>)}
        <select className="rq-kind" value={kind} onChange={e => setKind(e.target.value as ReqKind | '')}><option value="">সব ধরন</option>
          {(Object.keys(KINDS) as ReqKind[]).map(k => <option key={k} value={k}>{KINDS[k].bn}</option>)}</select>
        {canDecide && <label className={`chip-toggle${mine ? ' on' : ''}`}><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} /> শুধু আমার পাঠানো</label>}
      </div>
      {!d ? <p className="muted">লোড হচ্ছে…</p> :
        <DataTable title="HR রিকুয়েস্ট" file="hr-requests" rows={rows} rowKey={r => r.id} onRowClick={r => onOpen(r.id)}
          empty={<p className="muted">এখানে কোনো রিকুয়েস্ট নেই।</p>}
          cols={[
            { key: 'no', label: 'নং', value: r => r.request_no, render: r => <strong className="mono sm">{r.request_no}</strong> },
            { key: 'fmt', label: 'ধরন', value: r => fmtName(fmtById[r.format_id]) || KINDS[r.kind]?.bn, render: r => <KindTag kind={r.kind} label={fmtName(fmtById[r.format_id]) || undefined} /> },
            { key: 'person', label: 'নাম', value: r => person(r), render: r => <>{person(r)}{d.people[r.employee_id ?? '']?.employee_code && <span className="sec">আইডি {d.people[r.employee_id ?? '']?.employee_code}</span>}</> },
            { key: 'hub', label: 'হাব', value: r => o.names.hub[r.hub_id ?? ''] ?? '' },
            { key: 'by', label: 'পাঠিয়েছেন', value: r => d.people[r.submitter_employee_id ?? '']?.full_name ?? '' },
            { key: 'ref', label: 'রেফারেন্স', value: r => r.ref_name ?? '' },
            { key: 'at', label: 'তারিখ', value: r => when(r.created_at) },
            { key: 'st', label: 'অবস্থা', value: r => STATUS[r.status].bn, render: r => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].bn}</Badge> },
          ]} />}
    </section>
    {open && d && <RequestDetail r={open} format={fmtById[open.format_id]} people={d.people} hubName={id => o.names.hub[id ?? ''] ?? ''}
      onClose={() => onOpen(null)} onChanged={async () => { refreshShellCounts(); await data.reload() }} />}
  </>
}

function RequestDetail({ r, format, people, hubName, onClose, onChanged }: { r: HrRequest; format?: ReqFormat; people: Record<string, EmpRow>
  hubName: (id: string | null) => string; onClose: () => void; onChanged: () => Promise<void> }) {
  const { can, session } = useAuth()
  const nav = useNavigate()
  const { toast, node } = useToast()
  const ev = useLoad(() => hrReq.events(r.id), [r.id, r.status])
  const [act, setAct] = useState<null | 'processing' | 'done' | 'rejected' | 'cancel'>(null)
  const [note, setNote] = useState('')
  const [result, setResult] = useState('')
  const [apply, setApply] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [newApp, setNewApp] = useState(false)
  const canDecide = can('hr.request.approve')
  const isOpen = r.status === 'submitted' || r.status === 'processing'
  const emp = people[r.employee_id ?? '']
  const canApply = r.kind === 'id_transfer' || r.kind === 'id_active' || r.kind === 'id_inactive'
  const show = (f: ReqField) => { const v = r.data[f.key] ?? ''; return f.type === 'hub' ? hubName(v) || v : v }

  async function applyInSystem() {
    if (!emp) throw new Error('স্টাফ পাওয়া যায়নি')
    const eff = r.data.effective_date || r.data.last_date || today()
    const why = `${r.request_no}: ${r.data.reason || r.data.reason_type || fmtName(format) || ''}`.trim()
    if (r.kind === 'id_active') await hr.changeStatus(emp.id, 'active', eff, why)
    if (r.kind === 'id_inactive') {
      const t = r.data.reason_type ?? ''
      await hr.changeStatus(emp.id, /ছেড়ে/.test(t) ? 'resigned' : /বাদ/.test(t) ? 'terminated' : 'inactive', eff, why)
    }
    if (r.kind === 'id_transfer') {
      if (!r.data.to_hub) throw new Error('নতুন হাব দেওয়া নেই')
      await hr.transfer(emp.id, { hub: r.data.to_hub, department: emp.department_id, position: emp.position_id, manager: emp.reporting_manager_id, effective: eff, reason: why, type: 'transfer' })
    }
  }
  async function go() {
    if (!act) return
    setErr(''); setBusy(true)
    try {
      if (act === 'cancel') await hrReq.cancel(r.id, note)
      else {
        if (act === 'done' && apply && canApply) await applyInSystem()
        await hrReq.update(r.id, act, note, result)
      }
      toast('আপডেট হয়েছে'); setAct(null); setNote(''); setResult(''); await onChanged()
    } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }

  return <Modal title={`${r.request_no} · ${fmtName(format)}`} wide onClose={onClose}
    actions={<div className="row hd-acts">
      {isOpen && canDecide && <>
        {r.status === 'submitted' && <button className="soft" onClick={() => { setErr(''); setAct('processing') }}><Icon name="clock" size={16} />কাজ শুরু</button>}
        <button className="danger" onClick={() => { setErr(''); setAct('rejected') }}><Icon name="x" size={16} />রিজেক্ট</button>
        <button onClick={() => { setErr(''); setAct('done') }}><Icon name="check" size={16} />সম্পন্ন / অনুমোদন</button></>}
      {r.status === 'submitted' && r.submitted_by === session?.user.id && !canDecide && <button className="danger" onClick={() => { setErr(''); setAct('cancel') }}>তুলে নিন</button>}
      <button className="secondary" onClick={onClose}>বন্ধ</button></div>}>
    {node}
    <div className="rq-dhead"><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].bn}</Badge><span className="muted small">{when(r.created_at)}</span>
      {r.result && <span className="rq-result"><Icon name="check" size={14} /> {r.result}</span>}</div>
    <dl className="hd-dl">
      <dt>হাব</dt><dd>{hubName(r.hub_id)}</dd>
      {emp && <><dt>স্টাফ</dt><dd>{emp.full_name}{emp.employee_code ? ` · আইডি ${emp.employee_code}` : ''}</dd></>}
      {(format?.fields ?? []).filter(f => r.data[f.key]).map(f => <div key={f.key} style={{ display: 'contents' }}><dt>{f.label}</dt><dd>{show(f)}</dd></div>)}
      {r.note && <><dt>নোট</dt><dd>{r.note}</dd></>}
      {(r.ref_name || r.ref_code) && <><dt>রেফারেন্স</dt><dd>{[r.ref_name, r.ref_code && `আইডি ${r.ref_code}`, r.ref_hub, r.ref_position].filter(Boolean).join(' · ')}</dd></>}
      {r.decision_note && <><dt>সিদ্ধান্ত</dt><dd>{r.decision_note}</dd></>}
    </dl>
    {r.kind === 'id_create' && isOpen && canDecide && can('hr.application.create') && <div className="rq-appoint">
      <span>নিয়োগ দিতে চাইলে এখান থেকেই আইডি আবেদন শুরু করুন — তথ্য বসানো থাকবে।</span>
      <button className="soft sm" onClick={() => setNewApp(true)}><Icon name="user" size={14} />নিয়োগ দিন</button></div>}
    <h3 className="rq-h3">কাজের লগ</h3>
    <ol className="rq-log">{(ev.data ?? []).map(e => <li key={e.id} className={`s-${e.status}`}><span className="dot" />
      <div><b>{STATUS[e.status as ReqStatus]?.bn ?? e.status}</b> <span className="muted small">· {when(e.at)} · {e.by_name}</span>{e.note && <div className="small">{e.note}</div>}</div></li>)}</ol>

    {act && <div className="rq-act">
      <b>{act === 'processing' ? 'কাজ শুরু' : act === 'done' ? 'সম্পন্ন / অনুমোদন' : act === 'rejected' ? 'রিজেক্ট' : 'রিকুয়েস্ট তুলে নিন'}</b>
      {act === 'done' && <Field label={r.kind === 'id_create' ? 'নতুন আইডি নম্বর / ফলাফল' : 'ফলাফল (ঐচ্ছিক)'}><input value={result} onChange={e => setResult(e.target.value)} placeholder={r.kind === 'id_create' ? 'যেমন 10234 — ID CREATE success' : 'যেমন: সম্পন্ন'} /></Field>}
      <Field label={act === 'rejected' || act === 'cancel' ? 'কারণ (আবশ্যক)' : 'নোট'}><textarea rows={2} value={note} onChange={e => setNote(e.target.value)} /></Field>
      {act === 'done' && canApply && <label className="da-check"><input type="checkbox" style={{ width: 'auto' }} checked={apply} onChange={e => setApply(e.target.checked)} />
        {r.kind === 'id_transfer' ? ' সিস্টেমেও বদলি করে দিন' : r.kind === 'id_active' ? ' সিস্টেমেও আইডি চালু করুন' : ' সিস্টেমেও আইডি বন্ধ করুন'}</label>}
      {err && <p className="da-error">{err}</p>}
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="secondary" onClick={() => setAct(null)}>পেছনে</button>
        <button className={act === 'rejected' || act === 'cancel' ? 'danger' : ''} disabled={busy || ((act === 'rejected' || act === 'cancel') && !note.trim())} onClick={() => void go()}>{busy ? '…' : 'নিশ্চিত করুন'}</button></div>
    </div>}
    {newApp && <NewApplication prefill={{ name: r.data.full_name, mobile: r.data.mobile, hub: r.hub_id ?? '', position: r.data.position }}
      onClose={() => setNewApp(false)} onDone={id => { setNewApp(false); setResult('আইডি আবেদন শুরু হয়েছে'); nav(`/app/hr/employees/${id}`) }} />}
  </Modal>
}

// ------------------------------------------------------------------ report: a builder — any rows × any columns, table / bars / list, saved presets
type Dim = 'kind' | 'format' | 'hub' | 'status' | 'month' | 'day' | 'by' | 'ref' | 'decider'
type Range = 'today' | '7d' | 'month' | 'lastmonth' | '90d' | 'all' | 'custom'
type View = 'table' | 'bar' | 'list'
type RepCfg = { name: string; range: Range; from: string; to: string; hub: string; kinds: ReqKind[]; statuses: ReqStatus[]; rows: Dim; cols: Dim | 'none'; view: View; fields: string[] }
const DIMS: Record<Dim, string> = { kind: 'ধরন', format: 'ফরম্যাট', hub: 'হাব', status: 'অবস্থা', month: 'মাস', day: 'তারিখ', by: 'যিনি পাঠিয়েছেন', ref: 'রেফারেন্স', decider: 'সিদ্ধান্ত হয়েছে কি' }
const RANGES: Record<Range, string> = { today: 'আজ', '7d': '৭ দিন', month: 'এই মাস', lastmonth: 'গত মাস', '90d': '৯০ দিন', all: 'সব সময়', custom: 'তারিখ বেছে' }
const VIEWS: Record<View, [string, string]> = { table: ['টেবিল', 'table'], bar: ['বার চার্ট', 'chart'], list: ['তালিকা', 'log'] }
const BASE_FIELDS: Record<string, string> = { no: 'নং', kind: 'ধরন', person: 'নাম', code: 'আইডি', hub: 'হাব', by: 'পাঠিয়েছেন', ref: 'রেফারেন্স', at: 'তারিখ', status: 'অবস্থা', result: 'ফলাফল', decision: 'সিদ্ধান্তের নোট' }
const DEF_FIELDS = ['no', 'kind', 'person', 'code', 'hub', 'at', 'status']
const PRESETS: RepCfg[] = [
  { name: 'এই মাস: হাব × ধরন', range: 'month', from: '', to: '', hub: '', kinds: [], statuses: [], rows: 'hub', cols: 'kind', view: 'table', fields: DEF_FIELDS },
  { name: 'অপেক্ষমাণ — কোন হাবে কত', range: 'all', from: '', to: '', hub: '', kinds: [], statuses: ['submitted', 'processing'], rows: 'hub', cols: 'status', view: 'bar', fields: DEF_FIELDS },
  { name: 'মাস অনুযায়ী ধরন', range: '90d', from: '', to: '', hub: '', kinds: [], statuses: [], rows: 'month', cols: 'kind', view: 'table', fields: DEF_FIELDS },
  { name: 'আজকের সব রিকুয়েস্ট', range: 'today', from: '', to: '', hub: '', kinds: [], statuses: [], rows: 'kind', cols: 'status', view: 'list', fields: DEF_FIELDS },
  { name: 'কে কত পাঠিয়েছেন', range: 'month', from: '', to: '', hub: '', kinds: [], statuses: [], rows: 'by', cols: 'status', view: 'bar', fields: DEF_FIELDS },
]
const REP_KEY = 'xzm_rq_reports'
const loadSaved = (): RepCfg[] => { try { return JSON.parse(localStorage.getItem(REP_KEY) || '[]') as RepCfg[] } catch { return [] } }
const storeSaved = (l: RepCfg[]) => { try { localStorage.setItem(REP_KEY, JSON.stringify(l)) } catch { /* private mode */ } }
const ymd = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
function rangeDates(c: RepCfg): [string | null, string | null] {
  const t = today(); const d = new Date(t + 'T00:00:00')
  switch (c.range) {
    case 'today': return [t, t]
    case '7d': d.setDate(d.getDate() - 6); return [ymd(d), t]
    case '90d': d.setDate(d.getDate() - 89); return [ymd(d), t]
    case 'month': return [t.slice(0, 8) + '01', t]
    case 'lastmonth': { const s = new Date(d.getFullYear(), d.getMonth() - 1, 1); const e = new Date(d.getFullYear(), d.getMonth(), 0); return [ymd(s), ymd(e)] }
    case 'custom': return [c.from || null, c.to || null]
    default: return [null, null]
  }
}
const BAR_TONE = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d']

function Report() {
  const { can } = useAuth()
  const o = useOrg()
  const s = useLoad(() => hrReq.summary(), [])
  const [cfg, setCfg] = useState<RepCfg>(PRESETS[0])
  const [saved, setSaved] = useState<RepCfg[]>(loadSaved)
  const [edit, setEdit] = useState(false)
  const [from, to] = rangeDates(cfg)
  const q = useLoad(async () => {
    const [rows, formats] = await Promise.all([hrReq.between(from, to), hrReq.formats(true)])
    const ids = [...new Set(rows.flatMap(r => [r.employee_id, r.submitter_employee_id]).filter(Boolean) as string[])]
    const people = await hrReq.employeesByIds(ids).catch(() => [] as EmpRow[])
    return { rows, formats, people: Object.fromEntries(people.map(p => [p.id, p])) as Record<string, EmpRow> }
  }, [from, to])
  const set = (p: Partial<RepCfg>) => setCfg(c => ({ ...c, ...p }))
  const d = q.data
  const fmtById = useMemo(() => Object.fromEntries((d?.formats ?? []).map(f => [f.id, f])) as Record<string, ReqFormat>, [d])
  const rows = (d?.rows ?? []).filter(r => (!cfg.hub || r.hub_id === cfg.hub) && (!cfg.kinds.length || cfg.kinds.includes(r.kind)) && (!cfg.statuses.length || cfg.statuses.includes(r.status)))
  const person = (r: HrRequest) => r.data.full_name || d?.people[r.employee_id ?? '']?.full_name || '—'
  const keyOf = (r: HrRequest, dim: Dim): string => {
    switch (dim) {
      case 'kind': return KINDS[r.kind]?.bn ?? r.kind
      case 'format': return fmtName(fmtById[r.format_id]) || r.kind
      case 'hub': return o.names.hub[r.hub_id ?? ''] || '—'
      case 'status': return STATUS[r.status].bn
      case 'month': return new Date(r.created_at).toLocaleDateString('bn-BD', { timeZone: 'Asia/Dhaka', month: 'long', year: 'numeric' })
      case 'day': return new Date(r.created_at).toLocaleDateString('bn-BD', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', year: 'numeric' })
      case 'by': return d?.people[r.submitter_employee_id ?? '']?.full_name || '—'
      case 'ref': return r.ref_name || '—'
      case 'decider': return r.decided_at ? 'সিদ্ধান্ত হয়েছে' : 'এখনো হয়নি'
    }
  }
  // Rows in a sensible order: time keys by time, the rest by count.
  const sortKey = (r: HrRequest, dim: Dim) => dim === 'month' ? r.created_at.slice(0, 7) : dim === 'day' ? r.created_at.slice(0, 10) : ''
  const pivot = useMemo(() => {
    const rk = new Map<string, { label: string; sort: string; n: number }>(); const ck = new Map<string, number>(); const cell = new Map<string, number>()
    for (const r of rows) {
      const a = keyOf(r, cfg.rows); const b = cfg.cols === 'none' ? 'মোট' : keyOf(r, cfg.cols)
      const x = rk.get(a) ?? { label: a, sort: sortKey(r, cfg.rows), n: 0 }; x.n++; rk.set(a, x)
      ck.set(b, (ck.get(b) ?? 0) + 1); cell.set(a + '\u0001' + b, (cell.get(a + '\u0001' + b) ?? 0) + 1)
    }
    const timeDim = cfg.rows === 'month' || cfg.rows === 'day'
    const rl = [...rk.values()].sort((x, y) => timeDim ? y.sort.localeCompare(x.sort) : y.n - x.n)
    const cl = [...ck.entries()].sort((x, y) => y[1] - x[1]).map(([k]) => k)
    return { rl, cl, at: (a: string, b: string) => cell.get(a + '\u0001' + b) ?? 0, colTotal: (b: string) => ck.get(b) ?? 0 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cfg.rows, cfg.cols, d, o.names])
  const fieldOpts = useMemo(() => {
    const m: Record<string, string> = { ...BASE_FIELDS }
    const seen = new Set(Object.values(m))
    for (const f of d?.formats ?? []) for (const x of f.fields) if (!m['f:' + x.key] && !x.prefill && !seen.has(x.label)) { m['f:' + x.key] = x.label; seen.add(x.label) }
    return m
  }, [d])
  const cellText = (r: HrRequest, k: string): string => {
    if (k.startsWith('f:')) { const key = k.slice(2); const v = r.data[key] ?? ''; return /hub$/.test(key) ? o.names.hub[v] || v : v }
    switch (k) {
      case 'no': return r.request_no
      case 'kind': return fmtName(fmtById[r.format_id]) || KINDS[r.kind]?.bn || r.kind
      case 'person': return person(r)
      case 'code': return d?.people[r.employee_id ?? '']?.employee_code ?? r.data.employee_code ?? ''
      case 'hub': return o.names.hub[r.hub_id ?? ''] ?? ''
      case 'by': return d?.people[r.submitter_employee_id ?? '']?.full_name ?? ''
      case 'ref': return r.ref_name ?? ''
      case 'at': return when(r.created_at)
      case 'status': return STATUS[r.status].bn
      case 'result': return r.result ?? ''
      case 'decision': return r.decision_note ?? ''
      default: return ''
    }
  }
  const title = `${cfg.name} — ${from ? `${from}${to && to !== from ? ` থেকে ${to}` : ''}` : RANGES.all}`
  function saveAs() {
    const name = (window.prompt('রিপোর্টের নাম', cfg.name) ?? '').trim(); if (!name) return
    const next = [...saved.filter(x => x.name !== name), { ...cfg, name }]; setSaved(next); storeSaved(next); set({ name })
  }
  function remove(name: string) { const next = saved.filter(x => x.name !== name); setSaved(next); storeSaved(next) }
  const toggle = <T,>(l: T[], v: T) => l.includes(v) ? l.filter(x => x !== v) : [...l, v]
  const sm = s.data; const sum = (m: Record<string, number>, f: (k: string) => boolean = () => true) => Object.entries(m).filter(([k]) => f(k)).reduce((a, [, v]) => a + v, 0)
  const max = Math.max(1, ...pivot.rl.map(x => x.n))

  type MRow = { label: string; n: number }
  return <>
    {sm && <div className="net-kpis rq-kpis">
      <div className="nk"><span className="nk-i b"><Icon name="form" size={20} /></span><b>{sum(sm.mine)}</b><small>আমি পাঠিয়েছি</small></div>
      <div className="nk"><span className="nk-i g"><Icon name="check" size={20} /></span><b>{sum(sm.mine, k => k.endsWith(':done'))}</b><small>আমার — সম্পন্ন</small></div>
      {can('hr.request.approve') && <div className="nk"><span className="nk-i o"><Icon name="clock" size={20} /></span><b>{sm.open}</b><small>অপেক্ষমাণ (আমার এলাকা)</small></div>}
      {can('hr.request.approve') && <div className="nk"><span className="nk-i p"><Icon name="shield" size={20} /></span><b>{sum(sm.decided)}</b><small>আমি সিদ্ধান্ত দিয়েছি</small></div>}
      <div className="nk"><span className="nk-i r"><Icon name="users" size={20} /></span><b>{sm.as_ref}</b><small>আমি রেফারেন্স</small></div>
    </div>}

    <section className="panel rp-panel">
      <div className="rp-presets" role="tablist" aria-label="রিপোর্ট">
        {[...PRESETS, ...saved].map(p => <span key={p.name} className={`rp-chip${cfg.name === p.name ? ' on' : ''}`}>
          <button type="button" onClick={() => setCfg({ ...p })}>{p.name}</button>
          {saved.some(x => x.name === p.name) && <button type="button" className="rp-x" aria-label={`${p.name} মুছুন`} onClick={() => remove(p.name)}><Icon name="x" size={12} /></button>}</span>)}
      </div>
      <div className="rp-quick">
        <div className="rp-seg">{(Object.keys(RANGES) as Range[]).map(k => <button key={k} type="button" className={cfg.range === k ? 'on' : ''} onClick={() => set({ range: k })}>{RANGES[k]}</button>)}</div>
        <div className="rp-seg">{(Object.keys(VIEWS) as View[]).map(k => <button key={k} type="button" className={cfg.view === k ? 'on' : ''} onClick={() => set({ view: k })}><Icon name={VIEWS[k][1]} size={14} />{VIEWS[k][0]}</button>)}</div>
        <button type="button" className={`secondary sm${edit ? ' on' : ''}`} onClick={() => setEdit(x => !x)}><Icon name="gear" size={14} />সাজান</button>
        <button type="button" className="sm" onClick={saveAs}><Icon name="save" size={14} />সেভ</button>
      </div>
      {cfg.range === 'custom' && <div className="rp-dates"><Field label="থেকে"><input type="date" value={cfg.from} max={today()} onChange={e => set({ from: e.target.value })} /></Field>
        <Field label="পর্যন্ত"><input type="date" value={cfg.to} max={today()} onChange={e => set({ to: e.target.value })} /></Field></div>}
      {edit && <div className="rp-edit">
        <div className="hr-form rq-form">
          <Field label="সারিতে (কী অনুযায়ী ভাগ)"><select value={cfg.rows} onChange={e => set({ rows: e.target.value as Dim })}>{(Object.keys(DIMS) as Dim[]).map(k => <option key={k} value={k}>{DIMS[k]}</option>)}</select></Field>
          <Field label="কলামে"><select value={cfg.cols} onChange={e => set({ cols: e.target.value as Dim | 'none' })}><option value="none">শুধু মোট</option>
            {(Object.keys(DIMS) as Dim[]).filter(k => k !== cfg.rows).map(k => <option key={k} value={k}>{DIMS[k]}</option>)}</select></Field>
          <Field label="হাব"><Combo value={cfg.hub} onChange={v => set({ hub: v })} placeholder="সব হাব" options={(o.data?.hubs ?? []).map(h => ({ value: h.id, label: h.name }))} /></Field>
        </div>
        <div className="rp-row"><span className="muted small">ধরন:</span>{(Object.keys(KINDS) as ReqKind[]).map(k => <label key={k} className={`chip-toggle${cfg.kinds.includes(k) ? ' on' : ''}`}>
          <input type="checkbox" checked={cfg.kinds.includes(k)} onChange={() => set({ kinds: toggle(cfg.kinds, k) })} /><Icon name={KINDS[k].icon} size={13} />{KINDS[k].bn}</label>)}</div>
        <div className="rp-row"><span className="muted small">অবস্থা:</span>{(Object.keys(STATUS) as ReqStatus[]).map(k => <label key={k} className={`chip-toggle${cfg.statuses.includes(k) ? ' on' : ''}`}>
          <input type="checkbox" checked={cfg.statuses.includes(k)} onChange={() => set({ statuses: toggle(cfg.statuses, k) })} />{STATUS[k].bn}</label>)}</div>
        {cfg.view === 'list' && <div className="rp-row"><span className="muted small">কলাম:</span>{Object.entries(fieldOpts).map(([k, l]) => <label key={k} className={`chip-toggle${cfg.fields.includes(k) ? ' on' : ''}`}>
          <input type="checkbox" checked={cfg.fields.includes(k)} onChange={() => set({ fields: toggle(cfg.fields, k) })} />{l}</label>)}</div>}
        <p className="muted small">যেভাবে খুশি সাজান, তারপর "সেভ" — উপরের তালিকায় নিজের নামে থেকে যাবে (এই ফোন/কম্পিউটারে)। নিচের টেবিল থেকে এক্সেল, পিডিএফ বা প্রিন্ট।</p>
      </div>}
    </section>

    {q.error ? <p className="da-error">{hrFriendly(q.error)}</p> : !d ? <p className="muted">লোড হচ্ছে…</p> : <section className="panel">
      <div className="da-bar"><h2>{cfg.name} <span className="count-pill">{rows.length}</span></h2>
        <span className="muted small">{from ? `${from}${to && to !== from ? ` → ${to}` : ''}` : RANGES.all}{cfg.hub ? ` · ${o.names.hub[cfg.hub] ?? ''}` : ''}</span></div>
      {!rows.length ? <p className="muted">এই বাছাইয়ে কোনো রিকুয়েস্ট নেই।</p>
        : cfg.view === 'list' ? <DataTable<HrRequest> title={title} file="hr-request-report" prefKey="hr-request-report-list" rows={rows} rowKey={r => r.id}
            cols={(cfg.fields.length ? cfg.fields : DEF_FIELDS).filter(k => fieldOpts[k]).map(k => ({ key: k, label: fieldOpts[k], value: (r: HrRequest) => cellText(r, k),
              ...(k === 'status' ? { render: (r: HrRequest) => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].bn}</Badge> } : {}) }))} />
        : cfg.view === 'bar' ? <div className="rp-bars">
            {cfg.cols !== 'none' && <div className="rp-legend">{pivot.cl.map((c, i) => <span key={c}><i style={{ background: BAR_TONE[i % BAR_TONE.length] }} />{c} <b>{pivot.colTotal(c)}</b></span>)}</div>}
            {pivot.rl.map(x => <div key={x.label} className="rp-bar"><span className="rp-bar-l" title={x.label}>{x.label}</span>
              <span className="rp-bar-t" style={{ width: `${Math.max(4, x.n / max * 100)}%` }}>{pivot.cl.map((c, i) => { const v = pivot.at(x.label, c)
                return v ? <i key={c} title={`${c}: ${v}`} style={{ flex: v, background: cfg.cols === 'none' ? 'var(--primary)' : BAR_TONE[i % BAR_TONE.length] }} /> : null })}</span>
              <b className="rp-bar-v">{x.n}</b></div>)}
          </div>
        : <DataTable<MRow> title={title} file="hr-request-report" prefKey="hr-request-report-matrix" views={['table', 'card']} search={false}
            rows={[...pivot.rl.map(x => ({ label: x.label, n: x.n })), { label: 'মোট', n: rows.length }]} rowKey={r => r.label}
            cols={[{ key: 'label', label: DIMS[cfg.rows], value: r => r.label, render: r => r.label === 'মোট' ? <b>মোট</b> : r.label },
              ...(cfg.cols === 'none' ? [] : pivot.cl.map(c => ({ key: 'c:' + c, label: c, className: 'r', value: (r: MRow) => r.label === 'মোট' ? pivot.colTotal(c) : pivot.at(r.label, c) }))),
              { key: 'n', label: 'মোট', className: 'r', value: r => r.n, render: r => <b>{r.n}</b> }]} />}
    </section>}
  </>
}

// ------------------------------------------------------------------ settings: formats
function Settings() {
  const f = useLoad(() => hrReq.formats(true), [])
  const { toast, node } = useToast()
  const [edit, setEdit] = useState<{ row: Partial<ReqFormat>; isNew: boolean } | null>(null)
  const [arch, setArch] = useState<ReqFormat | null>(null)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [showArch, setShowArch] = useState(false)
  const list = (f.data ?? []).filter(x => showArch || !x.archived_at)

  async function save() {
    if (!edit) return
    const r = edit.row; setErr('')
    const fields = (r.fields ?? []).filter(x => x.label.trim()).map(x => ({ ...x, label: x.label.trim(),
      options: x.type === 'select' ? (x.options ?? []).map(o => o.trim()).filter(Boolean) : undefined, prefill: x.prefill || undefined }))
    if (!String(r.name ?? '').trim()) { setErr('রিপোর্ট / ফরম্যাটের নাম দিন'); return }
    if (!fields.length) { setErr('অন্তত একটি ঘর যোগ করুন'); return }
    if (fields.some(x => x.type === 'select' && !x.options?.length)) { setErr('বাছাই তালিকার ঘরে অপশন দিন'); return }
    setBusy(true)
    try {
      const row: Partial<ReqFormat> = { name: String(r.name).trim(), name_bn: r.name_bn?.trim() || null, description: r.description?.trim() || null, kind: r.kind ?? 'custom',
        needs_employee: !!r.needs_employee, self_service: !!r.self_service, sort_order: Number(r.sort_order ?? 100), fields }
      if (edit.isNew) await hrReq.saveFormat({ ...row, code: `${String(r.name).replace(/[^A-Za-z0-9]+/g, '_').toUpperCase().slice(0, 20) || 'REPORT'}_${Date.now().toString(36).toUpperCase()}` })
      else await hrReq.saveFormat(row, r.id)
      toast('ফরম্যাট সেভ হয়েছে'); setEdit(null); await f.reload()
    } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  const setFields = (fs: ReqField[]) => edit && setEdit({ ...edit, row: { ...edit.row, fields: fs } })
  const fs = edit?.row.fields ?? []

  return <section className="panel">
    {node}
    <div className="da-bar"><strong>ফরম্যাট ও রিপোর্টের নাম</strong>
      <div className="row"><label className={`chip-toggle${showArch ? ' on' : ''}`}><input type="checkbox" checked={showArch} onChange={e => setShowArch(e.target.checked)} /> আর্কাইভ</label>
        <button className="sm" onClick={() => { setErr(''); setEdit({ isNew: true, row: { kind: 'custom', needs_employee: true, self_service: false, sort_order: 100, fields: [{ key: 'details', label: 'বিস্তারিত', type: 'textarea', required: true }] } }) }}>
          <Icon name="plus" size={14} />নতুন রিপোর্ট</button></div></div>
    {f.error ? <p className="da-error">{hrFriendly(f.error)}</p> : null}
    <div className="rq-fmt-list">{list.map(x => <div key={x.id} className={`rq-fmt-row${x.archived_at ? ' off' : ''}`}>
      <KindTag kind={x.kind} />
      <div style={{ flex: 1, minWidth: 0 }}><b>{fmtName(x)}</b> <span className="muted small">· {x.name}</span>
        <div className="muted small">{x.fields.length}টি ঘর{x.self_service ? ' · স্টাফ নিজে পাঠাতে পারবে' : ''}{x.needs_employee ? ' · স্টাফ বাছাই লাগবে' : ' · নতুন লোক'}{x.archived_at ? ' · আর্কাইভ' : ''}</div></div>
      {!x.archived_at && <><button className="soft sm" onClick={() => { setErr(''); setEdit({ isNew: false, row: JSON.parse(JSON.stringify(x)) }) }}><Icon name="edit" size={14} />এডিট</button>
        <button className="danger sm" onClick={() => { setErr(''); setReason(''); setArch(x) }}>সরান</button></>}
    </div>)}</div>

    {edit && <Modal title={edit.isNew ? 'নতুন রিপোর্ট / ফরম্যাট' : 'ফরম্যাট এডিট'} wide onClose={() => setEdit(null)}
      actions={<><button className="secondary" onClick={() => setEdit(null)}>বাতিল</button><button disabled={busy} onClick={() => void save()}>সেভ</button></>}>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label="রিপোর্টের নাম"><input value={edit.row.name ?? ''} placeholder="যেমন: ID CREATE" onChange={e => setEdit({ ...edit, row: { ...edit.row, name: e.target.value } })} /></Field>
        <Field label="বাংলা নাম"><input value={edit.row.name_bn ?? ''} onChange={e => setEdit({ ...edit, row: { ...edit.row, name_bn: e.target.value } })} /></Field>
        <Field label="ধরন"><select value={edit.row.kind ?? 'custom'} onChange={e => setEdit({ ...edit, row: { ...edit.row, kind: e.target.value as ReqKind } })}>
          {(Object.keys(KINDS) as ReqKind[]).map(k => <option key={k} value={k}>{KINDS[k].bn}</option>)}</select></Field>
        <Field label="ক্রম"><input inputMode="numeric" value={String(edit.row.sort_order ?? 100)} onChange={e => setEdit({ ...edit, row: { ...edit.row, sort_order: Number(e.target.value) || 100 } })} /></Field>
        <Field label="বিবরণ" wide><input value={edit.row.description ?? ''} onChange={e => setEdit({ ...edit, row: { ...edit.row, description: e.target.value } })} /></Field>
      </div>
      <div className="rq-flags">
        <label className={`chip-toggle${edit.row.needs_employee ? ' on' : ''}`}><input type="checkbox" checked={!!edit.row.needs_employee} onChange={e => setEdit({ ...edit, row: { ...edit.row, needs_employee: e.target.checked } })} /> স্টাফ বাছাই লাগবে</label>
        <label className={`chip-toggle${edit.row.self_service ? ' on' : ''}`}><input type="checkbox" checked={!!edit.row.self_service} onChange={e => setEdit({ ...edit, row: { ...edit.row, self_service: e.target.checked } })} /> স্টাফ নিজের জন্য পাঠাতে পারবে</label>
      </div>
      <h3 className="rq-h3">ঘরগুলো ({fs.length})</h3>
      <div className="rq-fields">{fs.map((x, i) => <div key={i} className="rq-field">
        <div className="rq-field-top"><span className="rq-step sm">{i + 1}</span>
          <input value={x.label} placeholder="ঘরের নাম" onChange={e => setFields(fs.map((y, j) => j === i ? { ...y, label: e.target.value, key: y.key || slugKey(e.target.value, fs.map(z => z.key)) } : y))} />
          <button type="button" className="icon-btn" aria-label="উপরে" disabled={i === 0} onClick={() => { const n = [...fs]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setFields(n) }}>↑</button>
          <button type="button" className="icon-btn" aria-label="নিচে" disabled={i === fs.length - 1} onClick={() => { const n = [...fs]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; setFields(n) }}>↓</button>
          <button type="button" className="icon-btn" aria-label="মুছুন" onClick={() => setFields(fs.filter((_, j) => j !== i))}><Icon name="trash" size={16} /></button></div>
        <div className="rq-field-opts">
          <select value={x.type} onChange={e => setFields(fs.map((y, j) => j === i ? { ...y, type: e.target.value as FieldType } : y))}>
            {(Object.keys(FIELD_TYPES) as FieldType[]).map(t => <option key={t} value={t}>{FIELD_TYPES[t]}</option>)}</select>
          {edit.row.needs_employee && <select value={x.prefill ?? ''} onChange={e => setFields(fs.map((y, j) => j === i ? { ...y, prefill: e.target.value || undefined } : y))}>
            <option value="">আগের তথ্য: নেই</option>{Object.entries(PREFILL).map(([k, l]) => <option key={k} value={k}>আগের তথ্য: {l}</option>)}</select>}
          <label className={`chip-toggle${x.required ? ' on' : ''}`}><input type="checkbox" checked={!!x.required} onChange={e => setFields(fs.map((y, j) => j === i ? { ...y, required: e.target.checked } : y))} /> আবশ্যক</label>
        </div>
        {x.type === 'select' && <input value={(x.options ?? []).join(', ')} placeholder="অপশন — কমা দিয়ে আলাদা করুন" onChange={e => setFields(fs.map((y, j) => j === i ? { ...y, options: e.target.value.split(',') } : y))} />}
      </div>)}</div>
      <button type="button" className="soft" onClick={() => setFields([...fs, { key: '', label: '', type: 'text' }])}><Icon name="plus" size={14} />ঘর যোগ করুন</button>
      {err && <p className="da-error">{err}</p>}
    </Modal>}

    {arch && <Modal title="ফরম্যাট সরাবেন?" onClose={() => setArch(null)}
      actions={<><button className="secondary" onClick={() => setArch(null)}>বাতিল</button>
        <button className="danger" disabled={busy || !reason.trim()} onClick={() => { setBusy(true); void hrReq.archiveFormat(arch.id, reason.trim()).then(async () => { toast('সরানো হয়েছে — আগের রিকুয়েস্ট থাকবে'); setArch(null); await f.reload() }).catch(e => setErr(errText(e))).finally(() => setBusy(false)) }}>সরান</button></>}>
      <p><b>{arch.name}</b> — নতুন রিকুয়েস্টে আর দেখাবে না। আগের রিকুয়েস্ট ও রিপোর্ট থাকবে।</p>
      <Field label="কারণ"><input value={reason} onChange={e => setReason(e.target.value)} /></Field>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </section>
}

