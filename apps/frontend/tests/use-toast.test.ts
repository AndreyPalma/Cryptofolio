/**
 * Tests for useToast hook re-export (US-011 Phase 3)
 * TDD: T10.R — write failing test first (thin wrapper)
 */
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useToast } from "../src/hooks/useToast";
import { ToastProvider } from "../src/lib/toast-context";
import React from "react";

describe("useToast (re-export from hooks/useToast)", () => {
  it("resolves and show is a function when inside ToastProvider", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(ToastProvider, null, children);

    const { result } = renderHook(() => useToast(), { wrapper });
    expect(typeof result.current.show).toBe("function");
  });

  it("throws when called outside ToastProvider", () => {
    const consoleError = console.error;
    console.error = () => {}; // suppress React error boundary output

    let thrown: Error | null = null;
    try {
      const { result } = renderHook(() => {
        try {
          return useToast();
        } catch (e) {
          thrown = e as Error;
          return null;
        }
      });
      void result;
    } catch {
      // expected
    }

    console.error = consoleError;

    expect(thrown?.message).toContain("useToast must be used inside <ToastProvider>");
  });
});
