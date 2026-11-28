import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useRelease } from '../../lib/releaseAccess'
import { usePrefs } from '../../lib/prefs'
import { Field, useLoad } from '../accounts/ui'

const measures = [
  ['pickup', 'পিকআপ', 'Pickups'],
  ['delivery', 'ডেলিভারি', 'Deliveries'],
  ['received', 'হাবে পাওয়া পার্সেল', 'Parcels received'],
] as const
const questionMetrics = [
  ['delivery_pending', 'ডেলিভারি পেন্ডিং', 'Deliveries pending'],
  ['pickup_pending', 'পিকআপ বাকি', 'Pickups pending'],
  ['sorting_pending', 'সর্টিং বাকি', 'Sorting pending'],
  ['spare_capacity', 'আরও নেওয়ার ক্ষমতা', 'Spare parcel capacity'],
  ['backup_needed', 'প্রয়োজনীয় ব্যাকআপ জনবল', 'Backup people needed'],
] as const

type Measure = typeof measures[number][0]
type Counts<T> = Record<Measure, T>
type Hub = {
  id: string; name: string; can_edit: boolean; can_send: boolean
  baseline: Counts<number> | null; actual: Counts<number | null>
}
type Recipient = { id: string; name: string; code: string | null; position: string | null }
type Question = { id: string; metric: string; prompt: string; hub: string; recipient: string | null; value: number | null; answered_at: string | null }
const maxCount = 2147483647

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data as T
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error)

