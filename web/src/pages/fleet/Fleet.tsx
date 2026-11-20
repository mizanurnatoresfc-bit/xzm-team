import { useMemo, useState } from 'react'
import { Contact } from '../../components/Contact'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { hubLabel, org } from '../../lib/hr'
import { COST_KIND, EVENT_BN, FUNCTIONS, KIND_FALLBACK, REPORT_STATUS, REQ_KIND, ROLE_BN, VEHICLE_STATUS, fleet, fleetFriendly, fnOn, kindName, kindsOf,
  type BoardRow, type FleetSetting, type FormField, type Kind, type ReportStatus, type ReqKind, type Role, type Settings, type WaitLog, type WaitReq } from '../../lib/fleet'
import { Badge, Field, Modal, Stat, useLoad, useToast } from '../accounts/ui'
import { Thumb, bnNum, dayBn, timeBn, tk, todayDhaka } from './common'

type Tab = 'list' | 'today' | 'approve' | 'reports' | 'log' | 'settings'
const TABS: Array<[Tab, string, string]> = [['list', 'গাড়ি ও দায়িত্ব', 'truck'], ['today', 'আজ: খোরাকি ও গ্যারেজ', 'cal'], ['approve', 'অনুমোদন', 'check'],
  ['reports', 'হাব রিপোর্ট', 'hub'], ['log', 'এস্যাইন লগ', 'log'], ['settings', 'সেটিং', 'gear']]
const addDays = (d: string, n: number) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-CA') }

