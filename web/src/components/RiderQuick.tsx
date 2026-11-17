// One tap from the dashboard: a rider/staff member sends today's pickup, delivery and amount into a
// manager's khata, and the manager accepts it (one line, or all at once). Every rule is in the database
// (da_rider_submit / da_rider_accept / da_rider_accept_all); this only calls it.
import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { da, type MyRiderSend } from '../lib/dailyAccounts'
import { usePrefs } from '../lib/prefs'
import { supabase } from '../lib/supabase'
import { ErrorNote, useLoad } from '../pages/accounts/ui'
import { Icon } from './Icon'

const MGR_KEY = 'xzm_rider_mgr'
/** Bangla or English digits in, a number out (empty = 0). */
const toNum = (v: string) => { const x = Number(v.replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).replace(/[^\d.]/g, '')); return Number.isFinite(x) ? x : 0 }
const clean = (v: string) => v.replace(/[^\d০-৯.]/g, '')

const STATUS: Record<MyRiderSend['status'], [string, string, string]> = {
  pending: ['গ্রহণের অপেক্ষায়', 'Waiting', 'o'], accepted: ['গৃহীত', 'Accepted', 'g'], taken: ['খাতায় উঠেছে', 'In the sheet', 'g'],
}

/** Staff card: পিকআপ · ডেলিভারি · টাকা → পাঠান. Shows to riders, and to anyone who already sent something today. */
export function RiderSendCard({ onSent }: { onSent?: () => void | Promise<void> }) {
  const { L, n } = usePrefs()
  const { session } = useAuth()
  const uid = session?.user.id ?? ''
  const d = useLoad(() => da.riderOpen().catch(() => null), [])
  const [pickup, setPickup] = useState('')
  const [delivery, setDelivery] = useState('')
  const [amount, setAmount] = useState('')
  const [office, setOffice] = useState(false)
  const [mgr, setMgr] = useState<string>(() => { try { return localStorage.getItem(MGR_KEY) ?? '' } catch { return '' } })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [done, setDone] = useState<string | null>(null)
  useEffect(() => { if (!done) return; const t = window.setTimeout(() => setDone(null), 4000); return () => window.clearTimeout(t) }, [done])

  const v = d.data
  if (!v || !Array.isArray(v.managers)) return null
  const open = v.managers.filter(m => !m.closed && m.user_id !== uid)
  if (!v.is_rider && !v.mine.length) return null
  const chosen = open.length === 1 ? open[0].user_id : open.some(m => m.user_id === mgr) ? mgr : ''
  const used = v.my_times >= v.max_times
  const p = toNum(pickup), dl = toNum(delivery), a = toNum(amount)
  const empty = !office && p === 0 && dl === 0 && a === 0
  const canSend = !!v.session_id && !!chosen && !used && !empty && !busy

  async function send() {
    if (!canSend) return
    setBusy(true); setErr(null)
    try {
      await da.riderSubmit({ manager: chosen, amount: a, delivery: dl, pickup: p, office })
      try { localStorage.setItem(MGR_KEY, chosen) } catch { /* private window */ }
      setPickup(''); setDelivery(''); setAmount(''); setOffice(false)
      setDone(L(`পাঠানো হয়েছে: ${n(p)} পিকআপ · ${n(dl)} ডেলিভারি · ৳${n(a)}`, `Sent: ${p} pickups · ${dl} deliveries · ৳${a}`))
      await d.reload(); await onSent?.()
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }

  return <section className="panel rsend">
    <div className="da-bar"><h2 style={{ margin: 0 }}>{L('আজকের হিসাব পাঠান', "Send today's count")}</h2>
      <span className="small muted">{v.hub ?? ''}{v.session_id ? ` · ${L('আজ', 'Today')} ${n(v.my_times)}/${n(v.max_times)} ${L('বার', 'times')}` : ''}</span></div>

    {!v.session_id ? <p className="rs-note"><Icon name="clock" size={18} />{L('আজকের খাতা এখনো কোনো ম্যানেজার খোলেননি — খোলা হলে এখানে পাঠাতে পারবেন।', 'No manager has opened today’s sheet yet — you can send once it is open.')}</p>
      : !open.length ? <p className="rs-note"><Icon name="check" size={18} />{L('আজ সব ম্যানেজারের খাতা বন্ধ — আর পাঠানো যাবে না।', 'Every manager’s sheet is closed for today.')}</p>
      : used ? <p className="rs-note"><Icon name="alert" size={18} />{L(`আজ সর্বোচ্চ ${n(v.max_times)} বার পাঠানো হয়ে গেছে।`, `You have sent the most allowed today (${v.max_times}).`)}</p>
      : <>
        {open.length > 1 && <div className="rs-mgrs" role="group" aria-label={L('কোন ম্যানেজারের কাছে', 'To which manager')}>
          <span className="small muted">{L('কার কাছে দিচ্ছেন:', 'Giving to:')}</span>
          {open.map(m => <button key={m.user_id} type="button" className={`rs-chip${chosen === m.user_id ? ' on' : ''}`} aria-pressed={chosen === m.user_id} onClick={() => setMgr(m.user_id)}>{m.name ?? m.code ?? '—'}</button>)}</div>}
        <div className="rs-grid">
          <label className="rs-f t-b"><span><Icon name="box" size={16} /> {L('পিকআপ', 'Pickup')}</span>
            <input inputMode="numeric" placeholder="0" value={pickup} onChange={e => setPickup(clean(e.target.value))} /></label>
          <label className="rs-f t-p"><span><Icon name="truck" size={16} /> {L('ডেলিভারি', 'Delivery')}</span>
            <input inputMode="numeric" placeholder="0" value={delivery} onChange={e => setDelivery(clean(e.target.value))} /></label>
          <label className="rs-f t-g"><span><Icon name="cash" size={16} /> {L('টাকা', 'Amount')}</span>
            <input inputMode="decimal" placeholder="0" value={amount} onChange={e => setAmount(clean(e.target.value))} onKeyDown={e => { if (e.key === 'Enter') void send() }} /></label>
        </div>
        <label className="rs-office"><input type="checkbox" checked={office} onChange={e => setOffice(e.target.checked)} /> {L('টাকা অফিসে জমা দিয়েছি', 'I paid the money at the office')}</label>
        <button type="button" className="rs-send" disabled={!canSend} onClick={() => void send()}>
          <Icon name="check" size={18} />{busy ? L('পাঠানো হচ্ছে…', 'Sending…') : !chosen ? L('আগে ম্যানেজার বাছুন', 'Pick a manager first')
            : L(`পাঠান${open.length === 1 ? ` → ${open[0].name ?? ''}` : ''}`, `Send${open.length === 1 ? ` → ${open[0].name ?? ''}` : ''}`)}</button>
      </>}
    {done && <p className="rs-done" role="status"><Icon name="check" size={16} />{done}</p>}
    <ErrorNote error={err} />

    {v.mine.length > 0 && <ul className="rs-list">{v.mine.map(x => { const st = STATUS[x.status]; return <li key={x.id}>
      <span className="rs-t">{new Date(x.at).toLocaleTimeString(L('bn-BD', 'en-GB'), { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' })}</span>
      <span className="rs-v">{n(x.pickup)} {L('পিকআপ', 'pickup')} · {n(x.delivery)} {L('ডেলিভারি', 'delivery')} · <b>৳{n(x.amount)}</b>{x.office_deposit ? L(' · অফিসে জমা', ' · at office') : ''}</span>
      <span className={`rs-st t-${st[2]}`}>{L(st[0], st[1])}</span></li> })}</ul>}
  </section>
}

type Pending = { id: string; session_id: string; rider_name: string; employee_code: string; pickup_qty: number; delivery_qty: number; amount: number
  seq: number; office_deposit: boolean; created_at: string }

/** Manager: what riders sent into my khata — accept each, or all in one tap; send one back with a reason.
 *  With a session, only that day's sheet; without one (the dashboard), everything still waiting for me. */
export function RiderInbox({ session, onChange }: { session?: string | null; onChange?: () => void | Promise<void> }) {
  const { L, n } = usePrefs()
  const { session: me } = useAuth()
  const uid = me?.user.id ?? ''
  const d = useLoad(async () => {
    if (!uid) return [] as Pending[]
    let q = supabase.from('da_rider_lines')
      .select('id, session_id, rider_name, employee_code, pickup_qty, delivery_qty, amount, seq, office_deposit, created_at')
      .eq('created_by', uid).eq('source', 'rider').is('accepted_at', null).is('removed_at', null)
    if (session) q = q.eq('session_id', session)
    const { data, error } = await q.order('created_at').limit(200)
    if (error) throw error
    return (data ?? []) as Pending[]
  }, [session, uid])
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState<unknown>(null)
  const [back, setBack] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  // a rider may send while the manager is looking: check again every minute
  useEffect(() => { const t = window.setInterval(() => void d.reload(), 60000); return () => window.clearInterval(t) }, [session]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = d.data ?? []
  if (!rows.length) return null
  const sessions = [...new Set(rows.map(r => r.session_id))]
  const total = rows.reduce((a, r) => a + Number(r.amount), 0)

  async function run(key: string, f: () => Promise<unknown>) {
    setBusy(key); setErr(null)
    try { await f(); setBack(null); setReason(''); await d.reload(); await onChange?.() } catch (e) { setErr(e) } finally { setBusy('') }
  }

  return <section className="panel rinbox">
    <div className="da-bar"><h2 style={{ margin: 0 }}>{L('রাইডারের পাঠানো হিসাব', 'Sent by riders')} <span className="ap-total">{n(rows.length)}</span></h2>
      <button type="button" disabled={!!busy} onClick={() => void run('all', async () => { for (const id of sessions) await da.riderAcceptAll(id) })}>
        <Icon name="checkall" size={16} />{busy === 'all' ? L('হচ্ছে…', 'Working…') : L(`সব গ্রহণ · ৳${n(total)}`, `Accept all · ৳${total}`)}</button></div>
    <ErrorNote error={err} />
    <ul className="ri-list">{rows.map(r => <li key={r.id}>
      <span className="ri-who"><b>{r.rider_name}</b><small>#{n(r.employee_code)}{r.seq > 1 ? ` · ${n(r.seq)}${L('য় বার', ' time')}` : ''}</small></span>
      <span className="ri-v">{n(r.pickup_qty)} {L('পিকআপ', 'pickup')} · {n(r.delivery_qty)} {L('ডেলিভারি', 'delivery')} · <b>৳{n(Number(r.amount))}</b>{r.office_deposit ? L(' · অফিসে জমা', ' · at office') : ''}</span>
      {back === r.id ? <span className="ri-back">
        <input autoFocus placeholder={L('কেন ফেরত?', 'Why?')} value={reason} onChange={e => setReason(e.target.value)} />
        <button type="button" className="secondary" disabled={!!busy || !reason.trim()} onClick={() => void run(r.id, () => da.riderAccept(r.id, false, reason))}>{L('ফেরত দিন', 'Send back')}</button>
        <button type="button" className="link" onClick={() => setBack(null)}>{L('থাক', 'Cancel')}</button></span>
        : <span className="ri-acts">
          <button type="button" disabled={!!busy} onClick={() => void run(r.id, () => da.riderAccept(r.id, true))}><Icon name="check" size={16} />{L('গ্রহণ', 'Accept')}</button>
          <button type="button" className="secondary" disabled={!!busy} onClick={() => { setBack(r.id); setReason('') }}>{L('ফেরত', 'Back')}</button></span>}
    </li>)}</ul>
  </section>
}
