/**
 * Tests for WacPreview component (US-011 Phase 5)
 * TDD: T17.R — write failing test first
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { WacPreview } from "../src/components/add-transaction/WacPreview";

describe("WacPreview", () => {
  it("renders nothing (no DOM output) when amount parses to NaN", () => {
    const { container } = render(
      <WacPreview
        currentBalance="1.0"
        currentWac="2000"
        type="BUY"
        amount="abc"
        priceUsd="3000"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when type is BUY and priceUsd parses to NaN", () => {
    const { container } = render(
      <WacPreview
        currentBalance="1.0"
        currentWac="2000"
        type="BUY"
        amount="1.0"
        priceUsd=""
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders 'New WAC:' text when inputs are valid", () => {
    const { container } = render(
      <WacPreview
        currentBalance="1.0"
        currentWac="2000"
        type="BUY"
        amount="1.0"
        priceUsd="3000"
      />,
    );
    expect(container.textContent).toContain("New WAC:");
  });

  it("renders 'New balance:' text when inputs are valid", () => {
    const { container } = render(
      <WacPreview
        currentBalance="1.0"
        currentWac="2000"
        type="BUY"
        amount="1.0"
        priceUsd="3000"
      />,
    );
    expect(container.textContent).toContain("New balance:");
  });

  it("renders the disclaimer 'Estimated — final value computed on submit.'", () => {
    const { container } = render(
      <WacPreview
        currentBalance="1.0"
        currentWac="2000"
        type="BUY"
        amount="1.0"
        priceUsd="3000"
      />,
    );
    expect(container.textContent).toContain("Estimated — final value computed on submit");
  });

  it("BUY with existing position: new WAC is weighted average (2500 for balanced inputs)", () => {
    const { container } = render(
      <WacPreview
        currentBalance="1.0"
        currentWac="2000"
        type="BUY"
        amount="1.0"
        priceUsd="3000"
      />,
    );
    // 2500 formatted as USD
    expect(container.textContent).toContain("2,500");
  });

  it("SELL: shows new balance (1.5 after selling 0.5 from 2.0)", () => {
    const { container } = render(
      <WacPreview
        currentBalance="2.0"
        currentWac="2500"
        type="SELL"
        amount="0.5"
        priceUsd=""
      />,
    );
    expect(container.textContent).toContain("New balance:");
    // Balance is 1.5
    expect(container.textContent).toContain("1.5");
  });
});
