/**
 * Tests for PortfolioRowExpanded component
 * Phase 5 — RED
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PortfolioRowExpanded } from "../src/components/dashboard/PortfolioRowExpanded";
import type { PortfolioItem } from "../src/types/portfolio";

const cexItem: PortfolioItem = {
  symbol: "BTC",
  network: "CEX_BINANCE",
  sourceType: "CEX",
  contractAddress: null,
  binanceSymbol: "BTCUSDT",
  totalBalance: "0.5",
  wacAggregated: "30000.00",
  totalCostBasis: "15000.00",
  currentPrice: "35000.00",
  totalCurrentValue: "17500.00",
  pnlUsd: "2500.00",
  pnlPct: "16.67",
  walletCount: 1,
  walletBreakdown: [
    {
      walletId: "binance-wallet-id",
      label: null,
      balance: "0.5",
      wac: "30000.00",
    },
  ],
  priceUnavailable: false,
};

const onChainItem: PortfolioItem = {
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
  walletCount: 2,
  walletBreakdown: [
    {
      walletId: "0xABCDEF1234567890",
      label: "My Wallet",
      balance: "3.0",
      wac: "2000.00",
    },
    {
      walletId: "0x1234567890ABCDEF",
      label: null,
      balance: "2.0",
      wac: "2000.00",
    },
  ],
  priceUnavailable: false,
};

describe("PortfolioRowExpanded", () => {
  it("CEX item renders exactly one sub-row labeled 'Binance Account'", () => {
    const { getByText } = render(
      <table>
        <tbody>
          <PortfolioRowExpanded item={cexItem} />
        </tbody>
      </table>,
    );
    expect(getByText("Binance Account")).toBeDefined();
  });

  it("ON_CHAIN item with 2 wallet entries renders 2 sub-rows", () => {
    const { container } = render(
      <table>
        <tbody>
          <PortfolioRowExpanded item={onChainItem} />
        </tbody>
      </table>,
    );
    // Each wallet entry is a row in the INNER table inside the expanded row
    const innerTable = container.querySelector("td > table");
    expect(innerTable).not.toBeNull();
    const innerRows = innerTable!.querySelectorAll("tbody tr");
    expect(innerRows.length).toBe(2);
  });

  it("sub-row uses entry.label when not null", () => {
    const { getByText } = render(
      <table>
        <tbody>
          <PortfolioRowExpanded item={onChainItem} />
        </tbody>
      </table>,
    );
    expect(getByText("My Wallet")).toBeDefined();
  });

  it("sub-row falls back to truncated walletId when label is null", () => {
    const { container } = render(
      <table>
        <tbody>
          <PortfolioRowExpanded item={onChainItem} />
        </tbody>
      </table>,
    );
    // walletId "0x1234567890ABCDEF" → "0x1234…CDEF"
    expect(container.textContent).toContain("0x1234");
    expect(container.textContent).toContain("CDEF");
  });

  it("priceUnavailable=true → P&L columns render '—'", () => {
    const itemNoPnl: PortfolioItem = {
      ...cexItem,
      priceUnavailable: true,
      currentPrice: null,
    };
    const { container } = render(
      <table>
        <tbody>
          <PortfolioRowExpanded item={itemNoPnl} />
        </tbody>
      </table>,
    );
    // Should have '—' for P&L cells
    const dashes = container.querySelectorAll(".text-gray-400");
    expect(dashes.length).toBeGreaterThan(0);
  });

  it("wac=0 with price present → pnlPct is null, renders '—' for pct column", () => {
    const itemZeroWac: PortfolioItem = {
      ...cexItem,
      walletBreakdown: [
        {
          walletId: "binance-wallet-id",
          label: null,
          balance: "0.5",
          wac: "0",
        },
      ],
    };
    const { container } = render(
      <table>
        <tbody>
          <PortfolioRowExpanded item={itemZeroWac} />
        </tbody>
      </table>,
    );
    // pnlPct should be '—' (gray-400) for wac=0
    const dashes = container.querySelectorAll(".text-gray-400");
    expect(dashes.length).toBeGreaterThan(0);
  });

  it("empty walletBreakdown on CEX item → renders no sub-rows without crash", () => {
    const itemNoBreakdown: PortfolioItem = {
      ...cexItem,
      walletBreakdown: [],
    };
    expect(() =>
      render(
        <table>
          <tbody>
            <PortfolioRowExpanded item={itemNoBreakdown} />
          </tbody>
        </table>,
      ),
    ).not.toThrow();
  });
});
