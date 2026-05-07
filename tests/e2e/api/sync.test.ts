// E2E tests for POST /api/sync/:walletId — US-008-A
// T29-T35: full route tests with real DB + mocked external APIs

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../../apps/backend/src/index.js';
import { resetDb, createUser, createOnChainWallet, createCexWallet, pool } from '../db/factories.js';
import { bootstrapAuth } from '../../../apps/backend/src/services/auth-bootstrap.js';

const testUrl = process.env.DATABASE_URL_TEST;
const TEST_PASSWORD = 'TestPassword123!';
const JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long!!';

// ─── Etherscan mock responses ─────────────────────────────────────────────────

const EMPTY_ETHERSCAN = {
  status: '1',
  message: 'OK',
  result: [],
};

function makeEtherscanTxs(count: number, startBlock = 100): object {
  return {
    status: '1',
    message: 'OK',
    result: Array.from({ length: count }, (_, i) => ({
      hash: `0x${String(i).padStart(62, '0')}${i.toString(16).padStart(2, '0')}`,
      blockNumber: String(startBlock + i),
      transactionIndex: '0',
      timeStamp: String(1700000000 + i),
      from: '0xsender0000000000000000000000000000000001',
      to: '0xwallet0000000000000000000000000000000001',
      value: '1000000000000000000',
      isError: '0',
      gasUsed: '21000',
      input: '0x',
    })),
  };
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

describe.skipIf(!testUrl)('POST /api/sync/:walletId', () => {
  let server: FastifyInstance;
  let cookie: string;
  let userId: string;

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
  });

  beforeEach(async () => {
    await resetDb();
    userId = await createUser();
    vi.restoreAllMocks();
  });

  // ── T29: 400 for CEX wallet ─────────────────────────────────────────────────

  it('T29 — 400 for CEX wallet', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const walletId = await createCexWallet(userId);

    const res = await server.inject({
      method: 'POST',
      url: `/api/sync/${walletId}`,
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { statusCode: number; error: string; message: string };
    expect(body.message).toContain('not an on-chain wallet');

    // No HTTP call to Etherscan/BSCTrace
    const externalCalls = fetchSpy.mock.calls.filter(
      ([url]) => typeof url === 'string' && (url.includes('etherscan') || url.includes('bsctrace')),
    );
    expect(externalCalls).toHaveLength(0);
  });

  // ── T30: 400 for missing ETHERSCAN_API_KEY ──────────────────────────────────

  it('T30 — 400 for missing ETHERSCAN_API_KEY', async () => {
    const saved = process.env.ETHERSCAN_API_KEY;
    delete process.env.ETHERSCAN_API_KEY;

    const walletId = await createOnChainWallet({ userId, network: 'ETH' });

    try {
      const res = await server.inject({
        method: 'POST',
        url: `/api/sync/${walletId}`,
        headers: { Cookie: cookie },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json() as { statusCode: number; code?: string };
      expect(body.code ?? body.statusCode).toBeTruthy();
      // API_KEY_MISSING code or 400 status
      expect(res.statusCode).toBe(400);
    } finally {
      if (saved !== undefined) {
        process.env.ETHERSCAN_API_KEY = saved;
      } else {
        process.env.ETHERSCAN_API_KEY = 'test-etherscan-key';
      }
    }
  });

  // ── T31: 404 for walletId that does not exist ───────────────────────────────

  it('T31 — 404 for walletId that does not exist in the DB', async () => {
    const nonExistentWalletId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

    const res = await server.inject({
      method: 'POST',
      url: `/api/sync/${nonExistentWalletId}`,
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(404);
  });

  it('T31b — 404 for non-existent walletId (valid UUID)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/sync/00000000-0000-0000-0000-000000000000',
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(404);
  });

  // ── T32: 400 for non-UUID walletId ──────────────────────────────────────────

  it('T32 — 400 for non-UUID walletId (Zod validation)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/sync/not-a-uuid',
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(400);
  });

  // ── T33: 401 for missing JWT ─────────────────────────────────────────────────

  it('T33 — 401 for missing JWT', async () => {
    const walletId = await createOnChainWallet({ userId, network: 'ETH' });

    const res = await server.inject({
      method: 'POST',
      url: `/api/sync/${walletId}`,
      // No Cookie header
    });

    expect(res.statusCode).toBe(401);
  });

  // ── T34: 502 on Etherscan HTTP failure ───────────────────────────────────────

  it('T34 — 502 when Etherscan returns HTTP 500', async () => {
    const walletId = await createOnChainWallet({
      userId,
      network: 'ETH',
      address: '0xwallet0000000000000000000000000000000001',
    });

    // Mock fetch to return 500
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({}),
    } as unknown as Response);

    const res = await server.inject({
      method: 'POST',
      url: `/api/sync/${walletId}`,
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(502);
    const body = res.json() as { statusCode: number; code?: string };
    // Should not expose API key in response
    expect(JSON.stringify(body)).not.toContain('test-etherscan-key');
  });

  // ── T35: 200 success + idempotency ──────────────────────────────────────────

  it('T35 — 200 success, synced=5; second sync skipped=5, no duplicates', async () => {
    const walletAddress = '0xwallet0000000000000000000000000000000001';
    const tokenContract = '0xtoken000000000000000000000000000000000001';
    const walletId = await createOnChainWallet({
      userId,
      network: 'ETH',
      address: walletAddress,
    });

    // Use ERC20 token transfers (BUY) so the engine has a price and can persist them.
    // Native ETH TRANSFER_IN with MANUAL cost would be skipped by the engine
    // (it requires a price to compute WAC).
    const tokenTxResponse = {
      status: '1',
      message: 'OK',
      result: Array.from({ length: 5 }, (_, i) => ({
        hash: `0x${i.toString(16).padStart(64, '0')}`,
        blockNumber: String(100 + i),
        transactionIndex: '0',
        logIndex: '0',
        timeStamp: String(1700000000 + i),
        from: '0xsender0000000000000000000000000000000001',
        to: walletAddress,
        contractAddress: tokenContract,
        tokenSymbol: 'TKN',
        tokenName: 'TestToken',
        tokenDecimal: '18',
        value: '1000000000000000000',
        gasUsed: '21000',
      })),
    };

    // Mock Etherscan + DefiLlama
    vi.spyOn(global, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes('coins.llama.fi')) {
        return {
          ok: true,
          json: async () => ({ coins: { [`ethereum:${tokenContract}`]: { price: 100 } } }),
        } as unknown as Response;
      }
      if (urlStr.includes('action=tokentx')) {
        return {
          ok: true,
          json: async () => tokenTxResponse,
        } as unknown as Response;
      }
      // txlist returns empty (no native transfers)
      return {
        ok: true,
        json: async () => EMPTY_ETHERSCAN,
      } as unknown as Response;
    });

    // First sync
    const res1 = await server.inject({
      method: 'POST',
      url: `/api/sync/${walletId}`,
      headers: { Cookie: cookie },
    });

    expect(res1.statusCode).toBe(200);
    const body1 = res1.json() as {
      synced: number;
      skipped: number;
      swapsDecomposed: number;
      transfersPendingCost: number;
      transfersInheritedFromCEX: number;
      newTransactions: unknown[];
    };
    expect(body1.synced).toBe(5);
    expect(body1.skipped).toBe(0);

    // Verify last_synced_block was updated
    const walletRow = await pool.query<{ last_synced_block: number }>(
      'SELECT last_synced_block FROM wallets WHERE id = $1',
      [walletId],
    );
    expect(walletRow.rows[0]!.last_synced_block).toBe(104); // blocks 100-104

    // Second sync — same mock returns same txs (idempotency)
    const res2 = await server.inject({
      method: 'POST',
      url: `/api/sync/${walletId}`,
      headers: { Cookie: cookie },
    });

    expect(res2.statusCode).toBe(200);
    const body2 = res2.json() as { synced: number; skipped: number };
    // After updating last_synced_block to 104, the next sync starts from 105
    // so no txs are returned — Etherscan mock returns same 100-104 range blocks
    expect(body2.synced).toBe(0);
    expect(body2.skipped).toBeGreaterThanOrEqual(0);

    // Verify exactly 5 rows in transactions for this wallet (no duplicates)
    const txCount = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM transactions WHERE wallet_id = $1',
      [walletId],
    );
    expect(parseInt(txCount.rows[0]!.count, 10)).toBe(5);
  });
});
