// গ্যারেজ — the garage side of আমার অফিস.
//  · GarageOverview: every garage and auto garage the person may see, with the rent (fixed, or this month's total for an auto garage).
//  · Autos: the autos of one auto garage. Each auto has its own rate and a person responsible; that person says yes / no for every day
//    ("was the auto given today?") and the month's rent is the sum of the rates of the "yes" days. The rate is copied into the day when it is
//    marked, so changing an auto's rate never changes a past month.
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { Field, Modal, Stat, useLoad, useToast } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { autos, PLACE_KIND, scopePath, type Auto, type AutoTotal, type Property } from '../../lib/office'
import { opsFriendly } from '../../lib/officeOps'
import { sorting, type EmpLite } from '../../lib/sorting'
import { EmpPicker, empLabel } from '../sorting/Sorting'
import { askWith } from './askText'
import type { Ctx } from './OfficeOps'
import { useOfficeOutput } from './useOutput'

const dhaka = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const addDays = (iso: string, d: number) => { const t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10) }
const daysIn = (month: string) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate() }
const missingInstall = (e: unknown) => /PGRST202|Could not find the function|office_auto/i.test(String((e as { message?: string; code?: string })?.code ?? '') + ' ' + String((e as { message?: string })?.message ?? e))

type Row = { p: Property; hub: string; total: AutoTotal | null }

export function GarageOverview({ garages, hubName, onPick }: { garages: Property[]; hubName: (id: string | null) => string; onPick: (id: string) => void }) {
  const { L, n } = usePrefs()
  const go = useNavigate()
  const output = useOfficeOutput('garage-overview')
  const month = dhaka().slice(0, 7)
  const totals = useLoad(() => autos.totals(month + '-01').catch(() => [] as AutoTotal[]), [month, garages.length])
  const rows: Row[] = useMemo(() => garages.map(p => ({ p, hub: hubName(p.hub_id), total: (totals.data ?? []).find(t => t.property_id === p.id) ?? null })), [garages, totals.data, hubName])
  const open = (r: Row) => { onPick(r.p.id); go(scopePath('garage', r.p.kind === 'auto_garage' ? 'autos' : 'rent')) }
  const rentOf = (r: Row) => r.p.kind === 'auto_garage' ? Number(r.total?.amount ?? 0) : Number(r.p.rent ?? 0)
  const fixed = rows.filter(r => r.p.kind === 'garage').reduce((s, r) => s + rentOf(r), 0)
  const auto = rows.filter(r => r.p.kind === 'auto_garage').reduce((s, r) => s + rentOf(r), 0)
  if (!garages.length) return <section className="panel">
    <p className="notice">{L('এখনো কোনো গ্যারেজ যোগ হয়নি।', 'No garage yet.')} <Link to={scopePath('garage', 'places')}>{L('যোগ করুন →', 'Add one →')}</Link></p></section>
  return <>
    <div className="da-stats">
      <Stat icon="truck" label={L('গ্যারেজ', 'Garages')} value={n(rows.filter(r => r.p.kind === 'garage').length)} sub={L(`ফিক্সড ভাড়া ৳ ${n(Math.round(fixed))}`, `fixed rent ৳ ${Math.round(fixed)}`)} />
      <Stat icon="truck" label={L('অটো গ্যারেজ', 'Auto garages')} value={n(rows.filter(r => r.p.kind === 'auto_garage').length)} sub={L(`এ মাসে ৳ ${n(Math.round(auto))}`, `this month ৳ ${Math.round(auto)}`)} />
      <Stat icon="cash" label={L('এ মাসের মোট ভাড়া', 'Rent this month')} value={`৳ ${n(Math.round(fixed + auto))}`} />
    </div>
    {totals.error ? <p className="da-error">{opsFriendly(totals.error)}</p> : null}
    <section className="panel">
      <DataTable<Row> {...output} title={L('সব গ্যারেজ', 'All garages')} file="garage-overview" rows={rows} rowKey={r => r.p.id} phoneView="card" onRowClick={open}
        cols={[
          { key: 'name', label: L('গ্যারেজ', 'Garage'), primary: true, value: r => r.p.name,
            render: r => <><strong>{PLACE_KIND[r.p.kind][2]} {r.p.name}</strong>{r.hub && <span className="sec">{r.hub}</span>}</> },
          { key: 'hub', label: L('হাব', 'Hub'), hidden: true, value: r => r.hub },
          { key: 'kind', label: L('ধরন', 'Kind'), value: r => L(PLACE_KIND[r.p.kind][0], PLACE_KIND[r.p.kind][1]) },
          { key: 'cap', label: L('গাড়ির জায়গা', 'Holds'), className: 'r', value: r => r.p.capacity ?? '', render: r => r.p.capacity != null ? n(r.p.capacity) : '—' },
          { key: 'autos', label: L('অটো', 'Autos'), className: 'r', value: r => r.total?.autos ?? '', render: r => r.p.kind === 'auto_garage' ? n(r.total?.autos ?? 0) : '—' },
          { key: 'days', label: L('এ মাসে দেওয়া (দিন)', 'Days given'), className: 'r', value: r => r.total?.given_days ?? '', render: r => r.p.kind === 'auto_garage' ? n(r.total?.given_days ?? 0) : '—' },
          { key: 'rent', label: L('এ মাসের ভাড়া', 'Rent this month'), className: 'r', value: r => rentOf(r) || '',
            render: r => rentOf(r) ? <>৳ {n(Math.round(rentOf(r)))}{r.p.kind === 'auto_garage' && <small className="muted"> · {L('দিন ধরে', 'by day')}</small>}</> : '—' },
        ]} />
      <p className="muted small">{L('গ্যারেজে চাপলে ভাড়া/অটোর পাতা খুলবে। অটো গ্যারেজের ভাড়া মাসের "হ্যাঁ" দিন গুনে নিজে হিসাব হয়।', 'Tap a garage to open it. An auto garage’s rent is worked out from the month’s "yes" days.')}</p>
    </section>
  </>
}

