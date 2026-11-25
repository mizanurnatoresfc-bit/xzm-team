// Staff send numbers into a manager's khata, and the manager accepts them (one line, or all at once). StaffForms is the staff side
// (the two forms on the staff panel), RiderInbox the manager side. Every rule is in the database
// (da_rider_submit / da_rider_accept / da_rider_accept_all); this only calls it.
import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { da, type MyRiderSend } from '../lib/dailyAccounts'
import { usePrefs } from '../lib/prefs'
import { supabase } from '../lib/supabase'
import { ErrorNote, useLoad } from '../pages/accounts/ui'
import { Icon } from './Icon'
import { announceWfChange, wf, wfFriendly } from '../lib/workforce'

const MGR_KEY = 'xzm_rider_mgr'
/** Bangla or English digits in, a number out (empty = 0). */
const toNum = (v: string) => { const x = Number(v.replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).replace(/[^\d.]/g, '')); return Number.isFinite(x) ? x : 0 }
const clean = (v: string) => v.replace(/[^\d০-৯.]/g, '')

const STATUS: Record<MyRiderSend['status'], [string, string, string]> = {
  pending: ['গ্রহণের অপেক্ষায়', 'Waiting', 'o'], accepted: ['গৃহীত', 'Accepted', 'g'], taken: ['খাতায় উঠেছে', 'In the sheet', 'g'],
}

/**
 * Staff panel: the two forms. পিকআপ খাতা = pickup + returns given back to merchants; ডেলিভারি খাতা = delivery return + delivery + money.
 * Numbers only (no merchant name). What needs the manager (pickup, delivery, money) goes into the manager's khata as one line the manager
 * accepts — the same line the old "send today's count" card made; nothing new is made for it. The four numbers are also added to the day's
 * count (wf_ops_add), so the attendance daily report and the zone report stay right. The returns have no column in the khata line, so they
 * are written in its remark. A send with only returns has nothing for the khata and goes to the day's count alone.
 */
