// balance-validator.test.ts — US-012 A7
// TDD tests for BalanceValidatorService and GET /api/portfolio/validate-snapshot
// No real DB or HTTP calls.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// ─── Mock pg at module level ───────────────────────────────────────────────────

const mockPoolQuery = vi.fn();

vi.mock('pg', () => ({
  default: {
    Pool: vi.fn().mockImplementation(() => ({
      query: mockPoolQuery,
      connect: vi.fn(),
      end: vi.fn(),
    })),
  },
}));

// ─── Now import ───────────────────────────────────────────────────────────────

import { BalanceValidatorService } from '../services/balance-validator.js';
import { buildServer } from '../index.js';
import type { BinanceApiClient } from '../sync/clients/binance-api.js';
import type { Pool } from 'pg';

// ─── Shared helpers ───────────────────────────────────────────────────────────

afterEach(() => {
  // NOTE: vi.restoreAllMocks() would reset the vi.mock('pg') Pool factory implementation
  // so we avoid it here and only clear/reset specific mocks.
  vi.clearAllMocks();       // clears call history
  mockPoolQuery.mockReset(); // clears queued return values too
  delete process.env.BINANCE_API_KEY;
  delete process.env.BINANCE_SECRET_KEY;
});

function makePool(): Pool {
  return { query: mockPoolQuery, connect: vi.fn(), end: vi.fn() } as unknown as Pool;
}

function makeBinanceClient(assets: { asset: string; free: string; locked: string }[]): BinanceApiClient {
  return {
    assertConfigured: vi.fn(),
    getAccountAssets: vi.fn().mockResolvedValue(assets),
    getMyTrades: vi.fn(),
    getConvertHistory: vi.fn(),
    getWithdrawHistory: vi.fn(),
    getDepositHistory: vi.fn(),
  } as unknown as BinanceApiClient;
}

// ─── Tests for BalanceValidatorService ───────────────────────────────────────

describe('BalanceValidatorService (A7)', () => {
  it('A7-01 — happy path: calculates differences correctly', async () => {
    const binanceClient = makeBinanceClient([
      { asset: 'ETH', free: '1.4999', locked: '0' },
      { asset: 'BTC', free: '0.0099', locked: '0' },
    ]);

    // Engine positions: ETH=1.5, BTC=0.01
    mockPoolQuery
      // First call: check wallet CEX_BINANCE exists
      .mockResolvedValueOnce({ rows: [{ id: 'wallet-uuid' }], rowCount: 1 })
      // Second call: engine balances
      .mockResolvedValueOnce({
        rows: [
          { asset: 'ETH', balance: '1.5' },
          { asset: 'BTC', balance: '0.01' },
        ],
        rowCount: 2,
      });

    // Each test gets a fresh service instance with no cache
    const service = new BalanceValidatorService(makePool(), binanceClient);
    const result = await service.validate('user-A7-01');

    expect(result.differences).toHaveLength(2);
    const ethDiff = result.differences.find((d) => d.asset === 'ETH');
    const btcDiff = result.differences.find((d) => d.asset === 'BTC');

    // ETH: engine=1.5, snapshot=1.4999, diff=0.0001
    expect(ethDiff).toBeDefined();
    expect(parseFloat(ethDiff!.diff)).toBeCloseTo(0.0001, 4);

    // BTC: engine=0.01, snapshot=0.0099, diff=0.0001
    expect(btcDiff).toBeDefined();
    expect(parseFloat(btcDiff!.diff)).toBeCloseTo(0.0001, 4);

    expect(result.dustNote).toContain('dust');
  });

  it('A7-02 — filters out noise: diff = 0.000000001 (< threshold 0.00000001) does NOT appear', async () => {
    const binanceClient = makeBinanceClient([
      { asset: 'ETH', free: '1.000000001', locked: '0' },
    ]);

    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: 'wallet-uuid' }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ asset: 'ETH', balance: '1.000000002' }], // diff = 0.000000001 < threshold
        rowCount: 1,
      });

    const service = new BalanceValidatorService(makePool(), binanceClient);
    const result = await service.validate('user-A7-02');

    expect(result.differences).toHaveLength(0);
  });

  it('A7-03 — NEGATIVE: no CEX_BINANCE wallet → throws NotFoundError', async () => {
    const binanceClient = makeBinanceClient([]);

    // No wallet found
    mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const service = new BalanceValidatorService(makePool(), binanceClient);

    await expect(service.validate('user-A7-03')).rejects.toMatchObject({
      name: 'NotFoundError',
    });
  });

  it('A7-04 — cache: second validate() call within 60s does NOT call getAccountAssets again', async () => {
    const binanceClient = makeBinanceClient([
      { asset: 'ETH', free: '1.0', locked: '0' },
    ]);

    // Two validate() calls — each needs wallet + engine balances
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: 'wallet-uuid' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ asset: 'ETH', balance: '1.0' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'wallet-uuid' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ asset: 'ETH', balance: '1.0' }], rowCount: 1 });

    // Use a unique userId so there's no cache from other tests
    const service = new BalanceValidatorService(makePool(), binanceClient);

    await service.validate('user-A7-04-cache');
    await service.validate('user-A7-04-cache'); // second call — should hit cache

    // getAccountAssets should only be called once
    expect(binanceClient.getAccountAssets).toHaveBeenCalledTimes(1);
  });
});

// ─── Tests for GET /api/portfolio/validate-snapshot ──────────────────────────

describe('GET /api/portfolio/validate-snapshot (A7 route)', () => {
  it('A7-05 — NEGATIVE: no BINANCE_API_KEY → 400', async () => {
    delete process.env.BINANCE_API_KEY;
    delete process.env.BINANCE_SECRET_KEY;

    const server = await buildServer({ enableAuth: false });
    const response = await server.inject({
      method: 'GET',
      url: '/api/portfolio/validate-snapshot',
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as Record<string, string>;
    expect(JSON.stringify(body)).toMatch(/binance|key|configur/i);
  });

  it('A7-06 — NEGATIVE: no CEX_BINANCE wallet → 400', async () => {
    process.env.BINANCE_API_KEY = 'valid-key';
    process.env.BINANCE_SECRET_KEY = 'valid-secret';

    // Always return empty rows — no wallet
    mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const server = await buildServer({ enableAuth: false });
    const response = await server.inject({
      method: 'GET',
      url: '/api/portfolio/validate-snapshot',
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(JSON.stringify(body)).toMatch(/binance|wallet|configur/i);
  });

  it('A7-07 — NEGATIVE: requires auth → 401 without JWT cookie', async () => {
    const server = await buildServer({ enableAuth: true, jwtSecret: 'test-secret-abc123' });
    const response = await server.inject({
      method: 'GET',
      url: '/api/portfolio/validate-snapshot',
    });

    expect(response.statusCode).toBe(401);
  });
});