export function OperationsCollection({ zone }: { zone: string }) {
  const { L, n } = usePrefs()
  const overview = useLoad(() => rpc<Hub[]>('operation_collection', { p_zone: zone }), [zone])
  const [selected, setSelected] = useState('')
  const hubs = overview.data ?? []
  const hub = hubs.find(h => h.id === selected) ?? hubs[0]
  const delta = (current: number, base: number) => (current > base ? '+' : '') + n(current - base)

  return <>
    <section className="panel">
      <h2>{L('ফিক্সড গড় ও আজকের হিসাব', 'Fixed averages and today’s counts')}</h2>
      {overview.error ? <p className="da-error">{message(overview.error)}</p> : null}
      {overview.loading && <p>{L('লোড হচ্ছে…', 'Loading…')}</p>}
      <button type="button" className="secondary" onClick={() => void overview.reload()}>{L('হিসাব রিফ্রেশ', 'Refresh counts')}</button>
      {hubs.length > 0 && <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>{L('হাব', 'Hub')}</th><th>{L('হিসাব', 'Measure')}</th>
            <th>{L('ফিক্সড গড়', 'Fixed average')}</th><th>{L('আজকের হিসাব', 'Today')}</th><th>{L('পার্থক্য', 'Difference')}</th></tr></thead>
          <tbody>
            {measures.map(([key, bn, en]) => {
              const configured = hubs.filter(h => h.baseline !== null)
              const reporting = hubs.filter(h => h.actual[key] !== null)
              const matched = reporting.filter(h => h.baseline !== null)
              const base = configured.reduce((sum, h) => sum + (h.baseline?.[key] ?? 0), 0)
              const actual = reporting.reduce((sum, h) => sum + (h.actual[key] ?? 0), 0)
              const compared = matched.reduce((sum, h) => sum + (h.actual[key] ?? 0) - (h.baseline?.[key] ?? 0), 0)
              return <tr key={key}><th>{L('জোন মোট', 'Zone total')}</th><td>{L(bn, en)}</td>
                <td>{configured.length ? n(base) : '—'}</td>
                <td>{reporting.length ? n(actual) : '—'} · {n(reporting.length)}/{n(hubs.length)}</td>
                <td>{matched.length ? <>{delta(compared, 0)} · {n(matched.length)}/{n(hubs.length)} {L('হাব তুলনায়', 'hubs compared')}</> : '—'}</td></tr>
            })}
            {hubs.flatMap(h => measures.map(([key, bn, en]) => {
              const base = h.baseline?.[key]
              const current = h.actual[key]
              return <tr key={h.id + key}><th>{h.name}</th><td>{L(bn, en)}</td>
                <td>{base === undefined ? '—' : n(base)}</td>
                <td>{current === null ? L('তথ্য বাকি', 'Data pending') : n(current)}</td>
                <td>{current === null || base === undefined ? '—' : delta(current, base)}</td></tr>
            }))}
          </tbody>
        </table>
      </div>}
      <p className="muted">{L('পিকআপ ও ডেলিভারি অনুমোদিত হাব মেট্রিক থেকে আসে। পার্সেলের সংখ্যা জমা হওয়া হাব রিপোর্ট থেকে আসে।', 'Pickup and delivery come from approved hub metrics. Parcel counts come from submitted hub reports.')}</p>
    </section>
    {hub && <>
      <section className="panel"><Field label={L('হাব', 'Hub')}><select value={hub.id} onChange={e => setSelected(e.target.value)}>
        {hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
      </select></Field></section>
      <HubCollection key={hub.id} hub={hub} refresh={overview.reload} />
    </>}
  </>
}

function HubCollection({ hub, refresh }: { hub: Hub; refresh: () => Promise<unknown> }) {
  const { L, n } = usePrefs()
  const [employee, setEmployee] = useState('')
  const [prompt, setPrompt] = useState('')
  const [metric, setMetric] = useState<string>(questionMetrics[0][0])
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const recipients = useLoad(() => hub.can_send ? rpc<Recipient[]>('operation_recipients', { p_hub: hub.id }) : Promise.resolve([]), [hub.id, hub.can_send])
  const questions = useLoad(() => rpc<Question[]>('operation_questions_today', { p_hub: hub.id }), [hub.id])
  async function submit(event: FormEvent<HTMLFormElement>, action: (data: FormData) => Promise<unknown>, success: string) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true)
    setFeedback('')
    try { await action(data); setFeedback(success) }
    catch (error) { setFeedback(message(error)) }
    finally { setBusy(false) }
  }
  async function save(data: FormData) {
    await rpc('operation_baseline_save', {
      p_hub: hub.id, p_pickup: Number(data.get('pickup')),
      p_delivery: Number(data.get('delivery')), p_received: Number(data.get('received')),
    })
    await refresh()
  }
  async function send() {
    await rpc('operation_question_send', { p_hub: hub.id, p_employee: employee, p_metric: metric, p_prompt: prompt.trim() })
    setPrompt('')
    await questions.reload()
  }
  return <>
    <PlanningSuggestions hub={hub} questions={questions.error ? null : questions.data} loading={questions.loading} />
    <RoutePlanDelegations hub={hub} recipients={recipients.data ?? []} />
    {feedback && <p role="status">{feedback}</p>}
    {hub.can_edit && <form className="panel" onSubmit={e => void submit(e, save, L('ফিক্সড গড় সংরক্ষিত।', 'Fixed averages saved.'))}>
      <h2>{L('হাবের ফিক্সড গড় বদলান', 'Edit hub averages')}</h2>
      <div className="da-filters">{measures.map(([key, bn, en]) => <Field label={L(bn, en)} key={key}>
        <input type="number" name={key} min={0} max={maxCount} step={1} required defaultValue={hub.baseline?.[key] ?? ''} />
      </Field>)}</div>
      <button disabled={busy}>{L('গড় সংরক্ষণ', 'Save averages')}</button>
    </form>}
    {hub.can_send && <form className="panel" onSubmit={e => void submit(e, send, L('প্রশ্ন পাঠানো হয়েছে।', 'Question sent.'))}>
      <h2>{L('কর্মীকে প্রশ্ন পাঠান', 'Ask an employee')}</h2>
      {recipients.error ? <p className="da-error">{message(recipients.error)}</p> : null}
      <div className="da-filters">
        <Field label={L('প্রাপক', 'Recipient')}><select required value={employee} onChange={e => setEmployee(e.target.value)}>
          <option value="">{L('কর্মী বাছুন', 'Choose an employee')}</option>
          {(recipients.data ?? []).map(r => <option key={r.id} value={r.id}>{[r.name, r.code, r.position].filter(Boolean).join(' · ')}</option>)}
        </select></Field>
        <Field label={L('উত্তর কোন হিসাবে যাবে', 'Answer metric')}><select value={metric} onChange={e => setMetric(e.target.value)}>
          {questionMetrics.map(([key, bn, en]) => <option key={key} value={key}>{L(bn, en)}</option>)}
        </select></Field>
        <Field label={L('প্রশ্ন', 'Question')}><input required maxLength={300} value={prompt} onChange={e => setPrompt(e.target.value)}
          placeholder={L('আসিফ, আজ তোমার ডেলিভারি পেন্ডিং কত?', 'Asif, how many deliveries are pending today?')} /></Field>
      </div>
      <button disabled={busy || !employee || !prompt.trim()}>{L('প্রশ্ন পাঠান', 'Send question')}</button>
    </form>}
    <section className="panel">
      <h2>{L('আজকের উত্তর ও উত্তর বাকি', 'Today’s answers and outstanding questions')}</h2>
      <button type="button" className="secondary" onClick={() => void questions.reload()}>{L('উত্তর রিফ্রেশ', 'Refresh answers')}</button>
      {questions.error ? <p className="da-error">{message(questions.error)}</p> : null}
      {questions.loading && <p>{L('লোড হচ্ছে…', 'Loading…')}</p>}
      {questions.data?.length === 0 && <p>{L('আজ কোনো প্রশ্ন নেই।', 'No questions today.')}</p>}
      <ul>{questions.data?.map(q => <li key={q.id}>
        {q.recipient ? q.recipient + ' · ' : ''}{q.prompt} · {questionMetrics.filter(([key]) => key === q.metric).map(([key, bn, en]) => <span key={key}>{L(bn, en)} · </span>)}<strong>{q.value === null ? L('উত্তর বাকি', 'Awaiting answer') : n(q.value)}</strong>
      </li>)}</ul>
    </section>
  </>
}