export function StaffForms({ onSent }: { onSent?: () => void | Promise<void> }) {
  const { L, n } = usePrefs()
  const { session } = useAuth()
  const uid = session?.user.id ?? ''
  const d = useLoad(() => da.riderOpen().catch(() => null), [])
  const ops = useLoad(() => wf.myOps(1).catch(() => null), [])
  const [pf, setPf] = useState({ pickup: '', ret: '' })
  const [df, setDf] = useState({ ret: '', delivery: '', amount: '', office: false })
  const [mgr, setMgr] = useState<string>(() => { try { return localStorage.getItem(MGR_KEY) ?? '' } catch { return '' } })
  const [busy, setBusy] = useState<'' | 'pickup' | 'delivery'>('')
  const [err, setErr] = useState<unknown>(null)
  const [done, setDone] = useState<string | null>(null)
  useEffect(() => { if (!done) return; const t = window.setTimeout(() => setDone(null), 5000); return () => window.clearTimeout(t) }, [done])

  if (!ops.data) return null                       // no active staff profile on this login: nothing to fill
  const v = d.data
  const open = (v && Array.isArray(v.managers) ? v.managers : []).filter(m => !m.closed && m.user_id !== uid)
  const chosen = open.length === 1 ? open[0].user_id : open.some(m => m.user_id === mgr) ? mgr : ''
  const used = !!v && v.my_times >= v.max_times
  const khataWhy = !v ? L('খাতার অবস্থা জানা যায়নি', 'The khata status could not be read')
    : !v.session_id ? L('আজকের খাতা এখনো কোনো ম্যানেজার খোলেননি', "No manager has opened today's khata yet")
    : !open.length ? L('আজ সব ম্যানেজারের খাতা বন্ধ', "Every manager's khata is closed")
    : used ? L(`আজ সর্বোচ্চ ${n(v.max_times)} বার পাঠানো হয়ে গেছে`, `You have sent the most allowed today (${v.max_times})`)
    : !chosen ? L('আগে ম্যানেজার বাছুন', 'Pick a manager first') : ''
  const total = ops.data.entry
  const sum = (l1: string, a: number, l2: string, b: number) => `${L('আজ মোট', 'Today so far')}: ${l1} ${n(a)} · ${l2} ${n(b)}`

  async function send(kind: 'pickup' | 'delivery') {
    const p = kind === 'pickup' ? toNum(pf.pickup) : 0, pr = kind === 'pickup' ? toNum(pf.ret) : 0
    const dl = kind === 'delivery' ? toNum(df.delivery) : 0, dr = kind === 'delivery' ? toNum(df.ret) : 0
    const a = kind === 'delivery' ? toNum(df.amount) : 0, office = kind === 'delivery' && df.office
    setErr(null)
    if (!office && p + pr + dl + dr + a === 0) { setErr(new Error(L('অন্তত একটা ঘরে সংখ্যা লিখুন', 'Write at least one number'))); return }
    const needKhata = p > 0 || dl > 0 || a > 0 || office
    if (needKhata && khataWhy) { setErr(new Error(`${khataWhy} — ${L('পিকআপ, ডেলিভারি বা টাকা পাঠানো যাবে না', 'pickup, delivery or money cannot be sent')}`)); return }
    const rem = [pr > 0 && `${L('মার্চেন্টকে রিটার্ন', 'Returned to merchants')} ${pr}`, dr > 0 && `${L('ডেলিভারি রিটার্ন', 'Delivery return')} ${dr}`].filter(Boolean).join(' · ')
    setBusy(kind)
    try {
      if (needKhata) {
        await da.riderSubmit({ manager: chosen, amount: a, delivery: dl, pickup: p, office, remarks: rem || null })
        try { localStorage.setItem(MGR_KEY, chosen) } catch { /* private window */ }
      }
      try { await wf.addOps({ pickup: p, pickup_return: pr, delivery: dl, delivery_return: dr }); announceWfChange() }
      catch (e) { if (!needKhata) throw e; setErr(new Error(L(`খাতায় গেছে, কিন্তু দৈনিক সংখ্যায় যোগ হয়নি: ${wfFriendly(e)}`, `Sent to the khata, but not added to the day's count: ${wfFriendly(e)}`))) }
      if (kind === 'pickup') setPf({ pickup: '', ret: '' }); else setDf({ ret: '', delivery: '', amount: '', office: false })
      setDone(needKhata ? L('পাঠানো হয়েছে — ম্যানেজারের গ্রহণের অপেক্ষায়', 'Sent — waiting for the manager') : L('সংখ্যা জমা হয়েছে', 'Numbers saved'))
      await Promise.all([d.reload(), ops.reload()]); await onSent?.()
    } catch (e) { setErr(e) } finally { setBusy('') }
  }
  const field = (cls: string, icon: string, label: string, val: string, set: (x: string) => void, dec = false) =>
    <label className={`rs-f ${cls}`}><span><Icon name={icon} size={16} /> {label}</span>
      <input inputMode={dec ? 'decimal' : 'numeric'} placeholder="0" value={val} onChange={e => set(clean(e.target.value))} /></label>

  return <section id="wf-ops" className="wf-ops-sec">
    <h2 className="sd-h">{L('পিকআপ ও ডেলিভারি খাতা', 'Pickup & delivery khata')}</h2>
    <div className="panel rsend">
      <div className="da-bar"><h2 style={{ margin: 0 }}>{L('আজকের সংখ্যা', "Today's numbers")}</h2>
        <span className="small muted">{v?.hub ?? ''}{v?.session_id ? ` · ${L('আজ', 'Today')} ${n(v.my_times)}/${n(v.max_times)} ${L('বার', 'times')}` : ''}</span></div>
      {khataWhy && <p className="rs-note"><Icon name="clock" size={18} />{khataWhy}{L(' — রিটার্ন লিখে রাখা যাবে, কিন্তু পিকআপ, ডেলিভারি ও টাকা পাঠানো যাবে না।', ' — returns can still be saved, but pickup, delivery and money cannot be sent.')}</p>}
      {open.length > 1 && <div className="rs-mgrs" role="group" aria-label={L('কোন ম্যানেজারের কাছে', 'To which manager')}>
        <span className="small muted">{L('কার কাছে দিচ্ছেন:', 'Giving to:')}</span>
        {open.map(m => <button key={m.user_id} type="button" className={`rs-chip${chosen === m.user_id ? ' on' : ''}`} aria-pressed={chosen === m.user_id} onClick={() => setMgr(m.user_id)}>{m.name ?? m.code ?? '—'}</button>)}</div>}

      <h3 className="small" style={{ margin: '12px 0 0' }}>{L('পিকআপ খাতা', 'Pickup khata')}
        <span className="muted"> · {sum(L('পিকআপ', 'pickup'), total?.pickup ?? 0, L('রিটার্ন', 'returned'), total?.pickup_return ?? 0)}</span></h3>
      <div className="rs-grid" style={{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }}>
        {field('t-b', 'box', L('পিকআপ', 'Pickup'), pf.pickup, x => setPf({ ...pf, pickup: x }))}
        {field('t-p', 'back', L('মার্চেন্টকে রিটার্ন', 'Returned to merchant'), pf.ret, x => setPf({ ...pf, ret: x }))}
      </div>
      <button type="button" className="rs-send" disabled={!!busy} onClick={() => void send('pickup')}><Icon name="check" size={18} />{busy === 'pickup' ? L('পাঠানো হচ্ছে…', 'Sending…') : L('পিকআপ পাঠান', 'Send pickup')}</button>

      <h3 className="small" style={{ margin: '18px 0 0' }}>{L('ডেলিভারি খাতা', 'Delivery khata')}
        <span className="muted"> · {sum(L('রিটার্ন', 'returned'), total?.delivery_return ?? 0, L('ডেলিভারি', 'delivery'), total?.delivery ?? 0)}</span></h3>
      <div className="rs-grid">
        {field('t-p', 'back', L('ডেলিভারি রিটার্ন', 'Delivery return'), df.ret, x => setDf({ ...df, ret: x }))}
        {field('t-g', 'truck', L('ডেলিভারি', 'Delivery'), df.delivery, x => setDf({ ...df, delivery: x }))}
        {field('t-g', 'cash', L('টাকা', 'Amount'), df.amount, x => setDf({ ...df, amount: x }), true)}
      </div>
      <label className="rs-office"><input type="checkbox" checked={df.office} onChange={e => setDf({ ...df, office: e.target.checked })} /> {L('টাকা অফিসে জমা দিয়েছি', 'I paid the money at the office')}</label>
      <button type="button" className="rs-send" disabled={!!busy} onClick={() => void send('delivery')}><Icon name="check" size={18} />{busy === 'delivery' ? L('পাঠানো হচ্ছে…', 'Sending…') : L('ডেলিভারি পাঠান', 'Send delivery')}</button>

      {done && <p className="rs-done" role="status"><Icon name="check" size={16} />{done}</p>}
      <ErrorNote error={err} />
      {v && v.mine.length > 0 && <ul className="rs-list">{v.mine.map(x => { const st = STATUS[x.status]; return <li key={x.id}>
        <span className="rs-t">{new Date(x.at).toLocaleTimeString(L('bn-BD', 'en-GB'), { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' })}</span>
        <span className="rs-v">{n(x.pickup)} {L('পিকআপ', 'pickup')} · {n(x.delivery)} {L('ডেলিভারি', 'delivery')} · <b>৳{n(x.amount)}</b>{x.office_deposit ? L(' · অফিসে জমা', ' · at office') : ''}</span>
        <span className={`rs-st t-${st[2]}`}>{L(st[0], st[1])}</span></li> })}</ul>}
    </div>
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
