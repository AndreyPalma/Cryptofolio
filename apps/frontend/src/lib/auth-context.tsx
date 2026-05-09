/**
 * AuthContext — authentication state and actions.
 *
 * AuthProvider MUST wrap RouterProvider in App.tsx so that
 * useNavigate() is available inside the Router context.
 *
 * Pattern: AuthBridge component (inside RouterProvider) calls
 * registerAuthBridge(redirectToLogin) so apiClient can trigger
 * redirections without coupling to React.
 */
import React, { createContext, useContext, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { registerAuthBridge } from "./api-client";

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: false; // reserved for future GET /api/auth/me
  login: () => void;
  logout: () => Promise<void>;
  redirectToLogin: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}

/**
 * AuthBridge — must be rendered INSIDE the router tree so useNavigate works.
 * It registers the redirectToLogin function with apiClient.
 * Render it in a root layout component inside RouterProvider.
 */
export function AuthBridge() {
  const navigate = useNavigate();
  const { redirectToLogin } = useAuth();

  React.useEffect(() => {
    const fn = () => {
      redirectToLogin();
      void navigate("/login", { replace: true });
    };
    registerAuthBridge(fn);
  }, [redirectToLogin, navigate]);

  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const login = useCallback(() => {
    setIsAuthenticated(true);
  }, []);

  const redirectToLogin = useCallback(() => {
    setIsAuthenticated(false);
    // Note: the actual navigation to /login is handled by AuthBridge
    // (which has access to useNavigate). When called from outside the
    // router context (e.g. from apiClient bridge), AuthBridge's registered
    // fn handles the navigate call.
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    setIsAuthenticated(false);
    // Navigation is done via the registered bridge or directly
  }, []);

  const value: AuthContextValue = {
    isAuthenticated,
    isLoading: false as const,
    login,
    logout,
    redirectToLogin,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
