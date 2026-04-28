/**
 * SC-LOGOUT-01 through SC-LOGOUT-03 — POST /api/auth/logout tests
 * RED phase: written before implementation
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer } from "./helpers/test-server.js";

const CORRECT_PASSWORD = "TestPassword123!";

let server: FastifyInstance;

beforeAll(async () => {
  process.env.APP_PASSWORD = CORRECT_PASSWORD;
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-chars-long!!";
  server = await buildTestServer();
});

afterAll(async () => {
  await server.close();
});

describe("POST /api/auth/logout", () => {
  it("SC-LOGOUT-01 — client with valid cookie → 200 { ok: true } + Set-Cookie with Max-Age=0", async () => {
    // First, log in to get a cookie
    const loginRes = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: CORRECT_PASSWORD }),
    });
    const setCookie = loginRes.headers["set-cookie"];
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const tokenMatch = cookieStr?.match(/token=([^;]+)/);
    const token = tokenMatch?.[1] ?? "";

    const res = await server.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie: `token=${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const logoutCookie = res.headers["set-cookie"];
    const logoutCookieStr = Array.isArray(logoutCookie) ? logoutCookie[0] : logoutCookie;
    expect(logoutCookieStr).toContain("Max-Age=0");
  });

  it("SC-LOGOUT-02 — client WITHOUT cookie → 200 { ok: true } (idempotent, not 401)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/auth/logout",
      // No cookie header
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("SC-LOGOUT-03 — logout not blocked by auth middleware (no cookie → not 401)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/auth/logout",
    });

    // Must not be blocked by middleware
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).toBe(200);
  });
});
