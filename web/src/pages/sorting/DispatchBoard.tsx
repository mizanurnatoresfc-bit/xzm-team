import { useEffect, useState } from 'react'
import { sorting } from '../../lib/sorting'
import { Field, Modal, useLoad } from '../accounts/ui'

const time = (value: string) => new Date(value).toLocaleTimeString('bn-BD', {
  timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit',
})

const categories: Record<string, string> = {
  late: 'গাড়ি দেরি', unload: 'আনলোডে সমস্যা', absent: 'দায়িত্বপ্রাপ্ত ব্যক্তি নেই',
  conduct: 'নির্দেশনা মানেননি', wrong_hub: 'ভুল হাবের পার্সেল', other: 'অন্যান্য',
}
type ReportForm =
  | { action: 'new'; id: string; trip: string; position: number; category: string }
  | { action: 'assign' | 'reply' | 'resolve'; id: string }

export function DispatchBoard() {
  const { data, error, reload } = useLoad(() => sorting.dispatches(), [])
  const reports = useLoad(() => sorting.dispatchReports(), [])
  const [form, setForm] = useState<ReportForm | null>(null)
  const [detail, setDetail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload()
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [reload])

  async function update(id: string, position: number, arrive: boolean) {
    setBusy(true)
    setMessage('')
    try {
      await sorting.stepDispatch(id, position, arrive)
      await reload()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  function openReport(next: ReportForm) {
    setMessage('')
    setDetail('')
    setCode('')
    setForm(next)
  }

  async function submitReport() {
    if (!form || !detail.trim()) return
    setBusy(true)
    setMessage('')
    try {
      if (form.action === 'new') {
        await sorting.reportDispatch(form.id, form.trip, form.position, form.category, detail)
      } else {
        await sorting.actOnDispatchReport(form.id, form.action, detail, code)
      }
      setForm(null)
      await reports.reload()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return <section className="panel">
    <div className="da-bar"><h2>শুটিং ট্রিপ</h2>
      <button className="secondary sm" type="button" onClick={() => { void reload(); void reports.reload() }}>আপডেট দেখুন</button>
    </div>
    {error != null && <p className="da-error">{error instanceof Error ? error.message : String(error)}</p>}
    {message && !form && <p className="da-error" role="alert">{message}</p>}
    {data?.length === 0 && <p className="muted">দেখার জন্য কোনো শুটিং ট্রিপ নেই।</p>}
    {data?.map(trip => {
      const current = trip.stops.find(stop => !stop.departed_at)
      return <article key={trip.id} className="panel">
        <h3>{trip.route} · {trip.vehicle}</h3>
        <p>ড্রাইভার {trip.driver ?? '—'}{trip.helper && ` · হেল্পার ${trip.helper}`}</p>
        <p>শুটিং থেকে ছেড়েছে {time(trip.departed_at)}{trip.completed_at && ` · সম্পন্ন ${time(trip.completed_at)}`}</p>
        <ol>{trip.stops.map(stop => <li key={stop.position}>
          <strong>{stop.hub}</strong>
          {' · '}{stop.departed_at ? `স্টপ সম্পন্ন ${time(stop.departed_at)}` :
            stop.arrived_at ? `পৌঁছেছে ${time(stop.arrived_at)}` : stop === current ? 'এই হাবের পথে' : 'আগের স্টপ বাকি'}
          {stop.parcels !== null && ` · পার্সেল ${stop.parcels}`}
          {stop.bags !== null && ` · ব্যাগ ${stop.bags}`}
          {stop.parcels !== null && <button type="button" className="secondary sm"
            onClick={() => openReport({ action: 'new', id: crypto.randomUUID(), trip: trip.id, position: stop.position, category: 'late' })}>
            জোনালকে রিপোর্ট দিন
          </button>}
        </li>)}</ol>
        {trip.can_step && current && <button type="button" disabled={busy || (!!current.arrived_at && !current.received)}
          onClick={() => void update(trip.id, current.position, !current.arrived_at)}>
          {!current.arrived_at ? 'পৌঁছেছি' : !current.received ? 'হাবের রিসিভ বাকি' :
            current.position === trip.stops.length ? 'ট্রিপ শেষ করুন' : 'পরের হাবের পথে ছাড়ুন'}
        </button>}
      </article>
    })}
    {!!reports.data?.length && <div>
      <h3>ট্রিপের জোনাল রিপোর্ট</h3>
      {reports.data.map(report => <article className="panel" key={report.id}>
        <strong>{report.route} · {report.hub} · {categories[report.category]}</strong>
        <p>{report.detail}</p>
        {report.instruction && <p>নির্দেশনা · {report.assignee} · {report.instruction}</p>}
        {report.reply && <p>জবাব · {report.reply}</p>}
        {report.resolution ? <p>সমাধান · {report.resolution}</p> :
          <div className="row-acts">
            {report.can_manage && <>
              <button type="button" onClick={() => openReport({ action: 'assign', id: report.id })}>ব্যক্তিকে জানান</button>
              <button type="button" disabled={!!report.instruction && !report.reply}
                onClick={() => openReport({ action: 'resolve', id: report.id })}>সমাধান লিখুন</button>
            </>}
            {report.can_reply && <button type="button" onClick={() => openReport({ action: 'reply', id: report.id })}>জবাব দিন</button>}
          </div>}
      </article>)}
    </div>}
    {form && <Modal title={{ new: 'জোনাল ম্যানেজারকে রিপোর্ট', assign: 'ব্যক্তিকে জানান', reply: 'জবাব দিন', resolve: 'সমাধান লিখুন' }[form.action]}
      onClose={() => { if (!busy) setForm(null) }} actions={<button type="button"
        disabled={busy || !detail.trim() || (form.action === 'assign' && !code.trim())} onClick={() => void submitReport()}>জমা দিন</button>}>
      {form.action === 'new' && <Field label="সমস্যার ধরন">
        <select value={form.category} onChange={event => setForm({ ...form, category: event.target.value })}>
          {Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </Field>}
      {form.action === 'assign' && <Field label="কর্মীর আইডি"><input value={code} onChange={event => setCode(event.target.value)} /></Field>}
      <Field label="বিবরণ"><textarea maxLength={2000} value={detail} onChange={event => setDetail(event.target.value)} /></Field>
      {message && <p className="da-error" role="alert">{message}</p>}
    </Modal>}
  </section>
}
