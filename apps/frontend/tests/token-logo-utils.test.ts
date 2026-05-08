/**
 * Tests for token-logo-utils: computeAvatarColor, networkToChain
 * Phase 2 — RED
 */
import { describe, it, expect } from "vitest";
import {
  computeAvatarColor,
  networkToChain,
} from "../src/lib/token-logo-utils";

describe("computeAvatarColor", () => {
  it("returns a valid CSS hex color string for 'ETH'", () => {
    const color = computeAvatarColor("ETH");
    expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("is deterministic: same symbol returns same color", () => {
    expect(computeAvatarColor("ETH")).toBe(computeAvatarColor("ETH"));
  });

  it("different symbols return different colors (ETH vs BNB)", () => {
    // Probabilistic — if palette has ≥2 entries, these should differ
    expect(computeAvatarColor("ETH")).not.toBe(computeAvatarColor("BNB"));
  });

  it("does not crash on empty string and returns a valid hex", () => {
    const color = computeAvatarColor("");
    expect(() => computeAvatarColor("")).not.toThrow();
    expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("does not return the Binance yellow #F0B90B", () => {
    // Ensure Binance yellow is excluded from palette
    const colors = ["ETH", "BNB", "BTC", "USDT", "SOL", "ADA", "DOT", "LINK"].map(
      computeAvatarColor,
    );
    colors.forEach((c) => {
      expect(c.toUpperCase()).not.toBe("#F0B90B");
    });
  });
});

describe("networkToChain", () => {
  it("'ETH' → 'ethereum'", () => {
    expect(networkToChain("ETH")).toBe("ethereum");
  });

  it("'BSC' → 'smartchain'", () => {
    expect(networkToChain("BSC")).toBe("smartchain");
  });
});
