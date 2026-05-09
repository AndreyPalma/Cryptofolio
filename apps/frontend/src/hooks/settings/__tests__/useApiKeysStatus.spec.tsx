import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useApiKeysStatus } from "../useApiKeysStatus";

vi.mock("../../../lib/api-client", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

import { apiClient } from "../../../lib/api-client";
const mockGet = vi.mocked(apiClient.get);

const mockPresence = {
  ETHERSCAN_API_KEY: true,
  BSCTRACE_API_KEY: false,
  BINANCE_API_KEY: true,
  BINANCE_SECRET_KEY: true,
};

describe("useApiKeysStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches credentials and returns ApiKeysPresence data", async () => {
    mockGet.mockResolvedValueOnce(mockPresence);

    const { result } = renderHook(() => useApiKeysStatus());

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(mockPresence);
    expect(result.current.error).toBeNull();
  });

  it("calls GET /api/credentials exactly once (no refetch exposed)", async () => {
    mockGet.mockResolvedValueOnce(mockPresence);

    const { result } = renderHook(() => useApiKeysStatus());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith("/api/credentials");
  });

  it("does not expose a refetch function", async () => {
    mockGet.mockResolvedValueOnce(mockPresence);
    const { result } = renderHook(() => useApiKeysStatus());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The hook result should only have data, loading, error
    const keys = Object.keys(result.current);
    expect(keys).not.toContain("refetch");
  });

  it("sets error when fetch fails", async () => {
    mockGet.mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useApiKeysStatus());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).not.toBeNull();
    expect(result.current.error!.message).toBe("Network error");
    expect(result.current.data).toBeNull();
  });
});
