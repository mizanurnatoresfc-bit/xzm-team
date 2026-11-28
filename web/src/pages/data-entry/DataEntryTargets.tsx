import { useState, type FormEvent } from 'react'
import { usePrefs } from '../../lib/prefs'
import { supabase } from '../../lib/supabase'
import { pickRemembered, rememberHub, rememberedHub } from '../../lib/zoneHubMemory'
import { useLoad } from '../accounts/ui'
import './data-entry.css'

type Choice = { id: string; name: string }
type NumberMap = Record<string, number | string | null>
type Allocation = { parcels: number; capacity: number; share: number }
type Totals = { assignable: number; total_capacity: number; unassigned: number }
type History = { id: number; recorded_at: string; reason: string; forecast_pickups?: number | null; actual_pickups?: number | null; forecast_target: number | null; actual_remaining: number | null }
type Summary = {
  forecast_pickups: number | null; forecast_sample_days: number; forecast_work_points: number | null
  forecast_days: { date: string; verified_parcels: number | null; merchants?: number | null; source?: string | null }[]
  actual_pickups: number | null; actual_merchants: number; complex_parcels: number | null
  actual_work_points: number | null; verified_completed: number
  forecast_summary: Totals; actual_summary: Totals | null
  distribution_mode?: 'smart' | 'equal'
  fair_equal_share_parcels?: number | null
}
type Detail = {
  attendance: string; hub_count: number; working_minutes: number | null; break_minutes: number | null
  duty_minutes: number; assigned_duty_minutes?: number; daily_limit?: number | null; entry_minutes: number; duty_detail: Record<string, number>
  forecast_hub_minutes: number | null; remaining_hub_minutes: number | null; worked_minutes: number
  parcel_rate: number | null; point_rate: number | null; parcel_rate_source: string; point_rate_source: string
  parcel_sample_days: number; parcel_sample_minutes: number; point_sample_days: number; point_sample_minutes: number
  prior_accuracy_pct: number | null; forecast: Allocation | null; actual_remaining: Allocation | null; completed: number
}
type Report = { hub: string; hub_id: string; date: string; enabled: boolean; summary: Summary; worker: Detail | null; history: History[] }
type TargetAdmin = {
  enabled: boolean; distribution_mode?: 'smart' | 'equal'; complex_parcels: number | null; team: Choice[]
  rule: NumberMap | null; observation: NumberMap | null; profile: NumberMap | null
  latest: Summary | null; history: History[]
}
const dhakaDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

async function targetRpc<T>(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data as T
}

export function useOwnDataEntryTargets() {
  return useLoad(() => targetRpc<Report[]>('data_entry_target_mine', { p_day: null }), [])
}

const rateSources: Record<string, [string, string]> = {
  verified: ['যাচাইকৃত কাজের ইতিহাস', 'Verified work history'],
  approved_initial: ['অনুমোদিত প্রাথমিক সক্ষমতা', 'Approved starting capacity'],
  missing: ['সক্ষমতার তথ্য বাকি', 'Capacity data still needed'],
}
const attendanceNames: Record<string, [string, string]> = {
  present: ['উপস্থিত', 'Present'], late: ['দেরিতে উপস্থিত', 'Late'], half_day: ['অর্ধদিবস', 'Half day'],
  absent: ['অনুপস্থিত', 'Absent'], leave: ['ছুটি', 'On leave'], holiday: ['ছুটির দিন', 'Holiday'],
  weekly_off: ['সাপ্তাহিক ছুটি', 'Weekly off'], pending: ['হাজিরা নিশ্চিত হয়নি', 'Attendance pending'],
}
const reasonNames: Record<string, [string, string]> = {
  limit: ['জোনাল ম্যানেজার সীমা বদলেছেন', 'Zonal Manager changed the limit'],
  seed_pickups: ['শুরুর পিকআপ তথ্য বদলেছে', 'Opening pickup history changed'],
  shift_report_verified: ['শিফট রিপোর্ট যাচাই হয়েছে', 'Shift report verified'],
  extra_duty_assigned: ['অতিরিক্ত দায়িত্ব দেওয়া হয়েছে', 'Extra duty assigned'],
  availability: ['সন্ধ্যার হাজিরা বদলেছে', 'Evening availability changed'],
  first_calculation: ['প্রথম হিসাব', 'First calculation'],
  verified_pickup_changed: ['যাচাইকৃত পিকআপ বদলেছে', 'Verified pickup changed'],
  verified_history_changed: ['যাচাইকৃত পিকআপের ইতিহাস বদলেছে', 'Verified pickup history changed'],
  attendance_capacity_or_roster_changed: ['হাজিরা, সক্ষমতা বা টিমের তথ্য বদলেছে', 'Attendance, capacity or roster changed'],
  hub_updated: ['হাব সেটিংস বদলেছে', 'Hub settings changed'],
  rule_updated: ['শিফট বা প্রাথমিক সক্ষমতা বদলেছে', 'Shift or starting capacity changed'],
  observation_updated: ['অনুমোদিত কাজ বা দায়িত্বের তথ্য বদলেছে', 'Verified work or duty changed'],
  complexity_updated: ['পিকআপের জটিলতার তথ্য বদলেছে', 'Pickup complexity changed'],
}
const duties: [string, string, string][] = [
  ['senior_minutes', 'সিনিয়র দায়িত্ব', 'Senior duties'], ['loading_minutes', 'গাড়ি লোড', 'Vehicle loading'],
  ['big_parcel_minutes', 'বিগ পার্সেল', 'Big parcels'], ['training_minutes', 'প্রশিক্ষণ', 'Training'],
  ['other_minutes', 'অন্যান্য দায়িত্ব', 'Other duties'],
]