const delegationLabels: Record<string, [string, string]> = {
  'ops.route_plan.view': ['রুট প্ল্যান দেখা', 'View route plans'],
  'ops.route_plan.edit': ['খসড়া রুট প্ল্যান সম্পাদনা', 'Edit draft route plans'],
  'ops.route_plan.approve': ['রুট প্ল্যান অনুমোদন, ফেরত বা পুনরায় খোলা', 'Approve, return, or reopen route plans'],
}
type Delegations = { permissions: string[]; grants: { id: string; name: string; permission: string; until: string | null; active: boolean }[] }

function RoutePlanDelegations({ hub, recipients }: { hub: Hub; recipients: Recipient[] }) {
  const { L } = usePrefs()
  const q = useLoad(() => rpc<Delegations>('route_plan_delegations', { p_hub: hub.id }), [hub.id])
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const label = (key: string) => delegationLabels[key] ? L(...delegationLabels[key]) : key
  const permissions = q.data?.permissions ?? []
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true)
    setFeedback('')
    try { await action(); await q.reload(); setFeedback(success) }
    catch (error) { setFeedback(message(error)) }
    finally { setBusy(false) }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    void run(() => rpc('route_plan_delegate', {
      p_hub: hub.id, p_employee: data.get('employee'), p_permission: data.get('permission'), p_until: data.get('until') || null,
    }), L('অনুমতি দেওয়া হয়েছে।', 'Permission granted.'))
  }
  if (!permissions.length) return null
  return <section className="panel">
    <h2>{L('রুট প্ল্যানের অনুমতি দিন', 'Delegate route plan permissions')} · {hub.name}</h2>
    <p>{L('একবারে এই হাবের একটি অনুমতি দিন। অনুমোদনের অনুমতি দিলে রুট প্ল্যান ফেরত দেওয়া ও পুনরায় খোলাও যাবে।',
      'Grant one permission at a time for this hub. Approval access also allows returning and reopening plans.')}</p>
    <form onSubmit={submit}>
      <div className="da-filters">
        <Field label={L('কর্মী', 'Employee')}><select name="employee" required defaultValue="">
          <option value="">{L('কর্মী বাছুন', 'Choose an employee')}</option>
          {recipients.map(r => <option key={r.id} value={r.id}>{[r.name, r.code, r.position].filter(Boolean).join(' · ')}</option>)}
        </select></Field>
        <Field label={L('অনুমতি', 'Permission')}><select name="permission" required defaultValue="">
          <option value="">{L('অনুমতি বাছুন', 'Choose a permission')}</option>
          {permissions.map(key => <option key={key} value={key}>{label(key)}</option>)}
        </select></Field>
        <Field label={L('শেষ তারিখ (ঐচ্ছিক)', 'Expiry date (optional)')}><input name="until" type="date" /></Field>
      </div>
      <button disabled={busy || !recipients.length}>{L('অনুমতি দিন', 'Grant permission')}</button>
    </form>
    {feedback && <p role="status">{feedback}</p>}
    <ul>{q.data?.grants.map(g => <li key={g.id}>
      {g.name} · {label(g.permission)} · {g.active ? (g.until ?? L('মেয়াদ নির্ধারিত নেই', 'No expiry')) : L('মেয়াদ শেষ', 'Expired')}{' '}
      <button type="button" className="secondary" disabled={busy} onClick={() => void run(
        () => rpc('route_plan_revoke_delegation', { p_id: g.id }), L('অনুমতি প্রত্যাহার করা হয়েছে।', 'Permission revoked.')
      )}>{L('প্রত্যাহার', 'Revoke')}</button>
    </li>)}</ul>
  </section>
}

