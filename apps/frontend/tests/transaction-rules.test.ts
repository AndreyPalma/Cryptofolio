/**
 * Tests for transaction-rules helpers (US-011 Phase 1)
 * TDD: T2.R — write failing test first
 */
import { describe, it, expect } from "vitest";
import {
  isPriceRequired,
  isOutbound,
  isInbound,
  validateAmount,
  validatePriceUsd,
} from "../src/lib/transaction-rules";

describe("isPriceRequired", () => {
  it("returns true for BUY", () => expect(isPriceRequired("BUY")).toBe(true));
  it("returns true for SELL", () => expect(isPriceRequired("SELL")).toBe(true));
  it("returns true for SWAP_IN", () => expect(isPriceRequired("SWAP_IN")).toBe(true));
  it("returns true for SWAP_OUT", () => expect(isPriceRequired("SWAP_OUT")).toBe(true));
  it("returns true for TRANSFER_IN", () => expect(isPriceRequired("TRANSFER_IN")).toBe(true));
  it("returns false for TRANSFER_OUT", () => expect(isPriceRequired("TRANSFER_OUT")).toBe(false));
});

describe("isOutbound", () => {
  it("returns true for SELL", () => expect(isOutbound("SELL")).toBe(true));
  it("returns true for SWAP_OUT", () => expect(isOutbound("SWAP_OUT")).toBe(true));
  it("returns true for TRANSFER_OUT", () => expect(isOutbound("TRANSFER_OUT")).toBe(true));
  it("returns false for BUY", () => expect(isOutbound("BUY")).toBe(false));
  it("returns false for SWAP_IN", () => expect(isOutbound("SWAP_IN")).toBe(false));
  it("returns false for TRANSFER_IN", () => expect(isOutbound("TRANSFER_IN")).toBe(false));
});

describe("isInbound", () => {
  it("is complement of isOutbound for BUY", () => expect(isInbound("BUY")).toBe(true));
  it("is complement of isOutbound for SWAP_IN", () => expect(isInbound("SWAP_IN")).toBe(true));
  it("is complement of isOutbound for TRANSFER_IN", () => expect(isInbound("TRANSFER_IN")).toBe(true));
  it("is complement of isOutbound for SELL", () => expect(isInbound("SELL")).toBe(false));
  it("is complement of isOutbound for SWAP_OUT", () => expect(isInbound("SWAP_OUT")).toBe(false));
  it("is complement of isOutbound for TRANSFER_OUT", () => expect(isInbound("TRANSFER_OUT")).toBe(false));
});

describe("validateAmount", () => {
  it("returns an error string for '0'", () => {
    const result = validateAmount("0");
    expect(typeof result).toBe("string");
    expect(result).not.toBeNull();
  });

  it("returns null for '1.5' (valid positive decimal)", () => {
    expect(validateAmount("1.5")).toBeNull();
  });

  it("returns null for '1' (valid integer)", () => {
    expect(validateAmount("1")).toBeNull();
  });

  it("returns an error string for empty string (required field)", () => {
    const result = validateAmount("");
    expect(typeof result).toBe("string");
    expect(result).not.toBeNull();
  });

  it("returns an error string for negative value '-1'", () => {
    const result = validateAmount("-1");
    expect(typeof result).toBe("string");
    expect(result).not.toBeNull();
  });

  it("returns an error string for 'abc'", () => {
    const result = validateAmount("abc");
    expect(typeof result).toBe("string");
    expect(result).not.toBeNull();
  });
});

describe("validatePriceUsd", () => {
  it("returns an error string for '0' with BUY type", () => {
    const result = validatePriceUsd("0", "BUY");
    expect(typeof result).toBe("string");
    expect(result).not.toBeNull();
  });

  it("returns an error string for '0' with SELL type", () => {
    const result = validatePriceUsd("0", "SELL");
    expect(typeof result).not.toBeNull();
  });

  it("returns null for empty string with TRANSFER_OUT (optional field)", () => {
    expect(validatePriceUsd("", "TRANSFER_OUT")).toBeNull();
  });

  it("returns an error string for '0' with TRANSFER_OUT (zero always invalid even when optional)", () => {
    const result = validatePriceUsd("0", "TRANSFER_OUT");
    expect(typeof result).toBe("string");
    expect(result).not.toBeNull();
  });

  it("returns null for '3000' with BUY type (valid)", () => {
    expect(validatePriceUsd("3000", "BUY")).toBeNull();
  });

  it("returns an error string for empty string with BUY type (required)", () => {
    const result = validatePriceUsd("", "BUY");
    expect(typeof result).toBe("string");
    expect(result).not.toBeNull();
  });

  it("returns null for non-empty valid value with TRANSFER_OUT", () => {
    expect(validatePriceUsd("100.50", "TRANSFER_OUT")).toBeNull();
  });

  it("error for '0' mentions 'greater than 0'", () => {
    const result = validatePriceUsd("0", "BUY");
    expect(result).toContain("greater than 0");
  });
});
