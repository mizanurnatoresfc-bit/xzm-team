import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import './styles.css'
import './accounts.css'
import './theme.css'
import { PrefsProvider } from './lib/prefs'
import { Home } from './pages/Home'
import { Terms } from './pages/Terms'
import { isNativeApp } from './lib/native'

// Pages load on first visit, so the first screen downloads only what it needs.
const DailyDashboard = lazy(() => import('./pages/accounts/DailyDashboard').then(m => ({ default: m.DailyDashboard })))
const MainSheet = lazy(() => import('./pages/accounts/sheetFlow').then(m => ({ default: m.MainSheet })))
const MyKhata = lazy(() => import('./pages/accounts/MyKhata').then(m => ({ default: m.MyKhata })))
const DailySheet = lazy(() => import('./pages/accounts/DailySheet').then(m => ({ default: m.DailySheet })))
const MyAccounts = lazy(() => import('./pages/accounts/MyAccounts').then(m => ({ default: m.MyAccounts })))
const AccountsReports = lazy(() => import('./pages/accounts/AccountsReports').then(m => ({ default: m.AccountsReports })))
const AccountsSettings = lazy(() => import('./pages/accounts/AccountsSettings').then(m => ({ default: m.AccountsSettings })))
const OrgSetup = lazy(() => import('./pages/org/OrgSetup').then(m => ({ default: m.OrgSetup })))
const Hubs = lazy(() => import('./pages/org/Hubs').then(m => ({ default: m.Hubs })))
const HrDashboard = lazy(() => import('./pages/hr/HrDashboard').then(m => ({ default: m.HrDashboard })))
const Employees = lazy(() => import('./pages/hr/Employees').then(m => ({ default: m.Employees })))
const EmployeeProfile = lazy(() => import('./pages/hr/EmployeeProfile').then(m => ({ default: m.EmployeeProfile })))
const Applications = lazy(() => import('./pages/hr/Applications').then(m => ({ default: m.Applications })))
const Leave = lazy(() => import('./pages/hr/Leave').then(m => ({ default: m.Leave })))
const Attendance = lazy(() => import('./pages/hr/Attendance').then(m => ({ default: m.Attendance })))
const ImportEmployees = lazy(() => import('./pages/hr/ImportEmployees').then(m => ({ default: m.ImportEmployees })))
const FieldSettings = lazy(() => import('./pages/hr/FieldSettings').then(m => ({ default: m.FieldSettings })))
const Referrals = lazy(() => import('./pages/hr/Referrals').then(m => ({ default: m.Referrals })))
const ZonalDashboard = lazy(() => import('./pages/zonal/ZonalDashboard').then(m => ({ default: m.ZonalDashboard })))
const ZonalFiles = lazy(() => import('./pages/zonal/ZonalFiles').then(m => ({ default: m.ZonalFiles })))
const Manpower = lazy(() => import('./pages/Manpower').then(m => ({ default: m.Manpower })))
const ZonalStaff = lazy(() => import('./pages/zonal/ZonalStaff').then(m => ({ default: m.ZonalStaff })))
const RoleDashboards = lazy(() => import('./pages/users/RoleDashboards').then(m => ({ default: m.RoleDashboards })))
const NodiChat = lazy(() => import('./pages/nodi/NodiChat').then(m => ({ default: m.NodiChat })))
const NodiSettings = lazy(() => import('./pages/users/NodiSettings').then(m => ({ default: m.NodiSettings })))
const BrandingSettings = lazy(() => import('./pages/users/BrandingSettings').then(m => ({ default: m.BrandingSettings })))
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
const ZonalAssistant = lazy(() => import('./pages/zonal/ZonalAssistant').then(m => ({ default: m.ZonalAssistant })))
const Training = lazy(() => import('./pages/Training').then(m => ({ default: m.Training })))
const Rollout = lazy(() => import('./pages/users/Rollout').then(m => ({ default: m.Rollout })))
const UserDetail = lazy(() => import('./pages/users/UserDetail').then(m => ({ default: m.UserDetail })))
const RoleEditor = lazy(() => import('./pages/users/Roles').then(m => ({ default: m.RoleEditor })))
const Roles = lazy(() => import('./pages/users/Roles').then(m => ({ default: m.Roles })))
const StaffPanel = lazy(() => import('./pages/staff/StaffPanel').then(m => ({ default: m.StaffPanel })))
const ChangePassword = lazy(() => import('./pages/ChangePassword').then(m => ({ default: m.ChangePassword })))

