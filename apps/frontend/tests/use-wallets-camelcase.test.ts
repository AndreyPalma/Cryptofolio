/**
 * Regression tests for useWallets camelCase transform (US-011 Phase 2)
 * TDD: T4.R — write failing test first (walletType was not mapped from wallet_type)
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

// Raw backend response (snake_case) — this is what the API actually returns
const rawApiResponse = [
  {
    id: "w1",
    user_id: "user-1",
    wallet_type: "ON_CHAIN",
    address: "0xabc",
    network: "ETH",
    label: "My Wallet",
    last_synced_at: null,
    created_at: "2024-01-01T00:00:00.000Z",
  },
  {
    id: "w2",
    user_id: "user-1",
    wallet_type: "CEX",
    address: null,
    network: "CEX_BINANCE",
    label: "Binance Account",
    last_synced_at: null,
    created_at: "2024-01-01T00:00:00.000Z",
  },
];

describe("useWallets — camelCase transform (regression T4)", () => {
  let mockGet: Mock;

  beforeEach(async () => {
    const { apiClient } = await import("../src/lib/api-client");
    mockGet = apiClient.get as Mock;
    mockGet.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("maps wallet_type (snake_case) to walletType (camelCase) for ON_CHAIN wallet", async () => {
    mockGet.mockResolvedValue(rawApiResponse);

    const { result } = renderHook(() => useWallets());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).not.toBeNull();
    const first = result.current.data![0]!;
    expect(first.walletType).toBe("ON_CHAIN");
    // Should NOT have wallet_type (snake_case) accessible
    expect((first as unknown as Record<string, unknown>)["wallet_type"]).toBeUndefined();
  });

  it("maps wallet_type (snake_case) to walletType (camelCase) for CEX wallet", async () => {
    mockGet.mockResolvedValue(rawApiResponse);

    const { result } = renderHook(() => useWallets());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).not.toBeNull();
    const second = result.current.data![1]!;
    expect(second.walletType).toBe("CEX");
  });

  it("id, label, and network pass through unchanged", async () => {
    mockGet.mockResolvedValue(rawApiResponse);

    const { result } = renderHook(() => useWallets());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const first = result.current.data![0]!;
    expect(first.id).toBe("w1");
    expect(first.label).toBe("My Wallet");
    expect(first.network).toBe("ETH");

    const second = result.current.data![1]!;
    expect(second.id).toBe("w2");
    expect(second.label).toBe("Binance Account");
    expect(second.network).toBe("CEX_BINANCE");
  });
});
