/**
 * Tests for format helpers: formatUsd, formatPct, formatCrypto
 * Phase 2 — RED
 */
import { describe, it, expect } from "vitest";
import { formatUsd, formatPct, formatCrypto } from "../src/lib/format";

describe("formatUsd", () => {
  it("returns '—' for null", () => {
    expect(formatUsd(null)).toBe("—");
  });

  it("returns '—' for NaN string", () => {
    expect(formatUsd("NaN")).toBe("—");
  });

  it("returns '$0.00' for '0.00'", () => {
    expect(formatUsd("0.00")).toBe("$0.00");
  });

  it("returns '$12,345.67' for '12345.67'", () => {
    expect(formatUsd("12345.67")).toBe("$12,345.67");
  });

  it("returns '-$500.00' for -500 (number)", () => {
    expect(formatUsd(-500)).toBe("-$500.00");
  });

  it("returns '$1,500.00' for 1500 (number)", () => {
    expect(formatUsd(1500)).toBe("$1,500.00");
  });
});

describe("formatPct", () => {
  it("returns '—' for null", () => {
    expect(formatPct(null)).toBe("—");
  });

  it("returns '—' for NaN string", () => {
    expect(formatPct("NaN")).toBe("—");
  });

  it("returns '0.00%' for '0.00' (no sign prefix for zero)", () => {
    expect(formatPct("0.00")).toBe("0.00%");
  });

  it("returns '+23.46%' for '23.4567'", () => {
    expect(formatPct("23.4567")).toBe("+23.46%");
  });

  it("returns '-5.00%' for '-5.0000'", () => {
    expect(formatPct("-5.0000")).toBe("-5.00%");
  });
});

describe("formatCrypto", () => {
  it("returns '—' for null", () => {
    expect(formatCrypto(null)).toBe("—");
  });

  it("returns non-scientific notation for '0.00000001'", () => {
    const result = formatCrypto("0.00000001");
    expect(result).not.toContain("e");
    expect(result).not.toContain("E");
  });

  it("returns at most 8 significant figures for '1.23456789123'", () => {
    const result = formatCrypto("1.23456789123");
    // Should be 1.2345679 (8 sig figs) with no trailing zeros
    expect(result).not.toContain("e");
    expect(parseFloat(result)).toBeCloseTo(1.2345679, 5);
  });

  it("returns '1.5' for '1.50000000' (trims trailing zeros)", () => {
    const result = formatCrypto("1.50000000");
    expect(result).toBe("1.5");
  });
});
