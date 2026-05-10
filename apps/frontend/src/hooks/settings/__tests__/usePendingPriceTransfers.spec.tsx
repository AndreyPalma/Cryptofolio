import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { usePendingPriceTransfers } from "../usePendingPriceTransfers";

vi.mock("../../../lib/api-client", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

import { apiClient } from "../../../lib/api-client";
const mockGet = vi.mocked(apiClient.get);

const mockPendingRow = {
  id: "tx-1",
  wallet_id: "wallet-1",
  token_id: "token-1",
  token_symbol: "ETH",
  token_network: "ETH" as const,
  amount: "1.5",
  block_timestamp: "2026-05-08T10:00:00.000Z",
  tx_hash: "0xabc",
  from_address: "0xsender",
  contract_address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
};

const mockResponse = {
  transactions: [mockPendingRow, { ...mockPendingRow, id: "tx-2" }, { ...mockPendingRow, id: "tx-3" }],
  count: 3,
};

describe("usePendingPriceTransfers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches pending transfers and returns mapped data", async () => {
    mockGet.mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => usePendingPriceTransfers());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).not.toBeNull();
    expect(result.current.data!.count).toBe(3);
    expect(result.current.data!.transactions.length).toBe(3);
    expect(result.current.error).toBeNull();
  });

  it("maps block_timestamp to Date", async () => {
    mockGet.mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => usePendingPriceTransfers());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const tx = result.current.data!.transactions[0]!;
    expect(tx.blockTimestamp).toBeInstanceOf(Date);
    expect(tx.blockTimestamp.toISOString()).toBe("2026-05-08T10:00:00.000Z");
  });

  it("maps snake_case fields to camelCase", async () => {
    mockGet.mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => usePendingPriceTransfers());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const tx = result.current.data!.transactions[0]!;
    expect(tx.id).toBe("tx-1");
    expect(tx.walletId).toBe("wallet-1");
    expect(tx.tokenId).toBe("token-1");
    expect(tx.tokenSymbol).toBe("ETH");
    expect(tx.tokenNetwork).toBe("ETH");
    expect(tx.txHash).toBe("0xabc");
    expect(tx.fromAddress).toBe("0xsender");
    expect(tx.contractAddress).toBe("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
  });

  it("calls refetch and updates data", async () => {
    const secondResponse = { transactions: [], count: 0 };
    mockGet.mockResolvedValueOnce(mockResponse).mockResolvedValueOnce(secondResponse);

    const { result } = renderHook(() => usePendingPriceTransfers());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data!.count).toBe(3);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.data!.count).toBe(0);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it("sets error and data null when fetch fails", async () => {
    mockGet.mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => usePendingPriceTransfers());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).not.toBeNull();
    expect(result.current.data).toBeNull();
  });
});
