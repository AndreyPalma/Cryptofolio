/**
 * Tests for useTokensByWallet hook (US-011 Phase 3)
 * TDD: T5.R — write failing test first
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
import { renderHook, waitFor } from "@testing-library/react";
import { useTokensByWallet } from "../src/hooks/useTokensByWallet";
import type { WalletEntry } from "../src/types/token-detail";

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

const ethWallet: WalletEntry = {
  id: "w1",
  label: "ETH Wallet",
  walletType: "ON_CHAIN",
  network: "ETH",
};

const cexWallet: WalletEntry = {
  id: "w2",
  label: "Binance Account",
  walletType: "CEX",
  network: "CEX_BINANCE",
};

const mockTokensEth = [
  {
    id: "t1",
    symbol: "ETH",
    name: "Ethereum",
    network: "ETH",
    contract_address: "0xeeee",
    decimals: 18,
    binance_symbol: "ETH",
    is_hidden: false,
    target_exit_price: null,
    created_at: "2024-01-01T00:00:00.000Z",
  },
  {
    id: "t2",
    symbol: "WETH",
    name: "Wrapped Ether",
    network: "ETH",
    contract_address: "0xc02a",
    decimals: 18,
    binance_symbol: null,
    is_hidden: true, // should be filtered out
    target_exit_price: null,
    created_at: "2024-01-01T00:00:00.000Z",
  },
];

const mockTokensCex = [
  {
    id: "t3",
    symbol: "BNB",
    name: "Binance Coin",
    network: "CEX_BINANCE",
    contract_address: "bnb",
    decimals: 18,
    binance_symbol: "BNB",
    is_hidden: false,
    target_exit_price: null,
    created_at: "2024-01-01T00:00:00.000Z",
  },
];

describe("useTokensByWallet", () => {
  let mockGet: Mock;

  beforeEach(async () => {
    const { apiClient } = await import("../src/lib/api-client");
    mockGet = apiClient.get as Mock;
    mockGet.mockReset();
    // Clear the module-level cache between tests
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns null data without fetching when wallet is null", async () => {
    const { result } = renderHook(() => useTokensByWallet(null));

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("calls GET /api/tokens?network=ETH when ETH wallet selected", async () => {
    mockGet.mockResolvedValue(mockTokensEth);

    const { result } = renderHook(() => useTokensByWallet(ethWallet));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockGet).toHaveBeenCalledWith("/api/tokens?network=ETH");
  });

  it("calls GET /api/tokens?network=CEX_BINANCE when CEX wallet selected", async () => {
    mockGet.mockResolvedValue(mockTokensCex);

    const { result } = renderHook(() => useTokensByWallet(cexWallet));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockGet).toHaveBeenCalledWith("/api/tokens?network=CEX_BINANCE");
  });

  it("filters out tokens with is_hidden: true", async () => {
    mockGet.mockResolvedValue(mockTokensEth);

    const { result } = renderHook(() => useTokensByWallet(ethWallet));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).not.toBeNull();
    // Only 1 token should be returned (WETH is hidden)
    expect(result.current.data!.length).toBe(1);
    expect(result.current.data![0]!.symbol).toBe("ETH");
  });

  it("returns loading: true while request is in flight (fresh network, not cached)", async () => {
    // Use a different network (BSC) to avoid cache from previous tests
    const bscWallet: WalletEntry = {
      id: "w-bsc",
      label: "BSC Wallet",
      walletType: "ON_CHAIN",
      network: "BSC",
    };
    mockGet.mockReturnValue(new Promise(() => {})); // never resolves

    const { result } = renderHook(() => useTokensByWallet(bscWallet));

    expect(result.current.loading).toBe(true);
  });
});
