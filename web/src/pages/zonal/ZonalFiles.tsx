import { useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { Badge, Field, Stat, useLoad, useToast } from '../accounts/ui'
import { hr, hrFriendly } from '../../lib/hr'
import { hrReq, STATUS, type EmpRow, type ReqFormat } from '../../lib/hrreq'
import { EMP_ST_BN, REG_KIND, manpower, type RegisterRow } from '../../lib/manpower'
import { download, xlsxBlob } from '../../lib/xlsx'
import { Combo } from '../../components/inputs'
import { useOrg } from '../hr/common'

const dhaka = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const monthStart = () => dhaka().slice(0, 8) + '01'
type MarkKind = 'id_transfer' | 'id_active' | 'id_inactive'
const MARK: Record<MarkKind, { label: string; pick: (e: EmpRow) => boolean; hint: string }> = {
  id_transfer: { label: 'বদলি', pick: e => e.status === 'active', hint: 'সক্রিয় কর্মী' },
  id_active: { label: 'আইডি চালু (ইনএকটিভ → একটিভ)', pick: e => ['inactive', 'resigned', 'terminated'].includes(e.status), hint: 'বন্ধ থাকা কর্মী' },
  id_inactive: { label: 'আইডি বন্ধ / বাদ', pick: e => e.status === 'active' || e.status === 'inactive', hint: 'চালু কর্মী' },
}
const INACTIVE_TYPES = ['চাকরি ছেড়ে দিচ্ছি', 'আইডি সাময়িক বন্ধ', 'অফিস থেকে বাদ', 'অন্য কারণ']

/** Zonal file centre: mark many staff for transfer / active / inactive, then export every change in the company's Excel layout. */
export function ZonalFiles() {
  const [tab, setTab] = useState<'mark' | 'file'>('mark')
  const { toast, node } = useToast()
  return <AppShell title="জোনাল ফাইল — বদলি, চালু, বন্ধ" subtitle="অনেক কর্মীকে একসাথে বদলি / চালু / বন্ধের জন্য মার্ক করুন। সব পরিবর্তন (মার্ক করা ও সিস্টেমে করা) এক জায়গায় — কোম্পানির ফরম্যাটে Excel নিন।">
    {node}
    <nav className="emp-tabs no-print" role="tablist">
      <button role="tab" aria-selected={tab === 'mark'} className={tab === 'mark' ? 'on' : ''} onClick={() => setTab('mark')}><Icon name="checkall" size={16} />মার্ক করুন</button>
      <button role="tab" aria-selected={tab === 'file'} className={tab === 'file' ? 'on' : ''} onClick={() => setTab('file')}><Icon name="xls" size={16} />ফাইল ও Excel</button>
    </nav>
    {tab === 'mark' ? <Mark onDone={m => { toast(m); setTab('file') }} /> : <Files onToast={toast} />}
  </AppShell>
}

function Mark({ onDone }: { onDone: (m: string) => void }) {
  const o = useOrg()
  const formats = useLoad(() => hrReq.formats(), [])
  const [kind, setKind] = useState<MarkKind>('id_transfer')
  const [hub, setHub] = useState('')
  const [q, setQ] = useState('')
  const staff = useLoad(() => hub ? hrReq.hubStaff(hub) : Promise.resolve([] as EmpRow[]), [hub])
  const [picked, setPicked] = useState<Record<string, string>>({}) // employee -> to hub ('' = common)
  const [common, setCommon] = useState({ to: '', date: dhaka(), reason: '', type: INACTIVE_TYPES[0] })
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState('')
  const fmt: ReqFormat | undefined = formats.data?.find(f => f.kind === kind)
  const list = (staff.data ?? []).filter(MARK[kind].pick).filter(e => !q.trim() || `${e.full_name} ${e.employee_code ?? ''} ${e.mobile ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
  const ids = Object.keys(picked)
  const hubsOther = (o.data?.hubs ?? []).filter(h => h.id !== hub)
  const toggle = (id: string) => setPicked(p => { const n = { ...p }; if (id in n) delete n[id]; else n[id] = ''; return n })

  async function submit() {
    setErr('')
    if (!fmt) return setErr('এই ধরনের রিকুয়েস্ট ফরম্যাট পাওয়া যায়নি (HR রিকুয়েস্ট → সেটিং দেখুন)')
    if (!ids.length) return setErr('কাকে মার্ক করবেন বেছে নিন')
    if (!common.reason.trim()) return setErr('কারণ লিখুন')
    if (kind === 'id_transfer' && ids.some(id => !(picked[id] || common.to))) return setErr('নতুন হাব দিন (সবার জন্য বা প্রতিজনের পাশে)')
    setBusy(true)
    let ok = 0; const bad: string[] = []
    const people = (staff.data ?? []).filter(e => e.id in picked)
    for (const [i, e] of people.entries()) {
      setProgress(`${i + 1}/${people.length}`)
      const base: Record<string, string> = {
        employee_code: e.employee_code ?? '', full_name: e.full_name, mobile: e.mobile ?? '', hub: o.names.hub[hub] ?? '', from_hub: o.names.hub[hub] ?? '',
        position: e.position_id ? o.names.posEn[e.position_id] ?? '' : '', reason: common.reason.trim(),
      }
      if (kind === 'id_transfer') Object.assign(base, { to_hub: picked[e.id] || common.to, effective_date: common.date })
      if (kind === 'id_active') Object.assign(base, { effective_date: common.date })
      if (kind === 'id_inactive') Object.assign(base, { last_date: common.date, reason_type: common.type })
      try { await hrReq.submit({ format: fmt.id, employee: e.id, hub, data: base, note: common.reason.trim() }); ok++ }
      catch (x) { bad.push(`${e.full_name}: ${hrFriendly(x)}`) }
    }
    setBusy(false); setProgress('')
    if (bad.length) setErr(bad.join(' · '))
    if (ok) { setPicked({}); onDone(`${ok.toLocaleString('bn-BD')} জনকে মার্ক করা হয়েছে — "ফাইল ও Excel" থেকে কোম্পানির ফাইল নিন`) }
  }

  return <section className="panel">
    <div className="hr-form" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
      <Field label="কী করবেন"><select value={kind} onChange={e => { setKind(e.target.value as MarkKind); setPicked({}) }}>
        {(Object.keys(MARK) as MarkKind[]).map(k => <option key={k} value={k}>{MARK[k].label}</option>)}</select></Field>
      <Field label="কোন হাবের কর্মী"><Combo value={hub} onChange={v => { setHub(v); setPicked({}) }} options={(o.data?.hubs ?? []).map(h => ({ value: h.id, label: h.name }))} /></Field>
      {kind === 'id_transfer' && <Field label="নতুন হাব (সবার জন্য)" hint="কারো আলাদা হাব হলে তালিকায় তার পাশে দিন">
        <Combo value={common.to} onChange={v => setCommon({ ...common, to: v })} placeholder="—" options={hubsOther.map(h => ({ value: h.id, label: h.name }))} /></Field>}
      {kind === 'id_inactive' && <Field label="ধরন"><select value={common.type} onChange={e => setCommon({ ...common, type: e.target.value })}>{INACTIVE_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>}
      <Field label={kind === 'id_inactive' ? 'শেষ কর্মদিবস' : 'কবে থেকে'}><input type="date" value={common.date} onChange={e => setCommon({ ...common, date: e.target.value })} /></Field>
      <Field wide label="কারণ"><input value={common.reason} onChange={e => setCommon({ ...common, reason: e.target.value })} placeholder="যেমন: নতুন হাবে জনবল দরকার" /></Field>
    </div>
    {hub && <>
      <div className="da-bar" style={{ marginTop: 10 }}>
        <h2 style={{ margin: 0 }}>{o.names.hub[hub]} — {MARK[kind].hint} <span className="count-pill">{list.length.toLocaleString('bn-BD')}</span></h2>
        <span className="row-acts">
          <input placeholder="নাম / আইডি / মোবাইল" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 200 }} />
          <button className="secondary sm" onClick={() => setPicked(Object.fromEntries(list.map(e => [e.id, picked[e.id] ?? ''])))}>সব বাছুন</button>
          <button className="secondary sm" onClick={() => setPicked({})}>বাছাই মুছুন</button></span></div>
      {staff.loading ? <p className="muted">লোড হচ্ছে…</p> : !list.length ? <p className="muted">এই হাবে {MARK[kind].hint} নেই।</p>
        : <div className="da-table-wrap"><table className="da-table"><thead><tr><th>✓</th><th>আইডি</th><th>নাম</th><th>মোবাইল</th><th>পদবি</th><th>অবস্থা</th>{kind === 'id_transfer' && <th>আলাদা নতুন হাব</th>}</tr></thead>
          <tbody>{list.map(e => <tr key={e.id} className={e.id in picked ? 'sel' : ''} onClick={() => toggle(e.id)} style={{ cursor: 'pointer' }}>
            <td><input type="checkbox" style={{ width: 'auto' }} readOnly checked={e.id in picked} /></td>
            <td>{e.employee_code ?? <Badge tone="warn">নেই</Badge>}</td><td><b>{e.full_name}</b></td><td>{e.mobile ?? ''}</td>
            <td>{e.position_id ? o.names.pos[e.position_id] ?? '' : ''}</td><td>{EMP_ST_BN[e.status] ?? e.status}</td>
            {kind === 'id_transfer' && <td onClick={ev => ev.stopPropagation()}>{e.id in picked &&
              <select value={picked[e.id]} onChange={ev => setPicked({ ...picked, [e.id]: ev.target.value })}><option value="">{common.to ? `সবার মতো (${o.names.hub[common.to]})` : '—'}</option>
                {hubsOther.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select>}</td>}
          </tr>)}</tbody></table></div>}
      <div className="da-bar" style={{ marginTop: 10 }}>
        <span><b>{ids.length.toLocaleString('bn-BD')}</b> জন বাছাই করা {progress && <span className="muted"> · পাঠানো হচ্ছে {progress}</span>}</span>
        <button disabled={busy || !ids.length} onClick={() => void submit()}><Icon name="check" size={16} />মার্ক করে জমা দিন</button></div>
      <p className="muted small">মার্ক করলে প্রতিজনের জন্য একটা HR রিকুয়েস্ট হয় (তালিকায় থাকে, কর্মী ও রেফারেন্স নোটিফিকেশন পান)। আসল বদলি / চালু / বন্ধ হবে “ফাইল ও Excel” থেকে “সিস্টেমে প্রয়োগ” দিলে, অথবা কোম্পানি থেকে করার পর।</p>
    </>}
    {err && <p className="da-error">{err}</p>}
  </section>
}

type Group = 'all' | 'transfer' | 'status' | 'create'
const groupOf = (r: RegisterRow): Group => ['transfer', 'id_transfer', 'promotion', 'correction'].includes(r.kind) ? 'transfer' : r.kind === 'id_create' ? 'create' : 'status'

function Files({ onToast }: { onToast: (m: string) => void }) {
  const { can } = useAuth()
  const o = useOrg()
  const [zone, setZone] = useState('')
  const [from, setFrom] = useState(monthStart()); const [to, setTo] = useState(dhaka())
  const [group, setGroup] = useState<Group>('all')
  const [source, setSource] = useState<'' | 'request' | 'system'>('')
  const reg = useLoad(() => manpower.register(zone || null, from, to), [zone, from, to])
  const reqs = useLoad(() => hrReq.list(), [])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const key = (r: RegisterRow, i: number) => `${r.source}-${r.request_no ?? ''}-${r.employee_id ?? ''}-${r.recorded_at}-${i}`
  const rows = useMemo(() => (reg.data ?? []).map((r, i) => ({ ...r, _k: key(r, i) }))
    .filter(r => (group === 'all' || groupOf(r) === group) && (!source || r.source === source)), [reg.data, group, source])
  const chosen = sel.size ? rows.filter(r => sel.has(r._k)) : rows
  const all = reg.data ?? []
  const count = (g: Group) => all.filter(r => groupOf(r) === g).length

  function exportFile(g: Exclude<Group, 'all'>) {
    const data = chosen.filter(r => groupOf(r) === g)
    if (!data.length) return setErr('এই ধরনের কোনো সারি নেই (বাছাই বা ফিল্টার দেখুন)')
    setErr('')
    const remark = (r: RegisterRow) => [r.source === 'request' ? `মার্ক ${r.request_no ?? ''} · ${STATUS[r.request_status as keyof typeof STATUS]?.bn ?? r.request_status ?? ''}` : 'সিস্টেমে হয়েছে', r.done_by ? `— ${r.done_by}` : ''].join(' ').trim()
    const period = `${from} থেকে ${to}`
    if (g === 'transfer') download(xlsxBlob('Employee Transfer', period,
      ['SL', 'Employee ID', 'Name', 'Phone Number', 'Designation', 'Present Hub', 'Transfer Hub', 'Effective Date', 'Reason', 'Reference Name & ID', 'Remarks'],
      data.map((r, i) => [i + 1, r.employee_code, r.full_name, r.mobile, r.position_name, r.from_hub, r.to_hub, r.event_date, r.reason, r.reference, remark(r)])), `Transfer-${from}-${to}.xlsx`)
    if (g === 'status') download(xlsxBlob('ID Active / Inactive', period,
      ['SL', 'Employee ID', 'Name', 'Phone Number', 'Hub Name', 'Designation', 'Request', 'From Status', 'To Status', 'Effective Date', 'Reason', 'Remarks'],
      data.map((r, i) => [i + 1, r.employee_code, r.full_name, r.mobile, r.from_hub, r.position_name,
        r.kind === 'id_active' ? 'ID Active' : r.kind === 'id_inactive' ? 'ID Inactive' : (r.to_status === 'active' ? 'ID Active' : 'ID Inactive'),
        EMP_ST_BN[r.from_status ?? ''] ?? r.from_status, EMP_ST_BN[r.to_status ?? ''] ?? r.to_status, r.event_date, r.reason, remark(r)])), `Active-Inactive-${from}-${to}.xlsx`)
    if (g === 'create') download(xlsxBlob('New ID Create', period,
      ['SL', 'Name', 'Phone Number', 'Hub Name', 'Designation', 'Reference Name & ID', 'Date', 'Reason', 'Remarks'],
      data.map((r, i) => [i + 1, r.full_name, r.mobile, r.from_hub, r.position_name, r.reference, r.event_date, r.reason, remark(r)])), `ID-Create-${from}-${to}.xlsx`)
  }

  // Apply marked transfers / active / inactive in the system, then close the requests as done.
  async function applyMarked() {
    const marked = chosen.filter(r => r.source === 'request' && r.kind !== 'id_create' && ['submitted', 'processing'].includes(r.request_status ?? ''))
    if (!marked.length) return setErr('প্রয়োগ করার মতো মার্ক করা সারি নেই')
    if (!window.confirm(`${marked.length} জনের বদলি / চালু / বন্ধ সিস্টেমে প্রয়োগ করে সম্পন্ন করবেন?`)) return
    setBusy(true); setErr('')
    const byNo = Object.fromEntries((reqs.data ?? []).map(r => [r.request_no, r]))
    let ok = 0; const bad: string[] = []
    for (const m of marked) {
      const r = byNo[m.request_no ?? '']
      try {
        if (!r || !r.employee_id) throw new Error('রিকুয়েস্ট পাওয়া যায়নি')
        const emp = await hrReq.employee(r.employee_id)
        if (!emp) throw new Error('কর্মী পাওয়া যায়নি')
        const eff = r.data.effective_date || r.data.last_date || dhaka()
        const why = `${r.request_no}: ${r.data.reason || r.data.reason_type || ''}`.trim()
        if (r.kind === 'id_active') await hr.changeStatus(emp.id, 'active', eff, why)
        if (r.kind === 'id_inactive') { const t = r.data.reason_type ?? ''; await hr.changeStatus(emp.id, /ছেড়ে/.test(t) ? 'resigned' : /বাদ/.test(t) ? 'terminated' : 'inactive', eff, why) }
        if (r.kind === 'id_transfer') await hr.transfer(emp.id, { hub: r.data.to_hub, department: emp.department_id, position: emp.position_id, manager: emp.reporting_manager_id, effective: eff, reason: why, type: 'transfer' })
        await hrReq.update(r.id, 'done', 'সিস্টেমে প্রয়োগ করা হয়েছে')
        ok++
      } catch (x) { bad.push(`${m.full_name}: ${hrFriendly(x)}`) }
    }
    setBusy(false); setSel(new Set())
    if (bad.length) setErr(bad.join(' · '))
    if (ok) onToast(`${ok.toLocaleString('bn-BD')} জনের পরিবর্তন সিস্টেমে হয়েছে`)
    await reg.reload(); await reqs.reload()
  }

  return <>
    <div className="da-stats">
      <Stat icon="truck" label="বদলি" value={count('transfer').toLocaleString('bn-BD')} />
      <Stat icon="check" label="চালু / বন্ধ" value={count('status').toLocaleString('bn-BD')} />
      <Stat icon="plus" label="নতুন আইডি" value={count('create').toLocaleString('bn-BD')} />
      <Stat icon="clock" tone="warn" label="মার্ক করা, সম্পন্ন বাকি" value={all.filter(r => r.source === 'request' && ['submitted', 'processing'].includes(r.request_status ?? '')).length.toLocaleString('bn-BD')} />
    </div>
    <section className="da-filters panel no-print">
      {(o.data?.zones.length ?? 0) > 1 && <Field label="জোন"><select value={zone} onChange={e => setZone(e.target.value)}><option value="">সব</option>{o.data?.zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>}
      <Field label="থেকে"><input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></Field>
      <Field label="পর্যন্ত"><input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></Field>
      <Field label="ধরন"><select value={group} onChange={e => setGroup(e.target.value as Group)}><option value="all">সব</option><option value="transfer">বদলি</option><option value="status">চালু / বন্ধ</option><option value="create">নতুন আইডি</option></select></Field>
      <Field label="কোথা থেকে"><select value={source} onChange={e => setSource(e.target.value as typeof source)}><option value="">সব</option><option value="request">মার্ক করা</option><option value="system">সিস্টেমে করা</option></select></Field>
    </section>
    <section className="panel">
      <div className="da-bar"><h2 style={{ margin: 0 }}>সব পরিবর্তন <span className="count-pill">{rows.length.toLocaleString('bn-BD')}</span>{sel.size > 0 && <span className="muted small"> · {sel.size.toLocaleString('bn-BD')}টি বাছাই — ফাইলে শুধু এগুলো যাবে</span>}</h2>
        <span className="row-acts">
          <button className="secondary sm" onClick={() => exportFile('transfer')}><Icon name="xls" size={14} />বদলির ফাইল</button>
          <button className="secondary sm" onClick={() => exportFile('status')}><Icon name="xls" size={14} />চালু/বন্ধের ফাইল</button>
          <button className="secondary sm" onClick={() => exportFile('create')}><Icon name="xls" size={14} />নতুন আইডির ফাইল</button>
          {can('hr.request.approve') && <button className="sm" disabled={busy} onClick={() => void applyMarked()}><Icon name="check" size={14} />মার্ক করাগুলো সিস্টেমে প্রয়োগ</button>}
          {sel.size > 0 && <button className="secondary sm" onClick={() => setSel(new Set())}>বাছাই মুছুন</button>}</span></div>
      {err && <p className="da-error">{err}</p>}
      {reg.error ? <p className="da-error">{hrFriendly(reg.error)}</p> : null}
      <DataTable<RegisterRow & { _k: string }> title="কর্মীর পরিবর্তনের রেজিস্টার" file={`change-register-${from}-${to}`} rows={rows} rowKey={r => r._k}
        onRowClick={r => setSel(s => { const n = new Set(s); n.has(r._k) ? n.delete(r._k) : n.add(r._k); return n })}
        empty={<p className="muted">{reg.loading ? 'লোড হচ্ছে…' : 'এই সময়ে কোনো পরিবর্তন নেই।'}</p>}
        cols={[
          { key: 'pick', label: '✓', noExport: true, render: r => <input type="checkbox" style={{ width: 'auto' }} readOnly checked={sel.has(r._k)} /> },
          { key: 'date', label: 'তারিখ', value: r => r.event_date ?? '' },
          { key: 'kind', label: 'ধরন', value: r => REG_KIND[r.kind] ?? r.kind, render: r => <Badge tone={r.source === 'request' ? 'info' : 'neutral'}>{REG_KIND[r.kind] ?? r.kind}</Badge> },
          { key: 'code', label: 'আইডি', value: r => r.employee_code ?? '' },
          { key: 'name', label: 'নাম', primary: true, value: r => r.full_name ?? '' },
          { key: 'mobile', label: 'মোবাইল', value: r => r.mobile ?? '' },
          { key: 'pos', label: 'পদবি', value: r => r.position_name ?? '' },
          { key: 'from', label: 'হাব (আগে)', value: r => r.from_hub ?? '' },
          { key: 'to', label: 'নতুন হাব / অবস্থা', value: r => r.to_hub ?? (r.to_status ? `${EMP_ST_BN[r.from_status ?? ''] ?? r.from_status ?? ''} → ${EMP_ST_BN[r.to_status] ?? r.to_status}` : '') },
          { key: 'why', label: 'কারণ', value: r => r.reason ?? '' },
          { key: 'st', label: 'অবস্থা', value: r => r.source === 'request' ? (STATUS[r.request_status as keyof typeof STATUS]?.bn ?? '') : 'সিস্টেমে হয়েছে',
            render: r => r.source === 'request' ? <Badge tone={STATUS[r.request_status as keyof typeof STATUS]?.tone ?? 'neutral'}>{r.request_no} · {STATUS[r.request_status as keyof typeof STATUS]?.bn ?? r.request_status}</Badge> : <Badge tone="ok">সিস্টেমে হয়েছে</Badge> },
          { key: 'by', label: 'যিনি করেছেন', value: r => r.done_by ?? '' },
        ]} />
    </section>
  </>
}
