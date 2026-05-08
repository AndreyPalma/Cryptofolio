/**
 * Tests for usePositionHistory hook (US-010 Phase 2)
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
import { renderHook, waitFor } from "@testing-library/react";
import { usePositionHistory } from "../src/hooks/usePositionHistory";
import type { PositionHistoryResponse } from "../src/types/token-detail";

vi.mock("../src/lib/api-client", () => ({
  apiClient: {
    get: vi.fn(),
  },
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor() {
      super("Unauthorized");
      this.name = "UnauthorizedError";
    }
  },
}));

const mockHistory: PositionHistoryResponse = {
  cycles: [
    {
      cycleNumber: 1,
      openedAt: "2024-01-01T00:00:00.000Z",
      closedAt: "2024-06-30T00:00:00.000Z",
      realizedPnlUsd: "2500.0",
    },
  ],
};

describe("usePositionHistory", () => {
  let mockGet: Mock;

  beforeEach(async () => {
    const { apiClient } = await import("../src/lib/api-client");
    mockGet = apiClient.get as Mock;
    mockGet.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("T-028: one-shot fetch — sets loading → data on success, no interval", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGet.mockResolvedValue(mockHistory);

    const { result } = renderHook(() =>
      usePositionHistory("0xaaa", "ETH"),
    );

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(mockHistory);
    expect(result.current.error).toBeNull();

    // Advance 30s — no additional fetch should fire (one-shot, no polling)
    vi.advanceTimersByTime(30000);
    expect(mockGet.mock.calls.length).toBe(1);
  });
});
