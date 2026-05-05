// E2E tests for /api/wallets — US-005 Phase 7
// Uses buildServer() from apps/backend/src/index.ts + real DB via factories.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../../apps/backend/src/index.js";
import { resetDb, createUser, createOnChainWallet, createCexWallet } from "../db/factories.js";
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
  // Return just "token=<value>" portion for use in Cookie header
  const match = cookieStr.match(/^(token=[^;]+)/);
  return match ? match[1] : "";
}

describe.skipIf(!testUrl)("GET /api/wallets", () => {
  let server: FastifyInstance;
  let cookie: string;
  let userId: string;

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
    userId = await createUser();
  });

  it("SC-WALLET-GET-01: returns 200 with empty array when no wallets", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/wallets",
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("SC-WALLET-GET-01: returns 200 with existing wallets", async () => {
    await createOnChainWallet({ userId });
    const res = await server.inject({
      method: "GET",
      url: "/api/wallets",
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(200);
    const wallets = res.json() as unknown[];
    expect(wallets).toHaveLength(1);
  });

  it("AUTH: GET /api/wallets without cookie → 401", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/wallets",
    });

    expect(res.statusCode).toBe(401);
  });
});

describe.skipIf(!testUrl)("GET /api/wallets/:id", () => {
  let server: FastifyInstance;
  let cookie: string;
  let userId: string;

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
    userId = await createUser();
  });

  it("SC-WALLET-GET-ID-01: existing wallet → 200 with wallet data", async () => {
    const walletId = await createOnChainWallet({ userId });
    const res = await server.inject({
      method: "GET",
      url: `/api/wallets/${walletId}`,
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(200);
    const wallet = res.json() as { id: string };
    expect(wallet.id).toBe(walletId);
  });

  it("SC-WALLET-GET-ID-02: non-existent wallet → 404", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/wallets/00000000-0000-0000-0000-000000000000",
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe.skipIf(!testUrl)("POST /api/wallets", () => {
  let server: FastifyInstance;
  let cookie: string;
  let userId: string;

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
    userId = await createUser();
  });

  it("SC-WALLET-POST-01: ON_CHAIN creation → 201 with wallet", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/wallets",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        wallet_type: "ON_CHAIN",
        label: "Mi wallet ETH",
        address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        network: "ETH",
      }),
    });

    expect(res.statusCode).toBe(201);
    const wallet = res.json() as { wallet_type: string; network: string };
    expect(wallet.wallet_type).toBe("ON_CHAIN");
    expect(wallet.network).toBe("ETH");
  });

  it("SC-WALLET-POST-02: CEX creation → 201 with address null", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/wallets",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        wallet_type: "CEX",
        label: "Binance",
        network: "CEX_BINANCE",
      }),
    });

    expect(res.statusCode).toBe(201);
    const wallet = res.json() as { wallet_type: string; address: null };
    expect(wallet.wallet_type).toBe("CEX");
    expect(wallet.address).toBeNull();
  });

  it("NEGATIVE-R-01: ON_CHAIN without address → 400 with message 'Address required for on-chain wallet'", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/wallets",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        wallet_type: "ON_CHAIN",
        label: "Sin address",
        network: "ETH",
      }),
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { message: string };
    expect(body.message).toBe("Address required for on-chain wallet");
  });

  it("NEGATIVE-R-03: ON_CHAIN with invalid address → 400 'Invalid Ethereum address'", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/wallets",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        wallet_type: "ON_CHAIN",
        label: "Bad address",
        address: "0xINVALIDA",
        network: "ETH",
      }),
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { message: string };
    expect(body.message).toBe("Invalid Ethereum address");
  });

  it("NEGATIVE-R-02: second CEX POST → 409 (Binance already configured)", async () => {
    // Create first CEX wallet via factory
    await createCexWallet(userId);

    const res = await server.inject({
      method: "POST",
      url: "/api/wallets",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        wallet_type: "CEX",
        label: "Binance 2",
        network: "CEX_BINANCE",
      }),
    });

    expect(res.statusCode).toBe(409);
  });

  it("AUTH: POST /api/wallets without cookie → 401", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/wallets",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet_type: "ON_CHAIN",
        label: "test",
        address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        network: "ETH",
      }),
    });

    expect(res.statusCode).toBe(401);
  });
});

describe.skipIf(!testUrl)("PUT /api/wallets/:id", () => {
  let server: FastifyInstance;
  let cookie: string;
  let userId: string;

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
    userId = await createUser();
  });

  it("SC-WALLET-PUT-01: update label → 200 with updated wallet", async () => {
    const walletId = await createOnChainWallet({ userId, label: "Original" });
    const res = await server.inject({
      method: "PUT",
      url: `/api/wallets/${walletId}`,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ label: "Actualizada" }),
    });

    expect(res.statusCode).toBe(200);
    const wallet = res.json() as { label: string };
    expect(wallet.label).toBe("Actualizada");
  });
});

describe.skipIf(!testUrl)("DELETE /api/wallets/:id", () => {
  let server: FastifyInstance;
  let cookie: string;
  let userId: string;

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
    userId = await createUser();
  });

  it("SC-WALLET-DELETE-01: delete existing wallet → 204 no body", async () => {
    const walletId = await createOnChainWallet({ userId });
    const res = await server.inject({
      method: "DELETE",
      url: `/api/wallets/${walletId}`,
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
  });
});
