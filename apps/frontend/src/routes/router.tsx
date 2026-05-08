/**
 * router.tsx — createBrowserRouter config + ProtectedRoute.
 *
 * Route structure:
 *   /login  → LoginPage (public)
 *   /       → ProtectedRoute → DashboardPage (protected)
 *
 * AuthProvider MUST wrap RouterProvider in App.tsx.
 */
import { createBrowserRouter, Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import { LoginPage } from "../pages/LoginPage";
import { DashboardPage } from "../pages/DashboardPage";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export const router = createBrowserRouter([
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    path: "/",
    element: (
      <ProtectedRoute>
        <DashboardPage />
      </ProtectedRoute>
    ),
  },
]);