// After the first screen is shown, quietly fetch the most-used pages so later taps open at once.
const WARM: Array<() => Promise<unknown>> = [
  () => import('./pages/hub/HubManagement'), () => import('./pages/org/Hubs'), () => import('./pages/hr/Employees'),
  () => import('./pages/hr/Attendance'), () => import('./pages/hr/Requests'), () => import('./pages/accounts/DailyDashboard'), () => import('./pages/accounts/DailySheet'),
  () => import('./pages/MyProfile'), () => import('./pages/zonal/ZonalStaff'), () => import('./pages/hr/EmployeeProfile'),
  () => import('./pages/org/OrgSetup'), () => import('./pages/sorting/Sorting'), () => import('./pages/office/Office'),
]
if (typeof window !== 'undefined' && location.pathname.startsWith('/app')
  && !(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) {
  const go = () => { WARM.reduce<Promise<unknown>>((p, f) => p.then(() => f().catch(() => null)), Promise.resolve()) }
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
  const start = () => (w.requestIdleCallback ? w.requestIdleCallback(go, { timeout: 4000 }) : window.setTimeout(go, 2500))
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start, { once: true })
}

const Loading = () => <div className="page-loading" role="status"><span className="spin" />লোড হচ্ছে…</div>

export default function App() {
  return <PrefsProvider><AuthProvider><BrowserRouter><Suspense fallback={<Loading />}><Routes>
    <Route path="/staff/login" element={<Login />} />
    <Route element={<ProtectedRoute />}>
      <Route path="/app" element={<Dashboard />} />
      <Route path="/app/staff" element={<StaffPanel />} />
      <Route path="/app/accounts/khata" element={<MyKhata />} />
      <Route path="/app/accounts/daily" element={<DailyDashboard />} />
      <Route path="/app/accounts/daily/:id" element={<DailySheet />} />
      <Route path="/app/accounts/daily/:id/main" element={<MainSheet />} />
      <Route path="/app/accounts/mine" element={<MyAccounts />} />
      <Route path="/app/org" element={<OrgSetup />} />
      <Route path="/app/org/hubs" element={<Hubs />} />
      <Route path="/app/zonal" element={<ZonalDashboard />} />
      <Route path="/app/zonal/staff" element={<ZonalStaff />} />
      <Route path="/app/zonal/files" element={<ZonalFiles />} />
      <Route path="/app/manpower" element={<Manpower />} />
      <Route path="/app/hub" element={<Navigate to="/app/hub/team" replace />} />
      <Route path="/app/hub/:section" element={<HubManagement />} />
      <Route path="/app/sorting" element={<Navigate to="/app/sorting/dashboard" replace />} />
      <Route path="/app/sorting/:section" element={<Sorting />} />
      <Route path="/app/hr/requests" element={<Requests />} />
      <Route path="/app/hr/duties" element={<Duties />} />
      <Route path="/app/hr/profile-gaps" element={<ProfileGaps />} />
      <Route path="/app/office" element={<Navigate to="/app/office/overview" replace />} />
      <Route path="/app/office/:section" element={<Office />} />
      <Route path="/app/issues" element={<Issues />} />
      {/* the vehicle pages were taken off the website (owner, 16 Nov); old links go home */}
      <Route path="/app/vehicles/*" element={<Navigate to="/app" replace />} />
      <Route path="/app/hr" element={<HrDashboard />} />
      <Route path="/app/hr/employees" element={<Employees />} />
      <Route path="/app/hr/employees/:id" element={<EmployeeProfile />} />
      <Route path="/app/hr/applications" element={<Applications />} />
      <Route path="/app/hr/attendance" element={<Attendance />} />
      <Route path="/app/hr/leave" element={<Leave />} />
      <Route path="/app/password" element={<ChangePassword />} />
      <Route path="/app/me" element={<MyProfile />} />
      <Route path="/app/me/permissions" element={<MyPermissions />} />
      <Route path="/app/settings" element={<Settings />} />
      <Route path="/app/rollout" element={<Rollout />} />
      <Route path="/app/training" element={<Training />} />
      <Route path="/app/zonal/assistant" element={<ZonalAssistant />} />
      <Route path="/app/hr/fields" element={<FieldSettings />} />
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
      <Route path="/app/roles" element={<Roles />} />
      <Route path="/app/roles/:id" element={<RoleEditor />} />
      <Route path="/app/role-dashboards" element={<RoleDashboards />} />
      <Route path="/app/nodi/chat" element={<NodiChat />} />
      <Route path="/app/nodi" element={<NodiSettings />} />
      <Route path="/app/branding" element={<BrandingSettings />} />
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
    <Route path="*" element={<Navigate to="/staff/login" replace />} />
  </Routes></Suspense></BrowserRouter></AuthProvider></PrefsProvider>
}
