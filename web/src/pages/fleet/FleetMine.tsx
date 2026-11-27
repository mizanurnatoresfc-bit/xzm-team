import { useState } from 'react'
import { Contact } from '../../components/Contact'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { COST_KIND, COST_STATUS, REPORT_STATUS, REQ_KIND, REQ_STATUS, ROLE_BN, fleet, fleetFriendly, fnOn,
  type Mine, type MyVehicle, type ReportStatus, type ReqKind } from '../../lib/fleet'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'
import { FormFields, PhotoPick, Thumb, dayBn, missing, tk, todayDhaka } from './common'

import { CrewDailyChecks } from './DailyChecks'

type Open = '' | 'report' | 'fuel' | 'request'

/** আমার গাড়ি — the driver's / helper's own panel: hub reports, fuel with the slip, service requests with photos, and their costs. */
export function FleetMine() {
  const d = useLoad(() => fleet.mine(), [])
  const { toast, node } = useToast()
  const [pick, setPick] = useState(0)
  const [open, setOpen] = useState<Open>('')
  const m = d.data
  const v = m?.vehicles[Math.min(pick, (m?.vehicles.length ?? 1) - 1)]
  const done = (msg: string) => { setOpen(''); toast(msg); void d.reload() }

  return <AppShell title="আমার গাড়ি" subtitle={v ? `${v.name}${v.reg_no ? ` · ${v.reg_no}` : ''}` : 'ড্রাইভার ও হেল্পারের প্যানেল'}>
    <div className="sd sp fl">
      {node}
      {d.error ? <p className="da-error">{fleetFriendly(d.error)}</p> : !m && d.loading ? <p className="muted">লোড হচ্ছে…</p>
        : !m || !v ? <div className="nv-empty panel"><Icon name="truck" size={30} /><p>আপনার নামে এখন কোনো গাড়ি নেই।</p>
            <p className="small">গাড়ির ড্রাইভার বা হেল্পার করা হলে এখানে দেখা যাবে।</p></div> : <>
        {m.vehicles.length > 1 && <div className="nv-chips">{m.vehicles.map((x, i) => <button key={x.id + x.role} type="button" className={`nv-chip${i === pick ? ' on' : ''}`} onClick={() => setPick(i)}>{x.name}</button>)}</div>}
        <Hero v={v} />
        <CrewDailyChecks vehicle={v} />
        <div className="fl-acts">
          {fnOn(m.functions, 'hub_report') && <button type="button" className="fl-act t-b" onClick={() => setOpen('report')}><span className="i"><Icon name="hub" size={22} /></span>হাব রিপোর্ট দিন</button>}
          {fnOn(m.functions, 'fuel') && <button type="button" className="fl-act t-o" onClick={() => setOpen('fuel')}><span className="i"><Icon name="cash" size={22} /></span>তেল / স্লিপ দিন</button>}
          {fnOn(m.functions, 'service') && <button type="button" className="fl-act t-p" onClick={() => setOpen('request')}><span className="i"><Icon name="gear" size={22} /></span>সার্ভিস / পার্টস চাই</button>}
        </div>
        {fnOn(m.functions, 'hub_report') && <Reports v={v} />}
        <Costs v={v} garageOn={fnOn(m.functions, 'garage')} />
        {fnOn(m.functions, 'service') && <Requests v={v} />}
        {open === 'report' && <ReportForm v={v} onClose={() => setOpen('')} onDone={() => done('রিপোর্ট পাঠানো হয়েছে')} />}
        {open === 'fuel' && <FuelForm v={v} onClose={() => setOpen('')} onDone={() => done('তেলের হিসাব গেছে — ম্যানেজারের অনুমোদনের অপেক্ষায়')} />}
        {open === 'request' && <RequestForm v={v} m={m} onClose={() => setOpen('')} onDone={() => done('রিকুইজিশন পাঠানো হয়েছে')} />}
      </>}
    </div>
  </AppShell>
}

