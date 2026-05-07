// binance-sync.test.ts — US-008-B [e2e]
// E2E tests for POST /api/sync/:walletId → BinanceSyncService dispatch.
// Requires real DB (DATABASE_URL_TEST) and mocked Binance HTTP calls.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../../apps/backend/src/index.js';
import { resetDb, createUser, createOnChainWallet, createCexWallet, pool } from '../db/factories.js';
import { bootstrapAuth } from '../../../apps/backend/src/services/auth-bootstrap.js';
import { BinanceSyncResultSchema } from '../../../apps/backend/src/schemas/sync.js';

const testUrl = process.env.DATABASE_URL_TEST;
const TEST_PASSWORD = 'TestPassword123!';
const JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long!!';

// ─── Binance mock responses ───────────────────────────────────────────────────

/** Empty Binance account (no balances) */
const EMPTY_ACCOUNT = { balances: [] };

/** Successful empty convert history */
const EMPTY_CONVERT = { list: [] };

/** Empty withdraw/deposit history */
const EMPTY_ARRAY: unknown[] = [];

/**
 * Returns a mock fetch that routes requests to appropriate empty Binance responses.
 * All requests to api.binance.com return empty success responses.
 */
function makeBinanceMockFetch(overrides: Record<string, unknown> = {}) {
  return vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
    const urlStr = url.toString();

    // Check overrides first
    for (const [pattern, response] of Object.entries(overrides)) {
      if (urlStr.includes(pattern)) {
        if (typeof response === 'object' && response !== null && 'status' in response) {
          return response as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => response,
        } as unknown as Response;
      }
    }

    // Default: empty Binance responses
    if (urlStr.includes('/api/v3/account')) {
      return { ok: true, status: 200, json: async () => EMPTY_ACCOUNT } as unknown as Response;
    }
    if (urlStr.includes('/api/v3/myTrades')) {
      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    }
    if (urlStr.includes('/sapi/v1/convert/tradeFlow')) {
      return { ok: true, status: 200, json: async () => EMPTY_CONVERT } as unknown as Response;
    }
    if (urlStr.includes('/sapi/v1/capital/withdraw/history')) {
      return { ok: true, status: 200, json: async () => EMPTY_ARRAY } as unknown as Response;
    }
    if (urlStr.includes('/sapi/v1/capital/deposit/hisrec')) {
      return { ok: true, status: 200, json: async () => EMPTY_ARRAY } as unknown as Response;
    }

    // Etherscan fallback (for ON_CHAIN tests in same suite)
    if (urlStr.includes('etherscan') || urlStr.includes('bsctrace')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: '1', message: 'OK', result: [] }),
      } as unknown as Response;
    }

    // Catch-all
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  });
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

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

// ─── Test suite ───────────────────────────────────────────────────────────────

