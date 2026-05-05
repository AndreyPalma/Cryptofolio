// E2E tests for /api/portfolio — US-007
// Uses buildServer() from apps/backend/src/index.ts + real DB via factories.
// Price APIs are stubbed with vi.stubGlobal('fetch', vi.fn()) per test.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../../apps/backend/src/index.js';
import {
  resetDb,
  createUser,
  createOnChainWallet,
  createToken,
  pool,
} from '../db/factories.js';
import { bootstrapAuth } from '../../../apps/backend/src/services/auth-bootstrap.js';
import { createPriceService } from '../../../apps/backend/src/services/price.js';

const testUrl = process.env.DATABASE_URL_TEST;
const TEST_PASSWORD = 'TestPassword123!';
const JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long!!';

// Contract address used in all ON_CHAIN tests (lowercase for DefiLlama key matching)
const ETH_CONTRACT = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const ETH_NETWORK = 'ETH';

// Shared price service instance used only to reset the module-level cache between tests
const priceServiceForCacheReset = createPriceService({ warn: () => {} } as Parameters<typeof createPriceService>[0]);

// DefiLlama mock: returns price 3000 for our ETH token
function makeDefiLlamaMock(price = 3000) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      coins: {
        [`ethereum:${ETH_CONTRACT}`]: { price },
      },
    }),
  });
}

// Fetch that always throws — simulates complete network failure
function makeFailingFetch() {
  return vi.fn().mockRejectedValue(new Error('Network failure'));
}

async function getAuthCookie(server: FastifyInstance): Promise<string> {
  const res = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: TEST_PASSWORD }),
  });
  const setCookie = res.headers['set-cookie'];
  const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie ?? '';
  const match = cookieStr.match(/^(token=[^;]+)/);
  return match ? match[1] : '';
}

// ─── Shared setup helpers ─────────────────────────────────────────────────────

async function seedBuyTransaction(
  server: FastifyInstance,
  cookie: string,
  walletId: string,
  tokenId: string,
  opts: { amount?: string; price?: string; timestamp?: string } = {},
) {
  const res = await server.inject({
    method: 'POST',
    url: '/api/transactions',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      wallet_id: walletId,
      token_id: tokenId,
      type: 'BUY',
      amount: opts.amount ?? '1',
      price_usd_at_time: opts.price ?? '3000',
      block_timestamp: opts.timestamp ?? '2024-01-01T00:00:00.000Z',
    }),
  });
  return res;
}

// Inserts a CLOSED position directly into the DB for history tests
async function seedClosedPosition(
  walletId: string,
  tokenId: string,
  opts: {
    cycleNumber?: number;
    balance?: string;
    wac?: string;
    realizedPnl?: string;
    openedAt?: string;
    closedAt?: string;
  } = {},
): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO positions
       (wallet_id, token_id, cycle_number, status, balance, wac, cost_basis,
        realized_pnl_usd, opened_at, closed_at)
     VALUES ($1, $2, $3, 'CLOSED', $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      walletId,
      tokenId,
      opts.cycleNumber ?? 1,
      opts.balance ?? '0.00000000000000000000',
      opts.wac ?? '3000.00000000000000000000',
      opts.balance ?? '0.00000000000000000000',
      opts.realizedPnl ?? '0.00000000000000000000',
      opts.openedAt ?? '2024-01-01T00:00:00.000Z',
      opts.closedAt ?? '2024-01-02T00:00:00.000Z',
    ],
  );
  return r.rows[0]!.id;
}

// ─── GET /api/portfolio ───────────────────────────────────────────────────────