export function TargetExplanation({ report, compact = false }: { report: Report; compact?: boolean }) {
  const { L, n } = usePrefs()
  const { summary: s, worker: w } = report
  const show = (value: number | string | null | undefined) => value == null ? '—' : typeof value === 'number' ? n(value) : value
  const localized = (dict: Record<string, [string, string]>, key: string | number | null) => key && dict[key] ? L(...dict[key]) : '—'
  return <section>
    {!compact && <h3>{report.hub} · {report.date}</h3>}
    {!report.enabled && <p>{L('এই হাবে অটো বণ্টন বন্ধ। এখানে সর্বশেষ হিসাবের ইতিহাস দেখা যাচ্ছে।', 'Automatic distribution is paused at this hub. The last calculation is shown for reference.')}</p>}
    {!compact && <p>{L('সম্ভাব্য টার্গেট', 'Forecast target')} <strong>{show(w?.forecast?.parcels)}</strong>
      {' · '}{L('প্রকৃত বরাদ্দ বাকি', 'Actual allocation remaining')} <strong>{show(w?.actual_remaining?.parcels)}</strong>
      {' · '}{L('যাচাইকৃত সম্পন্ন', 'Verified complete')} <strong>{show(w?.completed)}</strong></p>}
    <section className="data-entry-chart" aria-label={L('গত ৭ দিনের হাব পিকআপ', 'Seven-day hub pickups')}>
      <h4>{L('গত ৭ দিনের হাব পিকআপ', 'Seven-day hub pickups')}</h4>
      <p>{L('সম্ভাব্য পিকআপ', 'Forecast pickups')}: <strong>{show(s.forecast_pickups)}</strong> · {n(s.forecast_sample_days)}/7</p>
      {[...s.forecast_days].sort((a,b) => a.date.localeCompare(b.date)).map(day => <div key={day.date}>
        <div className="data-entry-chart-label"><span>{day.date}</span><strong>{show(day.verified_parcels)}</strong></div>
        {day.verified_parcels != null ? <div className="data-entry-track data-entry-remaining" aria-hidden="true">
          <span className="data-entry-verified" style={{width: Math.max(0, Math.min(100, day.verified_parcels / Math.max(1, ...s.forecast_days.map(d => d.verified_parcels ?? 0)) * 100)) + '%'}} />
        </div> : <p>{L('যাচাইকৃত তথ্য নেই', 'No verified data')}</p>}
      </div>)}
      <p>{L('এটি হাবের পিকআপ ইতিহাস, ব্যক্তিগত পারফরম্যান্স নয়।', 'This is hub pickup history, not individual performance.')}</p>
    </section>
    <details>
      <summary>{L('আমাকে কেন এই টার্গেট দেওয়া হয়েছে?', 'Why did I receive this target?')}</summary>
      <p>{L('গত ৭ দিনের যাচাইকৃত পিকআপ থেকে হাবের সম্ভাব্য পিকআপ', 'Hub forecast from verified pickups in the last 7 days')} <strong>{show(s.forecast_pickups)}</strong> · {n(s.forecast_sample_days)}/7 {s.forecast_work_points != null && <> · {L('সম্ভাব্য ওয়ার্ক পয়েন্ট', 'Forecast Work Points')} {n(s.forecast_work_points)}</>}</p>
      <ul>{s.forecast_days.map(day => <li key={day.date}>{day.date} · {day.verified_parcels == null ? L('যাচাইকৃত হিসাব পাওয়া যায়নি', 'No verified count available') : n(day.verified_parcels)}{day.merchants != null && <> · {L('মার্চেন্ট', 'Merchants')} {n(day.merchants)}</>}{day.source === 'opening_history' && <> · {L('শুরুর রেকর্ড', 'Opening record')}</>}</li>)}</ul>
      <p>{L('প্রকৃত পিকআপ', 'Actual pickups')} {show(s.actual_pickups)} · {L('মার্চেন্ট', 'Merchants')} {show(s.actual_pickups == null ? null : s.actual_merchants)}
        {' · '}{L('জটিল পার্সেল', 'Complex parcels')} {show(s.complex_parcels)} · {L('ওয়ার্ক পয়েন্ট', 'Work Points')} {show(s.actual_work_points)}</p>
      <p>{L('ওয়ার্ক পয়েন্ট = পার্সেল + (প্রতি মার্চেন্ট × ৫) + (প্রতি অনুমোদিত জটিল পার্সেল × ২)।', 'Work Points = parcels + (5 per merchant) + (2 per approved complex parcel).')}</p>
      {w ? <>
        <p>{L('হাজিরা', 'Attendance')} <strong>{localized(attendanceNames, w.attendance)}</strong>
          {' · '}{L('হাবের সংখ্যা', 'Assigned hubs')} {show(w.hub_count)}</p>
        <p>{L('উপলব্ধ মিনিট = কাজের মিনিট − বিরতি − অনুমোদিত দায়িত্ব', 'Available minutes = shift − breaks − approved duties')}
          {' · '}{show(w.working_minutes)} − {show(w.break_minutes)} − {show(w.duty_minutes)} → {show(w.entry_minutes)}</p>
        {w.daily_limit != null && <p>{L('জোনাল ম্যানেজারের নির্ধারিত সীমা', 'Limit set by the Zonal Manager')} {show(w.daily_limit)}</p>}
        {!!w.assigned_duty_minutes && <p>{L('এই শিফটে অতিরিক্ত দায়িত্বের মিনিট', 'Extra duty minutes assigned this shift')} {show(w.assigned_duty_minutes)}</p>}
        <ul>{duties.map(([key, bn, en]) => <li key={key}>{L(bn, en)} · {show(w.duty_detail[key.replace(/_minutes$/, '')])}</li>)}</ul>
        <p>{L('এই হাবের সম্ভাব্য মিনিট', 'Forecast minutes at this hub')} {show(w.forecast_hub_minutes)}
          {' · '}{L('ইতিমধ্যে এন্ট্রিতে ব্যয়', 'Time already spent on entry')} {show(w.worked_minutes)}
          {' · '}{L('এই হাবে অবশিষ্ট মিনিট', 'Remaining minutes at this hub')} {show(w.remaining_hub_minutes)}</p>
        <p>{L('ঘণ্টায় পার্সেল', 'Parcels per hour')} <strong>{show(w.parcel_rate)}</strong> · {localized(rateSources, w.parcel_rate_source)}
          {' · '}{show(w.parcel_sample_days)} {L('দিন', 'days')} / {show(w.parcel_sample_minutes)} {L('মিনিট', 'min')}</p>
        <p>{L('ঘণ্টায় ওয়ার্ক পয়েন্ট', 'Work Points per hour')} <strong>{show(w.point_rate)}</strong> · {localized(rateSources, w.point_rate_source)}
          {' · '}{show(w.point_sample_days)} {L('দিন', 'days')} / {show(w.point_sample_minutes)} {L('মিনিট', 'min')}</p>
        <p>{L('পূর্বের যাচাইকৃত নির্ভুলতা', 'Prior verified accuracy')} {w.prior_accuracy_pct == null ? '—' : show(w.prior_accuracy_pct) + '%'}</p>
        <p>{L('সমন্বিত সক্ষমতা = এই হাবের এন্ট্রি মিনিট ÷ ৬০ × ঘণ্টাপ্রতি সক্ষমতা।', 'Adjusted capacity = entry minutes for this hub ÷ 60 × hourly capacity.')}</p>
        <p>{L('টার্গেট = বরাদ্দযোগ্য পার্সেল × নিজের সক্ষমতা ÷ টিমের মোট সক্ষমতা। ভগ্নাংশ হলে পূর্ণ পার্সেলে মেলানো হয়।', 'Target = assignable parcels × individual capacity ÷ total team capacity, rounded to reconcile whole parcels.')}</p>
        {w.forecast && <p>{L('সম্ভাব্য', 'Forecast')} · {n(s.forecast_summary.assignable)} × {n(w.forecast.capacity)} ÷ {n(s.forecast_summary.total_capacity)} → <strong>{n(w.forecast.parcels)}</strong></p>}
        {s.actual_summary && w.actual_remaining && <p>{L('প্রকৃত বাকি', 'Actual remaining')} · {n(s.actual_summary.assignable)} × {n(w.actual_remaining.capacity)} ÷ {n(s.actual_summary.total_capacity)} → <strong>{n(w.actual_remaining.parcels)}</strong></p>}
      </> : <p>{L('সর্বশেষ হিসাবের কর্মী তালিকায় আপনার নাম নেই।', 'You are outside the roster for the latest calculation.')}</p>}
      <TargetHistory history={report.history} />
    </details>
  </section>
}

