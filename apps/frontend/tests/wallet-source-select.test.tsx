/**
 * Tests for WalletSourceSelect component (US-011 Phase 4)
 * TDD: T11.R — write failing test first
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { WalletSourceSelect } from "../src/components/add-transaction/WalletSourceSelect";
import type { WalletEntry } from "../src/types/token-detail";

const wallets: WalletEntry[] = [
  { id: "w1", label: "MetaMask ETH", walletType: "ON_CHAIN", network: "ETH" },
  { id: "w2", label: "Cold BSC", walletType: "ON_CHAIN", network: "BSC" },
  { id: "w3", label: "Binance Account", walletType: "CEX", network: "CEX_BINANCE" },
];

const walletsWithNullCexLabel: WalletEntry[] = [
  { id: "w1", label: "Main ETH", walletType: "ON_CHAIN", network: "ETH" },
  { id: "w3", label: null, walletType: "CEX", network: "CEX_BINANCE" },
];

describe("WalletSourceSelect", () => {
  it("renders an optgroup labeled 'On-Chain' containing ON_CHAIN wallets", () => {
    const { container } = render(
      <WalletSourceSelect
        wallets={wallets}
        selectedWalletId=""
        onChange={() => undefined}
      />,
    );

    const onChainGroup = container.querySelector('optgroup[label="On-Chain"]');
    expect(onChainGroup).not.toBeNull();

    const options = onChainGroup!.querySelectorAll("option");
    expect(options.length).toBe(2);
    expect(options[0]!.value).toBe("w1");
    expect(options[1]!.value).toBe("w2");
  });

  it("renders an optgroup labeled 'CEX' containing CEX wallets", () => {
    const { container } = render(
      <WalletSourceSelect
        wallets={wallets}
        selectedWalletId=""
        onChange={() => undefined}
      />,
    );

    const cexGroup = container.querySelector('optgroup[label="CEX"]');
    expect(cexGroup).not.toBeNull();

    const options = cexGroup!.querySelectorAll("option");
    expect(options.length).toBe(1);
    expect(options[0]!.value).toBe("w3");
  });

  it("CEX wallet with null label displays 'Binance Account' fallback", () => {
    const { container } = render(
      <WalletSourceSelect
        wallets={walletsWithNullCexLabel}
        selectedWalletId=""
        onChange={() => undefined}
      />,
    );

    const cexGroup = container.querySelector('optgroup[label="CEX"]');
    expect(cexGroup).not.toBeNull();
    expect(cexGroup!.textContent).toContain("Binance Account");
  });

  it("onChange fires with the selected wallet id", () => {
    const onChange = vi.fn();
    const { container } = render(
      <WalletSourceSelect
        wallets={wallets}
        selectedWalletId=""
        onChange={onChange}
      />,
    );

    const select = container.querySelector("select")!;
    fireEvent.change(select, { target: { value: "w1" } });

    expect(onChange).toHaveBeenCalledWith("w1");
  });

  it("selectedWalletId controls the selected option", () => {
    const { container } = render(
      <WalletSourceSelect
        wallets={wallets}
        selectedWalletId="w2"
        onChange={() => undefined}
      />,
    );

    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("w2");
  });

  it("disabled prop disables the select", () => {
    const { container } = render(
      <WalletSourceSelect
        wallets={wallets}
        selectedWalletId=""
        onChange={() => undefined}
        disabled={true}
      />,
    );

    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });
});