describe.skipIf(!testUrl)('GET /api/portfolio', () => {
  let server: FastifyInstance;
  let cookie: string;
  let userId: string;
  let walletId: string;
  let tokenId: string;

  beforeAll(async () => {
    // Point DATABASE_URL to the test DB so route plugins create pools against it
    process.env.DATABASE_URL = testUrl!;
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
    priceServiceForCacheReset.__resetCacheForTests?.();
    await resetDb();
    userId = await createUser();
    walletId = await createOnChainWallet({ userId });
    tokenId = await createToken({
      symbol: 'ETH',
      network: ETH_NETWORK as 'ETH',
      contractAddress: ETH_CONTRACT,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('E1: happy path — seeded position → 200 with tokens array ≥ 1 and ON_CHAIN aggregation', async () => {
    vi.stubGlobal('fetch', makeDefiLlamaMock(3000));

    await seedBuyTransaction(server, cookie, walletId, tokenId);

    const res = await server.inject({
      method: 'GET',
      url: '/api/portfolio',
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      tokens: Array<{ sourceType: string; symbol: string; totalBalance: string }>;
      totalValueUsd: string;
    };
    expect(body.tokens.length).toBeGreaterThanOrEqual(1);
    const ethRow = body.tokens.find((t) => t.symbol === 'ETH' && t.sourceType === 'ON_CHAIN');
    expect(ethRow).toBeDefined();
    expect(ethRow?.totalBalance).toMatch(/^1/);
  });

  it('E2: all price fetches fail → 200 (never 500); every token has priceUnavailable: true', async () => {
    vi.stubGlobal('fetch', makeFailingFetch());

    await seedBuyTransaction(server, cookie, walletId, tokenId);

    const res = await server.inject({
      method: 'GET',
      url: '/api/portfolio',
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      tokens: Array<{ priceUnavailable?: boolean }>;
    };
    expect(body.tokens.length).toBeGreaterThan(0);
    for (const token of body.tokens) {
      expect(token.priceUnavailable).toBe(true);
    }
  });

  it('E8: no JWT cookie → 401', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/portfolio',
    });

    expect(res.statusCode).toBe(401);
  });
});

// ─── GET /api/portfolio/token/:addr/:net ─────────────────────────────────────

describe.skipIf(!testUrl)('GET /api/portfolio/token/:contractAddress/:network', () => {
  let server: FastifyInstance;
  let cookie: string;
  let userId: string;
  let walletId: string;
  let tokenId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl!;
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
    priceServiceForCacheReset.__resetCacheForTests?.();
    await resetDb();
    userId = await createUser();
    walletId = await createOnChainWallet({ userId });
    tokenId = await createToken({
      symbol: 'ETH',
      network: ETH_NETWORK as 'ETH',
      contractAddress: ETH_CONTRACT,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('E3: valid ON_CHAIN token with OPEN position → 200; position not null; transactions array present', async () => {
    vi.stubGlobal('fetch', makeDefiLlamaMock(3000));

    await seedBuyTransaction(server, cookie, walletId, tokenId);

    const res = await server.inject({
      method: 'GET',
      url: `/api/portfolio/token/${ETH_CONTRACT}/${ETH_NETWORK}`,
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      token: { symbol: string };
      position: object | null;
      transactions: unknown[];
    };
    expect(body.token.symbol).toBe('ETH');
    expect(body.position).not.toBeNull();
    expect(Array.isArray(body.transactions)).toBe(true);
    expect(body.transactions.length).toBeGreaterThan(0);
  });

  it('E4: token does not exist → 404', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/portfolio/token/0x0000000000000000000000000000000000000001/ETH',
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(404);
  });

  it('E5: token exists, no OPEN position → position: null in response (not 404)', async () => {
    vi.stubGlobal('fetch', makeDefiLlamaMock(3000));

    // Token exists in DB but no transaction / position created
    const res = await server.inject({
      method: 'GET',
      url: `/api/portfolio/token/${ETH_CONTRACT}/${ETH_NETWORK}`,
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { position: null; transactions: unknown[] };
    expect(body.position).toBeNull();
    expect(Array.isArray(body.transactions)).toBe(true);
  });
});

// ─── GET /api/portfolio/token/:addr/:net/history ──────────────────────────────

describe.skipIf(!testUrl)('GET /api/portfolio/token/:contractAddress/:network/history', () => {
  let server: FastifyInstance;
  let cookie: string;
  let userId: string;
  let walletId: string;
  let tokenId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl!;
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
    priceServiceForCacheReset.__resetCacheForTests?.();
    await resetDb();
    userId = await createUser();
    walletId = await createOnChainWallet({ userId });
    tokenId = await createToken({
      symbol: 'ETH',
      network: ETH_NETWORK as 'ETH',
      contractAddress: ETH_CONTRACT,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('E6: CLOSED cycles present → 200; cycles array ordered by cycleNumber ASC', async () => {
    // Seed two closed cycles directly in DB
    await seedClosedPosition(walletId, tokenId, {
      cycleNumber: 1,
      openedAt: '2024-01-01T00:00:00.000Z',
      closedAt: '2024-01-02T00:00:00.000Z',
      realizedPnl: '100.00000000000000000000',
    });
    await seedClosedPosition(walletId, tokenId, {
      cycleNumber: 2,
      openedAt: '2024-02-01T00:00:00.000Z',
      closedAt: '2024-02-15T00:00:00.000Z',
      realizedPnl: '200.00000000000000000000',
    });

    const res = await server.inject({
      method: 'GET',
      url: `/api/portfolio/token/${ETH_CONTRACT}/${ETH_NETWORK}/history`,
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { cycles: Array<{ cycleNumber: number; realizedPnlUsd: string }> };
    expect(body.cycles).toHaveLength(2);
    expect(body.cycles[0]?.cycleNumber).toBe(1);
    expect(body.cycles[1]?.cycleNumber).toBe(2);
  });

  it('E7: no closed cycles → 200; cycles: []', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/portfolio/token/${ETH_CONTRACT}/${ETH_NETWORK}/history`,
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { cycles: unknown[] };
    expect(body.cycles).toEqual([]);
  });
});
