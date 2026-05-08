/**
 * Tests for NetworkBadge component
 * Phase 4 — RED
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { NetworkBadge } from "../src/components/dashboard/NetworkBadge";

describe("NetworkBadge", () => {
  it("network='ETH' renders 'Ethereum' text", () => {
    const { getByText } = render(
      <NetworkBadge network="ETH" sourceType="ON_CHAIN" />,
    );
    expect(getByText("Ethereum")).toBeDefined();
  });

  it("network='ETH' does NOT contain 'Binance' or 'BSC'", () => {
    const { container } = render(
      <NetworkBadge network="ETH" sourceType="ON_CHAIN" />,
    );
    expect(container.textContent).not.toContain("Binance");
    expect(container.textContent).not.toContain("BSC");
  });

  it("network='BSC' renders 'BSC' text", () => {
    const { getByText } = render(
      <NetworkBadge network="BSC" sourceType="ON_CHAIN" />,
    );
    expect(getByText("BSC")).toBeDefined();
  });

  it("network='BSC' does NOT contain 'Ethereum' or 'Binance'", () => {
    const { container } = render(
      <NetworkBadge network="BSC" sourceType="ON_CHAIN" />,
    );
    expect(container.textContent).not.toContain("Ethereum");
    expect(container.textContent).not.toContain("Binance");
  });

  it("network='CEX_BINANCE' renders 'Binance' text", () => {
    const { getByText } = render(
      <NetworkBadge network="CEX_BINANCE" sourceType="CEX" />,
    );
    expect(getByText("Binance")).toBeDefined();
  });

  it("network='CEX_BINANCE' has bg-binance class", () => {
    const { container } = render(
      <NetworkBadge network="CEX_BINANCE" sourceType="CEX" />,
    );
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain("bg-binance");
  });

  it("network='ETH' does NOT have bg-binance class", () => {
    const { container } = render(
      <NetworkBadge network="ETH" sourceType="ON_CHAIN" />,
    );
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).not.toContain("bg-binance");
  });
});
