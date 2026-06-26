import { Navigate } from "react-router-dom";

/** Settings moved to Controls — keep route for bookmarks. */
export function SettingsPage() {
  return <Navigate to="/controls" replace />;
}
