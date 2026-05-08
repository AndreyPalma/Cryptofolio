/**
 * Tests for useWalletBalance hook (US-011 Phase 3)
 * TDD: T6.R — write failing test first
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
import { renderHook, waitFor, act } from "@testing-library/react";
import { useWalletBalance } from "../src/hooks/useWalletBalance";

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

const mockPortfolioResponse = {
  position: {
    walletBreakdown: [
      { walletId: "w1", label: "My Wallet", balance: "2.5", wac: "1800.00" },
      { walletId: "w2", label: "Cold Wallet", balance: "1.0", wac: "1500.00" },
    ],
  },
};

describe("useWalletBalance", () => {
  let mockGet: Mock;

  beforeEach(async () => {
    const { apiClient } = await import("../src/lib/api-client");
    mockGet = apiClient.get as Mock;
    mockGet.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fetches GET /api/portfolio/token/{contractAddress}/{network}", async () => {
    mockGet.mockResolvedValue(mockPortfolioResponse);

    const { result } = renderHook(() =>
      useWalletBalance("w1", "0xeeee", "ETH"),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockGet).toHaveBeenCalledWith("/api/portfolio/token/0xeeee/ETH");
  });

  it("returns balance and wac for the matching walletId", async () => {
    mockGet.mockResolvedValue(mockPortfolioResponse);

    const { result } = renderHook(() =>
      useWalletBalance("w1", "0xeeee", "ETH"),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.balance).toBe("2.5");
    expect(result.current.wac).toBe("1800.00");
  });

  it("returns { balance: null, wac: null } when walletId not in breakdown", async () => {
    mockGet.mockResolvedValue(mockPortfolioResponse);

    const { result } = renderHook(() =>
      useWalletBalance("w-unknown", "0xeeee", "ETH"),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.balance).toBeNull();
    expect(result.current.wac).toBeNull();
  });

  it("returns { balance: null, wac: null } when position is null (no position)", async () => {
    mockGet.mockResolvedValue({ position: null });

    const { result } = renderHook(() =>
      useWalletBalance("w1", "0xeeee", "ETH"),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.balance).toBeNull();
    expect(result.current.wac).toBeNull();
  });

  it("returns loading: true while request is in flight", () => {
    mockGet.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() =>
      useWalletBalance("w1", "0xeeee", "ETH"),
    );

    expect(result.current.loading).toBe(true);
  });

  it("rapidly changing walletId does not surface stale data from previous call", async () => {
    let resolveFirst!: (value: unknown) => void;
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const secondResponse = { position: { walletBreakdown: [{ walletId: "w2", label: null, balance: "9.9", wac: "999" }] } };

    mockGet
      .mockReturnValueOnce(firstPromise) // w1 call — delayed
      .mockResolvedValueOnce(secondResponse); // w2 call — immediate

    const { result, rerender } = renderHook(
      ({ walletId }: { walletId: string }) =>
        useWalletBalance(walletId, "0xeeee", "ETH"),
      { initialProps: { walletId: "w1" } },
    );

    // Switch to w2 before first call resolves
    act(() => {
      rerender({ walletId: "w2" });
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Now resolve the stale w1 response
    act(() => {
      resolveFirst(mockPortfolioResponse);
    });

    // Should still show w2 data, not stale w1 data
    expect(result.current.balance).toBe("9.9");
    expect(result.current.wac).toBe("999");
  });
});
