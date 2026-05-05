// E2E tests for /api/transactions — US-006
// Uses buildServer() from apps/backend/src/index.ts + real DB via factories.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../../apps/backend/src/index.js';
import {
  resetDb,
  createUser,
  createOnChainWallet,
  createCexWallet,
  createToken,
  pool,
} from '../db/factories.js';
import { bootstrapAuth } from '../../../apps/backend/src/services/auth-bootstrap.js';

const testUrl = process.env.DATABASE_URL_TEST;
const TEST_PASSWORD = 'TestPassword123!';
const JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long!!';

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

// ─── POST /api/transactions ───────────────────────────────────────────────────

describe.skipIf(!testUrl)('POST /api/transactions', () => {
  let server: FastifyInstance;
  let cookie: string;
  let userId: string;
  let walletId: string;
  let tokenId: string;

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
    walletId = await createOnChainWallet({ userId });
    tokenId = await createToken({
      symbol: 'ETH',
      network: 'ETH',
      contractAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    });
  });

  it('SC-ROUTE-POST-01: BUY exitoso → 201 con position nueva', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        wallet_id: walletId,
        token_id: tokenId,
        type: 'BUY',
        amount: '1',
        price_usd_at_time: '3000',
        block_timestamp: '2024-01-01T00:00:00.000Z',
      }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      transaction_id: string;
      position_id: string;
      cycle_number: number;
      status: string;
      wac: string;
      balance: string;
    };
    expect(body.cycle_number).toBe(1);
    expect(body.status).toBe('OPEN');
    expect(body.wac).toMatch(/^3000/);
    expect(body.balance).toMatch(/^1/);
    expect(body.transaction_id).toBeTruthy();
    expect(body.position_id).toBeTruthy();
  });

  it('SC-ROUTE-POST-02: SELL exitoso (balance suficiente) → 201 con balance reducido, WAC igual', async () => {
    // First BUY
    await server.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        wallet_id: walletId,
        token_id: tokenId,
        type: 'BUY',
        amount: '1',
        price_usd_at_time: '3000',
        block_timestamp: '2024-01-01T00:00:00.000Z',
      }),
    });

    const res = await server.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        wallet_id: walletId,
        token_id: tokenId,
        type: 'SELL',
        amount: '0.5',
        price_usd_at_time: '4000',
        block_timestamp: '2024-01-02T00:00:00.000Z',
      }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { status: string; balance: string; wac: string };
    expect(body.status).toBe('OPEN');
    expect(body.balance).toMatch(/^0\.5/);
    expect(body.wac).toMatch(/^3000/); // WAC unchanged on SELL (INV-1)
  });

  it('SC-ROUTE-POST-03: SELL total → 201 con status CLOSED', async () => {
    await server.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        wallet_id: walletId,
        token_id: tokenId,
        type: 'BUY',
        amount: '1',
        price_usd_at_time: '3000',
        block_timestamp: '2024-01-01T00:00:00.000Z',
      }),
    });

    const res = await server.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        wallet_id: walletId,
        token_id: tokenId,
        type: 'SELL',
        amount: '1',
        price_usd_at_time: '3000',
        block_timestamp: '2024-01-02T00:00:00.000Z',
      }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { status: string; balance: string };
    expect(body.status).toBe('CLOSED');
    expect(body.balance).toMatch(/^0/);
  });

  it('SC-ROUTE-POST-04: BUY post-cierre → 201 con cycle_number 2', async () => {
    // Open and close cycle 1
    await server.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        wallet_id: walletId,
        token_id: tokenId,
        type: 'BUY',
        amount: '1',
        price_usd_at_time: '3000',
        block_timestamp: '2024-01-01T00:00:00.000Z',
      }),
    });
    await server.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        wallet_id: walletId,
        token_id: tokenId,
        type: 'SELL',
        amount: '1',
        price_usd_at_time: '3000',
        block_timestamp: '2024-01-02T00:00:00.000Z',
      }),
    });

    // Open cycle 2
    const res = await server.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        wallet_id: walletId,
        token_id: tokenId,
        type: 'BUY',
        amount: '0.5',
        price_usd_at_time: '2500',
        block_timestamp: '2024-01-03T00:00:00.000Z',
      }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { cycle_number: number; status: string };
    expect(body.cycle_number).toBe(2);
    expect(body.status).toBe('OPEN');
  });

  it('SC-ROUTE-POST-05: wallet CEX → 201 con source=MANUAL, tx_hash=null, cex_trade_id=null en DB', async () => {
    const cexWalletId = await createCexWallet(userId);
    const cexTokenId = await createToken({
      symbol: 'ETH',
      network: 'CEX_BINANCE',
      binanceSymbol: 'ETHUSDT',
    });

    const res = await server.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        wallet_id: cexWalletId,
        token_id: cexTokenId,
        type: 'BUY',
        amount: '1',
        price_usd_at_time: '3000',
        block_timestamp: '2024-01-01T00:00:00.000Z',
      }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { transaction_id: string };

    // Verify source/tx_hash/cex_trade_id in DB
    const txRow = await pool.query<{ source: string; tx_hash: string | null; cex_trade_id: string | null }>(
      `SELECT source, tx_hash, cex_trade_id FROM transactions WHERE id = $1`,
      [body.transaction_id],
    );
    expect(txRow.rows[0]?.source).toBe('MANUAL');
    expect(txRow.rows[0]?.tx_hash).toBeNull();
    expect(txRow.rows[0]?.cex_trade_id).toBeNull();
  });

  // ─── Negative cases ─────────────────────────────────────────────────────────

  it('NEGATIVE-ROUTE-01: SELL > balance → 400 INSUFFICIENT_BALANCE con currentBalance y attempted', async () => {
    await server.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        wallet_id: walletId,
        token_id: tokenId,
        type: 'BUY',
        amount: '0.5',
        price_usd_at_time: '3000',
        block_timestamp: '2024-01-01T00:00:00.000Z',
      }),
    });

    const res = await server.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        wallet_id: walletId,
        token_id: tokenId,
        type: 'SELL',
        amount: '1.0',
        price_usd_at_time: '4000',
        block_timestamp: '2024-01-02T00:00:00.000Z',
      }),
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string; currentBalance: string; attempted: string };
    expect(body.error).toBe('INSUFFICIENT_BALANCE');
    expect(body.currentBalance).toMatch(/^0\.5/);
    expect(body.attempted).toBe('1.0');

    // Verify no extra tx was inserted
    const txCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM transactions WHERE wallet_id = $1`,
      [walletId],
    );
    expect(txCount.rows[0]?.count).toBe('1'); // only the initial BUY
  });

  it('NEGATIVE-ROUTE-02: TRANSFER_IN con price_usd_at_time null → 400 PRICE_REQUIRED_FOR_TRANSFER_IN', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        wallet_id: walletId,
        token_id: tokenId,
        type: 'TRANSFER_IN',
        amount: '1',
        price_usd_at_time: null,
        block_timestamp: '2024-01-01T00:00:00.000Z',
      }),
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    // setErrorHandler maps DomainError.name → error field
    expect(body.error).toBe('ValidationError');
  });

  it('NEGATIVE-ROUTE-03: wallet_id inexistente → 404 WALLET_NOT_FOUND', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        wallet_id: '00000000-0000-0000-0000-000000000000',
        token_id: tokenId,
        type: 'BUY',
        amount: '1',
        price_usd_at_time: '3000',
        block_timestamp: '2024-01-01T00:00:00.000Z',
      }),
    });

    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: string };
    expect(body.error).toBe('NotFoundError');
  });

  it('NEGATIVE-ROUTE-04: token_id inexistente → 404 TOKEN_NOT_FOUND', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        wallet_id: walletId,
        token_id: '00000000-0000-0000-0000-000000000000',
        type: 'BUY',
        amount: '1',
        price_usd_at_time: '3000',
        block_timestamp: '2024-01-01T00:00:00.000Z',
      }),
    });

    expect(res.statusCode).toBe(404);
  });

  it('NEGATIVE-ROUTE-05: sin JWT (sin cookie token) → 401', async () => {
    const resPost = await server.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wallet_id: walletId,
        token_id: tokenId,
        type: 'BUY',
        amount: '1',
        price_usd_at_time: '3000',
        block_timestamp: '2024-01-01T00:00:00.000Z',
      }),
    });
    expect(resPost.statusCode).toBe(401);

    const resGet = await server.inject({
      method: 'GET',
      url: `/api/transactions?wallet_id=${walletId}`,
    });
    expect(resGet.statusCode).toBe(401);
  });

  it('NEGATIVE-ROUTE-06: body inválido (amount negativo, type desconocido) → 400 con issues', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        wallet_id: walletId,
        token_id: tokenId,
        type: 'UNKNOWN_TYPE',
        amount: '-1',
        price_usd_at_time: '3000',
        block_timestamp: '2024-01-01T00:00:00.000Z',
      }),
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { issues: unknown[] };
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
  });
});

// ─── GET /api/transactions ────────────────────────────────────────────────────

describe.skipIf(!testUrl)('GET /api/transactions', () => {
  let server: FastifyInstance;
  let cookie: string;
  let userId: string;
  let walletId: string;
  let tokenId: string;

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
    walletId = await createOnChainWallet({ userId });
    tokenId = await createToken({
      symbol: 'ETH',
      network: 'ETH',
      contractAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    });
  });

  it('SC-ROUTE-GET-01: listado con wallet_id → 200 con 3 items', async () => {
    // Create 3 transactions
    for (let i = 1; i <= 3; i++) {
      await server.inject({
        method: 'POST',
        url: '/api/transactions',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          wallet_id: walletId,
          token_id: tokenId,
          type: 'BUY',
          amount: String(i),
          price_usd_at_time: '3000',
          block_timestamp: `2024-01-0${i}T00:00:00.000Z`,
        }),
      });
    }

    const res = await server.inject({
      method: 'GET',
      url: `/api/transactions?wallet_id=${walletId}`,
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; total: number; limit: number; offset: number };
    expect(body.data).toHaveLength(3);
    expect(body.total).toBe(3);
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
  });

  it('SC-ROUTE-GET-02: filtro token_id → solo transacciones del par (wallet_id, token_id)', async () => {
    // Create a transaction for tokenId
    await server.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        wallet_id: walletId,
        token_id: tokenId,
        type: 'BUY',
        amount: '1',
        price_usd_at_time: '3000',
        block_timestamp: '2024-01-01T00:00:00.000Z',
      }),
    });

    // Create a second token and transaction
    const tokenId2 = await createToken({
      symbol: 'USDC',
      network: 'ETH',
      contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    });
    await server.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        wallet_id: walletId,
        token_id: tokenId2,
        type: 'BUY',
        amount: '100',
        price_usd_at_time: '1',
        block_timestamp: '2024-01-02T00:00:00.000Z',
      }),
    });

    const res = await server.inject({
      method: 'GET',
      url: `/api/transactions?wallet_id=${walletId}&token_id=${tokenId}`,
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { token_id: string }[]; total: number };
    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.data[0]?.token_id).toBe(tokenId);
  });

  it('SC-ROUTE-GET-03: paginación limit=2&offset=2 → { data: [2], total: 5 }', async () => {
    // Create 5 transactions
    for (let i = 1; i <= 5; i++) {
      await server.inject({
        method: 'POST',
        url: '/api/transactions',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          wallet_id: walletId,
          token_id: tokenId,
          type: 'BUY',
          amount: String(i),
          price_usd_at_time: '3000',
          block_timestamp: `2024-01-0${i}T00:00:00.000Z`,
        }),
      });
    }

    const res = await server.inject({
      method: 'GET',
      url: `/api/transactions?wallet_id=${walletId}&limit=2&offset=2`,
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; total: number; limit: number; offset: number };
    expect(body.data).toHaveLength(2);
    expect(body.total).toBe(5);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(2);
  });

  it('SC-ROUTE-GET-04: wallet sin transacciones → 200 { data: [], total: 0 }', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/transactions?wallet_id=${walletId}`,
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; total: number };
    expect(body.data).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('NEGATIVE-ROUTE-07: limit > 100 → 400 con Zod issues', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/transactions?wallet_id=${walletId}&limit=200`,
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { issues: unknown[] };
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('NEGATIVE-ROUTE-08: GET sin wallet_id → 400 con Zod issues', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/transactions',
      headers: { Cookie: cookie },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { issues: unknown[] };
    expect(Array.isArray(body.issues)).toBe(true);
  });
});
