// E2E tests for /api/tokens — US-005 Phase 7
// Uses buildServer() from apps/backend/src/index.ts + real DB via factories.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../../apps/backend/src/index.js";
import { resetDb, createUser, createToken } from "../db/factories.js";
import { bootstrapAuth } from "../../../apps/backend/src/services/auth-bootstrap.js";

const testUrl = process.env.DATABASE_URL_TEST;
const TEST_PASSWORD = "TestPassword123!";
const JWT_SECRET = "test-jwt-secret-at-least-32-chars-long!!";

async function getAuthCookie(server: FastifyInstance): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: TEST_PASSWORD }),
  });
  const setCookie = res.headers["set-cookie"];
  const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie ?? "";
  const match = cookieStr.match(/^(token=[^;]+)/);
  return match ? match[1] : "";
}

describe.skipIf(!testUrl)("GET /api/tokens", () => {
  let server: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    process.env.APP_PASSWORD = TEST_PASSWORD;
    process.env.JWT_SECRET = JWT_SECRET;
    await bootstrapAuth();
    server = await buildServer({ jwtSecret: JWT_SECRET });
    cookie = await getAuthCookie(server);
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    await resetDb();
    await createUser();
  });

  it("SC-TOKEN-GET-01: returns 200 with visible tokens (excludes hidden)", async () => {
    // Create visible token
    await createToken({ symbol: "USDC", network: "ETH", contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" });
    // Insert hidden token directly
    const { pool } = await import("../db/factories.js");
    await pool.query(
      `INSERT INTO tokens (symbol, network, contract_address, decimals, is_hidden)
       VALUES ('SHIB', 'ETH', '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', 18, true)`,
    );

    const res = await server.inject({
      method: "GET",
      url: "/api/tokens",
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(200);
    const tokens = res.json() as { symbol: string; is_hidden: boolean }[];
    expect(tokens.every((t) => !t.is_hidden)).toBe(true);
    expect(tokens.some((t) => t.symbol === "USDC")).toBe(true);
  });

  it("SC-TOKEN-GET-02: ?network=CEX_BINANCE filters by network", async () => {
    await createToken({ symbol: "USDC", network: "ETH", contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" });
    await createToken({ symbol: "ETH", network: "CEX_BINANCE", contractAddress: null, binanceSymbol: "ETHUSDT" });

    const res = await server.inject({
      method: "GET",
      url: "/api/tokens?network=CEX_BINANCE",
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(200);
    const tokens = res.json() as { network: string }[];
    expect(tokens.every((t) => t.network === "CEX_BINANCE")).toBe(true);
  });

  it("SC-TOKEN-GET-03: ?includeHidden=true includes hidden tokens", async () => {
    await createToken({ symbol: "USDC", network: "ETH", contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" });
    const { pool } = await import("../db/factories.js");
    await pool.query(
      `INSERT INTO tokens (symbol, network, contract_address, decimals, is_hidden)
       VALUES ('SHIB', 'ETH', '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', 18, true)`,
    );

    const res = await server.inject({
      method: "GET",
      url: "/api/tokens?includeHidden=true",
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(200);
    const tokens = res.json() as { symbol: string; is_hidden: boolean }[];
    expect(tokens.some((t) => t.is_hidden)).toBe(true);
    expect(tokens).toHaveLength(2);
  });

  it("AUTH: GET /api/tokens without cookie → 401", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/tokens",
    });

    expect(res.statusCode).toBe(401);
  });
});

describe.skipIf(!testUrl)("POST /api/tokens", () => {
  let server: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    process.env.APP_PASSWORD = TEST_PASSWORD;
    process.env.JWT_SECRET = JWT_SECRET;
    await bootstrapAuth();
    server = await buildServer({ jwtSecret: JWT_SECRET });
    cookie = await getAuthCookie(server);
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    await resetDb();
    await createUser();
  });

  it("SC-TOKEN-POST-01: CEX token creation → 201 with auto-generated contract_address", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/tokens",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        symbol: "BNB",
        name: "BNB",
        network: "CEX_BINANCE",
        binance_symbol: "BNBUSDT",
      }),
    });

    expect(res.statusCode).toBe(201);
    const token = res.json() as { contract_address: string; network: string };
    expect(token.contract_address).toBe("bnb");
    expect(token.network).toBe("CEX_BINANCE");
  });

  it("NEGATIVE: POST CEX without binance_symbol → 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/tokens",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        symbol: "BNB",
        name: "BNB",
        network: "CEX_BINANCE",
        // no binance_symbol
      }),
    });

    expect(res.statusCode).toBe(400);
  });
});

describe.skipIf(!testUrl)("PUT /api/tokens/:id", () => {
  let server: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    process.env.APP_PASSWORD = TEST_PASSWORD;
    process.env.JWT_SECRET = JWT_SECRET;
    await bootstrapAuth();
    server = await buildServer({ jwtSecret: JWT_SECRET });
    cookie = await getAuthCookie(server);
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    await resetDb();
    await createUser();
  });

  it("SC-TOKEN-PUT-01: update is_hidden and target_exit_price → 200", async () => {
    const tokenId = await createToken({
      symbol: "ETH",
      network: "CEX_BINANCE",
      contractAddress: null,
      binanceSymbol: "ETHUSDT",
    });

    const res = await server.inject({
      method: "PUT",
      url: `/api/tokens/${tokenId}`,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ is_hidden: true, target_exit_price: "3000.00" }),
    });

    expect(res.statusCode).toBe(200);
    const token = res.json() as { is_hidden: boolean; target_exit_price: string };
    expect(token.is_hidden).toBe(true);
    expect(token.target_exit_price).toBe("3000.00");
  });
});