describe.skipIf(!testUrl)('POST /api/sync/:walletId — Binance CEX branch', () => {
  let server: FastifyInstance;
  let cookie: string;
  let userId: string;

  const TEST_BINANCE_API_KEY = 'test-binance-api-key-12345';
  const TEST_BINANCE_SECRET = 'test-binance-secret-key-12345';

  beforeAll(async () => {
    process.env.APP_PASSWORD = TEST_PASSWORD;
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.ETHERSCAN_API_KEY = 'test-etherscan-key';
    process.env.BSCTRACE_API_KEY = 'test-bsctrace-key';
    process.env.DATABASE_URL = testUrl!;

    await bootstrapAuth();
    server = await buildServer({ jwtSecret: JWT_SECRET });
    cookie = await getAuthCookie(server);
  });

  afterAll(async () => {
    await server.close();
    await pool.end();
  });

  beforeEach(async () => {
    await resetDb();
    userId = await createUser();
    vi.restoreAllMocks();
    // Default: configure Binance keys
    process.env.BINANCE_API_KEY = TEST_BINANCE_API_KEY;
    process.env.BINANCE_SECRET_KEY = TEST_BINANCE_SECRET;
  });

  // ─── T27: CEX wallet returns 200 with BinanceSyncResult shape ──────────────

  it('T27 — POST /api/sync/:cexWalletId returns 200 with BinanceSyncResult shape', async () => {
    const walletId = await createCexWallet(userId);

    vi.spyOn(global, 'fetch').mockImplementation(makeBinanceMockFetch());

    const res = await server.inject({
      method: 'POST',
      url: `/api/sync/${walletId}`,
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(200);

    const body = res.json();
    // Must pass schema validation
    const parsed = BinanceSyncResultSchema.safeParse(body);
    expect(parsed.success).toBe(true);

    const data = parsed.data!;
    expect(data.trades.symbolsProcessed).toBe(0);
    expect(data.trades.synced).toBe(0);
    expect(data.trades.skipped).toBe(0);
    expect(data.converts.synced).toBe(0);
    expect(data.withdrawals.synced).toBe(0);
    expect(data.deposits.synced).toBe(0);
    expect(data.tokensCreated).toBe(0);
  });

  // ─── T28: ON_CHAIN wallet still dispatches to OnChainSyncService ─────────────

  it('T28 — POST /api/sync/:onChainWalletId still dispatches to OnChainSyncService', async () => {
    const walletId = await createOnChainWallet({ userId, network: 'ETH' });

    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('etherscan') || urlStr.includes('bsctrace')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: '1', message: 'OK', result: [] }),
        } as unknown as Response;
      }
      // Binance routes should NOT be called
      if (urlStr.includes('binance.com')) {
        throw new Error('BinanceSyncService was called for an ON_CHAIN wallet — this is a bug');
      }
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    });

    const res = await server.inject({
      method: 'POST',
      url: `/api/sync/${walletId}`,
      headers: { Cookie: cookie },
    });

    // ON_CHAIN path returns 200 with SyncResult shape
    expect(res.statusCode).toBe(200);
    const body = res.json() as { synced: number; skipped: number };
    expect(typeof body.synced).toBe('number');
    expect(typeof body.skipped).toBe('number');

    // Verify no Binance API calls were made
    const binanceCalls = fetchMock.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.includes('binance.com'),
    );
    expect(binanceCalls).toHaveLength(0);
  });

  // ─── T29 (new): BINANCE_API_KEY not configured → 400 API_KEY_MISSING ────────

  it('T29 — BINANCE_API_KEY not configured → 400 API_KEY_MISSING', async () => {
    const walletId = await createCexWallet(userId);
    delete process.env.BINANCE_API_KEY;

    const res = await server.inject({
      method: 'POST',
      url: `/api/sync/${walletId}`,
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { code?: string; message: string };
    expect(body.code).toBe('API_KEY_MISSING');
    // Response must not contain the (empty) key value or other key info
    expect(JSON.stringify(body)).not.toContain('SECRET');
  });

  // ─── T30: Binance returns -2015 → 400 BINANCE_INVALID_CREDENTIALS ───────────

  it('T30 — Binance returns -2015 → 400 BINANCE_INVALID_CREDENTIALS', async () => {
    const walletId = await createCexWallet(userId);

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ code: -2015, msg: 'Invalid API-key, IP, or permissions for action.' }),
    } as unknown as Response);

    const res = await server.inject({
      method: 'POST',
      url: `/api/sync/${walletId}`,
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { code?: string; message: string };
    expect(body.code).toBe('BINANCE_INVALID_CREDENTIALS');
    // Keys must not appear in response
    expect(JSON.stringify(body)).not.toContain(TEST_BINANCE_API_KEY);
    expect(JSON.stringify(body)).not.toContain(TEST_BINANCE_SECRET);
  });

  // ─── T31: Binance HTTP 500 → 502 EXTERNAL_API_ERROR, keys absent from body ──

  it('T31 — Binance HTTP 500 → 502 EXTERNAL_API_ERROR, keys absent from body', async () => {
    const walletId = await createCexWallet(userId);

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ code: -1000, msg: 'Internal error.' }),
    } as unknown as Response);

    const res = await server.inject({
      method: 'POST',
      url: `/api/sync/${walletId}`,
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(502);
    const body = res.json() as { code?: string; message: string };
    expect(body.code).toBe('EXTERNAL_API_ERROR');
    // Keys must not appear in response
    expect(JSON.stringify(body)).not.toContain(TEST_BINANCE_API_KEY);
    expect(JSON.stringify(body)).not.toContain(TEST_BINANCE_SECRET);
  });

  // ─── T32: Wallet belonging to another user → 404 WALLET_NOT_FOUND ───────────

  it('T32 — wallet belonging to another user → 404 WALLET_NOT_FOUND', async () => {
    // Create a second user and their CEX wallet
    const otherUserId = await createUser();
    const otherWalletId = await createCexWallet(otherUserId);

    // Authenticated as userId (first user)
    const res = await server.inject({
      method: 'POST',
      url: `/api/sync/${otherWalletId}`,
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json() as { code?: string };
    expect(body.code).toBe('WALLET_NOT_FOUND');
  });
});