function PlanningSuggestions({ hub, questions, loading }: { hub: Hub; questions: Question[] | null; loading: boolean }) {
  const { L, n } = usePrefs()
  const latest = new Map<string, Question>()
  for (const answer of questions ?? []) {
    if (answer.value === null || answer.answered_at === null) continue
    const previous = latest.get(answer.metric)
    if (!previous?.answered_at || Date.parse(answer.answered_at) > Date.parse(previous.answered_at)) {
      latest.set(answer.metric, answer)
    }
  }

  const received = hub.actual.received
  const avg = hub.baseline?.received
  const extra = received !== null && avg !== undefined ? Math.max(0, received - avg) : 0
  const delivery = latest.get('delivery_pending')?.value ?? 0
  const pickup = latest.get('pickup_pending')?.value ?? 0
  const sorting = latest.get('sorting_pending')?.value ?? 0
  const capacity = latest.get('spare_capacity')?.value ?? 0
  const backup = latest.get('backup_needed')?.value ?? 0
  const routeReview = delivery > 0 || pickup > 0
  const suggestions = [
    extra > 0 && L(`গড়ের চেয়ে ${n(extra)}টি বেশি পার্সেল এসেছে। আজকের সর্টিং ও রুটের সক্ষমতা মিলিয়ে দেখুন।`, `${n(extra)} parcels above average. Review today’s sorting and route capacity.`),
    delivery > 0 && L(`সর্বশেষ উত্তরে ${n(delivery)}টি ডেলিভারি পেন্ডিং। এলাকা ও বর্তমান অ্যাসাইনমেন্ট দেখে কাজ ভাগ করার প্রস্তাব।`, `The latest reply reports ${n(delivery)} pending deliveries. Review areas and existing assignments to split the work.`),
    pickup > 0 && L(`সর্বশেষ উত্তরে ${n(pickup)}টি পিকআপ বাকি। মার্চেন্টের এলাকা ধরে পিকআপের কাজ ভাগ করার প্রস্তাব।`, `The latest reply reports ${n(pickup)} pending pickups. Review merchant locations to share the pickup work.`),
    routeReview && capacity > 0 && L(`একটি উত্তরে আরও ${n(capacity)}টি পার্সেল নেওয়ার সক্ষমতা জানানো হয়েছে। এলাকা, বর্তমান দায়িত্ব ও উপস্থিতি মিলিয়ে দেখার জন্য এই তথ্য ব্যবহার করা যাবে।`, `One reply reports spare capacity for ${n(capacity)} parcels. Check area, current assignments and attendance before using it.`),
    sorting > 0 && L(`সর্বশেষ উত্তরে ${n(sorting)}টি সর্টিং বাকি। শিফটের লোকবল দেখে সর্টিংয়ে সহায়তা দেওয়ার প্রস্তাব।`, `The latest reply reports ${n(sorting)} awaiting sorting. Review shift staffing for sorting support.`),
    backup > 0 && L(`সর্বশেষ উত্তরে ${n(backup)} জন ব্যাকআপ চাওয়া হয়েছে। দায়িত্ব ও উপস্থিতি দেখে জোনাল ম্যানেজার সিদ্ধান্ত দেবেন।`, `The latest reply requests ${n(backup)} backup workers. The Zonal Manager decides after reviewing duties and availability.`),
  ].filter((item): item is string => typeof item === 'string')

  return <section className="panel">
    <h2>{L('রুট ও জনবলের প্রস্তাব', 'Route and staffing suggestions')} · {hub.name}</h2>
    <p>{L('রুট পরিবর্তন, কাজ পুনর্বণ্টন, জনবল ও ব্যাকআপের চূড়ান্ত সিদ্ধান্ত সংশ্লিষ্ট জোনাল ম্যানেজার নেবেন।', 'The assigned Zonal Manager makes the final decision on route changes, work redistribution, staffing and backup.')}</p>
    {received === null && <p>{avg === undefined ? L('আজকের রিসিভ ও ফিক্সড গড় বাকি।', 'Today’s receipts and the fixed average are pending.')
      : L(`আজকের রিসিভ বাকি। নিয়মিত পরিকল্পনার ভিত্তি ${n(avg)} পার্সেল।`, `Today’s receipts are pending. The regular planning baseline is ${n(avg)} parcels.`)}</p>}
    {received !== null && avg === undefined && <p>{L('রিসিভ তুলনা করতে হাবের ফিক্সড গড় সেট করুন।', 'Set the hub’s fixed average to compare receipts.')}</p>}
    {loading && <p>{L('কর্মীদের উত্তর লোড হচ্ছে…', 'Loading employee replies…')}</p>}
    {!loading && questions === null && <p>{L('কর্মীদের উত্তর পাওয়া যায়নি। নিচে উত্তর রিফ্রেশ করুন।', 'Employee replies are unavailable. Refresh answers below.')}</p>}
    {!loading && questions !== null && latest.size === 0 && <p>{L('এই হাবে পরিকল্পনার জন্য আজকের কোনো উত্তর জমা হয়নি।', 'There are no submitted planning replies for this hub today.')}</p>}
    {suggestions.length ? <ul>{suggestions.map(item => <li key={item}>{item}</li>)}</ul> : null}
    {suggestions.length === 0 && latest.size > 0 && <p>{L('পাওয়া তথ্যে বাড়তি কাজ বা জনবলের প্রস্তাব আসেনি।', 'The available data has not triggered a workload or staffing suggestion.')}</p>}
    {routeReview && <Link to="/app/routes?tab=plan">{L('রুট কেন্দ্রের আজকের পরিকল্পনা খুলুন', 'Open today’s plan in Route Centre')}</Link>}
  </section>
}

