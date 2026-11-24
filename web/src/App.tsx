import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { ProtectedRoute } from './components/ProtectedRoute'
import { panelLevel } from './lib/menu'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import './styles.css'
import './accounts.css'
import './theme.css'
import './fields.css'
import './home-md3.css'
import './a11y.css'
import './app-feel.css'
import './nav-pro.css'
import './foundation.css'
import { PrefsProvider, usePrefs } from './lib/prefs'
import { supabase } from './lib/supabase'
import { Home } from './pages/Home'
import { Terms } from './pages/Terms'
import { advancedAccessHere, isNativeApp } from './lib/native'

// Pages load on first visit, so the first screen downloads only what it needs.
const DailyDashboard = lazy(() => import('./pages/accounts/DailyDashboard').then(m => ({ default: m.DailyDashboard })))
const MainSheet = lazy(() => import('./pages/accounts/sheetFlow').then(m => ({ default: m.MainSheet })))
const AccountsCenter = lazy(() => import('./pages/accounts/AccountsCenter').then(m => ({ default: m.AccountsCenter })))
const LearnCenter = lazy(() => import('./pages/accounts/LearnCenter').then(m => ({ default: m.LearnCenter })))
const MyKhata = lazy(() => import('./pages/accounts/MyKhata').then(m => ({ default: m.MyKhata })))
const DailySheet = lazy(() => import('./pages/accounts/DailySheet').then(m => ({ default: m.DailySheet })))
const MyAccounts = lazy(() => import('./pages/accounts/MyAccounts').then(m => ({ default: m.MyAccounts })))
const ReportImport = lazy(() => import('./pages/accounts/ReportImport').then(m => ({ default: m.ReportImport })))
const AccountsReports = lazy(() => import('./pages/accounts/AccountsReports').then(m => ({ default: m.AccountsReports })))
const AccountsSettings = lazy(() => import('./pages/accounts/AccountsSettings').then(m => ({ default: m.AccountsSettings })))
const OrgSetup = lazy(() => import('./pages/org/OrgSetup').then(m => ({ default: m.OrgSetup })))
const Hubs = lazy(() => import('./pages/org/Hubs').then(m => ({ default: m.Hubs })))
const HrDashboard = lazy(() => import('./pages/hr/HrDashboard').then(m => ({ default: m.HrDashboard })))
const StaffList = lazy(() => import('./pages/staff/StaffList').then(m => ({ default: m.StaffList })))
const EmployeeProfile = lazy(() => import('./pages/hr/EmployeeProfile').then(m => ({ default: m.EmployeeProfile })))
const Applications = lazy(() => import('./pages/hr/Applications').then(m => ({ default: m.Applications })))
const Leave = lazy(() => import('./pages/hr/Leave').then(m => ({ default: m.Leave })))
const ImportEmployees = lazy(() => import('./pages/hr/ImportEmployees').then(m => ({ default: m.ImportEmployees })))
const FieldSettings = lazy(() => import('./pages/hr/FieldSettings').then(m => ({ default: m.FieldSettings })))
const Referrals = lazy(() => import('./pages/hr/Referrals').then(m => ({ default: m.Referrals })))
const ZonalDashboard = lazy(() => import('./pages/zonal/ZonalDashboard').then(m => ({ default: m.ZonalDashboard })))
const ZonalFiles = lazy(() => import('./pages/zonal/ZonalFiles').then(m => ({ default: m.ZonalFiles })))
const Manpower = lazy(() => import('./pages/Manpower').then(m => ({ default: m.Manpower })))
const HubOps = lazy(() => import('./pages/zonal/HubOps').then(m => ({ default: m.HubOps })))
const HubOpsPanel = lazy(() => import('./pages/zonal/HubOpsPanel').then(m => ({ default: m.HubOpsPanel })))
const ZonalRequests = lazy(() => import('./pages/zonal/ZonalRequests').then(m => ({ default: m.ZonalRequests })))
const HrRecords = lazy(() => import('./pages/zonal/HrRecords').then(m => ({ default: m.HrRecords })))
const RoleDashboards = lazy(() => import('./pages/users/RoleDashboards').then(m => ({ default: m.RoleDashboards })))
const NodiChat = lazy(() => import('./pages/nodi/NodiChat').then(m => ({ default: m.NodiChat })))
const NodiSettings = lazy(() => import('./pages/users/NodiSettings').then(m => ({ default: m.NodiSettings })))
const BrandingSettings = lazy(() => import('./pages/users/BrandingSettings').then(m => ({ default: m.BrandingSettings })))
const MenuEditor = lazy(() => import('./pages/users/MenuEditor').then(m => ({ default: m.MenuEditor })))
const MyProfileComplete = lazy(() => import('./pages/MyProfileComplete').then(m => ({ default: m.MyProfileComplete })))
const MyProfile = lazy(() => import('./pages/MyProfile').then(m => ({ default: m.MyProfile })))
const HubManagement = lazy(() => import('./pages/hub/HubManagement').then(m => ({ default: m.HubManagement })))
const MyPermissions = lazy(() => import('./pages/MyPermissions').then(m => ({ default: m.MyPermissions })))
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })))
const Sorting = lazy(() => import('./pages/sorting/Sorting').then(m => ({ default: m.Sorting })))
const Requests = lazy(() => import('./pages/hr/Requests').then(m => ({ default: m.Requests })))
const Duties = lazy(() => import('./pages/hr/Duties').then(m => ({ default: m.Duties })))
const ProfileGaps = lazy(() => import('./pages/hr/ProfileGaps').then(m => ({ default: m.ProfileGaps })))
const Office = lazy(() => import('./pages/office/Office').then(m => ({ default: m.Office })))
const Issues = lazy(() => import('./pages/issues/Issues').then(m => ({ default: m.Issues })))
const Users = lazy(() => import('./pages/users/Users').then(m => ({ default: m.Users })))
const RouteSettings = lazy(() => import('./pages/zonal/RouteSettings').then(m => ({ default: m.RouteSettings })))
const RoutePlanPage = lazy(() => import('./pages/zonal/RouteSettings').then(m => ({ default: m.RoutePlanPage })))
const ZonalAssistant = lazy(() => import('./pages/zonal/ZonalAssistant').then(m => ({ default: m.ZonalAssistant })))
const Training = lazy(() => import('./pages/Training').then(m => ({ default: m.Training })))
const Rollout = lazy(() => import('./pages/users/Rollout').then(m => ({ default: m.Rollout })))
const UserDetail = lazy(() => import('./pages/users/UserDetail').then(m => ({ default: m.UserDetail })))
const RoleEditor = lazy(() => import('./pages/users/Roles').then(m => ({ default: m.RoleEditor })))
const Roles = lazy(() => import('./pages/users/Roles').then(m => ({ default: m.Roles })))
const AccessCenter = lazy(() => import('./pages/access/AccessCenter').then(m => ({ default: m.AccessCenter })))
const RoleBuilder = lazy(() => import('./pages/access/RoleBuilder').then(m => ({ default: m.RoleBuilder })))
const UserAccess = lazy(() => import('./pages/access/UserAccess').then(m => ({ default: m.UserAccess })))
const Fleet = lazy(() => import('./pages/fleet/Fleet').then(m => ({ default: m.Fleet })))
const FleetMine = lazy(() => import('./pages/fleet/FleetMine').then(m => ({ default: m.FleetMine })))
const StaffPanel = lazy(() => import('./pages/staff/StaffPanel').then(m => ({ default: m.StaffPanel })))
const NoticeBoard = lazy(() => import('./pages/NoticeBoard').then(m => ({ default: m.NoticeBoard })))
const References = lazy(() => import('./pages/References').then(m => ({ default: m.References })))
const Notifications = lazy(() => import('./pages/Notifications').then(m => ({ default: m.Notifications })))
const ChangePassword = lazy(() => import('./pages/ChangePassword').then(m => ({ default: m.ChangePassword })))
const MyWorkforce = lazy(() => import('./pages/workforce/MyWorkforce').then(m => ({ default: m.MyWorkforce })))
const WorkforceHub = lazy(() => import('./pages/workforce/WorkforceHub').then(m => ({ default: m.WorkforceHub })))
const WorkforceZone = lazy(() => import('./pages/workforce/WorkforceZone').then(m => ({ default: m.WorkforceZone })))

