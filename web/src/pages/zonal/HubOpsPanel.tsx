import { askConfirm, askReason } from '../../components/ask'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { usePrefs } from '../../lib/prefs'
import { dmy } from '../../lib/hr'
import { ATTENDANCE_HUB, pageLinkAllowed } from '../../lib/menu'
import { wf, wfFriendly } from '../../lib/workforce'
import {
  ATT_SHORT, JOB, OTHER_GROUP, REGISTER_TO_ATT, STATUS, dhakaToday, groupFor, hubOps, hubOpsFriendly, shiftDay,
  type Attendance, type Employment, type Found, type Group, type Person, type SaveData,
} from '../../lib/hubOps'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'
import { useOrg } from '../hr/common'
import { HistoryModal } from './HubOpsParts'

type Row = Person & { key: string; open?: boolean }
const ATTS: Attendance[] = ['present', 'absent', 'leave_applied', 'leave_not_applied']
const JOBS: Employment[] = ['active', 'new', 'resigned']
let seq = 0
const keyOf = (p: Person) => p.id ?? p.employee_id ?? `n${++seq}`
const numIn = (s: string): number | null => s.trim() === '' ? null : Number(s)

/**
 * একটি হাবের ইনপুট প্যানেল: one hub, one day. Totals, reasons, remarks and every person's status in one or two taps,
 * grouped by designation. Nothing is filled in by itself: an empty box stays "not entered", an unmarked person
 * stays "not marked". The hints (attendance register, leave application, the hub's own figures) are copied only when
 * the zonal manager taps them.
 */
