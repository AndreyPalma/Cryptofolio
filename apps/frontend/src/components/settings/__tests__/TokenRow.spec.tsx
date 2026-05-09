import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, act } from "@testing-library/react";
import { TokenRow } from "../TokenRow";
import type { SettingsToken } from "../../../types/settings";

const mockToken: SettingsToken = {
  id: "token-1",
  symbol: "ETH",
  name: "Ethereum",
  network: "ETH",
  contractAddress: "0xabc",
  binanceSymbol: null,
  isHidden: false,
  targetExitPrice: "3000.00",
};

describe("TokenRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls onUpdate({ isHidden: true }) when toggle clicked from false", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <table><tbody>
        <TokenRow token={mockToken} onUpdate={onUpdate} />
      </tbody></table>,
    );

    const checkbox = container.querySelector("input[type='checkbox']") as HTMLInputElement;
    expect(checkbox).not.toBeNull();

    await act(async () => {
      fireEvent.click(checkbox!);
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({ isHidden: true });
  });

  it("disables toggle while onUpdate is in-flight", async () => {
    let resolve!: () => void;
    const onUpdate = vi.fn().mockReturnValue(new Promise<void>((r) => { resolve = r; }));

    const { container } = render(
      <table><tbody>
        <TokenRow token={mockToken} onUpdate={onUpdate} />
      </tbody></table>,
    );

    const checkbox = container.querySelector("input[type='checkbox']") as HTMLInputElement;
    act(() => {
      fireEvent.click(checkbox!);
    });

    await waitFor(() => {
      const disabledEl = container.querySelector("input[disabled]");
      expect(disabledEl).not.toBeNull();
    });

    resolve();
  });

  it("shows Save and Cancel buttons when target price is changed", () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <table><tbody>
        <TokenRow token={mockToken} onUpdate={onUpdate} />
      </tbody></table>,
    );

    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    expect(input).not.toBeNull();

    fireEvent.change(input!, { target: { value: "5000.00" } });

    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Save"),
    );
    const cancelBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Cancel"),
    );
    expect(saveBtn).not.toBeNull();
    expect(cancelBtn).not.toBeNull();
  });

  it("calls onUpdate with new price when Save clicked", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <table><tbody>
        <TokenRow token={mockToken} onUpdate={onUpdate} />
      </tbody></table>,
    );

    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    fireEvent.change(input!, { target: { value: "5000.00" } });

    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Save"),
    );

    await act(async () => {
      fireEvent.click(saveBtn!);
    });

    expect(onUpdate).toHaveBeenCalledWith({ targetExitPrice: "5000.00" });
  });

  it("reverts input when Cancel clicked", () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <table><tbody>
        <TokenRow token={mockToken} onUpdate={onUpdate} />
      </tbody></table>,
    );

    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    fireEvent.change(input!, { target: { value: "9999" } });

    const cancelBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Cancel"),
    );
    fireEvent.click(cancelBtn!);

    expect((container.querySelector("input[type='text']") as HTMLInputElement).value).toBe("3000.00");
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("calls onUpdate with null when price input is empty and Save clicked", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <table><tbody>
        <TokenRow token={mockToken} onUpdate={onUpdate} />
      </tbody></table>,
    );

    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    fireEvent.change(input!, { target: { value: "" } });

    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Save"),
    );

    await act(async () => {
      fireEvent.click(saveBtn!);
    });

    expect(onUpdate).toHaveBeenCalledWith({ targetExitPrice: null });
  });

  it("disables Save button when input is invalid ('abc')", () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <table><tbody>
        <TokenRow token={mockToken} onUpdate={onUpdate} />
      </tbody></table>,
    );

    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    fireEvent.change(input!, { target: { value: "abc" } });

    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Save"),
    ) as HTMLButtonElement | undefined;

    expect(saveBtn?.getAttribute("disabled")).not.toBeNull();
  });

  it("disables Save during in-flight request (no double submit)", async () => {
    let resolve!: () => void;
    const onUpdate = vi.fn().mockReturnValue(new Promise<void>((r) => { resolve = r; }));

    const { container } = render(
      <table><tbody>
        <TokenRow token={mockToken} onUpdate={onUpdate} />
      </tbody></table>,
    );

    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    fireEvent.change(input!, { target: { value: "1000" } });

    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Save"),
    );

    act(() => {
      fireEvent.click(saveBtn!);
    });

    await waitFor(() => {
      const disabledSave = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Save") && b.getAttribute("disabled") !== null,
      );
      expect(disabledSave).not.toBeNull();
    });

    resolve();
  });

  it("shows ETHERSCAN source badge for ETH network", () => {
    const { container } = render(
      <table><tbody>
        <TokenRow token={mockToken} onUpdate={vi.fn()} />
      </tbody></table>,
    );
    expect(container.textContent).toContain("Etherscan");
  });

  it("shows BSCTRACE source badge for BSC network", () => {
    const bscToken: SettingsToken = { ...mockToken, network: "BSC", contractAddress: "0xdef" };
    const { container } = render(
      <table><tbody>
        <TokenRow token={bscToken} onUpdate={vi.fn()} />
      </tbody></table>,
    );
    expect(container.textContent).toContain("BSCScan");
  });

  it("shows BINANCE source badge for CEX_BINANCE network", () => {
    const cexToken: SettingsToken = { ...mockToken, network: "CEX_BINANCE", contractAddress: null };
    const { container } = render(
      <table><tbody>
        <TokenRow token={cexToken} onUpdate={vi.fn()} />
      </tbody></table>,
    );
    expect(container.textContent).toContain("Binance");
  });
});
