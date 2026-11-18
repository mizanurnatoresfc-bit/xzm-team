import { useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { Icon } from '../../components/Icon'
import { fleet, fleetFriendly, ROLE_BN, type Role } from '../../lib/fleet'
import { hrFriendly, type Employee, type Hub } from '../../lib/hr'
import { dutiesApi, FREQ, hubApi, routesApi } from '../../lib/hub'
import { office, type Asset, type Property } from '../../lib/office'
import { usePrefs } from '../../lib/prefs'
import { Badge, useLoad, useToast } from '../accounts/ui'

const msg = (e: unknown) => e instanceof Error && /[ঀ-৿]/.test(e.message) ? e.message : hrFriendly(e)

/**
 * জিনিস বণ্টন — the hub manager's one place to put things in a person's name: a vehicle (driver / helper), rider routes,
 * duties and the hub's items (office assets). Every action calls the same functions as the page that already owns it
 * (fleet, rider routes, duties, office resources), so the same permissions and checks apply; a block shows only if the
 * manager may change it. What is put here appears on that person's "আমার হাব ওয়ালেট".
 */
export function AssignHub({ hub }: { hub: Hub }) {
  const { can } = useAuth()
  const { L } = usePrefs()
  const team = useLoad(() => hubApi.team(hub.id, 'active'), [hub.id])
  const [pick, setPick] = useState('')
  const [q, setQ] = useState('')
  const { toast, node } = useToast()
  const list = useMemo(() => (team.data ?? []).filter(e => !q.trim() || `${e.full_name} ${e.employee_code ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())), [team.data, q])
  const who = (team.data ?? []).find(e => e.id === pick) ?? null
  const canAny = can('vehicle.holder.edit') || can('ops.route.edit') || can('hr.duty.edit') || can('office.asset.edit')
  if (!canAny) return <p className="notice">{L('এই পাতায় কিছু দেওয়ার অনুমতি আপনার রোলে নেই।', 'Your role may not assign anything here.')}</p>

  return <div className="as">
    {node}
    <section className="panel">
      <div className="da-bar"><h2 style={{ margin: 0 }}>{L('কার নামে দেবেন?', 'Whose name?')}</h2></div>
      <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={L('নাম বা আইডি খুঁজুন', 'Search name or ID')} aria-label={L('খুঁজুন', 'Search')} />
      <div className="as-people" role="listbox" aria-label={L('হাবের টিম', 'Hub team')}>
        {team.loading && !team.data ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p> : list.length === 0 ? <p className="muted small">{L('কেউ নেই', 'Nobody')}</p>
          : list.map(e => <button key={e.id} type="button" role="option" aria-selected={e.id === pick} className={`as-p${e.id === pick ? ' on' : ''}`} onClick={() => setPick(e.id)}>
            <span className="av">{e.full_name.slice(0, 1)}</span><span className="t"><b>{e.full_name}</b><small>{e.employee_code ? `${L('আইডি', 'ID')} ${e.employee_code}` : '—'}</small></span></button>)}
      </div>
    </section>
    {!who ? <p className="muted" style={{ margin: '4px 2px' }}>{L('একজনকে বেছে নিলে তাঁর নামে যা আছে আর যা দিতে পারেন এখানে আসবে।', 'Pick a person to see what is in their name and what you can give.')}</p>
      : <>
        <h2 className="sd-h" style={{ margin: '4px 2px' }}>{who.full_name}{who.employee_code ? ` · ${who.employee_code}` : ''}</h2>
        {can('vehicle.holder.edit') && <VehicleBlock hub={hub} who={who} say={toast} />}
        {can('ops.route.edit') && <RouteBlock hub={hub} who={who} say={toast} />}
        {can('hr.duty.edit') && <DutyBlock hub={hub} who={who} say={toast} />}
        {can('office.asset.edit') && <ItemBlock hub={hub} who={who} say={toast} />}
      </>}
  </div>
}

type Say = (m: string) => void

function VehicleBlock({ hub, who, say }: { hub: Hub; who: Employee; say: Say }) {
  const { L } = usePrefs()
  const board = useLoad(() => fleet.board(hub.id), [hub.id])
  const [veh, setVeh] = useState(''); const [role, setRole] = useState<Role>('driver'); const [allow, setAllow] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const rows = board.data ?? []
  const mine = rows.flatMap(v => v.crew.filter(c => c.employee_id === who.id).map(c => ({ v, c })))
  const free = rows.filter(v => v.can_crew)
  const chosen = free.find(v => v.id === veh)
  async function give() {
    setErr('')
    if (!who.employee_code) return setErr(L('এই কর্মীর আইডি নেই', 'This person has no employee ID'))
    if (!chosen) return setErr(L('গাড়ি বাছুন', 'Pick a vehicle'))
    setBusy(true)
    try { await fleet.setCrew(chosen.id, role, who.employee_code, allow.trim() ? Number(allow) : null); setVeh(''); setAllow(''); say(L('গাড়ি তাঁর নামে দেওয়া হয়েছে', 'Vehicle given')); await board.reload() }
    catch (e) { setErr(fleetFriendly(e)) } finally { setBusy(false) }
  }
  async function take(vid: string, r: Role) {
    setErr(''); setBusy(true)
    try { await fleet.removeCrew(vid, r, L('হাব ম্যানেজার বণ্টন বদলেছেন', 'Hub manager changed the assignment')); say(L('গাড়ি ফেরত নেওয়া হয়েছে', 'Vehicle taken back')); await board.reload() }
    catch (e) { setErr(fleetFriendly(e)) } finally { setBusy(false) }
  }
  return <section className="panel as-blk">
    <h3><Icon name="truck" size={17} />{L('গাড়ি', 'Vehicle')}{mine.length ? <Badge tone="ok">{mine.length}</Badge> : null}</h3>
    {mine.length ? mine.map(({ v, c }) => <div key={v.id + c.role} className="as-row"><div className="t"><b>{v.name}</b><small>{[v.reg_no, ROLE_BN[c.role]].filter(Boolean).join(' · ')}</small></div>
      <button type="button" className="secondary sm" disabled={busy} onClick={() => void take(v.id, c.role)}>{L('ফেরত নিন', 'Take back')}</button></div>)
      : <p className="muted small">{L('এখন কোনো গাড়ি তাঁর নামে নেই', 'No vehicle in their name')}</p>}
    <div className="as-add">
      <select value={veh} onChange={e => { setVeh(e.target.value); const v = free.find(x => x.id === e.target.value); if (v && !v.roles.includes(role)) setRole(v.roles[0] ?? 'driver') }} aria-label={L('গাড়ি', 'Vehicle')}>
        <option value="">{L('গাড়ি বাছুন…', 'Pick a vehicle…')}</option>{free.map(v => <option key={v.id} value={v.id}>{v.name}{v.reg_no ? ` · ${v.reg_no}` : ''}</option>)}</select>
      <select value={role} onChange={e => setRole(e.target.value as Role)} aria-label={L('ভূমিকা', 'Role')}>{(chosen?.roles ?? (['driver', 'helper'] as Role[])).map(r => <option key={r} value={r}>{ROLE_BN[r]}</option>)}</select>
      <input inputMode="numeric" value={allow} onChange={e => setAllow(e.target.value.replace(/[^\d]/g, ''))} placeholder={L('খোরাকি (৳)', 'Allowance (৳)')} aria-label={L('খোরাকি', 'Allowance')} />
      <button type="button" disabled={busy || !veh} onClick={() => void give()}><Icon name="plus" size={16} />{L('দিন', 'Give')}</button>
    </div>
    {err && <p className="da-error" role="alert">{err}</p>}
  </section>
}

function RouteBlock({ hub, who, say }: { hub: Hub; who: Employee; say: Say }) {
  const { L } = usePrefs()
  const routes = useLoad(() => routesApi.list(hub.id), [hub.id])
  const riders = useLoad(() => routesApi.riders(hub.id), [hub.id])
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function flip(r: { id: string; hub_id: string; zone_id: string } & Record<string, unknown>, on: boolean) {
    setErr(''); setBusy(true)
    try {
      const cur = riders.data ?? []
      const now = cur.filter(c => c.route_id === r.id).map(c => c.employee_id)
      const next = on ? [...new Set([...now, who.id])] : now.filter(x => x !== who.id)
      await routesApi.setRiders(r as never, next, cur); say(on ? L('রুট তাঁর নামে দেওয়া হয়েছে', 'Route given') : L('রুট সরানো হয়েছে', 'Route removed')); await riders.reload()
    } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }
  const rs = routes.data ?? []
  return <section className="panel as-blk">
    <h3><Icon name="map" size={17} />{L('রুট', 'Routes')}</h3>
    {rs.length === 0 ? <p className="muted small">{L('এই হাবে এখনো রুট নেই — "রাইডার রুট" পাতায় রুট বানান।', 'No routes yet — make them in "Rider routes".')}</p>
      : <div className="as-chips">{rs.map(r => { const on = (riders.data ?? []).some(c => c.route_id === r.id && c.employee_id === who.id)
        return <button key={r.id} type="button" className={`chip-toggle${on ? ' on' : ''}`} aria-pressed={on} disabled={busy} onClick={() => void flip(r as never, !on)}>{r.name}</button> })}</div>}
    {err && <p className="da-error" role="alert">{err}</p>}
  </section>
}

function DutyBlock({ hub, who, say }: { hub: Hub; who: Employee; say: Say }) {
  const { L, lang } = usePrefs()
  const duties = useLoad(() => dutiesApi.ofEmployee(who.id), [who.id])
  const [title, setTitle] = useState(''); const [freq, setFreq] = useState('daily')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function add() {
    setErr('')
    if (title.trim().length < 2) return setErr(L('দায়িত্বের নাম লিখুন', 'Write the duty'))
    setBusy(true)
    try { await dutiesApi.save({ position_id: null, employee_id: who.id, zone_id: hub.zone_id, title: title.trim(), details: null, frequency: freq, sort: 0 }); setTitle(''); say(L('দায়িত্ব যোগ হয়েছে', 'Duty added')); await duties.reload() }
    catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }
  async function del(id: string) { setErr(''); try { await dutiesApi.remove(id); await duties.reload() } catch (e) { setErr(msg(e)) } }
  const ds = duties.data ?? []
  return <section className="panel as-blk">
    <h3><Icon name="tasks" size={17} />{L('দায়িত্ব', 'Duties')}{ds.length ? <Badge tone="ok">{ds.length}</Badge> : null}</h3>
    {ds.length ? ds.map(d => <div key={d.id} className="as-row"><div className="t"><b>{d.title}</b><small>{FREQ[d.frequency]?.[lang === 'bn' ? 0 : 1] ?? d.frequency}</small></div>
      <button type="button" className="icon" aria-label={L('সরান', 'Remove')} onClick={() => void del(d.id)}><Icon name="x" size={16} /></button></div>)
      : <p className="muted small">{L('নিজের নামে আলাদা কোনো দায়িত্ব নেই (পদের দায়িত্ব আলাদা)', 'No personal duty (duties of the post are separate)')}</p>}
    <div className="as-add"><input value={title} onChange={e => setTitle(e.target.value)} placeholder={L('যেমন: সন্ধ্যায় ক্যাশ গুনে জমা', 'e.g. count and hand over cash in the evening')} aria-label={L('দায়িত্ব', 'Duty')} />
      <select value={freq} onChange={e => setFreq(e.target.value)} aria-label={L('কতবার', 'How often')}>{Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{lang === 'bn' ? v[0] : v[1]}</option>)}</select>
      <button type="button" disabled={busy} onClick={() => void add()}><Icon name="plus" size={16} />{L('দিন', 'Give')}</button></div>
    {err && <p className="da-error" role="alert">{err}</p>}
  </section>
}

function ItemBlock({ hub, who, say }: { hub: Hub; who: Employee; say: Say }) {
  const { L, n } = usePrefs()
  const data = useLoad(async () => {
    const props = (await office.properties()).filter((p: Property) => p.hub_id === hub.id)
    const sets = await Promise.all(props.map(p => office.assets(p.id).catch(() => [] as Asset[])))
    return { props, assets: sets.flat() }
  }, [hub.id])
  const [pickA, setPickA] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const all = data.data?.assets ?? []
  const held = all.filter(a => a.holder_id === who.id), free = all.filter(a => !a.holder_id)
  async function set(a: Asset, holder: string | null) {
    setErr(''); setBusy(true)
    try { await office.saveAsset({ holder_id: holder }, a.id); say(holder ? L('জিনিস তাঁর নামে দেওয়া হয়েছে', 'Item given') : L('জিনিস ফেরত নেওয়া হয়েছে', 'Item taken back')); setPickA(''); await data.reload() }
    catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }
  return <section className="panel as-blk">
    <h3><Icon name="box" size={17} />{L('হাবের জিনিস', 'Hub items')}{held.length ? <Badge tone="ok">{n(held.reduce((s, a) => s + (a.quantity || 1), 0))}</Badge> : null}</h3>
    {data.loading && !data.data ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p> : !(data.data?.props.length) ? <p className="muted small">{L('এই হাবের অফিস বা আবাসিক এখনো যোগ করা হয়নি।', 'No office or residence is added for this hub yet.')}</p> : <>
      {held.length ? held.map(a => <div key={a.id} className="as-row"><div className="t"><b>{a.name}{a.quantity > 1 ? ` × ${n(a.quantity)}` : ''}</b><small>{[a.brand, a.serial_no, a.condition !== 'good' ? L('ঠিক নেই', 'needs attention') : ''].filter(Boolean).join(' · ') || '—'}</small></div>
        <button type="button" className="secondary sm" disabled={busy} onClick={() => void set(a, null)}>{L('ফেরত নিন', 'Take back')}</button></div>)
        : <p className="muted small">{L('এখন কোনো জিনিস তাঁর হাতে নেই', 'No item in their hands')}</p>}
      <div className="as-add"><select value={pickA} onChange={e => setPickA(e.target.value)} aria-label={L('জিনিস', 'Item')}>
        <option value="">{L('কারো নামে নেই এমন জিনিস বাছুন…', 'Pick an item nobody holds…')}</option>{free.map(a => <option key={a.id} value={a.id}>{a.name}{a.quantity > 1 ? ` × ${a.quantity}` : ''}{a.serial_no ? ` · ${a.serial_no}` : ''}</option>)}</select>
        <button type="button" disabled={busy || !pickA} onClick={() => { const a = free.find(x => x.id === pickA); if (a) void set(a, who.id) }}><Icon name="plus" size={16} />{L('দিন', 'Give')}</button></div></>}
    {err && <p className="da-error" role="alert">{err}</p>}
  </section>
}
