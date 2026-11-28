import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { ATTENDANCE_HUB, ATTENDANCE_ZONE, linkAllowed } from '../../lib/navAccess'
import { usePrefs } from '../../lib/prefs'
import { ManagerPendingCard } from './ManagerPendingCard'
import { StaffPendingCard } from './StaffPendingCard'
import { MyHubRegisterMonth } from './MyHubRegisterMonth'
import { RegisterProgressStrip } from './RegisterProgressStrip'
import './hub-registers.css'

export function HubRegisters() {
  const { L } = usePrefs()
  const access = useAuth()
  const [showQueue, setShowQueue] = useState(false)
  const [showPending, setShowPending] = useState(false)
  const [showMonth, setShowMonth] = useState(false)
  const zone = ATTENDANCE_ZONE.some(access.can)
  const hub = ATTENDANCE_HUB.some(access.can)
  const canManage = access.can('ops.staff_daily.view')
  const operations = zone ? '/app/attendance?view=zone&tab=ops' :
    hub && access.can('ops.staff_daily.view') ? '/app/attendance?view=hub&tab=ops' : '/app/staff'
  const books = [
    {
      icon: 'truck', title: L('ডেলিভারি ও টাকা খাতা', 'Delivery and cash register'),
      links: [
        ['/app/accounts/mine', L('আমার ডেলিভারির হিসাব', 'My delivery accounts')],
        ['/app/accounts/daily', L('হাবের দৈনিক হিসাব', 'Hub daily accounts')],
      ],
    },
    {
      icon: 'box', title: L('পিকআপ ও মার্চেন্ট ফেরত খাতা', 'Pickup and merchant return register'),
      links: [[operations, L('পিকআপ ও ফেরতের এন্ট্রি', 'Pickup and return entries')]],
    },
    {
      icon: 'back', title: L('পেন্ডিং ও রিটার্ন খাতা', 'Pending and return register'),
      links: [[operations, L('ডেলিভারি রিটার্নের এন্ট্রি', 'Delivery return entries')]],
      pending: true,
    },
    {
      icon: 'table', title: L('হাজিরা খাতা', 'Attendance register'),
      links: [
        [zone ? '/app/attendance?view=zone&tab=final' : hub ? '/app/attendance?view=hub&tab=final' : '/app/attendance?view=me',
          zone || hub ? L('দিনের হাজিরা', 'Daily attendance') : L('আমার মাসিক হাজিরা', 'My monthly attendance')],
        ...(access.can('hr.attendance.view') ? [['/app/attendance?view=hub&tab=month', L('হাবের মাসিক হাজিরা', 'Monthly hub attendance')]] : []),
      ],
    },
    {
      icon: 'receipt', title: L('হাবের খরচের খাতা', 'Hub expense register'),
      links: [
        ['/app/accounts/center?tab=expenses', L('হাবের খরচ ও ভাউচার', 'Hub expenses and vouchers')],
        ['/app/accounts/mine?bill=1', L('নিজের খরচ জমা দিন', 'Submit my expense')],
      ],
    },
  ] as const

  return <AppShell title={L('হাবের খাতা', 'Hub registers')}>
    {canManage && <RegisterProgressStrip />}
    <div className="hub-register-grid">
      {books.map(book => {
        const links = book.links.filter(([to]) => linkAllowed(to, access))
        if (!links.length) return null
        return <section key={book.icon} className="panel hub-register-card">
          <h2><Icon name={book.icon} size={22} />{book.title}</h2>
          {'pending' in book && <>
            <button type="button" className="secondary" aria-expanded={showPending} onClick={() => setShowPending(value => !value)}>
              {L('আমার পেন্ডিং জমা', 'Submit my pending count')}
            </button>
            {showPending && <StaffPendingCard />}
            {access.can('ops.staff_daily.view') && <div>
              <button type="button" className="secondary" aria-expanded={showQueue} onClick={() => setShowQueue(value => !value)}>
                {L('হাবের পেন্ডিং যাচাই', 'Review hub pending counts')}
              </button>
              {showQueue && <ManagerPendingCard />}
            </div>}
          </>}
          {links.map(([to, label]) => <Link key={to} to={to} className="hub-register-link">{label}</Link>)}
        </section>
      })}
    </div>
    <div className="hub-register-month">
      <button type="button" className="secondary" aria-expanded={showMonth} onClick={() => setShowMonth(value => !value)}>
        {L('আমার মাসের কাজের হিসাব', 'My monthly work entries')}
      </button>
      {showMonth && <MyHubRegisterMonth />}
    </div>
  </AppShell>
}