// After the first screen is shown, quietly fetch the pages so later taps open at once (an app does not wait on each tap).
// The most-used ones come first; on a phone with "data saver" on, nothing is fetched ahead.
const FIRST = ['./pages/hub/HubManagement', './pages/workforce/WorkforceHub', './pages/hr/Requests', './pages/workforce/MyWorkforce',
  './pages/staff/StaffList', './pages/accounts/DailyDashboard', './pages/accounts/DailySheet', './pages/MyProfile']
const ALL: Array<[string, () => Promise<unknown>]> = [
  ['./pages/accounts/DailyDashboard', () => import('./pages/accounts/DailyDashboard')],
  ['./pages/accounts/sheetFlow', () => import('./pages/accounts/sheetFlow')],
  ['./pages/accounts/AccountsCenter', () => import('./pages/accounts/AccountsCenter')],
  ['./pages/accounts/LearnCenter', () => import('./pages/accounts/LearnCenter')],
  ['./pages/accounts/MyKhata', () => import('./pages/accounts/MyKhata')],
  ['./pages/accounts/DailySheet', () => import('./pages/accounts/DailySheet')],
  ['./pages/accounts/MyAccounts', () => import('./pages/accounts/MyAccounts')],
  ['./pages/accounts/ReportImport', () => import('./pages/accounts/ReportImport')],
  ['./pages/accounts/AccountsReports', () => import('./pages/accounts/AccountsReports')],
  ['./pages/accounts/AccountsSettings', () => import('./pages/accounts/AccountsSettings')],
  ['./pages/org/OrgSetup', () => import('./pages/org/OrgSetup')],
  ['./pages/org/Hubs', () => import('./pages/org/Hubs')],
  ['./pages/hr/HrDashboard', () => import('./pages/hr/HrDashboard')],
  ['./pages/staff/StaffList', () => import('./pages/staff/StaffList')],
  ['./pages/hr/EmployeeProfile', () => import('./pages/hr/EmployeeProfile')],
  ['./pages/hr/Applications', () => import('./pages/hr/Applications')],
  ['./pages/hr/Leave', () => import('./pages/hr/Leave')],
  ['./pages/hr/ImportEmployees', () => import('./pages/hr/ImportEmployees')],
  ['./pages/hr/FieldSettings', () => import('./pages/hr/FieldSettings')],
  ['./pages/hr/Referrals', () => import('./pages/hr/Referrals')],
  ['./pages/zonal/ZonalDashboard', () => import('./pages/zonal/ZonalDashboard')],
  ['./pages/zonal/ZonalFiles', () => import('./pages/zonal/ZonalFiles')],
  ['./pages/Manpower', () => import('./pages/Manpower')],
  ['./pages/zonal/HubOps', () => import('./pages/zonal/HubOps')],
  ['./pages/zonal/HubOpsPanel', () => import('./pages/zonal/HubOpsPanel')],
  ['./pages/zonal/ZonalRequests', () => import('./pages/zonal/ZonalRequests')],
  ['./pages/zonal/HrRecords', () => import('./pages/zonal/HrRecords')],
  ['./pages/users/RoleDashboards', () => import('./pages/users/RoleDashboards')],
  ['./pages/nodi/NodiChat', () => import('./pages/nodi/NodiChat')],
  ['./pages/users/NodiSettings', () => import('./pages/users/NodiSettings')],
  ['./pages/users/BrandingSettings', () => import('./pages/users/BrandingSettings')],
  ['./pages/users/MenuEditor', () => import('./pages/users/MenuEditor')],
  ['./pages/MyProfileComplete', () => import('./pages/MyProfileComplete')],
  ['./pages/MyProfile', () => import('./pages/MyProfile')],
  ['./pages/hub/HubManagement', () => import('./pages/hub/HubManagement')],
  ['./pages/MyPermissions', () => import('./pages/MyPermissions')],
  ['./pages/Settings', () => import('./pages/Settings')],
  ['./pages/sorting/Sorting', () => import('./pages/sorting/Sorting')],
  ['./pages/hr/Requests', () => import('./pages/hr/Requests')],
  ['./pages/hr/Duties', () => import('./pages/hr/Duties')],
  ['./pages/hr/ProfileGaps', () => import('./pages/hr/ProfileGaps')],
  ['./pages/office/Office', () => import('./pages/office/Office')],
  ['./pages/issues/Issues', () => import('./pages/issues/Issues')],
  ['./pages/users/Users', () => import('./pages/users/Users')],
  ['./pages/zonal/RouteSettings', () => import('./pages/zonal/RouteSettings')],
  ['./pages/zonal/RoutePlan', () => import('./pages/zonal/RoutePlan')],
  ['./pages/zonal/ZonalAssistant', () => import('./pages/zonal/ZonalAssistant')],
  ['./pages/Training', () => import('./pages/Training')],
  ['./pages/users/Rollout', () => import('./pages/users/Rollout')],
  ['./pages/users/UserDetail', () => import('./pages/users/UserDetail')],
  ['./pages/users/Roles', () => import('./pages/users/Roles')],
  ['./pages/access/AccessCenter', () => import('./pages/access/AccessCenter')],
  ['./pages/access/RoleBuilder', () => import('./pages/access/RoleBuilder')],
  ['./pages/access/UserAccess', () => import('./pages/access/UserAccess')],
  ['./pages/fleet/Fleet', () => import('./pages/fleet/Fleet')],
  ['./pages/fleet/FleetMine', () => import('./pages/fleet/FleetMine')],
  ['./pages/staff/StaffPanel', () => import('./pages/staff/StaffPanel')],
  ['./pages/NoticeBoard', () => import('./pages/NoticeBoard')],
  ['./pages/References', () => import('./pages/References')],
  ['./pages/Notifications', () => import('./pages/Notifications')],
  ['./pages/ChangePassword', () => import('./pages/ChangePassword')],
  ['./pages/workforce/MyWorkforce', () => import('./pages/workforce/MyWorkforce')],
  ['./pages/workforce/WorkforceHub', () => import('./pages/workforce/WorkforceHub')],
  ['./pages/workforce/WorkforceZone', () => import('./pages/workforce/WorkforceZone')],
]
const WARM = [...ALL.filter(([m]) => FIRST.includes(m)), ...ALL.filter(([m]) => !FIRST.includes(m))].map(([, f]) => f)
if (typeof window !== 'undefined' && location.pathname.startsWith('/app')
  && !(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) {
  const go = () => { WARM.reduce<Promise<unknown>>((p, f) => p.then(() => f().catch(() => null)), Promise.resolve()) }
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
  const start = () => (w.requestIdleCallback ? w.requestIdleCallback(go, { timeout: 4000 }) : window.setTimeout(go, 2500))
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start, { once: true })
}

