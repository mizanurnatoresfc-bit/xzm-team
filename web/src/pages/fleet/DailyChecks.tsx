import './dailyChecks.css'
import { useEffect, useState } from 'react'
import { fleet, fleetFriendly, type BoardRow, type DailyCheckKind, type DailyCheckRow, type DailyCheckSource, type MyVehicle } from '../../lib/fleet'
import { Field, Modal, useLoad, useToast } from '../accounts/ui'
import { bnNum, timeBn, todayDhaka } from './common'

const CHECKS = {
  departure: { label: 'গাড়ি বের হয়েছে', states: { departed: 'বের হয়েছে', no_trip: 'আজ ট্রিপ নেই' } },
  charge: { label: 'অটো চার্জ', states: { charging: 'চার্জে লাগানো', charged: 'চার্জ শেষ', issue: 'চার্জে সমস্যা', not_needed: 'চার্জ দরকার নেই' } },
  garage: { label: 'গ্যারেজ চেক', states: { parked: 'গ্যারেজে আছে', outside: 'বাইরে আছে', service: 'সার্ভিসে আছে' } },
} satisfies Record<DailyCheckKind, { label: string; states: Record<string, string> }>

const DETAILS: Record<string, string> = {
  departed: 'ছাড়ার সময়, ড্রাইভার ও রুট',
  no_trip: 'ট্রিপ না থাকার কারণ',
  issue: 'চার্জার বা ব্যাটারির সমস্যা',
  outside: 'অবস্থান, কারণ ও দায়িত্বপ্রাপ্ত ব্যক্তি',
  service: 'সার্ভিসের স্থান, কারণ ও দায়িত্বপ্রাপ্ত ব্যক্তি',
}

const kinds = (kind: string): DailyCheckKind[] => kind === 'auto' ? ['departure', 'charge', 'garage'] : ['departure']
const label = (kind: DailyCheckKind, state: string) => (CHECKS[kind].states as Record<string, string>)[state] ?? state
const getCheck = (row: DailyCheckRow | undefined, kind: DailyCheckKind, source: DailyCheckSource) =>
  row?.checks.find(c => c.kind === kind && c.source === source)
const dhakaHour = () => Number(new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Dhaka',
}).format(new Date()))

