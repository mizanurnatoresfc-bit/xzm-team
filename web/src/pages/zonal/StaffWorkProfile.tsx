import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { todayDhaka } from '../../lib/dailyAccounts'
import { usePrefs } from '../../lib/prefs'
import { ACTIVITY_LABEL, FIELD_MODULES, FUTURE_MODULES, MODULE_LABEL, STATUS_LABEL, staffProfile, type ModuleCount, type StaffProfile, type WorkEvent, type WorkModule, type WorkStatus } from '../../lib/staffProfile'
import { monthOf, useLiveLoad, wfFriendly } from '../../lib/workforce'
import { Badge, Field, Stat, useLoad } from '../accounts/ui'
import { ChipTabs, Empty, Loading, Notice, Section, fmtDay, fmtStamp, lastMonths, monthEnd, monthName, useHubList } from '../workforce/shared'
import '../../morning.css'

/**
 * কর্মীর কাজের প্রোফাইল — zone → hub → person. One page for who the person is and what they are assigned to (with the history),
 * their attendance and leave, their routes, and the work they have submitted in every module. The key is the permanent employee id;
 * work keeps the hub and the day it was done on. Drafts and submitted lines are shown apart. The page adds no permission:
 * the database sends only what the viewer may see.
 */
type Part = 'identity' | 'attendance' | 'field' | 'other'
const TONE: Record<WorkStatus, 'ok' | 'warn' | 'bad' | 'info'> = { submitted: 'ok', approved: 'ok', draft: 'warn', cancelled: 'bad' }

