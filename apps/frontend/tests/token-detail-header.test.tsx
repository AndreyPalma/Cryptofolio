/**
 * Tests for TokenDetailHeader component (US-010 Phase 4)
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
  symbol: "WETH",
  name: "Wrapped Ether",
  network: "ETH",
  contractAddress: "0xaaa",
  binanceSymbol: null,
  decimals: 18,
  targetExitPrice: null,
};

const mockPosition: PositionStats = {
  symbol: "WETH",
  network: "ETH",
  sourceType: "ON_CHAIN",
  contractAddress: "0xaaa",
  binanceSymbol: null,
  totalBalance: "1.0",
  wacAggregated: "2000.0",
  totalCostBasis: "2000.0",
  currentPrice: "3000.0",
  totalCurrentValue: "3000.0",
  pnlUsd: "1000.0",
  pnlPct: "50.0",
  walletCount: 1,
  walletBreakdown: [],
  cycleNumber: 1,
};

describe("TokenDetailHeader", () => {
  it("SC-TDH-01: renders symbol and network badge", () => {
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
    expect(container.textContent).toContain("WETH");
    expect(container.textContent).toContain("Ethereum");
  });

  it("SC-TDH-02: CycleBadge shows 'CYCLE #1' when position present", () => {
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
    expect(container.textContent).toContain("CYCLE #1");
  });

  it("SC-TDH-03: CycleBadge shows 'CYCLE #—' when position is null", () => {
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
    expect(container.textContent).toContain("CYCLE #—");
  });

  it("SC-TDH-04: 'View 2 closed cycles' link shown when closedCycleCount=2", () => {
    const { container } = render(
      <MemoryRouter>
        <TokenDetailHeader
          token={mockToken}
          position={mockPosition}
          closedCycleCount={2}
          selectedWalletId={undefined}
          onWalletChange={() => undefined}
        />
      </MemoryRouter>,
    );
    expect(container.textContent).toContain("2 closed cycle");
    const link = container.querySelector("a[href*='history']");
    expect(link).not.toBeNull();
  });

  it("SC-TDH-05: closed cycles link hidden when closedCycleCount=0", () => {
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
    expect(container.textContent).not.toMatch(/\d+ closed cycle/);
  });
});