export function OperationsQuestions() {
  return useRelease().allows('operation') ? <OperationsInbox /> : null
}

function OperationsInbox() {
  const { L } = usePrefs()
  const questions = useLoad(() => rpc<Question[]>('operation_questions_today'), [])
  if (!questions.data?.length) return null
  return <section className="panel">
    <h2>{L('আজকের অপারেশন প্রশ্ন', 'Today’s operation questions')}</h2>
    {questions.data.map(q => <AnswerForm key={q.id} item={q} refresh={questions.reload} />)}
  </section>
}

function AnswerForm({ item, refresh }: { item: Question; refresh: () => Promise<unknown> }) {
  const { L, n } = usePrefs()
  const [value, setValue] = useState(item.value?.toString() ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try { await rpc('operation_question_answer', { p_question: item.id, p_value: Number(value) }); await refresh() }
    catch (e) { setError(message(e)) }
    finally { setBusy(false) }
  }
  return <form onSubmit={e => void save(e)}>
    <h3>{item.prompt}</h3>
    <p>{item.hub}{item.value !== null && ' · ' + L('জমা দেওয়া উত্তর', 'Submitted answer') + ' ' + n(item.value)}</p>
    <div className="da-filters">
      {[0, 5, 10].map(option => <button type="button" className="secondary" key={option} onClick={() => setValue(String(option))} aria-pressed={value === String(option)}>{n(option)}</button>)}
      <Field label={L('উত্তর', 'Answer')}><input type="number" min={0} max={maxCount} step={1} required inputMode="numeric" value={value} onChange={e => setValue(e.target.value)} /></Field>
    </div>
    <button disabled={busy || value === '' || Number(value) === item.value}>{L('জমা দিন', 'Submit')}</button>
    {error && <p className="da-error" role="alert">{error}</p>}
  </form>
}