/** গাড়ি — the zone's vehicles for managers: given to hubs, crew and allowance, today's allowance and garage, approvals, hub reports, log, settings. */
export function Fleet() {
  const { can, grants, viewAs } = useAuth()
  const scope = viewAs?.view ?? grants.find(g => g.permission_code === 'vehicle.vehicle.view')?.scope_type
  const [sp, setSp] = useSearchParams()
  const canSet = can('vehicle.settings.configure')
  const tabs = TABS.filter(([k]) => (k !== 'settings' || canSet) && (k !== 'reports' || can('vehicle.report.view') || can('vehicle.vehicle.view')))
  const tab = (tabs.find(t => t[0] === sp.get('tab'))?.[0] ?? 'list') as Tab
  const go = (t: Tab) => { const n = new URLSearchParams(sp); n.set('tab', t); setSp(n, { replace: true }) }
  const [hub, setHub] = useState('')
  const settings = useLoad(() => fleet.settings().catch(() => ({} as Settings)), [])
  const board = useLoad(() => fleet.board(), [])
  const waiting = useLoad(() => fleet.waiting().catch(() => ({ logs: [], requests: [] })), [])
  const rows = (board.data ?? []).filter(r => !hub || r.hub_id === hub)
  const hubs = useMemo(() => [...new Map((board.data ?? []).filter(r => r.hub_id).map(r => [r.hub_id!, r.hub_name ?? ''])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [board.data])
  const waitCount = (waiting.data?.logs.length ?? 0) + (waiting.data?.requests.length ?? 0)
  const reload = () => { void board.reload(); void waiting.reload() }
  const title = scope === 'zone' ? 'জোনের গাড়ি' : scope === 'hub' ? 'আমার হাবের গাড়ি' : 'গাড়ি ব্যবস্থাপনা'

  // Staff use the personal panel. The board RPC also enforces this boundary on the server.
  if (!can('vehicle.vehicle.view') && !can('vehicle.log.approve') && !can('vehicle.report.view')) {
    return <Navigate to="/app/fleet/mine" replace />
  }

  return <AppShell title={title} subtitle="হাবভিত্তিক গাড়ি, ড্রাইভার-হেল্পার, খোরাকি, গ্যারেজ, অনুমোদন ও রিপোর্ট">
    <div className="fl">
      <div className="nv-chips fl-tabs" role="tablist">{tabs.map(([k, l, ic]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`nv-chip${tab === k ? ' on' : ''}`} onClick={() => go(k)}>
        <Icon name={ic} size={15} />{l}{k === 'approve' && waitCount > 0 && <b>{bnNum(waitCount)}</b>}</button>)}</div>
      {(tab === 'list' || tab === 'today') && hubs.length > 1 && <div className="nv-chips">
        <button type="button" className={`nv-chip${!hub ? ' on' : ''}`} onClick={() => setHub('')}>সব হাব</button>
        {hubs.map(([id, name]) => <button key={id} type="button" className={`nv-chip${hub === id ? ' on' : ''}`} onClick={() => setHub(id)}>{name}</button>)}</div>}
      {board.error ? <p className="da-error">{fleetFriendly(board.error)}</p> : null}
      {tab === 'list' && <Vehicles rows={rows} loading={board.loading && !board.data} settings={settings.data} canAdd={can('vehicle.vehicle.create')} onChanged={reload} />}
      {tab === 'today' && <Today rows={rows} settings={settings.data} onChanged={reload} />}
      {tab === 'approve' && <Approvals data={waiting.data} loading={waiting.loading && !waiting.data} onChanged={reload} />}
      {tab === 'reports' && <Reports />}
      {tab === 'log' && <Log rows={board.data ?? []} />}
      {tab === 'settings' && canSet && <SettingsTab settings={settings.data} onSaved={() => void settings.reload()} />}
    </div>
  </AppShell>
}

// ------------------------------------------------------------------ vehicles and crew
function Vehicles({ rows, loading, settings, canAdd, onChanged }: { rows: BoardRow[]; loading: boolean; settings: Settings | null; canAdd: boolean; onChanged: () => void }) {
  const { toast, node } = useToast()
  const [edit, setEdit] = useState<Partial<BoardRow> | null>(null)
  const [crew, setCrew] = useState<{ v: BoardRow; role: Role } | null>(null)
  const crewCount = rows.reduce((a, r) => a + r.crew.length, 0)
  const perDay = rows.reduce((a, r) => a + r.crew.reduce((b, c) => b + Number(c.allowance ?? 0), 0), 0)
  return <>
    {node}
    <div className="da-stats">
      <Stat icon="truck" label="গাড়ি" value={bnNum(rows.length)} />
      <Stat icon="users" label="ড্রাইভার ও হেল্পার" value={bnNum(crewCount)} />
      <Stat icon="alert" tone={rows.some(r => r.roles.some(x => !r.crew.find(c => c.role === x))) ? 'warn' : undefined} label="দায়িত্ব খালি"
        value={bnNum(rows.reduce((a, r) => a + r.roles.filter(x => !r.crew.find(c => c.role === x)).length, 0))} />
      <Stat icon="wallet" label="দৈনিক খোরাকি (মোট)" value={tk(perDay)} />
    </div>
    <div className="da-bar"><h2 style={{ margin: 0 }}>গাড়ির তালিকা</h2>{canAdd && <button onClick={() => setEdit({ kind: 'truck', status: 'active' })}><Icon name="plus" size={16} />নতুন গাড়ি</button>}</div>
    {loading ? <p className="muted">লোড হচ্ছে…</p> : !rows.length ? <div className="nv-empty panel"><Icon name="truck" size={30} /><p>এখনো কোনো গাড়ি নেই।</p></div> :
      <div className="fl-cards">{rows.map(r => <section key={r.id} className="fl-card">
        <div className="fl-card-hd"><span className="nv-av"><Icon name="truck" size={22} /></span>
          <div className="tx"><b>{r.name}</b><span>{[r.reg_no, kindName(settings, r.kind), r.hub_name].filter(Boolean).join(' · ')}</span></div>
          <Badge tone={VEHICLE_STATUS[r.status]?.[1] ?? 'neutral'}>{VEHICLE_STATUS[r.status]?.[0] ?? r.status}</Badge>
          {r.can_edit && <button type="button" className="secondary sm" onClick={() => setEdit(r)}>এডিট</button>}</div>
        <div className="fl-crew">{r.roles.map(role => { const c = r.crew.find(x => x.role === role)
          return <button key={role} type="button" className={`fl-crew-row${c ? '' : ' empty'}`} disabled={!r.can_crew} onClick={() => setCrew({ v: r, role })}>
            <span className="role">{ROLE_BN[role]}</span>
            {c ? <span className="who"><b>{c.name}</b><small>{c.code && `আইডি ${c.code}`}</small>{c.mobile && <Contact phone={c.mobile} />}</span> : <span className="who muted">দেওয়া হয়নি — চাপুন</span>}
            {c?.allowance ? <span className="amt">খোরাকি {tk(c.allowance)}</span> : null}{r.can_crew && <Icon name="chev" size={16} />}</button> })}</div>
        {(r.pending > 0 || r.requests_open > 0) && <p className="fl-flag"><Icon name="alert" size={14} />{[r.pending && `${bnNum(r.pending)}টি খরচ অনুমোদন বাকি`, r.requests_open && `${bnNum(r.requests_open)}টি রিকুইজিশন খোলা`].filter(Boolean).join(' · ')}</p>}
      </section>)}</div>}
    {edit && <VehicleForm v={edit} settings={settings} onClose={() => setEdit(null)} onDone={m => { setEdit(null); toast(m); onChanged() }} />}
    {crew && <CrewForm v={crew.v} role={crew.role} settings={settings} onClose={() => setCrew(null)} onDone={m => { setCrew(null); toast(m); onChanged() }} />}
  </>
}

function VehicleForm({ v, settings, onClose, onDone }: { v: Partial<BoardRow>; settings: Settings | null; onClose: () => void; onDone: (m: string) => void }) {
  const hubs = useLoad(() => org.hubs().catch(() => []), [])
  const [f, setF] = useState({ name: v.name ?? '', reg: v.reg_no ?? '', kind: v.kind ?? 'truck', hub: v.hub_id ?? '', status: v.status ?? 'active' })
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [drop, setDrop] = useState(false); const [why, setWhy] = useState('')
  const kind = kindsOf(settings).find(k => k.code === f.kind)
  async function save() {
    setBusy(true); setErr('')
    try { await fleet.save({ ...f, id: v.id ?? null }); onDone(v.id ? 'গাড়ির তথ্য বদলানো হয়েছে' : 'গাড়ি যোগ হয়েছে') } catch (e) { setErr(fleetFriendly(e)) } finally { setBusy(false) }
  }
  async function archive() {
    setBusy(true); setErr('')
    try { await fleet.archive(v.id!, why.trim()); onDone('গাড়ি তালিকা থেকে সরানো হয়েছে') } catch (e) { setErr(fleetFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title={v.id ? 'গাড়ির তথ্য' : 'নতুন গাড়ি'} onClose={onClose}
    actions={<>{v.id && <button className="danger" style={{ marginRight: 'auto' }} onClick={() => setDrop(d => !d)}>তালিকা থেকে সরান</button>}
      <button className="secondary" onClick={onClose}>বাতিল</button>
      {drop ? <button className="danger" disabled={busy || !why.trim()} onClick={() => void archive()}>সরিয়ে দিন</button>
        : <button disabled={busy || !f.name.trim() || !f.hub} onClick={() => void save()}>{busy ? 'সেভ হচ্ছে…' : 'সেভ'}</button>}</>}>
    {drop ? <Field label="কেন সরাচ্ছেন *"><input autoFocus value={why} onChange={e => setWhy(e.target.value)} /></Field> : <>
      <Field label="গাড়ির নাম *"><input id="fl-v-name" autoFocus value={f.name} placeholder="যেমন: নাটোর ট্রাক ১" onChange={e => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="গাড়ির নম্বর"><input id="fl-v-reg" value={f.reg} placeholder="যেমন: ঢাকা মেট্রো ট ১১-২২৩৩" onChange={e => setF({ ...f, reg: e.target.value })} /></Field>
      <Field label="ধরন *" hint={kind ? `দায়িত্ব: ${kind.crew.map(r => ROLE_BN[r]).join(' + ')}` : undefined}>
        <select id="fl-v-kind" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>{kindsOf(settings).map(k => <option key={k.code} value={k.code}>{k.bn}</option>)}</select></Field>
      <Field label="কোন হাবে দেবেন *"><select id="fl-v-hub" value={f.hub} onChange={e => setF({ ...f, hub: e.target.value })}><option value="">বেছে নিন…</option>
        {(hubs.data ?? []).map(h => <option key={h.id} value={h.id}>{hubLabel(h)}</option>)}</select></Field>
      {v.id && <Field label="অবস্থা"><select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>{Object.entries(VEHICLE_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>}
      {v.id && v.hub_id !== f.hub && f.hub && <p className="notice small">হাব বদলালে এস্যাইন লগে থেকে যাবে। ড্রাইভার-হেল্পার একই থাকবেন।</p>}
    </>}
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

function CrewForm({ v, role, settings, onClose, onDone }: { v: BoardRow; role: Role; settings: Settings | null; onClose: () => void; onDone: (m: string) => void }) {
  const cur = v.crew.find(c => c.role === role)
  const def = settings?.fleet?.khoraki?.[role]
  const [code, setCode] = useState(cur?.code ?? ''); const [amt, setAmt] = useState(String(cur?.allowance ?? def ?? ''))
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [remove, setRemove] = useState(false); const [why, setWhy] = useState('')
  async function save() {
    setBusy(true); setErr('')
    try { await fleet.setCrew(v.id, role, code.trim(), amt.trim() ? Number(amt) : null); onDone(`${ROLE_BN[role]} ঠিক করা হয়েছে`) } catch (e) { setErr(fleetFriendly(e)) } finally { setBusy(false) }
  }
  async function release() {
    setBusy(true); setErr('')
    try { await fleet.removeCrew(v.id, role, why.trim()); onDone(`${ROLE_BN[role]} সরানো হয়েছে`) } catch (e) { setErr(fleetFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title={`${v.name} — ${ROLE_BN[role]}`} onClose={onClose}
    actions={<>{cur && <button className="danger" style={{ marginRight: 'auto' }} onClick={() => setRemove(x => !x)}>দায়িত্ব থেকে সরান</button>}
      <button className="secondary" onClick={onClose}>বাতিল</button>
      {remove ? <button className="danger" disabled={busy || !why.trim()} onClick={() => void release()}>সরিয়ে দিন</button>
        : <button disabled={busy || !code.trim()} onClick={() => void save()}>{busy ? 'সেভ হচ্ছে…' : 'সেভ'}</button>}</>}>
    {remove ? <Field label="কেন সরাচ্ছেন *"><input autoFocus value={why} onChange={e => setWhy(e.target.value)} /></Field> : <>
      <Field label="এমপ্লয়ি আইডি *" hint={cur ? `এখন: ${cur.name}` : 'যাঁকে দায়িত্ব দেবেন তাঁর আইডি'}><input id="fl-c-code" autoFocus inputMode="numeric" value={code} onChange={e => setCode(e.target.value)} /></Field>
      <Field label="দৈনিক খোরাকি (৳)" hint={def != null ? `সেটিংসে ${ROLE_BN[role]}-এর খোরাকি ${tk(def)}` : undefined}>
        <input id="fl-c-amt" type="number" min={0} inputMode="numeric" value={amt} onChange={e => setAmt(e.target.value)} /></Field>
      <p className="muted small">বদলালে এস্যাইন লগে থেকে যাবে। নতুন কেউ এলে আগের জন দায়িত্ব থেকে সরে যাবেন।</p>
    </>}
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

// ------------------------------------------------------------------ today: allowance and garage
function Today({ rows, settings, onChanged }: { rows: BoardRow[]; settings: Settings | null; onChanged: () => void }) {
  const { toast, node } = useToast()
  const fns = settings?.fleet?.functions
  const [busy, setBusy] = useState(''); const [err, setErr] = useState('')
  const [garage, setGarage] = useState<BoardRow | null>(null)
  const withAllowance = rows.filter(r => r.crew.some(c => Number(c.allowance ?? 0) > 0))
  const autos = rows.filter(r => r.kind === 'auto')
  async function khoraki(r: BoardRow) {
    setBusy(r.id); setErr('')
    try {
      const out = await fleet.khoraki(r.id)
      const ok = out.filter(x => x.posted).length, skipped = out.filter(x => x.skipped).length, bad = out.filter(x => x.posted === false)
      if (bad.length) setErr(`${r.name}: ${bad.length.toLocaleString('bn-BD')} জনের খোরাকি খাতায় ওঠেনি — ${fleetFriendly(bad[0].error)}`)
      toast(ok ? `${bnNum(ok)} জনের খোরাকি খাতায় উঠেছে (ভাউচারসহ)` : skipped ? 'আজকের খোরাকি আগেই দেওয়া হয়েছে' : 'খোরাকি দেওয়ার মতো কেউ নেই')
      onChanged()
    } catch (e) { setErr(fleetFriendly(e)) } finally { setBusy('') }
  }
  return <>
    {node}
    {err && <p className="da-error">{err}</p>}
    {fnOn(fns, 'khoraki') && <section className="panel">
      <div className="da-bar"><h2 style={{ margin: 0 }}>আজকের খোরাকি</h2><span className="muted small">দিলে হাবের হিসাব খাতায় ভাউচারসহ ওঠে · দিনে একবার</span></div>
      <div className="nv-rows">{withAllowance.map(r => { const posted = r.khoraki_today.length; const total = r.crew.reduce((a, c) => a + Number(c.allowance ?? 0), 0)
        const all = posted >= r.crew.filter(c => Number(c.allowance ?? 0) > 0).length
        return <div key={r.id} className="nv-row fl-today">
          <span className={`nv-av sd-i ${all ? 'g' : 'o'}`}><Icon name={all ? 'check' : 'wallet'} size={20} /></span>
          <span className="tx"><b>{r.name} · {r.hub_name}</b><span>{r.crew.filter(c => Number(c.allowance ?? 0) > 0).map(c => `${ROLE_BN[c.role]} ${c.name} ${tk(c.allowance)}`).join(' · ')}</span></span>
          {all ? <Badge tone="ok">দেওয়া হয়েছে</Badge> : r.can_khoraki
            ? <button className="sm" disabled={busy === r.id} onClick={() => void khoraki(r)}>{busy === r.id ? 'উঠছে…' : `খোরাকি দিন ${tk(total)}`}</button>
            : <span className="muted small">অনুমতি নেই</span>}
        </div> })}
        {!withAllowance.length && <p className="nv-none">কোনো গাড়ির ড্রাইভার-হেল্পারের খোরাকি ঠিক করা নেই। "গাড়ি ও দায়িত্ব" থেকে ঠিক করুন।</p>}</div>
    </section>}
    {fnOn(fns, 'garage') && <section className="panel">
      <div className="da-bar"><h2 style={{ margin: 0 }}>অটোর গ্যারেজ চার্জ — আজ</h2><span className="muted small">প্রতিদিন লিখুন চার্জ হয়েছে কি না</span></div>
      <div className="nv-rows">{autos.map(r => { const g = r.garage_today
        return <button key={r.id} type="button" className="nv-row" disabled={!r.can_garage} onClick={() => setGarage(r)}>
          <span className={`nv-av sd-i ${!g ? 'o' : g.charged ? 'g' : 'r'}`}><Icon name={!g ? 'clock' : g.charged ? 'check' : 'x'} size={20} /></span>
          <span className="tx"><b>{r.name} · {r.hub_name}</b><span>{!g ? 'আজ এখনো লেখা হয়নি' : g.charged ? `চার্জ হয়েছে${g.place ? ` · ${g.place}` : ''}${g.posted ? ' · খাতায় উঠেছে' : ''}` : 'আজ চার্জ হয়নি'}{g?.note ? ` · ${g.note}` : ''}</span></span>
          <span className="end">{g?.cost ? <b>{tk(g.cost)}</b> : null}<Icon name="chev" size={16} /></span></button> })}
        {!autos.length && <p className="nv-none">কোনো অটো নেই।</p>}</div>
    </section>}
    {garage && <GarageForm v={garage} onClose={() => setGarage(null)} onDone={m => { setGarage(null); toast(m); onChanged() }} />}
  </>
}

function GarageForm({ v, onClose, onDone }: { v: BoardRow; onClose: () => void; onDone: (m: string) => void }) {
  const g = v.garage_today
  const [charged, setCharged] = useState<boolean | null>(g?.charged ?? null)
  const [cost, setCost] = useState(g?.cost != null ? String(g.cost) : ''); const [place, setPlace] = useState(g?.place ?? ''); const [note, setNote] = useState(g?.note ?? '')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  async function save() {
    if (charged === null) return setErr('চার্জ হয়েছে কি না, বেছে নিন')
    setBusy(true); setErr('')
    try {
      const r = await fleet.garage(v.id, charged, charged && cost ? Number(cost) : null, place, note)
      onDone(r.posted ? `সেভ হয়েছে — বিল খাতায় উঠেছে${r.voucher ? ` (ভাউচার ${r.voucher})` : ''}` : r.error ? `সেভ হয়েছে, কিন্তু খাতায় ওঠেনি: ${fleetFriendly(r.error)}` : 'সেভ হয়েছে')
    } catch (e) { setErr(fleetFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title={`${v.name} — আজকের গ্যারেজ চার্জ`} onClose={onClose} actions={<><button className="secondary" onClick={onClose}>বাতিল</button>
    <button disabled={busy || g?.posted} onClick={() => void save()}>{busy ? 'সেভ হচ্ছে…' : 'সেভ'}</button></>}>
    {g?.posted && <p className="notice small">আজকের বিল খাতায় উঠে গেছে। বদলাতে হিসাব খাতায় ঠিক করুন।</p>}
    <div className="fl-status">
      <button type="button" className={`fl-st t-ok${charged === true ? ' on' : ''}`} aria-pressed={charged === true} onClick={() => setCharged(true)}>হ্যাঁ, চার্জ হয়েছে</button>
      <button type="button" className={`fl-st t-bad${charged === false ? ' on' : ''}`} aria-pressed={charged === false} onClick={() => setCharged(false)}>না, হয়নি</button></div>
    {charged && <div className="fl-grid2">
      <Field label="গ্যারেজ বিল (৳)"><input id="fl-g-cost" type="number" min={0} inputMode="numeric" value={cost} onChange={e => setCost(e.target.value)} /></Field>
      <Field label="কোন গ্যারেজ"><input value={place} onChange={e => setPlace(e.target.value)} /></Field></div>}
    <Field label={charged === false ? 'কেন হয়নি' : 'মন্তব্য'}><input value={note} onChange={e => setNote(e.target.value)} /></Field>
    <p className="muted small">বিল দিলে হাবের হিসাব খাতায় ভাউচারসহ উঠবে। অটো ড্রাইভার তাঁর প্যানেলে দেখবেন।</p>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

// ------------------------------------------------------------------ approvals
function Approvals({ data, loading, onChanged }: { data: { logs: WaitLog[]; requests: WaitReq[] } | null; loading: boolean; onChanged: () => void }) {
  const { toast, node } = useToast()
  const [busy, setBusy] = useState(''); const [err, setErr] = useState('')
  const [no, setNo] = useState<{ kind: 'log' | 'req'; id: string; title: string } | null>(null); const [why, setWhy] = useState('')
  const [done, setDone] = useState<WaitReq | null>(null); const [cost, setCost] = useState(''); const [doneNote, setDoneNote] = useState('')
  const run = async (id: string, f: () => Promise<unknown>, ok: (r: unknown) => string) => {
    setBusy(id); setErr('')
    try { const r = await f(); toast(ok(r)); setNo(null); setDone(null); onChanged() } catch (e) { setErr(fleetFriendly(e)) } finally { setBusy('') }
  }
  const postedMsg = (r: unknown) => { const p = r as { posted?: boolean; voucher?: string | null; error?: string }
    return p?.posted ? `অনুমোদিত — খাতায় উঠেছে${p.voucher ? ` · ভাউচার ${p.voucher}` : ''}` : `অনুমোদিত, কিন্তু খাতায় ওঠেনি: ${fleetFriendly(p?.error ?? '')}` }
  const logs = data?.logs ?? [], reqs = data?.requests ?? []
  if (loading) return <p className="muted">লোড হচ্ছে…</p>
  return <>
    {node}
    {err && <p className="da-error">{err}</p>}
    <section className="panel"><div className="da-bar"><h2 style={{ margin: 0 }}>খরচ ও তেল {logs.length > 0 && <Badge tone="warn">{bnNum(logs.length)}</Badge>}</h2>
      <span className="muted small">অনুমোদন দিলে হাবের হিসাব খাতায় ভাউচারসহ ওঠে</span></div>
      <div className="nv-rows">{logs.map(l => <div key={l.id} className="nv-row fl-wait">
        <span className="nv-av sd-i o"><Icon name={l.kind === 'fuel' ? 'cash' : 'receipt'} size={20} /></span>
        <span className="tx"><b>{COST_KIND[l.kind] ?? l.kind} · {tk(l.amount)}{l.litres ? ` · ${bnNum(l.litres)} লিটার` : ''}</b>
          <span>{l.vehicle} · {l.hub_name} · {l.by_name ?? '—'} · {dayBn(l.log_date)}{l.vendor ? ` · ${l.vendor}` : ''}{l.note ? ` · ${l.note}` : ''}</span>
          {l.slip_path && <span className="fl-photos small"><Thumb path={l.slip_path} size={44} /></span>}</span>
        <span className="fl-btns">{l.status === 'submitted' ? <>
          <button className="sm" disabled={!!busy} onClick={() => void run(l.id, () => fleet.approve(l.id), postedMsg)}>অনুমোদন</button>
          <button className="danger sm" disabled={!!busy} onClick={() => { setWhy(''); setNo({ kind: 'log', id: l.id, title: `${COST_KIND[l.kind] ?? l.kind} · ${tk(l.amount)}` }) }}>না</button></>
          : <button className="secondary sm" disabled={!!busy} onClick={() => void run(l.id, () => fleet.post(l.id), postedMsg)}>খাতায় তুলুন</button>}</span>
      </div>)}{!logs.length && <p className="nv-none">অনুমোদনের মতো কোনো খরচ নেই।</p>}</div></section>
    <section className="panel"><div className="da-bar"><h2 style={{ margin: 0 }}>সার্ভিস / পার্টস রিকুইজিশন {reqs.length > 0 && <Badge tone="warn">{bnNum(reqs.length)}</Badge>}</h2></div>
      <div className="nv-rows">{reqs.map(q => <div key={q.id} className="nv-row fl-wait">
        <span className={`nv-av sd-i ${q.priority === 'urgent' ? 'r' : 'p'}`}><Icon name="gear" size={20} /></span>
        <span className="tx"><b>{q.priority === 'urgent' ? 'জরুরি · ' : ''}{q.title}</b>
          <span>{q.no} · {REQ_KIND[q.kind] ?? q.kind} · {q.vehicle} · {q.by_name ?? '—'} · {timeBn(q.created_at)}</span>
          {Object.keys(q.data ?? {}).length > 0 && <span>{Object.values(q.data).filter(Boolean).join(' · ')}</span>}
          {q.photos.length > 0 && <span className="fl-photos small">{q.photos.map(p => <Thumb key={p} path={p} size={44} />)}</span>}</span>
        <span className="fl-btns">{q.status === 'open' && <button className="secondary sm" disabled={!!busy} onClick={() => void run(q.id, () => fleet.requestAccept(q.id), () => 'গ্রহণ করা হয়েছে')}>গ্রহণ</button>}
          <button className="sm" disabled={!!busy} onClick={() => { setCost(''); setDoneNote(''); setDone(q) }}>কাজ শেষ</button>
          <button className="danger sm" disabled={!!busy} onClick={() => { setWhy(''); setNo({ kind: 'req', id: q.id, title: q.title }) }}>না</button></span>
      </div>)}{!reqs.length && <p className="nv-none">কোনো রিকুইজিশন খোলা নেই।</p>}</div></section>
    {no && <Modal title={`না — ${no.title}`} onClose={() => setNo(null)} actions={<><button className="secondary" onClick={() => setNo(null)}>বাতিল</button>
      <button className="danger" disabled={!!busy || !why.trim()} onClick={() => void run(no.id, () => no.kind === 'log' ? fleet.reject(no.id, why.trim()) : fleet.requestReject(no.id, why.trim()), () => 'ফেরত দেওয়া হয়েছে')}>ফেরত দিন</button></>}>
      <Field label="কারণ *"><input id="fl-why" autoFocus value={why} onChange={e => setWhy(e.target.value)} /></Field><p className="muted small">ড্রাইভার কারণটা তাঁর প্যানেলে দেখবেন।</p>
      {err && <p className="da-error">{err}</p>}</Modal>}
    {done && <Modal title={`কাজ শেষ — ${done.title}`} onClose={() => setDone(null)} actions={<><button className="secondary" onClick={() => setDone(null)}>বাতিল</button>
      <button disabled={!!busy} onClick={() => void run(done.id, () => fleet.requestDone(done.id, cost ? Number(cost) : null, doneNote), r => Number(cost) > 0 ? postedMsg(r) : 'কাজ শেষ লেখা হয়েছে')}>সেভ</button></>}>
      <Field label="খরচ কত হলো (৳)" hint="খরচ দিলে হাবের হিসাব খাতায় ভাউচারসহ উঠবে"><input id="fl-done-cost" type="number" min={0} inputMode="numeric" value={cost} onChange={e => setCost(e.target.value)} /></Field>
      <Field label="কী কাজ হলো"><input value={doneNote} onChange={e => setDoneNote(e.target.value)} /></Field>
      {err && <p className="da-error">{err}</p>}</Modal>}
  </>
}

// ------------------------------------------------------------------ hub reports for the zonal manager
function Reports() {
  const today = todayDhaka()
  const [range, setRange] = useState<'1' | '7' | '30'>('1')
  const from = range === '1' ? today : addDays(today, -Number(range) + 1)
  const d = useLoad(() => fleet.reports(from, today), [from, today])
  const rows = d.data ?? []
  const byHub = useMemo(() => {
    const m = new Map<string, { name: string; c: Record<ReportStatus, number>; late: number }>()
    for (const r of rows) {
      const x = m.get(r.hub_id) ?? { name: r.hub_name, c: { on_time: 0, load_late: 0, unload_late: 0, no_trip: 0, other: 0 }, late: 0 }
      x.c[r.status]++; x.late += r.late_minutes ?? 0; m.set(r.hub_id, x)
    }
    return [...m.values()].sort((a, b) => (b.c.no_trip + b.c.load_late + b.c.unload_late) - (a.c.no_trip + a.c.load_late + a.c.unload_late) || a.name.localeCompare(b.name))
  }, [rows])
  const n = (s: ReportStatus) => rows.filter(r => r.status === s).length
  return <>
    <div className="nv-chips">{([['1', 'আজ'], ['7', '৭ দিন'], ['30', '৩০ দিন']] as const).map(([k, l]) => <button key={k} type="button" className={`nv-chip${range === k ? ' on' : ''}`} onClick={() => setRange(k)}>{l}</button>)}</div>
    <div className="da-stats">
      <Stat icon="check" tone="ok" label="ঠিক সময়ে" value={bnNum(n('on_time'))} />
      <Stat icon="clock" tone={n('load_late') ? 'warn' : undefined} label="লোডে দেরি" value={bnNum(n('load_late'))} />
      <Stat icon="clock" tone={n('unload_late') ? 'warn' : undefined} label="আনলোডে দেরি" value={bnNum(n('unload_late'))} />
      <Stat icon="x" tone={n('no_trip') ? 'bad' : undefined} label="ট্রিপ দেয়নি" value={bnNum(n('no_trip'))} />
    </div>
    {d.error ? <p className="da-error">{fleetFriendly(d.error)}</p> : null}
    <section className="panel"><h2>হাব অনুযায়ী</h2>
      <div className="da-table-wrap"><table className="da-table"><thead><tr><th>হাব</th><th className="r">ঠিক সময়ে</th><th className="r">লোডে দেরি</th><th className="r">আনলোডে দেরি</th><th className="r">ট্রিপ দেয়নি</th><th className="r">মোট দেরি (মিনিট)</th></tr></thead>
        <tbody>{byHub.map(h => <tr key={h.name}><td data-l="হাব"><b>{h.name}</b></td><td data-l="ঠিক সময়ে" className="r">{bnNum(h.c.on_time)}</td>
          <td data-l="লোডে দেরি" className={`r${h.c.load_late ? ' bad' : ''}`}>{bnNum(h.c.load_late)}</td><td data-l="আনলোডে দেরি" className={`r${h.c.unload_late ? ' bad' : ''}`}>{bnNum(h.c.unload_late)}</td>
          <td data-l="ট্রিপ দেয়নি" className={`r${h.c.no_trip ? ' bad' : ''}`}>{bnNum(h.c.no_trip)}</td><td data-l="মোট দেরি" className="r">{bnNum(h.late)}</td></tr>)}
          {!byHub.length && <tr><td colSpan={6} className="muted">{d.loading ? 'লোড হচ্ছে…' : 'এই সময়ে কোনো রিপোর্ট নেই।'}</td></tr>}</tbody></table></div></section>
    <section className="panel"><h2>সব রিপোর্ট</h2>
      <div className="nv-rows">{rows.map(r => <div key={r.id} className="nv-row">
        <span className={`nv-av sd-i ${REPORT_STATUS[r.status][1] === 'ok' ? 'g' : REPORT_STATUS[r.status][1] === 'bad' ? 'r' : 'o'}`}><Icon name="hub" size={20} /></span>
        <span className="tx"><b>{r.hub_name} — {REPORT_STATUS[r.status][0]}{r.late_minutes ? ` (${bnNum(r.late_minutes)} মিনিট)` : ''}</b>
          <span>{dayBn(r.report_date)} · {r.vehicle} · {r.by_name ?? '—'}{r.note ? ` · ${r.note}` : ''}</span>
          {r.photo_path && <span className="fl-photos small"><Thumb path={r.photo_path} size={44} /></span>}</span></div>)}
        {!rows.length && <p className="nv-none">{d.loading ? 'লোড হচ্ছে…' : 'কোনো রিপোর্ট নেই।'}</p>}</div></section>
  </>
}

// ------------------------------------------------------------------ assign log
function Log({ rows }: { rows: BoardRow[] }) {
  const [veh, setVeh] = useState('')
  const d = useLoad(() => fleet.events(veh || null), [veh])
  return <section className="panel">
    <div className="da-bar"><h2 style={{ margin: 0 }}>এস্যাইন লগ</h2>
      <select className="ht-pick" value={veh} onChange={e => setVeh(e.target.value)} aria-label="কোন গাড়ি"><option value="">সব গাড়ি</option>{rows.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
    {d.error ? <p className="da-error">{fleetFriendly(d.error)}</p> : null}
    <div className="nv-rows">{(d.data ?? []).map(e => <div key={e.id} className="nv-row">
      <span className="nv-av sd-i b"><Icon name={e.action.startsWith('crew') ? 'user' : e.action === 'hub' ? 'hub' : e.action === 'allowance' ? 'wallet' : 'truck'} size={20} /></span>
      <span className="tx"><b>{EVENT_BN[e.action] ?? e.action}{e.role ? ` — ${ROLE_BN[e.role]}` : ''}{e.employee ? `: ${e.employee}${e.employee_code ? ` (${e.employee_code})` : ''}` : ''}</b>
        <span>{e.vehicle}{e.detail ? ` · ${e.detail}` : ''}</span><span className="who">{timeBn(e.at)} · {e.by_name ?? 'সিস্টেম'}</span></span></div>)}
      {!(d.data ?? []).length && <p className="nv-none">{d.loading ? 'লোড হচ্ছে…' : 'এখনো কিছু লেখা হয়নি।'}</p>}</div>
  </section>
}

// ------------------------------------------------------------------ settings
function SettingsTab({ settings, onSaved }: { settings: Settings | null; onSaved: () => void }) {
  const { toast, node } = useToast()
  const [f, setF] = useState<FleetSetting>(() => ({ functions: { ...(settings?.fleet?.functions ?? {}) }, kinds: kindsOf(settings).map(k => ({ ...k, crew: [...k.crew] })),
    khoraki: { ...(settings?.fleet?.khoraki ?? {}) } }))
  const [formats, setFormats] = useState<Partial<Record<ReqKind, FormField[]>>>(() => JSON.parse(JSON.stringify(settings?.request_formats ?? {})))
  const [fk, setFk] = useState<ReqKind>('service')
  const approvers = useLoad(() => fleet.approvers().catch(() => []), [])
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  async function save() {
    setBusy(true); setErr('')
    try {
      const clean = Object.fromEntries(Object.entries(formats).map(([k, list]) => [k, (list ?? []).filter(x => x.label.trim()).map((x, i) => ({ ...x, key: x.key || `f${i + 1}`, label: x.label.trim(),
        options: x.type === 'select' ? (x.options ?? []).map(o => o.trim()).filter(Boolean) : undefined }))]))
      await fleet.configure('fleet', f); await fleet.configure('request_formats', clean); toast('সেটিং সেভ হয়েছে'); onSaved()
    } catch (e) { setErr(fleetFriendly(e)) } finally { setBusy(false) }
  }
  const setKind = (i: number, k: Partial<Kind>) => setF(x => ({ ...x, kinds: (x.kinds ?? []).map((y, j) => j === i ? { ...y, ...k } : y) }))
  const list = formats[fk] ?? []
  const setField = (i: number, p: Partial<FormField>) => setFormats(x => ({ ...x, [fk]: (x[fk] ?? []).map((y, j) => j === i ? { ...y, ...p } : y) }))
  const PERM_BN: Record<string, string> = {
    'vehicle.vehicle.create': 'গাড়ি যোগ', 'vehicle.vehicle.edit': 'গাড়ির তথ্য ও হাব বদল', 'vehicle.holder.edit': 'ড্রাইভার-হেল্পার ও খোরাকি ঠিক করা',
    'vehicle.khoraki.post': 'খোরাকি দেওয়া (খাতায় তোলা)', 'vehicle.log.create': 'গ্যারেজ চার্জ লেখা', 'vehicle.log.approve': 'তেল, খরচ ও রিকুইজিশন অনুমোদন',
    'vehicle.report.view': 'হাব রিপোর্ট দেখা (জোনাল)', 'vehicle.settings.configure': 'গাড়ির সেটিং', 'vehicle.vehicle.view': 'গাড়ির তালিকা দেখা',
  }
  return <>
    {node}
    <section className="panel"><h2>কোন কাজ চালু</h2>
      <div className="fl-toggles">{FUNCTIONS.map(([k, l, note]) => <label key={k} className="fl-toggle"><input type="checkbox" checked={fnOn(f.functions, k)}
        onChange={e => setF(x => ({ ...x, functions: { ...(x.functions ?? {}), [k]: e.target.checked } }))} /><span><b>{l}</b><small>{note}</small></span></label>)}</div></section>
    <section className="panel"><h2>গাড়ির ধরন ও দায়িত্ব</h2>
      <div className="da-table-wrap"><table className="da-table"><thead><tr><th>ধরন</th><th>নাম</th><th>ড্রাইভার</th><th>হেল্পার</th></tr></thead>
        <tbody>{(f.kinds ?? []).map((k, i) => <tr key={k.code}><td data-l="ধরন">{KIND_FALLBACK.find(x => x.code === k.code)?.bn ?? k.code}</td>
          <td data-l="নাম"><input value={k.bn} onChange={e => setKind(i, { bn: e.target.value })} aria-label="নাম" /></td>
          <td data-l="ড্রাইভার"><input type="checkbox" checked disabled aria-label="ড্রাইভার" /></td>
          <td data-l="হেল্পার"><input type="checkbox" checked={k.crew.includes('helper')} aria-label="হেল্পার"
            onChange={e => setKind(i, { crew: e.target.checked ? ['driver', 'helper'] : ['driver'] })} /></td></tr>)}</tbody></table></div></section>
    <section className="panel"><h2>নতুনদের জন্য দৈনিক খোরাকি</h2>
      <div className="fl-grid2">{(['driver', 'helper'] as Role[]).map(r => <Field key={r} label={`${ROLE_BN[r]} (৳)`}><input type="number" min={0} inputMode="numeric" value={f.khoraki?.[r] ?? ''}
        onChange={e => setF(x => ({ ...x, khoraki: { ...(x.khoraki ?? {}), [r]: e.target.value === '' ? 0 : Number(e.target.value) } }))} /></Field>)}</div>
      <p className="muted small">প্রত্যেকের খোরাকি আলাদা করে "গাড়ি ও দায়িত্ব" থেকে বদলানো যায়।</p></section>
    <section className="panel"><h2>রিকুইজিশনের ফরম্যাট</h2>
      <div className="nv-chips">{(Object.keys(REQ_KIND) as ReqKind[]).map(k => <button key={k} type="button" className={`nv-chip${fk === k ? ' on' : ''}`} onClick={() => setFk(k)}>{REQ_KIND[k]}</button>)}</div>
      <div className="fl-fmt">{list.map((x, i) => <div key={i} className="fl-fmt-row">
        <input value={x.label} placeholder="ঘরের নাম" aria-label="ঘরের নাম" onChange={e => setField(i, { label: e.target.value })} />
        <select value={x.type} aria-label="ধরন" onChange={e => setField(i, { type: e.target.value as FormField['type'] })}>
          <option value="text">লেখা</option><option value="textarea">বড় লেখা</option><option value="number">সংখ্যা</option><option value="select">বেছে নেওয়া</option><option value="date">তারিখ</option></select>
        <label className="fl-check"><input type="checkbox" checked={!!x.required} onChange={e => setField(i, { required: e.target.checked })} />জরুরি ঘর</label>
        <button type="button" className="danger sm" onClick={() => setFormats(y => ({ ...y, [fk]: (y[fk] ?? []).filter((_, j) => j !== i) }))}>সরান</button>
        {x.type === 'select' && <input className="wide" value={(x.options ?? []).join(', ')} placeholder="পছন্দগুলো, কমা দিয়ে" aria-label="পছন্দগুলো"
          onChange={e => setField(i, { options: e.target.value.split(',') })} />}
      </div>)}
        <button type="button" className="secondary sm" onClick={() => setFormats(y => ({ ...y, [fk]: [...(y[fk] ?? []), { key: `f${Date.now().toString(36)}`, label: '', type: 'text' }] }))}><Icon name="plus" size={15} />ঘর যোগ করুন</button></div></section>
    <section className="panel"><div className="da-bar"><h2 style={{ margin: 0 }}>কে কী করতে পারেন</h2><Link to="/app/roles" className="small">রোল ও অনুমতি বদলান →</Link></div>
      <p className="muted small">অনুমতি রোল অনুযায়ী। কোনো রোলকে অনুমোদনের ক্ষমতা দিতে বা সরাতে "রোল ও অনুমতি" পাতা থেকে বদলান।</p>
      <div className="nv-rows">{(approvers.data ?? []).filter(a => PERM_BN[a.code]).map(a => <div key={a.code} className="nv-row">
        <span className="nv-av sd-i b"><Icon name="shield" size={18} /></span><span className="tx"><b>{PERM_BN[a.code]}</b><span>{a.roles.join(', ') || 'কোনো রোল নেই (শুধু সুপার অ্যাডমিন)'}</span></span></div>)}</div></section>
    {err && <p className="da-error">{err}</p>}
    <div className="da-actionbar"><button disabled={busy} onClick={() => void save()}>{busy ? 'সেভ হচ্ছে…' : 'সেটিং সেভ করুন'}</button></div>
  </>
}
