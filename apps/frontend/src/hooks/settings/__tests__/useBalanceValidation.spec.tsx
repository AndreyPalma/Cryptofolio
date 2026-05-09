import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBalanceValidation } from "../useBalanceValidation";

vi.mock("../../../lib/api-client", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

vi.mock("../useApiKeysStatus", () => ({
  useApiKeysStatus: vi.fn(),
}));

vi.mock("../useSettingsWallets", () => ({
  useSettingsWallets: vi.fn(),
}));

import { apiClient } from "../../../lib/api-client";
import { useApiKeysStatus } from "../useApiKeysStatus";
import { useSettingsWallets } from "../useSettingsWallets";
const mockGet = vi.mocked(apiClient.get);
const mockUseApiKeysStatus = vi.mocked(useApiKeysStatus);
const mockUseSettingsWallets = vi.mocked(useSettingsWallets);

const mockCexWallet = {
  id: "wallet-cex",
  walletType: "CEX" as const,
  address: null,
  network: "CEX_BINANCE",
  label: "Binance",
  lastSyncedAt: null,
  createdAt: new Date("2025-01-01"),
};

const mockValidationResponse = {
  differences: [
    {
      asset: "ETH",
      engineBalance: "1.5",
      snapshotBalance: "1.4999",
      diff: "0.0001",
    },
  ],
  totalEngineUsd: "3000.00",
  totalSnapshotUsd: "2999.80",
  takenAt: "2026-05-08T10:00:00.000Z",
  dustNote: "Small differences are expected due to Binance dust conversion (non-goal in V1).",
};

describe("useBalanceValidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: wallet present + keys configured → disabledReason = null
    mockUseSettingsWallets.mockReturnValue({
      data: [mockCexWallet],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseApiKeysStatus.mockReturnValue({
      data: { ETHERSCAN_API_KEY: true, BSCTRACE_API_KEY: true, BINANCE_API_KEY: true, BINANCE_SECRET_KEY: true },
      loading: false,
      error: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT fetch on mount — state starts as idle", () => {
    const { result } = renderHook(() => useBalanceValidation());

    expect(result.current.state).toBe("idle");
    expect(result.current.data).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("validate() transitions idle → loading → success", async () => {
    mockGet.mockResolvedValueOnce(mockValidationResponse);

    const { result } = renderHook(() => useBalanceValidation());

    expect(result.current.state).toBe("idle");

    let validatePromise!: Promise<void>;
    act(() => {
      validatePromise = result.current.validate();
    });

    // Should be loading right after calling validate
    expect(result.current.state).toBe("loading");

    await act(async () => {
      await validatePromise;
    });

    expect(result.current.state).toBe("success");
    expect(result.current.data).not.toBeNull();
    expect(result.current.data!.differences.length).toBe(1);
    expect(result.current.data!.differences[0].asset).toBe("ETH");
    expect(result.current.error).toBeNull();
  });

  it("cooldownSecondsRemaining is 60 right after successful validate", async () => {
    vi.useFakeTimers();
    mockGet.mockResolvedValueOnce(mockValidationResponse);

    const { result } = renderHook(() => useBalanceValidation());

    await act(async () => {
      await result.current.validate();
    });

    expect(result.current.state).toBe("success");
    expect(result.current.cooldownSecondsRemaining).toBe(60);
  });

  it("cooldownSecondsRemaining decreases with time (fake timers)", async () => {
    vi.useFakeTimers();
    mockGet.mockResolvedValueOnce(mockValidationResponse);

    const { result } = renderHook(() => useBalanceValidation());

    await act(async () => {
      await result.current.validate();
    });

    expect(result.current.cooldownSecondsRemaining).toBe(60);

    // Advance 30 seconds
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(result.current.cooldownSecondsRemaining).toBe(30);

    // Advance another 30 seconds
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(result.current.cooldownSecondsRemaining).toBe(0);
  });

  it("sets state=error and error when apiClient.get rejects", async () => {
    mockGet.mockRejectedValueOnce(new Error("BINANCE_UNAVAILABLE"));

    const { result } = renderHook(() => useBalanceValidation());

    await act(async () => {
      await result.current.validate();
    });

    expect(result.current.state).toBe("error");
    expect(result.current.error).not.toBeNull();
    expect(result.current.error!.message).toBe("BINANCE_UNAVAILABLE");
    expect(result.current.data).toBeNull();
  });

  it("maps takenAt from string to Date", async () => {
    mockGet.mockResolvedValueOnce(mockValidationResponse);

    const { result } = renderHook(() => useBalanceValidation());

    await act(async () => {
      await result.current.validate();
    });

    expect(result.current.data!.takenAt).toBeInstanceOf(Date);
  });

  it("GET is called on validate(), not on mount", async () => {
    mockGet.mockResolvedValueOnce(mockValidationResponse);

    const { result } = renderHook(() => useBalanceValidation());

    // Not called at mount
    expect(mockGet).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.validate();
    });

    // Called after validate()
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith("/api/portfolio/validate-snapshot");
  });

  it("cooldownSecondsRemaining reaches 0 and stops at 0", async () => {
    vi.useFakeTimers();
    mockGet.mockResolvedValueOnce(mockValidationResponse);

    const { result } = renderHook(() => useBalanceValidation());

    await act(async () => {
      await result.current.validate();
    });

    // Advance past 60s
    act(() => {
      vi.advanceTimersByTime(70_000);
    });

    expect(result.current.cooldownSecondsRemaining).toBe(0);
  });

  it("disabledReason is null when wallet and keys are present", () => {
    const { result } = renderHook(() => useBalanceValidation());
    expect(result.current.disabledReason).toBeNull();
  });

  it("disabledReason is 'no-wallet' when no CEX_BINANCE wallet exists", () => {
    mockUseSettingsWallets.mockReturnValue({
      data: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useBalanceValidation());
    expect(result.current.disabledReason).toBe("no-wallet");
  });

  it("disabledReason is 'no-keys' when wallet exists but keys are missing", () => {
    mockUseApiKeysStatus.mockReturnValue({
      data: { ETHERSCAN_API_KEY: true, BSCTRACE_API_KEY: true, BINANCE_API_KEY: false, BINANCE_SECRET_KEY: false },
      loading: false,
      error: null,
    });

    const { result } = renderHook(() => useBalanceValidation());
    expect(result.current.disabledReason).toBe("no-keys");
  });
});
