/**
 * Tests for TransactionTypeSelect component (US-011 Phase 4)
 * TDD: T13.R — write failing test first
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TransactionTypeSelect } from "../src/components/add-transaction/TransactionTypeSelect";

describe("TransactionTypeSelect", () => {
  it("renders exactly 6 options (BUY, SELL, SWAP_IN, SWAP_OUT, TRANSFER_IN, TRANSFER_OUT)", () => {
    const { container } = render(
      <TransactionTypeSelect value="BUY" onChange={() => undefined} />,
    );

    const select = container.querySelector("select")!;
    const options = select.querySelectorAll("option");
    expect(options.length).toBe(6);

    const values = Array.from(options).map((o) => o.value);
    expect(values).toContain("BUY");
    expect(values).toContain("SELL");
    expect(values).toContain("SWAP_IN");
    expect(values).toContain("SWAP_OUT");
    expect(values).toContain("TRANSFER_IN");
    expect(values).toContain("TRANSFER_OUT");
  });

  it("swap nudge note NOT rendered when type is BUY", () => {
    const { container } = render(
      <TransactionTypeSelect value="BUY" onChange={() => undefined} />,
    );

    expect(container.textContent).not.toContain("submit both sides separately");
  });

  it("swap nudge note NOT rendered when type is SELL", () => {
    const { container } = render(
      <TransactionTypeSelect value="SELL" onChange={() => undefined} />,
    );

    expect(container.textContent).not.toContain("submit both sides separately");
  });

  it("swap nudge note IS rendered when type is SWAP_IN", () => {
    const { container } = render(
      <TransactionTypeSelect value="SWAP_IN" onChange={() => undefined} />,
    );

    expect(container.textContent).toContain("submit both sides separately");
  });

  it("swap nudge note IS rendered when type is SWAP_OUT", () => {
    const { container } = render(
      <TransactionTypeSelect value="SWAP_OUT" onChange={() => undefined} />,
    );

    expect(container.textContent).toContain("submit both sides separately");
  });

  it("onChange fires with the new type value", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TransactionTypeSelect value="BUY" onChange={onChange} />,
    );

    const select = container.querySelector("select")!;
    fireEvent.change(select, { target: { value: "SELL" } });

    expect(onChange).toHaveBeenCalledWith("SELL");
  });
});
