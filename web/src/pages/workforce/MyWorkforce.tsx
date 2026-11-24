import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { hrReq } from '../../lib/hrreq'
import { usePrefs } from '../../lib/prefs'
import { useLoad } from '../accounts/ui'
import { InHand } from '../hr/StaffDesk'
import { BroughtPicker } from './BroughtPicker'
import '../../workforce.css'

/**
 * আমার লোক — the two personal people lists on one page:
 *   given      people I brought   (the existing referral list, read from hr_referrals — nothing copied)
 *   hand       people in my hand  (the existing referral_prospects list)
 * Attendance is not here: it has its own page, /app/attendance (AttendancePage).
 */
const TABS = ['given', 'hand'] as const
type Tab = (typeof TABS)[number]
const isTab = (t: string | undefined): t is Tab => TABS.includes(t as Tab)
const META: Record<Tab, { icon: string; bn: string; en: string; sbn: string; sen: string }> = {
  given: { icon: 'userplus', bn: 'আমার লোক দেওয়া', en: 'People I brought', sbn: 'যাঁদের আপনি কাজে এনেছেন', sen: 'People who joined through you' },
  hand: { icon: 'users', bn: 'আমার হাতে লোক আছে', en: 'People in my hand', sbn: 'কাজ করতে চায় এমন যাদের চেনেন', sen: 'People you know who want to work' },
}

export function MyWorkforce() {
  const { L } = usePrefs()
  const { tab } = useParams()
  const nav = useNavigate()
  const me = useLoad(() => hrReq.myEmployee(), [])
  if (!isTab(tab)) return <Navigate to="/app/attendance" replace />
  const m = META[tab]
  const e = me.data
  const noProfile = !me.loading && !me.error && !e

  return <AppShell title={L(m.bn, m.en)} subtitle={L(m.sbn, m.sen)}>
    <div className="wf">
      <div className="nv-chips wf-tabs" role="tablist" aria-label={L('আমার লোক', 'My people')}>
        {TABS.map(t => <button key={t} type="button" role="tab" aria-selected={tab === t} className={`nv-chip${tab === t ? ' on' : ''}`}
          onClick={() => nav(`/app/workforce/${t}`, { replace: true })}>
          <Icon name={META[t].icon} size={15} />{L(META[t].bn, META[t].en)}</button>)}
      </div>

      {me.error ? <p className="da-error" role="alert">{L('আপনার তথ্য আনা যায়নি — একটু পরে আবার চেষ্টা করুন।', 'Could not load your details — try again in a moment.')}</p>
        : noProfile ? <div className="notice" role="status"><b>{L('আপনার লগইনের সাথে কর্মী প্রোফাইল যুক্ত নেই।', 'No staff profile is linked to your login.')}</b>
          <p style={{ margin: '4px 0 0' }}>{L('এইচআর বা হাব ম্যানেজারকে বলুন লগইনটি আপনার এমপ্লয়ি আইডির সাথে যুক্ত করে দিতে।', 'Ask HR or your hub manager to link this login to your employee ID.')}</p></div>
        : me.loading && !e ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>
        : tab === 'given' ? e && <BroughtPicker me={e} />
        : <div className="wf-embed">{e && <InHand me={e} onBack={() => nav('/app/staff')} onChanged={() => undefined} />}</div>}
    </div>
  </AppShell>
}
