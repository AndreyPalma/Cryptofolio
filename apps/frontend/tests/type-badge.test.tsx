/**
 * Tests for TypeBadge component (US-010 Phase 3)
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TypeBadge } from "../src/components/token-detail/TypeBadge";

describe("TypeBadge", () => {
  it("SC-TB-01: BUY → green badge", () => {
    const { container } = render(
      <TypeBadge type="BUY" txHash={null} cexTradeId={null} />,
    );
    const span = container.querySelector("span");
    expect(span?.className).toContain("bg-green");
  });

  it("SC-TB-02: SELL → red badge", () => {
    const { container } = render(
      <TypeBadge type="SELL" txHash={null} cexTradeId={null} />,
    );
    const span = container.querySelector("span");
    expect(span?.className).toContain("bg-red");
  });

  it("SC-TB-03: SWAP_IN → blue badge", () => {
    const { container } = render(
      <TypeBadge type="SWAP_IN" txHash={null} cexTradeId={null} />,
    );
    const span = container.querySelector("span");
    expect(span?.className).toContain("bg-blue");
  });

  it("SC-TB-04: SWAP_OUT → orange badge", () => {
    const { container } = render(
      <TypeBadge type="SWAP_OUT" txHash={null} cexTradeId={null} />,
    );
    const span = container.querySelector("span");
    expect(span?.className).toContain("bg-orange");
  });

  it("SC-TB-05: TRANSFER_IN → gray badge", () => {
    const { container } = render(
      <TypeBadge type="TRANSFER_IN" txHash={null} cexTradeId={null} />,
    );
    const span = container.querySelector("span");
    expect(span?.className).toContain("bg-gray-700");
    expect(span?.textContent).toContain("TRANSFER IN");
  });

  it("SC-TB-06: TRANSFER_OUT → gray badge", () => {
    const { container } = render(
      <TypeBadge type="TRANSFER_OUT" txHash={null} cexTradeId={null} />,
    );
    const span = container.querySelector("span");
    expect(span?.className).toContain("bg-gray-700");
    expect(span?.textContent).toContain("TRANSFER OUT");
  });

  it("SC-TB-07: SWAP_IN with txHash → title set to auto-detected swap message", () => {
    const { container } = render(
      <TypeBadge type="SWAP_IN" txHash="0xdeadbeef" cexTradeId={null} />,
    );
    const span = container.querySelector("span");
    expect(span?.getAttribute("title")).toContain("Auto-detected swap from TX 0xdeadbeef");
  });

  it("SC-TB-07b: SWAP_IN with cexTradeId → title set to Binance Convert message", () => {
    const { container } = render(
      <TypeBadge type="SWAP_IN" txHash={null} cexTradeId="cex-123" />,
    );
    const span = container.querySelector("span");
    expect(span?.getAttribute("title")).toContain("Binance Convert #cex-123");
  });

  it("NEGATIVE-TB-01: BUY with no txHash or cexTradeId → no title attribute", () => {
    const { container } = render(
      <TypeBadge type="BUY" txHash={null} cexTradeId={null} />,
    );
    const span = container.querySelector("span");
    expect(span?.hasAttribute("title")).toBe(false);
  });

  it("renders all 6 types without crashing", () => {
    const types = ["BUY", "SELL", "SWAP_IN", "SWAP_OUT", "TRANSFER_IN", "TRANSFER_OUT"] as const;
    for (const type of types) {
      expect(() =>
        render(<TypeBadge type={type} txHash={null} cexTradeId={null} />),
      ).not.toThrow();
    }
  });
});
