import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSyncWallet } from "../useSyncWallet";

vi.mock("../../../lib/api-client", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

import { apiClient } from "../../../lib/api-client";
const mockPost = vi.mocked(apiClient.post);

const onChainResponse = {
  synced: 10,
  skipped: 3,
  swapsDecomposed: 2,
  transfersPendingCost: 1,
  transfersInheritedFromCEX: 0,
};

const cexResponse = {
  trades: { synced: 12, skipped: 3, symbolsProcessed: 2 },
  converts: { synced: 1, skipped: 0 },
  withdrawals: { synced: 0, skipped: 0 },
  deposits: { synced: 5, skipped: 0, inherited: 3, manual: 2 },
  tokensCreated: 2,
};

describe("useSyncWallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sync(id, 'on-chain') sets syncing state during in-flight and success after", async () => {
    let resolvePost!: (v: unknown) => void;
    mockPost.mockReturnValueOnce(
      new Promise((res) => {
        resolvePost = res;
      }),
    );

    const { result } = renderHook(() => useSyncWallet());

    // initial state for this wallet is undefined (no entry)
    expect(result.current.states["wallet-1"]).toBeUndefined();

    // Start sync — set syncing
    act(() => {
      void result.current.sync("wallet-1", "on-chain");
    });

    // After triggering, syncing should be set
    expect(result.current.states["wallet-1"]?.status).toBe("syncing");

    // Resolve the post
    await act(async () => {
      resolvePost(onChainResponse);
    });

    const state = result.current.states["wallet-1"];
    expect(state?.status).toBe("success");
    if (state?.status === "success") {
      expect(state.result.kind).toBe("on-chain");
      expect((state.result as { synced: number }).synced).toBe(10);
      expect((state.result as { skipped: number }).skipped).toBe(3);
      expect((state.result as { swapsDecomposed: number }).swapsDecomposed).toBe(2);
      expect(state.finishedAt).toBeInstanceOf(Date);
    }
  });

  it("sync(id, 'cex') sets result.kind === 'cex' with sub-objects", async () => {
    mockPost.mockResolvedValueOnce(cexResponse);

    const { result } = renderHook(() => useSyncWallet());

    await act(async () => {
      await result.current.sync("wallet-cex", "cex");
    });

    const state = result.current.states["wallet-cex"];
    expect(state?.status).toBe("success");
    if (state?.status === "success") {
      expect(state.result.kind).toBe("cex");
      const cex = state.result as import("../../../types/settings").CexSyncResult;
      expect(cex.trades.synced).toBe(12);
      expect(cex.converts.synced).toBe(1);
      expect(cex.withdrawals.synced).toBe(0);
      expect(cex.deposits.synced).toBe(5);
    }
  });

  it("two concurrent wallets have independent states", async () => {
    mockPost
      .mockResolvedValueOnce(onChainResponse)
      .mockResolvedValueOnce(cexResponse);

    const { result } = renderHook(() => useSyncWallet());

    await act(async () => {
      await Promise.all([
        result.current.sync("wallet-a", "on-chain"),
        result.current.sync("wallet-b", "cex"),
      ]);
    });

    expect(result.current.states["wallet-a"]?.status).toBe("success");
    expect(result.current.states["wallet-b"]?.status).toBe("success");

    if (result.current.states["wallet-a"]?.status === "success") {
      expect(result.current.states["wallet-a"].result.kind).toBe("on-chain");
    }
    if (result.current.states["wallet-b"]?.status === "success") {
      expect(result.current.states["wallet-b"].result.kind).toBe("cex");
    }
  });

  it("sets status error and message when backend rejects", async () => {
    mockPost.mockRejectedValueOnce(new Error("HTTP 500: Internal Server Error"));

    const { result } = renderHook(() => useSyncWallet());

    await act(async () => {
      await result.current.sync("wallet-fail", "on-chain");
    });

    const state = result.current.states["wallet-fail"];
    expect(state?.status).toBe("error");
    if (state?.status === "error") {
      expect(state.message).toContain("500");
    }
  });

  it("does NOT call apiClient.get inside the hook (no internal refetch)", async () => {
    mockPost.mockResolvedValueOnce(onChainResponse);
    const mockGet = vi.mocked(apiClient.get);

    const { result } = renderHook(() => useSyncWallet());

    await act(async () => {
      await result.current.sync("wallet-1", "on-chain");
    });

    expect(mockGet).not.toHaveBeenCalled();
  });
});
