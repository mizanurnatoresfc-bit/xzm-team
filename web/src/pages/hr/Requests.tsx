import { useEffect, useMemo, useState } from 'react'
import { Combo } from '../../components/inputs'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell, refreshShellCounts } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { hr, hrFriendly } from '../../lib/hr'
import { FIELD_TYPES, KINDS, PREFILL, STATUS, hrReq, slugKey, type EmpRow, type FieldType, type HrRequest, type ReqField,
  type ReqFormat, type ReqKind, type ReqStatus } from '../../lib/hrreq'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'
import { NewApplication, useOrg } from './common'
import { PersonPicker, type RefPerson } from '../../components/PersonPicker'

type Tab = 'new' | 'list' | 'report' | 'settings'
const errText = (e: unknown) => (e instanceof Error && !('code' in e) ? e.message : hrFriendly(e))
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const when = (s: string) => new Date(s).toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

export function Requests() {
  const { can } = useAuth()
  const [sp, setSp] = useSearchParams()
  const canOthers = can('hr.request.create')
  const canDecide = can('hr.request.approve')
  const canConfig = can('hr.request.configure')
  const tab = (sp.get('tab') as Tab) || (sp.get('id') ? 'list' : 'new')
  const setTab = (t: Tab) => { const n = new URLSearchParams(sp); n.set('tab', t); n.delete('id'); setSp(n, { replace: true }) }
  const tabs: Array<[Tab, string, string]> = [['new', 'নতুন রিকুয়েস্ট', 'plus'], ['list', canDecide ? 'অনুমোদন প্যানেল' : 'আমার রিকুয়েস্ট', 'check'],
    ['report', 'রিপোর্ট', 'chart'], ...(canConfig ? [['settings', 'ফরম্যাট সেটিং', 'gear'] as [Tab, string, string]] : [])]
  return <AppShell title="HR ও অপারেশন রিকুয়েস্ট" subtitle={canOthers ? 'হাব → স্টাফ → ফরম্যাট বাছুন; আগের তথ্য নিজে বসে যায়' : 'নিজের আইডি চালু বা চাকরি ছাড়ার রিকুয়েস্ট পাঠান'}>
    <div className="rq-tabs">{tabs.map(([k, l, ic]) => <button key={k} type="button" className={`rq-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}><Icon name={ic} size={16} />{l}</button>)}</div>
    {tab === 'new' && <NewRequest onDone={id => { const n = new URLSearchParams(); n.set('tab', 'list'); n.set('id', id); setSp(n) }} />}
    {tab === 'list' && <RequestList openId={sp.get('id')} onOpen={id => { const n = new URLSearchParams(sp); if (id) n.set('id', id); else n.delete('id'); setSp(n, { replace: true }) }} />}
    {tab === 'report' && <Report />}
    {tab === 'settings' && canConfig && <Settings />}
  </AppShell>
}

// ------------------------------------------------------------------ new request
function NewRequest({ onDone }: { onDone: (id: string) => void }) {
  const { can } = useAuth()
  const canOthers = can('hr.request.create')
  const o = useOrg()
  const base = useLoad(async () => ({ formats: await hrReq.formats(), me: await hrReq.myEmployee().catch(() => null) }), [])
  const [hub, setHub] = useState('')
  const [emp, setEmp] = useState<EmpRow | null>(null)
  const [fmtId, setFmtId] = useState('')
  const [data, setData] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [ref, setRef] = useState<RefPerson | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const me = base.data?.me ?? null
  const formats = (base.data?.formats ?? []).filter(f => canOthers || f.self_service)
  const fmt = formats.find(f => f.id === fmtId) ?? null
  const staff = useLoad(() => (canOthers && hub ? hrReq.hubStaff(hub) : Promise.resolve([] as EmpRow[])), [hub, canOthers])

  // Staff without "create" rights can only act for themselves.
  useEffect(() => { if (!canOthers && me) { setEmp(me); setHub(me.hub_id ?? '') } }, [canOthers, me])
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
  // Fill earlier data whenever the person or the format changes.
  useEffect(() => {
    if (!fmt) return
    const d: Record<string, string> = {}
    for (const f of fmt.fields) d[f.key] = f.prefill ? prefillOf(f.prefill, emp) : (data[f.key] ?? '')
    setData(d)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fmtId, emp?.id, o.data])

  async function submit() {
    if (!fmt) return
    setErr('')
    if (fmt.needs_employee && !emp) { setErr('স্টাফ বেছে নিন'); return }
    if (!fmt.needs_employee && !hub) { setErr('হাব বেছে নিন'); return }
    for (const f of fmt.fields) if (f.required && !String(data[f.key] ?? '').trim()) { setErr(`"${f.label}" ঘরটি পূরণ করুন`); return }
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
  if (!canOthers && !me) return <section className="panel"><p className="notice">আপনার লগইনের সাথে কোনো কর্মী প্রোফাইল যুক্ত নেই। HR-কে বলুন।</p></section>

  return <div className="rq-new">
    <section className="panel">
      <h2 className="rq-h"><span className="rq-step">১</span>{canOthers ? 'হাব ও স্টাফ' : 'আমি'}</h2>
      {canOthers ? <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label="হাব"><Combo value={hub} onChange={v => { setHub(v); setEmp(null) }} options={(o.data?.hubs ?? []).map(h => ({ value: h.id, label: h.name }))} /></Field>
        <Field label="স্টাফ" hint={fmt && !fmt.needs_employee ? 'নতুন আইডির জন্য স্টাফ লাগবে না' : undefined}>
          <Combo value={emp?.id ?? ''} disabled={!hub || (fmt ? !fmt.needs_employee : false)}
            onChange={v => setEmp(v === me?.id ? me : staff.data?.find(x => x.id === v) ?? null)}
            placeholder={hub ? (staff.loading ? 'লোড হচ্ছে…' : 'নাম, আইডি বা মোবাইল লিখে খুঁজুন…') : 'আগে হাব বাছুন'}
            options={[...(me && me.hub_id === hub ? [{ value: me.id, label: `★ আমি — ${me.full_name}`, sub: me.employee_code ? `#${me.employee_code}` : '' }] : []),
              ...(staff.data ?? []).filter(x => x.id !== me?.id).map(x => ({ value: x.id, label: x.full_name, keywords: x.mobile ?? '',
                sub: [x.employee_code && `#${x.employee_code}`, posName(x.position_id), x.status !== 'active' ? x.status : ''].filter(Boolean).join(' · ') }))]} /></Field>
      </div> : me && <div className="rq-me"><span className="rq-av">{me.full_name.slice(0, 1)}</span><div><b>{me.full_name}</b>
        <div className="muted small">{me.employee_code ? `আইডি ${me.employee_code} · ` : ''}{hubName(me.hub_id)} · {posName(me.position_id)}</div></div></div>}
    </section>

    <section className="panel">
      <h2 className="rq-h"><span className="rq-step">২</span>ফরম্যাট</h2>
      <div className="rq-formats">{formats.map(f => <button key={f.id} type="button" className={`rq-fmt t-${KINDS[f.kind]?.tone ?? 'o'}${fmtId === f.id ? ' on' : ''}`} onClick={() => setFmtId(f.id)}>
        <span className="qi"><Icon name={KINDS[f.kind]?.icon ?? 'form'} size={20} /></span><b>{f.name}</b><small>{f.name_bn || f.description}</small></button>)}</div>
      {!formats.length && <p className="muted">কোনো ফরম্যাট নেই।</p>}
    </section>

    {fmt && <section className="panel">
      <h2 className="rq-h"><span className="rq-step">৩</span>{fmt.name} — তথ্য</h2>
      {fmt.needs_employee && !emp ? <p className="notice">আগে স্টাফ বেছে নিন — তার আগের তথ্য নিজে বসে যাবে।</p> :
        <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {fmt.fields.map(f => <FieldInput key={f.key} f={f} value={data[f.key] ?? ''} locked={!!f.prefill && !!prefillOf(f.prefill, emp)}
            hubs={o.data?.hubs ?? []} positions={o.data?.positions ?? []} onChange={v => setData(d => ({ ...d, [f.key]: v }))} />)}
          <Field label="নোট (ঐচ্ছিক)" wide><textarea rows={2} value={note} onChange={e => setNote(e.target.value)} /></Field>
        </div>}
    </section>}

    {fmt && <section className="panel">
      <h2 className="rq-h"><span className="rq-step">৪</span>রেফারেন্স <span className="muted small">(ঐচ্ছিক — তাকে নোটিফিকেশন যাবে)</span></h2>
      <PersonPicker value={ref} onChange={setRef} exclude={emp?.id} />
    </section>}

    {fmt && <div className="rq-submit">
      {err && <p className="da-error">{err}</p>}
      <button disabled={busy || (fmt.needs_employee && !emp)} onClick={() => void submit()}><Icon name="check" size={18} />{busy ? 'পাঠানো হচ্ছে…' : 'সাবমিট করুন'}</button>
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
            { key: 'fmt', label: 'ধরন', value: r => fmtById[r.format_id]?.name ?? r.kind, render: r => <span className={`rq-kind-tag t-${KINDS[r.kind]?.tone ?? 'o'}`}>{fmtById[r.format_id]?.name ?? r.kind}</span> },
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
    const why = `${r.request_no}: ${r.data.reason || r.data.reason_type || format?.name || ''}`.trim()
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

  return <Modal title={`${r.request_no} · ${format?.name ?? ''}`} wide onClose={onClose}
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

// ------------------------------------------------------------------ report
function Report() {
  const { can } = useAuth()
  const s = useLoad(() => hrReq.summary(), [])
  const [scope, setScope] = useState<'mine' | 'decided' | 'all'>('mine')
  if (s.error) return <p className="da-error">{hrFriendly(s.error)}</p>
  const d = s.data
  if (!d) return <p className="muted">লোড হচ্ছে…</p>
  const sum = (m: Record<string, number>, f: (k: string) => boolean = () => true) => Object.entries(m).filter(([k]) => f(k)).reduce((a, [, v]) => a + v, 0)
  const m = d[scope]
  const cols: ReqStatus[] = ['submitted', 'processing', 'done', 'rejected', 'cancelled']
  return <>
    <div className="net-kpis rq-kpis">
      <div className="nk"><span className="nk-i b"><Icon name="form" size={20} /></span><b>{sum(d.mine)}</b><small>আমি পাঠিয়েছি</small></div>
      <div className="nk"><span className="nk-i g"><Icon name="check" size={20} /></span><b>{sum(d.mine, k => k.endsWith(':done'))}</b><small>আমার — সম্পন্ন</small></div>
      {can('hr.request.approve') && <div className="nk"><span className="nk-i o"><Icon name="clock" size={20} /></span><b>{d.open}</b><small>অপেক্ষমাণ (আমার এলাকা)</small></div>}
      {can('hr.request.approve') && <div className="nk"><span className="nk-i p"><Icon name="shield" size={20} /></span><b>{sum(d.decided)}</b><small>আমি সিদ্ধান্ত দিয়েছি</small></div>}
      <div className="nk"><span className="nk-i r"><Icon name="users" size={20} /></span><b>{d.as_ref}</b><small>আমি রেফারেন্স</small></div>
    </div>
    <section className="panel">
      <div className="da-bar"><strong>ধরন অনুযায়ী হিসাব</strong>
        <div className="seg">{([['mine', 'আমি পাঠিয়েছি'], ...(can('hr.request.approve') ? [['decided', 'আমার সিদ্ধান্ত'], ['all', 'সব']] : [])] as Array<[typeof scope, string]>).map(([k, l]) =>
          <button key={k} type="button" className={scope === k ? 'on' : ''} onClick={() => setScope(k)}>{l}</button>)}</div></div>
      <div className="da-table-wrap rq-matrix-wrap"><table className="da-table rq-matrix"><thead><tr><th>ধরন</th>{cols.map(c => <th key={c} className="r">{STATUS[c].bn}</th>)}<th className="r">মোট</th></tr></thead>
        <tbody>{(Object.keys(KINDS) as ReqKind[]).map(k => <tr key={k}><td><span className={`rq-kind-tag t-${KINDS[k].tone}`}>{KINDS[k].bn}</span></td>
          {cols.map(c => <td key={c} className="r">{m[`${k}:${c}`] ?? 0}</td>)}<td className="r"><b>{sum(m, x => x.startsWith(k + ':'))}</b></td></tr>)}</tbody>
        <tfoot><tr><th>মোট</th>{cols.map(c => <th key={c} className="r">{sum(m, x => x.endsWith(':' + c))}</th>)}<th className="r">{sum(m)}</th></tr></tfoot></table></div>
    </section>
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
      <span className={`rq-kind-tag t-${KINDS[x.kind]?.tone ?? 'o'}`}>{KINDS[x.kind]?.bn ?? x.kind}</span>
      <div style={{ flex: 1, minWidth: 0 }}><b>{x.name}</b>{x.name_bn && <span className="muted"> · {x.name_bn}</span>}
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

