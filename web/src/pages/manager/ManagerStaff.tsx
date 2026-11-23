// Active staff of a hub, with the two things a hub manager does: "চাকরি ছেড়ে দিয়েছে" and "নতুন স্টাফ যোগ".
// Both only ask; the zonal manager decides on /app/zonal/requests. A person who decides requests (zonal manager)
// uses the same page for any hub of the zone and finishes an exit or a transfer in the same step.
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { Contact } from '../../components/Contact'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { Combo, TextInput } from '../../components/inputs'
import { RowMenu, type RowMenuItem } from '../../components/RowMenu'
import { customFields, staffAdmin } from '../../lib/staffAdmin'
import { dmy, hr, todayDhaka, type Employee } from '../../lib/hr'
import { LIFE, joinFields, lifeFriendly, lifecycle, pickJoinFormat, scopeHubs, type JoinField, type PendingReq } from '../../lib/lifecycle'
import { usePrefs } from '../../lib/prefs'
import { BD_MOBILE, cleanMobile, rules } from '../../lib/validate'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'
import { useOrg } from '../hr/common'

const HUB_KEY = 'xzm_manager_staff_hub'
type Act = null | { kind: 'leave' | 'transfer'; emp: Employee } | { kind: 'join' }

export function ManagerStaff() {
  const { grants, can } = useAuth()
  const { L, n } = usePrefs()
  const o = useOrg()
  const { toast, node } = useToast()
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') === 'pending' ? 'pending' : 'active'
  const decides = can('hr.request.approve')
  const hubs = useMemo(() => scopeHubs(grants, o.data?.hubs, 'hr.request.create'), [grants, o.data])
  const [picked, setPicked] = useState(() => { try { return localStorage.getItem(HUB_KEY) ?? '' } catch { return '' } })
  const hub = hubs.find(h => h.id === picked) ?? hubs[0] ?? null
  const choose = (id: string) => { setPicked(id); try { localStorage.setItem(HUB_KEY, id) } catch { /* private window */ } }
  const staff = useLoad(() => (hub ? hr.employees({ hub: hub.id, status: 'active', limit: 1000 }) : Promise.resolve([] as Employee[])), [hub?.id])
  const pending = useLoad(() => (hub ? lifecycle.pendingForHub(hub.id) : Promise.resolve([] as PendingReq[])), [hub?.id])
  const [act, setAct] = useState<Act>(null)
  const waiting = useMemo(() => new Set((pending.data ?? []).filter(p => p.kind === 'id_inactive' && p.employee_id).map(p => p.employee_id as string)), [pending.data])
  // Position -> head count for the summary card; a chip narrows the list below to that position.
  const [pos, setPos] = useState<string | null>(null)
  useEffect(() => setPos(null), [hub?.id])
  const byPos = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of staff.data ?? []) m.set(e.position_id ?? '', (m.get(e.position_id ?? '') ?? 0) + 1)
    return [...m].map(([id, count]) => ({ id, count, name: (id && o.names.pos[id]) || L('পদবি নেই', 'No position') }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [staff.data, o.names.pos, L])
  const shown = useMemo(() => (pos === null ? staff.data : (staff.data ?? []).filter(e => (e.position_id ?? '') === pos)), [staff.data, pos])
  const posName = pos === null ? '' : byPos.find(p => p.id === pos)?.name ?? ''
  const done = (m: string) => { setAct(null); toast(m); void staff.reload(); void pending.reload() }
  const canJoin = can('hr.application.create')

  const menu = (e: Employee): RowMenuItem[] => [
    { label: L('চাকরি ছেড়ে দিয়েছে', 'Left the job'), icon: 'userx', danger: true, disabled: waiting.has(e.id),
      hint: waiting.has(e.id) ? L('অনুরোধ অপেক্ষমাণ', 'Request waiting') : undefined, onClick: () => setAct({ kind: 'leave', emp: e }) },
    ...(decides ? [{ label: L('অন্য হাবে বদলি', 'Transfer to another hub'), icon: 'swap', onClick: () => setAct({ kind: 'transfer', emp: e }) }] : []),
  ]

  return <AppShell title={L('সক্রিয় স্টাফ', 'Active staff')}
    subtitle={decides ? L('যেকোনো হাবের সক্রিয় স্টাফ। এখান থেকে নতুন স্টাফ যোগ, চাকরি ছাড়া আর বদলি — সবই করা যায়।', 'Active staff of any hub: add, exit and transfer from here.')
      : L('আপনার হাবের সক্রিয় স্টাফ। কেউ চাকরি ছাড়লে বা নতুন কেউ এলে এখান থেকে জোনাল ম্যানেজারকে জানান।', 'Active staff of your hub. Tell the zonal manager here when someone leaves or joins.')}
    actions={<>{decides && <Link to="/app/zonal/requests" className="btn-ghost">{L('অনুরোধ ইনবক্স', 'Request inbox')}</Link>}
      {canJoin && hub && <button onClick={() => setAct({ kind: 'join' })}><Icon name="userplus" size={16} />{L('নতুন স্টাফ যোগ', 'Add new staff')}</button>}</>}>
    {node}
    {hubs.length > 1 && <section className="da-filters panel no-print">
      <Field label={L('হাব', 'Hub')}><Combo value={hub?.id ?? ''} onChange={v => v && choose(v)} clearable={false}
        options={hubs.map(h => ({ value: h.id, label: h.name, sub: o.names.zone[h.zone_id] }))} /></Field>
    </section>}
    {!o.loading && !hubs.length && <p className="notice">{L('আপনাকে কোনো হাবের দায়িত্ব দেওয়া হয়নি।', 'No hub is assigned to you.')}</p>}

    {hub && <>
      <section className="ms-sum" aria-label={L('হাবের সারাংশ', 'Hub summary')}>
        <div className="ms-hub"><span className="ms-ic"><Icon name="hub" size={20} /></span>
          <span className="ms-tx"><small>{L('হাব', 'Hub')}</small><b>{hub.name}</b></span></div>
        <div className="ms-nums">
          <button type="button" onClick={() => { setPos(null); setSp({}) }}><span className="v">{n(staff.data?.length ?? 0)}</span><span className="l">{L('সক্রিয় স্টাফ', 'Active staff')}</span></button>
          <button type="button" className={pending.data?.length ? 'warn' : ''} onClick={() => setSp({ tab: 'pending' })}><span className="v">{n(pending.data?.length ?? 0)}</span><span className="l">{L('অপেক্ষমাণ আবেদন', 'Waiting requests')}</span></button>
        </div>
        {!!byPos.length && <>
          <div className="ms-pos-h"><h2>{L('পদবি অনুযায়ী', 'By position')}</h2>
            {pos !== null ? <button type="button" className="ms-clear" onClick={() => setPos(null)}><Icon name="x" size={14} />{L('সব দেখান', 'Show all')}</button>
              : <span>{L(`${n(byPos.length)}টি পদবি`, `${byPos.length} positions`)}</span>}</div>
          <div className="ms-chips">{byPos.map(p => <button type="button" key={p.id} className="ms-chip" aria-pressed={pos === p.id}
            onClick={() => { setPos(pos === p.id ? null : p.id); setSp({}) }}>{p.name}<b>{n(p.count)}</b></button>)}</div>
        </>}
      </section>
      <nav className="emp-tabs no-print" role="tablist">
        <button role="tab" aria-selected={tab === 'active'} className={tab === 'active' ? 'on' : ''} onClick={() => setSp({})}><Icon name="users" size={16} />{L('সক্রিয় স্টাফ', 'Active staff')}</button>
        <button role="tab" aria-selected={tab === 'pending'} className={tab === 'pending' ? 'on' : ''} onClick={() => setSp({ tab: 'pending' })}><Icon name="clock" size={16} />
          {L('অপেক্ষমাণ আবেদন', 'Waiting requests')}{!!pending.data?.length && <span className="tab-count">{n(pending.data.length)}</span>}</button>
      </nav>
      {(staff.error || pending.error) ? <p className="da-error">{lifeFriendly(staff.error || pending.error)}</p> : null}

      {tab === 'active' && <section className="panel">
        <DataTable<Employee> title={`${hub.name} — ${posName || L('সক্রিয় স্টাফ', 'active staff')}`} file={`active-staff-${hub.name}`} prefKey="manager-staff" rows={shown} rowKey={e => e.id}
          empty={<p className="muted">{staff.loading ? L('লোড হচ্ছে…', 'Loading…') : L('এই হাবে কোনো সক্রিয় স্টাফ নেই।', 'No active staff in this hub.')}</p>}
          cols={[
            { key: 'code', label: L('আইডি', 'ID'), value: e => e.employee_code ?? '', render: e => <strong>{e.employee_code ?? '—'}</strong> },
            { key: 'name', label: L('নাম', 'Name'), primary: true, value: e => e.full_name,
              render: e => <>{e.full_name}{waiting.has(e.id) && <> <Badge tone="warn">{L('অপেক্ষমাণ', 'Waiting')}</Badge></>}</> },
            { key: 'mobile', label: L('মোবাইল', 'Mobile'), value: e => e.mobile ?? '', render: e => <Contact phone={e.mobile} /> },
            { key: 'pos', label: L('পদবি', 'Position'), value: e => (e.position_id ? o.names.pos[e.position_id] ?? '' : '') },
            { key: 'join', label: L('যোগদান', 'Joined'), value: e => dmy(e.joining_date) },
            { key: 'act', label: '', noExport: true, render: e => <RowMenu label={`${e.full_name} — ${L('কাজ', 'actions')}`} items={menu(e)} /> },
          ]} />
      </section>}

      {tab === 'pending' && <section className="panel">
        {!pending.data?.length ? <p className="muted">{pending.loading ? L('লোড হচ্ছে…', 'Loading…') : L('কোনো আবেদন অপেক্ষায় নেই।', 'Nothing is waiting.')}</p>
          : <div className="lc-list">{pending.data.map(p => <div key={p.id} className="lc-row">
            <span className={`rq-kind-tag t-${LIFE[p.kind].tone}`}><Icon name={LIFE[p.kind].icon} size={14} />{p.kind === 'id_create' ? L('নতুন স্টাফ', 'New staff') : L('চাকরি ছাড়া', 'Left the job')}</span>
            <span className="lc-main"><b>{p.data.full_name || '—'}{p.data.employee_code ? ` · ${p.data.employee_code}` : ''}</b>
              <small>{p.request_no} · {dmy(p.created_at)}{p.data.reason ? ` · ${p.data.reason}` : ''}</small></span>
            <Badge tone="warn">{L('জোনাল ম্যানেজারের অপেক্ষায়', 'Waiting for the zonal manager')}</Badge>
          </div>)}</div>}
      </section>}
    </>}

    {act?.kind === 'leave' && <LeaveModal emp={act.emp} decides={decides} onClose={() => setAct(null)} onDone={done} />}
    {act?.kind === 'transfer' && <TransferModal emp={act.emp} hubs={(o.data?.hubs ?? []).filter(h => h.id !== act.emp.hub_id).map(h => ({ value: h.id, label: h.name, sub: o.names.zone[h.zone_id] }))}
      onClose={() => setAct(null)} onDone={done} />}
    {act?.kind === 'join' && hub && <JoinModal hub={hub} decides={decides} onClose={() => setAct(null)} onDone={m => { done(m); setSp({ tab: 'pending' }) }} />}
  </AppShell>
}

