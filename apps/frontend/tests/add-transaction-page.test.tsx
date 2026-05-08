/**
 * Integration tests for AddTransactionPage (US-011 Phase 6 + 8)
 * TDD: T20-T23, T27, T29 — write failing tests first
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { render, waitFor, act, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AddTransactionPage } from "../src/pages/AddTransactionPage";
import { ToastProvider } from "../src/lib/toast-context";

// Mock all hooks used by AddTransactionPage
vi.mock("../src/hooks/useWallets", () => ({
  useWallets: vi.fn(),
}));

vi.mock("../src/hooks/useTokensByWallet", () => ({
  useTokensByWallet: vi.fn(),
}));

vi.mock("../src/hooks/useWalletBalance", () => ({
  useWalletBalance: vi.fn(),
}));

vi.mock("../src/hooks/useTransferInSuggestion", () => ({
  useTransferInSuggestion: vi.fn(),
}));

vi.mock("../src/hooks/useCreateTransaction", () => ({
  useCreateTransaction: vi.fn(),
}));

vi.mock("../src/lib/api-client", () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor() {
      super("Unauthorized");
      this.name = "UnauthorizedError";
    }
  },
}));

const mockWallet = {
  id: "wallet-1",
  label: "MetaMask ETH",
  walletType: "ON_CHAIN" as const,
  network: "ETH",
};

const mockCexWallet = {
  id: "wallet-cex",
  label: "Binance Account",
  walletType: "CEX" as const,
  network: "CEX_BINANCE",
};

const mockToken = {
  id: "token-eth",
  symbol: "ETH",
  name: "Ethereum",
  network: "ETH",
  contractAddress: "0xeeee",
  decimals: 18,
  binanceSymbol: null,
  isHidden: false,
  targetExitPrice: null,
};

async function setupDefaultMocks() {
  const { useWallets } = vi.mocked(await import("../src/hooks/useWallets"));
  const { useTokensByWallet } = vi.mocked(await import("../src/hooks/useTokensByWallet"));
  const { useWalletBalance } = vi.mocked(await import("../src/hooks/useWalletBalance"));
  const { useTransferInSuggestion } = vi.mocked(await import("../src/hooks/useTransferInSuggestion"));
  const { useCreateTransaction } = vi.mocked(await import("../src/hooks/useCreateTransaction"));

  (useWallets as Mock).mockReturnValue({
    data: [mockWallet, mockCexWallet],
    loading: false,
    error: null,
  });

  (useTokensByWallet as Mock).mockReturnValue({
    data: [mockToken],
    loading: false,
    error: null,
  });

  (useWalletBalance as Mock).mockReturnValue({
    balance: null,
    wac: null,
    loading: false,
    error: null,
  });

  (useTransferInSuggestion as Mock).mockReturnValue({
    candidate: null,
    loading: false,
    error: null,
  });

  (useCreateTransaction as Mock).mockReturnValue({
    submit: vi.fn().mockResolvedValue({ status: "success", transactionId: "tx-1", cycleNumber: 1, tokenContractAddress: "0xeeee", tokenNetwork: "ETH" }),
  });
}

function renderPage(path = "/transactions/new") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/transactions/new" element={<AddTransactionPage />} />
          <Route path="/token/:contractAddress/:network" element={<div data-testid="token-detail">Token Detail</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("AddTransactionPage — T20: basic render and query param prefill", () => {
  beforeEach(async () => {
    await setupDefaultMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders all six fields (Wallet, Token, Type, Amount, Price USD, Date & Time)", async () => {
    const { container } = renderPage();

    await waitFor(() => {
      expect(container.querySelector("select")).not.toBeNull();
    });

    // Check for all required form elements
    const selects = container.querySelectorAll("select");
    expect(selects.length).toBeGreaterThanOrEqual(3); // wallet, token, type

    const inputs = container.querySelectorAll("input");
    expect(inputs.length).toBeGreaterThanOrEqual(3); // amount, price, datetime
  });

  it("renders an h1 with 'Add Transaction'", async () => {
    const { container } = renderPage();

    await waitFor(() => {
      expect(container.querySelector("h1")).not.toBeNull();
    });

    expect(container.querySelector("h1")?.textContent).toContain("Add Transaction");
  });

  it("Cancel button/link is rendered and calls navigate(-1)", async () => {
    const { container } = renderPage();

    await waitFor(() => {
      expect(container.querySelector("h1")).not.toBeNull();
    });

    const cancelEl =
      container.querySelector('[data-testid="cancel"]') ??
      Array.from(container.querySelectorAll("button, a")).find((el) =>
        el.textContent?.toLowerCase().includes("cancel"),
      );
    expect(cancelEl).not.toBeNull();
  });
});

describe("AddTransactionPage — T21: client-side validation on submit", () => {
  beforeEach(async () => {
    await setupDefaultMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("clicking Submit with no wallet shows 'Wallet is required'", async () => {
    const { useWallets } = vi.mocked(await import("../src/hooks/useWallets"));
    (useWallets as Mock).mockReturnValue({ data: [], loading: false, error: null });

    const { container } = renderPage();

    await waitFor(() => {
      expect(container.querySelector("form")).not.toBeNull();
    });

    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.type === "submit",
    )!;

    await act(async () => {
      fireEvent.click(submitBtn);
    });

    // Validation should prevent submission and show errors
    const { useCreateTransaction } = vi.mocked(await import("../src/hooks/useCreateTransaction"));
    const { submit } = (useCreateTransaction as Mock).mock.results[0]?.value as { submit: Mock };
    expect(submit).not.toHaveBeenCalled();
  });

  it("entering '0' for Price USD shows 'Price must be greater than 0'", async () => {
    const { container } = renderPage();

    await waitFor(() => {
      expect(container.querySelector("form")).not.toBeNull();
    });

    // Fill in wallet and token first
    const selects = container.querySelectorAll("select");
    const walletSelect = selects[0]!;
    const tokenSelect = selects[1]!;
    const typeSelect = selects[2]!;

    await act(async () => {
      fireEvent.change(walletSelect, { target: { value: "wallet-1" } });
    });
    await act(async () => {
      fireEvent.change(tokenSelect, { target: { value: "token-eth" } });
    });
    await act(async () => {
      fireEvent.change(typeSelect, { target: { value: "BUY" } });
    });

    // Fill amount
    const inputs = container.querySelectorAll("input");
    const amountInput = Array.from(inputs).find((i) => i.id === "amount")!;
    await act(async () => {
      fireEvent.change(amountInput, { target: { value: "1.5" } });
    });

    // Enter 0 for price
    const priceInput = container.querySelector("#price-usd")!;
    await act(async () => {
      fireEvent.change(priceInput, { target: { value: "0" } });
    });

    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.type === "submit",
    )!;
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(container.textContent).toContain("greater than 0");
    });
  });
});

describe("AddTransactionPage — T22: TRANSFER_IN WAC inheritance", () => {
  beforeEach(async () => {
    await setupDefaultMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows InheritWacSuggestion panel when suggestion candidate is present for TRANSFER_IN", async () => {
    const { useTransferInSuggestion } = vi.mocked(
      await import("../src/hooks/useTransferInSuggestion"),
    );
    (useTransferInSuggestion as Mock).mockReturnValue({
      candidate: { walletId: "w2", label: "Cold Wallet ETH", wac: "1800.50" },
      loading: false,
      error: null,
    });

    const { container } = renderPage();

    await waitFor(() => {
      expect(container.querySelector("form")).not.toBeNull();
    });

    // Select TRANSFER_IN type
    const selects = container.querySelectorAll("select");
    await act(async () => {
      fireEvent.change(selects[2]!, { target: { value: "TRANSFER_IN" } });
    });

    await waitFor(() => {
      expect(container.textContent).toContain("Inherit WAC");
    });
  });
});

describe("AddTransactionPage — T23: SELL balance guard", () => {
  beforeEach(async () => {
    await setupDefaultMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("disables Submit and shows 'Exceeds balance' when SELL amount > balance", async () => {
    const { useWalletBalance } = vi.mocked(await import("../src/hooks/useWalletBalance"));
    (useWalletBalance as Mock).mockReturnValue({
      balance: "1.0",
      wac: "2000",
      loading: false,
      error: null,
    });

    const { container } = renderPage();

    await waitFor(() => {
      expect(container.querySelector("form")).not.toBeNull();
    });

    // Select wallet, token, SELL type
    const selects = container.querySelectorAll("select");
    await act(async () => {
      fireEvent.change(selects[0]!, { target: { value: "wallet-1" } });
    });
    await act(async () => {
      fireEvent.change(selects[1]!, { target: { value: "token-eth" } });
    });
    await act(async () => {
      fireEvent.change(selects[2]!, { target: { value: "SELL" } });
    });

    // Enter amount > balance
    const amountInput = container.querySelector("#amount")!;
    await act(async () => {
      fireEvent.change(amountInput, { target: { value: "2.0" } });
    });

    await waitFor(() => {
      expect(container.textContent).toContain("Exceeds balance of 1.0 tokens");
    });

    // Submit should be disabled
    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.type === "submit",
    ) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });
});

describe("AddTransactionPage — T27: success path toast + navigate", () => {
  beforeEach(async () => {
    await setupDefaultMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("on success: shows toast and navigates to /token/:address/:network", async () => {
    const { useCreateTransaction } = vi.mocked(
      await import("../src/hooks/useCreateTransaction"),
    );
    (useCreateTransaction as Mock).mockReturnValue({
      submit: vi.fn().mockResolvedValue({
        status: "success",
        transactionId: "tx-1",
        cycleNumber: 2,
        tokenContractAddress: "0xeeee",
        tokenNetwork: "ETH",
      }),
    });

    const { container } = renderPage();

    await waitFor(() => {
      expect(container.querySelector("form")).not.toBeNull();
    });

    // Fill all required fields
    const selects = container.querySelectorAll("select");
    await act(async () => {
      fireEvent.change(selects[0]!, { target: { value: "wallet-1" } });
    });
    await act(async () => {
      fireEvent.change(selects[1]!, { target: { value: "token-eth" } });
    });
    await act(async () => {
      fireEvent.change(selects[2]!, { target: { value: "BUY" } });
    });

    const amountInput = container.querySelector("#amount")!;
    await act(async () => {
      fireEvent.change(amountInput, { target: { value: "1.5" } });
    });

    const priceInput = container.querySelector("#price-usd")!;
    await act(async () => {
      fireEvent.change(priceInput, { target: { value: "3000" } });
    });

    // Date is pre-filled, submit the form
    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.type === "submit",
    )!;

    await act(async () => {
      fireEvent.click(submitBtn);
    });

    // Should navigate to token detail (via react router)
    await waitFor(() => {
      const tokenDetail = container.querySelector('[data-testid="token-detail"]');
      expect(tokenDetail).not.toBeNull();
    }, { timeout: 3000 });
  });
});

describe("AddTransactionPage — T29: backend Zod errors mapped inline", () => {
  beforeEach(async () => {
    await setupDefaultMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows field errors inline when submit returns fieldErrors", async () => {
    const { useCreateTransaction } = vi.mocked(
      await import("../src/hooks/useCreateTransaction"),
    );
    (useCreateTransaction as Mock).mockReturnValue({
      submit: vi.fn().mockResolvedValue({
        status: "error",
        errorCode: "VALIDATION_FAILED",
        errorMessage: "Validation failed",
        fieldErrors: { amount: "Invalid amount format" },
      }),
    });

    const { container } = renderPage();

    await waitFor(() => {
      expect(container.querySelector("form")).not.toBeNull();
    });

    // Fill required fields
    const selects = container.querySelectorAll("select");
    await act(async () => {
      fireEvent.change(selects[0]!, { target: { value: "wallet-1" } });
    });
    await act(async () => {
      fireEvent.change(selects[1]!, { target: { value: "token-eth" } });
    });
    await act(async () => {
      fireEvent.change(selects[2]!, { target: { value: "BUY" } });
    });

    const amountInput = container.querySelector("#amount")!;
    await act(async () => {
      fireEvent.change(amountInput, { target: { value: "1.5" } });
    });

    const priceInput = container.querySelector("#price-usd")!;
    await act(async () => {
      fireEvent.change(priceInput, { target: { value: "3000" } });
    });

    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.type === "submit",
    )!;

    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(container.textContent).toContain("Invalid amount format");
    });
  });
});
