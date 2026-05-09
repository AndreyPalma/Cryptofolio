import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useSettingsWallets } from "../useSettingsWallets";

vi.mock("../../../lib/api-client", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

import { apiClient } from "../../../lib/api-client";
const mockGet = vi.mocked(apiClient.get);

const mockWalletRow = {
  id: "wallet-1",
  user_id: "user-1",
  wallet_type: "ON_CHAIN" as const,
  address: "0xabc123",
  network: "ETH",
  label: "My ETH Wallet",
  last_synced_at: "2026-05-08T10:00:00.000Z",
  created_at: "2026-01-01T00:00:00.000Z",
};

describe("useSettingsWallets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches wallets and maps last_synced_at to Date", async () => {
    mockGet.mockResolvedValueOnce([mockWalletRow]);

    const { result } = renderHook(() => useSettingsWallets());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).not.toBeNull();
    expect(result.current.data![0].lastSyncedAt).toBeInstanceOf(Date);
    expect(result.current.data![0].lastSyncedAt!.toISOString()).toBe(
      "2026-05-08T10:00:00.000Z",
    );
    expect(result.current.error).toBeNull();
  });

  it("maps wallet fields from snake_case to camelCase", async () => {
    mockGet.mockResolvedValueOnce([mockWalletRow]);

    const { result } = renderHook(() => useSettingsWallets());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const wallet = result.current.data![0];
    expect(wallet.id).toBe("wallet-1");
    expect(wallet.walletType).toBe("ON_CHAIN");
    expect(wallet.address).toBe("0xabc123");
    expect(wallet.network).toBe("ETH");
    expect(wallet.label).toBe("My ETH Wallet");
    expect(wallet.createdAt).toBeInstanceOf(Date);
  });

  it("sets loading true during fetch and false after", async () => {
    let resolveGet!: (v: unknown) => void;
    mockGet.mockReturnValueOnce(
      new Promise((res) => {
        resolveGet = res;
      }),
    );

    const { result } = renderHook(() => useSettingsWallets());
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveGet([mockWalletRow]);
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("calls apiClient.get again on refetch", async () => {
    mockGet
      .mockResolvedValueOnce([mockWalletRow])
      .mockResolvedValueOnce([{ ...mockWalletRow, id: "wallet-2" }]);

    const { result } = renderHook(() => useSettingsWallets());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data![0].id).toBe("wallet-1");

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.data![0].id).toBe("wallet-2");
  });

  it("sets error when apiClient.get rejects", async () => {
    mockGet.mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useSettingsWallets());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.error!.message).toBe("Network error");
    expect(result.current.data).toBeNull();
  });

  it("handles null last_synced_at correctly", async () => {
    mockGet.mockResolvedValueOnce([{ ...mockWalletRow, last_synced_at: null }]);

    const { result } = renderHook(() => useSettingsWallets());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).not.toBeNull();
    expect(result.current.data![0].lastSyncedAt).toBeNull();
  });
});
