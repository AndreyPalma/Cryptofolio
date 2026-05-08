/**
 * Tests for PortfolioRow component
 * Phase 5 — RED
 */
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PortfolioRow } from "../src/components/dashboard/PortfolioRow";
import type { PortfolioItem } from "../src/types/portfolio";

const baseItem: PortfolioItem = {
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
};

const multiWalletItem: PortfolioItem = {
  ...baseItem,
  walletCount: 3,
  walletBreakdown: [
    { walletId: "0xABCD", label: "Main", balance: "2.0", wac: "2000.00" },
    { walletId: "0xEF12", label: "Cold", balance: "2.0", wac: "2000.00" },
    { walletId: "0x3456", label: null, balance: "1.0", wac: "2000.00" },
  ],
};

const cexItem: PortfolioItem = {
  ...baseItem,
  network: "CEX_BINANCE",
  sourceType: "CEX",
  walletCount: 1,
  walletBreakdown: [
    {
      walletId: "binance-id",
      label: null,
      balance: "5.0",
      wac: "2000.00",
    },
  ],
};

const priceUnavailableItem: PortfolioItem = {
  ...baseItem,
  priceUnavailable: true,
  currentPrice: null,
  totalCurrentValue: null,
  pnlUsd: null,
  pnlPct: null,
};

// priceUnavailable=true but values are non-null (server returned stale data)
const priceUnavailableWithValuesItem: PortfolioItem = {
  ...baseItem,
  priceUnavailable: true,
  currentPrice: "2500.00",
  totalCurrentValue: "12500.00",
  pnlUsd: "2500.00",
  pnlPct: "25.00",
};

function renderRow(item: PortfolioItem) {
  return render(
    <MemoryRouter>
      <table>
        <tbody>
          <PortfolioRow item={item} />
        </tbody>
      </table>
    </MemoryRouter>,
  );
}

describe("PortfolioRow", () => {
  it("T-061: symbol cell renders a Link navigating to /token/:contractAddress/:network", () => {
    const itemWithAddress: PortfolioItem = {
      ...baseItem,
      contractAddress: "0xabc",
    };
    const { container } = renderRow(itemWithAddress);
    const link = container.querySelector("a[href='/token/0xabc/ETH']");
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain("ETH");
  });

  it("collapsed by default: expanded sub-row NOT in DOM", () => {
    const { container } = renderRow(baseItem);
    // Should only be 1 tr initially
    const trs = container.querySelectorAll("tr");
    expect(trs.length).toBe(1);
  });

  it("click expand button: aria-expanded becomes true, PortfolioRowExpanded renders", () => {
    const { container } = renderRow(baseItem);
    const button = container.querySelector("button");
    expect(button).not.toBeNull();

    fireEvent.click(button!);

    expect(button!.getAttribute("aria-expanded")).toBe("true");
    // After expand, there should be more than 1 tr
    const trs = container.querySelectorAll("tr");
    expect(trs.length).toBeGreaterThan(1);
  });

  it("click expand again: collapses, sub-row removed", () => {
    const { container } = renderRow(baseItem);
    const button = container.querySelector("button")!;

    fireEvent.click(button);
    fireEvent.click(button);

    expect(button.getAttribute("aria-expanded")).toBe("false");
    const trs = container.querySelectorAll("tr");
    expect(trs.length).toBe(1);
  });

  it("priceUnavailable=true: Current Price cell renders '—'", () => {
    const { container } = renderRow(priceUnavailableItem);
    // Look for the price unavailable dash in the cells
    const cells = container.querySelectorAll("td");
    const dashCells = Array.from(cells).filter(
      (td) => td.textContent === "—",
    );
    expect(dashCells.length).toBeGreaterThan(0);
  });

  it("ON_CHAIN with walletCount > 1: renders wallet-count pill", () => {
    const { container } = renderRow(multiWalletItem);
    expect(container.textContent).toContain("3 wallets");
  });

  it("ON_CHAIN with walletCount=1: no wallet-count pill", () => {
    const { container } = renderRow(baseItem);
    expect(container.textContent).not.toContain("wallets");
  });

  it("CEX row: no wallet-count pill", () => {
    const { container } = renderRow(cexItem);
    expect(container.textContent).not.toContain("wallets");
  });

  it("renders NetworkBadge component", () => {
    const { container } = renderRow(baseItem);
    // NetworkBadge renders a span with a network label
    expect(container.textContent).toContain("Ethereum");
  });

  it("renders TokenLogo component (wrapper div present)", () => {
    const { container } = renderRow(baseItem);
    // TokenLogo renders a div wrapper
    const logoWrapper = container.querySelector("td div");
    expect(logoWrapper).not.toBeNull();
  });

  it("priceUnavailable=true with non-null values: value/price cells still render '—'", () => {
    const { container } = renderRow(priceUnavailableWithValuesItem);
    // Price cell and value cell must show dash even when values are non-null
    const cells = container.querySelectorAll("td");
    const dashCells = Array.from(cells).filter(
      (td) => td.textContent === "—",
    );
    // At minimum: currentPrice + totalCurrentValue = 2 dash cells
    expect(dashCells.length).toBeGreaterThanOrEqual(2);
    // Must NOT contain the raw numeric values
    expect(container.textContent).not.toContain("$2,500.00");
    expect(container.textContent).not.toContain("$12,500.00");
  });
});
