// Zonal manager's inbox: what the hubs asked for (new ID, left the job, transfer, reactivate), with approve / reject.
// Approving does the real change in the database and writes the joining / exit / transfer file.
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { Contact } from '../../components/Contact'
import { Icon } from '../../components/Icon'
import { Combo } from '../../components/inputs'
import { MISSING, dmy, todayDhaka } from '../../lib/hr'
import { LIFE, LIFE_KINDS, downloadRecord, lifeFriendly, lifecycle, takaBn, type Accounts, type InboxRow, type LifeKind } from '../../lib/lifecycle'
import { usePrefs } from '../../lib/prefs'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'
import { useOrg } from '../hr/common'

type View = 'open' | 'done' | 'rejected'
const missLabel = (k: string) => (k === 'reporting_manager' ? 'রিপোর্টিং ম্যানেজার' : MISSING[k] ?? k.replace(/^(field|document):/, ''))

export function ZonalRequests() {
  const { L, n } = usePrefs()
  const o = useOrg()
  const { toast, node } = useToast()
  const [sp, setSp] = useSearchParams()
  const focus = sp.get('id')
  const [zone, setZone] = useState('')
  const [view, setView] = useState<View>('open')
  const [tab, setTab] = useState<LifeKind>('id_create')
  const box = useLoad(() => lifecycle.inbox(zone || null, view), [zone, view])
  const rows = box.data?.rows ?? []
  const [act, setAct] = useState<null | { row: InboxRow; approve: boolean }>(null)
  const [file, setFile] = useState<null | { id: string; name: string }>(null)
  const count = (k: LifeKind) => rows.filter(r => r.kind === k).length
  const shown = useMemo(() => rows.filter(r => r.kind === tab), [rows, tab])

  // a notification link (?id=…) opens the tab that holds that request; with nothing asked, the first tab that has work
  const [placed, setPlaced] = useState(false)
  useEffect(() => {
    if (placed || !box.data) return
    const hit = focus ? rows.find(r => r.id === focus) : null
    const first = LIFE_KINDS.find(k => rows.some(r => r.kind === k))
    if (hit) setTab(hit.kind); else if (first) setTab(first)
    setPlaced(true)
  }, [box.data, focus, rows, placed])
  useEffect(() => { if (placed && focus) document.getElementById(`rq-${focus}`)?.scrollIntoView({ block: 'center' }) }, [placed, focus, tab])

  async function getFile() {
    if (!file) return
    try { const r = await lifecycle.record(file.id); if (r) downloadRecord(r) } catch (e) { toast(lifeFriendly(e)) }
  }
  const done = (m: string, rec?: { id: string; name: string } | null) => {
    setAct(null); setFile(rec ?? null); toast(m); if (focus) setSp({}); void box.reload()
  }

  return <AppShell title={L('এইচআর অনুরোধ', 'HR requests')}
    subtitle={L('হাব থেকে আসা অনুরোধ। অনুমোদন করলে আইডি চালু / বন্ধ / বদলি সাথে সাথে হয়ে যায় আর কোম্পানির ফরম্যাটে ফাইল তৈরি হয়।',
      'Requests from the hubs. Approving does the change at once and writes the file in the company format.')}
    actions={<><Link to="/app/staff/list" className="btn-ghost">{L('সক্রিয় স্টাফ', 'Active staff')}</Link>
      <Link to="/app/zonal/hr-records" className="btn-ghost"><Icon name="xls" size={16} />{L('HR রেকর্ড', 'HR records')}</Link></>}>
    {node}
    <section className="da-filters panel no-print">
      {(o.data?.zones.length ?? 0) > 1 && <Field label={L('এরিয়া', 'Area')}><select value={zone} onChange={e => setZone(e.target.value)}>
        <option value="">{L('সব এরিয়া', 'All areas')}</option>{o.data?.zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>}
      <Field label={L('অবস্থা', 'Status')}><select value={view} onChange={e => setView(e.target.value as View)}>
        <option value="open">{L('অপেক্ষমাণ', 'Waiting')}</option><option value="done">{L('অনুমোদিত', 'Approved')}</option><option value="rejected">{L('বাতিল', 'Rejected')}</option></select></Field>
    </section>
    {file && <p className="da-ok lc-file">{L('ফাইল তৈরি হয়েছে:', 'File ready:')} <b>{file.name}</b>
      <button className="sm" onClick={() => void getFile()}><Icon name="xls" size={14} />{L('এক্সেল নামান', 'Download Excel')}</button>
      <button className="secondary sm" onClick={() => setFile(null)}>{L('ঠিক আছে', 'OK')}</button></p>}

    <nav className="emp-tabs no-print" role="tablist">
      {LIFE_KINDS.map(k => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
        <Icon name={LIFE[k].icon} size={16} />{L(LIFE[k].bn, LIFE[k].en)}{count(k) > 0 && <span className="tab-count">{n(count(k))}</span>}</button>)}
    </nav>
    {box.error ? <p className="da-error">{lifeFriendly(box.error)}</p> : null}

    {!shown.length ? <section className="panel"><p className="muted">{box.loading ? L('লোড হচ্ছে…', 'Loading…')
      : tab === 'id_transfer' && view === 'open' ? L('বদলির কোনো অনুরোধ নেই। বদলি করতে “সক্রিয় স্টাফ” পাতায় নামের পাশের ⋮ মেনু থেকে “অন্য হাবে বদলি” বেছে নিন।', 'No transfer requests. To transfer someone, use the ⋮ menu on the Active staff page.')
      : L('এই ঘরে কিছু নেই।', 'Nothing here.')}</p></section>
      : <div className="lc-cards">{shown.map(r => <article key={r.id} id={`rq-${r.id}`} className={`panel lc-card${r.id === focus ? ' focus' : ''}`}>
        <header><span className={`rq-kind-tag t-${LIFE[r.kind].tone}`}><Icon name={LIFE[r.kind].icon} size={14} />{L(LIFE[r.kind].bn, LIFE[r.kind].en)}</span>
          <b>{r.employee_name ?? '—'}</b>{r.employee_code && <span className="lc-code">{r.employee_code}</span>}
          <span className="muted small lc-no">{r.request_no} · {dmy(r.created_at)}</span></header>
        <dl className="lc-facts">
          <div><dt>{L('হাব', 'Hub')}</dt><dd>{r.hub_name ?? '—'}{r.kind === 'id_transfer' && <> → <b>{r.to_hub_name ?? L('ঠিক হয়নি', 'not set')}</b></>}</dd></div>
          <div><dt>{L('পদবি', 'Position')}</dt><dd>{r.position_name ?? '—'}</dd></div>
          <div><dt>{L('মোবাইল', 'Mobile')}</dt><dd><Contact phone={r.mobile} /></dd></div>
          <div><dt>{L('পাঠিয়েছেন', 'Sent by')}</dt><dd>{r.submitter_name || '—'}</dd></div>
          {r.joining_date && <div><dt>{L('যোগদান', 'Joined')}</dt><dd>{dmy(r.joining_date)}</dd></div>}
          {r.last_date && <div><dt>{L('শেষ কর্মদিবস', 'Last working day')}</dt><dd>{dmy(r.last_date)}</dd></div>}
          {r.effective_date && <div><dt>{L('কবে থেকে', 'From')}</dt><dd>{dmy(r.effective_date)}</dd></div>}
        </dl>
        {r.reason && <p className="lc-reason"><b>{L('কারণ:', 'Reason:')}</b> {r.reason}</p>}
        {r.missing && r.missing.length > 0 && <p className="lc-missing"><Icon name="alert" size={14} /> {L('প্রোফাইলে এখনো বাকি:', 'Still missing:')} {r.missing.map(missLabel).join(', ')}</p>}
        {r.accounts && <AccountsBox a={r.accounts} />}
        {r.status === 'done' || r.status === 'rejected'
          ? <p className="lc-decided"><Badge tone={r.status === 'done' ? 'ok' : 'bad'}>{r.status === 'done' ? L('অনুমোদিত', 'Approved') : L('বাতিল', 'Rejected')}</Badge>
            {' '}{dmy(r.decided_at)}{r.result ? ` · ${r.result}` : ''}{r.decision_note ? ` · ${r.decision_note}` : ''}</p>
          : <footer>{r.own && r.kind === 'id_create' ? <span className="muted small">{L('আপনি নিজে পাঠিয়েছেন — অন্য একজন অনুমোদন করবেন (দুই-জনের নিয়ম)।', 'You sent this — another person approves it (two-person rule).')}</span>
              : <button onClick={() => setAct({ row: r, approve: true })}><Icon name="check" size={16} />{L('অনুমোদন', 'Approve')}</button>}
            <button className="secondary danger" onClick={() => setAct({ row: r, approve: false })}><Icon name="x" size={16} />{L('বাতিল', 'Reject')}</button></footer>}
      </article>)}</div>}

    {act?.approve && <ApproveModal row={act.row} nextCode={box.data?.next_code ?? ''} hubs={(o.data?.hubs ?? []).map(h => ({ value: h.id, label: h.name, sub: o.names.zone[h.zone_id] }))}
      onClose={() => setAct(null)} onDone={done} />}
    {act && !act.approve && <RejectModal row={act.row} onClose={() => setAct(null)} onDone={done} />}
  </AppShell>
}

function AccountsBox({ a }: { a: Accounts }) {
  const { L, n } = usePrefs()
  return <div className="lc-accounts" aria-label={L('চূড়ান্ত হিসাব', 'Final accounts')}>
    <div><span>{L('শেষ বেতন (মাসিক)', 'Last salary')}</span><b>{takaBn(a.last_salary)}</b></div>
    <div><span>{L('বকেয়া বেতন', 'Unpaid salary')}<small>{a.salary_source === 'salary_sheet' ? L('বেতন শিট থেকে', 'from the salary sheet') : L(`${n(a.salary_days)} দিন · আনুমানিক`, `${a.salary_days} days · estimate`)}</small></span><b>{takaBn(a.unpaid_salary)}</b></div>
    <div><span>{L('খাতায় জমা', 'Khata deposit')}</span><b>{takaBn(a.khata_deposit)}</b></div>
    <div className={a.khata_due > 0 ? 'warn' : ''}><span>{L('খাতায় বকেয়া', 'Khata due')}</span><b>{takaBn(a.khata_due)}</b></div>
    <div className="net"><span>{L('নিট পাওনা', 'Net payable')}</span><b>{takaBn(a.net_payable)}</b></div>
  </div>
}

type Done = (m: string, rec?: { id: string; name: string } | null) => void

function ApproveModal({ row: r, nextCode, hubs, onClose, onDone }: { row: InboxRow; nextCode: string
  hubs: Array<{ value: string; label: string; sub?: string }>; onClose: () => void; onDone: Done }) {
  const { L } = usePrefs()
  const today = todayDhaka()
  const [code, setCode] = useState(nextCode)
  const [type, setType] = useState<'resigned' | 'terminated'>(/বাদ|অব্যাহতি/.test(r.reason ?? '') ? 'terminated' : 'resigned')
  const [date, setDate] = useState(((r.kind === 'id_inactive' ? r.last_date : r.effective_date) ?? today).slice(0, 10))
  const [to, setTo] = useState(r.to_hub_id ?? '')
  const [note, setNote] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function go() {
    setErr('')
    if (r.kind === 'id_create' && !code.trim()) return setErr(L('এমপ্লয়ি আইডি দিন', 'Enter the Employee ID'))
    if (r.kind === 'id_transfer' && !to) return setErr(L('নতুন হাব বেছে নিন', 'Choose the new hub'))
    setBusy(true)
    try {
      const opts: Record<string, string> = r.kind === 'id_create' ? { employee_code: code.trim() }
        : r.kind === 'id_inactive' ? { exit_type: type, effective_date: date }
        : r.kind === 'id_transfer' ? { to_hub: to, effective_date: date } : { effective_date: date }
      const d = await lifecycle.decide(r.id, true, note.trim(), opts)
      const what = r.kind === 'id_create' ? L(`আইডি ${d.result ?? ''} চালু হয়েছে`, `ID ${d.result ?? ''} is active`)
        : r.kind === 'id_inactive' ? L('আইডি বন্ধ হয়েছে', 'ID closed') : r.kind === 'id_transfer' ? L('বদলি হয়েছে', 'Transferred') : L('আইডি আবার চালু হয়েছে', 'ID active again')
      onDone(`${r.employee_name ?? ''} — ${what}`, d.record_id ? { id: d.record_id, name: `${r.employee_name ?? ''} · ${L(LIFE[r.kind].bn, LIFE[r.kind].en)}` } : null)
    } catch (e) { setErr(lifeFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title={`${L('অনুমোদন', 'Approve')} — ${L(LIFE[r.kind].bn, LIFE[r.kind].en)}`} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('ফিরে যান', 'Back')}</button><button disabled={busy} onClick={() => void go()}>{busy ? L('হচ্ছে…', 'Working…') : L('অনুমোদন নিশ্চিত করুন', 'Confirm approval')}</button></>}>
    <p className="lc-who"><Icon name="user" size={16} /><b>{r.employee_name}</b>{r.employee_code && <span>· {r.employee_code}</span>}<span>· {r.hub_name}</span></p>
    <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
      {r.kind === 'id_create' && <Field required label={L('এমপ্লয়ি আইডি', 'Employee ID')} hint={L('পরের ফাঁকা নম্বর বসানো আছে; দরকার হলে বদলান।', 'The next free number is filled in; change it if needed.')}>
        <input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" /></Field>}
      {r.kind === 'id_inactive' && <Field label={L('ধরন', 'Type')}><select value={type} onChange={e => setType(e.target.value as 'resigned' | 'terminated')}>
        <option value="resigned">{L('চাকরি ছেড়েছেন', 'Resigned')}</option><option value="terminated">{L('অব্যাহতি (অফিস থেকে বাদ)', 'Terminated')}</option></select></Field>}
      {r.kind === 'id_transfer' && <Field required label={L('নতুন হাব', 'New hub')}><Combo value={to} onChange={setTo} options={hubs.filter(h => h.value !== r.hub_id)} /></Field>}
      {r.kind !== 'id_create' && <Field label={r.kind === 'id_inactive' ? L('শেষ কর্মদিবস', 'Last working day') : L('কবে থেকে', 'From')}>
        <input type="date" value={date} max={r.kind === 'id_transfer' ? undefined : today} onChange={e => setDate(e.target.value)} /></Field>}
      <Field wide label={L('নোট (ঐচ্ছিক)', 'Note (optional)')}><input value={note} onChange={e => setNote(e.target.value)} /></Field>
    </div>
    {r.kind === 'id_inactive' && r.accounts && <AccountsBox a={r.accounts} />}
    {r.kind === 'id_create' && !!r.missing?.length && <p className="lc-missing"><Icon name="alert" size={14} /> {L('প্রোফাইলে এখনো বাকি:', 'Still missing:')} {r.missing.map(missLabel).join(', ')}</p>}
    <p className="muted small">{r.kind === 'id_create' ? L('অনুমোদন করলে স্টাফ সক্রিয় হবেন, যোগদানের রেকর্ড আর জয়েনিং ফাইল তৈরি হবে।', 'The person becomes active; the joining record and joining file are made.')
      : r.kind === 'id_inactive' ? L('অনুমোদন করলে আইডি ও লগইন বন্ধ হবে, চূড়ান্ত হিসাবসহ এক্সিট ফাইল তৈরি হবে।', 'The ID and login are closed; the exit file with final accounts is made.')
      : r.kind === 'id_transfer' ? L('পুরোনো হাবের দায়িত্ব বন্ধ হয়ে নতুন হাবে খুলবে, ট্রান্সফার ফাইল তৈরি হবে।', 'The old assignment closes, the new one opens; the transfer file is made.')
      : L('অনুমোদন করলে আইডি ও লগইন আবার চালু হবে।', 'The ID and login become active again.')} {L('হাব ম্যানেজার নোটিফিকেশন পাবেন।', 'The hub manager is notified.')}</p>
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}

function RejectModal({ row: r, onClose, onDone }: { row: InboxRow; onClose: () => void; onDone: Done }) {
  const { L } = usePrefs()
  const [note, setNote] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function go() {
    setErr('')
    if (!note.trim()) return setErr(L('বাতিলের কারণ লিখুন', 'Enter why it is rejected'))
    setBusy(true)
    try { await lifecycle.decide(r.id, false, note.trim()); onDone(L(`${r.request_no} বাতিল করা হয়েছে`, `${r.request_no} rejected`)) }
    catch (e) { setErr(lifeFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title={`${L('বাতিল', 'Reject')} — ${r.request_no}`} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('ফিরে যান', 'Back')}</button><button className="danger" disabled={busy} onClick={() => void go()}>{L('বাতিল নিশ্চিত করুন', 'Confirm rejection')}</button></>}>
    <p className="lc-who"><Icon name="user" size={16} /><b>{r.employee_name}</b><span>· {L(LIFE[r.kind].bn, LIFE[r.kind].en)}</span><span>· {r.hub_name}</span></p>
    <Field required label={L('বাতিলের কারণ', 'Reason for rejecting')} hint={L('যিনি পাঠিয়েছেন তিনি এই লেখাটি নোটিফিকেশনে দেখবেন।', 'The sender sees this in the notification.')}>
      <textarea rows={3} value={note} onChange={e => setNote(e.target.value)} /></Field>
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}