export function StaffWorkProfilePage() {
  const { L, lang } = usePrefs()
  const [sp, setSp] = useSearchParams()
  const nav = useNavigate()
  const hubsQ = useHubList()
  const zones = hubsQ.data?.zones ?? []
  const allHubs = hubsQ.data?.hubs ?? []
  const emp = sp.get('emp') ?? ''
  const put = (patch: Record<string, string | null>) => setSp(p => { const q = new URLSearchParams(p); for (const [k, v] of Object.entries(patch)) { if (v) q.set(k, v); else q.delete(k) } return q }, { replace: true })

  const today = todayDhaka()
  const month = sp.get('month') && /^\d{4}-\d{2}-01$/.test(sp.get('month')!) ? sp.get('month')! : monthOf(today)
  const from = month; const to = monthEnd(month) > today ? today : monthEnd(month)

  const profileQ = useLiveLoad<StaffProfile | null>(() => emp ? staffProfile.get(emp, from, to) : Promise.resolve(null), [emp, from, to], ['att_day_sheets'])
  const p = profileQ.data && profileQ.data.person.id === emp ? profileQ.data : null

  // the pickers follow the person when one is opened by address (from the staff list)
  const zone = sp.get('zone') ?? p?.person.zone_id ?? (zones.length === 1 ? zones[0].id : '')
  const hubs = useMemo(() => allHubs.filter(h => !zone || h.zone_id === zone), [allHubs, zone])
  const hub = sp.get('hub') ?? p?.person.hub_id ?? (hubs.length === 1 ? hubs[0].id : '')
  const peopleQ = useLoad(() => hub ? staffProfile.people(hub) : Promise.resolve([]), [hub])

  const [part, setPart] = useState<Part>('identity')
  const parts: Array<{ key: Part; label: string }> = [
    { key: 'identity', label: L('পরিচয় ও দায়িত্ব', 'Identity and duty') }, { key: 'attendance', label: L('হাজিরা ও ছুটি', 'Attendance and leave') },
    { key: 'field', label: L('মাঠের কাজ', 'Field work') }, { key: 'other', label: L('অন্যান্য কাজ', 'Other work') }]
  useEffect(() => { if (p) document.title = `${p.person.name} — ${L('কাজের প্রোফাইল', 'Work profile')}` }, [p, L])

  return <AppShell title={L('কর্মীর কাজের প্রোফাইল', 'Staff work profile')}
    subtitle={L('জোন → হাব → কর্মী: পরিচয়, দায়িত্ব, হাজিরা ও ছুটি, রুট এবং প্রতিটি মডিউলে জমা দেওয়া কাজ।', 'Zone → hub → person: identity, duty, attendance and leave, routes, and the work submitted in every module.')}>
    <div className="wm">
      <section className="panel wm-top no-print">
        {zones.length > 1 && <Field label={L('জোন', 'Zone')}><select value={zone} onChange={e => put({ zone: e.target.value || null, hub: null, emp: null })}><option value="">{L('সব জোন', 'All zones')}</option>{zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>}
        <Field label={L('হাব', 'Hub')}><select value={hub} onChange={e => put({ hub: e.target.value || null, emp: null })}><option value="">{L('হাব বাছুন', 'Pick a hub')}</option>{hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
        <Field label={L('কর্মী', 'Person')}><select value={emp} disabled={!hub} onChange={e => put({ emp: e.target.value || null })}>
          <option value="">{L('কর্মী বাছুন', 'Pick a person')}</option>
          {(peopleQ.data ?? []).map(x => <option key={x.id} value={x.id}>{x.name}{x.code ? ` · ${x.code}` : ''}{x.status !== 'active' ? ` (${x.status})` : ''}</option>)}</select></Field>
        <Field label={L('মাস', 'Month')}><select value={month} onChange={e => put({ month: e.target.value })}>{lastMonths(today, 4).map(m => <option key={m} value={m}>{monthName(m, lang)}</option>)}</select></Field>
      </section>
      {hubsQ.error ? <p className="da-error" role="alert">{wfFriendly(hubsQ.error)}</p> : null}
      {peopleQ.error ? <p className="da-error" role="alert">{wfFriendly(peopleQ.error)}</p> : null}
      {!emp && <Notice>{L('উপরে হাব ও কর্মী বেছে নিন।', 'Pick a hub and a person above.')}</Notice>}
      {emp && profileQ.error && !p ? <p className="da-error" role="alert">{wfFriendly(profileQ.error)}</p> : null}
      {emp && !p && !profileQ.error ? <Loading /> : null}
      {p && <>
        <header className="swp-head panel">
          <div><h2>{p.person.name}{p.person.code ? <span className="muted"> · {p.person.code}</span> : null}</h2>
            <p className="muted">{[p.person.position, p.person.hub, p.person.zone].filter(Boolean).join(' · ')}</p></div>
          <div className="swp-badges">{p.person.status !== 'active' && <Badge tone="bad">{p.person.status}</Badge>}
            {p.person.focus && <Badge tone="info">{p.person.focus.label}</Badge>}
            {p.backup && <Badge tone="info">{L('ব্যাকআপ রাইডার', 'Backup rider')}</Badge>}
            <Link className="secondary sm btn-ghost" to={`/app/hr/employees/${p.person.id}`}><Icon name="user" size={14} />{L('HR প্রোফাইল', 'HR profile')}</Link></div>
        </header>
        <ModuleStrip modules={p.modules} />
        <ChipTabs<Part> tabs={parts} value={part} onChange={setPart} label={L('প্রোফাইলের অংশ', 'Profile parts')} />
        {part === 'identity' && <Identity p={p} />}
        {part === 'attendance' && <AttendancePart p={p} />}
        {part === 'field' && <WorkPart p={p} modules={FIELD_MODULES} title={L('মাঠের কাজ', 'Field work')} nav={nav} showRoutes />}
        {part === 'other' && <WorkPart p={p} modules={[...FUTURE_MODULES, 'attendance']} title={L('অন্যান্য কাজ', 'Other work')} nav={nav} future />}
      </>}
    </div>
  </AppShell>
}

/** Per module: submitted and draft counts — the same record is counted once, however often it was written again. */
function ModuleStrip({ modules }: { modules: ModuleCount[] }) {
  const { L, n } = usePrefs()
  if (!modules.length) return null
  return <div className="da-stats" role="list" aria-label={L('মডিউল অনুযায়ী কাজ', 'Work by module')}>
    {modules.map(m => <Stat key={m.module} label={L(...MODULE_LABEL[m.module])} value={n(m.submitted)}
      sub={[m.draft ? `${L('খসড়া', 'draft')} ${n(m.draft)}` : '', m.cancelled ? `${L('বাতিল', 'cancelled')} ${n(m.cancelled)}` : ''].filter(Boolean).join(' · ') || undefined} tone={m.draft ? 'warn' : undefined} />)}
  </div>
}

function Identity({ p }: { p: StaffProfile }) {
  const { L, lang } = usePrefs()
  const x = p.person
  return <>
    <Section title={L('পরিচয়', 'Identity')}>
      <dl className="swp-dl">
        <div><dt>{L('স্থায়ী কর্মী আইডি', 'Permanent staff ID')}</dt><dd>{x.code ?? '—'}</dd></div>
        <div><dt>{L('লগইনের যোগ', 'Login linked')}</dt><dd>{x.has_login ? L('আছে', 'Yes') : L('নেই', 'No')}</dd></div>
        <div><dt>{L('বর্তমান হাব', 'Hub now')}</dt><dd>{x.hub ?? '—'}</dd></div>
        <div><dt>{L('জোন', 'Zone')}</dt><dd>{x.zone ?? '—'}</dd></div>
        <div><dt>{L('পদ', 'Position')}</dt><dd>{x.position ?? '—'}{x.focus ? ` · ${x.focus.label}` : ''}</dd></div>
        <div><dt>{L('বিভাগ', 'Department')}</dt><dd>{x.department ?? '—'}</dd></div>
        <div><dt>{L('রিপোর্টিং ম্যানেজার', 'Reports to')}</dt><dd>{x.manager ?? '—'}</dd></div>
        <div><dt>{L('যোগদান', 'Joined')}</dt><dd>{x.joining_date ? fmtDay(x.joining_date, lang) : '—'}</dd></div>
      </dl>
    </Section>
    <Section title={L('বর্তমান দায়িত্ব', 'Duties now')} hint={L('পদের সাধারণ দায়িত্ব আর এই কর্মীর নির্দিষ্ট দায়িত্ব — দুটোই এখানে।', 'The duties of the post and the duties given to this person.')}>
      {!p.duties.length ? <Empty>{L('কোনো দায়িত্ব লেখা নেই।', 'No duty written.')}</Empty> :
        <ul className="swp-duties">{p.duties.map(d => <li key={d.id}><b>{d.title}</b> <Badge tone={d.source === 'person' ? 'info' : 'neutral'}>{d.source === 'person' ? L('এই কর্মীর', 'Personal') : L('পদের', 'Of the post')}</Badge>
          {d.details && <p className="muted small">{d.details}</p>}</li>)}</ul>}
    </Section>
    <Section title={L('দায়িত্বের ইতিহাস', 'Assignment history')} hint={L('বদলি হলে নতুন হাবের দায়িত্ব কার্যকর তারিখ থেকে শুরু হয়। আগের কাজে সেই সময়ের হাব ও তারিখই থাকে।', 'After a transfer the new hub’s duty counts from its effective date; earlier work keeps its own hub and day.')}>
      {!p.assignments.length ? <Empty>{L('কোনো রেকর্ড নেই।', 'No record.')}</Empty> :
        <div className="da-table-wrap"><table className="da-table"><thead><tr><th>{L('কার্যকর', 'From')}</th><th>{L('পর্যন্ত', 'To')}</th><th>{L('ধরন', 'Type')}</th><th>{L('পদ', 'Position')}</th><th>{L('হাব', 'Hub')}</th><th>{L('কারণ', 'Reason')}</th></tr></thead>
          <tbody>{p.assignments.map((a, i) => <tr key={i}><td data-label={L('কার্যকর', 'From')}>{fmtDay(a.from, lang)}</td><td data-label={L('পর্যন্ত', 'To')}>{a.to ? fmtDay(a.to, lang) : L('চলছে', 'now')}</td>
            <td data-label={L('ধরন', 'Type')}>{a.type}</td><td data-label={L('পদ', 'Position')}>{a.position ?? '—'}</td><td data-label={L('হাব', 'Hub')}>{a.hub ?? '—'}</td><td data-label={L('কারণ', 'Reason')} className="wm-wrap">{a.reason ?? '—'}</td></tr>)}</tbody></table></div>}
    </Section>
  </>
}

function AttendancePart({ p }: { p: StaffProfile }) {
  const { L, n, lang } = usePrefs()
  const a = p.attendance
  const label = (s: string | null) => s ? L(...(ACTIVITY_LABEL[s] ?? [s, s])) : '—'
  return <>
    <Section title={`${L('হাজিরা', 'Attendance')} — ${fmtDay(p.from, lang)} – ${fmtDay(p.to, lang)}`}
      hint={L('জমা-দেওয়া দৈনিক খাতার নিজের সারি থেকে। যে খাতা এখনো খসড়া, তা আলাদা গোনা হয়।', 'From the person’s own lines of the submitted daily registers. A register still a draft is counted apart.')}>
      <div className="da-stats">
        <Stat icon="check" tone="ok" label={L('উপস্থিত', 'Present')} value={n(a.present)} sub={a.late ? `${L('দেরি', 'late')} ${n(a.late)}` : undefined} />
        <Stat icon="x" tone={a.absent ? 'bad' : undefined} label={L('অনুপস্থিত', 'Absent')} value={n(a.absent)} sub={a.unauthorized ? `${L('না জানিয়ে', 'without telling')} ${n(a.unauthorized)}` : undefined} />
        <Stat icon="log" label={L('ছুটি', 'Leave')} value={n(a.leave)} sub={a.off ? `${L('সরকারি/সাপ্তাহিক', 'holiday/off')} ${n(a.off)}` : undefined} />
        <Stat icon="alert" tone={a.unchecked ? 'warn' : undefined} label={L('যাচাই বাকি', 'Not checked')} value={n(a.unchecked)} />
        <Stat icon="form" tone={a.drafts ? 'warn' : undefined} label={L('খসড়া খাতায়', 'In draft registers')} value={n(a.drafts)} />
      </div>
      {!a.days.length ? <Empty>{L('এই সময়ে কোনো খাতায় সারি নেই।', 'No register line in this period.')}</Empty> :
        <div className="da-table-wrap"><table className="da-table"><thead><tr><th>{L('দিন', 'Day')}</th><th>{L('হাব', 'Hub')}</th><th>{L('হাজিরা', 'Status')}</th><th>{L('খাতা', 'Register')}</th><th>{L('বিবরণ', 'Details')}</th></tr></thead>
          <tbody>{a.days.map((d, i) => <tr key={i}><td data-label={L('দিন', 'Day')}>{fmtDay(d.date, lang)}</td><td data-label={L('হাব', 'Hub')}>{d.hub ?? '—'}</td>
            <td data-label={L('হাজিরা', 'Status')}><Badge tone={d.status === 'absent' ? 'bad' : d.status === 'unchecked' || d.status === 'pending_leave' ? 'warn' : d.status === 'leave' ? 'info' : 'ok'}>{label(d.status)}</Badge></td>
            <td data-label={L('খাতা', 'Register')}><Badge tone={d.sheet_status === 'submitted' ? 'ok' : 'warn'}>{d.sheet_status === 'submitted' ? `${L('জমা', 'Submitted')} · ${L('সং', 'v')}${n(d.version)}${d.mode === 'auto' ? ` · ${L('সার্ভার', 'server')}` : ''}` : L('খসড়া', 'Draft')}</Badge></td>
            <td data-label={L('বিবরণ', 'Details')} className="wm-wrap">{[d.late_time && `${L('আসা', 'at')} ${d.late_time}`, d.unauthorized ? L('না জানিয়ে', 'without telling') : null, d.absence_reason,
              d.leave_ref && `${d.leave_ref}${d.leave_applied_on ? ` · ${L('আবেদন', 'applied')} ${fmtDay(d.leave_applied_on, lang)}` : ''}`,
              d.online_marked === true ? `${L('অনলাইন হাজিরা', 'online')} ${d.online_at ? fmtStamp(d.online_at, lang) : ''}` : d.online_marked === false ? L('অনলাইন হাজিরা নেই', 'no online mark') : null].filter(Boolean).join(' · ') || '—'}</td></tr>)}</tbody></table></div>}
    </Section>
    <Section title={L('ছুটি', 'Leave')}>
      {p.leave === null ? <Empty>{L('ছুটির তথ্য দেখার অনুমতি নেই।', 'You may not see leave records.')}</Empty> : !p.leave.length ? <Empty>{L('এই সময়ে কোনো ছুটির আবেদন নেই।', 'No leave request in this period.')}</Empty> :
        <div className="da-table-wrap"><table className="da-table"><thead><tr><th>{L('রেফারেন্স', 'Reference')}</th><th>{L('তারিখ', 'Dates')}</th><th>{L('দিন', 'Days')}</th><th>{L('আবেদনের তারিখ', 'Applied on')}</th><th>{L('অবস্থা', 'State')}</th></tr></thead>
          <tbody>{p.leave.map(l => <tr key={l.ref}><td data-label={L('রেফারেন্স', 'Reference')}>{l.ref}</td><td data-label={L('তারিখ', 'Dates')}>{fmtDay(l.from, lang)}{l.to !== l.from ? ` – ${fmtDay(l.to, lang)}` : ''}</td>
            <td data-label={L('দিন', 'Days')}>{n(l.days)}</td><td data-label={L('আবেদনের তারিখ', 'Applied on')}>{fmtDay(l.applied_on, lang)}</td>
            <td data-label={L('অবস্থা', 'State')}><Badge tone={l.status === 'approved' ? 'ok' : l.status === 'pending' ? 'warn' : 'neutral'}>{l.status === 'approved' ? L('অনুমোদিত', 'Approved') : l.status === 'pending' ? L('বিচারাধীন', 'Waiting') : l.status}</Badge></td></tr>)}</tbody></table></div>}
    </Section>
  </>
}

function WorkPart({ p, modules, title, nav, showRoutes, future }: { p: StaffProfile; modules: WorkModule[]; title: string; nav: (to: string) => void; showRoutes?: boolean; future?: boolean }) {
  const { L, n, lang } = usePrefs()
  const [status, setStatus] = useState<'all' | WorkStatus>('all')
  const rows = p.events.filter((e: WorkEvent) => modules.includes(e.module) && (status === 'all' || e.status === status))
  const futureUnused = future ? FUTURE_MODULES.filter(m => !p.connected.includes(m)) : []
  return <>
    {showRoutes && <Section title={L('রুট', 'Routes')} hint={L('মূল রুট রাইডারের নিজের রুট; ব্যাকআপ রাইডার খালি রুটে সেদিন বসানো হলে প্রকাশিত প্ল্যানে আসে।', 'The routes the rider rides; a backup appears on the published plan the day they are placed.')}>
      {!p.routes.length ? <Empty>{L('কোনো মূল রুট নেই।', 'No regular route.')}{p.backup ? ` ${L('ব্যাকআপ হিসেবে চিহ্নিত।', 'Marked as a backup.')}` : ''}</Empty> :
        <ul className="swp-duties">{p.routes.map(r => <li key={r.route_id}><b>{r.code}</b> · {r.name} <span className="muted small">— {r.hub ?? ''} · {L('থেকে', 'from')} {fmtDay(r.from, lang)}</span></li>)}</ul>}
    </Section>}
    <Section title={title} tools={<Field label={L('অবস্থা', 'State')}><select value={status} onChange={e => setStatus(e.target.value as 'all' | WorkStatus)}>
      <option value="all">{L('সব', 'All')}</option>{(['submitted', 'draft', 'cancelled'] as WorkStatus[]).map(s => <option key={s} value={s}>{L(...STATUS_LABEL[s])}</option>)}</select></Field>}
      hint={L('প্রতিটি লাইনে হাব, কাজের দিন, মডিউল, কার্যক্রম, অবস্থা ও সার্ভারের সময় আছে। একই মডিউলের একই রেকর্ড-সংস্করণ একবারই গোনা হয়।', 'Each line has the hub, the day, the module, the activity, the state and the server time. The same module record and version is counted once.')}>
      {future && <p className="notice wm-note" role="note"><Icon name="alert" size={14} /> {L('সমস্যা কেন্দ্র, গাড়ি/জ্বালানি ও হিসাব এখনো প্রোফাইলে যুক্ত হয়নি — যুক্ত হলে তাদের জমা কাজ এখানে আসবে। (এখনো যুক্ত নয়:', 'Problem Center, vehicle/fuel and accounts are not connected yet — their submitted work will appear here. (Not connected yet:')} {futureUnused.map(m => L(...MODULE_LABEL[m])).join(', ')})</p>}
      {!rows.length ? <Empty>{L('এই সময়ে কোনো কাজ নেই।', 'No work in this period.')}</Empty> :
        <div className="da-table-wrap"><table className="da-table"><thead><tr><th>{L('কাজের দিন', 'Work day')}</th><th>{L('মডিউল', 'Module')}</th><th>{L('কার্যক্রম', 'Activity')}</th><th>{L('হাব', 'Hub')}</th><th>{L('অবস্থা', 'State')}</th><th>{L('সার্ভার সময়', 'Server time')}</th><th /></tr></thead>
          <tbody>{rows.map(e => <tr key={e.id}><td data-label={L('কাজের দিন', 'Work day')}>{fmtDay(e.date, lang)}</td><td data-label={L('মডিউল', 'Module')}>{L(...MODULE_LABEL[e.module])}</td>
            <td data-label={L('কার্যক্রম', 'Activity')}>{L(...(ACTIVITY_LABEL[e.activity] ?? [e.activity, e.activity]))}{e.version > 1 ? <span className="muted small"> · {L('সংস্করণ', 'v')}{n(e.version)}</span> : null}</td>
            <td data-label={L('হাব', 'Hub')}>{e.hub ?? '—'}</td><td data-label={L('অবস্থা', 'State')}><Badge tone={TONE[e.status]}>{L(...STATUS_LABEL[e.status])}</Badge></td>
            <td data-label={L('সার্ভার সময়', 'Server time')}>{fmtStamp(e.server_time, lang)}</td>
            <td>{e.link && <button type="button" className="secondary sm" onClick={() => nav(e.link!)}>{L('মূল রেকর্ড', 'Source')}</button>}</td></tr>)}</tbody></table></div>}
    </Section>
  </>
}
