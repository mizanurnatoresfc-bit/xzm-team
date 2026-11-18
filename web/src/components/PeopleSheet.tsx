import { useEffect, useState } from 'react'
import { extraFriendly, PROSPECT_STATUS, referrals, type Prospect } from '../lib/extra'
import { org, type Position } from '../lib/hr'
import { usePrefs } from '../lib/prefs'
import { BD_MOBILE, cleanMobile } from '../lib/validate'
import { Badge, useLoad } from '../pages/accounts/ui'
import { Icon } from './Icon'

/**
 * আমার লোক, from the bottom of the screen: "people I have in hand" (add a name, mobile and position, see the list)
 * or "people I brought" (who joined through me). It writes through the same calls as the profile's referral panel.
 */
export function PeopleSheet({ mode, employee, onClose, onChanged }: { mode: 'hand' | 'gave'; employee: string; onClose: () => void; onChanged: () => void }) {
  const { L, n, lang } = usePrefs()
  const hand = useLoad(() => mode === 'hand' ? referrals.prospects(employee) : Promise.resolve([] as Prospect[]), [mode, employee])
  const gave = useLoad(() => mode === 'gave' ? referrals.brought(employee) : Promise.resolve([]), [mode, employee])
  const pos = useLoad(() => mode === 'hand' ? org.positions().catch(() => [] as Position[]) : Promise.resolve([] as Position[]), [mode])
  const [name, setName] = useState(''); const [mobile, setMobile] = useState(''); const [position, setPosition] = useState(''); const [area, setArea] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('')
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const posName = (id: string | null) => { const p = pos.data?.find(x => x.id === id); return p ? (lang === 'bn' && p.name_bn ? p.name_bn : p.name) : '' }

  async function add() {
    setErr(''); setMsg('')
    if (name.trim().length < 2) return setErr(L('নাম দিন', 'Enter the name'))
    const m = mobile.trim() ? cleanMobile(mobile) : ''
    if (m && !BD_MOBILE.test(m)) return setErr(L('সঠিক মোবাইল নম্বর দিন — ১১ সংখ্যা, যেমন 01711000000', 'Enter a valid mobile — 11 digits, like 01711000000'))
    if (m && (hand.data ?? []).some(p => p.mobile && cleanMobile(p.mobile) === m)) return setErr(L('এই নম্বরের লোক আগেই দেওয়া আছে', 'Someone with this number is already on your list'))
    setBusy(true)
    try {
      await referrals.saveProspect({ referrer_id: employee, full_name: name.trim(), mobile: m || null, position_id: position || null, area: area.trim() || null, note: null, status: 'available', extra: {} })
      setName(''); setMobile(''); setArea(''); setMsg(L('যোগ হয়েছে — ম্যানেজার দেখতে পাবেন', 'Added — your manager can see it'))
      await hand.reload(); onChanged()
    } catch (e) { setErr(extraFriendly(e)) } finally { setBusy(false) }
  }
  async function remove(id: string) {
    setErr(''); setMsg('')
    try { await referrals.archiveProspect(id); await hand.reload(); onChanged() } catch (e) { setErr(extraFriendly(e)) }
  }

  const list = hand.data ?? []
  const brought = gave.data ?? []
  return <div className="sheet-bg no-print" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="sheet ppl-sheet" role="dialog" aria-modal="true" aria-label={mode === 'hand' ? L('আমার হাতে লোক আছে', 'People I have in hand') : L('আমি যাদের দিয়েছি', 'People I brought')}>
      <div className="sheet-grab" />
      <div className="sheet-hd"><b>{mode === 'hand' ? L('আমার হাতে লোক আছে', 'People I have in hand') : L('আমি যাদের দিয়েছি', 'People I brought')}</b>
        <button className="icon" aria-label={L('বন্ধ', 'Close')} onClick={onClose}><Icon name="x" size={18} /></button></div>
      {mode === 'hand' ? <>
        <p className="muted small" style={{ margin: '0 0 6px' }}>{L('কাজ করতে চায় এমন কারো নাম দিন — হাব ম্যানেজার দেখবেন।', 'Add anyone who wants work — the hub manager can see it.')}</p>
        <div className="ppl-list">{hand.loading && !hand.data ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p> : list.length === 0 ? <p className="muted small">{L('এখনো কেউ নেই', 'Nobody yet')}</p>
          : list.map(p => <div key={p.id} className="ppl-row"><span className="av">{p.full_name.slice(0, 1)}</span>
            <div className="t"><b>{p.full_name}</b><span>{[p.mobile, posName(p.position_id), p.area].filter(Boolean).join(' · ') || '—'}</span></div>
            <Badge tone={PROSPECT_STATUS[p.status]?.[1] ?? 'neutral'}>{PROSPECT_STATUS[p.status]?.[0] ?? p.status}</Badge>
            <button type="button" className="icon" aria-label={L('তালিকা থেকে সরান', 'Remove')} onClick={() => void remove(p.id)}><Icon name="x" size={16} /></button></div>)}</div>
        <div className="ppl-form">
          <label><span>{L('নাম', 'Name')}</span><input value={name} onChange={e => setName(e.target.value)} autoComplete="off" /></label>
          <label><span>{L('মোবাইল', 'Mobile')}</span><input inputMode="tel" value={mobile} onChange={e => setMobile(e.target.value)} placeholder="01711000000" autoComplete="off" /></label>
          <label><span>{L('কোন কাজের জন্য', 'For which job')}</span><select value={position} onChange={e => setPosition(e.target.value)}>
            <option value="">—</option>{(pos.data ?? []).filter(p => !p.archived_at && (p.level ?? 'hub') === 'hub').map(p => <option key={p.id} value={p.id}>{lang === 'bn' && p.name_bn ? p.name_bn : p.name}</option>)}</select></label>
          <label><span>{L('এলাকা', 'Area')}</span><input value={area} onChange={e => setArea(e.target.value)} autoComplete="off" /></label>
        </div>
        {err && <p className="da-error" role="alert">{err}</p>}{msg && <p className="ok-note" role="status">{msg}</p>}
        <button type="button" className="gbtn ppl-add" disabled={busy} onClick={() => void add()}><Icon name="plus" size={18} />{busy ? L('হচ্ছে…', 'Saving…') : L('যোগ করুন', 'Add')}</button>
      </> : <>
        <p className="muted small" style={{ margin: '0 0 6px' }}>{L('আমার আনা লোকের অবস্থা', 'Where each person stands')}</p>
        <div className="ppl-list">{gave.loading && !gave.data ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p> : brought.length === 0 ? <p className="muted small">{L('এখনো কেউ নেই', 'Nobody yet')}</p>
          : brought.map(p => <div key={p.id} className="ppl-row"><span className="av">{p.full_name.slice(0, 1)}</span>
            <div className="t"><b>{p.full_name}</b><span>{[p.employee_code && `${L('আইডি', 'ID')} ${p.employee_code}`, p.position_name, p.hub_name].filter(Boolean).join(' · ') || '—'}</span></div>
            <Badge tone={p.status === 'active' ? 'ok' : 'neutral'}>{p.status === 'active' ? L('সক্রিয়', 'Active') : p.status}</Badge></div>)}</div>
        <p className="muted small">{L(`মোট ${n(brought.length)} জন`, `${brought.length} in all`)}</p>
      </>}
    </div>
  </div>
}
