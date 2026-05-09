import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTestApiKey } from "../useTestApiKey";

vi.mock("../../../lib/api-client", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

import { apiClient } from "../../../lib/api-client";
const mockPost = vi.mocked(apiClient.post);

describe("useTestApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("all services start with idle status", () => {
    const { result } = renderHook(() => useTestApiKey());
    expect(result.current.states.etherscan.status).toBe("idle");
    expect(result.current.states.bsctrace.status).toBe("idle");
    expect(result.current.states.binance.status).toBe("idle");
  });

  it("test('etherscan') transitions idle → testing → connected", async () => {
    mockPost.mockResolvedValueOnce({ status: "connected", meta: { latencyMs: 340 } });

    const { result } = renderHook(() => useTestApiKey());

    await act(async () => {
      await result.current.test("etherscan");
    });

    expect(result.current.states.etherscan.status).toBe("connected");
    if (result.current.states.etherscan.status === "connected") {
      expect(result.current.states.etherscan.meta?.latencyMs).toBe(340);
    }
  });

  it("test('binance') sets connected state with assetCount", async () => {
    mockPost.mockResolvedValueOnce({
      status: "connected",
      meta: { assetCount: 42 },
    });

    const { result } = renderHook(() => useTestApiKey());

    await act(async () => {
      await result.current.test("binance");
    });

    const state = result.current.states.binance;
    expect(state.status).toBe("connected");
    if (state.status === "connected") {
      expect(state.meta?.assetCount).toBe(42);
    }
  });

  it("test returns failed state with reason on API failure", async () => {
    mockPost.mockResolvedValueOnce({
      status: "failed",
      reason: "Invalid API key",
    });

    const { result } = renderHook(() => useTestApiKey());

    await act(async () => {
      await result.current.test("binance");
    });

    const state = result.current.states.binance;
    expect(state.status).toBe("failed");
    if (state.status === "failed") {
      expect(state.reason).toBe("Invalid API key");
    }
  });

  it("test returns failed with 'API key requires read permissions' reason", async () => {
    mockPost.mockResolvedValueOnce({
      status: "failed",
      reason: "API key requires read permissions",
    });

    const { result } = renderHook(() => useTestApiKey());

    await act(async () => {
      await result.current.test("binance");
    });

    const state = result.current.states.binance;
    expect(state.status).toBe("failed");
    if (state.status === "failed") {
      expect(state.reason).toBe("API key requires read permissions");
    }
  });

  it("sets failed reason 'Request timed out' on AbortError (simulated)", async () => {
    vi.useFakeTimers();

    mockPost.mockImplementationOnce((_url, _body, options) => {
      return new Promise((_resolve, reject) => {
        // Simulate abort when signal fires
        options?.signal?.addEventListener("abort", () => {
          const err = new DOMException("The user aborted a request.", "AbortError");
          reject(err);
        });
      });
    });

    const { result } = renderHook(() => useTestApiKey());

    const testPromise = act(async () => {
      void result.current.test("etherscan");
    });

    // Advance timers past the 10s timeout
    await act(async () => {
      vi.advanceTimersByTime(11_000);
    });

    await testPromise;

    const state = result.current.states.etherscan;
    expect(state.status).toBe("failed");
    if (state.status === "failed") {
      expect(state.reason).toBe("Request timed out");
    }

    vi.useRealTimers();
  });

  it("services are independent: etherscan test does not affect binance state", async () => {
    mockPost.mockResolvedValueOnce({ status: "connected", meta: { latencyMs: 200 } });

    const { result } = renderHook(() => useTestApiKey());

    await act(async () => {
      await result.current.test("etherscan");
    });

    // etherscan should be connected, binance should remain idle
    expect(result.current.states.etherscan.status).toBe("connected");
    expect(result.current.states.binance.status).toBe("idle");
    expect(result.current.states.bsctrace.status).toBe("idle");
  });

  it("posts to the correct endpoint for each service", async () => {
    mockPost.mockResolvedValue({ status: "connected" });

    const { result } = renderHook(() => useTestApiKey());

    await act(async () => {
      await result.current.test("bsctrace");
    });

    expect(mockPost).toHaveBeenCalledWith(
      "/api/credentials/test/bsctrace",
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
