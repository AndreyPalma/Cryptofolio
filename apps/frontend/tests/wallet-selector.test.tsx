/**
 * Tests for WalletSelector component (US-010 Phase 4)
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { WalletSelector } from "../src/components/token-detail/WalletSelector";
import type { WalletBreakdown } from "../src/types/token-detail";

const wallets: WalletBreakdown[] = [
  { walletId: "wallet-1", label: "My Wallet", balance: "1.0", wac: "2000.0" },
  { walletId: "wallet-2", label: null, balance: "0.5", wac: "1800.0" },
];

describe("WalletSelector", () => {
  it("SC-WS-01: renders 'All Wallets' as first option", () => {
    const { container } = render(
      <WalletSelector
        wallets={wallets}
        selectedWalletId={undefined}
        onChange={() => undefined}
      />,
    );
    const options = container.querySelectorAll("option");
    expect(options[0]?.textContent).toContain("All");
  });

  it("SC-WS-02: renders one option per wallet plus 'All Wallets'", () => {
    const { container } = render(
      <WalletSelector
        wallets={wallets}
        selectedWalletId={undefined}
        onChange={() => undefined}
      />,
    );
    const options = container.querySelectorAll("option");
    expect(options.length).toBe(wallets.length + 1);
  });

  it("SC-WS-03: selecting a wallet calls onChange with walletId", () => {
    const onChangeFn = vi.fn();
    const { container } = render(
      <WalletSelector
        wallets={wallets}
        selectedWalletId={undefined}
        onChange={onChangeFn}
      />,
    );
    const select = container.querySelector("select")!;
    fireEvent.change(select, { target: { value: "wallet-1" } });
    expect(onChangeFn).toHaveBeenCalledWith("wallet-1");
  });

  it("SC-WS-04: selecting 'All Wallets' calls onChange with undefined", () => {
    const onChangeFn = vi.fn();
    const { container } = render(
      <WalletSelector
        wallets={wallets}
        selectedWalletId="wallet-1"
        onChange={onChangeFn}
      />,
    );
    const select = container.querySelector("select")!;
    fireEvent.change(select, { target: { value: "" } });
    expect(onChangeFn).toHaveBeenCalledWith(undefined);
  });

  it("SC-WS-05: wallet label used when available", () => {
    const { container } = render(
      <WalletSelector
        wallets={wallets}
        selectedWalletId={undefined}
        onChange={() => undefined}
      />,
    );
    expect(container.textContent).toContain("My Wallet");
  });

  it("SC-WS-06: truncated walletId used when label is null", () => {
    const { container } = render(
      <WalletSelector
        wallets={wallets}
        selectedWalletId={undefined}
        onChange={() => undefined}
      />,
    );
    // wallet-2 has no label; should show partial walletId or some fallback
    const options = container.querySelectorAll("option");
    const wallet2Option = Array.from(options).find((o) => o.value === "wallet-2");
    expect(wallet2Option).not.toBeNull();
    // Label should be non-empty
    expect(wallet2Option?.textContent?.trim().length).toBeGreaterThan(0);
  });
});