/** While a page's code arrives: the outline of a page (bar, title, cards), like an app, not a line of text. */
const Loading = () => <div className="page-skel" role="status" aria-label="লোড হচ্ছে…">
  <div className="ps-bar" /><div className="ps-title" /><div className="ps-row"><div className="ps-card" /><div className="ps-card" /></div>
  <div className="ps-card tall" /><div className="ps-card" /><span className="sr-only">লোড হচ্ছে…</span></div>

/** Advanced role & permission pages: on the website; inside the Android app the older role page stays for now. */
function AccessPage({ children }: { children: ReactNode }) {
  return advancedAccessHere() ? <>{children}</> : <Navigate to="/app/roles" replace />
}
/** The older role page: where the advanced pages are shown, its addresses lead to them. */
function OldRolePage() {
  const { id } = useParams()
  if (!advancedAccessHere()) return id ? <RoleEditor /> : <Roles />
  return <Navigate to={id ? `/app/access/role/${id}` : '/app/access/roles'} replace />
}
/** A page open to anyone who holds at least one of the permissions (ProtectedRoute takes a single one). The database re-checks every call. */
function AnyOf({ perms }: { perms: string[] }) {
  const { can } = useAuth()
  return perms.some(can) ? <Outlet /> : <main className="center-screen">
    <section className="notice"><h1>অনুমতি নেই</h1><p>এই পেজ ব্যবহারের প্রয়োজনীয় অনুমতি আপনার অ্যাকাউন্টে নেই।</p></section></main>
}

