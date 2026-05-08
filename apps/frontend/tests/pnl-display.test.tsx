/**
 * Tests for PnlDisplay component
 * Phase 4 — RED
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PnlDisplay } from "../src/components/dashboard/PnlDisplay";

describe("PnlDisplay", () => {
  it("value=null renders '—' with text-gray-400 class", () => {
    const { container } = render(<PnlDisplay value={null} kind="usd" />);
    const span = container.querySelector("span");
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe("—");
    expect(span!.className).toContain("text-gray-400");
  });

  it("positive usd value renders formatted amount with text-pnl-positive", () => {
    const { getByText } = render(<PnlDisplay value="2345.67" kind="usd" />);
    const el = getByText("$2,345.67");
    expect(el.className).toContain("text-pnl-positive");
  });

  it("negative usd value renders formatted amount with text-pnl-negative", () => {
    const { getByText } = render(<PnlDisplay value="-500.00" kind="usd" />);
    const el = getByText("-$500.00");
    expect(el.className).toContain("text-pnl-negative");
  });

  it("zero usd value renders '$0.00' with neutral class", () => {
    const { getByText } = render(<PnlDisplay value="0.00" kind="usd" />);
    const el = getByText("$0.00");
    expect(el.className).not.toContain("text-pnl-positive");
    expect(el.className).not.toContain("text-pnl-negative");
  });

  it("positive pct value renders '+23.46%' with text-pnl-positive", () => {
    const { getByText } = render(<PnlDisplay value="23.46" kind="pct" />);
    const el = getByText("+23.46%");
    expect(el.className).toContain("text-pnl-positive");
  });

  it("number input (positive) renders correctly with text-pnl-positive", () => {
    const { getByText } = render(<PnlDisplay value={1500} kind="usd" />);
    const el = getByText("$1,500.00");
    expect(el.className).toContain("text-pnl-positive");
  });
});
