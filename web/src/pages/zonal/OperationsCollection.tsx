import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
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
  ['sorting_pending', 'সোর্টিং বাকি', 'Sorting pending'],
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

export function OperationsQuestions() {
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