/** The home page: a staff member gets the staff panel, everyone else the dashboard. */
function HomeOrPanel() {
  const { grants, can } = useAuth()
  return grants.length > 0 && panelLevel(can) === 0 ? <StaffPanel /> : <Dashboard />
}

// This opt-in build is for isolated Release 01 review. Existing builds keep their current entry.
const foundationPreview = import.meta.env.VITE_RELEASE_01_PREVIEW === 'true'

function SuperAdminFoundation() {
  const { grantsReady, hasGlobalSuperGrant, loading, mustChangePassword, session, signOut } = useAuth()
  const { L } = usePrefs()
  const [leaving, setLeaving] = useState(false)

  if (loading) return <Loading />
  if (!session) return <Login afterSignIn="/" />
  if (!grantsReady) return <Loading />
  if (mustChangePassword) return <Navigate to="/app/password" replace />

  // If the network call fails the person must still end up signed out on this device (shared phones), so fall back to a local sign out.
  async function leave() {
    setLeaving(true)
    try { await signOut() } catch { await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined) }
    setLeaving(false)
  }

  return <main className="fd-screen">
    <section className="fd-card" aria-labelledby="foundation-title" role={hasGlobalSuperGrant ? undefined : 'alert'}>
      {hasGlobalSuperGrant ? <>
        <p className="fd-tag">{L('রিলিজ ০১ · ফাউন্ডেশন প্রিভিউ', 'Release 01 · Foundation preview')}</p>
        <h1 id="foundation-title">{L('সুপার অ্যাডমিন কন্ট্রোল সেন্টার', 'Super Admin Control Center')}</h1>
        <p>{L('কর্মীদের জন্য কোনো মডিউল এখনো চালু হয়নি।', 'No staff modules are switched on yet.')}</p>
      </> : <>
        <h1 id="foundation-title" className="fd-deny">{L('প্রবেশের অনুমতি নেই', 'No permission to enter')}</h1>
        <p>{L('এই পাতাটি শুধু সুপার অ্যাডমিনের জন্য।', 'This page is for the Super Admin only.')}</p>
      </>}
      <button type="button" className="secondary" disabled={leaving} onClick={() => void leave()}>{leaving ? L('সাইন আউট হচ্ছে…', 'Signing out…') : L('সাইন আউট', 'Sign out')}</button>
    </section>
  </main>
}

