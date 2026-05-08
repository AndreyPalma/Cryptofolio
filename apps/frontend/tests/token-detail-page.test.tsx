/**
 * Tests for TokenDetailPage (US-010 Phase 5)
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, waitFor, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../src/lib/api-client", () => ({
  apiClient: { get: vi.fn() },
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor() {
      super("Unauthorized");
      this.name = "UnauthorizedError";
    }
  },
}));

vi.mock("../src/lib/checksum-address", () => ({
  toChecksumAddress: (addr: string) => addr,
}));

import { TokenDetailPage } from "../src/pages/TokenDetailPage";
import type { TokenDetail } from "../src/types/token-detail";

const mockDetail: TokenDetail = {
  token: {
    id: "token-1",
    symbol: "WETH",
    name: "Wrapped Ether",
    network: "ETH",
    contractAddress: "0xaaa",
    binanceSymbol: null,
    decimals: 18,
    targetExitPrice: null,
  },
  position: {
    symbol: "WETH",
    network: "ETH",
    sourceType: "ON_CHAIN",
    contractAddress: "0xaaa",
    binanceSymbol: null,
    totalBalance: "1.0",
    wacAggregated: "2000.0",
    totalCostBasis: "2000.0",
    currentPrice: "3000.0",
    totalCurrentValue: "3000.0",
    pnlUsd: "1000.0",
    pnlPct: "50.0",
    walletCount: 1,
    walletBreakdown: [
      { walletId: "w1", label: "My Wallet", balance: "1.0", wac: "2000.0" },
    ],
    cycleNumber: 1,
  },
  transactions: [],
};

const mockDetailCex: TokenDetail = {
  ...mockDetail,
  token: { ...mockDetail.token, network: "CEX_BINANCE", contractAddress: "eth" },
  position: mockDetail.position
    ? { ...mockDetail.position, network: "CEX_BINANCE", sourceType: "CEX" }
    : null,
};

function renderPage(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/token/:contractAddress/:network" element={<TokenDetailPage />} />
        <Route path="/" element={<div data-testid="home">Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TokenDetailPage", () => {
  let mockGet: Mock;

  const mockHistory = { cycles: [] };

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { apiClient } = await import("../src/lib/api-client");
    mockGet = apiClient.get as Mock;
    mockGet.mockReset();
    // Default: return mockDetail for detail endpoint, mockHistory for history endpoint
    mockGet.mockImplementation((url: string) => {
      if (String(url).includes("/history")) {
        return Promise.resolve(mockHistory);
      }
      return Promise.resolve(mockDetail);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });

  it("T-048: invalid network param → redirects to /", async () => {
    const { container } = renderPage("/token/0xaaa/INVALID_NET");

    await waitFor(() => {
      expect(container.textContent).toContain("Home");
    });
  });

  it("T-049: loading skeleton shown, then data rendered after fetch resolves", async () => {
    const { container } = renderPage("/token/0xaaa/ETH");

    // Initially loading
    expect(container.textContent).toContain("Loading");

    await act(async () => { await vi.runAllTicks(); });

    await waitFor(() => {
      expect(container.textContent).toContain("WETH");
    });
  });

  it("T-050a: ON_CHAIN network → WalletSelector rendered", async () => {
    const { container } = renderPage("/token/0xaaa/ETH");

    await act(async () => { await vi.runAllTicks(); });

    await waitFor(() => {
      expect(container.textContent).toContain("WETH");
    });

    // Wallet selector should be present
    expect(container.querySelector("select")).not.toBeNull();
  });

  it("T-050b: CEX_BINANCE → WalletSelector NOT rendered", async () => {
    mockGet.mockImplementation((url: string) => {
      if (String(url).includes("/history")) return Promise.resolve(mockHistory);
      return Promise.resolve(mockDetailCex);
    });
    const { container } = renderPage("/token/eth/CEX_BINANCE");

    await act(async () => { await vi.runAllTicks(); });

    await waitFor(() => {
      expect(container.textContent).toContain("WETH");
    });

    expect(container.querySelector("select")).toBeNull();
  });

  it("T-052: poll fires after 30s", async () => {
    const { container } = renderPage("/token/0xaaa/ETH");

    await act(async () => { await vi.runAllTicks(); });

    await waitFor(() => {
      expect(container.textContent).toContain("WETH");
    });

    const callsBefore = mockGet.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(30000);
      await vi.runAllTicks();
    });

    expect(mockGet.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("T-053: position=null + transactions=[] → empty state shown", async () => {
    mockGet.mockImplementation((url: string) => {
      if (String(url).includes("/history")) return Promise.resolve(mockHistory);
      return Promise.resolve({ ...mockDetail, position: null, transactions: [] });
    });

    const { container } = renderPage("/token/0xaaa/ETH");

    await act(async () => { await vi.runAllTicks(); });

    await waitFor(() => {
      expect(container.textContent).toContain("No transactions recorded yet");
    });
  });

  it("T-054: API error with stale data → stale data + error banner both visible", async () => {
    let callCount = 0;
    mockGet.mockImplementation((url: string) => {
      if (String(url).includes("/history")) return Promise.resolve(mockHistory);
      callCount++;
      if (callCount === 1) return Promise.resolve(mockDetail);
      return Promise.reject(new Error("Network error"));
    });

    const { container } = renderPage("/token/0xaaa/ETH");

    await act(async () => { await vi.runAllTicks(); });

    await waitFor(() => {
      expect(container.textContent).toContain("WETH");
    });

    await act(async () => {
      vi.advanceTimersByTime(30000);
      await vi.runAllTicks();
    });

    await waitFor(() => {
      // Error banner should appear
      expect(container.textContent).toMatch(/error|Error|failed|Failed/i);
    });

    // Stale data (WETH) still visible
    expect(container.textContent).toContain("WETH");
  });
});
