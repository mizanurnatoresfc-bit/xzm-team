import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { usePrefs } from '../../lib/prefs'
import { supabase } from '../../lib/supabase'
import { Modal, useLoad } from '../accounts/ui'
import { TargetExplanation, useOwnDataEntryTargets } from './DataEntryTargets'
import './data-entry.css'

export const dataEntryPages = {
  live: ['লাইভ কন্ট্রোল', 'Live control'],
  team: ['টিম ও দায়িত্ব', 'Team and duties'],
  targets: ['টার্গেট ও কাজ বণ্টন', 'Targets and allocation'],
  reports: ['দৈনিক রিপোর্ট', 'Daily reports'],
  updates: ['কর্মীদের আপডেট', 'Employee updates'],
  performance: ['পারফরম্যান্স ও লিডারবোর্ড', 'Performance and leaderboard'],
} as const
export type EntryPage = keyof typeof dataEntryPages

type Choice = { id: string; name: string }
type FieldValue = string | number | boolean | null
type Values = Record<string, FieldValue>
type TeamRow = Choice & { attendance: string | null; expected: number | null; remaining: number | null; completed: number | null; limit: number | null }
type Report = { member_id: string; name: string; slot: number; attempted: number; merchants: number | null; entry_minutes: number | null; note: string; correct: number | null; reviewed_at: string | null }
type Duty = { id: string; member_id: string; name: string; kind: string; minutes: number; note: string; completed_at: string | null; approved_at: string | null }
type Update = { id: string; reporter: string; subject: string; kind: string; note: string; read_at: string | null; submitted_at: string }
type Performance = { member_id: string; name: string; accuracy: number | null; attempted: number; correct: number; merchants: number | null; verified_duties: number; verified_reports: number; senior_minutes: number; training_minutes: number; reference_count: number | null; reporting_note: string | null; collaboration_note: string | null; contribution_note: string | null; loading: number; big_parcel: number; assist: number; extra_entry: number }
type Opening = { date: string; parcels: number | null; merchants: number | null }
type Shift = {
  day: string; operating_day: string; running: boolean; can_review: boolean; can_assign: boolean; is_owner: boolean
  forecast: number | null; actual: number | null; unassigned: number | null
  reports?: Report[]; duties?: Duty[]; updates?: Update[]; team: TeamRow[]
  head_choices?: Choice[]; head?: { employee_id: string; verify_reports: boolean; assign_duties: boolean } | null
  schedule?: Values; opening?: Opening[]; performance?: Performance[]
}
type OwnHub = Choice & { day: string; running: boolean; attendance: string | null; due_slots: number[]; last_attempted: number | null; last_minutes: number | null; colleagues: Choice[]; duties: Duty[] }
type Own = { hubs: OwnHub[]; heads: Choice[] }
type Action = (name: string, values: Values, date?: string) => Promise<void>

const dutyNames: Record<string, [string, string]> = {
  extra_entry: ['অতিরিক্ত এন্ট্রি', 'Extra entry'], big_parcel: ['বিগ পার্সেল', 'Big parcels'],
  loading: ['গাড়ি লোড', 'Vehicle loading'], assist: ['অন্য কর্মীকে সহযোগিতা', 'Help a colleague'],
  senior: ['সিনিয়র দায়িত্ব', 'Senior duty'], training: ['প্রশিক্ষণ', 'Training'], other: ['অন্যান্য দায়িত্ব', 'Other duty'],
}
const updateNames: Record<string,[string,string]> = {
  attendance: ['উপস্থিতি', 'Attendance'], duty: ['দায়িত্ব', 'Duties'], support: ['সহযোগিতা', 'Support'],
  good_work: ['ভালো কাজ', 'Good work'], issue: ['সমস্যা', 'Issue'],
}
const attendanceNames: Record<string,[string,string]> = {
  present: ['উপস্থিত', 'Present'], late: ['দেরিতে উপস্থিত', 'Late'], half_day: ['অর্ধদিবস', 'Half day'],
  absent: ['অনুপস্থিত', 'Absent'], leave: ['ছুটি', 'Leave'], pending: ['হাজিরা বাকি', 'Attendance pending'],
}
const stages: [string,string][] = [['শুরুর রিপোর্ট', 'Opening report'], ['অগ্রগতি রিপোর্ট', 'Progress report'], ['শেষ রিপোর্ট', 'Closing report']]

async function rpc<T>(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data as T
}

function action(hub: string, day: string, name: string, values: Values) {
  return rpc('data_entry_shift_action', { p_hub: hub, p_day: day, p_action: name, p_values: values })
}
const numberValue = (data: FormData, key: string) => {
  const value = String(data.get(key) ?? '').trim()
  return value ? Number(value) : null
}
const fieldValue = (data: FormData, key: string) => String(data.get(key) ?? '')