function Who({ emp }: { emp: Employee }) {
  return <p className="lc-who"><Icon name="user" size={16} /><b>{emp.full_name}</b>{emp.employee_code && <span>· {emp.employee_code}</span>}{emp.mobile && <span>· {emp.mobile}</span>}</p>
}

function LeaveModal({ emp, decides, onClose, onDone }: { emp: Employee; decides: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const { L } = usePrefs()
  const [reason, setReason] = useState('')
  const [date, setDate] = useState(todayDhaka())
  const [type, setType] = useState<'resigned' | 'terminated'>('resigned')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function go() {
    setErr('')
    if (!reason.trim()) return setErr(L('কারণ লিখুন', 'Enter the reason'))
    setBusy(true)
    try {
      await lifecycle.leave(emp.id, reason.trim(), date, decides ? type : null)
      onDone(decides ? L(`${emp.full_name} — সম্পন্ন। এক্সিট ফাইল HR রেকর্ডে আছে।`, `${emp.full_name} — done. The exit file is in HR records.`)
        : L('অনুরোধ পাঠানো হয়েছে — জোনাল ম্যানেজারের অনুমোদনের অপেক্ষায়', 'Request sent — waiting for the zonal manager'))
    } catch (e) { setErr(lifeFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title={L('চাকরি ছেড়ে দিয়েছে', 'Left the job')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button>
      <button className={decides ? 'danger' : ''} disabled={busy} onClick={() => void go()}>{busy ? L('পাঠানো হচ্ছে…', 'Sending…') : decides ? L('নিশ্চিত করুন', 'Confirm') : L('অনুরোধ পাঠান', 'Send request')}</button></>}>
    <Who emp={emp} />
    <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
      {decides && <Field label={L('ধরন', 'Type')}><select value={type} onChange={e => setType(e.target.value as 'resigned' | 'terminated')}>
        <option value="resigned">{L('চাকরি ছেড়েছেন', 'Resigned')}</option><option value="terminated">{L('অব্যাহতি (অফিস থেকে বাদ)', 'Terminated')}</option></select></Field>}
      <Field label={L('শেষ কর্মদিবস', 'Last working day')}><input type="date" value={date} max={todayDhaka()} onChange={e => setDate(e.target.value)} /></Field>
      <Field wide required label={L('কারণ', 'Reason')}><textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder={L('যেমন: অন্য চাকরিতে যোগ দিয়েছেন', 'e.g. joined another job')} /></Field>
    </div>
    <p className="muted small">{decides ? L('নিশ্চিত করলে এখনই কার্যকর হবে: আইডি বন্ধ হবে, চূড়ান্ত হিসাবসহ এক্সিট ফাইল তৈরি হবে।', 'This takes effect now: the ID is closed and an exit file with final accounts is made.')
      : L('জোনাল ম্যানেজার অনুমোদন না করা পর্যন্ত নামটি তালিকায় “অপেক্ষমাণ” চিহ্নসহ থাকবে।', 'The name stays on the list, marked “waiting”, until the zonal manager approves.')}</p>
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}

function TransferModal({ emp, hubs, onClose, onDone }: { emp: Employee; hubs: Array<{ value: string; label: string; sub?: string }>; onClose: () => void; onDone: (m: string) => void }) {
  const { L } = usePrefs()
  const [to, setTo] = useState(''); const [date, setDate] = useState(todayDhaka()); const [reason, setReason] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function go() {
    setErr('')
    if (!to) return setErr(L('নতুন হাব বেছে নিন', 'Choose the new hub'))
    if (!reason.trim()) return setErr(L('কারণ লিখুন', 'Enter the reason'))
    setBusy(true)
    try {
      await lifecycle.transfer(emp.id, to, date, reason.trim())
      onDone(L(`${emp.full_name} → ${hubs.find(h => h.value === to)?.label ?? ''} বদলি হয়েছে। ট্রান্সফার ফাইল HR রেকর্ডে আছে।`, `${emp.full_name} transferred. The transfer file is in HR records.`))
    } catch (e) { setErr(lifeFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title={L('অন্য হাবে বদলি', 'Transfer to another hub')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void go()}>{busy ? L('হচ্ছে…', 'Working…') : L('বদলি নিশ্চিত করুন', 'Confirm transfer')}</button></>}>
    <Who emp={emp} />
    <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Field required label={L('নতুন হাব', 'New hub')}><Combo value={to} onChange={setTo} options={hubs} /></Field>
      <Field label={L('কবে থেকে', 'From')}><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field wide required label={L('কারণ', 'Reason')}><input value={reason} onChange={e => setReason(e.target.value)} placeholder={L('যেমন: নতুন হাবে রাইডার কম', 'e.g. the new hub is short of riders')} /></Field>
    </div>
    <p className="muted small">{L('পুরোনো হাবের দায়িত্ব বন্ধ হয়ে নতুন হাবে খুলবে, দুই হাবের ম্যানেজার নোটিফিকেশন পাবেন।', 'The old hub assignment closes, the new one opens, and both hub managers are notified.')}</p>
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}

function JoinModal({ hub, decides, onClose, onDone }: { hub: { id: string; name: string; zone_id: string }; decides: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const { L, lang } = usePrefs()
  const o = useOrg()
  const form = useLoad(async () => {
    const [formats, custom] = await Promise.all([staffAdmin.formats(), customFields()])
    const format = pickJoinFormat(formats, hub.zone_id)
    return { format, fields: joinFields(format, custom, lang) }
  }, [hub.zone_id, lang])
  const [v, setV] = useState<Record<string, string>>({ full_name: '', mobile: '', joining_date: todayDhaka() })
  const [position, setPosition] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [tried, setTried] = useState(false)
  const set = (k: string, x: string) => { setErr(''); setV(s => ({ ...s, [k]: x })) }
  // one post only: nothing to choose
  useEffect(() => { const p = o.data?.positions ?? []; if (!position && p.length === 1) setPosition(p[0].id) }, [o.data, position])

  async function go() {
    setErr(''); setTried(true)
    if (v.full_name.trim().length < 2) return setErr(L('পুরো নাম লিখুন', 'Enter the full name'))
    if (!BD_MOBILE.test(cleanMobile(v.mobile))) return setErr(L('সঠিক মোবাইল নম্বর দিন (যেমন 01711000000)', 'Enter a valid mobile number'))
    if (!position) return setErr(L('পদবি বেছে নিন', 'Choose the position'))
    const miss = (form.data?.fields ?? []).find(f => f.required && !(v[f.key] ?? '').trim())
    if (miss) return setErr(L(`“${miss.label}” ঘরটি পূরণ করুন`, `Fill in “${miss.label}”`))
    setBusy(true)
    try {
      const data: Record<string, string> = {}
      for (const [k, x] of Object.entries(v)) if (x.trim()) data[k] = k === 'mobile' || k === 'emergency_contact_phone' ? cleanMobile(x) : x.trim()
      await lifecycle.join(hub.id, position, data)
      onDone(decides ? L('আবেদন জমা হয়েছে — অন্য একজন অনুমোদন করবেন', 'Submitted — another person will approve it')
        : L('আবেদন পাঠানো হয়েছে — জোনাল ম্যানেজারের অনুমোদনের অপেক্ষায়', 'Sent — waiting for the zonal manager'))
    } catch (e) { setErr(lifeFriendly(e)) } finally { setBusy(false) }
  }
  const box = (f: JoinField) => f.type === 'select' ? <select value={v[f.key] ?? ''} onChange={e => set(f.key, e.target.value)}><option value="">—</option>
      {f.options?.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}</select>
    : f.type === 'textarea' ? <textarea rows={2} value={v[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} />
    : f.type === 'phone' ? <TextInput kind="phone" value={v[f.key] ?? ''} onChange={x => set(f.key, x)} placeholder="01XXXXXXXXX" rules={[rules.mobile()]} showError={tried} />
    : <input type={f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : 'text'} inputMode={f.type === 'number' ? 'decimal' : undefined} value={v[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} />

  return <Modal wide title={L('নতুন স্টাফ যোগ', 'Add new staff')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy || form.loading} onClick={() => void go()}>{busy ? L('পাঠানো হচ্ছে…', 'Sending…') : L('আবেদন পাঠান', 'Send request')}</button></>}>
    <p className="lc-who"><Icon name="hub" size={16} /><b>{hub.name}</b>{form.data?.format && <span>· {L('ফরম্যাট', 'Format')}: {lang === 'bn' && form.data.format.name_bn ? form.data.format.name_bn : form.data.format.name}</span>}</p>
    <div className="hr-form">
      <Field required label={L('পুরো নাম', 'Full name')}><input value={v.full_name} onChange={e => set('full_name', e.target.value)} placeholder="Md. Rahim Uddin" autoComplete="off" /></Field>
      <Field required label={L('মোবাইল', 'Mobile')}><TextInput kind="phone" value={v.mobile} onChange={x => set('mobile', x)} placeholder="01XXXXXXXXX" rules={[rules.required('মোবাইল নম্বর'), rules.mobile()]} showError={tried} /></Field>
      <Field required label={L('পদবি', 'Position')}><Combo value={position} onChange={setPosition}
        options={(o.data?.positions ?? []).map(p => ({ value: p.id, label: o.names.pos[p.id] ?? p.name, sub: o.names.dept[p.department_id] }))} /></Field>
      {(form.data?.fields ?? []).map(f => <Field key={f.key} label={f.label} required={f.required} wide={f.type === 'textarea'}>{box(f)}</Field>)}
    </div>
    {form.loading && <p className="muted small">{L('ফরম লোড হচ্ছে…', 'Loading the form…')}</p>}
    <p className="muted small">{decides ? L('দুই-জনের নিয়ম: আপনার পাঠানো আবেদন আপনি নিজে অনুমোদন করতে পারবেন না — অন্য একজন (এইচআর / অ্যাডমিন) অনুমোদন করবেন।', 'Two-person rule: you cannot approve your own request — HR or an admin will.')
      : L('জোনাল ম্যানেজার অনুমোদন করলে এমপ্লয়ি আইডি তৈরি হবে আর স্টাফ সক্রিয় তালিকায় আসবেন।', 'Once the zonal manager approves, the Employee ID is made and the person joins the active list.')}</p>
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}
