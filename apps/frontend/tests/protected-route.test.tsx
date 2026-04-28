/**
 * Tests for ProtectedRoute
 * SC-PROT-01..03
 */
import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "../src/lib/auth-context";
import { ProtectedRoute } from "../src/routes/router";

/**
 * A test helper that sets isAuthenticated=true synchronously via login()
 * inside an act() call before rendering ProtectedRoute.
 */
function AuthenticatedWrapper({ children }: { children: React.ReactNode }) {
  const { login, isAuthenticated } = useAuth();
  // Call login on first render (synchronous state update via React)
  React.useLayoutEffect(() => {
    login();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Only render children after authenticated so ProtectedRoute sees true
  if (!isAuthenticated) return null;
  return <>{children}</>;
}

describe("ProtectedRoute", () => {
  // SC-PROT-01: authenticated user → renders children
  it("SC-PROT-01: authenticated user renders children", async () => {
    await act(async () => {
      render(
        <MemoryRouter initialEntries={["/"]}>
          <AuthProvider>
            <AuthenticatedWrapper>
              <Routes>
                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <div>Protected Content</div>
                    </ProtectedRoute>
                  }
                />
                <Route path="/login" element={<div>Login Page</div>} />
              </Routes>
            </AuthenticatedWrapper>
          </AuthProvider>
        </MemoryRouter>,
      );
    });
    expect(screen.getByText("Protected Content")).toBeDefined();
    expect(screen.queryByText("Login Page")).toBeNull();
  });

  // SC-PROT-02: unauthenticated user → redirects to /login (NEGATIVE-FE-05)
  it("SC-PROT-02: unauthenticated user redirects to /login", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AuthProvider>
          <Routes>
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <div>Protected Content</div>
                </ProtectedRoute>
              }
            />
            <Route path="/login" element={<div>Login Page</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText("Login Page")).toBeDefined();
    expect(screen.queryByText("Protected Content")).toBeNull();
  });

  // SC-PROT-03: new AuthProvider mount → isAuthenticated=false → redirected to /login
  it("SC-PROT-03: fresh AuthProvider (page reload) redirects to /login", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AuthProvider>
          <Routes>
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <div>Protected Content</div>
                </ProtectedRoute>
              }
            />
            <Route path="/login" element={<div>Login Page</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText("Login Page")).toBeDefined();
    expect(screen.queryByText("Protected Content")).toBeNull();
  });
});
