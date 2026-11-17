import { useState } from 'react'
import { Link } from 'react-router-dom'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { usePrefs } from '../../lib/prefs'
import { dmy } from '../../lib/hr'
import { ATT, JOB, OTHER_GROUP, STATUS, hubOps, hubOpsFriendly, numOr, type Group, type HistoryRow, type HubSummary, type PersonSummary, type Summary } from '../../lib/hubOps'
import { Badge, Modal, Stat, useLoad } from '../accounts/ui'

const groupLabel = (groups: Group[], k: string, L: (b: string, e: string) => string) => {
  const g = [...groups, OTHER_GROUP].find(x => x.key === k) ?? OTHER_GROUP; return L(g.bn, g.en)
}
const dates = (d: string[]) => d.map(dmy).join(', ')

/**
 * The summary of a zone for a period: zone totals, every hub, staffing by designation, attendance and leave (who applied and
 * who did not), resignations, new staff, missing reports, reasons and remarks. Everything here comes from submitted reports;
 * a figure nobody entered shows as "—".
 */
export function SummaryView({ s, linkDate }: { s: Summary; linkDate?: boolean }) {
  const { L, n } = usePrefs()
  const z = s.zone
  const single = s.from === s.to
  const [who, setWho] = useState<'leave_applied' | 'leave_not_applied' | 'absent' | 'resigned' | 'new' | 'all'>('leave_applied')
  const people = s.people.filter(p => who === 'all' ? true : who === 'resigned' ? p.resigned : who === 'new' ? p.new : p[who] > 0)
  const missing = s.hubs.filter(h => h.missing_dates.length)
  const reasons = Object.entries(z.reasons).sort((a, b) => b[1] - a[1])
  const num = (v: number | null) => numOr(v, x => n(x))

  return <div className="hop-summary">
    <div className="da-stats">
      <Stat icon="hub" label={single ? L('রিপোর্ট দিয়েছে', 'Hubs reported') : L('রিপোর্ট এসেছে', 'Reports received')}
        value={single ? `${n(z.hubs_reported)}/${n(z.hubs_expected)}` : `${n(z.submitted + z.reviewed)}/${n(z.expected)}`} tone={z.missing ? 'warn' : 'ok'}
        sub={L(`দেখা হয়েছে ${n(z.reviewed)}`, `${z.reviewed} reviewed`)} />
      <Stat icon="alert" label={L('রিপোর্ট নেই', 'Missing reports')} value={n(z.missing)} tone={z.missing ? 'bad' : undefined}
        sub={z.pending ? L(`${n(z.pending)}টি খসড়া, জমা হয়নি`, `${z.pending} drafts not submitted`) : undefined} />
      <Stat icon="box" label={L('মোট পার্সেল', 'Total parcels')} value={num(z.total_parcels)} />
      <Stat icon="truck" label={L('মোট পিকআপ', 'Total pickups')} value={num(z.total_pickups)} />
      <Stat icon="users" label={L('কর্মী (শেষ রিপোর্টে)', 'Staff (latest report)')} value={n(z.staff_latest)}
        sub={L(`এইচআর তালিকায় এখন ${n(z.roster)}`, `${z.roster} in HR now`)} />
      <Stat icon="check" tone="ok" label={single ? L('উপস্থিত', 'Present') : L('উপস্থিত (জন-দিন)', 'Present (person-days)')} value={n(z.att.present)} />
      <Stat icon="userx" tone={z.att.absent ? 'bad' : undefined} label={L('অনুপস্থিত', 'Absent')} value={n(z.att.absent)} />
      <Stat icon="log" label={L('ছুটি — আবেদন করেছে', 'Leave — applied')} value={n(z.att.leave_applied)} />
      <Stat icon="alert" tone={z.att.leave_not_applied ? 'warn' : undefined} label={L('ছুটি — আবেদন করেনি', 'Leave — not applied')} value={n(z.att.leave_not_applied)} />
      <Stat icon="clock" tone={z.att.not_marked ? 'warn' : undefined} label={L('হাজিরা দেওয়া হয়নি', 'Not marked')} value={n(z.att.not_marked)} />
      <Stat icon="userplus" label={L('নতুন কর্মী', 'New employees')} value={n(z.new)} sub={z.not_in_hr ? L(`এইচআর-এ নেই ${n(z.not_in_hr)}`, `${z.not_in_hr} not in HR`) : undefined} />
      <Stat icon="out" tone={z.resigned ? 'bad' : undefined} label={L('চাকরি ছেড়েছেন', 'Resigned')} value={n(z.resigned)} />
    </div>

    {Object.keys(z.by_group).length > 0 && <section className="panel">
      <h3 className="hop-h"><Icon name="users" size={17} />{L('পদ অনুযায়ী কর্মী (শেষ রিপোর্ট)', 'Staff by designation (latest report)')}</h3>
      <div className="chips">{[...s.groups, OTHER_GROUP].filter(g => z.by_group[g.key]).map(g =>
        <span key={g.key} className="chip">{L(g.bn, g.en)} <b>{n(z.by_group[g.key])}</b></span>)}</div>
    </section>}

    <section className="panel">
      <h3 className="hop-h"><Icon name="hub" size={17} />{L('হাব অনুযায়ী', 'By hub')}</h3>
      <DataTable<HubSummary> title={L(`হাব অপারেশন — ${s.zone_name} — ${dmy(s.from)}${single ? '' : ' থেকে ' + dmy(s.to)}`, `Hub operations — ${s.zone_name} — ${s.from}${single ? '' : ' to ' + s.to}`)}
        file={`hub-ops-${s.from}-${s.to}`} prefKey="hub-ops-hubs" rows={s.hubs} rowKey={h => h.hub_id} phoneView="card"
        cols={[
          { key: 'hub', label: L('হাব', 'Hub'), primary: true, value: h => h.name,
            render: h => linkDate && single ? <Link to={`/app/zonal/hub-ops/hub/${h.hub_id}?date=${s.from}`}><strong>{h.name}</strong></Link> : <strong>{h.name}</strong> },
          { key: 'st', label: L('রিপোর্ট', 'Report'), value: h => single ? (h.status ? L(STATUS[h.status][0], STATUS[h.status][1]) : h.skip ? L('লাগবে না', 'Not expected') : L('নেই', 'Missing'))
              : `${h.submitted + h.reviewed}/${h.expected}`,
            render: h => single ? (h.status ? <Badge tone={STATUS[h.status][2]}>{L(STATUS[h.status][0], STATUS[h.status][1])}</Badge>
              : h.skip ? <Badge tone="neutral">{L('লাগবে না', 'Not expected')}</Badge> : <Badge tone="bad">{L('নেই', 'Missing')}</Badge>)
              : <span>{n(h.submitted + h.reviewed)}/{n(h.expected)}{h.missing_dates.length ? <Badge tone="bad">{L(`${n(h.missing_dates.length)} দিন নেই`, `${h.missing_dates.length} missing`)}</Badge> : null}</span> },
          { key: 'parcels', label: L('পার্সেল', 'Parcels'), value: h => h.total_parcels, render: h => num(h.total_parcels) },
          { key: 'pickups', label: L('পিকআপ', 'Pickups'), value: h => h.total_pickups, render: h => num(h.total_pickups) },
          { key: 'staff', label: L('কর্মী', 'Staff'), value: h => h.staff_latest, render: h => <span>{n(h.staff_latest)}<span className="sec">{L(`এইচআর ${n(h.roster)}`, `HR ${h.roster}`)}</span></span> },
          { key: 'present', label: L('উপস্থিত', 'Present'), value: h => h.att.present, render: h => n(h.att.present) },
          { key: 'absent', label: L('অনুপস্থিত', 'Absent'), value: h => h.att.absent, render: h => n(h.att.absent) },
          { key: 'la', label: L('ছুটি (আবেদন)', 'Leave (applied)'), value: h => h.att.leave_applied, render: h => n(h.att.leave_applied) },
          { key: 'lna', label: L('ছুটি (আবেদন নেই)', 'Leave (not applied)'), value: h => h.att.leave_not_applied, render: h => n(h.att.leave_not_applied) },
          { key: 'nm', label: L('হাজিরা বাকি', 'Not marked'), value: h => h.att.not_marked, render: h => n(h.att.not_marked) },
          { key: 'new', label: L('নতুন', 'New'), value: h => h.new, render: h => n(h.new) },
          { key: 'res', label: L('চাকরি ছেড়েছেন', 'Resigned'), value: h => h.resigned, render: h => n(h.resigned) },
          { key: 'groups', label: L('পদ অনুযায়ী', 'By designation'), value: h => Object.entries(h.by_group).map(([k, v]) => `${groupLabel(s.groups, k, L)} ${v}`).join(', ') },
          { key: 'reasons', label: L('কারণ', 'Reasons'), value: h => Object.keys(h.reasons).join(', ') },
          { key: 'remarks', label: L('মন্তব্য', 'Remarks'), value: h => h.remarks.map(r => (single ? '' : dmy(r.date) + ': ') + r.text).join(' | ') },
        ]} />
    </section>

    {missing.length > 0 && <section className="panel">
      <h3 className="hop-h"><Icon name="alert" size={17} />{L('যে রিপোর্ট আসেনি', 'Missing reports')}</h3>
      <ul className="hop-list">{missing.map(h => <li key={h.hub_id}><b>{h.name}</b>
        <span className="muted small">{single ? L('আজ রিপোর্ট নেই', 'no report') : dates(h.missing_dates)}{h.pending_dates.length ? L(` · খসড়া আছে: ${dates(h.pending_dates)}`, ` · draft: ${dates(h.pending_dates)}`) : ''}</span>
        {linkDate && <Link className="btn-ghost" to={`/app/zonal/hub-ops/hub/${h.hub_id}?date=${h.missing_dates[h.missing_dates.length - 1]}`}>{L('লিখুন', 'Enter')} →</Link>}</li>)}</ul>
    </section>}

    <section className="panel">
      <h3 className="hop-h"><Icon name="log" size={17} />{L('হাজিরা ও ছুটি — কে কী', 'Attendance & leave — who')}</h3>
      <div className="da-seg hop-seg">{([['leave_applied', 'ছুটির আবেদন করেছেন', 'Applied for leave'], ['leave_not_applied', 'আবেদন ছাড়া ছুটি', 'Leave without applying'],
        ['absent', 'অনুপস্থিত', 'Absent'], ['new', 'নতুন কর্মী', 'New'], ['resigned', 'চাকরি ছেড়েছেন', 'Resigned'], ['all', 'সবাই', 'Everyone']] as const).map(([k, b, e]) =>
        <button key={k} type="button" className={who === k ? 'sm' : 'secondary sm'} onClick={() => setWho(k)}>{L(b, e)} ({n(k === 'all' ? s.people.length
          : s.people.filter(p => k === 'resigned' ? p.resigned : k === 'new' ? p.new : p[k] > 0).length)})</button>)}</div>
      <DataTable<PersonSummary> title={L('হাজিরা ও ছুটি', 'Attendance & leave')} file={`hub-ops-people-${s.from}-${s.to}`} prefKey="hub-ops-people" rows={people} phoneView="list"
        rowKey={p => `${p.hub_id}-${p.employee_id ?? p.person_name}`} empty={<p className="muted">{L('কেউ নেই।', 'Nobody.')}</p>}
        cols={[
          { key: 'name', label: L('নাম', 'Name'), primary: true, value: p => p.person_name,
            render: p => <><strong>{p.person_name}</strong><span className="sec">{[p.employee_code ? `#${p.employee_code}` : null, p.position, groupLabel(s.groups, p.group_key, L)].filter(Boolean).join(' · ')}
              {!p.in_hr && ` · ${L('এইচআর-এ নেই', 'not in HR')}`}</span></> },
          { key: 'hub', label: L('হাব', 'Hub'), value: p => p.hub_name },
          { key: 'present', label: L('উপস্থিত', 'Present'), value: p => p.present, render: p => n(p.present) },
          { key: 'absent', label: L('অনুপস্থিত', 'Absent'), value: p => p.absent, render: p => p.absent ? <span title={dates(p.absent_dates)}>{n(p.absent)}</span> : '0' },
          { key: 'la', label: L('ছুটি (আবেদন)', 'Leave (applied)'), value: p => p.leave_applied, render: p => n(p.leave_applied) },
          { key: 'lna', label: L('ছুটি (আবেদন নেই)', 'Leave (not applied)'), value: p => p.leave_not_applied, render: p => n(p.leave_not_applied) },
          { key: 'nm', label: L('বাকি', 'Not marked'), value: p => p.not_marked, render: p => n(p.not_marked) },
          { key: 'dates', label: L('তারিখ', 'Dates'), value: p => [p.leave_applied_dates.length ? `${L('আবেদন', 'applied')}: ${dates(p.leave_applied_dates)}` : '',
              p.leave_not_applied_dates.length ? `${L('আবেদন নেই', 'not applied')}: ${dates(p.leave_not_applied_dates)}` : '',
              p.absent_dates.length ? `${L('অনুপস্থিত', 'absent')}: ${dates(p.absent_dates)}` : ''].filter(Boolean).join(' · ') },
          { key: 'job', label: L('চাকরি', 'Employment'), value: p => p.resigned ? `${L('চাকরি ছেড়েছেন', 'Resigned')} ${dmy(p.resigned_date)}` : p.new ? `${L('নতুন', 'New')} ${dmy(p.new_date)}` : '',
            render: p => p.resigned ? <Badge tone="bad">{L(JOB.resigned[0], JOB.resigned[1])} {dmy(p.resigned_date)}</Badge> : p.new ? <Badge tone="info">{L(JOB.new[0], JOB.new[1])}</Badge> : null },
          { key: 'why', label: L('কারণ / মন্তব্য', 'Reason / remarks'), value: p => p.reasons.map(r => `${dmy(r.date)} ${[r.reason, r.remarks].filter(Boolean).join(' — ')}`).join(' | ') },
        ]} />
    </section>

    {reasons.length > 0 && <section className="panel">
      <h3 className="hop-h"><Icon name="note" size={17} />{L('অপারেশনের কারণ (কতবার)', 'Operational reasons (times)')}</h3>
      <div className="chips">{reasons.map(([r, c]) => <span key={r} className="chip">{r} <b>{n(c)}</b></span>)}</div>
    </section>}
    <p className="muted small">{L('সব সংখ্যা শুধু জমা দেওয়া রিপোর্ট থেকে। খসড়া, না-লেখা সংখ্যা বা না-দেওয়া হাজিরা কখনো ধরে নেওয়া হয় না — "—" মানে কেউ লেখেনি।',
      'Every figure comes from submitted reports only. Drafts, empty numbers and unmarked people are never assumed — "—" means nobody entered it.')}</p>
  </div>
}