export function ManagerDailyChecks() {
  const [hub, setHub] = useState('')
  const [hour, setHour] = useState(dhakaHour)
  useEffect(() => {
    const timer = window.setInterval(() => setHour(dhakaHour()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const date = todayDhaka()
  const data = useLoad(() => fleet.dailyChecks(date), [date])
  const { toast, node } = useToast()
  const vehicles = data.data ?? []
  const hubs = [...new Map(vehicles.map(v => [v.hub_id, v.hub_name]))]
  const rows = vehicles.filter(v => !hub || v.hub_id === hub)
  const state = (id: string, kind: DailyCheckKind) =>
    getCheck(data.data?.find(r => r.vehicle_id === id), kind, 'manager')?.state
  const autos = rows.filter(v => v.kind === 'auto')
  const parked = autos.filter(v => state(v.vehicle_id, 'garage') === 'parked').length
  const outside = autos.filter(v => ['outside', 'service'].includes(state(v.vehicle_id, 'garage') ?? '')).length
  const overdue = rows.reduce((count, v) => count + kinds(v.kind).filter(k =>
    !state(v.vehicle_id, k) && hour >= (k === 'departure' ? 10 : 21)).length, 0)
  return <section aria-label="আজকের গাড়ি চেক">
    {node}
    {data.error ? <p role="alert" className="da-error">{fleetFriendly(data.error)}</p>
      : !data.data ? <p className="muted">লোড হচ্ছে…</p> : <>
        {hubs.length > 1 && <Field label="হাব"><select value={hub} onChange={e => setHub(e.target.value)}>
          <option value="">সব হাব</option>
          {hubs.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></Field>}
        <p className="notice">অটো {bnNum(autos.length)}টি · গ্যারেজে {bnNum(parked)} · বাইরে বা সার্ভিসে {bnNum(outside)} · গ্যারেজ যাচাই বাকি {bnNum(autos.length - parked - outside)}</p>
        {overdue > 0 && <p className="notice" role="status">সময় পেরিয়েছে · {bnNum(overdue)}টি চেক নিশ্চিত করা বাকি।</p>}
        {!rows.length && <p className="muted">নির্বাচিত হাবে চেক করার মতো গাড়ি নেই।</p>}
        <div className="nv-rows">{rows.map(row =>
          <CheckCard key={row.vehicle_id} vehicle={{ ...row, id: row.vehicle_id }} row={row} date={date} source="manager"
            editable={row.can_confirm} onSaved={() => { toast('যাচাই সেভ হয়েছে'); void data.reload() }} />
        )}</div>
      </>}
  </section>
}

export function CrewDailyChecks({ vehicle }: { vehicle: MyVehicle }) {
  const date = todayDhaka()
  const data = useLoad(() => fleet.dailyChecks(date, vehicle.id), [date, vehicle.id])
  const { toast, node } = useToast()
  if (!vehicle.hub_id) return null
  return <section>
    <h2 className="sd-h">আজকের গাড়ি আপডেট</h2>
    {node}
    {data.error ? <p role="alert" className="da-error">{fleetFriendly(data.error)}</p>
      : !data.data ? <p className="muted">লোড হচ্ছে…</p>
      : <CheckCard key={vehicle.id} vehicle={vehicle} row={data.data.find(r => r.vehicle_id === vehicle.id)}
        date={date} source="crew" editable={vehicle.role === 'driver'}
        onSaved={() => { toast('আপডেট পাঠানো হয়েছে'); void data.reload() }} />}
  </section>
}

function CheckCard({ vehicle, row, date, source, editable, onSaved }: {
  vehicle: Pick<BoardRow, 'id' | 'name' | 'kind' | 'hub_name'>; row?: DailyCheckRow; date: string
  source: DailyCheckSource; editable: boolean; onSaved: () => void
}) {
  const [open, setOpen] = useState<DailyCheckKind | null>(null)
  const initial = open ? getCheck(row, open, source) ?? getCheck(row, open, 'crew') : undefined
  return <article className="panel fleet-check-card">
    <strong>{vehicle.name}</strong><span className="muted small"> · {vehicle.hub_name}</span>
    {kinds(vehicle.kind).map(kind => {
      const manager = getCheck(row, kind, 'manager')
      const crew = getCheck(row, kind, 'crew')
      return <div className="fleet-check-line" key={kind}>
        <div>
          <b>{CHECKS[kind].label}</b>
          <div className="small">{manager ? `ম্যানেজার: ${label(kind, manager.state)} · ${manager.checked_name ?? '—'} · ${timeBn(manager.checked_at)}${manager.detail ? ` · ${manager.detail}` : ''}` : 'ম্যানেজারের যাচাই বাকি'}</div>
          {crew && <div className="small muted">ড্রাইভার: {label(kind, crew.state)} · {timeBn(crew.checked_at)}{crew.detail ? ` · ${crew.detail}` : ''}</div>}
        </div>
        {editable && <button type="button" className="nv-chip" aria-label={CHECKS[kind].label} onClick={() => setOpen(kind)}>
          {source === 'crew' ? 'আপডেট দিন' : manager ? 'সংশোধন' : 'যাচাই করুন'}
        </button>}
      </div>
    })}
    {open && <CheckForm vehicle={vehicle.id} name={vehicle.name} date={date} kind={open} source={source}
      initial={initial} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); onSaved() }} />}
  </article>
}

function CheckForm({ vehicle, name, date, kind, source, initial, onClose, onSaved }: {
  vehicle: string; name: string; date: string; kind: DailyCheckKind; source: DailyCheckSource
  initial?: { state: string; detail: string | null }; onClose: () => void; onSaved: () => void
}) {
  const [state, setState] = useState(initial?.state ?? '')
  const [detail, setDetail] = useState(initial?.detail ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save() {
    setBusy(true)
    setError('')
    try {
      await fleet.saveDailyCheck(vehicle, date, kind, source, state, detail.trim())
      onSaved()
    } catch (err) {
      setError(fleetFriendly(err))
      setBusy(false)
    }
  }
  return <Modal title={`${CHECKS[kind].label} · ${name}`} onClose={() => { if (!busy) onClose() }}
    actions={<button type="button" className="btn primary" disabled={busy || !state || (!!DETAILS[state] && !detail.trim())}
      onClick={() => void save()}>{busy ? 'সেভ হচ্ছে…' : source === 'manager' ? 'নিশ্চিত করুন' : 'আপডেট পাঠান'}</button>}>
    <Field label="অবস্থা">
      <select value={state} onChange={e => { setState(e.target.value); setDetail('') }}>
        <option value="">বেছে নিন</option>
        {Object.entries(CHECKS[kind].states).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
    </Field>
    <Field label={DETAILS[state] ?? (state === 'charging' ? 'চার্জে লাগানোর সময় ও নোট' : 'নোট')}>
      <textarea maxLength={500} value={detail} onChange={e => setDetail(e.target.value)} />
    </Field>
    {error && <p role="alert" className="da-error">{error}</p>}
  </Modal>
}
