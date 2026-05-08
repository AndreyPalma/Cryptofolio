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
    mockGet.mockResolvedValue(mockWallets);

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
