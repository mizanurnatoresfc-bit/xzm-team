import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
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
import { PrefsProvider } from './lib/prefs'
import { Home } from './pages/Home'
import { Terms } from './pages/Terms'
import { advancedAccessHere, isNativeApp } from './lib/native'

// Pages load on first visit, so the first screen downloads only what it needs.
const FlowMockups = lazy(() => import('./pages/previews/FlowMockups'))
const StaffEntry = lazy(() => import('./pages/staff/StaffEntry'))
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
const StaffList = lazy(() => import('./pages/staff/StaffList').then(m => ({ default: m.StaffList })))
const EmployeeProfile = lazy(() => import('./pages/hr/EmployeeProfile').then(m => ({ default: m.EmployeeProfile })))
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
const RoleMenuMatrix = lazy(() => import('./pages/users/RoleMenuMatrix').then(m => ({ default: m.RoleMenuMatrix })))
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
const RouteModule = lazy(() => import('./pages/routes/RouteModule').then(m => ({ default: m.RouteModule })))
const StaffWorkProfilePage = lazy(() => import('./pages/zonal/StaffWorkProfile').then(m => ({ default: m.StaffWorkProfilePage })))
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
const HubRegisters = lazy(() => import('./pages/hub/HubRegisters').then(m => ({ default: m.HubRegisters })))
const AttendancePage = lazy(() => import('./pages/workforce/AttendancePage').then(m => ({ default: m.AttendancePage })))

