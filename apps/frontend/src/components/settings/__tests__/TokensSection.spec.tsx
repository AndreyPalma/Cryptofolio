import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../hooks/settings/useSettingsTokens", () => ({
  useSettingsTokens: vi.fn(),
}));

import { useSettingsTokens } from "../../../hooks/settings/useSettingsTokens";
import { TokensSection } from "../TokensSection";

const mockUseSettingsTokens = vi.mocked(useSettingsTokens);

const mockTokens = [
  {
    id: "t-1",
    symbol: "ETH",
    name: "Ethereum",
    network: "ETH" as const,
    contractAddress: "0xabc",
    binanceSymbol: null,
    isHidden: false,
    targetExitPrice: null,
  },
  {
    id: "t-2",
    symbol: "BNB",
    name: "Binance Coin",
    network: "CEX_BINANCE" as const,
    contractAddress: null,
    binanceSymbol: "BNBUSDT",
    isHidden: true,
    targetExitPrice: "500",
  },
];

describe("TokensSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders token rows for each token", () => {
    mockUseSettingsTokens.mockReturnValue({
      data: mockTokens,
      loading: false,
      error: null,
      refetch: vi.fn(),
      updateToken: vi.fn().mockResolvedValue(undefined),
    });

    render(<TokensSection />);
    expect(screen.getByText("ETH")).not.toBeNull();
  });

  it("hides tokens with isHidden=true by default", () => {
    mockUseSettingsTokens.mockReturnValue({
      data: mockTokens,
      loading: false,
      error: null,
      refetch: vi.fn(),
      updateToken: vi.fn().mockResolvedValue(undefined),
    });

    const { container } = render(<TokensSection />);
    // BNB is hidden by default when toggle is off
    expect(container.textContent).not.toContain("BNB");
  });

  it("shows hidden tokens when 'Show hidden' toggle is enabled", () => {
    mockUseSettingsTokens.mockReturnValue({
      data: mockTokens,
      loading: false,
      error: null,
      refetch: vi.fn(),
      updateToken: vi.fn().mockResolvedValue(undefined),
    });

    const { container } = render(<TokensSection />);
    const toggleBtn = container.querySelector("[data-testid='show-hidden-toggle']") as HTMLElement;
    expect(toggleBtn).not.toBeNull();

    fireEvent.click(toggleBtn!);
    expect(container.textContent).toContain("BNB");
  });

  it("filters tokens by symbol search", () => {
    mockUseSettingsTokens.mockReturnValue({
      data: mockTokens,
      loading: false,
      error: null,
      refetch: vi.fn(),
      updateToken: vi.fn().mockResolvedValue(undefined),
    });

    const { container } = render(<TokensSection />);

    // Enable show hidden first to have both visible
    const toggleBtn = container.querySelector("[data-testid='show-hidden-toggle']") as HTMLElement;
    fireEvent.click(toggleBtn!);

    // Type in search box
    const searchInput = container.querySelector("input[type='text'][placeholder]") as HTMLInputElement;
    fireEvent.change(searchInput!, { target: { value: "ETH" } });

    expect(container.textContent).toContain("ETH");
    expect(container.textContent).not.toContain("BNB");
  });

  it("shows error state when useSettingsTokens returns error", () => {
    mockUseSettingsTokens.mockReturnValue({
      data: null,
      loading: false,
      error: new Error("Failed to load tokens"),
      refetch: vi.fn(),
      updateToken: vi.fn().mockResolvedValue(undefined),
    });

    const { container } = render(<TokensSection />);
    expect(container.textContent?.toLowerCase()).toContain("error");
  });
});
