/**
 * Tests for useWallets hook (US-010 Phase 2)
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
import { useWallets } from "../src/hooks/useWallets";
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

// Raw API response (snake_case) — what the backend actually returns
const mockWalletsRaw = [
  { id: "w1", user_id: "u1", wallet_type: "ON_CHAIN", address: "0xabc", network: "ETH", label: "My Wallet", last_synced_at: null, created_at: "2024-01-01T00:00:00.000Z" },
  { id: "w2", user_id: "u1", wallet_type: "ON_CHAIN", address: "0xdef", network: "BSC", label: null, last_synced_at: null, created_at: "2024-01-01T00:00:00.000Z" },
];

// Expected camelCase output after transform
const mockWallets: WalletEntry[] = [
  { id: "w1", label: "My Wallet", walletType: "ON_CHAIN", network: "ETH" },
  { id: "w2", label: null, walletType: "ON_CHAIN", network: "BSC" },
];

describe("useWallets", () => {
  let mockGet: Mock;

  beforeEach(async () => {
    const { apiClient } = await import("../src/lib/api-client");
    mockGet = apiClient.get as Mock;
    mockGet.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("T-030: one-shot fetch from /api/wallets, populates data", async () => {
    mockGet.mockResolvedValue(mockWalletsRaw);

    const { result } = renderHook(() => useWallets());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(mockWallets);
    expect(result.current.error).toBeNull();

    const url = (mockGet.mock.calls[0] as [string])[0];
    expect(url).toBe("/api/wallets");
  });
});
