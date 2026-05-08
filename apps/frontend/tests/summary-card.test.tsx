/**
 * Tests for SummaryCard component
 * Phase 4 — RED
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SummaryCard } from "../src/components/dashboard/SummaryCard";

describe("SummaryCard", () => {
  it("renders label text", () => {
    const { getByText } = render(
      <SummaryCard label="Total Value" value="$10,000.00" />,
    );
    expect(getByText("Total Value")).toBeDefined();
  });

  it("renders value text", () => {
    const { getByText } = render(
      <SummaryCard label="Total Value" value="$10,000.00" />,
    );
    expect(getByText("$10,000.00")).toBeDefined();
  });

  it("pnlSign='positive' → value has text-pnl-positive class", () => {
    const { getByText } = render(
      <SummaryCard label="P&L" value="$2,000.00" pnlSign="positive" />,
    );
    const valueEl = getByText("$2,000.00");
    expect(valueEl.className).toContain("text-pnl-positive");
  });

  it("pnlSign='negative' → value has text-pnl-negative class", () => {
    const { getByText } = render(
      <SummaryCard label="P&L" value="-$500.00" pnlSign="negative" />,
    );
    const valueEl = getByText("-$500.00");
    expect(valueEl.className).toContain("text-pnl-negative");
  });

  it("pnlSign='neutral' → value has text-white class (no P&L class)", () => {
    const { getByText } = render(
      <SummaryCard label="P&L" value="$0.00" pnlSign="neutral" />,
    );
    const valueEl = getByText("$0.00");
    expect(valueEl.className).not.toContain("text-pnl-positive");
    expect(valueEl.className).not.toContain("text-pnl-negative");
    expect(valueEl.className).toContain("text-white");
  });

  it("no pnlSign → value has text-white class (default neutral)", () => {
    const { getByText } = render(
      <SummaryCard label="Total" value="$1,000.00" />,
    );
    const valueEl = getByText("$1,000.00");
    expect(valueEl.className).toContain("text-white");
  });
});