function Hero({ v }: { v: MyVehicle }) {
  return <div className="sp-hero fl-hero">
    <span className={`nv-av fleet-avatar fleet-avatar-${v.role === 'helper' ? 'helper' : v.kind === 'auto' ? 'auto' : 'driver'}`} aria-hidden="true">
      {v.role === 'helper' ? '📦' : v.kind === 'auto' ? '🛺' : '🚚'}
    </span>
    <span className="tx"><small>{v.role === 'driver' && v.kind === 'auto' ? 'অটো ড্রাইভার' : ROLE_BN[v.role]} · {v.hub_name ?? '—'}</small><b>{v.name}</b><span>{v.reg_no ?? 'নম্বর লেখা নেই'}</span>
      {v.crew.map(c => <span key={c.role}>{ROLE_BN[c.role]}: {c.name}{c.mobile && <> <Contact phone={c.mobile} showNumber={false} /></>}</span>)}</span>
    {v.allowance ? <span className="sp-att"><Icon name="wallet" size={15} />খোরাকি {tk(v.allowance)}</span> : null}
  </div>
}

function Reports({ v }: { v: MyVehicle }) {
  const today = v.reports.filter(r => r.date === todayDhaka())
  return <>
    <h2 className="sd-h">আজকের হাব রিপোর্ট</h2>
    <div className="nv-rows">{today.length ? today.map(r => <div key={r.id} className="nv-row">
      <span className={`nv-av sd-i ${REPORT_STATUS[r.status][1] === 'ok' ? 'g' : REPORT_STATUS[r.status][1] === 'bad' ? 'r' : 'o'}`}><Icon name="hub" size={20} /></span>
      <span className="tx"><b>{r.hub_name}</b><span>{REPORT_STATUS[r.status][0]}{r.late_minutes ? ` · ${r.late_minutes.toLocaleString('bn-BD')} মিনিট` : ''}{r.note ? ` · ${r.note}` : ''}</span></span></div>)
      : <p className="nv-none">আজ এখনো কোনো হাবের রিপোর্ট দেননি।</p>}</div>
  </>
}

function Costs({ v, garageOn }: { v: MyVehicle; garageOn: boolean }) {
  const isAuto = v.kind === 'auto'
  const total = v.costs.filter(c => c.status === 'approved').reduce((a, c) => a + Number(c.amount), 0)
  return <>
    <h2 className="sd-h">আমার গাড়ির বিল ও খরচ <span className="muted small">(৬০ দিন · অনুমোদিত {tk(total)})</span></h2>
    {isAuto && garageOn && <div className="nv-rows">{v.garage.slice(0, 7).map(g => <div key={g.date} className="nv-row">
      <span className={`nv-av sd-i ${g.charged ? 'g' : 'r'}`}><Icon name={g.charged ? 'check' : 'x'} size={20} /></span>
      <span className="tx"><b>{dayBn(g.date)} — {g.charged ? 'গ্যারেজে চার্জ হয়েছে' : 'চার্জ হয়নি'}</b><span>{[g.place, g.note].filter(Boolean).join(' · ') || 'ম্যানেজার লিখেছেন'}</span></span>
      {g.cost ? <span className="end"><b>{tk(g.cost)}</b></span> : null}</div>)}
      {!v.garage.length && <p className="nv-none">ম্যানেজার এখনো গ্যারেজ চার্জ লেখেননি।</p>}</div>}
    <div className="nv-rows">{v.costs.slice(0, 20).map(c => <div key={c.id} className="nv-row">
      <span className="nv-av sd-i o"><Icon name={c.kind === 'khoraki' ? 'wallet' : c.kind === 'fuel' ? 'cash' : 'receipt'} size={20} /></span>
      <span className="tx"><b>{COST_KIND[c.kind] ?? c.kind}{c.litres ? ` · ${c.litres.toLocaleString('bn-BD')} লিটার` : ''}</b>
        <span>{dayBn(c.date)}{c.voucher ? ` · ভাউচার ${c.voucher}` : c.posted ? ' · হিসাব খাতায় উঠেছে' : ''}{c.note ? ` · ${c.note}` : ''}</span></span>
      <span className="end"><b>{tk(c.amount)}</b><Badge tone={COST_STATUS[c.status][1]}>{COST_STATUS[c.status][0]}</Badge></span></div>)}
      {!v.costs.length && <p className="nv-none">এই ৬০ দিনে কোনো খরচ ওঠেনি।</p>}</div>
  </>
}

