/**
 * Tests for apiClient
 * SC-API-01..06
 * Strict TDD — RED phase: all tests FAIL before implementation
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiClient, registerAuthBridge, UnauthorizedError } from "../src/lib/api-client";

describe("apiClient", () => {
  let mockRedirectToLogin: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockRedirectToLogin = vi.fn();
    registerAuthBridge(mockRedirectToLogin);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // SC-API-01: all requests include credentials: 'include'
  it("SC-API-01: GET request includes credentials: include", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ wallets: [] }), { status: 200 }),
    );
    await apiClient.get("/api/wallets");
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, options] = fetchSpy.mock.calls[0]!;
    expect((options as RequestInit).credentials).toBe("include");
  });

  // SC-API-02: 401 response on non-login route → calls redirectToLogin and throws UnauthorizedError
  it("SC-API-02: 401 on non-login route calls redirectToLogin and throws UnauthorizedError", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    );
    await expect(apiClient.get("/api/wallets")).rejects.toBeInstanceOf(UnauthorizedError);
    expect(mockRedirectToLogin).toHaveBeenCalledOnce();
  });

  // SC-API-03: 200 response returns parsed JSON
  it("SC-API-03: 200 response returns parsed JSON", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [1, 2, 3] }), { status: 200 }),
    );
    const result = await apiClient.get<{ data: number[] }>("/api/wallets");
    expect(result).toEqual({ data: [1, 2, 3] });
  });

  // SC-API-04: network error (TypeError) → throws Error, NOT UnauthorizedError, redirectToLogin NOT called
  it("SC-API-04: network error throws Error (not UnauthorizedError) without redirectToLogin", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new TypeError("Network error"));
    await expect(apiClient.get("/api/wallets")).rejects.toThrow(TypeError);
    await expect(apiClient.get("/api/wallets")).rejects.not.toBeInstanceOf(UnauthorizedError);
    expect(mockRedirectToLogin).not.toHaveBeenCalled();
  });

  // SC-API-05: POST to /api/auth/login with skipAuthRedirect=true on 401 → throws UnauthorizedError but NO redirectToLogin
  it("SC-API-05: 401 on login with skipAuthRedirect=true throws but does NOT redirect", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    );
    await expect(
      apiClient.post("/api/auth/login", { password: "wrong" }, { skipAuthRedirect: true }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(mockRedirectToLogin).not.toHaveBeenCalled();
  });

  // SC-API-06: POST serializes body to JSON with correct Content-Type
  it("SC-API-06: POST serializes body as JSON with Content-Type: application/json", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await apiClient.post("/api/auth/login", { password: "abc" });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, options] = fetchSpy.mock.calls[0]!;
    const headers = new Headers((options as RequestInit).headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect((options as RequestInit).body).toBe('{"password":"abc"}');
  });
});
