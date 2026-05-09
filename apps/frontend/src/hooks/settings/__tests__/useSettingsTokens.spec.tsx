import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useSettingsTokens } from "../useSettingsTokens";

vi.mock("../../../lib/api-client", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

import { apiClient } from "../../../lib/api-client";
const mockGet = vi.mocked(apiClient.get);
const mockPut = vi.mocked(apiClient.put);

const mockTokenRow = {
  id: "token-1",
  symbol: "ETH",
  name: "Ethereum",
  network: "ETH" as const,
  contract_address: "0xabc",
  binance_symbol: "ETH",
  is_hidden: false,
  target_exit_price: "3000.00",
};

describe("useSettingsTokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches tokens and maps snake_case to camelCase", async () => {
    mockGet.mockResolvedValueOnce([mockTokenRow]);

    const { result } = renderHook(() => useSettingsTokens());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).not.toBeNull();
    const token = result.current.data![0];
    expect(token.id).toBe("token-1");
    expect(token.symbol).toBe("ETH");
    expect(token.isHidden).toBe(false);
    expect(token.targetExitPrice).toBe("3000.00");
    expect(token.contractAddress).toBe("0xabc");
    expect(result.current.error).toBeNull();
  });

  it("updateToken calls apiClient.put with snake_case patch for isHidden", async () => {
    mockGet.mockResolvedValueOnce([mockTokenRow]);
    const updatedRow = { ...mockTokenRow, is_hidden: true };
    mockPut.mockResolvedValueOnce(updatedRow);

    const { result } = renderHook(() => useSettingsTokens());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateToken("token-1", { isHidden: true });
    });

    expect(mockPut).toHaveBeenCalledWith("/api/tokens/token-1", { is_hidden: true });
    // data should be updated after success
    expect(result.current.data![0].isHidden).toBe(true);
  });

  it("updateToken calls apiClient.put with snake_case patch for targetExitPrice", async () => {
    mockGet.mockResolvedValueOnce([mockTokenRow]);
    const updatedRow = { ...mockTokenRow, target_exit_price: "5000.00" };
    mockPut.mockResolvedValueOnce(updatedRow);

    const { result } = renderHook(() => useSettingsTokens());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateToken("token-1", { targetExitPrice: "5000.00" });
    });

    expect(mockPut).toHaveBeenCalledWith("/api/tokens/token-1", {
      target_exit_price: "5000.00",
    });
    expect(result.current.data![0].targetExitPrice).toBe("5000.00");
  });

  it("updateToken sends null for targetExitPrice when null is passed", async () => {
    mockGet.mockResolvedValueOnce([mockTokenRow]);
    const updatedRow = { ...mockTokenRow, target_exit_price: null };
    mockPut.mockResolvedValueOnce(updatedRow);

    const { result } = renderHook(() => useSettingsTokens());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateToken("token-1", { targetExitPrice: null });
    });

    expect(mockPut).toHaveBeenCalledWith("/api/tokens/token-1", {
      target_exit_price: null,
    });
    expect(result.current.data![0].targetExitPrice).toBeNull();
  });

  it("updateToken throws error and data does not change when PUT rejects", async () => {
    mockGet.mockResolvedValueOnce([mockTokenRow]);
    mockPut.mockRejectedValueOnce(new Error("HTTP 500"));

    const { result } = renderHook(() => useSettingsTokens());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      act(async () => {
        await result.current.updateToken("token-1", { isHidden: true });
      }),
    ).rejects.toThrow("HTTP 500");

    // data should remain unchanged since PUT failed
    expect(result.current.data![0].isHidden).toBe(false);
  });

  it("sets error when initial fetch rejects", async () => {
    mockGet.mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useSettingsTokens());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).not.toBeNull();
    expect(result.current.data).toBeNull();
  });
});
