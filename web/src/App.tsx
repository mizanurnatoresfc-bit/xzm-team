import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { DailyDashboard } from './pages/accounts/DailyDashboard'
import { DailySheet } from './pages/accounts/DailySheet'
import { MyAccounts } from './pages/accounts/MyAccounts'
import { AccountsReports } from './pages/accounts/AccountsReports'
import { AccountsSettings } from './pages/accounts/AccountsSettings'
import { OrgSetup } from './pages/org/OrgSetup'
import { HrDashboard } from './pages/hr/HrDashboard'
import { Employees } from './pages/hr/Employees'
import { EmployeeProfile } from './pages/hr/EmployeeProfile'
import { Applications } from './pages/hr/Applications'
import { Leave } from './pages/hr/Leave'
import { Attendance } from './pages/hr/Attendance'
import { ImportEmployees } from './pages/hr/ImportEmployees'
import { FieldSettings } from './pages/hr/FieldSettings'
import { Referrals } from './pages/hr/Referrals'
import { ZonalStaff } from './pages/zonal/ZonalStaff'
import { RoleDashboards } from './pages/users/RoleDashboards'
import { BrandingSettings } from './pages/users/BrandingSettings'
import { MyProfile } from './pages/MyProfile'
import { HubManagement } from './pages/hub/HubManagement'
import './styles.css'
import './accounts.css'
import './theme.css'
import { PrefsProvider } from './lib/prefs'
import { Home } from './pages/Home'
import { Terms } from './pages/Terms'
import { isNativeApp } from './lib/native'
import { Users } from './pages/users/Users'
import { UserDetail } from './pages/users/UserDetail'
import { RoleEditor, Roles } from './pages/users/Roles'
import { ChangePassword } from './pages/ChangePassword'

export default function App() {
  return <PrefsProvider><AuthProvider><BrowserRouter><Routes>
    <Route path="/staff/login" element={<Login />} />
    <Route element={<ProtectedRoute />}>
      <Route path="/app" element={<Dashboard />} />
      <Route path="/app/accounts/daily" element={<DailyDashboard />} />
      <Route path="/app/accounts/daily/:id" element={<DailySheet />} />
      <Route path="/app/accounts/mine" element={<MyAccounts />} />
      <Route path="/app/org" element={<OrgSetup />} />
      <Route path="/app/zonal/staff" element={<ZonalStaff />} />
      <Route path="/app/hub" element={<Navigate to="/app/hub/team" replace />} />
      <Route path="/app/hub/:section" element={<HubManagement />} />
      <Route path="/app/hr" element={<HrDashboard />} />
      <Route path="/app/hr/employees" element={<Employees />} />
      <Route path="/app/hr/employees/:id" element={<EmployeeProfile />} />
      <Route path="/app/hr/applications" element={<Applications />} />
      <Route path="/app/hr/attendance" element={<Attendance />} />
      <Route path="/app/hr/leave" element={<Leave />} />
      <Route path="/app/password" element={<ChangePassword />} />
      <Route path="/app/me" element={<MyProfile />} />
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
  </Routes></BrowserRouter></AuthProvider></PrefsProvider>
}
