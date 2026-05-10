// sync-binance.test.ts — US-008-B [sync project — needs real DB]
// Integration tests for BinanceSyncService. Uses real PostgreSQL.

import { describe, it, expect, beforeEach, afterAll, vi, afterEach } from 'vitest';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BinanceSyncService } from '../src/services/binance-sync.js';
import type { BinanceSyncDeps } from '../src/services/binance-sync.js';
import type { BinanceApiClient } from '../src/sync/clients/binance-api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { Pool } = pg;

const testUrl = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
const hasDb = Boolean(testUrl);

const pool = hasDb ? new Pool({ connectionString: testUrl, max: 2 }) : null;

afterAll(async () => {
  if (pool) await pool.end();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── DB helpers ────────────────────────────────────────────────────────────────

async function resetDb(): Promise<void> {
  if (!pool) return;
  await pool.query(`
    TRUNCATE TABLE
      api_credentials,
      wallet_sync_cursors,
      transactions,
      positions,
      tokens,
      wallets,
      users
    RESTART IDENTITY CASCADE
  `);
}

const PLACEHOLDER_HASH = '$2b$12$placeholderplaceholderplaceholderplaceholderplaceholder';

async function createUser(): Promise<string> {
  const r = await pool!.query<{ id: string }>(
    `INSERT INTO users (password_hash) VALUES ($1) RETURNING id`,
    [PLACEHOLDER_HASH],
  );
  return r.rows[0]!.id;
}

async function createCexWallet(userId: string): Promise<string> {
  const r = await pool!.query<{ id: string }>(
    `INSERT INTO wallets (user_id, wallet_type, address, network, label)
     VALUES ($1, 'CEX', NULL, 'CEX_BINANCE', 'Binance') RETURNING id`,
    [userId],
  );
  return r.rows[0]!.id;
}

async function createOnChainWallet(userId: string, address: string): Promise<string> {
  const r = await pool!.query<{ id: string }>(
    `INSERT INTO wallets (user_id, wallet_type, address, network, label)
     VALUES ($1, 'ON_CHAIN', $2, 'ETH', 'test wallet') RETURNING id`,
    [userId, address],
  );
  return r.rows[0]!.id;
}

async function createOnChainToken(symbol: string): Promise<string> {
  const r = await pool!.query<{ id: string }>(
    `INSERT INTO tokens (symbol, network, contract_address, decimals)
     VALUES ($1, 'ETH', $2, 18) RETURNING id`,
    [symbol, `0x${Math.random().toString(16).slice(2).padStart(40, '0')}`],
  );
  return r.rows[0]!.id;
}

async function createOpenPosition(walletId: string, tokenId: string, wac: string): Promise<string> {
  const r = await pool!.query<{ id: string }>(
    `INSERT INTO positions (wallet_id, token_id, cycle_number, status, wac, balance, cost_basis, realized_pnl_usd, opened_at)
     VALUES ($1, $2, 1, 'OPEN', $3, '10.0', '20000.0', '0.0', now()) RETURNING id`,
    [walletId, tokenId, wac],
  );
  return r.rows[0]!.id;
}

async function createTransferOutTx(
  walletId: string,
  tokenId: string,
  positionId: string,
  txHash: string,
): Promise<void> {
  await pool!.query(
    `INSERT INTO transactions (wallet_id, token_id, position_id, type, source, tx_hash, tx_log_index, block_timestamp, amount, price_usd, cost_source)
     VALUES ($1, $2, $3, 'TRANSFER_OUT', 'ETHERSCAN', $4, 0, now(), '1.0', '2800.00', 'MARKET')`,
    [walletId, tokenId, positionId, txHash],
  );
}

// ─── Mock factories ────────────────────────────────────────────────────────────

import type { FastifyBaseLogger } from 'fastify';

const mockLog = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(),
  child: vi.fn().mockReturnThis(), level: 'info', silent: vi.fn(),
} as unknown as FastifyBaseLogger;

function makeMockBinanceClient(overrides: Partial<BinanceApiClient> = {}): BinanceApiClient {
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
    ...overrides,
  };
}

