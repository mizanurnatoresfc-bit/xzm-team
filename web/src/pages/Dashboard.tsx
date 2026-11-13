import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { usePrefs } from '../lib/prefs'

const CARDS: Array<[to: string, icon: string, bn: string, en: string, dbn: string, den: string, perms: string[] | null]> = [
  ['/app/org', 'map', 'জোন, হাব ও পদ', 'Zones, hubs & posts', 'প্রতিষ্ঠান, জোন, হাব, বিভাগ ও পদবি', 'Organisation, zones, hubs, departments, positions', ['org.zone.view', 'org.hub.view']],
  ['/app/hr', 'chart', 'HR ড্যাশবোর্ড', 'HR dashboard', 'কর্মী, যোগদান, অপেক্ষমাণ কাজ', 'Staff, joining, pending work', ['hr.employee.view']],
  ['/app/hr/employees', 'users', 'কর্মী', 'Employees', 'তালিকা, প্রোফাইল, নতুন আইডি আবেদন', 'List, profiles, new ID application', ['hr.employee.view', 'hr.application.create']],
  ['/app/hr/applications', 'form', 'আইডি আবেদন', 'ID applications', 'যাচাই করে এমপ্লয়ি আইডি দিন', 'Review and give Employee IDs', ['hr.application.view']],
  ['/app/hr/attendance', 'cal', 'হাজিরা', 'Attendance', 'দৈনিক হাজিরা ও মাসিক হিসাব', 'Daily marking and monthly summary', ['hr.attendance.view', 'hr.attendance.create']],
  ['/app/hr/leave', 'log', 'ছুটি', 'Leave', 'অনুরোধ ও অনুমোদন', 'Requests and approval', ['hr.leave.view', 'hr.leave.create']],
  ['/app/accounts/daily', 'ledger', 'আজকের হিসাব খাতা', 'Daily accounts', 'হাবের দৈনিক হিসাব', 'Hub daily sheets', null],
  ['/app/accounts/mine', 'wallet', 'আমার হিসাব', 'My accounts', 'নিজের লাইন ও খরচ', 'Your own lines and expenses', null],
]

export function Dashboard() {
  const { session, grants, can } = useAuth()
  const { L } = usePrefs()
  const name = session?.user.user_metadata?.full_name || session?.user.email || L('ব্যবহারকারী', 'User')
  const cards = CARDS.filter(c => !c[6] || c[6].some(p => can(p)))
  return <AppShell title={`${L('স্বাগতম', 'Welcome')}, ${name}`} subtitle={L('আপনার অনুমতি অনুযায়ী যে কাজগুলো করতে পারেন', 'What you can do with your permissions')}>
    {grants.length === 0 && <p className="notice">{L('আপনার অ্যাকাউন্টে এখনো কোনো রোল দেওয়া হয়নি। সিস্টেম অ্যাডমিনের সঙ্গে যোগাযোগ করুন।', 'No role has been given to your account yet. Contact your system administrator.')}</p>}
    <div className="da-cards">{cards.map(([to, ic, bn, en, dbn, den]) => <Link key={to} to={to} className="da-card" style={{ textDecoration: 'none', color: 'inherit' }}>
      <span className="ri"><Icon name={ic} /></span><strong>{L(bn, en)}</strong><span className="muted small">{L(dbn, den)}</span></Link>)}</div>
  </AppShell>
}
