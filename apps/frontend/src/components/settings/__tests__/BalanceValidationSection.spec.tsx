import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../hooks/settings/useBalanceValidation", () => ({
  useBalanceValidation: vi.fn(),
}));

import { useBalanceValidation } from "../../../hooks/settings/useBalanceValidation";
import { BalanceValidationSection } from "../BalanceValidationSection";

const mockUseBalanceValidation = vi.mocked(useBalanceValidation);

const mockDifferences = [
  { asset: "ETH", engineBalance: "1.5", snapshotBalance: "1.4999", diff: "0.0001" },
  { asset: "BTC", engineBalance: "0.01", snapshotBalance: "0.0099", diff: "0.0001" },
];

const mockValidationData = {
  differences: mockDifferences,
  totalEngineUsd: "5000",
  totalSnapshotUsd: "4999",
  takenAt: new Date("2026-05-08T10:00:00.000Z"),
  dustNote: "Small differences are expected due to dust conversions.",
};

function renderSection() {
  return render(<BalanceValidationSection />);
}

describe("BalanceValidationSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is collapsed by default — validate button not visible", () => {
    mockUseBalanceValidation.mockReturnValue({
      state: "idle",
      data: null,
      error: null,
      validate: vi.fn(),
      cooldownSecondsRemaining: 0,
      disabledReason: null,
    });

    const { container } = renderSection();
    // validate button hidden when collapsed
    const validateBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.toLowerCase().includes("validate"),
    );
    expect(validateBtn).toBeUndefined();
  });

  it("shows validate button after clicking expand", () => {
    mockUseBalanceValidation.mockReturnValue({
      state: "idle",
      data: null,
      error: null,
      validate: vi.fn(),
      cooldownSecondsRemaining: 0,
      disabledReason: null,
    });

    const { container } = renderSection();
    const expandBtn = container.querySelector("[data-testid='bv-toggle']") as HTMLElement;
    expect(expandBtn).not.toBeNull();
    fireEvent.click(expandBtn!);

    const validateBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.toLowerCase().includes("validate"),
    );
    expect(validateBtn).not.toBeUndefined();
  });

  it("disables validate button when disabledReason is 'no-keys'", () => {
    mockUseBalanceValidation.mockReturnValue({
      state: "idle",
      data: null,
      error: null,
      validate: vi.fn(),
      cooldownSecondsRemaining: 0,
      disabledReason: "no-keys",
    });

    const { container } = renderSection();
    const expandBtn = container.querySelector("[data-testid='bv-toggle']") as HTMLElement;
    fireEvent.click(expandBtn!);

    const validateBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.toLowerCase().includes("validate"),
    ) as HTMLButtonElement | undefined;
    expect(validateBtn?.getAttribute("disabled")).not.toBeNull();
  });

  it("disables validate button when disabledReason is 'no-wallet'", () => {
    mockUseBalanceValidation.mockReturnValue({
      state: "idle",
      data: null,
      error: null,
      validate: vi.fn(),
      cooldownSecondsRemaining: 0,
      disabledReason: "no-wallet",
    });

    const { container } = renderSection();
    const expandBtn = container.querySelector("[data-testid='bv-toggle']") as HTMLElement;
    fireEvent.click(expandBtn!);

    const validateBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.toLowerCase().includes("validate"),
    ) as HTMLButtonElement | undefined;
    expect(validateBtn?.getAttribute("disabled")).not.toBeNull();
  });

  it("tooltip says 'Add a Binance wallet' when disabledReason is 'no-wallet'", () => {
    mockUseBalanceValidation.mockReturnValue({
      state: "idle",
      data: null,
      error: null,
      validate: vi.fn(),
      cooldownSecondsRemaining: 0,
      disabledReason: "no-wallet",
    });

    const { container } = renderSection();
    const expandBtn = container.querySelector("[data-testid='bv-toggle']") as HTMLElement;
    fireEvent.click(expandBtn!);

    const validateBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.toLowerCase().includes("validate"),
    ) as HTMLButtonElement | undefined;
    expect(validateBtn?.getAttribute("title")).toContain("Add a Binance wallet");
  });

  it("tooltip says 'Configure BINANCE_API_KEY' when disabledReason is 'no-keys'", () => {
    mockUseBalanceValidation.mockReturnValue({
      state: "idle",
      data: null,
      error: null,
      validate: vi.fn(),
      cooldownSecondsRemaining: 0,
      disabledReason: "no-keys",
    });

    const { container } = renderSection();
    const expandBtn = container.querySelector("[data-testid='bv-toggle']") as HTMLElement;
    fireEvent.click(expandBtn!);

    const validateBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.toLowerCase().includes("validate"),
    ) as HTMLButtonElement | undefined;
    expect(validateBtn?.getAttribute("title")).toContain("BINANCE_API_KEY");
  });

  it("calls validate() when button clicked", async () => {
    const validateFn = vi.fn().mockResolvedValue(undefined);
    mockUseBalanceValidation.mockReturnValue({
      state: "idle",
      data: null,
      error: null,
      validate: validateFn,
      cooldownSecondsRemaining: 0,
      disabledReason: null,
    });

    const { container } = renderSection();
    const expandBtn = container.querySelector("[data-testid='bv-toggle']") as HTMLElement;
    fireEvent.click(expandBtn!);

    const validateBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.toLowerCase().includes("validate"),
    );
    fireEvent.click(validateBtn!);

    await waitFor(() => {
      expect(validateFn).toHaveBeenCalledTimes(1);
    });
  });

  it("renders differences table with 2 rows after success", () => {
    mockUseBalanceValidation.mockReturnValue({
      state: "success",
      data: mockValidationData,
      error: null,
      validate: vi.fn(),
      cooldownSecondsRemaining: 0,
      disabledReason: null,
    });

    const { container } = renderSection();
    const expandBtn = container.querySelector("[data-testid='bv-toggle']") as HTMLElement;
    fireEvent.click(expandBtn!);

    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(2);
  });

  it("shows dustNote after success", () => {
    mockUseBalanceValidation.mockReturnValue({
      state: "success",
      data: mockValidationData,
      error: null,
      validate: vi.fn(),
      cooldownSecondsRemaining: 0,
      disabledReason: null,
    });

    const { container } = renderSection();
    const expandBtn = container.querySelector("[data-testid='bv-toggle']") as HTMLElement;
    fireEvent.click(expandBtn!);

    expect(container.textContent).toContain("dust");
  });

  it("shows cooldown countdown when cooldownSecondsRemaining > 0", () => {
    mockUseBalanceValidation.mockReturnValue({
      state: "success",
      data: mockValidationData,
      error: null,
      validate: vi.fn(),
      cooldownSecondsRemaining: 42,
      disabledReason: null,
    });

    const { container } = renderSection();
    const expandBtn = container.querySelector("[data-testid='bv-toggle']") as HTMLElement;
    fireEvent.click(expandBtn!);

    expect(container.textContent).toContain("42");
    // The validate-again button should be disabled
    const validateBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.toLowerCase().includes("available"),
    ) as HTMLButtonElement | undefined;
    expect(validateBtn?.getAttribute("disabled")).not.toBeNull();
  });

  it("shows error message and Retry button on error", () => {
    mockUseBalanceValidation.mockReturnValue({
      state: "error",
      data: null,
      error: new Error("Binance unreachable"),
      validate: vi.fn(),
      cooldownSecondsRemaining: 0,
      disabledReason: null,
    });

    const { container } = renderSection();
    const expandBtn = container.querySelector("[data-testid='bv-toggle']") as HTMLElement;
    fireEvent.click(expandBtn!);

    expect(container.textContent).toContain("Binance unreachable");
    const retryBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.toLowerCase().includes("retry"),
    );
    expect(retryBtn).not.toBeUndefined();
  });
});
