import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import './App.css'
import 'react-toastify/dist/ReactToastify.css'
import './styles/toastify-overrides.css'
import './Components/common/dataTableTheme.css'
import { ThemeToastContainer } from './Components/ThemeToastContainer'
import Signin from './Components/Authentication/Signin/Signin'
import ForgotPassword from './Components/Authentication/ForgotPassword/ForgotPassword'
import ResetPassword from './Components/Authentication/ResetPassword/ResetPassword'
import InviteSetPassword from './Components/Authentication/InviteSetPassword/InviteSetPassword'
import { MainLayout } from './Components/Layout/MainLayout'
import { DashboardPage } from './Components/pages/Dashboard/DashboardPage'
import { UsersPage } from './Components/pages/Users/UsersPage'
import { JobsPage } from './Components/pages/Jobs/JobsPage'
import { RiskPage } from './Components/pages/Risk/RiskPage'
import { RiskDetailPage } from './Components/pages/Risk/RiskDetailPage'
import { ArticlesPage } from './Components/pages/Articles/ArticlesPage'
import { AdminPage } from './Components/pages/Admin/AdminPage'
import { ReviewPage } from './Components/pages/Review/ReviewPage'
import { SettingsPage } from './Components/pages/Settings/SettingsPage'
import { AccountPage } from './Components/pages/Account/AccountPage'
import { ObservabilityPage } from './Components/pages/Observability/ObservabilityPage'
import { ApiKeysPage } from './Components/pages/ApiKeys/ApiKeysPage'
import { RequireAuth } from './Components/RequireAuth'

const router = createBrowserRouter([
  { path: "/signin", element: <Signin /> },
  { path: "/forgotPassword", element: <ForgotPassword /> },
  { path: "/reset-password", element: <ResetPassword /> },
  { path: "/resetPassword", element: <ResetPassword /> },
  { path: "/invite/set-password", element: <InviteSetPassword /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <MainLayout />,
        children: [
          { path: "/dashboard", element: <DashboardPage /> },
          { path: "/jobs", element: <JobsPage /> },
          { path: "/risk", element: <RiskPage /> },
          { path: "/risk/:riskId", element: <RiskDetailPage /> },
          { path: "/articles", element: <ArticlesPage /> },
          { path: "/controls", element: <AdminPage /> },
          { path: "/observability", element: <ObservabilityPage /> },
          { path: "/review", element: <ReviewPage /> },
          { path: "/users", element: <UsersPage /> },
          { path: "/api-keys", element: <ApiKeysPage /> },
          { path: "/settings", element: <SettingsPage /> },
          { path: "/admin", element: <Navigate to="/controls" replace /> },
          { path: "/account", element: <AccountPage /> },
        ],
      },
    ],
  },
  { path: "/", element: <Navigate to="/signin" replace /> },
  { path: "*", element: <Navigate to="/signin" replace /> },
])

function App() {
  return (
    <>
      <ThemeToastContainer />
      <RouterProvider router={router} />
    </>
  )
}

export default App
