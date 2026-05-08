/**
 * App.tsx — root component.
 *
 * CRITICAL: AuthProvider MUST wrap RouterProvider.
 * Inverting the order breaks useNavigate in redirectToLogin
 * (it would run outside a Router context).
 */
import { RouterProvider } from "react-router-dom";
import { AuthProvider } from "./lib/auth-context";
import { ToastProvider } from "./lib/toast-context";
import { router } from "./routes/router";

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthProvider>
  );
}