function FoundationLoginRedirect() {
  const { search, hash } = useLocation()
  return <Navigate to={{ pathname: '/', search, hash }} replace />
}

export default function App() {
  // Pull to refresh in the Android app (lib/nativeFeel.tsx): the page is mounted again, so it loads its data afresh.
  const [fresh, setFresh] = useState(0)
  useEffect(() => { const f = () => setFresh(k => k + 1); window.addEventListener('app:refresh', f); return () => window.removeEventListener('app:refresh', f) }, [])
  return <PrefsProvider><AuthProvider><BrowserRouter><Suspense fallback={<Loading />}>{foundationPreview ? <Routes key={fresh}>
    <Route path="/" element={<SuperAdminFoundation />} />
    <Route path="/staff/login" element={<FoundationLoginRedirect />} />
    <Route path="/terms" element={<Terms />} />
    <Route element={<ProtectedRoute />}>
      <Route path="/app/password" element={<ChangePassword />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes> : <Routes key={fresh}>
    <Route path="/staff/login" element={<Login />} />
    <Route element={<ProtectedRoute />}>
      <Route path="/app" element={<HomeOrPanel />} />
      <Route path="/app/staff" element={<StaffPanel />} />
      <Route path="/app/accounts/khata" element={<MyKhata />} />
      <Route path="/app/accounts/center" element={<AccountsCenter />} />
      <Route path="/app/accounts/learn" element={<LearnCenter />} />
      <Route path="/app/accounts/daily" element={<DailyDashboard />} />
      <Route path="/app/accounts/daily/:id" element={<DailySheet />} />
      <Route path="/app/accounts/daily/:id/main" element={<MainSheet />} />
      <Route path="/app/accounts/mine" element={<MyAccounts />} />
      <Route path="/app/accounts/report-import" element={<ReportImport />} />
      <Route path="/app/org" element={<OrgSetup />} />
      <Route path="/app/org/hubs" element={<Hubs />} />
      <Route path="/app/zonal" element={<ZonalDashboard />} />
      <Route path="/app/staff/list" element={<StaffList />} />
      <Route path="/app/zonal/staff" element={<Navigate to="/app/staff/list" replace />} />
      <Route path="/app/zonal/hub-ops" element={<HubOps />} />
      <Route path="/app/zonal/hub-ops/hub/:hubId" element={<HubOpsPanel />} />
      <Route path="/app/zonal/files" element={<ZonalFiles />} />
      {/* Staff lifecycle: the hub manager asks, the zonal manager decides, every approval leaves a file */}
      <Route element={<AnyOf perms={['hr.request.create']} />}>
        <Route path="/app/manager/staff" element={<Navigate to="/app/staff/list" replace />} />
      </Route>
      <Route element={<AnyOf perms={['hr.request.approve']} />}>
        <Route path="/app/zonal/requests" element={<ZonalRequests />} />
        <Route path="/app/zonal/hr-records" element={<HrRecords />} />
      </Route>
      <Route element={<AnyOf perms={['ops.route_setting.view', 'ops.route_setting.edit']} />}>
        <Route path="/app/zonal/routes" element={<RouteSettings />} />
      </Route>
      <Route element={<AnyOf perms={['ops.route_plan.view']} />}>
        <Route path="/app/routes/plan" element={<RoutePlanPage />} />
      </Route>
      <Route path="/app/manpower" element={<Manpower />} />
      <Route path="/app/hub" element={<Navigate to="/app/workforce/hub" replace />} />
      <Route path="/app/hub/team" element={<Navigate to="/app/staff/list" replace />} />
      <Route path="/app/hub/attendance" element={<Navigate to="/app/workforce/hub" replace />} />
      <Route path="/app/hub/late" element={<Navigate to="/app/workforce/hub" replace />} />
      <Route path="/app/hub/:section" element={<HubManagement />} />
      <Route path="/app/sorting" element={<Navigate to="/app/sorting/dashboard" replace />} />
      <Route path="/app/sorting/:section" element={<Sorting />} />
      <Route path="/app/hr/requests" element={<Requests />} />
      <Route path="/app/hr/duties" element={<Duties />} />
      <Route path="/app/hr/profile-gaps" element={<ProfileGaps />} />
      <Route path="/app/office" element={<Navigate to="/app/office/overview" replace />} />
      <Route path="/app/office/:section" element={<Office />} />
      <Route path="/app/office/residential" element={<Navigate to="/app/office/residential/overview" replace />} />
      <Route path="/app/office/residential/:section" element={<Office key="residential" scope="residential" />} />
      <Route path="/app/issues" element={<Issues />} />
      <Route path="/app/fleet" element={<Fleet />} />
      <Route path="/app/fleet/mine" element={<FleetMine />} />
      {/* the old vehicle pages were replaced by /app/fleet (owner, 16 Nov) */}
      <Route path="/app/vehicles/mine" element={<Navigate to="/app/fleet/mine" replace />} />
      <Route path="/app/vehicles/*" element={<Navigate to="/app/fleet" replace />} />
      <Route path="/app/hr" element={<HrDashboard />} />
      <Route path="/app/hr/employees" element={<Navigate to="/app/staff/list" replace />} />
      <Route path="/app/hr/employees/:id" element={<EmployeeProfile />} />
      <Route path="/app/hr/applications" element={<Applications />} />
      <Route path="/app/hr/attendance" element={<Navigate to="/app/workforce/hub" replace />} />
      <Route path="/app/hr/leave" element={<Leave />} />
      <Route path="/app/password" element={<ChangePassword />} />
      <Route path="/app/notifications" element={<Notifications />} />
      <Route path="/app/notices" element={<NoticeBoard />} />
      <Route path="/app/references" element={<References />} />
      <Route path="/app/me" element={<MyProfile />} />
      <Route path="/app/me/complete" element={<MyProfileComplete />} />
      <Route path="/app/me/permissions" element={<MyPermissions />} />
      <Route path="/app/settings" element={<Settings />} />
      <Route path="/app/rollout" element={<Rollout />} />
      <Route path="/app/training" element={<Training />} />
      <Route path="/app/zonal/assistant" element={<ZonalAssistant />} />
      <Route path="/app/hr/fields" element={<FieldSettings />} />
      {/* My Workforce & Attendance: my own three pages, the hub book and the zone report ('hub' and 'zone' come before ':tab') */}
      <Route path="/app/workforce" element={<Navigate to="/app/workforce/attendance" replace />} />
      <Route element={<AnyOf perms={['hr.attendance.view', 'ops.staff_daily.view']} />}>
        <Route path="/app/workforce/hub" element={<WorkforceHub />} />
      </Route>
      <Route path="/app/workforce/:tab" element={<MyWorkforce />} />
    </Route>
    <Route element={<ProtectedRoute permission="zonal.dashboard.view" />}>
      <Route path="/app/workforce/zone" element={<WorkforceZone />} />
    </Route>
    <Route element={<ProtectedRoute permission="system.user.view" />}>
      <Route path="/app/users" element={<Users />} />
      <Route path="/app/users/:id" element={<UserDetail />} />
    </Route>
    <Route element={<ProtectedRoute permission="hr.referral.view" />}>
      <Route path="/app/hr/referrals" element={<Referrals />} />
    </Route>
    <Route element={<ProtectedRoute permission="hr.import.create" />}>
      <Route path="/app/hr/import" element={<ImportEmployees />} />
    </Route>
    <Route element={<ProtectedRoute permission="system.role.view" />}>
      <Route path="/app/roles" element={<OldRolePage />} />
      <Route path="/app/roles/:id" element={<OldRolePage />} />
      <Route path="/app/access" element={<AccessPage><AccessCenter /></AccessPage>} />
      <Route path="/app/access/role/:id" element={<AccessPage><RoleBuilder /></AccessPage>} />
      <Route path="/app/access/user/:id" element={<AccessPage><UserAccess /></AccessPage>} />
      <Route path="/app/access/:section" element={<AccessPage><AccessCenter /></AccessPage>} />
    </Route>
    <Route element={<ProtectedRoute permission="system.role.edit" />}>
      <Route path="/app/role-dashboards" element={<RoleDashboards />} />
    </Route>
    {/* Nodi AI and branding open by the same permission their menu links use (not the role-page permission). */}
    <Route element={<ProtectedRoute />}>
      <Route element={<AnyOf perms={['nodi.assistant.view', 'nodi.settings.configure']} />}>
        <Route path="/app/nodi/chat" element={<NodiChat />} />
      </Route>
    </Route>
    <Route element={<ProtectedRoute permission="nodi.settings.configure" />}>
      <Route path="/app/nodi" element={<NodiSettings />} />
    </Route>
    <Route element={<ProtectedRoute permission="system.settings.configure" />}>
      <Route path="/app/branding" element={<BrandingSettings />} />
      <Route path="/app/menu" element={<MenuEditor />} />
    </Route>
    <Route element={<ProtectedRoute permission="da.report.view" />}>
      <Route path="/app/accounts/reports" element={<AccountsReports />} />
    </Route>
    <Route element={<ProtectedRoute permission="da.settings.configure" />}>
      <Route path="/app/accounts/settings" element={<AccountsSettings />} />
    </Route>
    <Route element={<ProtectedRoute permission="system.admin_portal.view" />}>
      <Route path="/secure-control" element={<Dashboard />} />
    </Route>
    <Route path="/" element={isNativeApp() ? <Navigate to="/app" replace /> : <Home />} />
    <Route path="/terms" element={<Terms />} />
    {/* short addresses of the staff lifecycle pages */}
    <Route path="/manager/staff" element={<Navigate to="/app/staff/list" replace />} />
    <Route path="/zonal/requests" element={<Navigate to="/app/zonal/requests" replace />} />
    <Route path="/zonal/hr-records" element={<Navigate to="/app/zonal/hr-records" replace />} />
    <Route path="*" element={<Navigate to="/staff/login" replace />} />
  </Routes>}</Suspense></BrowserRouter></AuthProvider></PrefsProvider>
}
