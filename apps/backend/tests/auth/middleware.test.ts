/**
 * SC-MW-01 through SC-MW-07 — authPlugin onRequest middleware tests
 * RED phase: written before implementation
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer } from "./helpers/test-server.js";
import jwt from "@fastify/jwt";
import Fastify from "fastify";

const CORRECT_PASSWORD = "TestPassword123!";
const JWT_SECRET = "test-jwt-secret-at-least-32-chars-long!!";

let server: FastifyInstance;

beforeAll(async () => {
  process.env.APP_PASSWORD = CORRECT_PASSWORD;
  process.env.JWT_SECRET = JWT_SECRET;
  server = await buildTestServer();
});

afterAll(async () => {
  await server.close();
});

/** Helper: get a valid token by logging in */
async function loginAndGetToken(): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: CORRECT_PASSWORD }),
  });
  const setCookie = res.headers["set-cookie"];
  const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = cookieStr?.match(/token=([^;]+)/);
  return match?.[1] ?? "";
}

/** Helper: create a JWT signed with a DIFFERENT secret (tampered) */
async function createTamperedToken(): Promise<string> {
  const helper = Fastify();
  await helper.register(jwt, { secret: "a-completely-different-secret-32chars!!" });
  const token = helper.jwt.sign({ sub: "admin" }, { expiresIn: "24h" });
  await helper.close();
  return token;
}

/** Helper: create an expired JWT */
async function createExpiredToken(): Promise<string> {
  const helper = Fastify();
  await helper.register(jwt, { secret: JWT_SECRET });
  // Sign with exp in the past — use a numeric value
  const now = Math.floor(Date.now() / 1000);
  const token = helper.jwt.sign({ sub: "admin", exp: now - 3600 });
  await helper.close();
  return token;
}

describe("authPlugin — onRequest middleware", () => {
  it("SC-MW-01 — GET /api/test with valid cookie → 200", async () => {
    const token = await loginAndGetToken();

    const res = await server.inject({
      method: "GET",
      url: "/api/test",
      headers: { cookie: `token=${token}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it("SC-MW-02 — GET /api/test without cookie → 401 { error: Unauthorized }", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/test",
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Unauthorized" });
  });

  it("SC-MW-03 — GET /api/test with expired token → 401", async () => {
    const expiredToken = await createExpiredToken();

    const res = await server.inject({
      method: "GET",
      url: "/api/test",
      headers: { cookie: `token=${expiredToken}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it("SC-MW-04 — GET /api/test with tampered token (signed with different secret) → 401", async () => {
    const tamperedToken = await createTamperedToken();

    const res = await server.inject({
      method: "GET",
      url: "/api/test",
      headers: { cookie: `token=${tamperedToken}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it("SC-MW-05 — GET /api/test with malformed cookie token → 401 (not 500)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/test",
      headers: { cookie: "token=not.a.jwt" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.statusCode).not.toBe(500);
  });

  it("SC-MW-06 — POST /api/auth/login without cookie → middleware does NOT return 401 (reaches handler)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: CORRECT_PASSWORD }),
    });

    // Should reach the login handler, not be blocked by middleware
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).toBe(200);
  });

  it("SC-MW-07 — POST /api/auth/logout without cookie → middleware does NOT return 401", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/auth/logout",
    });

    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).toBe(200);
  });
});
