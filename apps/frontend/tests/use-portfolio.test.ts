/**
 * Tests for usePortfolio hook
 * Phase 3 — RED
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
import { usePortfolio } from "../src/hooks/usePortfolio";
import type { PortfolioResponse } from "../src/types/portfolio";

// Mock the entire api-client module
vi.mock("../src/lib/api-client", () => ({
  apiClient: {
    get: vi.fn(),
  },
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor() {
      super("Unauthorized");
      this.name = "UnauthorizedError";
    }
  },
}));

const mockPortfolioData: PortfolioResponse = {
  totalValueUsd: "10000.00",
  totalCostBasis: "8000.00",
  totalPnlUsd: "2000.00",
  totalPnlPct: "25.00",
  tokens: [],
};

const mockPortfolioData2: PortfolioResponse = {
  totalValueUsd: "11000.00",
  totalCostBasis: "8000.00",
  totalPnlUsd: "3000.00",
  totalPnlPct: "37.50",
  tokens: [],
};

describe("usePortfolio", () => {
  let mockGet: Mock;

  beforeEach(async () => {
    const { apiClient } = await import("../src/lib/api-client");
    mockGet = apiClient.get as Mock;
    mockGet.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    // Restore visibility properties
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
  });

  it("initial mount: loading=true, data=null before fetch resolves", async () => {
    // Never resolves — keep loading
    mockGet.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => usePortfolio());

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
  });

  it("after successful fetch: loading=false, data populated, lastUpdated set", async () => {
    mockGet.mockResolvedValue(mockPortfolioData);

    const { result } = renderHook(() => usePortfolio());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(mockPortfolioData);
    expect(result.current.lastUpdated).toBeInstanceOf(Date);
    expect(result.current.error).toBeNull();
  });

  it("background refetch (60s tick): loading stays false, data updates", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGet
      .mockResolvedValueOnce(mockPortfolioData)
      .mockResolvedValueOnce(mockPortfolioData2);

    const { result } = renderHook(() => usePortfolio());

    // Flush the initial fetch
    await act(async () => {
      await vi.runAllTicks();
    });

    await waitFor(
      () => {
        expect(result.current.data).toEqual(mockPortfolioData);
      },
      { timeout: 3000 },
    );

    expect(result.current.loading).toBe(false);

    // Advance timer to trigger background refetch
    await act(async () => {
      vi.advanceTimersByTime(60000);
      await vi.runAllTicks();
    });

    await waitFor(
      () => {
        expect(result.current.data).toEqual(mockPortfolioData2);
      },
      { timeout: 3000 },
    );

    // loading must NOT flip to true during background refetch
    expect(result.current.loading).toBe(false);
  });

  it("failed initial fetch: loading=false, error set, data null", async () => {
    const err = new Error("Network error");
    mockGet.mockRejectedValue(err);

    const { result } = renderHook(() => usePortfolio());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.data).toBeNull();
  });

  it("failed background refetch: error set, previous data retained", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGet
      .mockResolvedValueOnce(mockPortfolioData)
      .mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => usePortfolio());

    // Flush initial fetch
    await act(async () => {
      await vi.runAllTicks();
    });

    await waitFor(
      () => {
        expect(result.current.data).toEqual(mockPortfolioData);
      },
      { timeout: 3000 },
    );

    // Trigger background refetch via fake timer
    await act(async () => {
      vi.advanceTimersByTime(60000);
      await vi.runAllTicks();
    });

    await waitFor(
      () => {
        expect(result.current.error).toBeTruthy();
      },
      { timeout: 3000 },
    );

    // Previous data is retained, NOT cleared
    expect(result.current.data).toEqual(mockPortfolioData);
  });

  it("tab hidden: 60s tick does NOT trigger a fetch", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGet.mockResolvedValue(mockPortfolioData);

    const { result } = renderHook(() => usePortfolio());

    await act(async () => {
      await vi.runAllTicks();
    });

    await waitFor(
      () => {
        expect(result.current.data).toEqual(mockPortfolioData);
      },
      { timeout: 3000 },
    );

    const initialCallCount = mockGet.mock.calls.length;

    // Simulate tab hidden — set BOTH hidden and visibilityState
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Advance 60s — should NOT trigger new fetch
    act(() => {
      vi.advanceTimersByTime(60000);
    });

    await act(async () => {
      await vi.runAllTicks();
    });

    // Should not have fetched again
    expect(mockGet.mock.calls.length).toBe(initialCallCount);

    // Restore
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
  });

  it("tab becomes visible: immediate refetch fires", async () => {
    mockGet.mockResolvedValue(mockPortfolioData);

    const { result } = renderHook(() => usePortfolio());

    await waitFor(() => {
      expect(result.current.data).toEqual(mockPortfolioData);
    });

    // Hide tab
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    const callCountAfterHide = mockGet.mock.calls.length;

    // Show tab again — should trigger immediate refetch
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(
      () => {
        expect(mockGet.mock.calls.length).toBeGreaterThan(callCountAfterHide);
      },
      { timeout: 3000 },
    );
  });

  it("unmount before fetch resolves: no state update, no warning", async () => {
    let resolve!: (v: PortfolioResponse) => void;
    mockGet.mockReturnValue(
      new Promise<PortfolioResponse>((res) => {
        resolve = res;
      }),
    );

    const { result, unmount } = renderHook(() => usePortfolio());

    expect(result.current.loading).toBe(true);

    unmount();

    // Resolve after unmount — should not throw or warn
    expect(() => {
      act(() => {
        resolve(mockPortfolioData);
      });
    }).not.toThrow();
  });

  it("refresh() called while fetch in-flight: second fetch does NOT fire", async () => {
    let firstResolve!: (v: PortfolioResponse) => void;
    mockGet.mockReturnValueOnce(
      new Promise<PortfolioResponse>((res) => {
        firstResolve = res;
      }),
    );

    const { result } = renderHook(() => usePortfolio());

    // Call refresh while first fetch is in flight
    act(() => {
      void result.current.refresh();
    });

    // Should still be only 1 call (the initial one)
    expect(mockGet.mock.calls.length).toBe(1);

    await act(async () => {
      firstResolve(mockPortfolioData);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(mockPortfolioData);
    });
  });
});
