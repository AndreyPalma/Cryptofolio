/**
 * Tests for useTokenDetail hook (US-010 Phase 2)
 * RED → GREEN cycle
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTokenDetail } from "../src/hooks/useTokenDetail";
import type { TokenDetail } from "../src/types/token-detail";

vi.mock("../src/lib/api-client", () => ({
  apiClient: {
    get: vi.fn(),
  },
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor() {
      super("Unauthorized");
      this.name = "UnauthorizedError";
      Object.setPrototypeOf(this, UnauthorizedError.prototype);
    }
  },
}));

const mockTokenDetail: TokenDetail = {
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

const mockTokenDetail2: TokenDetail = {
  ...mockTokenDetail,
  token: { ...mockTokenDetail.token, symbol: "WETH2" },
};

describe("useTokenDetail", () => {
  let mockGet: Mock;

  beforeEach(async () => {
    const { apiClient } = await import("../src/lib/api-client");
    mockGet = apiClient.get as Mock;
    mockGet.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
  });

  it("T-021: initial fetch sets loading=true then populates data when resolved", async () => {
    mockGet.mockResolvedValue(mockTokenDetail);

    const { result } = renderHook(() =>
      useTokenDetail("0xaaa", "ETH"),
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(mockTokenDetail);
    expect(result.current.error).toBeNull();
  });

  it("T-022: polling fires every 30s (mock setInterval, assert call count after timer advance)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGet
      .mockResolvedValueOnce(mockTokenDetail)
      .mockResolvedValueOnce(mockTokenDetail2);

    const { result } = renderHook(() =>
      useTokenDetail("0xaaa", "ETH"),
    );

    await act(async () => {
      await vi.runAllTicks();
    });

    await waitFor(
      () => {
        expect(result.current.data).toEqual(mockTokenDetail);
      },
      { timeout: 3000 },
    );

    const callsBefore = mockGet.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(30000);
      await vi.runAllTicks();
    });

    await waitFor(
      () => {
        expect(mockGet.mock.calls.length).toBeGreaterThan(callsBefore);
      },
      { timeout: 3000 },
    );
  });

  it("T-023: visibility hidden pauses polling; visible triggers immediate refetch and re-arms", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGet.mockResolvedValue(mockTokenDetail);

    const { result } = renderHook(() =>
      useTokenDetail("0xaaa", "ETH"),
    );

    await act(async () => {
      await vi.runAllTicks();
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(mockTokenDetail);
    });

    const callCountBeforeHide = mockGet.mock.calls.length;

    // Hide tab
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Advance 30s — should NOT trigger new fetch
    act(() => { vi.advanceTimersByTime(30000); });
    await act(async () => { await vi.runAllTicks(); });

    expect(mockGet.mock.calls.length).toBe(callCountBeforeHide);

    // Show tab again
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => {
      expect(mockGet.mock.calls.length).toBeGreaterThan(callCountBeforeHide);
    }, { timeout: 3000 });
  });

  it("T-024: changing walletId appends ?wallet_id= to the fetch URL", async () => {
    mockGet.mockResolvedValue(mockTokenDetail);

    const { result, rerender } = renderHook(
      ({ walletId }: { walletId: string | undefined }) =>
        useTokenDetail("0xaaa", "ETH", walletId),
      { initialProps: { walletId: undefined } },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual(mockTokenDetail);
    });

    // Verify initial call has no wallet_id
    const firstUrl = (mockGet.mock.calls[0] as [string])[0];
    expect(firstUrl).not.toContain("wallet_id");

    mockGet.mockResolvedValue(mockTokenDetail2);
    rerender({ walletId: "wallet-1" });

    await waitFor(() => {
      expect(result.current.data).toEqual(mockTokenDetail2);
    });

    const lastUrl = (mockGet.mock.calls[mockGet.mock.calls.length - 1] as [string])[0];
    expect(lastUrl).toContain("wallet_id=wallet-1");
  });

  it("T-025: UnauthorizedError re-throws without populating error state", async () => {
    const { UnauthorizedError } = await import("../src/lib/api-client");
    mockGet.mockRejectedValue(new UnauthorizedError());

    // Suppress the unhandled rejection from the re-throw
    const unhandledHandler = (e: PromiseRejectionEvent) => {
      e.preventDefault();
    };
    window.addEventListener("unhandledrejection", unhandledHandler);

    const { result } = renderHook(() => useTokenDetail("0xaaa", "ETH"));

    await waitFor(() => {
      // After the throw, loading should be false (finally block ran)
      expect(result.current.loading).toBe(false);
    });

    // error state should remain null (UnauthorizedError does not populate setError)
    expect(result.current.error).toBeNull();

    window.removeEventListener("unhandledrejection", unhandledHandler);
  });

  it("T-026: fetch error preserves stale data (stale-while-error)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGet
      .mockResolvedValueOnce(mockTokenDetail)
      .mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useTokenDetail("0xaaa", "ETH"));

    await act(async () => { await vi.runAllTicks(); });

    await waitFor(() => {
      expect(result.current.data).toEqual(mockTokenDetail);
    });

    await act(async () => {
      vi.advanceTimersByTime(30000);
      await vi.runAllTicks();
    });

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });

    // Stale data must be retained
    expect(result.current.data).toEqual(mockTokenDetail);
  });
});
