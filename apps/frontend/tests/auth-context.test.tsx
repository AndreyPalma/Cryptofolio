/**
 * Tests for AuthContext (AuthProvider + useAuth)
 * SC-CTX-01..05
 * Strict TDD — RED phase: all tests FAIL before implementation
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider, useAuth } from "../src/lib/auth-context";

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <AuthProvider>{children}</AuthProvider>
    </MemoryRouter>
  );
}

describe("AuthContext", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // SC-CTX-01: initial isAuthenticated is false
  it("SC-CTX-01: initial isAuthenticated is false", () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.isAuthenticated).toBe(false);
  });

  // SC-CTX-02: login() sets isAuthenticated = true
  it("SC-CTX-02: login() sets isAuthenticated to true", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.isAuthenticated).toBe(false);
    await act(async () => {
      result.current.login();
    });
    expect(result.current.isAuthenticated).toBe(true);
  });

  // SC-CTX-03: redirectToLogin() sets isAuthenticated = false and navigates to /login without network call
  it("SC-CTX-03: redirectToLogin() sets isAuthenticated=false and navigates without fetch", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const { result } = renderHook(() => useAuth(), { wrapper });

    // First authenticate
    await act(async () => {
      result.current.login();
    });
    expect(result.current.isAuthenticated).toBe(true);

    await act(async () => {
      result.current.redirectToLogin();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // SC-CTX-04: useAuth() outside AuthProvider throws
  it("SC-CTX-04: useAuth() outside AuthProvider throws", () => {
    // Suppress React's console.error for this test
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => {
      renderHook(() => useAuth());
    }).toThrow("useAuth must be used within an AuthProvider");
    consoleSpy.mockRestore();
  });

  // SC-CTX-05: logout() calls POST /api/auth/logout with credentials: include, sets isAuthenticated=false
  it("SC-CTX-05: logout() calls POST /api/auth/logout and sets isAuthenticated=false", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      result.current.login();
    });
    expect(result.current.isAuthenticated).toBe(true);

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0]!;
    expect(url).toMatch(/\/api\/auth\/logout/);
    expect((options as RequestInit).method?.toUpperCase()).toBe("POST");
    expect((options as RequestInit).credentials).toBe("include");
  });
});
