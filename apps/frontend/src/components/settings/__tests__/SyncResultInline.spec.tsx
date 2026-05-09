import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SyncResultInline } from "../SyncResultInline";
import type { SyncResultUnion } from "../../../types/settings";

describe("SyncResultInline", () => {
  it("renders on-chain result with synced/skipped/swaps", () => {
    const result: SyncResultUnion = {
      kind: "on-chain",
      synced: 12,
      skipped: 3,
      swapsDecomposed: 2,
      transfersPendingCost: 1,
      transfersInheritedFromCEX: 0,
    };

    const { container } = render(<SyncResultInline result={result} />);
    expect(container.textContent).toContain("12");
    expect(container.textContent).toContain("3");
    expect(container.textContent).toContain("2");
  });

  it("renders cex result with 4 sub-categories", () => {
    const result: SyncResultUnion = {
      kind: "cex",
      trades: { synced: 10, skipped: 1, symbolsProcessed: 3 },
      converts: { synced: 2, skipped: 0 },
      withdrawals: { synced: 1, skipped: 0 },
      deposits: { synced: 4, skipped: 0, inherited: 2, manual: 2 },
      tokensCreated: 1,
    };

    const { container } = render(<SyncResultInline result={result} />);
    // All 4 categories visible
    expect(container.textContent?.toLowerCase()).toContain("trade");
    expect(container.textContent?.toLowerCase()).toContain("convert");
    expect(container.textContent?.toLowerCase()).toContain("withdrawal");
    expect(container.textContent?.toLowerCase()).toContain("deposit");
    // Numbers present
    expect(container.textContent).toContain("10");
    expect(container.textContent).toContain("4");
  });
});
