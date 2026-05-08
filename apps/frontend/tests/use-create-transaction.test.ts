/**
 * Tests for useCreateTransaction hook (US-011 Phase 3)
 * TDD: T9.R — write failing test first
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
import { renderHook } from "@testing-library/react";
import { useCreateTransaction } from "../src/hooks/useCreateTransaction";
import type { Token } from "../src/hooks/useTokensByWallet";

vi.mock("../src/lib/api-client", () => ({
  apiClient: {
    post: vi.fn(),
  },
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor() {
      super("Unauthorized");
      this.name = "UnauthorizedError";
    }
  },
}));

const mockToken: Token = {
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

const validInput = {
  walletId: "wallet-1",
  tokenId: "token-eth",
  type: "BUY" as const,
  amount: "1.5",
  priceUsd: "3000",
  dateLocal: "2025-05-08T14:30",
  costSource: "MANUAL" as const,
};

describe("useCreateTransaction", () => {
  let mockPost: Mock;

  beforeEach(async () => {
    const { apiClient } = await import("../src/lib/api-client");
    mockPost = apiClient.post as Mock;
    mockPost.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("201 response → returns { status: 'success', transactionId, cycleNumber, tokenContractAddress, tokenNetwork }", async () => {
    mockPost.mockResolvedValue({
      transaction_id: "tx-123",
      position_id: "pos-123",
      cycle_number: 2,
      status: "OPEN",
      wac: "3000",
      balance: "1.5",
    });

    const { result } = renderHook(() => useCreateTransaction());
    const res = await result.current.submit(validInput, [mockToken]);

    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.transactionId).toBe("tx-123");
    expect(res.cycleNumber).toBe(2);
    expect(res.tokenContractAddress).toBe("0xeeee");
    expect(res.tokenNetwork).toBe("ETH");
  });

  it("201 response → POST body contains correct snake_case fields with toIso8601 block_timestamp", async () => {
    mockPost.mockResolvedValue({
      transaction_id: "tx-123",
      position_id: "pos-123",
      cycle_number: 1,
      status: "OPEN",
      wac: "3000",
      balance: "1.5",
    });

    const { result } = renderHook(() => useCreateTransaction());
    await result.current.submit(validInput, [mockToken]);

    expect(mockPost).toHaveBeenCalledWith("/api/transactions", {
      wallet_id: "wallet-1",
      token_id: "token-eth",
      type: "BUY",
      amount: "1.5",
      price_usd_at_time: "3000",
      block_timestamp: "2025-05-08T14:30:00.000Z",
      cost_source: "MANUAL",
    });
  });

  it("400 INSUFFICIENT_BALANCE → returns { status: 'error', errorCode: 'INSUFFICIENT_BALANCE', currentBalance }", async () => {
    const apiError = new Error("HTTP 400: Bad Request");
    // Simulate the apiClient throwing with response data attached
    (apiError as unknown as Record<string, unknown>)["response"] = {
      error: "INSUFFICIENT_BALANCE",
      currentBalance: "0.5",
      attempted: "1.5",
    };

    mockPost.mockRejectedValue(apiError);

    // We need to test that useCreateTransaction handles HTTP errors
    // The apiClient throws on non-2xx. We need to mock at a deeper level.
    // Let's mock fetch directly for this test.
    const fetchMock = vi.fn().mockResolvedValue({
      status: 400,
      ok: false,
      statusText: "Bad Request",
      text: () => Promise.resolve(JSON.stringify({
        statusCode: 400,
        error: "INSUFFICIENT_BALANCE",
        message: "Insufficient balance",
        currentBalance: "0.5",
        attempted: "1.5",
      })),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCreateTransaction());
    const res = await result.current.submit(validInput, [mockToken]);

    expect(res.status).toBe("error");
    if (res.status !== "error") return;
    expect(res.errorCode).toBe("INSUFFICIENT_BALANCE");
    expect(res.currentBalance).toBe("0.5");

    vi.unstubAllGlobals();
  });

  it("400 Validation failed → returns { status: 'error', fieldErrors keyed by path }", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 400,
      ok: false,
      statusText: "Bad Request",
      text: () => Promise.resolve(JSON.stringify({
        statusCode: 400,
        error: "Bad Request",
        message: "Validation failed",
        issues: [
          { path: ["amount"], message: "amount must be positive" },
        ],
      })),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCreateTransaction());
    const res = await result.current.submit(validInput, [mockToken]);

    expect(res.status).toBe("error");
    if (res.status !== "error") return;
    expect(res.fieldErrors).toBeDefined();
    expect(res.fieldErrors["amount"]).toBeDefined();

    vi.unstubAllGlobals();
  });

  it("other 4xx error → returns { status: 'error', errorMessage: generic message }", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 500,
      ok: false,
      statusText: "Internal Server Error",
      text: () => Promise.resolve(JSON.stringify({ error: "InternalError" })),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCreateTransaction());
    const res = await result.current.submit(validInput, [mockToken]);

    expect(res.status).toBe("error");
    if (res.status !== "error") return;
    expect(res.errorMessage).toContain("Could not save");

    vi.unstubAllGlobals();
  });

  it("TRANSFER_OUT with null priceUsd → sends price_usd_at_time: null", async () => {
    mockPost.mockResolvedValue({
      transaction_id: "tx-123",
      position_id: "pos-123",
      cycle_number: 1,
      status: "OPEN",
      wac: "3000",
      balance: "1.5",
    });

    const { result } = renderHook(() => useCreateTransaction());
    await result.current.submit(
      { ...validInput, type: "TRANSFER_OUT", priceUsd: null },
      [mockToken],
    );

    expect(mockPost).toHaveBeenCalledWith("/api/transactions", expect.objectContaining({
      price_usd_at_time: null,
    }));
  });
});
