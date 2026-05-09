import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/settings/usePendingPriceTransfers", () => ({
  usePendingPriceTransfers: vi.fn(),
}));

import { usePendingPriceTransfers } from "../../../hooks/settings/usePendingPriceTransfers";
import { PendingPriceBanner } from "../PendingPriceBanner";
const mockHook = vi.mocked(usePendingPriceTransfers);

function renderBanner() {
  return render(
    <MemoryRouter>
      <PendingPriceBanner />
    </MemoryRouter>,
  );
}

describe("PendingPriceBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when count is 0", () => {
    mockHook.mockReturnValue({
      data: { transactions: [], count: 0 },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when data is null (loading)", () => {
    mockHook.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      refetch: vi.fn(),
    });

    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when error is not null", () => {
    mockHook.mockReturnValue({
      data: null,
      loading: false,
      error: new Error("fetch failed"),
      refetch: vi.fn(),
    });

    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it("renders banner with count when count > 0", () => {
    mockHook.mockReturnValue({
      data: {
        transactions: [
          {
            id: "tx-1",
            walletId: "w-1",
            tokenId: "t-1",
            tokenSymbol: "ETH",
            tokenNetwork: "ETH",
            amount: "1.5",
            blockTimestamp: new Date("2026-01-01"),
            txHash: "0xabc",
            fromAddress: null,
            contractAddress: null,
          },
        ],
        count: 5,
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { container } = renderBanner();
    expect(container.firstChild).not.toBeNull();
    expect(container.textContent).toContain("5");
    expect(container.textContent).toContain("TRANSFER_IN");
  });

  it("renders a link to token detail when contractAddress is present (on-chain)", () => {
    mockHook.mockReturnValue({
      data: {
        transactions: [
          {
            id: "tx-1",
            walletId: "w-1",
            tokenId: "t-1",
            tokenSymbol: "ETH",
            tokenNetwork: "ETH",
            amount: "1.5",
            blockTimestamp: new Date("2026-01-01"),
            txHash: "0xabc",
            fromAddress: "0x1234",
            contractAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
          },
        ],
        count: 3,
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { container } = renderBanner();
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toContain("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
    expect(link?.getAttribute("href")).toContain("ETH");
  });

  it("renders a link to /transactions/new when contractAddress is null (CEX)", () => {
    mockHook.mockReturnValue({
      data: {
        transactions: [
          {
            id: "tx-1",
            walletId: "w-1",
            tokenId: "t-1",
            tokenSymbol: "BTC",
            tokenNetwork: "CEX_BINANCE",
            amount: "0.5",
            blockTimestamp: new Date("2026-01-01"),
            txHash: null,
            fromAddress: null,
            contractAddress: null,
          },
        ],
        count: 2,
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { container } = renderBanner();
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("/transactions/new");
  });
});
