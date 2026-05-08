/**
 * Tests for /transactions/new route registration (US-011 Phase 6.5)
 * TDD: T24.R — write failing test first
 */
import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { ToastProvider } from "../src/lib/toast-context";

// Mock hooks to prevent real fetches
vi.mock("../src/hooks/useWallets", () => ({
  useWallets: () => ({ data: [], loading: false, error: null }),
}));
vi.mock("../src/hooks/useTokensByWallet", () => ({
  useTokensByWallet: () => ({ data: [], loading: false, error: null }),
}));
vi.mock("../src/hooks/useWalletBalance", () => ({
  useWalletBalance: () => ({ balance: null, wac: null, loading: false, error: null }),
}));
vi.mock("../src/hooks/useTransferInSuggestion", () => ({
  useTransferInSuggestion: () => ({ candidate: null, loading: false, error: null }),
}));
vi.mock("../src/hooks/useCreateTransaction", () => ({
  useCreateTransaction: () => ({ submit: vi.fn() }),
}));
vi.mock("../src/lib/api-client", () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

describe("Router — /transactions/new route", () => {
  it("renders AddTransactionPage at /transactions/new when authenticated", async () => {
    const { router } = await import("../src/routes/router");

    // Create a memory router with the same routes but starting at /transactions/new
    const testRouter = createMemoryRouter(
      (router as unknown as { routes: unknown[] }).routes,
      { initialEntries: ["/transactions/new"] },
    );

    const { container } = render(
      <ToastProvider>
        <RouterProvider router={testRouter} />
      </ToastProvider>,
    );

    await waitFor(() => {
      // AddTransactionPage renders an h1 with "Add Transaction"
      const h1 = container.querySelector("h1");
      expect(h1).not.toBeNull();
      expect(h1?.textContent).toContain("Add Transaction");
    }, { timeout: 3000 });
  });
});
