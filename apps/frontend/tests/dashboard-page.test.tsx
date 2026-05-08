/**
 * Integration tests for DashboardPage
 * Phase 6 — RED
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
import { render, waitFor, act, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DashboardPage } from "../src/pages/DashboardPage";
import type { PortfolioResponse } from "../src/types/portfolio";

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

const mockData: PortfolioResponse = {
  totalValueUsd: "10000.00",
  totalCostBasis: "8000.00",
  totalPnlUsd: "2000.00",
  totalPnlPct: "25.00",
  tokens: [
    {
      symbol: "ETH",
      network: "ETH",
      sourceType: "ON_CHAIN",
      contractAddress: null,
      binanceSymbol: null,
      totalBalance: "5.0",
      wacAggregated: "2000.00",
      totalCostBasis: "10000.00",
      currentPrice: "2500.00",
      totalCurrentValue: "12500.00",
      pnlUsd: "2500.00",
      pnlPct: "25.00",
      walletCount: 1,
      walletBreakdown: [
        { walletId: "0xABCD", label: "Main", balance: "5.0", wac: "2000.00" },
      ],
      priceUnavailable: false,
    },
  ],
};

const emptyData: PortfolioResponse = {
  totalValueUsd: "0.00",
  totalCostBasis: "0.00",
  totalPnlUsd: "0.00",
  totalPnlPct: null,
  tokens: [],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe("DashboardPage", () => {
  let mockGet: Mock;

  beforeEach(async () => {
    const { apiClient } = await import("../src/lib/api-client");
    mockGet = apiClient.get as Mock;
    mockGet.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("while fetch pending: skeleton renders, no <table> in DOM", () => {
    // Never resolves — keep loading
    mockGet.mockReturnValue(new Promise(() => {}));

    const { container } = renderPage();

    // Skeleton should be present (animate-pulse elements)
    const pulseEls = container.querySelectorAll(".animate-pulse");
    expect(pulseEls.length).toBeGreaterThan(0);

    // No portfolio table yet
    expect(container.querySelector("table")).toBeNull();
  });

  it("after fetch resolves: SummaryCards and PortfolioTable render", async () => {
    mockGet.mockResolvedValue(mockData);

    const { container, getByText } = renderPage();

    await waitFor(() => {
      expect(container.querySelector("table")).not.toBeNull();
    });

    expect(getByText("Total Portfolio Value")).toBeDefined();
    expect(getByText("ETH")).toBeDefined();
  });

  it("after fetch resolves with empty tokens: PortfolioTableEmptyState renders, SummaryCards still renders", async () => {
    mockGet.mockResolvedValue(emptyData);

    const { container, getByText } = renderPage();

    await waitFor(() => {
      expect(getByText("Total Portfolio Value")).toBeDefined();
    });

    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("Add your first wallet");
  });

  it("fetch rejects: error card with 'Couldn't load portfolio.' text and Retry button", async () => {
    mockGet.mockRejectedValue(new Error("Network fail"));

    const { getByText } = renderPage();

    await waitFor(() => {
      expect(getByText(/Couldn't load portfolio/)).toBeDefined();
    });

    expect(getByText("Retry")).toBeDefined();
  });

  it("click Retry: apiClient.get called again", async () => {
    mockGet.mockRejectedValueOnce(new Error("Network fail"));
    mockGet.mockResolvedValueOnce(mockData);

    const { getByText } = renderPage();

    await waitFor(() => {
      expect(getByText(/Couldn't load portfolio/)).toBeDefined();
    });

    const retryButton = getByText("Retry");
    await act(async () => {
      fireEvent.click(retryButton);
    });

    await waitFor(() => {
      expect(mockGet.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("error card uses aria-live='polite' region", async () => {
    mockGet.mockRejectedValue(new Error("Network fail"));

    const { container } = renderPage();

    await waitFor(() => {
      const liveRegion = container.querySelector('[aria-live="polite"]');
      expect(liveRegion).not.toBeNull();
    });
  });

  it("stale-while-error: old data stays visible and [Retry] button appears after background refetch fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // First call succeeds — initial load
    mockGet.mockResolvedValueOnce(mockData);
    // Second call fails — background refetch after 60s
    mockGet.mockRejectedValueOnce(new Error("Network fail"));

    const { container } = renderPage();

    // Flush the initial fetch
    await act(async () => {
      await vi.runAllTicks();
    });

    await waitFor(
      () => {
        expect(container.querySelector("table")).not.toBeNull();
      },
      { timeout: 3000 },
    );

    // Advance 60s to trigger the background refetch interval
    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await vi.runAllTicks();
    });

    // Old data must still be visible after the background refetch failed
    await waitFor(
      () => {
        expect(container.querySelector("table")).not.toBeNull();
        expect(container.textContent).toContain("ETH");
      },
      { timeout: 3000 },
    );

    // Stale indicator — [Retry] button from RefreshIndicator (stale=true)
    const retryButtons = screen.queryAllByText("[Retry]");
    expect(retryButtons.length).toBeGreaterThan(0);

    vi.useRealTimers();
  });
});
