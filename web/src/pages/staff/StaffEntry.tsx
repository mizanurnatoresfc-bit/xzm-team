/**
 * /app/staff/entry — mobile-first daily entry page for staff/riders.
 *
 * Wraps the existing da.riderOpen / da.riderSubmit API (lib/dailyAccounts.ts)
 * with a full-screen, tap-first layout matching the Flight Hub mockup.
 *
 * Fields: পিকআপ · ডেলিভারি · ডেলিভারি টাকা (same 3 fields the backend already
 * stores; "ফেরত পার্সেল" from the mockup needs a schema migration and is NOT
 * added here — tracked for follow-up).
 */
import { useEffect, useMemo, useState } from 'react'
import { AppShell } from '../../components/AppShell'
import { useAuth } from '../../auth/AuthProvider'
import { usePrefs } from '../../lib/prefs'
import { da } from '../../lib/dailyAccounts'
import { useLoad } from '../accounts/ui'
import './staff-entry.css'

const MGR_KEY = 'xzm_rider_mgr'

/** Bangla/English digits → number (empty = 0). */
const toNum = (v: string) => {
  const x = Number(
    v.replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).replace(/[^\d.]/g, '')
  )
  return Number.isFinite(x) ? x : 0
}
const cleanDigits = (v: string) => v.replace(/[^\d০-৯.]/g, '')

