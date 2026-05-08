/**
 * Tests for SummaryCards component
 * Phase 4 — RED
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SummaryCards } from "../src/components/dashboard/SummaryCards";

describe("SummaryCards", () => {
  const defaultProps = {
    totalValueUsd: "10000.00",
    totalCostBasis: "8000.00",
    totalPnlUsd: "2000.00",
    totalPnlPct: "25.00",
  };

  it("renders 'Total Portfolio Value' card with formatted USD", () => {
    const { getByText } = render(<SummaryCards {...defaultProps} />);
    expect(getByText("Total Portfolio Value")).toBeDefined();
    expect(getByText("$10,000.00")).toBeDefined();
  });

  it("renders 'Total Cost Basis' card with formatted USD", () => {
    const { getByText } = render(<SummaryCards {...defaultProps} />);
    expect(getByText("Total Cost Basis")).toBeDefined();
    expect(getByText("$8,000.00")).toBeDefined();
  });

  it("renders 'Total P&L' card with positive sign prefix when pnlUsd > 0", () => {
    const { container, getByText } = render(<SummaryCards {...defaultProps} />);
    expect(getByText("Total P&L")).toBeDefined();
    // P&L positive: has text-pnl-positive
    const pnlUsdCard = container.querySelectorAll("article")[2];
    const valueSpan = pnlUsdCard?.querySelector("span:last-child");
    expect(valueSpan?.className).toContain("text-pnl-positive");
  });

  it("renders 'Total P&L %' card with formatPct value", () => {
    const { getByText } = render(<SummaryCards {...defaultProps} />);
    expect(getByText("Total P&L %")).toBeDefined();
    expect(getByText("+25.00%")).toBeDefined();
  });

  it("totalPnlPct=null → 4th card renders '—' in neutral color", () => {
    const { container, getByText } = render(
      <SummaryCards {...defaultProps} totalPnlPct={null} />,
    );
    expect(getByText("—")).toBeDefined();
    const pctCard = container.querySelectorAll("article")[3];
    const valueSpan = pctCard?.querySelector("span:last-child");
    expect(valueSpan?.className).not.toContain("text-pnl-positive");
    expect(valueSpan?.className).not.toContain("text-pnl-negative");
  });

  it("totalPnlUsd='0.00' → P&L $ card has neutral color", () => {
    const { container } = render(
      <SummaryCards {...defaultProps} totalPnlUsd="0.00" />,
    );
    const pnlUsdCard = container.querySelectorAll("article")[2];
    const valueSpan = pnlUsdCard?.querySelector("span:last-child");
    expect(valueSpan?.className).not.toContain("text-pnl-positive");
    expect(valueSpan?.className).not.toContain("text-pnl-negative");
  });

  it("totalPnlUsd='-500.00' → P&L $ card has text-pnl-negative", () => {
    const { container } = render(
      <SummaryCards {...defaultProps} totalPnlUsd="-500.00" />,
    );
    const pnlUsdCard = container.querySelectorAll("article")[2];
    const valueSpan = pnlUsdCard?.querySelector("span:last-child");
    expect(valueSpan?.className).toContain("text-pnl-negative");
  });

  it("totalPnlPct='0.00' (not null) → renders '0.00%' not '—'", () => {
    const { getByText, queryByText } = render(
      <SummaryCards {...defaultProps} totalPnlPct="0.00" />,
    );
    expect(getByText("0.00%")).toBeDefined();
    expect(queryByText("—")).toBeNull();
  });
});
