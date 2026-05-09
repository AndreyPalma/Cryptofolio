import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/settings/useSettingsWallets", () => ({
  useSettingsWallets: vi.fn(),
}));
vi.mock("../../../hooks/settings/useSyncWallet", () => ({
  useSyncWallet: vi.fn(),
}));
vi.mock("../../../hooks/settings/usePendingPriceTransfers", () => ({
  usePendingPriceTransfers: vi.fn(),
}));

import { useSettingsWallets } from "../../../hooks/settings/useSettingsWallets";
import { useSyncWallet } from "../../../hooks/settings/useSyncWallet";
import { usePendingPriceTransfers } from "../../../hooks/settings/usePendingPriceTransfers";
import { OnChainWalletsSection } from "../OnChainWalletsSection";

const mockUseSettingsWallets = vi.mocked(useSettingsWallets);
const mockUseSyncWallet = vi.mocked(useSyncWallet);
const mockUsePendingPriceTransfers = vi.mocked(usePendingPriceTransfers);

const mockWallet = {
  id: "wallet-1",
  walletType: "ON_CHAIN" as const,
  address: "0x1234567890abcdef",
  network: "ETH",
  label: "My ETH Wallet",
  lastSyncedAt: new Date("2026-01-01T12:00:00.000Z"),
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
};

function makeDefaultSyncHook(syncFn = vi.fn().mockResolvedValue(undefined)) {
  return {
    states: {},
    sync: syncFn,
  };
}

function renderSection() {
  return render(
    <MemoryRouter>
      <OnChainWalletsSection />
    </MemoryRouter>,
  );
}

describe("OnChainWalletsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePendingPriceTransfers.mockReturnValue({
      data: { transactions: [], count: 0 },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("renders address truncated to first 6 + ... + last 4 chars", () => {
    mockUseSettingsWallets.mockReturnValue({
      data: [mockWallet],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseSyncWallet.mockReturnValue(makeDefaultSyncHook());

    const { container } = renderSection();
    // 0x1234...cdef
    expect(container.textContent).toContain("0x1234");
    expect(container.textContent).toContain("cdef");
  });

  it("shows wallet label", () => {
    mockUseSettingsWallets.mockReturnValue({
      data: [mockWallet],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseSyncWallet.mockReturnValue(makeDefaultSyncHook());

    renderSection();
    expect(screen.getByText("My ETH Wallet")).not.toBeNull();
  });

  it("copy button calls navigator.clipboard.writeText with full address", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    mockUseSettingsWallets.mockReturnValue({
      data: [mockWallet],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseSyncWallet.mockReturnValue(makeDefaultSyncHook());

    const { container } = renderSection();
    const copyBtn = container.querySelector("[data-testid='copy-btn']") as HTMLButtonElement;
    expect(copyBtn).not.toBeNull();

    await act(async () => {
      fireEvent.click(copyBtn!);
    });

    expect(writeText).toHaveBeenCalledWith("0x1234567890abcdef");
  });

  it("copy button shows 'Copied!' after click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    mockUseSettingsWallets.mockReturnValue({
      data: [mockWallet],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseSyncWallet.mockReturnValue(makeDefaultSyncHook());

    const { container } = renderSection();
    const copyBtn = container.querySelector("[data-testid='copy-btn']") as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(copyBtn!);
    });

    await waitFor(() => {
      expect(copyBtn.textContent).toContain("Copied");
    });
  });

  it("Sync button calls sync with walletId", async () => {
    const syncFn = vi.fn().mockResolvedValue(undefined);
    mockUseSettingsWallets.mockReturnValue({
      data: [mockWallet],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseSyncWallet.mockReturnValue({
      states: {},
      sync: syncFn,
    });

    renderSection();
    const syncBtn = screen.getByRole("button", { name: /sync/i });
    fireEvent.click(syncBtn);

    await waitFor(() => {
      expect(syncFn).toHaveBeenCalledWith("wallet-1", "on-chain");
    });
  });

  it("Sync button is disabled and shows 'Syncing...' during in-flight", () => {
    mockUseSettingsWallets.mockReturnValue({
      data: [mockWallet],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseSyncWallet.mockReturnValue({
      states: { "wallet-1": { status: "syncing" } },
      sync: vi.fn(),
    });

    const { container } = renderSection();
    const syncBtn = container.querySelector("button[disabled]");
    expect(syncBtn).not.toBeNull();
    expect(syncBtn?.textContent).toContain("Syncing");
  });

  it("shows SyncResultInline after successful sync", () => {
    mockUseSettingsWallets.mockReturnValue({
      data: [mockWallet],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseSyncWallet.mockReturnValue({
      states: {
        "wallet-1": {
          status: "success",
          result: {
            kind: "on-chain",
            synced: 7,
            skipped: 1,
            swapsDecomposed: 0,
            transfersPendingCost: 0,
            transfersInheritedFromCEX: 0,
          },
          finishedAt: new Date(),
        },
      },
      sync: vi.fn(),
    });

    const { container } = renderSection();
    expect(container.textContent).toContain("7");
  });

  it("shows 'Never synced' when lastSyncedAt is null", () => {
    mockUseSettingsWallets.mockReturnValue({
      data: [{ ...mockWallet, lastSyncedAt: null }],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseSyncWallet.mockReturnValue(makeDefaultSyncHook());

    const { container } = renderSection();
    expect(container.textContent?.toLowerCase()).toContain("never");
  });

  it("shows empty state when no on-chain wallets", () => {
    mockUseSettingsWallets.mockReturnValue({
      data: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseSyncWallet.mockReturnValue(makeDefaultSyncHook());

    const { container } = renderSection();
    expect(container.textContent?.toLowerCase()).toContain("no on-chain");
  });

  it("shows error state with retry button when data fetch fails", () => {
    mockUseSettingsWallets.mockReturnValue({
      data: null,
      loading: false,
      error: new Error("Network error"),
      refetch: vi.fn(),
    });
    mockUseSyncWallet.mockReturnValue(makeDefaultSyncHook());

    const { container } = renderSection();
    expect(container.textContent?.toLowerCase()).toContain("error");
    const retryBtn = container.querySelector("button");
    expect(retryBtn).not.toBeNull();
  });

  it("shows inline error when sync fails", () => {
    mockUseSettingsWallets.mockReturnValue({
      data: [mockWallet],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseSyncWallet.mockReturnValue({
      states: {
        "wallet-1": { status: "error", message: "Sync failed: timeout" },
      },
      sync: vi.fn(),
    });

    const { container } = renderSection();
    expect(container.textContent).toContain("Sync failed");
  });

  it("calls walletsRefetch and pendingRefetch after sync completes", async () => {
    const refetchWallets = vi.fn().mockResolvedValue(undefined);
    const refetchPending = vi.fn().mockResolvedValue(undefined);
    const syncFn = vi.fn().mockResolvedValue(undefined);

    mockUseSettingsWallets.mockReturnValue({
      data: [mockWallet],
      loading: false,
      error: null,
      refetch: refetchWallets,
    });
    mockUseSyncWallet.mockReturnValue({ states: {}, sync: syncFn });
    mockUsePendingPriceTransfers.mockReturnValue({
      data: { transactions: [], count: 0 },
      loading: false,
      error: null,
      refetch: refetchPending,
    });

    renderSection();
    const syncBtn = screen.getByRole("button", { name: /sync/i });
    fireEvent.click(syncBtn);

    await waitFor(() => {
      expect(syncFn).toHaveBeenCalledWith("wallet-1", "on-chain");
    });
    await waitFor(() => {
      expect(refetchWallets).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(refetchPending).toHaveBeenCalled();
    });
  });
});