function TargetHistory({ history }: { history: History[] }) {
  const { L, n } = usePrefs()
  if (!history.length) return null
  return <>
    <h4>{L('পরিবর্তনের ইতিহাস', 'Change history')}</h4>
    <ul>{history.map(item => <li key={item.id}>
      {new Date(item.recorded_at).toLocaleTimeString(undefined, { timeZone: 'Asia/Dhaka' })} · {L(...(reasonNames[item.reason] ?? ['হিসাব আপডেট', 'Calculation updated']))}
      {item.forecast_target != null && <> · {L('সম্ভাব্য টার্গেট', 'Forecast target')} {n(item.forecast_target)}</>}
      {item.actual_remaining != null && <> · {L('প্রকৃত বরাদ্দ বাকি', 'Actual remaining')} {n(item.actual_remaining)}</>}
      {item.forecast_pickups != null && <> · {L('সম্ভাব্য পিকআপ', 'Forecast pickups')} {n(item.forecast_pickups)}</>}
      {item.actual_pickups != null && <> · {L('প্রকৃত পিকআপ', 'Actual pickups')} {n(item.actual_pickups)}</>}
    </li>)}</ul>
  </>
}

type Def = { key: string; bn: string; en: string; step?: string; min?: number; optional?: boolean; text?: boolean }
const field = (key: string, bn: string, en: string, options: Partial<Def> = {}): Def => ({ key, bn, en, ...options })
const ruleFields = [
  field('working_minutes', 'শিফটের মিনিট', 'Shift minutes', { min: 1 }),
  field('break_minutes', 'বিরতির মিনিট', 'Break minutes'),
  field('initial_parcels_per_hour', 'প্রাথমিক পার্সেল/ঘণ্টা', 'Starting parcels/hour', { step: '0.01', min: .01 }),
  field('initial_points_per_hour', 'প্রাথমিক পয়েন্ট/ঘণ্টা', 'Starting Work Points/hour', { step: '0.01', min: .01 }),
]
const observationFields = [
  ...duties.map(([key, bn, en]) => field(key, bn + ' (মিনিট)', en + ' (minutes)')),
  field('entry_minutes', 'প্রকৃত এন্ট্রি মিনিট', 'Actual entry minutes'),
  field('attempted', 'মোট এন্ট্রি', 'Attempted entries'),
  field('correct', 'যাচাইকৃত সঠিক এন্ট্রি', 'Verified correct entries'),
  field('merchants', 'স্বতন্ত্র মার্চেন্ট', 'Distinct merchants', { optional: true }),
  field('complex', 'জটিল পার্সেল', 'Complex parcels', { optional: true }),
]
const profileFields = [
  field('reference_count', 'রেফারেন্সে যোগ দেওয়া জনবল', 'Recruited referrals'),
  field('reporting_note', 'রিপোর্টিং', 'Reporting', { text: true }),
  field('collaboration_note', 'টিম সহযোগিতা', 'Team collaboration', { text: true }),
  field('contribution_note', 'সাংগঠনিক অবদান', 'Organizational contribution', { text: true }),
]
const complexityFields = [field('complex_parcels', 'অনুমোদিত জটিল পার্সেল', 'Approved complex parcels')]

