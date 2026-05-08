/**
 * Tests for TokenLogo component
 * Phase 4 — RED
 */
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TokenLogo } from "../src/components/dashboard/TokenLogo";

describe("TokenLogo", () => {
  it("ETH network with contractAddress renders <img> with 'ethereum' in URL", () => {
    const { container } = render(
      <TokenLogo
        symbol="USDC"
        contractAddress="0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
        network="ETH"
        sourceType="ON_CHAIN"
      />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.src).toContain("ethereum");
  });

  it("BSC network with contractAddress renders <img> with 'smartchain' in URL", () => {
    const { container } = render(
      <TokenLogo
        symbol="CAKE"
        contractAddress="0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82"
        network="BSC"
        sourceType="ON_CHAIN"
      />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.src).toContain("smartchain");
  });

  it("CEX_BINANCE network renders letter-avatar, NO <img>", () => {
    const { container } = render(
      <TokenLogo
        symbol="BTC"
        contractAddress={null}
        network="CEX_BINANCE"
        sourceType="CEX"
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    // Should have a span with the letter
    const span = container.querySelector("span");
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe("B");
  });

  it("ETH network with contractAddress=null renders letter-avatar", () => {
    const { container } = render(
      <TokenLogo
        symbol="ETH"
        contractAddress={null}
        network="ETH"
        sourceType="ON_CHAIN"
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    const span = container.querySelector("span");
    expect(span).not.toBeNull();
  });

  it("onError on img triggers letter-avatar fallback", () => {
    const { container } = render(
      <TokenLogo
        symbol="USDC"
        contractAddress="0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
        network="ETH"
        sourceType="ON_CHAIN"
      />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();

    fireEvent.error(img!);

    // After error, img should be replaced by letter avatar
    expect(container.querySelector("img")).toBeNull();
    const span = container.querySelector("span");
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe("U");
  });

  it("symbol='ETH' letter-avatar shows 'E'", () => {
    const { container } = render(
      <TokenLogo
        symbol="ETH"
        contractAddress={null}
        network="ETH"
        sourceType="ON_CHAIN"
      />,
    );
    const span = container.querySelector("span");
    expect(span!.textContent).toBe("E");
  });

  it("symbol='' letter-avatar shows '?'", () => {
    const { container } = render(
      <TokenLogo
        symbol=""
        contractAddress={null}
        network="ETH"
        sourceType="ON_CHAIN"
      />,
    );
    const span = container.querySelector("span");
    expect(span!.textContent).toBe("?");
  });

  it("size='sm' container has w-6 h-6 class", () => {
    const { container } = render(
      <TokenLogo
        symbol="ETH"
        contractAddress={null}
        network="ETH"
        sourceType="ON_CHAIN"
        size="sm"
      />,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("w-6");
    expect(wrapper.className).toContain("h-6");
  });

  it("size='lg' container has w-10 h-10 class", () => {
    const { container } = render(
      <TokenLogo
        symbol="ETH"
        contractAddress={null}
        network="ETH"
        sourceType="ON_CHAIN"
        size="lg"
      />,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("w-10");
    expect(wrapper.className).toContain("h-10");
  });
});
