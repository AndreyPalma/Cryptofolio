/**
 * Tests for TokenSelect component (US-011 Phase 4)
 * TDD: T12.R — write failing test first
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TokenSelect } from "../src/components/add-transaction/TokenSelect";
import type { Token } from "../src/hooks/useTokensByWallet";

const tokens: Token[] = [
  {
    id: "t1",
    symbol: "ETH",
    name: "Ethereum",
    network: "ETH",
    contractAddress: "0xeeee",
    decimals: 18,
    binanceSymbol: null,
    isHidden: false,
    targetExitPrice: null,
  },
  {
    id: "t2",
    symbol: "WETH",
    name: null,
    network: "ETH",
    contractAddress: "0xc02a",
    decimals: 18,
    binanceSymbol: null,
    isHidden: false,
    targetExitPrice: null,
  },
];

describe("TokenSelect", () => {
  it("is disabled and shows loading placeholder when tokens === null", () => {
    const { container } = render(
      <TokenSelect tokens={null} selectedTokenId="" onChange={() => undefined} />,
    );

    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(container.textContent).toContain("Loading");
  });

  it("shows 'No tokens available' when tokens is empty array", () => {
    const { container } = render(
      <TokenSelect tokens={[]} selectedTokenId="" onChange={() => undefined} />,
    );

    expect(container.textContent).toContain("No tokens available");
  });

  it("renders option with '{symbol} — {name}' when name is present", () => {
    const { container } = render(
      <TokenSelect tokens={tokens} selectedTokenId="" onChange={() => undefined} />,
    );

    const options = container.querySelectorAll("option");
    const ethOption = Array.from(options).find((o) => o.value === "t1");
    expect(ethOption?.textContent).toContain("ETH");
    expect(ethOption?.textContent).toContain("Ethereum");
  });

  it("renders option with just '{symbol}' when name is null", () => {
    const { container } = render(
      <TokenSelect tokens={tokens} selectedTokenId="" onChange={() => undefined} />,
    );

    const options = container.querySelectorAll("option");
    const wethOption = Array.from(options).find((o) => o.value === "t2");
    expect(wethOption?.textContent).toContain("WETH");
    // Should not have "null" or "—" in the label
    expect(wethOption?.textContent).not.toContain("null");
  });

  it("onChange fires with the selected token id", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TokenSelect tokens={tokens} selectedTokenId="" onChange={onChange} />,
    );

    const select = container.querySelector("select")!;
    fireEvent.change(select, { target: { value: "t1" } });

    expect(onChange).toHaveBeenCalledWith("t1");
  });

  it("disabled prop makes the select disabled", () => {
    const { container } = render(
      <TokenSelect tokens={tokens} selectedTokenId="" onChange={() => undefined} disabled={true} />,
    );

    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });
});
