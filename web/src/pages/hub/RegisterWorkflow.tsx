import { useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { todayDhaka } from '../../lib/dailyAccounts'
import { usePrefs } from '../../lib/prefs'
import { supabase } from '../../lib/supabase'
import { toLatinDigits } from '../../lib/validate'
import { useWorkHub } from '../../lib/workHub'
import { useLiveLoad, wfFriendly } from '../../lib/workforce'
import { Field } from '../accounts/ui'
import { fmtStamp } from '../workforce/shared'

type BookId = 'attendance' | 'pickup' | 'pending' | 'delivery' | 'expense'
type Payload = Record<string, string | number>
type Option = { id: string; name: string }
type Row = {
  employee_id: string | null; name: string; position_name: string | null; duty: string; due: string
  payload: Payload | null; source_payload: Payload | null; required: boolean; complete: boolean; source: 'existing' | 'self' | 'proxy' | null; reviewed: boolean
}
type Rule = { rule_id: number; book: BookId; position_id: string | null; employee_id: string | null; duty: string; due_at: string; required: boolean }
type Book = {
  id: BookId; locked: boolean; reopened: boolean; rows: Row[]; totals: Payload
  history: { id: number; action: string; happened_at: string; actor: string; data: unknown }[]
}
type Register = {
  hub?: string; hubs: Option[]; day: string; manage: boolean; configure: boolean; me: string | null; books: Book[]
  month?: { day: string; book: BookId; totals: Payload }[]
  positions: Option[] | null; people: Option[] | null; rules: Rule[] | null
}
type Action = 'save' | 'review' | 'submit' | 'reopen' | 'rule' | 'remove_rule'
type Write = (action: Action, employee?: string | null, data?: unknown, reason?: string) => Promise<boolean>

const titles: Record<BookId, [string, string]> = {
  attendance: ['হাজিরা খাতা', 'Attendance register'],
  pickup: ['পিকআপ ও মার্চেন্ট ফেরত খাতা', 'Pickup and merchant return register'],
  pending: ['পেন্ডিং ও রিটার্ন খাতা', 'Pending and return register'],
  delivery: ['ডেলিভারি ও টাকা খাতা', 'Delivery and cash register'],
  expense: ['হাবের খরচের খাতা', 'Hub expense register'],
}
const fields: Record<BookId, string[]> = {
  attendance: [], pickup: ['pickup', 'merchant_return'], pending: ['pending', 'return'],
  delivery: ['delivery', 'cash', 'mobile', 'due'], expense: ['expense', 'bills'],
}
const labels: Record<string, [string, string]> = {
  pickup: ['পিকআপ', 'Pickup'], merchant_return: ['মার্চেন্ট ফেরত', 'Merchant returns'],
  pending: ['পেন্ডিং', 'Pending'], return: ['ডেলিভারি ফেরত', 'Delivery returns'],
  delivery: ['ডেলিভারি', 'Deliveries'], cash: ['নগদ টাকা', 'Cash'], mobile: ['মোবাইল ব্যাংকিং', 'Mobile banking'],
  due: ['বাকি টাকা', 'Due'], expense: ['খরচ', 'Expenses'], bills: ['বিল', 'Bills'],
  status: ['হাজিরা', 'Attendance'], application_date: ['বাইরের ওয়েবসাইটে আবেদনের তারিখ', 'External application date'],
  present: ['উপস্থিত', 'Present'], absent: ['অনুপস্থিত', 'Absent'], late: ['বিলম্ব', 'Late'],
  half_day: ['অর্ধদিবস', 'Half day'], leave: ['ছুটি', 'Leave'], holiday: ['সরকারি ছুটি', 'Holiday'],
  weekly_off: ['সাপ্তাহিক ছুটি', 'Weekly off'],
  save: ['এন্ট্রি', 'Entry'], review: ['যাচাই', 'Review'], submit: ['চূড়ান্ত জমা', 'Final submission'],
  reopen: ['পুনরায় খোলা', 'Reopened'],
}
const attendance = ['present', 'absent', 'late', 'half_day', 'leave', 'holiday', 'weekly_off']
const money = new Set(['cash', 'mobile', 'due', 'expense'])

function Values({ values }: { values: Payload }) {
  const { L, n } = usePrefs()
  return <span>{Object.entries(values).map(([key, value]) => {
    const label = L(...(labels[key] ?? [key, key]))
    const shown = typeof value === 'number' ? n(value) : L(...(labels[value] ?? [value, value]))
    return `${label} ${shown}`
  }).join(' · ') || '—'}</span>
}

export function RegisterWorkflow() {
  const { session } = useAuth()
  const { L, n } = usePrefs()
  const workingHub = useWorkHub(session?.user.id ?? '')
  const [selection, setSelection] = useState<{ workHub: string; hub: string }>()
  const [day, setDay] = useState(todayDhaka)
  const [month, setMonth] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const initial = useLiveLoad(async () => {
    const { data, error } = await supabase.rpc('hub_register_read', { p_date: day })
    if (error) throw error
    return data as Register
  }, [session?.user.id, day])
  const allowed = initial.data?.hubs ?? []
  const preferred = selection?.workHub === workingHub ? selection.hub : workingHub
  const hub = allowed.find(item => item.id === preferred)?.id ?? initial.data?.hub ?? ''
  const query = useLiveLoad(async () => {
    if (!hub) return null
    const { data, error } = await supabase.rpc('hub_register_read', {
      p_hub: hub, p_date: day, p_month: month ? `${month}-01` : null,
    })
    if (error) throw error
    return data as Register
  }, [hub, day, month])

  async function write(book: BookId, action: Action, employee?: string | null, data?: unknown, reason?: string) {
    if (busy) return false
    setBusy(true)
    setError('')
    try {
      const result = await supabase.rpc('hub_register_write', {
        p_hub: hub, p_date: day, p_book: book, p_action: action, p_employee: employee ?? null,
        p_data: data ?? null, p_reason: reason ?? null,
      })
      if (result.error) throw result.error
      await query.reload()
      return true
    } catch (failure) {
      setError(wfFriendly(failure))
      await query.reload()
      return false
    } finally {
      setBusy(false)
    }
  }

  const register = query.data?.hub === hub && query.data.day === day ? query.data : null
  const failure = initial.error || query.error
  if (failure) return <p role="alert">{wfFriendly(failure)}</p>
  if (!initial.data || (hub && !register)) return <p role="status">{L('খাতাগুলো লোড হচ্ছে…', 'Loading registers…')}</p>
  if (!register) return <p>{L('সক্রিয় হাব বরাদ্দ প্রয়োজন।', 'An active hub assignment is required.')}</p>

  const open = register.books.filter(book => !book.locked)
  const missing = new Map<string, string>()
  for (const book of open) for (const row of book.rows) {
    if ((row.required || row.payload) && !row.complete && row.employee_id) missing.set(row.employee_id, row.name)
  }
  const stats: [string, string, number][] = [
    ['মোট খাতা', 'Total registers', register.books.length],
    ['জমা হয়েছে', 'Submitted', register.books.length - open.length],
    ['জমা বাকি', 'Submission due', open.length],
    ['যাদের তথ্য বাকি', 'People with missing entries', missing.size],
    ['যাচাই বাকি', 'Entries awaiting review', open.flatMap(book => book.rows).filter(row => row.complete && !row.reviewed).length],
    ['চূড়ান্ত সাবমিট বাকি', 'Ready for final submission', open.filter(book => book.rows.every(row => row.reviewed || !row.required && !row.payload)).length],
    ['সময় অতিক্রম করেছে', 'Overdue registers', open.filter(book => book.rows.some(row => (row.required || row.payload) && Date.parse(row.due) <= Date.now())).length],
  ]

  return <div className="hub-register-workflow">
    <div className="panel hub-register-filters">
      {(register.manage || allowed.length > 1) && <Field label={L('হাব', 'Hub')}>
        <select disabled={busy} value={hub} onChange={event => {
          setError('')
          setSelection({ workHub: workingHub, hub: event.target.value })
        }}>{allowed.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      </Field>}
      <Field label={L('খাতার তারিখ', 'Register date')}>
        <input type="date" value={day} max={todayDhaka()} disabled={busy}
          onChange={event => { if (event.target.value) { setDay(event.target.value); setError('') } }} />
      </Field>
      {register.manage && <Field label={L('মাসিক রিপোর্ট', 'Monthly report')}>
        <input type="month" value={month} max={todayDhaka().slice(0, 7)} disabled={busy} onChange={event => setMonth(event.target.value)} />
      </Field>}
    </div>
    {error && <p className="da-error" role="alert">{error}</p>}
    {register.manage && <section className="panel" aria-label={L('খাতার সারসংক্ষেপ', 'Register dashboard')}>
      <dl className="hub-register-stats">{stats.map(([bn, en, value]) =>
        <div key={en}><dt>{L(bn, en)}</dt><dd>{n(value)}</dd></div>)}</dl>
      <p>{L('যাদের তথ্য বাকি', 'Missing entries')} · {[...missing.values()].join(', ') || '—'}</p>
    </section>}
    {month && register.month && <section className="panel">
      <h2>{L('মাসের জমা খাতার রিপোর্ট', 'Monthly report of submitted registers')} · {month}</h2>
      {register.month.length ? <ul>{register.month.map(row =>
        <li key={row.day + row.book}>{row.day} · {L(...titles[row.book])} · <Values values={row.totals} /></li>)}</ul>
        : <p>{L('এই মাসে জমা খাতা নেই।', 'No submitted registers for this month.')}</p>}
    </section>}
    <div className="hub-register-grid">{register.books.map(book =>
      <RegisterBook key={hub + day + book.id} book={book} register={register} busy={busy}
        write={(...args) => write(book.id, ...args)} />)}</div>
  </div>
}

function RegisterBook({ book, register, busy, write }: { book: Book; register: Register; busy: boolean; write: Write }) {
  const { L, lang } = usePrefs()
  const [reason, setReason] = useState('')
  const complete = book.rows.every(row => row.reviewed || !row.required && !row.payload)
  return <section className="panel hub-register-card">
    <h2>{L(...titles[book.id])}</h2>
    <p>{book.locked ? L('জমা হয়েছে · লক করা', 'Submitted · Locked') : L('খোলা', 'Open')}</p>
    <p><strong>{L('দৈনিক রিপোর্ট', 'Daily report')}</strong> · <Values values={book.totals} /></p>
    <details>
      <summary>{register.manage ? L('কর্মী ও এন্ট্রি', 'Employees and entries') : L('আমার এন্ট্রি', 'My entry')}</summary>
      {book.rows.length === 0 && <p>{L('কোনো দায়িত্ব বরাদ্দ নেই।', 'No assignments for this register.')}</p>}
      <ul className="hub-pending-rows">{book.rows.map(row =>
        <li key={row.employee_id ?? 'hub'}>
          <strong>{row.name}</strong>{row.position_name && <> · {row.position_name}</>}
          <p>{L(...(titles[row.duty as BookId] ?? [row.duty, row.duty]))} · {fmtStamp(row.due, lang)}</p>
          {row.payload ? <p><Values values={row.payload} /> · {row.reviewed ? L('যাচাই হয়েছে', 'Reviewed') : row.complete ? L('যাচাই বাকি', 'Review due')
            : !('return' in row.payload) ? L('ফেরতের তথ্য বাকি', 'Return count missing') : L('পেন্ডিং তথ্য বাকি', 'Pending count missing')}
            {row.source === 'proxy' && <> · {L('ম্যানেজার পক্ষে দিয়েছেন', 'Entered on behalf')}</>}</p>
            : <p>{row.required ? L('তথ্য বাকি', 'Entry missing') : L('খরচ হলে এন্ট্রি দিন', 'Enter only if there was an expense')}</p>}
          {!book.locked && register.manage && row.complete && !row.reviewed &&
            <button type="button" disabled={busy} onClick={() => void write('review', row.employee_id, [row.source, row.payload])}>
              {L('যাচাই করুন', 'Verify entry')}
            </button>}
          {!book.locked && row.employee_id && (row.source !== 'existing' || book.id === 'pending' &&
            fields.pending.some(key => !(key in (row.source_payload ?? {})))) &&
            (row.employee_id === register.me ? register.manage || register.day === todayDhaka() || book.reopened : register.manage && row.source !== 'self') &&
            (!row.reviewed || book.reopened) &&
            <EntryForm key={JSON.stringify(row.payload)} book={book.id} row={row} proxy={row.employee_id !== register.me} busy={busy} write={write} />}
        </li>)}</ul>
    </details>
    {register.manage && !book.locked && <button type="button" disabled={busy || !complete} onClick={() => void write('submit')}>
      {L('চূড়ান্ত জমা ও লক', 'Submit and lock')}
    </button>}
    {register.configure && book.locked && <form onSubmit={async event => {
      event.preventDefault()
      if (await write('reopen', null, null, reason)) setReason('')
    }}>
      <Field label={L('পুনরায় খোলার কারণ', 'Reason for reopening')}><input required maxLength={500} value={reason}
        onChange={event => setReason(event.target.value)} /></Field>
      <button type="submit" disabled={busy || !reason.trim()}>{L('পুনরায় খুলুন', 'Reopen register')}</button>
    </form>}
    {register.configure && <RuleForm book={book.id} register={register} write={write} busy={busy} />}
    {register.manage && book.history.length > 0 && <details>
      <summary>{L('সংশোধন ও জমার ইতিহাস', 'Correction and submission history')}</summary>
      <ul>{book.history.map(event => <li key={event.id}>
        <details><summary>{fmtStamp(event.happened_at, lang)} · {L(...(labels[event.action] ?? [event.action, event.action]))}</summary>
          <div>{L('দায়িত্বপ্রাপ্ত অ্যাকাউন্ট', 'Actor account')} · {event.actor}</div>
          <pre className="hub-register-history">{JSON.stringify(event.data, null, 2)}</pre>
        </details>
      </li>)}</ul>
    </details>}
  </section>
}

function EntryForm({ book, row, proxy, busy, write }: {
  book: BookId; row: Row; proxy: boolean; busy: boolean; write: Write
}) {
  const { L } = usePrefs()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState(String(row.payload?.status ?? 'present'))
  const [date, setDate] = useState(String(row.payload?.application_date ?? ''))
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields[book].map(key => [key, String(row.payload?.[key] ?? '')])))
  const [reason, setReason] = useState('')

  async function save(event: FormEvent) {
    event.preventDefault()
    const payload = book === 'attendance'
      ? { status, ...(date && ['leave', 'absent'].includes(status) ? { application_date: date } : {}) }
      : Object.fromEntries(fields[book].map(key => [key, Number(values[key])]))
    if (await write('save', row.employee_id, payload, proxy ? reason : undefined)) setOpen(false)
  }

  if (!open) return <button type="button" className="secondary" disabled={busy} onClick={() => setOpen(true)}>
    {proxy ? L('কর্মীর পক্ষে লিখুন', 'Enter on behalf') : L('আমার তথ্য লিখুন', 'Enter my information')}
  </button>

  return <form onSubmit={save}>
    {book === 'attendance' ? <>
      <Field label={L(...labels.status)}><select value={status} onChange={event => setStatus(event.target.value)}>
        {attendance.map(value => <option key={value} value={value}>{L(...labels[value])}</option>)}
      </select></Field>
      {['absent', 'leave'].includes(status) && <Field label={L(...labels.application_date)}>
        <input type="date" max={todayDhaka()} required={status === 'leave'} value={date} onChange={event => setDate(event.target.value)} />
      </Field>}
    </> : fields[book].map(key => <Field key={key} label={L(...labels[key])}>
      <input required readOnly={key in (row.source_payload ?? {})} inputMode={money.has(key) ? 'decimal' : 'numeric'} value={values[key]}
        pattern={money.has(key) ? '[0-9]{1,12}([.][0-9]{1,2})?' : '[0-9]{1,6}'} maxLength={15}
        onChange={event => setValues(current => ({ ...current, [key]: toLatinDigits(event.target.value) }))} />
    </Field>)}
    {proxy && <Field label={L('পক্ষে এন্ট্রির কারণ', 'Reason for entering on behalf')}>
      <input required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
    </Field>}
    <button type="submit" disabled={busy}>{L('সংরক্ষণ', 'Save')}</button>{' '}
    <button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>{L('বাতিল', 'Cancel')}</button>
  </form>
}

