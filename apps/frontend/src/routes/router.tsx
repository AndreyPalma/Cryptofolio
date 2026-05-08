/**
 * router.tsx — createBrowserRouter config + ProtectedRoute.
 *
 * Route structure:
 *   /login                             → LoginPage (public)
 *   /                                  → ProtectedRoute → DashboardPage (protected)
 *   /token/:contractAddress/:network   → ProtectedRoute → TokenDetailPage (protected)
 *   /token/:contractAddress/:network/history → ProtectedRoute → PositionHistoryPage (protected)
 *
 * AuthProvider MUST wrap RouterProvider in App.tsx.
 */
import { createBrowserRouter, Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import { LoginPage } from "../pages/LoginPage";
import { DashboardPage } from "../pages/DashboardPage";
import { TokenDetailPage } from "../pages/TokenDetailPage";
import { PositionHistoryPage } from "../pages/PositionHistoryPage";
import { AddTransactionPage } from "../pages/AddTransactionPage";

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
  {
    path: "/token/:contractAddress/:network",
    element: (
      <ProtectedRoute>
        <TokenDetailPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "/token/:contractAddress/:network/history",
    element: (
      <ProtectedRoute>
        <PositionHistoryPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "/transactions/new",
    element: (
      <ProtectedRoute>
        <AddTransactionPage />
      </ProtectedRoute>
    ),
  },
]);
