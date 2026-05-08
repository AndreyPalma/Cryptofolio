/**
 * Tests for PriceUsdInput component (US-011 Phase 4)
 * TDD: T16.R — write failing test first
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { PriceUsdInput } from "../src/components/add-transaction/PriceUsdInput";

describe("PriceUsdInput", () => {
  it("shows 'Price USD *' label for BUY type", () => {
    const { container } = render(
      <PriceUsdInput value="" onChange={() => undefined} type="BUY" fieldError={null} />,
    );
    expect(container.textContent).toContain("Price USD *");
  });

  it("shows 'Price USD *' label for SELL type", () => {
    const { container } = render(
      <PriceUsdInput value="" onChange={() => undefined} type="SELL" fieldError={null} />,
    );
    expect(container.textContent).toContain("Price USD *");
  });

  it("shows 'Price USD *' label for SWAP_IN type", () => {
    const { container } = render(
      <PriceUsdInput value="" onChange={() => undefined} type="SWAP_IN" fieldError={null} />,
    );
    expect(container.textContent).toContain("Price USD *");
  });

  it("shows 'Price USD *' label for SWAP_OUT type", () => {
    const { container } = render(
      <PriceUsdInput value="" onChange={() => undefined} type="SWAP_OUT" fieldError={null} />,
    );
    expect(container.textContent).toContain("Price USD *");
  });

  it("shows 'Price USD *' label for TRANSFER_IN type", () => {
    const { container } = render(
      <PriceUsdInput value="" onChange={() => undefined} type="TRANSFER_IN" fieldError={null} />,
    );
    expect(container.textContent).toContain("Price USD *");
  });

  it("shows 'Price USD (optional)' label for TRANSFER_OUT type", () => {
    const { container } = render(
      <PriceUsdInput value="" onChange={() => undefined} type="TRANSFER_OUT" fieldError={null} />,
    );
    expect(container.textContent).toContain("Price USD (optional)");
  });

  it("onChange fires with the raw string value", () => {
    const onChange = vi.fn();
    const { container } = render(
      <PriceUsdInput value="" onChange={onChange} type="BUY" fieldError={null} />,
    );

    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value: "3000.50" } });

    expect(onChange).toHaveBeenCalledWith("3000.50");
  });

  it("renders fieldError when non-null", () => {
    const { container } = render(
      <PriceUsdInput
        value=""
        onChange={() => undefined}
        type="BUY"
        fieldError="Price must be greater than 0"
      />,
    );

    expect(container.textContent).toContain("Price must be greater than 0");
  });
});