function Requests({ v }: { v: MyVehicle }) {
  return <>
    <h2 className="sd-h">আমার রিকুইজিশন</h2>
    <div className="nv-rows">{v.requests.slice(0, 10).map(q => <div key={q.id} className="nv-row">
      <span className="nv-av sd-i p"><Icon name="gear" size={20} /></span>
      <span className="tx"><b>{q.title}</b><span>{q.no} · {REQ_KIND[q.kind] ?? q.kind} · {dayBn(q.created_at)}{q.note ? ` · ${q.note}` : ''}</span>
        {q.photos.length > 0 && <span className="fl-photos small">{q.photos.slice(0, 4).map(p => <Thumb key={p} path={p} size={40} />)}</span>}</span>
      <span className="end">{q.cost ? <b>{tk(q.cost)}</b> : null}<Badge tone={REQ_STATUS[q.status]?.[1] ?? 'neutral'}>{REQ_STATUS[q.status]?.[0] ?? q.status}</Badge></span></div>)}
      {!v.requests.length && <p className="nv-none">এখনো কোনো রিকুইজিশন দেননি।</p>}</div>
  </>
}

// ------------------------------------------------------------------ forms
function ReportForm({ v, onClose, onDone }: { v: MyVehicle; onClose: () => void; onDone: () => void }) {
  const [hub, setHub] = useState(v.hub_id ?? v.zone_hubs[0]?.id ?? '')
  const [st, setSt] = useState<ReportStatus>('on_time')
  const [min, setMin] = useState(''); const [note, setNote] = useState(''); const [photos, setPhotos] = useState<string[]>([])
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const needNote = st === 'no_trip' || st === 'other'
  async function send() {
    if (!hub) return setErr('কোন হাব, বেছে নিন')
    if (needNote && !note.trim()) return setErr('কী হয়েছে লিখুন')
    setBusy(true); setErr('')
    try { await fleet.report({ vehicle: v.id, hub, status: st, minutes: min ? Number(min) : null, note: note.trim(), photo: photos[0] ?? null }); onDone() }
    catch (e) { setErr(fleetFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title="হাব রিপোর্ট" onClose={onClose} actions={<><button className="secondary" onClick={onClose}>বাতিল</button>
    <button disabled={busy} onClick={() => void send()}>{busy ? 'পাঠানো হচ্ছে…' : 'পাঠান'}</button></>}>
    <Field label="কোন হাব *"><select id="fl-hub" value={hub} onChange={e => setHub(e.target.value)}>{v.zone_hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
    <div className="fl-status">{(Object.keys(REPORT_STATUS) as ReportStatus[]).map(k => <button key={k} type="button" className={`fl-st t-${REPORT_STATUS[k][1]}${st === k ? ' on' : ''}`}
      aria-pressed={st === k} onClick={() => setSt(k)}>{REPORT_STATUS[k][0]}</button>)}</div>
    {(st === 'load_late' || st === 'unload_late') && <Field label="কত মিনিট দেরি"><input type="number" min={0} inputMode="numeric" value={min} onChange={e => setMin(e.target.value)} /></Field>}
    <Field label={needNote ? 'কী হয়েছে *' : 'মন্তব্য'}><textarea id="fl-note" rows={2} value={note} onChange={e => setNote(e.target.value)} /></Field>
    <PhotoPick vehicle={v.id} value={photos} onChange={setPhotos} max={1} />
    <p className="muted small">দেরি বা ট্রিপ না হলে জোনাল ম্যানেজার সাথে সাথে জানবেন।</p>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

function FuelForm({ v, onClose, onDone }: { v: MyVehicle; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(''); const [litres, setLitres] = useState(''); const [pump, setPump] = useState(''); const [note, setNote] = useState('')
  const [slip, setSlip] = useState<string[]>([])
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  async function send() {
    if (!(Number(amount) > 0)) return setErr('কত টাকার তেল, লিখুন')
    setBusy(true); setErr('')
    try { await fleet.fuel({ vehicle: v.id, amount: Number(amount), litres: litres ? Number(litres) : null, pump: pump.trim() || null, slip: slip[0] ?? null, note: note.trim() || null }); onDone() }
    catch (e) { setErr(fleetFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title="তেল ও তেলের স্লিপ" onClose={onClose} actions={<><button className="secondary" onClick={onClose}>বাতিল</button>
    <button disabled={busy} onClick={() => void send()}>{busy ? 'পাঠানো হচ্ছে…' : 'জমা দিন'}</button></>}>
    <div className="fl-grid2">
      <Field label="টাকা *"><input id="fl-amount" type="number" min={1} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
      <Field label="লিটার"><input type="number" min={0} step="0.1" inputMode="decimal" value={litres} onChange={e => setLitres(e.target.value)} /></Field>
    </div>
    <Field label="পাম্পের নাম"><input value={pump} onChange={e => setPump(e.target.value)} /></Field>
    <PhotoPick vehicle={v.id} value={slip} onChange={setSlip} max={1} label="স্লিপের ছবি" />
    <Field label="মন্তব্য"><input value={note} onChange={e => setNote(e.target.value)} /></Field>
    <p className="muted small">ম্যানেজার অনুমোদন দিলে হাবের হিসাব খাতায় ভাউচারসহ উঠবে।</p>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

function RequestForm({ v, m, onClose, onDone }: { v: MyVehicle; m: Mine; onClose: () => void; onDone: () => void }) {
  const kinds = (Object.keys(REQ_KIND) as ReqKind[]).filter(k => k !== 'other' || m.formats.other)
  const [kind, setKind] = useState<ReqKind>('service')
  const [title, setTitle] = useState(''); const [data, setData] = useState<Record<string, string>>({}); const [urgent, setUrgent] = useState(false)
  const [photos, setPhotos] = useState<string[]>([])
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const fields = m.formats[kind] ?? []
  async function send() {
    const miss = missing(fields, data)
    if (miss) return setErr(`"${miss.label}" — পূরণ করুন`)
    const head = title.trim() || Object.values(data).find(x => x.trim())?.trim() || REQ_KIND[kind]
    setBusy(true); setErr('')
    try { await fleet.request({ vehicle: v.id, kind, title: head, data, urgent, photos }); onDone() }
    catch (e) { setErr(fleetFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal wide title="সার্ভিস / পার্টস রিকুইজিশন" onClose={onClose} actions={<><button className="secondary" onClick={onClose}>বাতিল</button>
    <button disabled={busy} onClick={() => void send()}>{busy ? 'পাঠানো হচ্ছে…' : 'পাঠান'}</button></>}>
    <div className="fl-chips">{kinds.map(k => <button key={k} type="button" className={`nv-chip${kind === k ? ' on' : ''}`} aria-pressed={kind === k}
      onClick={() => { setKind(k); setData({}) }}>{REQ_KIND[k]}</button>)}</div>
    <FormFields fields={fields} data={data} onChange={setData} />
    <Field label="সংক্ষেপে কী লাগবে"><input id="fl-title" value={title} placeholder="যেমন: ব্রেক কাজ করছে না" onChange={e => setTitle(e.target.value)} /></Field>
    <PhotoPick vehicle={v.id} value={photos} onChange={setPhotos} />
    <label className="fl-check"><input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} /> খুব জরুরি — গাড়ি চলছে না / ঝুঁকি আছে</label>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}
