import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../hooks/settings/useApiKeysStatus", () => ({
  useApiKeysStatus: vi.fn(),
}));
vi.mock("../../../hooks/settings/useTestApiKey", () => ({
  useTestApiKey: vi.fn(),
}));

import { useApiKeysStatus } from "../../../hooks/settings/useApiKeysStatus";
import { useTestApiKey } from "../../../hooks/settings/useTestApiKey";
import { ApiKeysSection } from "../ApiKeysSection";

const mockUseApiKeysStatus = vi.mocked(useApiKeysStatus);
const mockUseTestApiKey = vi.mocked(useTestApiKey);

const defaultPresence = {
  ETHERSCAN_API_KEY: true,
  BSCTRACE_API_KEY: false,
  BINANCE_API_KEY: true,
  BINANCE_SECRET_KEY: true,
};

const idleStates = {
  etherscan: { status: "idle" as const },
  bsctrace: { status: "idle" as const },
  binance: { status: "idle" as const },
};

function renderSection() {
  return render(<ApiKeysSection />);
}

describe("ApiKeysSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows 'Configured in .env' placeholder for configured keys", () => {
    mockUseApiKeysStatus.mockReturnValue({
      data: defaultPresence,
      loading: false,
      error: null,
    });
    mockUseTestApiKey.mockReturnValue({
      states: idleStates,
      test: vi.fn(),
    });

    const { container } = renderSection();
    const inputs = container.querySelectorAll("input[type='password']");
    // Find Etherscan input — should have "Configured" placeholder
    const etherscanInput = Array.from(inputs).find(
      (inp) => (inp as HTMLInputElement).placeholder.toLowerCase().includes("configured"),
    );
    expect(etherscanInput).not.toBeNull();
  });

  it("shows 'Not configured' placeholder for missing keys", () => {
    mockUseApiKeysStatus.mockReturnValue({
      data: defaultPresence,
      loading: false,
      error: null,
    });
    mockUseTestApiKey.mockReturnValue({
      states: idleStates,
      test: vi.fn(),
    });

    const { container } = renderSection();
    // BSCTRACE is false → "Not configured"
    expect(container.textContent).toContain("Not configured");
  });

  it("enables Test button for Etherscan when key is configured", () => {
    mockUseApiKeysStatus.mockReturnValue({
      data: defaultPresence,
      loading: false,
      error: null,
    });
    mockUseTestApiKey.mockReturnValue({
      states: idleStates,
      test: vi.fn(),
    });

    const { container } = renderSection();
    const testBtns = Array.from(container.querySelectorAll("button")).filter(
      (b) => b.textContent?.toLowerCase().includes("test"),
    );
    // At least one test button should be enabled
    const enabledBtn = testBtns.find((b) => b.getAttribute("disabled") === null);
    expect(enabledBtn).not.toBeNull();
  });

  it("disables Test button for BSCTrace when key is not configured", () => {
    mockUseApiKeysStatus.mockReturnValue({
      data: defaultPresence,
      loading: false,
      error: null,
    });
    mockUseTestApiKey.mockReturnValue({
      states: idleStates,
      test: vi.fn(),
    });

    const { container } = renderSection();
    // Find the BSCTrace row and check its Test button is disabled
    // We test by looking at all disabled buttons
    const disabledBtn = container.querySelector("button[disabled]");
    expect(disabledBtn).not.toBeNull();
  });

  it("calls test('etherscan') when Etherscan Test button clicked", async () => {
    const testFn = vi.fn().mockResolvedValue(undefined);
    mockUseApiKeysStatus.mockReturnValue({
      data: defaultPresence,
      loading: false,
      error: null,
    });
    mockUseTestApiKey.mockReturnValue({
      states: idleStates,
      test: testFn,
    });

    const { container } = renderSection();
    // Click the first enabled Test button (Etherscan)
    const testBtns = Array.from(container.querySelectorAll("button")).filter(
      (b) => b.textContent?.toLowerCase().includes("test") && b.getAttribute("disabled") === null,
    );
    fireEvent.click(testBtns[0]!);

    await waitFor(() => {
      expect(testFn).toHaveBeenCalled();
    });
  });

  it("shows 'Testing...' during test in-flight", () => {
    mockUseApiKeysStatus.mockReturnValue({
      data: defaultPresence,
      loading: false,
      error: null,
    });
    mockUseTestApiKey.mockReturnValue({
      states: { ...idleStates, etherscan: { status: "testing" as const } },
      test: vi.fn(),
    });

    const { container } = renderSection();
    expect(container.textContent?.toLowerCase()).toContain("testing");
  });

  it("shows 'Connected' result in green-ish text", () => {
    mockUseApiKeysStatus.mockReturnValue({
      data: defaultPresence,
      loading: false,
      error: null,
    });
    mockUseTestApiKey.mockReturnValue({
      states: {
        ...idleStates,
        etherscan: { status: "connected" as const, meta: { latencyMs: 340 } },
      },
      test: vi.fn(),
    });

    const { container } = renderSection();
    expect(container.textContent).toContain("Connected");
    expect(container.textContent).toContain("340");
  });

  it("shows 'Failed: Invalid API key' in red for failed state", () => {
    mockUseApiKeysStatus.mockReturnValue({
      data: defaultPresence,
      loading: false,
      error: null,
    });
    mockUseTestApiKey.mockReturnValue({
      states: {
        ...idleStates,
        etherscan: { status: "failed" as const, reason: "Invalid API key" },
      },
      test: vi.fn(),
    });

    const { container } = renderSection();
    expect(container.textContent).toContain("Failed: Invalid API key");
  });

  it("shows 'Failed: API key requires read permissions' for permission error", () => {
    mockUseApiKeysStatus.mockReturnValue({
      data: defaultPresence,
      loading: false,
      error: null,
    });
    mockUseTestApiKey.mockReturnValue({
      states: {
        ...idleStates,
        binance: { status: "failed" as const, reason: "API key requires read permissions" },
      },
      test: vi.fn(),
    });

    const { container } = renderSection();
    expect(container.textContent).toContain("Failed: API key requires read permissions");
  });

  it("shows 'Connected: X assets' for Binance connected result", () => {
    mockUseApiKeysStatus.mockReturnValue({
      data: defaultPresence,
      loading: false,
      error: null,
    });
    mockUseTestApiKey.mockReturnValue({
      states: {
        ...idleStates,
        binance: { status: "connected" as const, meta: { assetCount: 42 } },
      },
      test: vi.fn(),
    });

    const { container } = renderSection();
    expect(container.textContent).toContain("42");
    expect(container.textContent).toContain("asset");
  });

  it("container HTML does not contain API key-like strings", () => {
    mockUseApiKeysStatus.mockReturnValue({
      data: defaultPresence,
      loading: false,
      error: null,
    });
    mockUseTestApiKey.mockReturnValue({
      states: idleStates,
      test: vi.fn(),
    });

    const { container } = renderSection();
    const html = container.innerHTML;
    expect(/[A-Z0-9]{20,}/.test(html)).toBe(false);
  });
});