export function DataEntryTargetSettings({ hubs }: { hubs: Choice[] }) {
  const { L } = usePrefs()
  const [open, setOpen] = useState(false)
  const [hub, setHub] = useState(() => rememberedHub())
  const [date, setDate] = useState(dhakaDay)
  const selected = pickRemembered(hubs, hub)
  function chooseHub(id: string) { setHub(id); rememberHub(id) }
  if (!selected) return null
  return <section className="panel data-entry-panel">
    <details onToggle={e => setOpen(e.currentTarget.open)}>
      <summary>{L('সক্ষমতা ও কর্মীদের শুরুর তথ্য', 'Capacity and opening employee records')}</summary>
      {open && <>
        {hubs.length > 1 && <label className="data-entry-field">{L('হাব', 'Hub')}
          <select value={selected.id} onChange={e => chooseHub(e.currentTarget.value)}>
            {hubs.map(h => <option value={h.id} key={h.id}>{h.name}</option>)}
          </select>
        </label>}
        <label className="data-entry-field">{L('তারিখ', 'Date')}
          <input type="date" value={date} max={dhakaDay()} onChange={e => setDate(e.currentTarget.value)} />
        </label>
        {date && <HubTargetSettings key={selected.id + date} hub={selected.id} date={date} />}
      </>}
    </details>
  </section>
}

