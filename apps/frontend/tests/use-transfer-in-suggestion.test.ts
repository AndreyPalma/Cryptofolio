/**
 * Tests for useTransferInSuggestion hook (US-011 Phase 3)
 * TDD: T8.R — write failing test first
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
import { useTransferInSuggestion } from "../src/hooks/useTransferInSuggestion";
import type { WalletEntry } from "../src/types/token-detail";
import type { Token } from "../src/hooks/useTokensByWallet";

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

const mockToken: Token = {
  id: "token-1",
  symbol: "ETH",
  name: "Ethereum",
  network: "ETH",
  contractAddress: "0xeeee",
  decimals: 18,
  binanceSymbol: null,
  isHidden: false,
  targetExitPrice: null,
};

const onChainW1: WalletEntry = { id: "w1", label: "Destination", walletType: "ON_CHAIN", network: "ETH" };
const onChainW2: WalletEntry = { id: "w2", label: "Cold Wallet", walletType: "ON_CHAIN", network: "ETH" };
const cexWallet: WalletEntry = { id: "w3", label: "Binance", walletType: "CEX", network: "CEX_BINANCE" };

// walletsByType map for tests
function makeWalletsMap(wallets: WalletEntry[]): Map<string, WalletEntry> {
  const map = new Map<string, WalletEntry>();
  wallets.forEach((w) => map.set(w.id, w));
  return map;
}

const mockPortfolioResponse = {
  position: {
    walletBreakdown: [
      { walletId: "w1", label: "Destination", balance: "1.0", wac: "2000" },
      { walletId: "w2", label: "Cold Wallet", balance: "5.0", wac: "1800.50" },
    ],
  },
};

describe("useTransferInSuggestion", () => {
  let mockGet: Mock;

  beforeEach(async () => {
    const { apiClient } = await import("../src/lib/api-client");
    mockGet = apiClient.get as Mock;
    mockGet.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns { candidate: null, loading: false } when type !== TRANSFER_IN", () => {
    const { result } = renderHook(() =>
      useTransferInSuggestion(mockToken, "w1", "BUY", makeWalletsMap([onChainW1, onChainW2])),
    );

    expect(result.current.candidate).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("does not fetch when destination wallet is CEX", () => {
    const { result } = renderHook(() =>
      useTransferInSuggestion(mockToken, "w3", "TRANSFER_IN", makeWalletsMap([onChainW1, cexWallet])),
    );

    expect(result.current.candidate).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("filters out the destination wallet from breakdown results", async () => {
    mockGet.mockResolvedValue(mockPortfolioResponse);

    const { result } = renderHook(() =>
      useTransferInSuggestion(mockToken, "w1", "TRANSFER_IN", makeWalletsMap([onChainW1, onChainW2])),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // w1 is the destination, should be filtered out — w2 should be the candidate
    expect(result.current.candidate?.walletId).toBe("w2");
  });

  it("filters out entries with balance: '0'", async () => {
    mockGet.mockResolvedValue({
      position: {
        walletBreakdown: [
          { walletId: "w2", label: "Cold Wallet", balance: "0", wac: "1800" },
        ],
      },
    });

    const { result } = renderHook(() =>
      useTransferInSuggestion(mockToken, "w1", "TRANSFER_IN", makeWalletsMap([onChainW1, onChainW2])),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.candidate).toBeNull();
  });

  it("filters out entries from CEX wallets not in walletsByType as ON_CHAIN", async () => {
    mockGet.mockResolvedValue({
      position: {
        walletBreakdown: [
          { walletId: "w3", label: "Binance", balance: "5.0", wac: "1800" }, // CEX wallet
        ],
      },
    });

    const { result } = renderHook(() =>
      useTransferInSuggestion(mockToken, "w1", "TRANSFER_IN", makeWalletsMap([onChainW1, cexWallet])),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.candidate).toBeNull();
  });

  it("returns the highest-balance ON_CHAIN candidate", async () => {
    mockGet.mockResolvedValue({
      position: {
        walletBreakdown: [
          { walletId: "w2", label: "Cold Wallet A", balance: "5.0", wac: "1800.50" },
          { walletId: "w4", label: "Cold Wallet B", balance: "10.0", wac: "1600" },
        ],
      },
    });

    const w4: WalletEntry = { id: "w4", label: "Cold Wallet B", walletType: "ON_CHAIN", network: "ETH" };

    const { result } = renderHook(() =>
      useTransferInSuggestion(mockToken, "w1", "TRANSFER_IN", makeWalletsMap([onChainW1, onChainW2, w4])),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // w4 has higher balance (10.0 > 5.0)
    expect(result.current.candidate?.walletId).toBe("w4");
    expect(result.current.candidate?.wac).toBe("1600");
  });

  it("rapidly toggling destinationWalletId resolves the last value only (stale data dropped)", async () => {
    let resolveFirst!: (value: unknown) => void;
    const firstPromise = new Promise((resolve) => { resolveFirst = resolve; });
    const secondResponse = {
      position: {
        walletBreakdown: [
          { walletId: "w2", label: "Cold Wallet", balance: "9.9", wac: "999" },
        ],
      },
    };

    mockGet
      .mockReturnValueOnce(firstPromise) // first destination wallet call — delayed
      .mockResolvedValueOnce(secondResponse); // second call — immediate

    const w5: WalletEntry = { id: "w5", label: "Alt Dest", walletType: "ON_CHAIN", network: "ETH" };

    const { result, rerender } = renderHook(
      ({ destId }: { destId: string }) =>
        useTransferInSuggestion(mockToken, destId, "TRANSFER_IN", makeWalletsMap([onChainW1, onChainW2, w5])),
      { initialProps: { destId: "w1" } },
    );

    // Switch destination before first call resolves
    act(() => {
      rerender({ destId: "w5" });
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Resolve the stale response
    act(() => {
      resolveFirst({
        position: {
          walletBreakdown: [
            { walletId: "w2", label: "Cold Wallet", balance: "1.0", wac: "STALE_WAC" },
          ],
        },
      });
    });

    // Should show the last (second) result, not stale data
    expect(result.current.candidate?.wac).not.toBe("STALE_WAC");
  });
});