// ---------------------------------------------------------------- autos of one auto garage
type F = { id?: string; name: string; reg: string; rate: string; note: string; emp: EmpLite | null }

export function Autos({ ctx }: { ctx: Ctx }) {
  const { can } = useAuth()
  const { L, n } = usePrefs()
  const { toast, node } = useToast()
  const [month, setMonth] = useState(() => dhaka().slice(0, 7))
  const first = month + '-01'
  const list = useLoad(() => ctx.p.kind === 'auto_garage' ? autos.list(ctx.p.id, first) : Promise.resolve([] as Auto[]), [ctx.p.id, ctx.p.kind, first])
  const [f, setF] = useState<F | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const today = dhaka()
  const canEdit = can('office.property.edit')
  useEffect(() => { setErr('') }, [ctx.p.id])
  if (ctx.p.kind !== 'auto_garage') return <section className="panel"><p className="notice">{L('এটা অটো গ্যারেজ নয়। অটো ও হ্যাঁ/না শুধু "অটো গ্যারেজ" ধরনের জায়গায় থাকে — গ্যারেজের তালিকা থেকে অটো গ্যারেজ বেছে নিন, বা নতুন যোগ করুন।', 'This is not an auto garage. Autos and yes/no live only on places of kind "Auto garage" — pick one above or add one.')} <Link to={scopePath('garage', 'places')}>{L('গ্যারেজের তালিকা →', 'Garage list →')}</Link></p></section>

  const all = list.data ?? []
  const totalAmount = all.reduce((s, a) => s + Number(a.amount), 0)
  const totalDays = all.reduce((s, a) => s + Number(a.given_days), 0)
  const dim = daysIn(month)
  // The person responsible may mark today and two days back; the hub's editor may fix any past day. The database checks the same.
  const markable = (a: Auto, day: string) => a.can_mark && day <= today && (canEdit || day >= addDays(today, -2))

  async function mark(a: Auto, day: string, given: boolean) {
    setErr('')
    try { await autos.mark(a.id, day, given); await list.reload() } catch (e) { setErr(opsFriendly(e)) }
  }
  async function edit(a?: Auto) {
    setErr('')
    let emp: EmpLite | null = null
    if (a?.responsible_id) { try { emp = (await sorting.employeesByIds([a.responsible_id]))[0] ?? null } catch { emp = null } }
    setF({ id: a?.id, name: a?.name ?? '', reg: a?.reg_no ?? '', rate: a ? String(a.rate) : '', note: a?.note ?? '', emp })
  }
  async function save() {
    if (!f) return
    const rate = Number(f.rate)
    if (!f.name.trim()) return setErr(L('অটোর নাম দিন', 'Give the auto a name'))
    if (!Number.isFinite(rate) || rate < 0 || f.rate.trim() === '') return setErr(L('প্রতিদিনের ভাড়া (৳) দিন', 'Give the daily rent (৳)'))
    setBusy(true); setErr('')
    try {
      await autos.save(ctx.p.id, { name: f.name.trim(), rate, responsible: f.emp?.id ?? null, reg: f.reg.trim() || null, note: f.note.trim() || null }, f.id)
      setF(null); await list.reload(); toast(L('সেভ হয়েছে', 'Saved'))
    } catch (e) { setErr(opsFriendly(e)) } finally { setBusy(false) }
  }
  async function remove(a: Auto) {
    const why = await askWith(L)(L(`"${a.name}" সরানোর কারণ`, `Why remove "${a.name}"?`)); if (!why) return
    try { await autos.archive(a.id, why); await list.reload(); toast(L('সরানো হয়েছে', 'Removed')) } catch (e) { setErr(opsFriendly(e)) }
  }

  return <>{node}
    <div className="da-stats">
      <Stat icon="truck" label={L('অটো', 'Autos')} value={n(all.length)} />
      <Stat icon="check" label={L('এ মাসে "হ্যাঁ" দিন', '"Yes" days')} value={n(totalDays)} />
      <Stat icon="cash" label={L('মাসের ভাড়া', 'Rent for the month')} value={`৳ ${n(Math.round(totalAmount))}`} />
    </div>
    <section className="panel">
      <div className="da-bar"><h2>{L('অটো ও দৈনিক হ্যাঁ/না', 'Autos & daily yes/no')} <span className="count-pill">{n(all.length)}</span></h2>
        <span className="row-acts">
          <input type="month" value={month} max={today.slice(0, 7)} onChange={e => e.target.value && setMonth(e.target.value)} aria-label={L('মাস', 'Month')} />
          {canEdit && <button onClick={() => void edit()}><Icon name="plus" size={15} />{L('অটো যোগ', 'Add auto')}</button>}
        </span></div>
      <p className="muted small">{L('প্রতিটা অটোর নিজের দর। যিনি দায়িত্বে আছেন তিনি প্রতিদিন "হ্যাঁ" (অটো দেওয়া হয়েছে) বা "না" দেন; মাসের ভাড়া = "হ্যাঁ" দিনের দরের যোগফল। দর বদলালে আগের দিনের হিসাব বদলায় না।',
        'Each auto has its own rate. The person responsible says "yes" (the auto was given) or "no" every day; the month’s rent is the rates of the "yes" days. Changing a rate never changes past days.')}</p>
      {(err || list.error) && !f ? <p className="da-error">{err || (missingInstall(list.error) ? L('অটোর ডাটাবেস অংশ এখনো বসানো হয়নি।', 'The autos part of the database is not installed yet.') : opsFriendly(list.error))}</p> : null}
      {list.loading && !list.data ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>
        : !all.length ? <p className="muted">{L('এখনো কোনো অটো যোগ হয়নি।', 'No auto yet.')}</p>
        : <div className="ofm-cards">{all.map(a => {
          const byDay = new Map(a.days.map(d => [d.day.slice(0, 10), d]))
          const todayRow = byDay.get(today)
          return <article key={a.id} className="ofm-card">
            <header><span className="ofm-ic"><Icon name="truck" size={18} /></span>
              <span className="tx"><b>{a.name}{a.reg_no ? ` · ${a.reg_no}` : ''}</b><small>৳ {n(Math.round(Number(a.rate)))} {L('প্রতি দিন', 'per day')}</small></span></header>
            <div className="ofm-who"><Icon name="user" size={13} />{a.responsible ? `${a.responsible_code ? a.responsible_code + ' · ' : ''}${a.responsible}` : <span className="muted">{L('দায়িত্বে কেউ নেই', 'Nobody responsible')}</span>}</div>
            <p><b>{L(`${n(a.given_days)} দিন`, `${a.given_days} days`)}</b> · <b>৳ {n(Math.round(Number(a.amount)))}</b></p>
            {month === today.slice(0, 7) && markable(a, today) && <p className="row-acts">
              <span>{L('আজ:', 'Today:')}</span>
              <button className={todayRow?.given === true ? 'sm' : 'secondary sm'} onClick={() => void mark(a, today, true)}><Icon name="check" size={14} />{L('হ্যাঁ', 'Yes')}</button>
              <button className={todayRow?.given === false ? 'sm' : 'secondary sm'} onClick={() => void mark(a, today, false)}>{L('না', 'No')}</button>
              {todayRow?.by && <small className="muted">{todayRow.by}</small>}</p>}
            <div className="da-seg" role="group" aria-label={L('মাসের দিন', 'Days of the month')} style={{ flexWrap: 'wrap', gap: 4 }}>
              {Array.from({ length: dim }, (_, i) => {
                const day = `${month}-${String(i + 1).padStart(2, '0')}`
                const d = byDay.get(day); const can = markable(a, day)
                const label = d ? (d.given ? '✓' : '✗') : '·'
                return <button key={day} type="button" className={d?.given ? 'sm' : 'secondary sm'} disabled={!can}
                  title={d ? `${day} — ${d.given ? L('হ্যাঁ', 'yes') : L('না', 'no')}${d.by ? ' · ' + d.by : ''}` : day}
                  style={{ minWidth: 34, opacity: d ? 1 : 0.6 }} onClick={() => void mark(a, day, !(d?.given ?? false))}>{i + 1}{label}</button>
              })}
            </div>
            {canEdit && <p className="row-acts">
              <button className="secondary sm" onClick={() => void edit(a)}>{L('এডিট', 'Edit')}</button>
              <button className="secondary sm" onClick={() => void remove(a)}>{L('সরান', 'Remove')}</button></p>}
          </article> })}</div>}
    </section>
    {f && <Modal title={f.id ? L('অটো এডিট', 'Edit auto') : L('অটো যোগ', 'Add auto')} onClose={() => { if (!busy) setF(null) }}
      actions={<><button className="secondary" disabled={busy} onClick={() => setF(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ', 'Save')}</button></>}>
      <div className="hr-form">
        <Field label={L('অটোর নাম / নম্বর', 'Auto name / number')}><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={L('রেজিস্ট্রেশন (ইচ্ছা হলে)', 'Registration (optional)')}><input value={f.reg} onChange={e => setF({ ...f, reg: e.target.value })} /></Field>
        <Field label={L('প্রতিদিনের ভাড়া (৳) — "হ্যাঁ" দিনে', 'Rent per "yes" day (৳)')}><input inputMode="decimal" value={f.rate} onChange={e => setF({ ...f, rate: e.target.value })} /></Field>
        <EmpPicker label={L('দায়িত্বে (এমপ্লয়ি আইডি)', 'Responsible (employee ID)')} value={f.emp} onPick={emp => setF(x => x && { ...x, emp })}
          hint={f.emp ? empLabel(f.emp) : L('ইনি প্রতিদিন হ্যাঁ/না দেবেন', 'This person answers yes/no every day')} />
        <Field label={L('নোট', 'Note')} wide><input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </>
}
