/**
 * Tests for iso-datetime helpers (US-011 Phase 1)
 * TDD: T1.R — write failing test first
 */
import { describe, it, expect } from "vitest";
import { toIso8601, fromIso8601 } from "../src/lib/iso-datetime";

describe("toIso8601", () => {
  it("appends :00.000Z to a valid datetime-local string", () => {
    expect(toIso8601("2025-05-08T14:30")).toBe("2025-05-08T14:30:00.000Z");
  });

  it("returns empty string for empty input", () => {
    expect(toIso8601("")).toBe("");
  });

  it("handles midnight correctly", () => {
    expect(toIso8601("2024-01-01T00:00")).toBe("2024-01-01T00:00:00.000Z");
  });

  it("handles end of day correctly", () => {
    expect(toIso8601("2024-12-31T23:59")).toBe("2024-12-31T23:59:00.000Z");
  });
});

describe("fromIso8601", () => {
  it("slices ISO string to YYYY-MM-DDTHH:mm format", () => {
    expect(fromIso8601("2025-05-08T14:30:00.000Z")).toBe("2025-05-08T14:30");
  });

  it("round-trips with toIso8601", () => {
    const local = "2025-05-08T14:30";
    expect(fromIso8601(toIso8601(local))).toBe(local);
  });

  it("returns empty string for empty input", () => {
    expect(fromIso8601("")).toBe("");
  });
});
