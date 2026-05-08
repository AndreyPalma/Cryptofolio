/**
 * Tests for toChecksumAddress (EIP-55)
 * Reference: https://eips.ethereum.org/EIPS/eip-55
 */
import { describe, it, expect } from "vitest";
import { toChecksumAddress } from "../src/lib/checksum-address";

describe("toChecksumAddress", () => {
  it("produces correct EIP-55 checksum for reference address 1", () => {
    const input = "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed";
    const expected = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
    expect(toChecksumAddress(input)).toBe(expected);
  });

  it("produces correct EIP-55 checksum for reference address 2", () => {
    const input = "0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359";
    const expected = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";
    expect(toChecksumAddress(input)).toBe(expected);
  });

  it("produces correct EIP-55 checksum for reference address 3", () => {
    const input = "0xdbf03b407c01e7cd3cbea99509d93f8dddc8c6fb";
    const expected = "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB";
    expect(toChecksumAddress(input)).toBe(expected);
  });

  it("is idempotent: checksumming an already-checksummed address gives same result", () => {
    const addr = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
    expect(toChecksumAddress(toChecksumAddress(addr))).toBe(
      toChecksumAddress(addr),
    );
  });

  it("accepts address without 0x prefix and returns 0x-prefixed result", () => {
    const result = toChecksumAddress("5aaeb6053f3e94c9b9a09f33669435e7ef1beaed");
    expect(result).toMatch(/^0x/);
    expect(result).toBe("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed");
  });

  it("output contains both uppercase and lowercase hex chars (not all-lower)", () => {
    const result = toChecksumAddress(
      "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed",
    );
    const hex = result.slice(2);
    expect(hex).not.toBe(hex.toLowerCase());
    expect(hex).not.toBe(hex.toUpperCase());
  });

  it("does not crash on empty string", () => {
    expect(() => toChecksumAddress("")).not.toThrow();
  });
});