export function HubOpsPanel() {
  const { hubId = '' } = useParams()
  const [sp, setSp] = useSearchParams()
  const date = sp.get('date') || dhakaToday()
  const nav = useNavigate()
  const { L, n, lang } = usePrefs()
  const o = useOrg()
  const { toast, node } = useToast()
  const q = useLoad(() => hubOps.panel(hubId, date), [hubId, date])
  const p = q.data

  const [parcels, setParcels] = useState(''); const [pickups, setPickups] = useState('')
  const [reasons, setReasons] = useState<string[]>([]); const [remarks, setRemarks] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [extra, setExtra] = useState('')
  const [ask, setAsk] = useState<null | 'correct' | 'review'>(null); const [why, setWhy] = useState('')
  const [adding, setAdding] = useState(false)
  const [history, setHistory] = useState(false)
  const [shut, setShut] = useState<Record<string, boolean>>({})

  // Load the saved report, or HR's staff list for a new one.
  useEffect(() => {
    if (!p) return
    const r = p.report
    setParcels(r?.total_parcels == null ? '' : String(r.total_parcels)); setPickups(r?.total_pickups == null ? '' : String(r.total_pickups))
    setReasons(r?.reasons ?? []); setRemarks(r?.remarks ?? '')
    const editingDraft = !r || r.status === 'pending'
    setRows([...p.rows, ...(editingDraft ? p.roster : [])].map(x => ({ ...x, key: keyOf(x), open: !!(x.reason || x.remarks) })))
    setDirty(false); setErr('')
  }, [p])
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const groups: Group[] = useMemo(() => [...(p?.groups ?? []), OTHER_GROUP], [p])
  const live = rows.filter(r => !r.removed)
  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, leave_applied: 0, leave_not_applied: 0, none: 0, resigned: 0, new: 0 }
    for (const r of live) { if (r.attendance) c[r.attendance]++; else if (r.employment !== 'resigned') c.none++; if (r.employment === 'resigned') c.resigned++; if (r.employment === 'new') c.new++ }
    return c
  }, [live])
  const status = p?.report?.status ?? null
  const locked = status === 'submitted' || status === 'reviewed'
  const canWrite = !!p && (locked ? p.can.edit : p.can.create)
  const isFuture = date > (p?.today ?? dhakaToday())

  const zoneHubs = useMemo(() => (o.data?.hubs ?? []).filter(h => !h.archived_at && h.status === 'active' && h.zone_id === p?.hub.zone_id)
    .sort((a, b) => a.name.localeCompare(b.name)), [o.data, p])
  const nextHub = useMemo(() => { const i = zoneHubs.findIndex(h => h.id === hubId); return i >= 0 && zoneHubs.length > 1 ? zoneHubs[(i + 1) % zoneHubs.length] : null }, [zoneHubs, hubId])

  const touch = () => setDirty(true)
  const setRow = (key: string, patch: Partial<Row>) => { setRows(rs => rs.map(r => r.key === key ? { ...r, ...patch } : r)); touch() }
  const leave = () => askConfirm(L('সেভ না করা বদল হারিয়ে যাবে। যাবেন?', 'Unsaved changes will be lost. Continue?'), { ok: L('হ্যাঁ, যাব', 'Yes, go'), cancel: L('থাকব', 'Stay'), danger: true })
  const goDate = async (d: string) => { if (dirty && !await leave()) return; setSp({ date: d }, { replace: true }) }
  const goHub = async (id: string) => { if (dirty && !await leave()) return; nav(`/app/zonal/hub-ops/hub/${id}?date=${date}`) }

  /** One tap: everyone not yet marked (and not resigned) is present. */
  function allPresent() {
    setRows(rs => rs.map(r => !r.removed && !r.attendance && r.employment !== 'resigned' ? { ...r, attendance: 'present' as Attendance } : r))
    touch(); toast(L('বাকি সবাইকে উপস্থিত দেওয়া হলো — সেভ করতে ভুলবেন না', 'Everyone left was marked present — remember to save'))
  }
  /** One tap: copy what the attendance register and leave applications already say, only for people not yet marked. */
  function fromRegister() {
    let k = 0
    setRows(rs => rs.map(r => {
      if (r.removed || r.attendance || !r.hints) return r
      const a = (r.hints.register && REGISTER_TO_ATT[r.hints.register]) || (r.hints.leave ? 'leave_applied' as Attendance : undefined)
      if (!a) return r
      k++; return { ...r, attendance: a }
    }))
    if (k) { touch(); toast(L(`${n(k)} জনের হাজিরা খাতা / ছুটির আবেদন থেকে নেওয়া হলো`, `${k} taken from the register / leave applications`)) }
    else toast(L('হাজিরা খাতায় বা ছুটির আবেদনে নতুন কিছু নেই', 'Nothing new in the register or leave applications'))
  }
  function addRoster(list: Person[]) {
    setRows(rs => [...rs, ...list.filter(x => !rs.some(r => !r.removed && r.employee_id && r.employee_id === x.employee_id)).map(x => ({ ...x, key: keyOf(x) }))]); touch()
  }

  async function save(submit: boolean, reason: string | null) {
    if (!p) return
    setErr('')
    const tp = numIn(parcels), tk = numIn(pickups)
    for (const [v, lbl] of [[tp, L('মোট পার্সেল', 'Total parcels')], [tk, L('মোট পিকআপ', 'Total pickups')]] as const)
      if (v !== null && (!Number.isInteger(v) || v < 0)) return setErr(L(`${lbl}: ০ বা তার বেশি পূর্ণ সংখ্যা লিখুন`, `${lbl}: a whole number of 0 or more`))
    if ((submit || locked) && (tp === null || tk === null)) return setErr(L('জমা দেওয়ার আগে মোট পার্সেল ও মোট পিকআপ লিখুন (না থাকলে ০ লিখুন)', 'Enter total parcels and pickups first (write 0 if none)'))
    const data: SaveData = {
      total_parcels: tp, total_pickups: tk, reasons, remarks: remarks.trim() || null,
      staff: rows.filter(r => !r.removed || r.id).map(r => ({ id: r.id, employee_id: r.employee_id, person_name: r.person_name, mobile: r.mobile, position_id: r.position_id,
        attendance: r.attendance, employment: r.employment, reason: r.reason?.trim() || null, remarks: r.remarks?.trim() || null, removed: !!r.removed })),
    }
    setBusy(true)
    try {
      await hubOps.save(hubId, date, data, submit, reason)
      setDirty(false); setAsk(null); setWhy('')
      toast(locked ? L('সংশোধন সেভ হয়েছে — ইতিহাসে রাখা আছে', 'Correction saved — kept in the history')
        : submit ? L('রিপোর্ট জমা হয়েছে', 'Report submitted') : L('খসড়া সেভ হয়েছে', 'Draft saved'))
      await q.reload()
    } catch (e) { setErr(hubOpsFriendly(e)) } finally { setBusy(false) }
  }
  async function review() {
    if (!p?.report) return
    setBusy(true); setErr('')
    try { await hubOps.review([p.report.id], why.trim() || null); setAsk(null); setWhy(''); toast(L('দেখা হয়েছে (রিভিউ) দেওয়া হলো', 'Marked reviewed')); await q.reload() }
    catch (e) { setErr(hubOpsFriendly(e)) } finally { setBusy(false) }
  }
  async function hrResign(r: Row) {
    if (!r.employee_id) return
    const reason = await askReason(L(`${r.person_name} — এইচআর রেকর্ডেও "চাকরি ছেড়েছেন" করবেন?`, `Also mark ${r.person_name} resigned in HR?`), { initial: r.reason ?? '', ok: L('চাকরি ছেড়েছেন করুন', 'Mark resigned') })
    if (!reason?.trim()) return
    try { await hubOps.hrResign(r.employee_id, date, reason.trim()); toast(L('এইচআর রেকর্ডে চাকরি ছেড়েছেন করা হলো', 'Marked resigned in HR')); await q.reload() }
    catch (e) { setErr(hubOpsFriendly(e)) }
  }

  const title = p ? p.hub.name : L('হাব অপারেশন', 'Hub operations')
  const notInReport = locked ? p?.roster ?? [] : []
  const backQuery = new URLSearchParams({ date })
  if (p) backQuery.set('zone', p.hub.zone_id)

  return <AppShell title={title}
    subtitle={<>{L('হাবের অপারেশন রিপোর্ট', 'Hub operation report')} · {dmy(date)} {status ? <Badge tone={STATUS[status][2]}>{L(STATUS[status][0], STATUS[status][1])}</Badge> : <Badge tone="warn">{L('এখনো শুরু হয়নি', 'Not started')}</Badge>}</>}
    actions={<Link className="btn-ghost" to={`/app/zonal/hub-ops?${backQuery}`}><Icon name="back" size={16} />{L('সব হাব', 'All hubs')}</Link>}>
    {node}
    <div className="hop-date no-print">
      <button type="button" className="secondary" onClick={() => goDate(shiftDay(date, -1))} aria-label={L('আগের দিন', 'Previous day')}>‹</button>
      <input type="date" aria-label={L('তারিখ', 'Date')} value={date} max={p?.today ?? dhakaToday()} onChange={e => e.target.value && goDate(e.target.value)} />
      <button type="button" className="secondary" disabled={date >= (p?.today ?? dhakaToday())} onClick={() => goDate(shiftDay(date, 1))} aria-label={L('পরের দিন', 'Next day')}>›</button>
      {date !== (p?.today ?? dhakaToday()) && <button type="button" className="secondary sm" onClick={() => goDate(p?.today ?? dhakaToday())}>{L('আজ', 'Today')}</button>}
      {zoneHubs.length > 1 && <select value={hubId} onChange={e => goHub(e.target.value)} aria-label={L('হাব', 'Hub')}>
        {zoneHubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select>}
    </div>

    {q.loading && !p && <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>}
    {q.error ? <p className="da-error">{hubOpsFriendly(q.error)}</p> : null}
    {isFuture && <p className="da-error">{L('আগামী দিনের রিপোর্ট দেওয়া যায় না।', 'No report for a future date.')}</p>}

    {p && <>
      {!q.loading && !q.error && p.hub.id === hubId && !isFuture && <HubDaySources
        key={`${hubId}-${date}`} hub={p.hub} date={date} onOpen={async to => {
          if (!dirty || await leave()) nav(to)
        }} />}
      {p.report && <section className="panel hop-meta">
        <span>{L('সংস্করণ', 'Version')} {n(p.report.version)}</span>
        {p.report.submitted_at && <span>{L('জমা', 'Submitted')}: {p.report.submitted_by_name} · {new Date(p.report.submitted_at).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>}
        {p.report.reviewed_at && <span>{L('দেখেছেন', 'Reviewed by')}: {p.report.reviewed_by_name}{p.report.review_note ? ` — ${p.report.review_note}` : ''}</span>}
        {p.report.last_correction && <span>{L('শেষ সংশোধনের কারণ', 'Last correction')}: {p.report.last_correction}</span>}
        <button type="button" className="secondary sm" onClick={() => setHistory(true)}><Icon name="clock" size={14} />{L('ইতিহাস', 'History')}</button>
      </section>}
      {p.hub.skip && <p className="muted small">{L('এই হাবের রিপোর্ট সেটিং-এ "লাগবে না" দেওয়া আছে — দিলে তবুও হিসাবে আসবে।', 'Settings say no report is expected from this hub — one given still counts.')}</p>}

      <section className="panel">
        <h2 className="hop-h"><Icon name="box" size={18} />{L('পার্সেল ও পিকআপ', 'Parcels & pickups')}</h2>
        <div className="hop-nums">
          <label><span>{L('মোট পার্সেল', 'Total parcels')}</span>
            <input type="number" inputMode="numeric" min={0} step={1} value={parcels} disabled={!canWrite} placeholder={L('লিখুন', 'Enter')}
              onChange={e => { setParcels(e.target.value); touch() }} /></label>
          <label><span>{L('মোট পিকআপ', 'Total pickups')}</span>
            <input type="number" inputMode="numeric" min={0} step={1} value={pickups} disabled={!canWrite} placeholder={L('লিখুন', 'Enter')}
              onChange={e => { setPickups(e.target.value); touch() }} /></label>
        </div>
        <p className="muted small">{L('খালি রাখলে "লেখা হয়নি" ধরা হবে, কখনো ০ নয়। সত্যিই না থাকলে ০ লিখুন।', 'Left empty means "not entered", never 0. Write 0 if there were none.')}</p>
        {p.hub_metric && <p className="hop-hint">
          <Icon name="truck" size={14} />{L('হাবের নিজের দেওয়া হিসাব', "Hub's own figures")}: {L('পিকআপ', 'pickups')} {n(p.hub_metric.pickups)} · {L('ডেলিভারি', 'deliveries')} {n(p.hub_metric.deliveries)}
          {' '}<Badge tone={p.hub_metric.status === 'verified' ? 'ok' : 'neutral'}>{p.hub_metric.status === 'verified' ? L('যাচাই হয়েছে', 'Verified') : L('যাচাই হয়নি', 'Not verified')}</Badge>
          {canWrite && String(p.hub_metric.pickups) !== pickups && <button type="button" className="secondary sm" onClick={() => { setPickups(String(p.hub_metric!.pickups)); touch() }}>{L('পিকআপ এখান থেকে নিন', 'Use this pickup count')}</button>}
        </p>}
      </section>

      <section className="panel">
        <h2 className="hop-h"><Icon name="note" size={18} />{L('অপারেশনের কারণ ও মন্তব্য', 'Operational reasons & remarks')}</h2>
        <div className="chips hop-reasons">
          {[...new Set([...p.reasons, ...reasons])].map(r => <button type="button" key={r} disabled={!canWrite} aria-pressed={reasons.includes(r)}
            className={`chip-toggle${reasons.includes(r) ? ' on' : ''}`} onClick={() => { setReasons(x => x.includes(r) ? x.filter(y => y !== r) : [...x, r]); touch() }}>
            {reasons.includes(r) && <Icon name="check" size={13} />}{r}</button>)}
        </div>
        {canWrite && <form className="hop-inline" onSubmit={e => { e.preventDefault(); const v = extra.trim(); if (v && !reasons.includes(v)) { setReasons([...reasons, v]); touch() } setExtra('') }}>
          <input value={extra} onChange={e => setExtra(e.target.value)} placeholder={L('অন্য কারণ লিখুন…', 'Another reason…')} maxLength={120} />
          <button type="submit" className="secondary sm" disabled={!extra.trim()}><Icon name="plus" size={14} />{L('যোগ', 'Add')}</button></form>}
        <Field label={L('মন্তব্য', 'Remarks')} wide><textarea rows={2} value={remarks} disabled={!canWrite} maxLength={2000} onChange={e => { setRemarks(e.target.value); touch() }}
          placeholder={L('আজ হাবে কী হয়েছে, কী লাগবে…', 'What happened at the hub, what is needed…')} /></Field>
      </section>

      <section className="panel">
        <div className="da-bar"><h2 className="hop-h" style={{ margin: 0 }}><Icon name="users" size={18} />{L('কর্মী ও স্ট্যাটাস', 'Staff & status')} <span className="count-pill">{n(live.length)}</span></h2>
          {canWrite && <button type="button" className="secondary sm" onClick={() => setAdding(true)}><Icon name="userplus" size={15} />{L('লোক যোগ', 'Add person')}</button>}</div>
        <div className="hop-counts">
          <span className="c-ok">{L('উপস্থিত', 'Present')} <b>{n(counts.present)}</b></span>
          <span className="c-bad">{L('অনুপস্থিত', 'Absent')} <b>{n(counts.absent)}</b></span>
          <span className="c-info">{L('ছুটি (আবেদন)', 'Leave (applied)')} <b>{n(counts.leave_applied)}</b></span>
          <span className="c-warn">{L('ছুটি (আবেদন নেই)', 'Leave (not applied)')} <b>{n(counts.leave_not_applied)}</b></span>
          <span className={counts.none ? 'c-warn' : ''}>{L('হাজিরা বাকি', 'Not marked')} <b>{n(counts.none)}</b></span>
          {counts.new > 0 && <span className="c-info">{L('নতুন', 'New')} <b>{n(counts.new)}</b></span>}
          {counts.resigned > 0 && <span className="c-bad">{L('চাকরি ছেড়েছেন', 'Resigned')} <b>{n(counts.resigned)}</b></span>}
        </div>
        {canWrite && live.length > 0 && <div className="hop-bulk">
          <button type="button" className="secondary sm" disabled={!counts.none} onClick={allPresent}><Icon name="checkall" size={15} />{L('বাকি সবাই উপস্থিত', 'Rest are present')}</button>
          <button type="button" className="secondary sm" onClick={fromRegister}><Icon name="cal" size={15} />{L('হাজিরা খাতা ও ছুটির আবেদন থেকে নিন', 'Take from register & leave')}</button>
        </div>}
        {!live.length && <p className="muted">{L('এই হাবের এইচআর তালিকায় কেউ নেই। "লোক যোগ" দিয়ে যোগ করুন।', 'Nobody on this hub in HR. Use "Add person".')}</p>}

        {notInReport.length > 0 && <div className="hop-note">
          <span>{L(`এইচআর-এ আছেন কিন্তু এই রিপোর্টে নেই: ${notInReport.map(x => x.person_name).join(', ')}`, `In HR but not in this report: ${notInReport.map(x => x.person_name).join(', ')}`)}</span>
          {canWrite && <button type="button" className="secondary sm" onClick={() => addRoster(notInReport)}>{L('রিপোর্টে যোগ করুন', 'Add to report')}</button>}</div>}

        {groups.map(g => {
          const list = live.filter(r => (groups.some(x => x.key === r.group_key) ? r.group_key : 'other') === g.key)
          if (!list.length) return null
          const c = list.filter(r => r.attendance === 'present').length
          return <div key={g.key} className="hop-group">
            <button type="button" className="hop-ghead" aria-expanded={!shut[g.key]} onClick={() => setShut(s => ({ ...s, [g.key]: !s[g.key] }))}>
              <b>{L(g.bn, g.en)}</b><span className="muted small">{n(c)}/{n(list.length)} {L('উপস্থিত', 'present')}</span><Icon name="chev" size={16} className={shut[g.key] ? '' : 'rot'} /></button>
            {!shut[g.key] && list.map(r => <PersonRow key={r.key} r={r} canWrite={canWrite} canHr={p.can.hr_edit} saved={!dirty && !!r.id}
              onChange={patch => setRow(r.key, patch)} onHrResign={() => void hrResign(r)} />)}
          </div>
        })}

        {p.left_before.length > 0 && <details className="hop-left">
          <summary>{L(`আগের রিপোর্টে চাকরি ছেড়েছেন (${n(p.left_before.length)} জন) — এইচআর-এ এখনো সক্রিয়`, `Resigned in an earlier report (${p.left_before.length}) — still active in HR`)}</summary>
          {p.left_before.map(x => <div key={x.employee_id} className="hop-left-row"><span>{x.person_name} <span className="muted small">{[x.employee_code, x.position, x.hints?.last ? dmy(x.hints.last.date) : null].filter(Boolean).join(' · ')}</span></span>
            {canWrite && <button type="button" className="secondary sm" onClick={() => addRoster([{ ...(x as Person), id: null, attendance: null, employment: 'active', reason: null, remarks: null, mobile: null, position_id: null, in_hr: true }])}>{L('আবার যোগ', 'Add back')}</button>}</div>)}
        </details>}
      </section>

      {err && <p className="da-error" role="alert">{err}</p>}
      <div className="hop-bar no-print">
        {dirty && <span className="hop-dirty">{L('সেভ হয়নি', 'Not saved')}</span>}
        {canWrite && !locked && <>
          <button type="button" className="secondary" disabled={busy || isFuture} onClick={() => void save(false, null)}><Icon name="save" size={16} />{L('খসড়া সেভ', 'Save draft')}</button>
          <button type="button" disabled={busy || isFuture} onClick={() => void save(true, null)}><Icon name="check" size={16} />{busy ? L('হচ্ছে…', 'Saving…') : L('জমা দিন', 'Submit')}</button></>}
        {canWrite && locked && <button type="button" disabled={busy || !dirty} onClick={() => { setWhy(''); setAsk('correct') }}><Icon name="edit" size={16} />{L('সংশোধন সেভ করুন', 'Save correction')}</button>}
        {p.can.approve && status === 'submitted' && !dirty && <button type="button" className="secondary" disabled={busy} onClick={() => { setWhy(''); setAsk('review') }}><Icon name="checkall" size={16} />{L('দেখা হয়েছে', 'Reviewed')}</button>}
        {nextHub && <button type="button" className="secondary" onClick={() => goHub(nextHub.id)}>{L('পরের হাব', 'Next hub')} →</button>}
      </div>
    </>}

    {ask && <Modal title={ask === 'correct' ? L('সংশোধনের কারণ', 'Why the correction') : L('রিপোর্ট দেখা হয়েছে', 'Mark reviewed')} onClose={() => setAsk(null)}
      actions={<><button className="secondary" onClick={() => setAsk(null)}>{L('বাতিল', 'Cancel')}</button>
        <button disabled={busy || (ask === 'correct' && !why.trim())} onClick={() => void (ask === 'correct' ? save(false, why.trim()) : review())}>{L('ঠিক আছে', 'Confirm')}</button></>}>
      <p className="muted small">{ask === 'correct' ? L('জমা দেওয়া রিপোর্ট বদলালে কারণসহ আগের ও নতুন মান ইতিহাসে থাকে, আর রিপোর্ট আবার রিভিউর জন্য যায়।', 'The old and new values are kept with the reason, and the report goes back for review.')
        : L('ইচ্ছা হলে একটা মন্তব্য লিখুন।', 'Add a note if you like.')}</p>
      <Field label={ask === 'correct' ? L('কারণ', 'Reason') : L('মন্তব্য', 'Note')} wide required={ask === 'correct'}><textarea rows={3} autoFocus value={why} onChange={e => setWhy(e.target.value)} /></Field>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
    {adding && p && <AddPerson zone={p.hub.zone_id} groups={p.groups} positions={(o.data?.positions ?? []).filter(x => !x.archived_at && (x.level ?? 'hub') === 'hub')}
      taken={live.map(r => r.employee_id).filter(Boolean) as string[]} lang={lang}
      onClose={() => setAdding(false)} onAdd={x => { setRows(rs => [...rs, { ...x, key: keyOf(x) }]); touch(); setAdding(false) }} />}
    {history && p?.report && <HistoryModal kind="report" id={p.report.id} title={`${p.hub.name} · ${dmy(date)}`} onClose={() => setHistory(false)} />}
  </AppShell>
}

/** One person: four attendance taps, employment, and (folded) reason and remarks. */
function PersonRow({ r, canWrite, canHr, saved, onChange, onHrResign }: { r: Row; canWrite: boolean; canHr: boolean; saved: boolean
  onChange: (p: Partial<Row>) => void; onHrResign: () => void }) {
  const { L } = usePrefs()
  const h = r.hints
  const needWhy = r.attendance === 'absent' || r.attendance === 'leave_not_applied' || r.employment === 'resigned'
  return <div className={`hop-person${r.employment === 'resigned' ? ' gone' : ''}`}>
    <div className="hop-who">
      <b>{r.person_name}</b>
      <span className="muted small">{[r.employee_code ? `#${r.employee_code}` : null, r.position].filter(Boolean).join(' · ')}</span>
      <span className="hop-tags">
        {!r.in_hr && <Badge tone="warn">{L('এইচআর-এ নেই', 'Not in HR')}</Badge>}
        {h?.register && <Badge tone="neutral">{L('হাজিরা খাতা', 'Register')}: {L(({ present: 'উপস্থিত', late: 'দেরি', half_day: 'অর্ধদিন', absent: 'অনুপস্থিত', leave: 'ছুটি', holiday: 'ছুটির দিন', weekly_off: 'সাপ্তাহিক ছুটি' } as Record<string, string>)[h.register] ?? h.register, h.register)}</Badge>}
        {h?.leave && <Badge tone="info">{L('ছুটির আবেদন', 'Leave application')}: {h.leave.status === 'approved' ? L('অনুমোদিত', 'approved') : L('অপেক্ষায়', 'pending')}</Badge>}
        {h?.last && h.last.employment !== 'active' && <Badge tone={JOB[h.last.employment][2]}>{L('আগের রিপোর্টে', 'Earlier')}: {L(JOB[h.last.employment][0], JOB[h.last.employment][1])}</Badge>}
        {r.employment === 'resigned' && r.hr_status === 'active' && <Badge tone="warn">{L('এইচআর-এ এখনো সক্রিয়', 'Still active in HR')}</Badge>}
        {r.joining_date && h?.last == null && <span className="muted small">{L('যোগদান', 'Joined')} {dmy(r.joining_date)}</span>}
      </span>
    </div>
    <div className="hop-att" role="group" aria-label={L('হাজিরা', 'Attendance')}>
      {ATTS.map(a => <button type="button" key={a} disabled={!canWrite} className={`ha-${a}${r.attendance === a ? ' on' : ''}`} aria-pressed={r.attendance === a}
        onClick={() => onChange({ attendance: r.attendance === a ? null : a, open: r.open || a === 'absent' || a === 'leave_not_applied' })}>{L(ATT_SHORT[a][0], ATT_SHORT[a][1])}</button>)}
    </div>
    <div className="hop-job">
      <span className="da-seg" role="group" aria-label={L('চাকরির অবস্থা', 'Employment')}>{JOBS.map(j =>
        <button type="button" key={j} disabled={!canWrite} className={r.employment === j ? 'sm' : 'secondary sm'} aria-pressed={r.employment === j}
          onClick={() => onChange({ employment: j, open: r.open || j === 'resigned' })}>{L(JOB[j][0], JOB[j][1])}</button>)}</span>
      <button type="button" className="hop-more" aria-expanded={!!r.open} onClick={() => onChange({ open: !r.open })}>
        <Icon name="note" size={14} />{r.reason || r.remarks ? L('কারণ/মন্তব্য আছে', 'Has a note') : L('কারণ/মন্তব্য', 'Reason/remarks')}</button>
      {canWrite && !r.in_hr && !r.id && <button type="button" className="hop-more" onClick={() => onChange({ removed: true })}><Icon name="x" size={14} />{L('সরান', 'Remove')}</button>}
      {canWrite && r.id && !r.in_hr && <button type="button" className="hop-more" onClick={async () => { if (await askConfirm(L('রিপোর্ট থেকে সরাবেন?', 'Remove from the report?'), { ok: L('সরান', 'Remove'), danger: true })) onChange({ removed: true }) }}><Icon name="x" size={14} />{L('সরান', 'Remove')}</button>}
      {canHr && saved && r.employment === 'resigned' && r.in_hr && r.hr_status === 'active' && <button type="button" className="hop-more" onClick={onHrResign}><Icon name="userx" size={14} />{L('এইচআর-এও চাকরি ছেড়েছেন করুন', 'Also resign in HR')}</button>}
    </div>
    {r.open && <div className="hop-why">
      <input value={r.reason ?? ''} disabled={!canWrite} maxLength={500} onChange={e => onChange({ reason: e.target.value })}
        placeholder={needWhy ? L('কারণ লিখুন (যেমন: অসুস্থ, খবর দেয়নি)', 'Reason (e.g. sick, no notice)') : L('কারণ', 'Reason')} />
      <input value={r.remarks ?? ''} disabled={!canWrite} maxLength={500} onChange={e => onChange({ remarks: e.target.value })} placeholder={L('মন্তব্য', 'Remarks')} />
    </div>}
  </div>
}

/** Add someone: a person of the zone from HR (never a second record), or — only when not in HR yet — by name. */
function AddPerson({ zone, groups, positions, taken, lang, onClose, onAdd }: {
  zone: string; groups: Group[]; positions: Array<{ id: string; code: string; name: string; name_bn: string | null }>; taken: string[]; lang: string
  onClose: () => void; onAdd: (p: Person) => void }) {
  const { L } = usePrefs()
  const [qText, setQ] = useState(''); const [found, setFound] = useState<Found[] | null>(null)
  const [manual, setManual] = useState(false)
  const [name, setName] = useState(''); const [mobile, setMobile] = useState(''); const [pos, setPos] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    if (qText.trim().length < 2) { setFound(null); return }
    const t = window.setTimeout(() => { hubOps.search(zone, qText.trim()).then(setFound).catch(e => setErr(hubOpsFriendly(e))) }, 300)
    return () => window.clearTimeout(t)
  }, [qText, zone])
  const gOf = (id: string | null) => groupFor(id, positions, groups)
  const pName = (id: string) => { const x = positions.find(p => p.id === id); return x ? (lang === 'bn' ? x.name_bn || x.name : x.name) : null }
  return <Modal title={L('রিপোর্টে লোক যোগ', 'Add a person to the report')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button>
      {manual && <button disabled={name.trim().length < 2} onClick={() => {
        if (mobile && !/^01[3-9]\d{8}$/.test(mobile.replace(/\D/g, ''))) return setErr(L('মোবাইল নম্বর ঠিক নেই (১১ সংখ্যা)', 'Mobile is not valid'))
        onAdd({ id: null, employee_id: null, employee_code: null, person_name: name.trim(), mobile: mobile.replace(/\D/g, '') || null, position_id: pos || null,
          position: pos ? pName(pos) : null, group_key: gOf(pos || null), attendance: null, employment: 'new', reason: null, remarks: null, in_hr: false })
      }}>{L('যোগ করুন', 'Add')}</button>}</>}>
    {!manual ? <>
      <Field label={L('নাম, আইডি বা মোবাইল দিয়ে খুঁজুন (পুরো জোন)', 'Search by name, ID or mobile (whole zone)')} wide>
        <input autoFocus value={qText} onChange={e => setQ(e.target.value)} placeholder={L('অন্তত ২ অক্ষর', 'At least 2 letters')} /></Field>
      {found && !found.length && <p className="muted">{L('কেউ মেলেনি।', 'Nobody found.')}</p>}
      {found && found.length > 0 && <div className="hop-found">{found.map(f => {
        const already = taken.includes(f.employee_id)
        return <button type="button" key={f.employee_id} className="hub-link as-btn" disabled={already}
          onClick={() => onAdd({ id: null, employee_id: f.employee_id, employee_code: f.employee_code, person_name: f.person_name, mobile: f.mobile, position_id: f.position_id,
            position: f.position, group_key: gOf(f.position_id), attendance: null, employment: f.status === 'active' ? 'active' : 'new', reason: null, remarks: null, in_hr: true })}>
          <Icon name="user" size={16} /><span>{f.person_name}<small className="muted"> {[f.employee_code ? `#${f.employee_code}` : null, f.position, f.hub_name].filter(Boolean).join(' · ')}</small></span>
          {already ? <Badge tone="neutral">{L('আছেন', 'Listed')}</Badge> : <Icon name="plus" size={16} />}</button>
      })}</div>}
      <p className="muted small">{L('এইচআর-এ এখনো নেই এমন নতুন কেউ?', 'Someone new who is not in HR yet?')} <button type="button" className="secondary sm" onClick={() => setManual(true)}>{L('নাম লিখে যোগ করুন', 'Add by name')}</button></p>
    </> : <>
      <p className="muted small">{L('শুধু এই রিপোর্টে নাম থাকবে, এইচআর-এ নতুন রেকর্ড হবে না। নাম বা মোবাইল এইচআর-এ থাকলে সিস্টেম আটকে দেবে — তখন খুঁজে বেছে নিন। আইডি খোলার কাজ এইচআর আবেদনে।',
        'Only this report gets the name; no HR record is made. A name or mobile already in HR is refused — search and pick instead. IDs are opened through the HR application.')}</p>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label={L('নাম', 'Name')} wide required><input autoFocus value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label={L('মোবাইল (ইচ্ছা হলে)', 'Mobile (optional)')}><input inputMode="tel" value={mobile} onChange={e => setMobile(e.target.value)} placeholder="01XXXXXXXXX" /></Field>
        <Field label={L('পদ', 'Post')}><select value={pos} onChange={e => setPos(e.target.value)}><option value="">{L('বাছুন', 'Pick')}</option>
          {positions.map(x => <option key={x.id} value={x.id}>{lang === 'bn' ? x.name_bn || x.name : x.name}</option>)}</select></Field>
      </div>
      <button type="button" className="secondary sm" onClick={() => setManual(false)}>← {L('খোঁজায় ফিরুন', 'Back to search')}</button>
    </>}
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

function HubDaySources({ hub, date, onOpen }: {
  hub: { id: string; zone_id: string }
  date: string
  onOpen: (to: string) => Promise<void>
}) {
  const access = useAuth()
  const { L, n } = usePrefs()
  const canReadOps = access.grants.some(grant => grant.is_super || (
    grant.permission_code === 'ops.staff_daily.view' &&
    (grant.scope_type === 'global' || (grant.scope_type === 'zone' && grant.zone_id === hub.zone_id)
      || (grant.scope_type === 'hub' && grant.hub_id === hub.id))
  ))
  const source = useLoad(() => canReadOps
    ? wf.opsReport({ hub: hub.id }, date, date)
    : Promise.resolve(null), [hub.id, date, canReadOps])
  const scope = new URLSearchParams({ hub: hub.id, date })
  const attendance = new URLSearchParams(scope)
  attendance.set('view', 'hub')
  attendance.set('tab', 'final')
  const attendanceLink = `/app/attendance?${attendance}`
  const importLink = `/app/accounts/report-import?${scope}`
  const totals = source.data?.totals

  return <section className="panel">
    <h2 className="hop-h"><Icon name="checkall" size={18} />{L('হাবের দৈনিক তথ্য মিলিয়ে দেখুন', 'Compare the hub’s daily records')}</h2>
    {canReadOps && <div>
      <h3>{L('স্টাফের জমা', 'Staff submissions')}</h3>
      {source.error ? <p className="da-error" role="alert">{wfFriendly(source.error)}{' '}
        <button type="button" className="secondary sm" onClick={() => void source.reload()}>{L('আবার চেষ্টা করুন', 'Try again')}</button>
      </p> : source.loading ? <p className="muted" role="status">{L('লোড হচ্ছে…', 'Loading…')}</p>
        : totals && totals.entries > 0 ? <ul>
          <li>{L('পিকআপ', 'Pickup')} · {n(totals.pickup)}</li>
          <li>{L('মার্চেন্টকে রিটার্ন জমা', 'Return to merchant')} · {n(totals.pickup_return)}</li>
          <li>{L('ডেলিভারি রিটার্ন', 'Delivery return')} · {n(totals.delivery_return)}</li>
          <li>{L('ডেলিভারি', 'Delivery')} · {n(totals.delivery)}</li>
        </ul> : <p className="muted">{L('এই তারিখে স্টাফের জমা নেই।', 'There are no staff submissions for this date.')}</p>}
    </div>}
    <div className="hop-inline">
      {ATTENDANCE_HUB.some(access.can) && pageLinkAllowed(attendanceLink, access) &&
        <button type="button" className="secondary sm" onClick={() => void onOpen(attendanceLink)}>{L('হাজিরা খাতা খুলুন', 'Open attendance register')}</button>}
      {pageLinkAllowed(importLink, access) &&
        <button type="button" className="secondary sm" onClick={() => void onOpen(importLink)}>{L('ইম্পোর্ট করা রিপোর্ট দেখুন', 'See imported reports')}</button>}
    </div>
  </section>
}
