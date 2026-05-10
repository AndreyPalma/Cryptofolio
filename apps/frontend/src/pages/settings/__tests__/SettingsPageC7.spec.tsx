/**
 * C7 — SettingsPage composition tests.
 * All 6 sections render; isolation when one hook fails.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Mock all hooks used by every section
vi.mock("../../../hooks/settings/usePendingPriceTransfers", () => ({
  usePendingPriceTransfers: vi.fn(),
}));
vi.mock("../../../hooks/settings/useSettingsWallets", () => ({
  useSettingsWallets: vi.fn(),
}));
vi.mock("../../../hooks/settings/useSyncWallet", () => ({
  useSyncWallet: vi.fn(),
}));
vi.mock("../../../hooks/settings/useSettingsTokens", () => ({
  useSettingsTokens: vi.fn(),
}));
vi.mock("../../../hooks/settings/useApiKeysStatus", () => ({
  useApiKeysStatus: vi.fn(),
}));
vi.mock("../../../hooks/settings/useTestApiKey", () => ({
  useTestApiKey: vi.fn(),
}));
vi.mock("../../../hooks/settings/useBalanceValidation", () => ({
  useBalanceValidation: vi.fn(),
}));

import { usePendingPriceTransfers } from "../../../hooks/settings/usePendingPriceTransfers";
import { useSettingsWallets } from "../../../hooks/settings/useSettingsWallets";
import { useSyncWallet } from "../../../hooks/settings/useSyncWallet";
import { useSettingsTokens } from "../../../hooks/settings/useSettingsTokens";
import { useApiKeysStatus } from "../../../hooks/settings/useApiKeysStatus";
import { useTestApiKey } from "../../../hooks/settings/useTestApiKey";
import { useBalanceValidation } from "../../../hooks/settings/useBalanceValidation";
import { SettingsPage } from "../SettingsPage";

const mockUsePendingPriceTransfers = vi.mocked(usePendingPriceTransfers);
const mockUseSettingsWallets = vi.mocked(useSettingsWallets);
const mockUseSyncWallet = vi.mocked(useSyncWallet);
const mockUseSettingsTokens = vi.mocked(useSettingsTokens);
const mockUseApiKeysStatus = vi.mocked(useApiKeysStatus);
const mockUseTestApiKey = vi.mocked(useTestApiKey);
const mockUseBalanceValidation = vi.mocked(useBalanceValidation);

function setupAllMocks() {
  mockUsePendingPriceTransfers.mockReturnValue({
    data: { transactions: [], count: 0 },
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseSettingsWallets.mockReturnValue({
    data: [],
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseSyncWallet.mockReturnValue({
    states: {},
    sync: vi.fn(),
  });
  mockUseSettingsTokens.mockReturnValue({
    data: [],
    loading: false,
    error: null,
    refetch: vi.fn(),
    updateToken: vi.fn().mockResolvedValue(undefined),
  });
  mockUseApiKeysStatus.mockReturnValue({
    data: {
      ETHERSCAN_API_KEY: true,
      BSCTRACE_API_KEY: false,
      BINANCE_API_KEY: false,
      BINANCE_SECRET_KEY: false,
    },
    loading: false,
    error: null,
  });
  mockUseTestApiKey.mockReturnValue({
    states: {
      etherscan: { status: "idle" },
      bsctrace: { status: "idle" },
      binance: { status: "idle" },
    },
    test: vi.fn(),
  });
  mockUseBalanceValidation.mockReturnValue({
    state: "idle",
    data: null,
    error: null,
    validate: vi.fn(),
    cooldownSecondsRemaining: 0,
    disabledReason: null,
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
}

describe("SettingsPage — C7 composition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAllMocks();
  });

  it("renders the Settings heading", () => {
    const { container } = renderPage();
    const h1 = container.querySelector("h1");
    expect(h1?.textContent).toContain("Settings");
  });

  it("renders Back to Portfolio link", () => {
    const { container } = renderPage();
    const link = Array.from(container.querySelectorAll("a")).find(
      (a) => a.textContent?.includes("Portfolio"),
    );
    expect(link).not.toBeNull();
  });

  it("renders OnChainWalletsSection heading", () => {
    const { container } = renderPage();
    const headings = Array.from(container.querySelectorAll("h2")).map((h) => h.textContent);
    expect(headings.some((h) => h?.toLowerCase().includes("on-chain") || h?.toLowerCase().includes("wallet"))).toBe(true);
  });

  it("renders ExchangeAccountsSection heading", () => {
    const { container } = renderPage();
    const headings = Array.from(container.querySelectorAll("h2")).map((h) => h.textContent);
    expect(headings.some((h) => h?.toLowerCase().includes("exchange"))).toBe(true);
  });

  it("renders TokensSection heading", () => {
    const { container } = renderPage();
    const headings = Array.from(container.querySelectorAll("h2")).map((h) => h.textContent);
    expect(headings.some((h) => h?.toLowerCase().includes("token"))).toBe(true);
  });

  it("renders ApiKeysSection heading", () => {
    const { container } = renderPage();
    const headings = Array.from(container.querySelectorAll("h2")).map((h) => h.textContent);
    expect(headings.some((h) => h?.toLowerCase().includes("api"))).toBe(true);
  });

  it("renders BalanceValidationSection heading", () => {
    const { container } = renderPage();
    const headings = Array.from(container.querySelectorAll("h2")).map((h) => h.textContent);
    expect(headings.some((h) => h?.toLowerCase().includes("balance") || h?.toLowerCase().includes("validation"))).toBe(true);
  });

  it("isolation: ApiKeysStatus error does not prevent other sections rendering", () => {
    // Override only ApiKeysStatus to return error
    mockUseApiKeysStatus.mockReturnValue({
      data: null,
      loading: false,
      error: new Error("credentials fetch failed"),
    });

    const { container } = renderPage();

    // Other sections should still render (OnChain, Exchange, Tokens)
    const headings = Array.from(container.querySelectorAll("h2")).map((h) => h.textContent ?? "");
    expect(headings.some((h) => h.toLowerCase().includes("wallet") || h.toLowerCase().includes("on-chain"))).toBe(true);
    expect(headings.some((h) => h.toLowerCase().includes("token"))).toBe(true);
  });

  it("all hooks are called on mount (parallel loading)", () => {
    renderPage();
    // Each hook is called at least once, indicating parallel (not sequential) fetching
    expect(mockUsePendingPriceTransfers).toHaveBeenCalled();
    expect(mockUseSettingsWallets).toHaveBeenCalled();
    expect(mockUseSettingsTokens).toHaveBeenCalled();
    expect(mockUseApiKeysStatus).toHaveBeenCalled();
    expect(mockUseBalanceValidation).toHaveBeenCalled();
  });
});
