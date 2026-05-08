/**
 * Tests for DashboardPage Add Transaction button (US-011 Phase 7.1)
 * TDD: T25.R — write failing test first
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DashboardPage } from "../src/pages/DashboardPage";

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

const mockData = {
  totalValueUsd: "10000.00",
  totalCostBasis: "8000.00",
  totalPnlUsd: "2000.00",
  totalPnlPct: "25.00",
  tokens: [],
};

describe("DashboardPage — Add Transaction button (T25)", () => {
  let mockGet: Mock;

  beforeEach(async () => {
    const { apiClient } = await import("../src/lib/api-client");
    mockGet = apiClient.get as Mock;
    mockGet.mockReset();
    mockGet.mockResolvedValue(mockData);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders an 'Add Transaction' link navigating to /transactions/new", async () => {
    const { container } = render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const addLink = Array.from(container.querySelectorAll("a")).find((a) =>
        a.textContent?.includes("Add Transaction"),
      );
      expect(addLink).not.toBeNull();
      expect(addLink!.getAttribute("href")).toBe("/transactions/new");
    });
  });
});
