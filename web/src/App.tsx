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
import './styles.css'
import './accounts.css'
import './theme.css'
import { PrefsProvider } from './lib/prefs'
import { Home } from './pages/Home'
import { isNativeApp } from './lib/native'
import { Users } from './pages/users/Users'
import { UserDetail } from './pages/users/UserDetail'
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
      <Route path="/app/hr" element={<HrDashboard />} />
      <Route path="/app/hr/employees" element={<Employees />} />
      <Route path="/app/hr/employees/:id" element={<EmployeeProfile />} />
      <Route path="/app/hr/applications" element={<Applications />} />
      <Route path="/app/hr/attendance" element={<Attendance />} />
      <Route path="/app/hr/leave" element={<Leave />} />
      <Route path="/app/password" element={<ChangePassword />} />
    </Route>
    <Route element={<ProtectedRoute permission="system.user.view" />}>
      <Route path="/app/users" element={<Users />} />
      <Route path="/app/users/:id" element={<UserDetail />} />
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
    <Route path="*" element={<Navigate to="/staff/login" replace />} />
  </Routes></BrowserRouter></AuthProvider></PrefsProvider>
}
