// binance-sync.test.ts — US-012 A1 / US-014
// TDD tests for BinanceSyncService.sync() — adapted for SyncRunHelper flow.
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
    getValidTradingSymbols: vi.fn().mockResolvedValue(new Set<string>()),
    getMyTrades: vi.fn().mockResolvedValue([]),
    getConvertHistory: vi.fn().mockResolvedValue([]),
    getWithdrawHistory: vi.fn().mockResolvedValue([]),
    getDepositHistory: vi.fn().mockResolvedValue([]),
    getFiatOrders: vi.fn().mockResolvedValue([]),
    getFiatPayments: vi.fn().mockResolvedValue([]),
  };
}

function makeMinimalPriceService(): PriceService {
  return {
    getOnChainPrice: vi.fn().mockResolvedValue({ priceUsd: '1.0' }),
    getCexPrice: vi.fn().mockResolvedValue({ priceUsd: '1.0' }),
    getOnChainPricesBulk: vi.fn().mockResolvedValue(new Map()),
    getFiatToUsdAt: vi.fn().mockResolvedValue('1'),
  } as unknown as PriceService;
}

const RUN_ID = 'run-uuid-001';

/**
 * Builds a Pool mock compatible with the US-014 flow:
 *  - pool.query() handles wallet SELECT, SyncRunHelper INSERT, cursor reads,
 *    positions SELECT (loadInitial), last_synced_at UPDATE, discoverAssets, etc.
 *  - pool.connect() returns a PoolClient for SyncRunHelper.commitSuccess()
 */
function makePool(opts: {
  walletRow: { id: string; wallet_type: 'ON_CHAIN' | 'CEX'; address: string | null };
  updateShouldFail?: boolean;
}): { pool: Pool; allQueries: string[] } {
  const allQueries: string[] = [];

  const poolQueryFn = vi.fn().mockImplementation((sql: string) => {
    allQueries.push(sql);

    // Wallet lookup
    if (sql.includes('SELECT id, wallet_type')) {
      return Promise.resolve({ rows: [opts.walletRow], rowCount: 1 });
    }

    // SyncRunHelper.start() — INSERT sync_runs
    if (sql.includes('INSERT INTO sync_runs')) {
      return Promise.resolve({ rows: [{ id: RUN_ID }], rowCount: 1 });
    }

    // loadInitial — SELECT positions
    if (sql.includes('FROM positions') && sql.includes('WHERE wallet_id')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    // Cursor reads
    if (sql.includes('SELECT last_value FROM wallet_sync_cursors')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    // discoverAssets — SELECT DISTINCT tokens
    if (sql.includes('SELECT DISTINCT') && sql.includes('tokens')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    // last_synced_at UPDATE
    if (sql.includes('UPDATE wallets SET last_synced_at')) {
      if (opts.updateShouldFail) {
        return Promise.reject(new Error('DB connection lost'));
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    // DELETE sync_runs (rollback)
    if (sql.includes('DELETE FROM sync_runs')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    return Promise.resolve({ rows: [], rowCount: 0 });
  });

  // commitSuccess uses pool.connect() for its transaction
  const commitClientQueryFn = vi.fn().mockImplementation((sql: string) => {
    allQueries.push(sql);

    // SELECT sync_runs for commitSuccess
    if (sql.includes('SELECT wallet_id FROM sync_runs')) {
      return Promise.resolve({ rows: [{ wallet_id: opts.walletRow.id }], rowCount: 1 });
    }

    // BEGIN / COMMIT / ROLLBACK
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql.trim())) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    // UPDATE sync_runs SET status='completed'
    if (sql.includes('UPDATE sync_runs')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    return Promise.resolve({ rows: [], rowCount: 0 });
  });

  const commitClient = {
    query: commitClientQueryFn,
    release: vi.fn(),
  } as unknown as PoolClient;

  const pool = {
    query: poolQueryFn,
    connect: vi.fn().mockResolvedValue(commitClient),
  } as unknown as Pool;

  return { pool, allQueries };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BinanceSyncService.sync() — last_synced_at fix (A1)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const CEX_WALLET = { id: 'wallet-uuid-1', wallet_type: 'CEX' as const, address: null };

  it('A1-01 — sync() exitoso ejecuta UPDATE wallets SET last_synced_at', async () => {
    const { pool, allQueries } = makePool({ walletRow: CEX_WALLET });
    const binanceClient = makeMinimalBinanceClient();
    const priceService = makeMinimalPriceService();

    const service = new BinanceSyncService({ pool, priceService, binanceClient, log: mockLog });
    const result = await service.sync(CEX_WALLET.id, 'user-uuid');

    expect(result).toBeDefined();
    expect(result).toHaveProperty('trades');
    expect(result).toHaveProperty('converts');
    expect(result).toHaveProperty('withdrawals');
    expect(result).toHaveProperty('deposits');
    expect(result).toHaveProperty('fiat');

    const hasUpdateCall = allQueries.some((sql) => sql.includes('UPDATE wallets SET last_synced_at'));
    expect(hasUpdateCall).toBe(true);
  });

  it('A1-02 — si UPDATE last_synced_at falla, sync() NO lanza excepción (best-effort)', async () => {
    const { pool } = makePool({ walletRow: CEX_WALLET, updateShouldFail: true });
    const binanceClient = makeMinimalBinanceClient();
    const priceService = makeMinimalPriceService();

    const service = new BinanceSyncService({ pool, priceService, binanceClient, log: mockLog });

    await expect(service.sync(CEX_WALLET.id, 'user-uuid')).resolves.toBeDefined();
  });

  it('A1-03 — sync() retorna BinanceSyncResult completo incluso cuando UPDATE falla', async () => {
    const { pool } = makePool({ walletRow: CEX_WALLET, updateShouldFail: true });
    const binanceClient = makeMinimalBinanceClient();
    const priceService = makeMinimalPriceService();

    const service = new BinanceSyncService({ pool, priceService, binanceClient, log: mockLog });
    const result = await service.sync(CEX_WALLET.id, 'user-uuid');

    expect(result.trades).toEqual({ synced: 0, skipped: 0, symbolsProcessed: 0 });
    expect(result.converts).toEqual({ synced: 0, skipped: 0 });
    expect(result.withdrawals).toEqual({ synced: 0, skipped: 0 });
    expect(result.deposits).toEqual({ synced: 0, skipped: 0, inherited: 0, manual: 0 });
    expect(result.fiat).toBe(0);
    expect(result.tokensCreated).toBe(0);
  });
});