function makeMockPriceService(cexPrice = 3000) {
  return {
    getCexPrice: vi.fn().mockResolvedValue({ priceUsd: String(cexPrice) }),
    getOnChainPrice: vi.fn(),
    getOnChainPricesBulk: vi.fn().mockResolvedValue(new Map()),
    getFiatToUsdAt: vi.fn().mockResolvedValue('1'),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe.skipIf(!hasDb)('BinanceSyncService (integration)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  // ─── T19: ensureTokenCex idempotency ────────────────────────────────────────

  it('T19 — ensureTokenCex creates token on first call, returns same id on second call', async () => {
    const userId = await createUser();
    const walletId = await createCexWallet(userId);

    const binanceClient = makeMockBinanceClient({
      getAccountAssets: vi.fn().mockResolvedValue([{ asset: 'ETH', free: '1.0', locked: '0.0' }]),
      getMyTrades: vi.fn().mockResolvedValue([]),
    });

    const svc = new BinanceSyncService({
      pool: pool!, log: mockLog,
      priceService: makeMockPriceService() as unknown as BinanceSyncDeps['priceService'],
      binanceClient,
    });

    // Run sync twice — second call must not duplicate the token
    await svc.sync(walletId, userId);
    await svc.sync(walletId, userId);

    // Verify only ONE token for CEX_BINANCE ETH was created
    const tokenCount = await pool!.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM tokens WHERE network='CEX_BINANCE' AND lower(contract_address)='eth'`,
    );
    expect(parseInt(tokenCount.rows[0]!.count, 10)).toBe(1);
  });

  // ─── T16: syncConvert idempotency ───────────────────────────────────────────

  it('T16 — syncConvert idempotency: double run produces exactly 2 rows', async () => {
    const userId = await createUser();
    const walletId = await createCexWallet(userId);

    const binanceClient = makeMockBinanceClient({
      getConvertHistory: vi.fn().mockResolvedValue([
        {
          orderId: '999',
          fromAsset: 'USDT',
          toAsset: 'ETH',
          fromAmount: '3000',
          toAmount: '1',
          status: 'SUCCESS',
          createTime: Date.now() - 1000,
        },
      ]),
    });

    const svc = new BinanceSyncService({
      pool: pool!, log: mockLog,
      priceService: makeMockPriceService() as unknown as BinanceSyncDeps['priceService'],
      binanceClient,
    });

    // First run
    await svc.sync(walletId, userId);

    // Second run — same data
    await svc.sync(walletId, userId);

    // Must have exactly 2 rows (not 4) for cex_trade_id=999
    const txCount = await pool!.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM transactions WHERE cex_trade_id=999`,
    );
    expect(parseInt(txCount.rows[0]!.count, 10)).toBe(2);

    // Verify tx_log_index values
    const rows = await pool!.query<{ tx_log_index: number; type: string }>(
      `SELECT tx_log_index, type FROM transactions WHERE cex_trade_id=999 ORDER BY tx_log_index ASC`,
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]).toMatchObject({ tx_log_index: 0, type: 'SWAP_OUT' });
    expect(rows.rows[1]).toMatchObject({ tx_log_index: 1, type: 'SWAP_IN' });

    // Verify cross-linking
    const swapOutRow = await pool!.query<{ id: string; related_tx_id: string }>(
      `SELECT id, related_tx_id FROM transactions WHERE cex_trade_id=999 AND tx_log_index=0`,
    );
    const swapInRow = await pool!.query<{ id: string; related_tx_id: string }>(
      `SELECT id, related_tx_id FROM transactions WHERE cex_trade_id=999 AND tx_log_index=1`,
    );

    expect(swapOutRow.rows[0]!.related_tx_id).toBe(swapInRow.rows[0]!.id);
    expect(swapInRow.rows[0]!.related_tx_id).toBe(swapOutRow.rows[0]!.id);
  });

  // ─── T17: syncWithdrawals tx_hash bridge ────────────────────────────────────

  it('T17 — syncWithdrawals stores tx_hash=txId as bridge column (never null)', async () => {
    const userId = await createUser();
    const walletId = await createCexWallet(userId);

    const binanceClient = makeMockBinanceClient({
      getWithdrawHistory: vi.fn().mockResolvedValue([
        {
          id: '123456',
          coin: 'ETH',
          amount: '1.0',
          address: '0xdestination000000000000000000000000000001',
          txId: '0xbridge123',
          applyTime: Date.now() - 1000,
          status: 6,
        },
      ]),
    });

    const svc = new BinanceSyncService({
      pool: pool!, log: mockLog,
      priceService: makeMockPriceService() as unknown as BinanceSyncDeps['priceService'],
      binanceClient,
    });

    await svc.sync(walletId, userId);

    const row = await pool!.query<{ tx_hash: string; type: string; source: string; tx_log_index: number }>(
      `SELECT tx_hash, type, source, tx_log_index FROM transactions WHERE cex_trade_id=123456`,
    );

    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]!.tx_hash).toBe('0xbridge123');
    expect(row.rows[0]!.type).toBe('TRANSFER_OUT');
    expect(row.rows[0]!.source).toBe('BINANCE');
    expect(row.rows[0]!.tx_log_index).toBe(0);
    // INV-3: tx_hash must not be null
    expect(row.rows[0]!.tx_hash).not.toBeNull();
  });

  // ─── T18: syncDeposits INHERITED ────────────────────────────────────────────

  it('T18 — syncDeposits INHERITED: on-chain TRANSFER_OUT match sets cost_source=INHERITED', async () => {
    const userId = await createUser();
    const onChainWalletAddress = '0xsender000000000000000000000000000000001';
    const onChainWalletId = await createOnChainWallet(userId, onChainWalletAddress);
    const cexWalletId = await createCexWallet(userId);

    // Create an ETH token on-chain
    const onChainTokenId = await createOnChainToken('ETH');
    const positionId = await createOpenPosition(onChainWalletId, onChainTokenId, '2800.00');

    // Create on-chain TRANSFER_OUT transaction with the matching tx hash
    const txHash = '0xdeposittxhash001';
    await createTransferOutTx(onChainWalletId, onChainTokenId, positionId, txHash);

    const binanceClient = makeMockBinanceClient({
      getDepositHistory: vi.fn().mockResolvedValue([
        {
          coin: 'ETH',
          amount: '1.0',
          address: onChainWalletAddress,
          txId: txHash,
          insertTime: Date.now() - 1000,
          status: 1,
        },
      ]),
    });

    const svc = new BinanceSyncService({
      pool: pool!, log: mockLog,
      priceService: makeMockPriceService(3000) as unknown as BinanceSyncDeps['priceService'],
      binanceClient,
    });

    await svc.sync(cexWalletId, userId);

    // Find the deposit transaction
    const depositRow = await pool!.query<{ cost_source: string; price_usd: string; type: string }>(
      `SELECT cost_source, price_usd, type FROM transactions
       WHERE wallet_id=$1 AND type='TRANSFER_IN' AND source='BINANCE' AND tx_hash=$2`,
      [cexWalletId, txHash],
    );

    expect(depositRow.rows).toHaveLength(1);
    expect(depositRow.rows[0]!.cost_source).toBe('INHERITED');
    // price_usd should be close to 2800 (the WAC from the on-chain position)
    expect(parseFloat(depositRow.rows[0]!.price_usd)).toBeCloseTo(2800, 0);
  });
});