function RuleForm({ book, register, busy, write }: { book: BookId; register: Register; busy: boolean; write: Write }) {
  const { L } = usePrefs()
  const [position, setPosition] = useState('')
  const [employee, setEmployee] = useState('')
  const [duty, setDuty] = useState('')
  const [time, setTime] = useState('23:59')
  const [required, setRequired] = useState(true)
  const all = L('সবাই', 'All')
  return <details>
    <summary>{L('দায়িত্ব ও জমার সময়', 'Assignments and deadlines')}</summary>
    <form onSubmit={event => {
      event.preventDefault()
      void write('rule', employee || null, { position_id: position || null, duty, due_at: time, required })
    }}>
      <Field label={L('পদ', 'Position')}><select value={position} onChange={event => setPosition(event.target.value)}>
        <option value="">{all}</option>
        {register.positions?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></Field>
      <Field label={L('কর্মী', 'Employee')}><select value={employee} onChange={event => setEmployee(event.target.value)}>
        <option value="">{all}</option>
        {register.people?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></Field>
      <Field label={L('দায়িত্ব', 'Duty')}><input required maxLength={120} value={duty} onChange={event => setDuty(event.target.value)} /></Field>
      <Field label={L('জমার সময় (ঢাকা)', 'Deadline (Dhaka)')}><input type="time" required value={time} onChange={event => setTime(event.target.value)} /></Field>
      {book !== 'expense' && <label><input type="checkbox" checked={required} onChange={event => setRequired(event.target.checked)} /> {L('এই খাতা প্রযোজ্য', 'Register applies')}</label>}
      <p><button type="submit" disabled={busy || !duty.trim()}>{L('দায়িত্ব সংরক্ষণ', 'Save assignment')}</button></p>
    </form>
    <ul>{register.rules?.filter(rule => rule.book === book).map(rule => <li key={rule.rule_id}>
      {register.positions?.find(item => item.id === rule.position_id)?.name ?? all} ·{' '}
      {register.people?.find(item => item.id === rule.employee_id)?.name ?? all} · {rule.duty} · {rule.due_at.slice(0, 5)} ·{' '}
      {book === 'expense' ? L('খরচ হলে প্রযোজ্য', 'Applies when there is an expense') : rule.required ? L('প্রযোজ্য', 'Applies') : L('অব্যাহতি', 'Exempt')}{' '}
      <button type="button" className="secondary" disabled={busy} onClick={() => void write('remove_rule', rule.employee_id, { position_id: rule.position_id })}>
        {L('সরান', 'Remove')}
      </button>
    </li>)}</ul>
  </details>
}