const FIELD: Record<string, [string, string]> = {
  total_parcels: ['মোট পার্সেল', 'Total parcels'], total_pickups: ['মোট পিকআপ', 'Total pickups'], reasons: ['কারণ', 'Reasons'], remarks: ['মন্তব্য', 'Remarks'],
  status: ['অবস্থা', 'Status'], version: ['সংস্করণ', 'Version'], attendance: ['হাজিরা', 'Attendance'], employment: ['চাকরি', 'Employment'], reason: ['কারণ', 'Reason'],
  removed_at: ['সরানো', 'Removed'], person_name: ['নাম', 'Name'], position_id: ['পদ', 'Post'], note: ['বার্তা', 'Note'], review_note: ['রিভিউ মন্তব্য', 'Review note'],
  last_correction: ['সংশোধনের কারণ', 'Correction reason'],
}
const HIDE = new Set(['updated_at', 'updated_by', 'created_at', 'created_by', 'submitted_by', 'submitted_at', 'submitted_by_name', 'reviewed_by', 'reviewed_at', 'reviewed_by_name',
  'id', 'report_id', 'hub_id', 'zone_id', 'report_date', 'employee_id', 'group_key', 'mobile', 'snapshot', 'period_from', 'period_to', 'period_type'])

/** The history of a hub report or a boss report: who changed what (old → new), when and why. */
export function HistoryModal({ kind, id, title, onClose }: { kind: 'report' | 'boss'; id: string; title: string; onClose: () => void }) {
  const { L, lang } = usePrefs()
  const q = useLoad(() => hubOps.history(kind, id), [kind, id])
  const show = (k: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—'
    if (k === 'attendance' && typeof v === 'string' && v in ATT) { const a = ATT[v as keyof typeof ATT]; return L(a[0], a[1]) }
    if (k === 'employment' && typeof v === 'string' && v in JOB) { const j = JOB[v as keyof typeof JOB]; return L(j[0], j[1]) }
    if (k === 'status' && typeof v === 'string' && v in STATUS) { const s = STATUS[v as keyof typeof STATUS]; return L(s[0], s[1]) }
    if (k === 'removed_at') return L('হ্যাঁ', 'yes')
    return Array.isArray(v) ? v.join(', ') : String(v)
  }
  const at = (t: string) => new Date(t).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  return <Modal wide title={`${L('ইতিহাস', 'History')} — ${title}`} onClose={onClose} actions={<button className="secondary" onClick={onClose}>{L('বন্ধ', 'Close')}</button>}>
    {q.loading && <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>}
    {q.error ? <p className="da-error">{hubOpsFriendly(q.error)}</p> : null}
    {q.data && !q.data.length && <p className="muted">{L('কোনো বদল নেই।', 'No changes.')}</p>}
    <ol className="hop-history">{(q.data ?? []).map((h: HistoryRow) => {
      const keys = (h.action === 'INSERT' ? Object.keys(h.new ?? {}) : h.fields).filter(k => !HIDE.has(k) && (h.action !== 'INSERT' || (h.new?.[k] !== null && h.new?.[k] !== '' && !(Array.isArray(h.new?.[k]) && !(h.new?.[k] as unknown[]).length))))
      return <li key={h.id}>
        <div><b>{h.who}</b> <span className="muted small">{at(h.at)}</span>{' '}
          <Badge tone={h.action === 'INSERT' ? 'ok' : 'info'}>{h.action === 'INSERT' ? L('লেখা হয়েছে', 'Entered') : L('বদল', 'Changed')}</Badge>
          {h.table === 'hub_ops_staff' && h.person && <span className="chip">{h.person}</span>}</div>
        {h.reason && <div className="muted small">{L('কারণ', 'Reason')}: {h.reason}</div>}
        {keys.length > 0 && <ul>{keys.map(k => <li key={k}>{FIELD[k] ? L(FIELD[k][0], FIELD[k][1]) : k}: {h.action === 'INSERT' ? <b>{show(k, h.new?.[k])}</b>
          : <><s className="muted">{show(k, h.old?.[k])}</s> → <b>{show(k, h.new?.[k])}</b></>}</li>)}</ul>}
      </li>
    })}</ol>
  </Modal>
}
