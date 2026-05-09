// binance-sync.test.ts — US-012 A1
// TDD tests for BinanceSyncService.sync() last_synced_at fix.
// No real DB. No real HTTP.

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import type { BinanceApiClient } from '../sync/clients/binance-api.js';
import type { PriceService } from './price.js';
import type { FastifyBaseLogger } from 'fastify';
import { BinanceSyncService } from './binance-sync.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockLog = {
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn().mockReturnThis(),
  level: 'warn',
  silent: vi.fn(),
} as unknown as FastifyBaseLogger;

function makeMinimalBinanceClient(): BinanceApiClient {
  return {
    assertConfigured: vi.fn(),
    getAccountAssets: vi.fn().mockResolvedValue([]),
    getMyTrades: vi.fn().mockResolvedValue([]),
    getConvertHistory: vi.fn().mockResolvedValue([]),
    getWithdrawHistory: vi.fn().mockResolvedValue([]),
    getDepositHistory: vi.fn().mockResolvedValue([]),
  };
}

function makeMinimalPriceService(): PriceService {
  return {
    getOnChainPrice: vi.fn().mockResolvedValue({ priceUsd: '1.0' }),
    getCexPrice: vi.fn().mockResolvedValue({ priceUsd: '1.0' }),
  } as unknown as PriceService;
}

/**
 * Builds a PoolClient mock that:
 *  - Returns a CEX wallet row on the first query (wallet lookup via pool.query)
 *  - Handles the cursor queries (getCursor / setCursor) for syncTrades etc.
 *  - Tracks all query calls so we can assert on them
 */
function makePoolAndClient(opts: {
  walletRow: { id: string; wallet_type: 'ON_CHAIN' | 'CEX'; address: string | null };
  updateShouldFail?: boolean;
}): { pool: Pool; pgc: PoolClient; allQueries: string[] } {
  const allQueries: string[] = [];

  // The pool.query() is used for the initial wallet SELECT
  const poolQueryFn = vi.fn().mockImplementation((sql: string) => {
    allQueries.push(sql);
    if (sql.includes('SELECT id, wallet_type, address FROM wallets')) {
      return Promise.resolve({ rows: [opts.walletRow], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });

  // pgc is the connected client used for sub-methods and the last_synced_at UPDATE
  const pgcQueryFn = vi.fn().mockImplementation((sql: string) => {
    allQueries.push(sql);

    // The best-effort last_synced_at UPDATE
    if (sql.includes('UPDATE wallets SET last_synced_at')) {
      if (opts.updateShouldFail) {
        return Promise.reject(new Error('DB connection lost'));
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    // BEGIN / COMMIT / ROLLBACK
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    // Cursor reads → no cursor stored
    if (sql.includes('SELECT last_value FROM wallet_sync_cursors')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    // Cursor writes
    if (sql.includes('INSERT INTO wallet_sync_cursors')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    return Promise.resolve({ rows: [], rowCount: 0 });
  });

  const pgc = {
    query: pgcQueryFn,
    release: vi.fn(),
  } as unknown as PoolClient;

  const pool = {
    query: poolQueryFn,
    connect: vi.fn().mockResolvedValue(pgc),
  } as unknown as Pool;

  return { pool, pgc, allQueries };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BinanceSyncService.sync() — last_synced_at fix (A1)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const CEX_WALLET = { id: 'wallet-uuid-1', wallet_type: 'CEX' as const, address: null };

  it('A1-01 — sync() exitoso ejecuta UPDATE wallets SET last_synced_at', async () => {
    const { pool, pgc } = makePoolAndClient({ walletRow: CEX_WALLET });
    const binanceClient = makeMinimalBinanceClient();
    const priceService = makeMinimalPriceService();

    const service = new BinanceSyncService({ pool, priceService, binanceClient });
    const result = await service.sync(CEX_WALLET.id, 'user-uuid');

    // sync() must return a BinanceSyncResult without throwing
    expect(result).toBeDefined();
    expect(result).toHaveProperty('trades');
    expect(result).toHaveProperty('converts');
    expect(result).toHaveProperty('withdrawals');
    expect(result).toHaveProperty('deposits');

    // The pgc.query must have been called with the last_synced_at UPDATE
    const pgcCalls: string[] = (pgc.query as ReturnType<typeof vi.fn>).mock.calls.map(
      (args: unknown[]) => args[0] as string,
    );
    const hasUpdateCall = pgcCalls.some((sql) => sql.includes('UPDATE wallets SET last_synced_at'));
    expect(hasUpdateCall).toBe(true);
  });

  it('A1-02 — si UPDATE last_synced_at falla, sync() NO lanza excepción (best-effort)', async () => {
    const { pool } = makePoolAndClient({ walletRow: CEX_WALLET, updateShouldFail: true });
    const binanceClient = makeMinimalBinanceClient();
    const priceService = makeMinimalPriceService();

    const service = new BinanceSyncService({ pool, priceService, binanceClient });

    // Must NOT throw even though the UPDATE fails
    await expect(service.sync(CEX_WALLET.id, 'user-uuid')).resolves.toBeDefined();
  });

  it('A1-03 — sync() retorna BinanceSyncResult completo incluso cuando UPDATE falla', async () => {
    const { pool } = makePoolAndClient({ walletRow: CEX_WALLET, updateShouldFail: true });
    const binanceClient = makeMinimalBinanceClient();
    const priceService = makeMinimalPriceService();

    const service = new BinanceSyncService({ pool, priceService, binanceClient });
    const result = await service.sync(CEX_WALLET.id, 'user-uuid');

    expect(result.trades).toEqual({ synced: 0, skipped: 0, symbolsProcessed: 0 });
    expect(result.converts).toEqual({ synced: 0, skipped: 0 });
    expect(result.withdrawals).toEqual({ synced: 0, skipped: 0 });
    expect(result.deposits).toEqual({ synced: 0, skipped: 0, inherited: 0, manual: 0 });
    expect(result.tokensCreated).toBe(0);
  });
});
