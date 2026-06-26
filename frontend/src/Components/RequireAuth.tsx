import { Navigate, Outlet, useLocation } from "react-router-dom";
import { NotificationsProvider } from "../notifications/NotificationsProvider";
import { useIdleLogout } from "../utils/useIdleLogout";

/**
 * Renders child routes only when an access token exists; otherwise redirects to sign-in.
 */
export function RequireAuth() {
  const token = sessionStorage.getItem("accessToken");
  const location = useLocation();
  const isAuthenticated = Boolean(token?.trim());

  useIdleLogout(isAuthenticated);

  if (!isAuthenticated) {
    return <Navigate to="/signin" state={{ from: location }} replace />;
  }

  return (
    <NotificationsProvider>
      <Outlet />
    </NotificationsProvider>
  );
}