// After the first screen is shown, quietly fetch the pages so later taps open at once (an app does not wait on each tap).
// The most-used ones come first; on a phone with "data saver" on, nothing is fetched ahead.
const FIRST = ['./pages/hub/HubManagement', './pages/workforce/AttendancePage', './pages/hr/Requests', './pages/workforce/MyWorkforce',
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
  ['./pages/staff/StaffList', () => import('./pages/staff/StaffList')],
  ['./pages/hr/EmployeeProfile', () => import('./pages/hr/EmployeeProfile')],
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
  ['./pages/users/RoleMenuMatrix', () => import('./pages/users/RoleMenuMatrix')],
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
  ['./pages/routes/RouteModule', () => import('./pages/routes/RouteModule')],
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
  ['./pages/workforce/AttendancePage', () => import('./pages/workforce/AttendancePage')],
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
/** An old attendance address (/app/workforce/hub, /zone, /attendance) -> the one attendance page, keeping the rest of the address (hub, date, give=today …). */
/** An old address that now lives on another page: go there and keep what was asked (…?tab=pending, ?id=…, #part), so a saved bookmark or notification still lands on the same thing. */
function RedirectKeep({ to }: { to: string }) {
  const { search, hash } = useLocation()
  return <Navigate to={`${to}${search}${hash}`} replace />
}
/** An old route address -> the route module, keeping what was asked (?zone= ?hub= ?route=) and opening the part the old page was. */
function RouteRedirect({ tab }: { tab?: string }) {
  const { search, hash } = useLocation()
  const q = new URLSearchParams(search)
  if (tab) q.set('tab', tab)
  const qs = q.toString()
  return <Navigate to={`/app/routes${qs ? `?${qs}` : ''}${hash}`} replace />
}
function LegacyAttendanceRedirect({ view }: { view: 'me' | 'hub' | 'zone' }) {
  const q = new URLSearchParams(useLocation().search)
  q.set('view', view)
  const tab = q.get('tab')
  const ok = view === 'hub' ? ['final', 'month', 'apps', 'ops'] : view === 'zone' ? ['final', 'ops', 'setting'] : []
  if (tab && !ok.includes(tab)) { if (view === 'hub' && tab === 'approve') q.set('tab', 'final'); else q.delete('tab') }
  return <Navigate to={`/app/attendance?${q.toString()}`} replace />
}

/** The home page: a staff member gets the staff panel, everyone else the dashboard. */
function HomeOrPanel() {
  const { grants, can } = useAuth()
  return grants.length > 0 && panelLevel(can) === 0 ? <StaffPanel /> : <Dashboard />
}

export default function App() {
  // Pull to refresh in the Android app (lib/nativeFeel.tsx): the page is mounted again, so it loads its data afresh.
  const [fresh, setFresh] = useState(0)
  useEffect(() => { const f = () => setFresh(k => k + 1); window.addEventListener('app:refresh', f); return () => window.removeEventListener('app:refresh', f) }, [])
  return <PrefsProvider><AuthProvider><BrowserRouter><Suspense fallback={<Loading />}><Routes key={fresh}>
    <Route path="/staff/login" element={<Login />} />
    <Route element={<ProtectedRoute />}>
      <Route path="/app" element={<HomeOrPanel />} />
      <Route path="/app/staff" element={<StaffPanel />} />
      <Route path="/app/staff/entry" element={<StaffEntry />} />
      <Route path="/app/preview/flow-mockups" element={<FlowMockups />} />
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
      <Route path="/app/zonal/staff" element={<RedirectKeep to="/app/staff/list" />} />
      <Route path="/app/zonal/hub-ops" element={<HubOps />} />
      <Route path="/app/zonal/hub-ops/hub/:hubId" element={<HubOpsPanel />} />
      <Route path="/app/zonal/files" element={<ZonalFiles />} />
      {/* Staff lifecycle: the hub manager asks, the zonal manager decides, every approval leaves a file */}
      <Route path="/app/manager/staff" element={<RedirectKeep to="/app/staff/list" />} />
      <Route path="/app/zonal/requests" element={<ZonalRequests />} />
      <Route path="/app/zonal/hr-records" element={<HrRecords />} />
      {/* Route module: all route work on one page. The four old route pages (zone map, hub routes, parcel plan, sorting routes) redirect to its parts. */}
      <Route path="/app/routes" element={<RouteModule />} />
      <Route path="/app/zonal/routes" element={<RouteRedirect />} />
      <Route path="/app/routes/plan" element={<RouteRedirect tab="plan" />} />
      <Route path="/app/hub/routes" element={<RouteRedirect tab="hub" />} />
      <Route path="/app/sorting/routes" element={<RouteRedirect tab="sorting" />} />
      <Route path="/app/zonal/profile" element={<StaffWorkProfilePage />} />
      <Route path="/app/manpower" element={<Manpower />} />
      <Route path="/app/hub" element={<LegacyAttendanceRedirect view="hub" />} />
      <Route path="/app/hub/team" element={<RedirectKeep to="/app/staff/list" />} />
      <Route path="/app/hub/attendance" element={<LegacyAttendanceRedirect view="hub" />} />
      <Route path="/app/hub/late" element={<LegacyAttendanceRedirect view="hub" />} />
      <Route path="/app/hub/days" element={<LegacyAttendanceRedirect view="hub" />} />
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
      <Route path="/app/hr" element={<RedirectKeep to="/app/staff/list" />} />
      <Route path="/app/hr/employees" element={<RedirectKeep to="/app/staff/list" />} />
      <Route path="/app/hr/employees/:id" element={<EmployeeProfile />} />
      <Route path="/app/hr/applications" element={<RedirectKeep to="/app/zonal/requests" />} />
      <Route path="/app/hr/attendance" element={<LegacyAttendanceRedirect view="hub" />} />
      <Route path="/app/hr/leave" element={<RedirectKeep to="/app/staff" />} />
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
      {/* হাজিরা খাতা: one page for staff, hub manager and zonal manager; what it shows follows the person's permissions.
          The old addresses (also inside saved notifications) lead here. */}
      <Route path="/app/hub-registers" element={<HubRegisters />} />
      <Route path="/app/attendance" element={<AttendancePage />} />
      <Route path="/app/workforce" element={<Navigate to="/app/attendance" replace />} />
      <Route path="/app/workforce/attendance" element={<LegacyAttendanceRedirect view="me" />} />
      <Route path="/app/workforce/hub" element={<LegacyAttendanceRedirect view="hub" />} />
      <Route path="/app/workforce/zone" element={<LegacyAttendanceRedirect view="zone" />} />
      {/* My Workforce: the two people lists (people I brought, people in my hand) */}
      <Route path="/app/workforce/:tab" element={<MyWorkforce />} />
      {/* What each of these needs is in lib/navAccess.ts (pagePermissions): the menus and these routes read the same table. */}
      <Route path="/app/users" element={<Users />} />
      <Route path="/app/users/:id" element={<UserDetail />} />
      <Route path="/app/hr/referrals" element={<Referrals />} />
      <Route path="/app/hr/import" element={<ImportEmployees />} />
      <Route path="/app/roles" element={<OldRolePage />} />
      <Route path="/app/roles/:id" element={<OldRolePage />} />
      <Route path="/app/access" element={<AccessPage><AccessCenter /></AccessPage>} />
      <Route path="/app/access/role/:id" element={<AccessPage><RoleBuilder /></AccessPage>} />
      <Route path="/app/access/user/:id" element={<AccessPage><UserAccess /></AccessPage>} />
      <Route path="/app/access/:section" element={<AccessPage><AccessCenter /></AccessPage>} />
      <Route path="/app/role-dashboards" element={<RoleDashboards />} />
      <Route path="/app/nodi/chat" element={<NodiChat />} />
      <Route path="/app/nodi" element={<NodiSettings />} />
      <Route path="/app/branding" element={<BrandingSettings />} />
      <Route path="/app/menu" element={<MenuEditor />} />
      <Route path="/app/menu-roles" element={<RoleMenuMatrix />} />
      <Route path="/app/accounts/reports" element={<AccountsReports />} />
      <Route path="/app/accounts/settings" element={<AccountsSettings />} />
      <Route path="/secure-control" element={<Dashboard />} />
    </Route>
    <Route path="/" element={isNativeApp() ? <Navigate to="/app" replace /> : <Home />} />
    <Route path="/terms" element={<Terms />} />
    {/* short addresses of the staff lifecycle pages */}
    <Route path="/manager/staff" element={<RedirectKeep to="/app/staff/list" />} />
    <Route path="/zonal/requests" element={<Navigate to="/app/zonal/requests" replace />} />
    <Route path="/zonal/hr-records" element={<Navigate to="/app/zonal/hr-records" replace />} />
    <Route path="*" element={<Navigate to="/staff/login" replace />} />
  </Routes></Suspense></BrowserRouter></AuthProvider></PrefsProvider>
}
