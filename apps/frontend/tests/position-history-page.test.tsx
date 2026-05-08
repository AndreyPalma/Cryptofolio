/**
 * Tests for PositionHistoryPage (US-010 Phase 6)
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../src/lib/api-client", () => ({
  apiClient: { get: vi.fn() },
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor() {
      super("Unauthorized");
      this.name = "UnauthorizedError";
    }
  },
}));

import { PositionHistoryPage } from "../src/pages/PositionHistoryPage";
import type { PositionHistoryResponse } from "../src/types/token-detail";

const mockHistoryData: PositionHistoryResponse = {
  cycles: [
    {
      cycleNumber: 1,
      openedAt: "2024-01-01T00:00:00.000Z",
      closedAt: "2024-06-30T00:00:00.000Z",
      realizedPnlUsd: "2500.0",
    },
    {
      cycleNumber: 2,
      openedAt: "2024-07-01T00:00:00.000Z",
      closedAt: "2024-12-31T00:00:00.000Z",
      realizedPnlUsd: "-500.0",
    },
  ],
};

const emptyHistory: PositionHistoryResponse = { cycles: [] };

function renderPage(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/token/:contractAddress/:network/history"
          element={<PositionHistoryPage />}
        />
        <Route
          path="/token/:contractAddress/:network"
          element={<div data-testid="token-detail">Token Detail</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PositionHistoryPage", () => {
  let mockGet: Mock;

  beforeEach(async () => {
    const { apiClient } = await import("../src/lib/api-client");
    mockGet = apiClient.get as Mock;
    mockGet.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("T-056: renders one CycleCard per PositionHistoryEntry", async () => {
    mockGet.mockResolvedValue(mockHistoryData);

    const { container } = renderPage("/token/0xaaa/ETH/history");

    await act(async () => { await Promise.resolve(); });

    await waitFor(() => {
      // Should see both cycle badges
      expect(container.textContent).toContain("CYCLE #1");
      expect(container.textContent).toContain("CYCLE #2");
    });
  });

  it("T-057: renders 'No closed cycles yet' when cycles.length === 0", async () => {
    mockGet.mockResolvedValue(emptyHistory);

    const { container } = renderPage("/token/0xaaa/ETH/history");

    await act(async () => { await Promise.resolve(); });

    await waitFor(() => {
      expect(container.textContent).toContain("No closed cycles yet");
    });
  });

  it("T-058: BackLink navigates to /token/:contractAddress/:network", async () => {
    mockGet.mockResolvedValue(emptyHistory);

    const { container } = renderPage("/token/0xaaa/ETH/history");

    const backLink = container.querySelector("a[href*='/token/0xaaa/ETH']");
    expect(backLink).not.toBeNull();
  });
});
