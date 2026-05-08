/**
 * Tests for useRelativeTime hook
 * Phase 3 — RED
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRelativeTime } from "../src/hooks/useRelativeTime";

describe("useRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'Never updated' when date is null", () => {
    const { result } = renderHook(() => useRelativeTime(null));
    expect(result.current.label).toBe("Never updated");
    expect(result.current.secondsSinceUpdate).toBeNull();
  });

  it("shows 'Updated 5s ago' after 5 seconds", () => {
    const now = new Date();
    const { result } = renderHook(() => useRelativeTime(now));

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current.label).toBe("Updated 5s ago");
  });

  it("shows 'Updated 59s ago' after 59 seconds", () => {
    const now = new Date();
    const { result } = renderHook(() => useRelativeTime(now));

    act(() => {
      vi.advanceTimersByTime(59000);
    });

    expect(result.current.label).toBe("Updated 59s ago");
  });

  it("shows 'Updated 1m ago' after 60 seconds", () => {
    const now = new Date();
    const { result } = renderHook(() => useRelativeTime(now));

    act(() => {
      vi.advanceTimersByTime(60000);
    });

    expect(result.current.label).toBe("Updated 1m ago");
  });

  it("shows 'Updated 59m ago' after 3599 seconds", () => {
    const now = new Date();
    const { result } = renderHook(() => useRelativeTime(now));

    act(() => {
      vi.advanceTimersByTime(3599000);
    });

    expect(result.current.label).toBe("Updated 59m ago");
  });

  it("shows 'Updated 1h+ ago' after 3600 seconds", () => {
    const now = new Date();
    const { result } = renderHook(() => useRelativeTime(now));

    act(() => {
      vi.advanceTimersByTime(3600000);
    });

    expect(result.current.label).toBe("Updated 1h+ ago");
  });

  it("cleanup: advancing time after unmount does not throw", () => {
    const now = new Date();
    const { unmount } = renderHook(() => useRelativeTime(now));

    unmount();

    // Should not throw or setState after unmount
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(5000);
      });
    }).not.toThrow();
  });
});
