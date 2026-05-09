import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
import { ExchangeAccountsSection } from "../ExchangeAccountsSection";

const mockUseSettingsWallets = vi.mocked(useSettingsWallets);
const mockUseSyncWallet = vi.mocked(useSyncWallet);
const mockUsePendingPriceTransfers = vi.mocked(usePendingPriceTransfers);

const mockCexWallet = {
  id: "wallet-cex",
  walletType: "CEX" as const,
  address: null,
  network: "CEX_BINANCE",
  label: "Binance",
  lastSyncedAt: new Date("2026-01-01T12:00:00.000Z"),
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
};

function renderSection() {
  return render(
    <MemoryRouter>
      <ExchangeAccountsSection />
    </MemoryRouter>,
  );
}

describe("ExchangeAccountsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePendingPriceTransfers.mockReturnValue({
      data: { transactions: [], count: 0 },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("shows 'Connected' badge when a CEX wallet exists", () => {
    mockUseSettingsWallets.mockReturnValue({
      data: [mockCexWallet],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseSyncWallet.mockReturnValue({ states: {}, sync: vi.fn() });

    const { container } = renderSection();
    expect(container.textContent).toContain("Connected");
  });

  it("shows 'Connected' badge even when lastSyncedAt is null", () => {
    mockUseSettingsWallets.mockReturnValue({
      data: [{ ...mockCexWallet, lastSyncedAt: null }],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseSyncWallet.mockReturnValue({ states: {}, sync: vi.fn() });

    const { container } = renderSection();
    expect(container.textContent).toContain("Connected");
  });

  it("shows 'Never synced' when lastSyncedAt is null", () => {
    mockUseSettingsWallets.mockReturnValue({
      data: [{ ...mockCexWallet, lastSyncedAt: null }],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseSyncWallet.mockReturnValue({ states: {}, sync: vi.fn() });

    const { container } = renderSection();
    expect(container.textContent?.toLowerCase()).toContain("never synced");
  });

  it("shows empty state message when no CEX wallet exists", () => {
    mockUseSettingsWallets.mockReturnValue({
      data: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseSyncWallet.mockReturnValue({ states: {}, sync: vi.fn() });

    const { container } = renderSection();
    expect(container.textContent?.toLowerCase()).toContain("no binance account");
  });

  it("calls sync with 'cex' kind when Sync button clicked", async () => {
    const syncFn = vi.fn().mockResolvedValue(undefined);
    mockUseSettingsWallets.mockReturnValue({
      data: [mockCexWallet],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseSyncWallet.mockReturnValue({ states: {}, sync: syncFn });

    renderSection();
    const syncBtn = screen.getByRole("button", { name: /sync/i });
    fireEvent.click(syncBtn);

    await waitFor(() => {
      expect(syncFn).toHaveBeenCalledWith("wallet-cex", "cex");
    });
  });

  it("renders CEX result with 4 sub-categories after sync", () => {
    mockUseSettingsWallets.mockReturnValue({
      data: [mockCexWallet],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseSyncWallet.mockReturnValue({
      states: {
        "wallet-cex": {
          status: "success",
          result: {
            kind: "cex",
            trades: { synced: 5, skipped: 1, symbolsProcessed: 2 },
            converts: { synced: 1, skipped: 0 },
            withdrawals: { synced: 0, skipped: 0 },
            deposits: { synced: 3, skipped: 0, inherited: 1, manual: 2 },
            tokensCreated: 0,
          },
          finishedAt: new Date(),
        },
      },
      sync: vi.fn(),
    });

    const { container } = renderSection();
    expect(container.textContent?.toLowerCase()).toContain("trade");
    expect(container.textContent?.toLowerCase()).toContain("convert");
    expect(container.textContent?.toLowerCase()).toContain("withdrawal");
    expect(container.textContent?.toLowerCase()).toContain("deposit");
  });

  it("shows inline error when sync fails", () => {
    mockUseSettingsWallets.mockReturnValue({
      data: [mockCexWallet],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseSyncWallet.mockReturnValue({
      states: {
        "wallet-cex": { status: "error", message: "CEX sync failed" },
      },
      sync: vi.fn(),
    });

    const { container } = renderSection();
    expect(container.textContent).toContain("CEX sync failed");
  });

  it("calls walletsRefetch and pendingRefetch after successful sync", async () => {
    const refetchWallets = vi.fn().mockResolvedValue(undefined);
    const refetchPending = vi.fn().mockResolvedValue(undefined);
    const syncFn = vi.fn().mockResolvedValue(undefined);

    mockUseSettingsWallets.mockReturnValue({
      data: [mockCexWallet],
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
      expect(syncFn).toHaveBeenCalledWith("wallet-cex", "cex");
    });
    await waitFor(() => {
      expect(refetchWallets).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(refetchPending).toHaveBeenCalled();
    });
  });
});