function ActionForm({ onSave, children, label }: { onSave: (data: FormData) => Promise<void>; children?: ReactNode; label?: string }) {
  const { L } = usePrefs()
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setSending(true)
    setError('')
    setSent(false)
    try { await onSave(data); setSent(true) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSending(false) }
  }
  return <form onSubmit={submit}><fieldset className="data-entry-action" disabled={sending}>
    {children}
    <button type="submit">{label ?? L('সংরক্ষণ করুন', 'Save')}</button>
    {error && <p className="da-error" role="alert">{error}</p>}
    {sent && <span role="status"> {L('সংরক্ষিত', 'Saved')}</span>}
  </fieldset></form>
}
function Choose({ name, label, choices, value }: { name: string; label: string; choices: Choice[]; value?: string }) {
  return <label className="data-entry-field">{label}
    <select name={name} required defaultValue={value ?? ''}><option value="">—</option>
      {choices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
}
function Count({ name, label, value, max = 100000, min = 0, optional = false }: {
  name: string; label: string; value?: number | null; max?: number; min?: number; optional?: boolean
}) {
  return <label className="data-entry-field">{label}
    <input type="number" name={name} min={min} max={max} required={!optional} defaultValue={value ?? ''} />
  </label>
}
function Notes({ label, max = 250, required = false }: { label: string; max?: number; required?: boolean }) {
  return <label className="data-entry-field">{label}<textarea name="note" maxLength={max} required={required} rows={2} /></label>
}

export function DataEntryShiftHub({ hubs, page, delegated = false, renderTargetSettings }: {
  hubs: Choice[]; page: EntryPage; delegated?: boolean; renderTargetSettings?: (hub: Choice) => ReactNode
}) {
  const { L } = usePrefs()
  const [selected, setSelected] = useState('')
  const hub = hubs.find(h => h.id === selected) ?? hubs[0]
  if (!hub) return <p>{L('এই জোনে সক্রিয় হাব নেই।', 'This zone has no active hubs.')}</p>
  return <section className="panel data-entry-panel">
    <label className="data-entry-field">{L('হাব', 'Hub')}<select value={hub.id} onChange={e => setSelected(e.target.value)}>
      {hubs.map(h => <option value={h.id} key={h.id}>{h.name}</option>)}
    </select></label>
    <ShiftPanel key={hub.id + page} hub={hub.id} page={page} delegated={delegated} />
    {renderTargetSettings?.(hub)}
  </section>
}

function EntryMetrics({ metrics }: { metrics: { label: string; value: number | null }[] }) {
  const { n } = usePrefs()
  return <dl className="data-entry-metrics">
    {metrics.map(({ label, value }) => <div key={label}>
      <dt>{label}</dt><dd>{value == null ? '—' : n(value)}</dd>
    </div>)}
  </dl>
}

function LiveCharts({ data }: { data: Shift }) {
  const { L, n } = usePrefs()
  const pickups = [
    { label: L('সম্ভাব্য', 'Forecast'), value: data.forecast },
    { label: L('প্রকৃত', 'Actual'), value: data.actual },
  ]
  const pickupScale = Math.max(1, ...pickups.map(item => item.value ?? 0))
  return <div className="data-entry-charts">
    <section className="data-entry-chart">
      <h3>{L('পিকআপ তুলনা', 'Pickup comparison')}</h3>
      <ul>{pickups.map((item, index) => <li key={item.label}>
        <div className="data-entry-chart-label"><span>{item.label}</span><strong>{item.value == null ? '—' : n(item.value)}</strong></div>
        {item.value != null && <div className="data-entry-track" aria-hidden="true">
          <span className={index === 0 ? 'data-entry-forecast' : 'data-entry-verified'} style={{ width: `${item.value / pickupScale * 100}%` }} />
        </div>}
      </li>)}</ul>
      {data.actual == null && <p>{L('প্রকৃত পিকআপের হিসাব এখনও পাওয়া যায়নি।', 'Actual pickup count is pending.')}</p>}
    </section>
    <section className="data-entry-chart">
      <h3>{L('কর্মীভিত্তিক অগ্রগতি', 'Progress by employee')}</h3>
      {data.team.length === 0 && <p>{L('এই হাবে ডাটা এন্ট্রি কর্মী যোগ করা হয়নি।', 'No data entry employees are assigned to this hub.')}</p>}
      <ul>{data.team.map(person => {
        const total = person.completed != null && person.remaining != null ? person.completed + person.remaining : null
        const percent = total && person.completed != null ? person.completed / total * 100 : 0
        return <li key={person.id}>
          <div className="data-entry-chart-label">
            <strong>{person.name}</strong>
            <span>{L(...(attendanceNames[person.attendance ?? 'pending'] ?? ['হাজিরা দেখা যাবে', 'Attendance available']))}</span>
          </div>
          {total != null && total > 0 && <div className="data-entry-track data-entry-remaining" aria-hidden="true">
            <span className="data-entry-verified" style={{ width: `${percent}%` }} />
          </div>}
          <p>{L('যাচাইকৃত', 'Verified')} {person.completed == null ? '—' : n(person.completed)}
            {' · '}{L('প্রকৃত বাকি', 'Actual remaining')} {person.remaining == null ? '—' : n(person.remaining)}
            {person.expected != null && <> · {L('সম্ভাব্য টার্গেট', 'Forecast target')} {n(person.expected)}</>}
            {person.limit != null && <> · {L('সীমা', 'Limit')} {n(person.limit)}</>}
          </p>
        </li>
      })}</ul>
    </section>
  </div>
}

function ShiftPanel({ hub, page, delegated }: { hub: string; page: EntryPage; delegated: boolean }) {
  const { L, n } = usePrefs()
  const [date, setDate] = useState('')
  const state = useLoad(() => rpc<Shift>('data_entry_shift_control', { p_hub: hub, p_day: date || null }), [hub, date])
  const { reload } = state
  useEffect(() => {
    if ((page !== 'live' && !delegated) || date) return
    const timer = window.setInterval(() => void reload(),60_000)
    return () => window.clearInterval(timer)
  }, [page, delegated, date, reload])
  const data = state.data
  const save: Action = async (name, values, day) => {
    if (!data) return
    await action(hub, day ?? data.day, name, values)
    await reload()
  }
  const show = (v: number | null | undefined) => v == null ? '—' : n(v)
  const labels = (x: Record<string,[string,string]>) => Object.entries(x).map(([id,label]) => ({id, name:L(...label)}))
  if (state.error) return <p className="da-error" role="alert">{String(state.error)}</p>
  if (!data) return <p role="status">{L('লোড হচ্ছে…', 'Loading…')}</p>
  return <>
    {!delegated && (page === 'reports' || page === 'updates' || page === 'performance') &&
      <label className="data-entry-field">{L('রিপোর্টের তারিখ', 'Report date')}
        <input type="date" value={date || data.operating_day} max={data.operating_day} onChange={e => setDate(e.target.value)} />
      </label>}
    {page === 'live' && <>
      <p>{data.day} · {data.running ? L('শিফট চলছে', 'Shift active') : L('শিফট বন্ধ', 'Shift closed')}</p>
      <EntryMetrics metrics={[
        { label: L('সম্ভাব্য পিকআপ', 'Forecast pickups'), value: data.forecast },
        { label: L('প্রকৃত পিকআপ', 'Actual pickups'), value: data.actual },
        { label: L('বরাদ্দ বাকি', 'Unassigned'), value: data.unassigned },
        ...(data.can_review ? [{ label: L('যাচাইয়ের অপেক্ষায়', 'Awaiting review'), value: (data.reports ?? []).filter(report => !report.reviewed_at).length }] : []),
      ]} />
      <LiveCharts data={data} />
    </>}
    {page === 'targets' && <p>
      {data.day} · {data.running ? L('শিফট চলছে', 'Shift active') : L('শিফট বন্ধ', 'Shift closed')}
      {' · '}{L('সম্ভাব্য', 'Forecast')} <b>{show(data.forecast)}</b>
      {' · '}{L('প্রকৃত', 'Actual')} <b>{show(data.actual)}</b>
      {' · '}{L('বরাদ্দ বাকি', 'Unassigned')} <b>{show(data.unassigned)}</b></p>}
    {page === 'targets' && <ul className="data-entry-rows">{data.team.map(person => <li key={person.id}>
      <b>{person.name}</b> · {L(...(attendanceNames[person.attendance ?? 'pending'] ?? ['হাজিরা দেখা যাবে', 'Attendance available']))}
      {' · '}{L('সম্ভাব্য', 'Forecast')} {show(person.expected)} · {L('যাচাইকৃত', 'Verified')} {show(person.completed)}
      {' · '}{L('প্রকৃত কাজ বাকি', 'Actual remaining')} {show(person.remaining)}
      {person.limit != null && <> · {L('সীমা', 'Limit')} {show(person.limit)}</>}
    </li>)}</ul>}
    {(page === 'team' || delegated) && data.can_assign && <>
      {data.running && <details><summary>{L('অতিরিক্ত দায়িত্ব দিন', 'Assign an extra duty')}</summary>
        <ActionForm onSave={form => save('assign_duty',{member_id:fieldValue(form,'member'),kind:fieldValue(form,'kind'),entry_minutes:numberValue(form,'minutes'),note:fieldValue(form,'note'),override:form.has('override')})}>
          <Choose name="member" label={L('কর্মী', 'Employee')} choices={data.team.filter(p => data.is_owner || p.remaining === 0)} />
          <Choose name="kind" label={L('দায়িত্ব', 'Duty')} choices={labels(dutyNames)} />
          <Count name="minutes" label={L('সময় (মিনিট)', 'Time in minutes')} min={1} max={480} />
          {data.is_owner && <label className="data-entry-check"><input type="checkbox" name="override" />
            {L('বিশেষ প্রয়োজনে মূল টার্গেট বাকি থাকলেও দায়িত্ব দিন', 'Allow an exception when the base quota remains')}</label>}
          <Notes label={L('কারণ বা নির্দেশনা', 'Reason or instruction')} required />
        </ActionForm>
      </details>}
      <DutyList duties={data.duties ?? []} onAction={save} />
    </>}
    {page === 'live' && !delegated && data.can_review && <section>
      <h3>{L('যাচাইয়ের অপেক্ষায়', 'Awaiting review')}</h3>
      <ReportList reports={(data.reports ?? []).filter(report => !report.reviewed_at)} save={save}
        empty={L('যাচাইয়ের অপেক্ষায় কোনো রিপোর্ট নেই।', 'No reports are awaiting review.')} />
    </section>}
    {page === 'live' && data.is_owner && <details>
      <summary>{L('সন্ধ্যার শিফটে কর্মীর উপস্থিতি নিশ্চিত করুন', 'Confirm availability for the evening shift')}</summary>
      <ActionForm onSave={form => save('availability',{member_id:fieldValue(form,'member'),state:fieldValue(form,'state'),note:fieldValue(form,'note')})}>
        <Choose name="member" label={L('কর্মী', 'Employee')} choices={data.team} />
        <Choose name="state" label={L('শিফটের উপস্থিতি', 'Shift availability')}
          choices={labels(Object.fromEntries(Object.entries(attendanceNames).filter(([key]) => ['present','absent','late','half_day'].includes(key))))} />
        <Notes label={L('পরিবর্তনের কারণ', 'Reason for change')} required />
      </ActionForm>
    </details>}
    {page === 'live' && data.schedule && <details>
      <summary>{L('সন্ধ্যার শিফট ও তিনটি পপ-আপের সময়', 'Evening shift and three check-ins')}</summary>
      <Schedule settings={data.schedule} save={save} />
    </details>}
    {page === 'team' && data.is_owner && <details>
      <summary>{L('Data Entry Head ও অনুমতি', 'Data Entry Head and permissions')}</summary>
      <ActionForm onSave={form => save('appoint_head',{employee_id:fieldValue(form,'employee'),verify_reports:form.has('verify'),assign_duties:form.has('assign')})}>
        <Choose name="employee" label={L('হাব ম্যানেজার বা ডাটা এন্ট্রি কর্মী', 'Hub Manager or Data Entry employee')} choices={data.head_choices ?? []} value={data.head?.employee_id} />
        <label className="data-entry-check"><input name="verify" type="checkbox" defaultChecked={data.head?.verify_reports} />{L('রিপোর্ট যাচাই', 'Verify reports')}</label>
        <label className="data-entry-check"><input name="assign" type="checkbox" defaultChecked={data.head?.assign_duties} />{L('দায়িত্ব দেওয়া ও যাচাই', 'Assign and verify duties')}</label>
      </ActionForm>
      {data.head && <ActionForm label={L('Head-এর অনুমতি প্রত্যাহার', 'Revoke Head access')} onSave={() => save('revoke_head',{})} />}
    </details>}
    {page === 'targets' && <>
      <details><summary>{L('আজকের সর্বোচ্চ টার্গেট ঠিক করুন', 'Set today’s maximum quota')}</summary>
        <ActionForm onSave={form => save('limit',{member_id:fieldValue(form,'member'),maximum:numberValue(form,'maximum')})}>
          <Choose name="member" label={L('কর্মী', 'Employee')} choices={data.team} />
          <Count name="maximum" label={L('আজ মোট সর্বোচ্চ এন্ট্রি', 'Maximum total entries today')} />
        </ActionForm>
      </details>
      <details><summary>{L('শুরুর ৭ দিনের পিকআপ তথ্য', 'Opening pickup history for the last 7 days')}</summary>
        {(data.opening ?? []).map(item => <details key={item.date}><summary>{item.date} · {show(item.parcels)}</summary>
          <ActionForm onSave={form => save('seed_pickups',{parcels:numberValue(form,'parcels'),merchants:numberValue(form,'merchants')},item.date)}>
            <Count name="parcels" label={L('প্রকৃত পার্সেল', 'Actual parcels')} value={item.parcels} max={1000000} />
            <Count name="merchants" label={L('স্বতন্ত্র মার্চেন্ট', 'Distinct merchants')} value={item.merchants} optional />
          </ActionForm>
        </details>)}
      </details>
    </>}
    {(page === 'reports' || delegated) && data.can_review && <ReportList reports={data.reports ?? []} save={save} />}
    {page === 'updates' && <div>{!data.updates?.length && <p>{L('এই তারিখে কোনো আপডেট নেই।', 'No updates for this date.')}</p>}
      {data.updates?.map(item => <article key={item.id} className="data-entry-record">
        <b>{item.reporter} → {item.subject}</b> · {L(...updateNames[item.kind])}
        <p>{item.note}</p>
        {!item.read_at && <ActionForm label={L('দেখেছি', 'Mark read')} onSave={() => save('peer_read',{id:item.id})} />}
      </article>)}
    </div>}
    {page === 'performance' && <Leaderboard people={data.performance ?? []} />}
  </>
}
function Schedule({ settings, save }: { settings: Values; save: Action }) {
  const { L } = usePrefs()
  return <ActionForm onSave={form => save('schedule',{
    start_time:fieldValue(form,'start_time'),open_minutes:numberValue(form,'open_minutes'),first_minute:numberValue(form,'first_minute'),
    second_minute:numberValue(form,'second_minute'),third_minute:numberValue(form,'third_minute'),pickup_only:form.has('pickup_only'),
  })}>
    <p>{L('সময় বাংলাদেশ অনুযায়ী। রিপোর্টের মিনিটগুলো শিফট শুরুর পর থেকে গণনা হবে।', 'Times use Asia/Dhaka. Report offsets are minutes after the shift starts.')}</p>
    <label className="data-entry-field">{L('শিফট শুরু', 'Shift starts')}
      <input name="start_time" type="time" min="16:00" max="23:59" defaultValue={String(settings.start_time).slice(0,5)} required />
    </label>
    <Count name="open_minutes" label={L('শিফট মোট মিনিট', 'Shift length in minutes')} value={Number(settings.open_minutes)} min={180} max={720} />
    {['first_minute','second_minute','third_minute'].map((key,index) =>
      <Count key={key} name={key} label={L(...stages[index])} value={Number(settings[key])} max={719} />)}
    <label className="data-entry-check"><input type="checkbox" name="pickup_only" defaultChecked={Boolean(settings.pickup_only)} />
      {L('প্রকৃত পিকআপ অনুমোদনের পর রিপোর্ট দেখান', 'Prompt only after actual pickups are approved')}</label>
  </ActionForm>
}
function ReportList({ reports, save, empty }: { reports: Report[]; save: Action; empty?: string }) {
  const { L, n } = usePrefs()
  return <div>{!reports.length && <p>{empty ?? L('এই শিফটের কোনো রিপোর্ট জমা পড়েনি।', 'No reports submitted for this shift.')}</p>}
    {reports.map(r => <article className="data-entry-record" key={r.member_id + ':' + r.slot}>
      <b>{r.name} · {L(...stages[r.slot-1])}</b>
      <p>{L('জমা এন্ট্রি', 'Reported entries')} {n(r.attempted)}
        {r.merchants != null && <> · {L('মার্চেন্ট', 'Merchants')} {n(r.merchants)}</>}
        {r.entry_minutes != null && <> · {L('এন্ট্রি মিনিট', 'Entry minutes')} {n(r.entry_minutes)}</>}</p>
      {r.note && <p>{r.note}</p>}
      {r.reviewed_at ? <p>{L('যাচাইকৃত সঠিক', 'Verified correct')} {n(r.correct ?? 0)}</p> : <ActionForm
        label={L('যাচাই করুন', 'Verify')} onSave={form => save('review',{member_id:r.member_id,slot:r.slot,correct:numberValue(form,'correct')})}>
        <Count name="correct" label={L('যাচাইকৃত সঠিক এন্ট্রি', 'Verified correct entries')} max={r.attempted} />
      </ActionForm>}
    </article>)}
  </div>
}
function DutyList({ duties, onAction, own = false }: { duties: Duty[]; onAction: Action; own?: boolean }) {
  const { L, n } = usePrefs()
  return <ul className="data-entry-rows">{duties.map(duty => <li key={duty.id}>
    {!own && <><b>{duty.name}</b> · </>}{L(...dutyNames[duty.kind])} · {n(duty.minutes)} {L('মিনিট', 'minutes')}
    <p>{duty.note}</p>
    {duty.approved_at ? L('যাচাইকৃত', 'Verified') : duty.completed_at
      ? own ? L('যাচাই বাকি', 'Awaiting verification') : <ActionForm label={L('দায়িত্ব যাচাই', 'Verify duty')} onSave={() => onAction('approve_duty',{id:duty.id})} />
      : own ? <ActionForm label={L('কাজ শেষ করেছি', 'Mark completed')} onSave={() => onAction('complete_duty',{id:duty.id})} /> : L('কাজ চলছে', 'In progress')}
  </li>)}</ul>
}
function Leaderboard({ people }: { people: Performance[] }) {
  const { L, n } = usePrefs()
  const ranks = [...new Set(people.map(p => p.accuracy).filter((a): a is number => a != null))]
  return <>
    <p>{L('গত ৭ দিনের যাচাইকৃত নির্ভুলতার ভিত্তিতে স্থান। অন্তত ২০টি যাচাইকৃত এন্ট্রি প্রয়োজন। কম বরাদ্দ বা কম কাজ পাওয়ার জন্য কোনো স্কোর কাটা হয় না।',
      'Ranks use verified accuracy over seven days, with a minimum of 20 reviewed entries. Receiving less work does not deduct points.')}</p>
    <div>{people.map(p => <article className="data-entry-record" key={p.member_id}>
      <h3>{p.name} · {p.accuracy == null ? L('নমুনা কম', 'Insufficient sample') : n(ranks.indexOf(p.accuracy)+1) + ' · ' + n(p.accuracy) + '%'}</h3>
      <p>{L('সঠিক এন্ট্রি', 'Correct entries')} {n(p.correct)} / {n(p.attempted)}
        {' · '}{L('দৈনিক মার্চেন্টের যোগফল', 'Sum of daily merchant counts')} {p.merchants == null ? '—' : n(p.merchants)}
        {' · '}{L('যাচাইকৃত রিপোর্ট', 'Verified reports')} {n(p.verified_reports)}</p>
      <p>{L('যাচাইকৃত অতিরিক্ত দায়িত্ব', 'Verified extra duties')} {n(p.verified_duties)}
        {' · '}{L('সিনিয়র দায়িত্বের মিনিট', 'Senior duty minutes')} {n(p.senior_minutes)}
        {' · '}{L('প্রশিক্ষণ মিনিট', 'Training minutes')} {n(p.training_minutes)}
        {' · '}{L('রেফারেন্স', 'Referrals')} {p.reference_count == null ? '—' : n(p.reference_count)}</p>
      <p>{L('অতিরিক্ত এন্ট্রি', 'Extra entry')} {n(p.extra_entry)} · {L('বিগ পার্সেল', 'Big parcels')} {n(p.big_parcel)}
        {' · '}{L('গাড়ি লোড', 'Loading')} {n(p.loading)} · {L('সহযোগিতা', 'Support')} {n(p.assist)}</p>
      {[p.reporting_note,p.collaboration_note,p.contribution_note].filter(Boolean).map((note,index) => <p key={index}>{note}</p>)}
    </article>)}</div>
  </>
}
export function MyDataEntryShift({ children }: { children: ReactNode }) {
  const { session, viewAs } = useAuth()
  if (!session || viewAs) return <>{children}</>
  return <OwnShift key={session.user.id}>{children}</OwnShift>
}
function OwnShift({ children }: { children: ReactNode }) {
  const { L } = usePrefs()
  const state = useLoad(() => rpc<Own>('data_entry_shift_mine'), [])
  const { reload } = state
  const targets = useOwnDataEntryTargets()
  const reloadTargets = targets.reload
  const [dismissed, setDismissed] = useState<string[]>([])
  useEffect(() => {
    const timer = window.setInterval(() => { void reload(); void reloadTargets() }, 60_000)
    return () => window.clearInterval(timer)
  }, [reload, reloadTargets])
  const hubKey = (h: OwnHub, slot: number) => [h.id,h.day,slot].join(':')
  const due = (state.data?.hubs ?? []).flatMap(hub => ['present','late','half_day'].includes(hub.attendance ?? '')
    ? hub.due_slots.map(slot => ({ hub, slot })) : [])
  const popup = due.find(({hub,slot}) => !dismissed.includes(hubKey(hub,slot)))
  const unmatched = (targets.data ?? []).filter(report =>
    !state.data?.hubs.some(hub => hub.id === report.hub_id && hub.day === report.date))
  if (state.loading && !state.data && !state.error) return <p role="status">{L('লোড হচ্ছে…', 'Loading…')}</p>
  if (!state.data?.hubs.length && !state.data?.heads.length && !unmatched.length) return <>{children}</>
  const dedicated = Boolean(state.data?.hubs.length || unmatched.length)
  const save = (hub: OwnHub): Action => async (name,values) => { await action(hub.id,hub.day,name,values); await Promise.all([reload(), reloadTargets()]) }
  return <>
  <section className="panel data-entry-panel">
    <h2>{L('আজকের ডাটা এন্ট্রি', 'Today’s data entry')}</h2>
    {targets.error ? <p role="status">{L('সর্বশেষ টার্গেট লোড হয়নি।', 'Could not refresh the target.')}</p> : null}
    {unmatched.map(report => <TargetExplanation key={report.hub_id} report={report} />)}
    {state.data?.hubs.map(hub => {
      const report = targets.data?.find(item => item.hub_id === hub.id && item.date === hub.day)
      const worker = report?.worker
      const remaining = worker?.actual_remaining?.parcels ?? null
      const target = remaining == null || worker == null ? null : remaining + worker.completed
      return <article className="data-entry-record" key={hub.id}>
      <h3>{hub.name}</h3>
      <p>{hub.day} · {hub.running ? L('শিফট চলছে', 'Shift active') : L('শিফট বন্ধ', 'Shift closed')}</p>
      <EntryMetrics metrics={[
        { label: target == null ? L('সম্ভাব্য টার্গেট', 'Forecast target') : L('আজকের বরাদ্দ', 'Today’s allocation'), value: target ?? worker?.forecast?.parcels ?? null },
        { label: L('জমা এন্ট্রি', 'Reported entries'), value: hub.last_attempted },
        { label: L('যাচাইকৃত সম্পন্ন', 'Verified complete'), value: worker?.completed ?? null },
        { label: L('প্রকৃত কাজ বাকি', 'Actual remaining'), value: remaining },
      ]} />
      <section className="data-entry-chart" aria-label={L('আজকের অগ্রগতি', 'Today’s progress')}>
        <div className="data-entry-chart-label">
          <strong>{L('আজকের যাচাইকৃত অগ্রগতি', 'Verified progress today')}</strong>
          <strong>{target != null && target > 0 && worker != null ? Math.round(worker.completed / target * 100) + '%' : '—'}</strong>
        </div>
        {target != null && target > 0 && worker != null && <div className="data-entry-track data-entry-remaining" aria-hidden="true">
          <span className="data-entry-verified" style={{ width: Math.max(0, Math.min(100, worker.completed / target * 100)) + '%' }} />
        </div>}
        <EntryMetrics metrics={[
          { label: L('রিপোর্ট বাকি', 'Reports due'), value: due.filter(item => item.hub.id === hub.id).length },
          { label: L('এন্ট্রি মিনিট', 'Entry minutes'), value: hub.last_minutes },
          { label: L('দায়িত্ব সম্পন্ন', 'Duties completed'), value: hub.duties.filter(duty => duty.completed_at).length },
          { label: L('মোট দায়িত্ব', 'Total duties'), value: hub.duties.length },
        ]} />
        <p>{target == null ? L('প্রকৃত বরাদ্দ নিশ্চিত হওয়ার অপেক্ষায়।', 'Waiting for confirmed allocation.') : target === 0 ? L('বর্তমানে কোনো বরাদ্দ নেই।', 'No current allocation.') : L('জমা এন্ট্রি ও যাচাইকৃত এন্ট্রি আলাদা।', 'Reported and verified entries are separate.')}</p>
      </section>
      <section className="data-entry-chart" aria-label={L('আজকের রিপোর্ট', 'Today’s reports')}>
        <h3>{L('রিপোর্টের অবস্থা', 'Report status')}</h3>
        <ol>{stages.map((stage, index) => {
          const pending = due.some(item => item.hub.id === hub.id && item.slot === index + 1)
          return <li key={index}>
            <div className="data-entry-chart-label">
              <span>{L(...stage)}</span>
              <strong>{pending ? L('এখন জমা দিন', 'Due now') : L('এখন জমা দেওয়ার প্রয়োজন নেই', 'Not currently due')}</strong>
            </div>
            {pending && <button type="button" onClick={() => setDismissed(items => items.filter(k => k !== hubKey(hub,index + 1)))}>{L('রিপোর্ট খুলুন', 'Open report')}</button>}
          </li>
        })}</ol>
      </section>
      <section className="data-entry-chart" aria-label={L('কাজের সারাংশ', 'Work summary')}>
        <h3>{L('কাজের সারাংশ', 'Work summary')}</h3>
        <EntryMetrics metrics={[
          { label: L('যাচাইয়ের অপেক্ষায় দায়িত্ব', 'Completed duties awaiting approval'), value: hub.duties.filter(duty => duty.completed_at && !duty.approved_at).length },
          { label: L('অনুমোদিত দায়িত্ব', 'Approved duties'), value: hub.duties.filter(duty => duty.approved_at).length },
          { label: L('অসম্পূর্ণ দায়িত্ব', 'Incomplete duties'), value: hub.duties.filter(duty => !duty.completed_at).length },
        ]} />
        <p>{L('এন্ট্রি সময়', 'Entry time')}: {hub.last_minutes == null ? '—' : Math.floor(hub.last_minutes / 60) + ' ' + L('ঘণ্টা', 'h') + ' ' + (hub.last_minutes % 60) + ' ' + L('মিনিট', 'min')}</p>
      </section>
      <div className="data-entry-actions">
      {due.filter(item => item.hub.id === hub.id).map(({slot}) => <button type="button" key={slot}
        onClick={() => setDismissed(items => items.filter(k => k !== hubKey(hub,slot)))}>
        {L(...stages[slot - 1])} · {L('জমা দিন', 'Submit')}
      </button>)}
      </div>
      <StaffWeek hubId={hub.id} />
      {report && <TargetExplanation report={report} compact />}
      <DutyList duties={hub.duties} onAction={save(hub)} own />
      {!!hub.colleagues.length && <details><summary>{L('জোনাল ম্যানেজারকে আপডেট দিন', 'Update the Zonal Manager')}</summary>
        <ActionForm label={L('আপডেট পাঠান', 'Send update')}
          onSave={form => save(hub)('peer',{member_id:fieldValue(form,'member'),kind:fieldValue(form,'kind'),note:fieldValue(form,'note')})}>
          <Choose name="member" label={L('সহকর্মী', 'Colleague')} choices={hub.colleagues} />
          <Choose name="kind" label={L('আপডেটের ধরন', 'Update type')}
            choices={Object.entries(updateNames).map(([id,label]) => ({id,name:L(...label)}))} />
          <Notes label={L('কি হয়েছে?', 'What happened?')} max={500} required />
        </ActionForm>
      </details>}
    </article>
    })}
    {!!state.data?.heads.length && <details><summary>Data Entry Head</summary>
      <DataEntryShiftHub hubs={state.data.heads} page="live" delegated />
    </details>}
    {popup && <Modal key={hubKey(popup.hub,popup.slot)}
      title={popup.hub.name + ' · ' + L(...stages[popup.slot-1])}
      onClose={() => setDismissed(items => [...items,hubKey(popup.hub,popup.slot)])}
      actions={<button type="button" className="secondary" onClick={() => setDismissed(items => [...items,hubKey(popup.hub,popup.slot)])}>
        {L('পরে জমা দেব', 'Submit later')}
      </button>}>
      <p>{L('এই হাবে শিফটের শুরু থেকে এখন পর্যন্ত মোট সংখ্যা দিন।', 'Enter totals for this hub since the start of this shift.')}</p>
      <ActionForm label={L('রিপোর্ট জমা দিন', 'Submit report')}
        onSave={form => save(popup.hub)('report',{slot:popup.slot,attempted:numberValue(form,'attempted'),
          merchants:numberValue(form,'merchants'),entry_minutes:numberValue(form,'minutes'),note:fieldValue(form,'note')})}>
        <Count name="attempted" label={L('এখন পর্যন্ত মোট এন্ট্রি', 'Total entries so far')} value={popup.hub.last_attempted ?? 0} />
        <Count name="merchants" label={L('এখন পর্যন্ত স্বতন্ত্র মার্চেন্ট', 'Distinct merchants so far')} optional />
        <Count name="minutes" label={L('এখন পর্যন্ত প্রকৃত এন্ট্রি মিনিট', 'Actual entry minutes so far')} value={popup.hub.last_minutes ?? (popup.slot === 3 && !popup.hub.last_attempted ? 0 : null)} max={720} optional={popup.slot !== 3} />
        <Notes label={L('নোট (ঐচ্ছিক)', 'Note (optional)')} />
      </ActionForm>
    </Modal>}
  </section>
  {!dedicated && children}
  </>
}

function StaffWeek({ hubId }: { hubId: string }) {
  const { L } = usePrefs()
  const [week, setWeek] = useState<{rows: {work_date: string; hub_id: string; target: number | null; assigned: number | null; submitted: number | null; verified: number | null}[]} | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    supabase.rpc('data_entry_staff_week', {p_days: 7}).then(({data,error}) => {
      if (!active) return
      if (error || !data || !Array.isArray(data.rows)) setFailed(true)
      else setWeek(data)
    })
    return () => { active = false }
  }, [])
  const rows = (week?.rows ?? []).filter(row => row.hub_id === hubId).sort((a,b) => a.work_date.localeCompare(b.work_date))
  const max = Math.max(1, ...rows.flatMap(row => [row.target ?? 0,row.assigned ?? 0,row.submitted ?? 0,row.verified ?? 0]))
  return <section className="data-entry-chart">
    <h3>{L('আমার গত ৭ দিনের কাজ', 'My last seven days')}</h3>
    {failed ? <p role="status">{L('ইতিহাস এখন পাওয়া যাচ্ছে না।', 'History is currently unavailable.')}</p> : !week ? <p role="status">{L('লোড হচ্ছে…', 'Loading…')}</p> : !rows.length ? <p>{L('এই হাবে কাজের ইতিহাস নেই।', 'No work history for this hub.')}</p> : rows.map(row => <div key={row.work_date}>
      <strong>{row.work_date}</strong>
      {([{label:L('টার্গেট','Target'),value:row.target},{label:L('বরাদ্দ','Assigned'),value:row.assigned},{label:L('জমা','Submitted'),value:row.submitted},{label:L('যাচাইকৃত','Verified'),value:row.verified}]).map(item => <div key={item.label}>
        <div className="data-entry-chart-label"><span>{item.label}</span><strong>{item.value ?? '—'}</strong></div>
        {item.value != null && <div className="data-entry-track data-entry-remaining" aria-hidden="true"><span className="data-entry-verified" style={{width:Math.max(0,Math.min(100,item.value/max*100))+'%'}} /></div>}
      </div>)}
    </div>)}
  </section>
}