function fmtBnDate(d: Date, lang: 'bn' | 'en') {
  return d.toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    timeZone: 'Asia/Dhaka', weekday: 'long', day: 'numeric', month: 'long',
  })
}
function fmtBnTime(iso: string, lang: 'bn' | 'en') {
  return new Date(iso).toLocaleTimeString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hour12: true,
  })
}
export default function StaffEntry() {
  const { L, n, lang } = usePrefs()
  const { session } = useAuth()
  const uid = session?.user.id ?? ''
  const name = session?.user.user_metadata?.full_name || session?.user.email || L('ব্যবহারকারী', 'User')

  const open = useLoad(() => da.riderOpen().catch(() => null), [])

  const [pickup, setPickup] = useState('')
  const [delivery, setDelivery] = useState('')
  const [amount, setAmount] = useState('')
  const [office, setOffice] = useState(false)
  const [mgr, setMgr] = useState<string>(() => {
    try { return localStorage.getItem(MGR_KEY) ?? '' } catch { return '' }
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    if (!done) return
    const t = window.setTimeout(() => setDone(null), 4500)
    return () => window.clearTimeout(t)
  }, [done])

  const v = open.data
  const openMgrs = useMemo(
    () => (v?.managers ?? []).filter(m => !m.closed && m.user_id !== uid),
    [v, uid]
  )
  const chosen = openMgrs.length === 1
    ? openMgrs[0].user_id
    : openMgrs.some(m => m.user_id === mgr) ? mgr : ''
  const used = v ? v.my_times >= v.max_times : false

  const p = toNum(pickup)
  const dl = toNum(delivery)
  const a = toNum(amount)
  const empty = !office && p === 0 && dl === 0 && a === 0

  const sessionOpen = !!v?.session_id
  const canSend = sessionOpen && !!chosen && !used && !empty && !busy

  const today = useMemo(() => new Date(), [])
  const now = today.toLocaleTimeString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hour12: true,
  })

  async function send() {
    if (!canSend) return
    setBusy(true); setErr(null)
    try {
      await da.riderSubmit({ manager: chosen, amount: a, delivery: dl, pickup: p, office })
      try { localStorage.setItem(MGR_KEY, chosen) } catch { /* ignore */ }
      setPickup(''); setDelivery(''); setAmount(''); setOffice(false)
      setDone(L(
        `পাঠানো হলো · ${n(p)} পিকআপ · ${n(dl)} ডেলিভারি · ৳${n(a)}`,
        `Sent · ${p} pickups · ${dl} deliveries · ৳${a}`
      ))
      await open.reload()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setErr(msg)
    } finally {
      setBusy(false)
    }
  }

  // Compact 1-char initial for avatar
  const initial = (name as string).trim().charAt(0) || '·'

  return (
    <AppShell title={L('আজকের এন্ট্রি', "Today's entry")}>
      <div className="se-wrap">

        {/* Hero card */}
        <section className="se-hero">
          <div className="se-hero-row">
            <div>
              <div className="se-hero-name">{name as string}</div>
              <div className="se-hero-sub">
                {v?.hub ?? L('হাব অজানা', 'Hub unknown')}
                {v && ` · ${L('আজ', 'Today')} ${n(v.my_times)}/${n(v.max_times)} ${L('বার', 'times')}`}
              </div>
            </div>
            <div className="se-avatar">{initial}</div>
          </div>
          <div className="se-hero-date">
            <span>{fmtBnDate(today, lang)}</span>
            <span>🕕 {now}</span>
          </div>
        </section>

        {/* Loading / no-session banners */}
        {open.loading && !v && <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>}
        {v && !sessionOpen && (
          <div className="se-banner se-warn">
            {L(
              'আজকের খাতা এখনো কোনো হিসাব-কেন্দ্র ম্যানেজার খোলেননি। খোলা হলে এখানে পাঠাতে পারবেন।',
              'No accounts manager has opened today\'s sheet yet. You can send once it is open.'
            )}
          </div>
        )}
        {v && sessionOpen && !openMgrs.length && (
          <div className="se-banner se-ok">
            {L('আজ সব ম্যানেজারের খাতা বন্ধ — আর পাঠানো যাবে না।', 'Every manager\'s sheet is closed for today.')}
          </div>
        )}
        {v && sessionOpen && !!openMgrs.length && used && (
          <div className="se-banner se-warn">
            {L(
              `আজ সর্বোচ্চ ${n(v.max_times)} বার পাঠানো হয়ে গেছে।`,
              `You have sent the most allowed today (${v.max_times}).`
            )}
          </div>
        )}

        {/* Manager picker (only if multiple open managers) */}
        {sessionOpen && openMgrs.length > 1 && (
          <section className="se-mgr-pick">
            <div className="se-section-title">{L('কার কাছে পাঠাবেন', 'Send to which manager')}</div>
            <div className="se-mgr-row">
              {openMgrs.map(m => (
                <button
                  key={m.user_id}
                  type="button"
                  className={`se-mgr-chip${chosen === m.user_id ? ' on' : ''}`}
                  aria-pressed={chosen === m.user_id}
                  onClick={() => setMgr(m.user_id)}
                >
                  {m.name ?? m.code ?? '—'}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Entry grid */}
        {sessionOpen && !!openMgrs.length && !used && (
          <section className="se-entry-grid-wrap">
            <div className="se-section-title">{L('আজকের এন্ট্রি', "Today's entry")}</div>
            <div className="se-entry-grid">
              <label className={`se-cell${p > 0 ? ' se-filled' : ''}`}>
                <div className="se-lbl">{L('পিকআপ', 'Pickup')}</div>
                <input
                  inputMode="numeric"
                  placeholder="0"
                  value={pickup}
                  onChange={e => setPickup(cleanDigits(e.target.value))}
                  aria-label={L('পিকআপ', 'Pickup')}
                />
                <div className="se-hint">{L('কতটা পার্সেল তুলেছেন', 'Parcels picked up')}</div>
              </label>
              <label className={`se-cell${dl > 0 ? ' se-filled' : ''}`}>
                <div className="se-lbl">{L('ডেলিভারি', 'Delivery')}</div>
                <input
                  inputMode="numeric"
                  placeholder="0"
                  value={delivery}
                  onChange={e => setDelivery(cleanDigits(e.target.value))}
                  aria-label={L('ডেলিভারি', 'Delivery')}
                />
                <div className="se-hint">{L('কতটা ডেলিভারি করেছেন', 'Parcels delivered')}</div>
              </label>
              <label className={`se-cell se-wide${a > 0 ? ' se-filled' : ''}`}>
                <div className="se-lbl">{L('ডেলিভারি টাকা', 'Delivery amount')}</div>
                <div className="se-money-row">
                  <span className="se-money-pre">৳</span>
                  <input
                    inputMode="decimal"
                    placeholder="0"
                    value={amount}
                    onChange={e => setAmount(cleanDigits(e.target.value))}
                    onKeyDown={e => { if (e.key === 'Enter') void send() }}
                    aria-label={L('ডেলিভারি টাকা', 'Delivery amount')}
                  />
                </div>
                <div className="se-hint">{L('কাস্টমার থেকে তোলা মোট টাকা', 'Total cash collected from customers')}</div>
              </label>
            </div>

            <label className="se-office">
              <input type="checkbox" checked={office} onChange={e => setOffice(e.target.checked)} />
              <span>{L('টাকা অফিসে জমা দিয়েছি', 'I paid the money at the office')}</span>
            </label>
          </section>
        )}

        {/* Flash messages */}
        {err && <div className="se-flash se-flash-err">⚠ {err}</div>}
        {done && <div className="se-flash se-flash-ok">✓ {done}</div>}

        {/* History */}
        {v && v.mine.length > 0 && (
          <section className="se-history-wrap">
            <div className="se-section-title">{L('আজকের পাঠানো', "Sent today")}</div>
            <div className="se-history">
              {v.mine.map(m => {
                const tone =
                  m.status === 'taken' || m.status === 'accepted' ? 'ok' :
                  'pend'
                const lbl =
                  m.status === 'taken' ? L('খাতায় উঠেছে', 'In the sheet') :
                  m.status === 'accepted' ? L('গৃহীত', 'Accepted') :
                  L('অপেক্ষায়', 'Waiting')
                return (
                  <div key={m.id} className="se-history-row">
                    <div className="se-h-nums">
                      <span>{L('পি', 'Pk')}: <b>{n(m.pickup)}</b></span>
                      <span>{L('ডে', 'Dl')}: <b>{n(m.delivery)}</b></span>
                      <span>৳<b>{n(m.amount)}</b></span>
                    </div>
                    <div className="se-h-meta">
                      <span className="se-h-time">{fmtBnTime(m.at, lang)}</span>
                      <span className={`se-chip se-chip-${tone}`}>
                        <span className="d" />{lbl}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="se-hint se-hint-sub">
              {L(
                'ম্যানেজার গ্রহণ করলে খাতায় উঠবে, তখন আর বদলানো যাবে না।',
                'Manager accepts it to the sheet — after that it cannot be changed.'
              )}
            </div>
          </section>
        )}

        {/* Sticky submit button */}
        {sessionOpen && !!openMgrs.length && !used && (
          <div className="se-submit-bar">
            <button
              type="button"
              className="se-submit"
              disabled={!canSend}
              onClick={() => void send()}
            >
              {busy
                ? L('পাঠানো হচ্ছে…', 'Sending…')
                : !chosen
                  ? L('আগে ম্যানেজার বাছুন', 'Pick a manager first')
                  : empty
                    ? L('সংখ্যা বসান', 'Enter the numbers')
                    : L('সাবমিট করুন → হাবে পাঠান', 'Submit → Send to hub')}
            </button>
          </div>
        )}

        {/* Recent-days placeholder note */}
        {v && v.mine.length === 0 && sessionOpen && (
          <p className="muted se-empty-hint">
            {L('আজ এখনো কিছু পাঠাননি।', 'Nothing sent today yet.')}
          </p>
        )}
      </div>
    </AppShell>
  )
}
