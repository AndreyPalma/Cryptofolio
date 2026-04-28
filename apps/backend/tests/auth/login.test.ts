/**
 * SC-LOGIN-01 through SC-LOGIN-05 — POST /api/auth/login tests
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

describe("POST /api/auth/login", () => {
  it("SC-LOGIN-01 — correct password → 200 { ok: true } + Set-Cookie with JWT", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: CORRECT_PASSWORD }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const setCookie = res.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookieStr).toContain("token=");
    expect(cookieStr).toContain("HttpOnly");
  });

  it("SC-LOGIN-01 JWT — decoded token has sub=admin and exp within 24h", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: CORRECT_PASSWORD }),
    });

    const setCookie = res.headers["set-cookie"];
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    // Extract the token value from the cookie string
    const tokenMatch = cookieStr?.match(/token=([^;]+)/);
    expect(tokenMatch).not.toBeNull();
    const token = tokenMatch![1];

    // Decode the JWT payload (without verification — we just inspect the claims)
    const [, payloadB64] = token.split(".");
    const payload = JSON.parse(Buffer.from(payloadB64!, "base64url").toString());

    expect(payload.sub).toBe("admin");
    expect(payload.exp).toBeTypeOf("number");
    expect(payload.iat).toBeTypeOf("number");
    // exp should be iat + 86400 (within a few seconds tolerance)
    expect(payload.exp - payload.iat).toBeGreaterThanOrEqual(86390);
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(86410);
  });

  it("SC-LOGIN-02 — wrong password → 401 { error: Unauthorized }, no Set-Cookie", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "WrongPassword!" }),
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Unauthorized" });
    // No cookie should be set on failed login
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("NEGATIVE-SC-LOGIN-02 — 401 body does NOT contain user/exist/found/hint", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "WrongPassword!" }),
    });

    const bodyStr = res.body.toLowerCase();
    expect(bodyStr).not.toContain("user");
    expect(bodyStr).not.toContain("exist");
    expect(bodyStr).not.toContain("found");
    expect(bodyStr).not.toContain("hint");
  });

  it("SC-LOGIN-03 — body {} (missing password field) → 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(400);
  });

  it("SC-LOGIN-04 — form-encoded body → 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "password=SecurePassword123!",
    });

    expect(res.statusCode).toBe(400);
  });

  it("SC-LOGIN-05 — request without cookie + correct password → 200 (login is public route)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "Content-Type": "application/json" },
      // Explicitly no cookie header
      body: JSON.stringify({ password: CORRECT_PASSWORD }),
    });

    expect(res.statusCode).toBe(200);
  });
});
