/**
 * Tests for CostSourceBadge component (US-010 Phase 3)
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { CostSourceBadge } from "../src/components/token-detail/CostSourceBadge";

describe("CostSourceBadge", () => {
  it("SC-CSB-01: INHERITED + ONCHAIN → 'Cost inherited (wallet)' with green class", () => {
    const { container } = render(
      <CostSourceBadge costSource="INHERITED" costInheritedFrom="ONCHAIN" />,
    );
    expect(container.textContent).toContain("Cost inherited (wallet)");
    const span = container.querySelector("span");
    expect(span?.className).toContain("green");
  });

  it("SC-CSB-02: INHERITED + BINANCE → 'Cost inherited (Binance)' with green class", () => {
    const { container } = render(
      <CostSourceBadge costSource="INHERITED" costInheritedFrom="BINANCE" />,
    );
    expect(container.textContent).toContain("Cost inherited (Binance)");
    const span = container.querySelector("span");
    expect(span?.className).toContain("green");
  });

  it("SC-CSB-03: MANUAL + null → 'Manual cost' with gray class", () => {
    const { container } = render(
      <CostSourceBadge costSource="MANUAL" costInheritedFrom={null} />,
    );
    expect(container.textContent).toContain("Manual cost");
    const span = container.querySelector("span");
    expect(span?.className).toContain("gray");
  });

  it("NEGATIVE-CSB-01: costSource=null → renders nothing", () => {
    const { container } = render(
      <CostSourceBadge costSource={null} costInheritedFrom={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("NEGATIVE-CSB-02: costSource='MARKET' → renders nothing", () => {
    const { container } = render(
      <CostSourceBadge costSource="MARKET" costInheritedFrom={null} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
