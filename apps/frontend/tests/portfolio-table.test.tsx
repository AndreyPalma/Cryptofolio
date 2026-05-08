/**
 * Tests for PortfolioTable component
 * Phase 5 — RED
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PortfolioTable } from "../src/components/dashboard/PortfolioTable";
import type { PortfolioItem } from "../src/types/portfolio";

const makeItem = (
  overrides: Partial<PortfolioItem> & Pick<PortfolioItem, "symbol" | "network">,
): PortfolioItem => ({
  sourceType: "ON_CHAIN",
  contractAddress: null,
  binanceSymbol: null,
  totalBalance: "1.5",
  wacAggregated: "2000.00",
  totalCostBasis: "3000.00",
  currentPrice: "2500.00",
  totalCurrentValue: "3750.00",
  pnlUsd: "750.00",
  pnlPct: "25.00",
  walletCount: 1,
  walletBreakdown: [
    { walletId: "0xABCD", label: "Main", balance: "1.5", wac: "2000.00" },
  ],
  priceUnavailable: false,
  ...overrides,
});

const ethOnChain = makeItem({ symbol: "ETH", network: "ETH" });
const ethCex = makeItem({
  symbol: "ETH",
  network: "CEX_BINANCE",
  sourceType: "CEX",
  walletBreakdown: [
    {
      walletId: "binance-id",
      label: null,
      balance: "1.5",
      wac: "2000.00",
    },
  ],
});
const zeroBalanceItem = makeItem({
  symbol: "DOGE",
  network: "ETH",
  totalBalance: "0",
});
const multiWalletItem = makeItem({
  symbol: "BTC",
  network: "ETH",
  walletCount: 3,
  walletBreakdown: [
    { walletId: "0xW1", label: "W1", balance: "0.5", wac: "30000.00" },
    { walletId: "0xW2", label: "W2", balance: "0.5", wac: "30000.00" },
    { walletId: "0xW3", label: null, balance: "0.5", wac: "30000.00" },
  ],
});
const priceUnavailableItem = makeItem({
  symbol: "XYZ",
  network: "ETH",
  priceUnavailable: true,
  currentPrice: null,
  totalCurrentValue: null,
  pnlUsd: null,
  pnlPct: null,
});

function renderWithRouter(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("PortfolioTable", () => {
  it("zero-balance item not rendered in DOM", () => {
    const { container } = renderWithRouter(
      <PortfolioTable items={[ethOnChain, zeroBalanceItem]} />,
    );
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(1);
    expect(container.textContent).not.toContain("DOGE");
  });

  it("non-zero item rendered", () => {
    const { container } = renderWithRouter(
      <PortfolioTable items={[ethOnChain]} />,
    );
    expect(container.textContent).toContain("ETH");
  });

  it("empty items array renders PortfolioTableEmptyState, no <table>", () => {
    const { container } = renderWithRouter(<PortfolioTable items={[]} />);
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("Add your first wallet");
  });

  it("all-zero-balance items after filter renders PortfolioTableEmptyState", () => {
    const { container } = renderWithRouter(
      <PortfolioTable items={[zeroBalanceItem]} />,
    );
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("Add your first wallet");
  });

  it("domain invariant: ETH on-chain and ETH CEX_BINANCE render as two distinct rows", () => {
    const { container } = renderWithRouter(
      <PortfolioTable items={[ethOnChain, ethCex]} />,
    );
    const rows = container.querySelectorAll("tbody tr");
    // 2 rows (both have ETH symbol but different network)
    expect(rows.length).toBe(2);
    // Both rows are present
    expect(container.textContent?.match(/ETH/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("ON_CHAIN row with walletBreakdown.length > 1 shows wallet-count badge", () => {
    const { container } = renderWithRouter(
      <PortfolioTable items={[multiWalletItem]} />,
    );
    expect(container.textContent).toContain("3 wallets");
  });

  it("CEX row has no wallet-count badge", () => {
    const { container } = renderWithRouter(
      <PortfolioTable items={[ethCex]} />,
    );
    expect(container.textContent).not.toContain("wallets");
  });

  it("priceUnavailable=true row: Current Price cell renders '—'", () => {
    const { container } = renderWithRouter(
      <PortfolioTable items={[priceUnavailableItem]} />,
    );
    const cells = container.querySelectorAll("td");
    const dashCells = Array.from(cells).filter(
      (td) => td.textContent === "—",
    );
    expect(dashCells.length).toBeGreaterThan(0);
  });

  it("renders <th> elements for all column headers", () => {
    const { container } = renderWithRouter(
      <PortfolioTable items={[ethOnChain]} />,
    );
    const headers = container.querySelectorAll("th");
    // 11 columns (including empty ones for expand/logo)
    expect(headers.length).toBe(11);
  });
});
