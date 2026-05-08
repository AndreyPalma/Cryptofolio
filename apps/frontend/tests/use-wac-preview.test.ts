/**
 * Tests for useWacPreview hook (US-011 Phase 3)
 * TDD: T7.R — write failing test first
 */
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useWacPreview } from "../src/hooks/useWacPreview";

describe("useWacPreview", () => {
  describe("BUY", () => {
    it("new position (currentBalance=null, currentWac=null) → newWac = price, newBalance = amount", () => {
      const { result } = renderHook(() =>
        useWacPreview(null, null, "BUY", "1", "3000"),
      );

      expect(result.current.visible).toBe(true);
      if (!result.current.visible) return;
      expect(result.current.newBalance).toBe(1);
      expect(result.current.newWac).toBe(3000);
    });

    it("adding to existing position: weighted average WAC", () => {
      // (1.0 × 2000 + 1.0 × 3000) / (1.0 + 1.0) = 2500
      const { result } = renderHook(() =>
        useWacPreview("1.0", "2000", "BUY", "1.0", "3000"),
      );

      expect(result.current.visible).toBe(true);
      if (!result.current.visible) return;
      expect(result.current.newWac).toBe(2500);
      expect(result.current.newBalance).toBe(2);
    });
  });

  describe("SELL", () => {
    it("reduces balance, WAC unchanged", () => {
      const { result } = renderHook(() =>
        useWacPreview("2.0", "2500", "SELL", "0.5", ""),
      );

      expect(result.current.visible).toBe(true);
      if (!result.current.visible) return;
      expect(result.current.newBalance).toBe(1.5);
      expect(result.current.newWac).toBe(2500);
    });

    it("outbound on empty position (balance=null) → visible: false", () => {
      const { result } = renderHook(() =>
        useWacPreview(null, null, "SELL", "1", ""),
      );

      expect(result.current.visible).toBe(false);
    });
  });

  describe("SWAP_IN", () => {
    it("behaves like BUY — weighted average WAC", () => {
      const { result } = renderHook(() =>
        useWacPreview("1.0", "2000", "SWAP_IN", "1.0", "3000"),
      );

      expect(result.current.visible).toBe(true);
      if (!result.current.visible) return;
      expect(result.current.newWac).toBe(2500);
      expect(result.current.newBalance).toBe(2);
    });
  });

  describe("SWAP_OUT", () => {
    it("behaves like SELL — reduces balance, WAC unchanged", () => {
      const { result } = renderHook(() =>
        useWacPreview("2.0", "2500", "SWAP_OUT", "0.5", ""),
      );

      expect(result.current.visible).toBe(true);
      if (!result.current.visible) return;
      expect(result.current.newBalance).toBe(1.5);
      expect(result.current.newWac).toBe(2500);
    });
  });

  describe("TRANSFER_IN", () => {
    it("with price behaves like BUY", () => {
      const { result } = renderHook(() =>
        useWacPreview("1.0", "2000", "TRANSFER_IN", "1.0", "3000"),
      );

      expect(result.current.visible).toBe(true);
      if (!result.current.visible) return;
      expect(result.current.newWac).toBe(2500);
      expect(result.current.newBalance).toBe(2);
    });
  });

  describe("TRANSFER_OUT", () => {
    it("with no price (empty string) → balance reduced, WAC unchanged", () => {
      const { result } = renderHook(() =>
        useWacPreview("2.0", "2500", "TRANSFER_OUT", "0.5", ""),
      );

      expect(result.current.visible).toBe(true);
      if (!result.current.visible) return;
      expect(result.current.newBalance).toBe(1.5);
      expect(result.current.newWac).toBe(2500);
    });
  });

  describe("invalid inputs → visible: false", () => {
    it("amount='abc' → visible: false", () => {
      const { result } = renderHook(() =>
        useWacPreview("1.0", "2000", "BUY", "abc", "3000"),
      );
      expect(result.current.visible).toBe(false);
    });

    it("BUY with NaN price → visible: false", () => {
      const { result } = renderHook(() =>
        useWacPreview("1.0", "2000", "BUY", "1.0", ""),
      );
      expect(result.current.visible).toBe(false);
    });

    it("amount='0' → visible: false", () => {
      const { result } = renderHook(() =>
        useWacPreview("1.0", "2000", "BUY", "0", "3000"),
      );
      expect(result.current.visible).toBe(false);
    });
  });
});
