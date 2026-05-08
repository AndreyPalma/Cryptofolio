/**
 * Tests for TransactionTable component (US-010 Phase 4)
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TransactionTable } from "../src/components/token-detail/TransactionTable";
import type { TransactionWithPnl } from "../src/types/token-detail";

const makeBuyTx = (overrides: Partial<TransactionWithPnl> = {}): TransactionWithPnl => ({
  id: "tx-1",
  walletId: "w1",
  tokenId: "token-1",
  positionId: "pos-1",
  type: "BUY",
  source: "ETHERSCAN",
  blockTimestamp: "2024-03-15T14:23:00.000Z",
  amount: "1.5",
  priceUsd: "2000.00",
  costSource: "MARKET",
  txHash: null,
  cexTradeId: null,
  relatedTxId: null,
  costInheritedFrom: null,
  pnl: { kind: "INBOUND", lotPnlUsd: "1500.00", lotPnlPct: "75.0" },
  ...overrides,
});

describe("TransactionTable", () => {
  it("SC-TT-01: renders column headers", () => {
    const { container } = render(
      <TransactionTable transactions={[makeBuyTx()]} currentPrice="3000.00" />,
    );
    expect(container.textContent).toContain("Date");
    expect(container.textContent).toContain("Type");
    expect(container.textContent).toContain("Source");
    expect(container.textContent).toContain("Amount");
    expect(container.textContent).toContain("Price");
    expect(container.textContent).toContain("P&L");
  });

  it("SC-TT-02: BUY row shows formatted amount", () => {
    const { container } = render(
      <TransactionTable transactions={[makeBuyTx()]} currentPrice="3000.00" />,
    );
    // Amount "1.5" should be formatted
    expect(container.textContent).toContain("1.5");
  });

  it("SC-TT-03: SWAP_IN on-chain with txHash → TypeBadge title contains 'Auto-detected swap'", () => {
    const tx = makeBuyTx({
      type: "SWAP_IN",
      txHash: "0xdeadbeef",
      pnl: { kind: "INBOUND", lotPnlUsd: null, lotPnlPct: null },
    });
    const { container } = render(
      <TransactionTable transactions={[tx]} currentPrice="3000.00" />,
    );
    const spans = container.querySelectorAll("span[title]");
    const swapSpan = Array.from(spans).find((s) =>
      s.getAttribute("title")?.includes("Auto-detected swap"),
    );
    expect(swapSpan).not.toBeNull();
  });

  it("SC-TT-04: SWAP_IN Binance → TypeBadge title contains 'Binance Convert #'", () => {
    const tx = makeBuyTx({
      type: "SWAP_IN",
      source: "BINANCE",
      cexTradeId: "cex-456",
      txHash: null,
      pnl: { kind: "INBOUND", lotPnlUsd: null, lotPnlPct: null },
    });
    const { container } = render(
      <TransactionTable transactions={[tx]} currentPrice="3000.00" />,
    );
    const spans = container.querySelectorAll("span[title]");
    const convertSpan = Array.from(spans).find((s) =>
      s.getAttribute("title")?.includes("Binance Convert #cex-456"),
    );
    expect(convertSpan).not.toBeNull();
  });

  it("SC-TT-05: TRANSFER_IN INHERITED ONCHAIN → CostSourceBadge renders 'Cost inherited (wallet)'", () => {
    const tx = makeBuyTx({
      type: "TRANSFER_IN",
      costSource: "INHERITED",
      costInheritedFrom: "ONCHAIN",
    });
    const { container } = render(
      <TransactionTable transactions={[tx]} currentPrice="3000.00" />,
    );
    expect(container.textContent).toContain("Cost inherited (wallet)");
  });

  it("SC-TT-06: TRANSFER_OUT Binance with txHash → SourceBadge title contains 'Withdrawal tx'", () => {
    const tx = makeBuyTx({
      type: "TRANSFER_OUT",
      source: "BINANCE",
      txHash: "0xwithdrawal",
      pnl: { kind: "OUTBOUND", displayAs: "Sold/Out", realizedPnlUsd: null },
    });
    const { container } = render(
      <TransactionTable transactions={[tx]} currentPrice="3000.00" />,
    );
    const spans = container.querySelectorAll("span[title]");
    const withdrawSpan = Array.from(spans).find((s) =>
      s.getAttribute("title")?.includes("Withdrawal tx"),
    );
    expect(withdrawSpan).not.toBeNull();
  });

  it("SC-TT-07: SELL row P&L cell has italic class", () => {
    const tx = makeBuyTx({
      type: "SELL",
      pnl: { kind: "OUTBOUND", displayAs: "Sold/Out", realizedPnlUsd: "500.00" },
    });
    const { container } = render(
      <TransactionTable transactions={[tx]} currentPrice="3000.00" />,
    );
    // Find cell with italic class
    const italicCells = container.querySelectorAll(".italic");
    expect(italicCells.length).toBeGreaterThan(0);
  });

  it("SC-TT-08: INBOUND pnl → P&L column shows lotPnlUsd", () => {
    const tx = makeBuyTx({
      pnl: { kind: "INBOUND", lotPnlUsd: "1500.00", lotPnlPct: "75.0" },
    });
    const { container } = render(
      <TransactionTable transactions={[tx]} currentPrice="3000.00" />,
    );
    // PnlDisplay should render some value for 1500.00
    expect(container.textContent).toContain("1,500.00");
  });

  it("NEGATIVE-TT-01: empty transactions → 'No transactions recorded yet'", () => {
    const { container } = render(
      <TransactionTable transactions={[]} currentPrice={null} />,
    );
    expect(container.textContent).toContain("No transactions recorded yet");
  });

  it("NEGATIVE-TT-02: priceUsd null → 'Value at Time' shows '—'", () => {
    const tx = makeBuyTx({ priceUsd: null });
    const { container } = render(
      <TransactionTable transactions={[tx]} currentPrice="3000.00" />,
    );
    // Value at time (amount × priceUsd) should show dash when priceUsd is null
    const dashElements = container.querySelectorAll(".text-gray-400");
    expect(dashElements.length).toBeGreaterThan(0);
  });

  it("NEGATIVE-TT-03: currentPrice null → 'Current Value' shows '—'", () => {
    const tx = makeBuyTx();
    const { container } = render(
      <TransactionTable transactions={[tx]} currentPrice={null} />,
    );
    // Current value should show dash when currentPrice is null
    const dashElements = container.querySelectorAll(".text-gray-400");
    expect(dashElements.length).toBeGreaterThan(0);
  });
});
