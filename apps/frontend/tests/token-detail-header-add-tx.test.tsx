/**
 * Tests for TokenDetailHeader Add Transaction button (US-011 Phase 7.2)
 * TDD: T26.R — write failing test first
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TokenDetailHeader } from "../src/components/token-detail/TokenDetailHeader";
import type { TokenInfo, PositionStats } from "../src/types/token-detail";

vi.mock("../src/lib/checksum-address", () => ({
  toChecksumAddress: (addr: string) => addr,
}));

const mockToken: TokenInfo = {
  id: "token-1",
  symbol: "ETH",
  name: "Ethereum",
  network: "ETH",
  contractAddress: "0xeeee",
  binanceSymbol: null,
  decimals: 18,
  targetExitPrice: null,
};

const mockPosition: PositionStats = {
  symbol: "ETH",
  network: "ETH",
  sourceType: "ON_CHAIN",
  contractAddress: "0xeeee",
  binanceSymbol: null,
  totalBalance: "1.0",
  wacAggregated: "2000.0",
  totalCostBasis: "2000.0",
  currentPrice: "3000.0",
  totalCurrentValue: "3000.0",
  pnlUsd: "1000.0",
  pnlPct: "50.0",
  walletCount: 1,
  walletBreakdown: [
    { walletId: "wallet-1", label: "MetaMask", balance: "1.0", wac: "2000" },
  ],
  cycleNumber: 1,
};

describe("TokenDetailHeader — Add Transaction button (T26)", () => {
  it("renders an 'Add Transaction' link", () => {
    const { container } = render(
      <MemoryRouter>
        <TokenDetailHeader
          token={mockToken}
          position={mockPosition}
          closedCycleCount={0}
          selectedWalletId={undefined}
          onWalletChange={() => undefined}
        />
      </MemoryRouter>,
    );

    const addLink = Array.from(container.querySelectorAll("a")).find((a) =>
      a.textContent?.includes("Add Transaction"),
    );
    expect(addLink).not.toBeNull();
  });

  it("link has correct to: /transactions/new?wallet_id=wallet-1&token_id=token-1", () => {
    const { container } = render(
      <MemoryRouter>
        <TokenDetailHeader
          token={mockToken}
          position={mockPosition}
          closedCycleCount={0}
          selectedWalletId={undefined}
          onWalletChange={() => undefined}
        />
      </MemoryRouter>,
    );

    const addLink = Array.from(container.querySelectorAll("a")).find((a) =>
      a.textContent?.includes("Add Transaction"),
    );
    const href = addLink!.getAttribute("href") ?? "";
    expect(href).toContain("/transactions/new");
    expect(href).toContain("wallet_id=wallet-1");
    expect(href).toContain("token_id=token-1");
  });

  it("still renders 'Add Transaction' link when position is null", () => {
    const { container } = render(
      <MemoryRouter>
        <TokenDetailHeader
          token={mockToken}
          position={null}
          closedCycleCount={0}
          selectedWalletId={undefined}
          onWalletChange={() => undefined}
        />
      </MemoryRouter>,
    );

    const addLink = Array.from(container.querySelectorAll("a")).find((a) =>
      a.textContent?.includes("Add Transaction"),
    );
    expect(addLink).not.toBeNull();
  });

  it("does NOT render 'Add Transaction' link when walletBreakdown is empty", () => {
    const emptyPosition: PositionStats = {
      ...mockPosition,
      walletBreakdown: [],
    };

    const { container } = render(
      <MemoryRouter>
        <TokenDetailHeader
          token={mockToken}
          position={emptyPosition}
          closedCycleCount={0}
          selectedWalletId={undefined}
          onWalletChange={() => undefined}
        />
      </MemoryRouter>,
    );

    const addLink = Array.from(container.querySelectorAll("a")).find((a) =>
      a.textContent?.includes("Add Transaction"),
    );
    // .find() returns undefined when not found
    expect(addLink).toBeUndefined();
  });
});
