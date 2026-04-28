/**
 * Tests for LoginPage
 * SC-LOGIN-PAGE-01..06
 * Strict TDD — RED → GREEN
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "../src/lib/auth-context";
import { LoginPage } from "../src/pages/LoginPage";
import { registerAuthBridge, UnauthorizedError } from "../src/lib/api-client";

// Mock apiClient so we control network responses
vi.mock("../src/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api-client")>();
  return {
    ...actual,
    apiClient: {
      post: vi.fn(),
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
  };
});

import { apiClient } from "../src/lib/api-client";

function renderLoginPage() {
  const mockRedirectToLogin = vi.fn();
  registerAuthBridge(mockRedirectToLogin);

  render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>Dashboard</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
  return { mockRedirectToLogin };
}

function getPasswordInput() {
  return document.querySelector('input[type="password"]') as HTMLInputElement;
}

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // SC-LOGIN-PAGE-01: renders password input and "Entrar" button, no error visible
  it("SC-LOGIN-PAGE-01: renders password input and Entrar button with no error", () => {
    renderLoginPage();
    const passwordInput = getPasswordInput();
    expect(passwordInput).not.toBeNull();
    expect(screen.getByRole("button", { name: /entrar/i })).toBeDefined();
    // No error visible initially — role=alert should be empty/blank
    const alert = screen.getByRole("alert");
    expect(alert.textContent?.trim()).toBeFalsy();
  });

  // SC-LOGIN-PAGE-02: success (mock 200) → navigates to /
  it("SC-LOGIN-PAGE-02: on success (200) navigates to /", async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ ok: true });
    renderLoginPage();

    const input = getPasswordInput();
    await userEvent.type(input, "correctpass");
    await userEvent.click(screen.getByRole("button", { name: /entrar/i }));

    await waitFor(() => {
      expect(screen.getByText("Dashboard")).toBeDefined();
    });
    expect(apiClient.post).toHaveBeenCalledWith(
      "/api/auth/login",
      { password: "correctpass" },
      { skipAuthRedirect: true },
    );
  });

  // SC-LOGIN-PAGE-03: on 401 → shows error message, redirectToLogin NOT called
  it("SC-LOGIN-PAGE-03: on 401 shows error without calling redirectToLogin", async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new UnauthorizedError());
    const { mockRedirectToLogin } = renderLoginPage();

    const input = getPasswordInput();
    await userEvent.type(input, "wrongpass");
    await userEvent.click(screen.getByRole("button", { name: /entrar/i }));

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent?.trim()).not.toBe("");
    });
    expect(mockRedirectToLogin).not.toHaveBeenCalled();
  });

  // SC-LOGIN-PAGE-04: empty password → no fetch, shows validation message
  it("SC-LOGIN-PAGE-04: empty password shows validation message without fetch", async () => {
    renderLoginPage();

    // Submit with empty password (button is not disabled — validation runs on submit)
    await userEvent.click(screen.getByRole("button", { name: /entrar/i }));

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent?.trim()).not.toBe("");
    });
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  // SC-LOGIN-PAGE-05: during submit in-flight → button and input are disabled
  it("SC-LOGIN-PAGE-05: during submit button and input are disabled", async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(apiClient.post).mockImplementation(
      () => new Promise((res) => { resolve = res; }),
    );
    renderLoginPage();

    const input = getPasswordInput();
    await userEvent.type(input, "somepass");

    // Fire submit (don't await) to stay in-flight
    act(() => {
      screen.getByRole("button", { name: /entrar/i }).click();
    });

    // Wait for submitting state
    await waitFor(() => {
      const button = screen.getByRole("button", { name: /entrando/i });
      expect((button as HTMLButtonElement).disabled).toBe(true);
    });

    await waitFor(() => {
      const inp = getPasswordInput();
      expect(inp.disabled).toBe(true);
    });

    // Cleanup — resolve the hanging promise
    act(() => { resolve({ ok: true }); });
  });

  // SC-LOGIN-PAGE-06: network error → shows "Error de conexión" message
  it("SC-LOGIN-PAGE-06: network error shows generic error message", async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new TypeError("Network error"));
    renderLoginPage();

    const input = getPasswordInput();
    await userEvent.type(input, "anypass");
    await userEvent.click(screen.getByRole("button", { name: /entrar/i }));

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent?.trim()).toMatch(/conexión|error/i);
    });
  });
});