function HubTargetSettings({ hub, date }: { hub: string; date: string }) {
  const { L, n } = usePrefs()
  const [member, setMember] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(false)
  const [busy, setBusy] = useState(false)
  const settings = useLoad(() => targetRpc<TargetAdmin>('data_entry_target_admin', { p_hub: hub, p_day: date, p_member: member || null }), [hub, date, member])
  async function save(kind: string, values: Record<string, number | string | boolean | null>) {
    setBusy(true)
    setError('')
    setNotice(false)
    try {
      await targetRpc('data_entry_target_save', { p_hub: hub, p_day: date, p_member: member || null, p_kind: kind, p_values: values })
      await settings.reload()
      setNotice(true)
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  async function setMode(next: 'smart' | 'equal') {
    setBusy(true); setError(''); setNotice(false)
    try {
      await targetRpc('data_entry_distribution_mode_set', { p_hub: hub, p_mode: next })
      await settings.reload()
      setNotice(true)
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const data = settings.data
  if (settings.error) return <div><p className="da-error" role="alert">{String(settings.error)}</p>
    <button type="button" onClick={() => void settings.reload()}>{L('আবার চেষ্টা করুন', 'Retry')}</button></div>
  if (!data || settings.loading) return <p role="status">{L('লোড হচ্ছে…', 'Loading…')}</p>
  // The saved mode comes from the hub itself; the latest cached run can be missing or stale (hub off, no run yet).
  const mode = data.distribution_mode ?? data.latest?.distribution_mode ?? 'smart'
  return <fieldset disabled={busy}>
    <button type="button" className="secondary" onClick={() => void save('hub', { enabled: !data.enabled })}>
      {data.enabled ? L('অটো বণ্টন বন্ধ করুন', 'Disable automatic distribution') : L('অটো বণ্টন চালু করুন', 'Enable automatic distribution')}
    </button>
    <div className="data-entry-mode-toggle">
      <span>{L('বণ্টন মোড', 'Distribution mode')}:</span>
      <strong>{mode === 'equal'
        ? L('সমান (Equal)', 'Equal')
        : L('স্মার্ট — র‍্যাংক অনুযায়ী (Smart)', 'Smart — rank-weighted')}</strong>
      {mode === 'smart'
        ? <button type="button" className="secondary" onClick={() => void setMode('equal')}>
            {L('সমান বণ্টনে বদলান', 'Switch to equal split')}
          </button>
        : <button type="button" className="secondary" onClick={() => void setMode('smart')}>
            {L('স্মার্ট বণ্টনে ফিরে যান', 'Switch back to smart split')}
          </button>}
      {data.latest?.fair_equal_share_parcels != null && <small>
        {L('সমান ভাগ', 'Equal share')}: {n(Math.round(Number(data.latest.fair_equal_share_parcels)))}
      </small>}
    </div>
    {notice && <p role="status">{L('সংরক্ষণ হয়েছে', 'Saved')}</p>}
    {error && <p className="da-error" role="alert">{error}</p>}
    {data.latest && <p>{L('সম্ভাব্য পিকআপ', 'Forecast pickups')} {data.latest.forecast_pickups ?? '—'} · {L('প্রকৃত পিকআপ', 'Actual pickups')} {data.latest.actual_pickups ?? '—'}
      {' · '}{L('অবরাদ্দকৃত প্রকৃত কাজ', 'Unassigned actual work')} {data.latest.actual_summary ? n(data.latest.actual_summary.unassigned) : '—'}</p>}
    <details>
      <summary>{L('পিকআপের জটিলতা', 'Pickup complexity')}</summary>
      <InputSection fields={complexityFields} values={{ complex_parcels: data.complex_parcels }} onSave={values => save('complexity', values)} />
    </details>
    <label className="data-entry-field">{L('কর্মী', 'Employee')}
      <select value={member} onChange={e => setMember(e.currentTarget.value)}>
        <option value="">{L('কর্মী বাছুন', 'Select an employee')}</option>
        {data.team.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select>
    </label>
    {member && <div key={member}>
      <details>
        <summary>{L('স্থায়ী শিফট ও প্রাথমিক সক্ষমতা', 'Standing shift and starting capacity')}</summary>
        <InputSection fields={ruleFields} values={data.rule} onSave={values => save('rule', values)} />
      </details>
      <details>
        <summary>{L('অনুমোদিত দায়িত্ব ও যাচাইকৃত দিনের কাজ', 'Approved duties and verified daily work')}</summary>
        <p>{L('এই কর্মীর এই হাব ও তারিখের পূর্ণ দিনের যোগফল লিখুন।', 'Enter the full daily totals for this employee at this hub.')}</p>
        <InputSection fields={observationFields} values={data.observation} onSave={values => save('observation', values)} />
      </details>
      <details>
        <summary>{L('পারফরম্যান্স প্রোফাইল', 'Performance profile')}</summary>
        <InputSection fields={profileFields} values={data.profile} onSave={values => save('profile', values)} />
      </details>
    </div>}
    <TargetHistory history={data.history} />
  </fieldset>
}

function InputSection({ fields, values, onSave }: {
  fields: Def[]; values: NumberMap | null; onSave: (values: NumberMap) => Promise<void>
}) {
  const { L } = usePrefs()
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const record: NumberMap = {}
    for (const f of fields) {
      const raw = String(form.get(f.key) ?? '').trim()
      record[f.key] = f.text ? raw : raw === '' ? null : Number(raw)
    }
    void onSave(record)
  }
  return <form onSubmit={submit}>
    <div className="data-entry-target-fields">
      {fields.map(f => <label className="data-entry-field" key={f.key}>{L(f.bn, f.en)}
        {f.text ? <textarea name={f.key} maxLength={500} defaultValue={values?.[f.key] ?? ''} /> :
          <input type="number" name={f.key} step={f.step ?? '1'} min={f.min ?? 0} required={!f.optional}
            defaultValue={values?.[f.key] ?? (f.optional || f.min ? '' : 0)} />}
      </label>)}
    </div>
    <button type="submit">{L('অনুমোদন ও সংরক্ষণ', 'Approve and save')}</button>
  </form>
}
