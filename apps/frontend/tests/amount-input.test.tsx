/**
 * Tests for AmountInput component (US-011 Phase 4)
 * TDD: T15.R — write failing test first
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { AmountInput } from "../src/components/add-transaction/AmountInput";

describe("AmountInput", () => {
  it("strips non-numeric characters — only digits and '.' allowed", () => {
    const onChange = vi.fn();
    const { container } = render(
      <AmountInput
        value=""
        onChange={onChange}
        currentBalance={null}
        type="BUY"
        fieldError={null}
      />,
    );

    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value: "1abc2.5" } });

    // Should strip 'abc' → '12.5'
    expect(onChange).toHaveBeenCalledWith("12.5");
  });

  it("prevents multiple decimal points — '1..5' becomes '1.5'", () => {
    const onChange = vi.fn();
    const { container } = render(
      <AmountInput
        value=""
        onChange={onChange}
        currentBalance={null}
        type="BUY"
        fieldError={null}
      />,
    );

    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value: "1..5" } });

    // Strip second dot
    expect(onChange).toHaveBeenCalledWith("1.5");
  });

  it("shows 'Balance: {currentBalance}' hint for outbound types", () => {
    const { container } = render(
      <AmountInput
        value=""
        onChange={() => undefined}
        currentBalance="1.0"
        type="SELL"
        fieldError={null}
      />,
    );

    expect(container.textContent).toContain("Balance: 1.0");
  });

  it("shows 'Exceeds balance of {balance} tokens' when amount > balance for outbound", () => {
    const { container } = render(
      <AmountInput
        value="2.0"
        onChange={() => undefined}
        currentBalance="1.0"
        type="SELL"
        fieldError={null}
      />,
    );

    expect(container.textContent).toContain("Exceeds balance of 1.0 tokens");
  });

  it("does NOT show balance error for inbound types even if amount > balance", () => {
    const { container } = render(
      <AmountInput
        value="2.0"
        onChange={() => undefined}
        currentBalance="1.0"
        type="BUY"
        fieldError={null}
      />,
    );

    expect(container.textContent).not.toContain("Exceeds balance");
  });

  it("renders fieldError when non-null", () => {
    const { container } = render(
      <AmountInput
        value=""
        onChange={() => undefined}
        currentBalance={null}
        type="BUY"
        fieldError="Amount is required"
      />,
    );

    expect(container.textContent).toContain("Amount is required");
  });
});
