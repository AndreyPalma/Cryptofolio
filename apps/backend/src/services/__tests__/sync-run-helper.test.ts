import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import dotenv from 'dotenv';
import pg from 'pg';
import type { PositionState } from '../../position-engine/index.js';
import { SyncRunHelper, cleanupStaleRuns } from '../sync-run-helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../../../.env') });

const { Pool } = pg;
const testUrl = process.env.DATABASE_URL_TEST;
const hasDb = Boolean(testUrl);
const pool = hasDb ? new Pool({ connectionString: testUrl, max: 2 }) : null;

const PLACEHOLDER_HASH = '$2b$12$placeholderplaceholderplaceholderplaceholderplaceholder';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface SyncRunRow {
  id: string;
  wallet_id: string;
  type: 'CEX' | 'ON_CHAIN';
  status: 'running' | 'completed';
  completed_at: Date | null;
  txs_persisted: number;
}

interface CursorRow {
  operation: string;
  last_value: string | null;
}

function makeAddress(seed = randomUUID()): string {
  return `0x${seed.replace(/-/g, '').padEnd(40, '0').slice(0, 40)}`;
}

function makePositionState(walletId: string, tokenId: string, overrides: Partial<PositionState> = {}): PositionState {
  return {
    id: randomUUID(),
    walletId,
    tokenId,
    cycleNumber: 1,
    status: 'OPEN',
    balance: '2.000000000000000000',
    wac: '150.000000000000000000',
    costBasis: '300.000000000000000000',
    realizedPnlUsd: '0.000000000000000000',
    openedAt: new Date('2025-01-01T00:00:00.000Z'),
    closedAt: null,
    ...overrides,
  };
}

async function resetDb(): Promise<void> {
  if (!pool) return;
  await pool.query(`
    TRUNCATE TABLE
      sync_runs,
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

async function createUser(): Promise<string> {
  const result = await pool!.query<{ id: string }>(
    `INSERT INTO users (password_hash) VALUES ($1) RETURNING id`,
    [PLACEHOLDER_HASH],
  );
  return result.rows[0]!.id;
}

async function createOnChainWallet(userId: string, network: 'ETH' | 'BSC' = 'ETH'): Promise<string> {
  const result = await pool!.query<{ id: string }>(
    `INSERT INTO wallets (user_id, wallet_type, address, network, label)
     VALUES ($1, 'ON_CHAIN', $2, $3, $4)
     RETURNING id`,
    [userId, makeAddress(), network, `${network} wallet`],
  );
  return result.rows[0]!.id;
}

async function createCexWallet(userId: string): Promise<string> {
  const result = await pool!.query<{ id: string }>(
    `INSERT INTO wallets (user_id, wallet_type, address, network, label)
     VALUES ($1, 'CEX', NULL, 'CEX_BINANCE', 'Binance')
     RETURNING id`,
    [userId],
  );
  return result.rows[0]!.id;
}

async function createToken(symbol: string, network: 'ETH' | 'BSC' | 'CEX_BINANCE' = 'ETH'): Promise<string> {
  const contractAddress = network === 'CEX_BINANCE' ? null : makeAddress();
  const binanceSymbol = network === 'CEX_BINANCE' ? `${symbol.toUpperCase()}USDT` : null;
  const result = await pool!.query<{ id: string }>(
    `INSERT INTO tokens (symbol, network, contract_address, binance_symbol, decimals)
     VALUES ($1, $2, $3, $4, 18)
     RETURNING id`,
    [symbol, network, contractAddress, binanceSymbol],
  );
  return result.rows[0]!.id;
}

async function insertPosition(position: PositionState): Promise<void> {
  await pool!.query(
    `INSERT INTO positions (
      id, wallet_id, token_id, cycle_number, status,
      balance, wac, cost_basis, realized_pnl_usd, opened_at, closed_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      position.id,
      position.walletId,
      position.tokenId,
      position.cycleNumber,
      position.status,
      position.balance,
      position.wac,
      position.costBasis,
      position.realizedPnlUsd,
      position.openedAt,
      position.closedAt,
    ],
  );
}

async function insertCursor(walletId: string, operation: string, value: string): Promise<void> {
  await pool!.query(
    `INSERT INTO wallet_sync_cursors (wallet_id, operation, last_value, last_synced_at)
     VALUES ($1, $2, $3, now())`,
    [walletId, operation, value],
  );
}

async function insertTransaction(walletId: string, tokenId: string, syncRunId: string | null): Promise<string> {
  const result = await pool!.query<{ id: string }>(
    `INSERT INTO transactions (
      wallet_id,
      token_id,
      position_id,
      type,
      source,
      tx_hash,
      tx_log_index,
      block_timestamp,
      amount,
      price_usd,
      cost_source,
      sync_run_id
    ) VALUES ($1, $2, NULL, 'BUY', 'MANUAL', NULL, NULL, $3, '1.000000000000000000', '100.000000000000000000', 'MARKET', $4)
     RETURNING id`,
    [walletId, tokenId, new Date('2025-01-01T00:00:00.000Z'), syncRunId],
  );
  return result.rows[0]!.id;
}

afterAll(async () => {
  if (pool) {
    await pool.end();
  }
});

describe.skipIf(!hasDb)('SyncRunHelper (integration)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('start() creates a running sync_runs row and returns a UUID runId', async () => {
    const userId = await createUser();
    const walletId = await createCexWallet(userId);
    const helper = new SyncRunHelper(pool!);

    const { runId } = await helper.start(walletId, 'CEX');

    expect(runId).toMatch(UUID_RE);

    const rowResult = await pool!.query<SyncRunRow>(
      `SELECT id, wallet_id, type, status, completed_at, txs_persisted
       FROM sync_runs
       WHERE id = $1`,
      [runId],
    );

    expect(rowResult.rows[0]).toMatchObject({
      id: runId,
      wallet_id: walletId,
      type: 'CEX',
      status: 'running',
      txs_persisted: 0,
    });
    expect(rowResult.rows[0]?.completed_at).toBeNull();
  });

  it('recordTxsPersisted() accumulates and commitSuccess() persists txs_persisted', async () => {
    const userId = await createUser();
    const walletId = await createOnChainWallet(userId);
    const helper = new SyncRunHelper(pool!);
    const { runId } = await helper.start(walletId, 'ON_CHAIN');

    helper.recordTxsPersisted(runId, 2);
    helper.recordTxsPersisted(runId, 3);

    await helper.commitSuccess(runId, {
      positions: new Map(),
      cursorUpdates: [],
    });

    const rowResult = await pool!.query<SyncRunRow>(
      `SELECT id, wallet_id, type, status, completed_at, txs_persisted
       FROM sync_runs
       WHERE id = $1`,
      [runId],
    );

    expect(rowResult.rows[0]).toMatchObject({
      id: runId,
      wallet_id: walletId,
      type: 'ON_CHAIN',
      status: 'completed',
      txs_persisted: 5,
    });
    expect(rowResult.rows[0]?.completed_at).not.toBeNull();
  });

  it('commitSuccess() upserts positions + cursors and completes the run atomically', async () => {
    const userId = await createUser();
    const walletId = await createOnChainWallet(userId);
    const tokenId = await createToken('ETH', 'ETH');
    const helper = new SyncRunHelper(pool!);
    const { runId } = await helper.start(walletId, 'ON_CHAIN');

    const existingPosition = makePositionState(walletId, tokenId, {
      balance: '1.000000000000000000',
      wac: '100.000000000000000000',
      costBasis: '100.000000000000000000',
    });
    await insertPosition(existingPosition);
    await insertCursor(walletId, 'block', '100');

    const updatedPosition = makePositionState(walletId, tokenId, {
      id: existingPosition.id,
      balance: '3.000000000000000000',
      wac: '110.000000000000000000',
      costBasis: '330.000000000000000000',
      realizedPnlUsd: '25.000000000000000000',
    });

    helper.recordTxsPersisted(runId, 4);
    await helper.commitSuccess(runId, {
      positions: new Map([[tokenId, updatedPosition]]),
      cursorUpdates: [
        { operation: 'block', value: '200' },
        { operation: 'trades:ETHUSDT', value: '2025-01-01T00:00:00.000Z' },
      ],
    });

    const runResult = await pool!.query<SyncRunRow>(
      `SELECT id, wallet_id, type, status, completed_at, txs_persisted
       FROM sync_runs
       WHERE id = $1`,
      [runId],
    );
    expect(runResult.rows[0]?.status).toBe('completed');
    expect(runResult.rows[0]?.txs_persisted).toBe(4);
    expect(runResult.rows[0]?.completed_at).not.toBeNull();

    const positionResult = await pool!.query<{
      id: string;
      balance: string;
      wac: string;
      cost_basis: string;
      realized_pnl_usd: string;
    }>(
      `SELECT id, balance::text, wac::text, cost_basis::text, realized_pnl_usd::text
       FROM positions
       WHERE wallet_id = $1 AND token_id = $2 AND cycle_number = 1`,
      [walletId, tokenId],
    );

    expect(positionResult.rows[0]).toEqual({
      id: existingPosition.id,
      balance: '3.000000000000000000',
      wac: '110.000000000000000000',
      cost_basis: '330.000000000000000000',
      realized_pnl_usd: '25.000000000000000000',
    });

    const cursorResult = await pool!.query<CursorRow>(
      `SELECT operation, last_value
       FROM wallet_sync_cursors
       WHERE wallet_id = $1
       ORDER BY operation ASC`,
      [walletId],
    );

    expect(cursorResult.rows).toEqual([
      { operation: 'block', last_value: '200' },
      { operation: 'trades:ETHUSDT', last_value: '2025-01-01T00:00:00.000Z' },
    ]);
  });

  it('rollback() deletes the sync run and child transactions via CASCADE', async () => {
    const userId = await createUser();
    const walletId = await createOnChainWallet(userId);
    const tokenId = await createToken('ETH', 'ETH');
    const helper = new SyncRunHelper(pool!);
    const { runId } = await helper.start(walletId, 'ON_CHAIN');

    await insertTransaction(walletId, tokenId, runId);
    await helper.rollback(runId);

    const runCount = await pool!.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM sync_runs WHERE id = $1`,
      [runId],
    );
    const txCount = await pool!.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM transactions WHERE sync_run_id = $1`,
      [runId],
    );

    expect(runCount.rows[0]?.count).toBe(0);
    expect(txCount.rows[0]?.count).toBe(0);
  });

  it('cleanupStaleRuns() deletes only running rows and returns the deleted count', async () => {
    const userId = await createUser();
    const walletId = await createOnChainWallet(userId);
    const tokenId = await createToken('ETH', 'ETH');
    const helper = new SyncRunHelper(pool!);
    const runningOne = await helper.start(walletId, 'ON_CHAIN');
    const runningTwo = await helper.start(walletId, 'ON_CHAIN');

    const completedResult = await pool!.query<{ id: string }>(
      `INSERT INTO sync_runs (wallet_id, type, status, completed_at, txs_persisted)
       VALUES ($1, 'ON_CHAIN', 'completed', now(), 9)
       RETURNING id`,
      [walletId],
    );
    const completedRunId = completedResult.rows[0]!.id;

    await insertTransaction(walletId, tokenId, runningOne.runId);
    await insertTransaction(walletId, tokenId, runningTwo.runId);
    await insertTransaction(walletId, tokenId, completedRunId);

    const result = await cleanupStaleRuns(pool!);

    expect(result).toEqual({ deleted: 2 });

    const remainingRuns = await pool!.query<SyncRunRow>(
      `SELECT id, wallet_id, type, status, completed_at, txs_persisted
       FROM sync_runs
       ORDER BY status ASC, id ASC`,
    );
    expect(remainingRuns.rows).toHaveLength(1);
    expect(remainingRuns.rows[0]?.id).toBe(completedRunId);
    expect(remainingRuns.rows[0]?.status).toBe('completed');

    const txCount = await pool!.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM transactions WHERE sync_run_id = $1`,
      [completedRunId],
    );
    expect(txCount.rows[0]?.count).toBe(1);
  });

  it('NEGATIVE: commitSuccess() failure rolls back staged DB work and deletes the run + child txs', async () => {
    const userId = await createUser();
    const walletId = await createOnChainWallet(userId);
    const tokenId = await createToken('ETH', 'ETH');
    const helper = new SyncRunHelper(pool!);
    const { runId } = await helper.start(walletId, 'ON_CHAIN');
    await insertTransaction(walletId, tokenId, runId);

    const nextPosition = makePositionState(walletId, tokenId);

    helper.recordTxsPersisted(runId, 1);
    await expect(
      helper.commitSuccess(runId, {
        positions: new Map([[tokenId, nextPosition]]),
        cursorUpdates: [{ operation: 'block', value: 'x'.repeat(256) }],
      }),
    ).rejects.toThrow();

    const runCount = await pool!.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM sync_runs WHERE id = $1`,
      [runId],
    );
    const txCount = await pool!.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM transactions WHERE sync_run_id = $1`,
      [runId],
    );
    const positionCount = await pool!.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM positions WHERE wallet_id = $1 AND token_id = $2`,
      [walletId, tokenId],
    );
    const cursorCount = await pool!.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM wallet_sync_cursors WHERE wallet_id = $1`,
      [walletId],
    );

    expect(runCount.rows[0]?.count).toBe(0);
    expect(txCount.rows[0]?.count).toBe(0);
    expect(positionCount.rows[0]?.count).toBe(0);
    expect(cursorCount.rows[0]?.count).toBe(0);
  });

  it('NEGATIVE: inserting a transaction with a non-existent sync_run_id violates the FK', async () => {
    const userId = await createUser();
    const walletId = await createOnChainWallet(userId);
    const tokenId = await createToken('ETH', 'ETH');

    await expect(insertTransaction(walletId, tokenId, randomUUID())).rejects.toThrow();
  });

  it('NEGATIVE: legacy transactions with sync_run_id=NULL are immune to rollback() and cleanupStaleRuns()', async () => {
    const userId = await createUser();
    const walletId = await createOnChainWallet(userId);
    const tokenId = await createToken('ETH', 'ETH');
    const helper = new SyncRunHelper(pool!);

    const legacyTxId = await insertTransaction(walletId, tokenId, null);

    const rollbackRun = await helper.start(walletId, 'ON_CHAIN');
    const rollbackTxId = await insertTransaction(walletId, tokenId, rollbackRun.runId);
    await helper.rollback(rollbackRun.runId);

    const cleanupRun = await helper.start(walletId, 'ON_CHAIN');
    const cleanupTxId = await insertTransaction(walletId, tokenId, cleanupRun.runId);
    const cleanupResult = await cleanupStaleRuns(pool!);

    expect(cleanupResult).toEqual({ deleted: 1 });

    const legacyCount = await pool!.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM transactions WHERE id = $1 AND sync_run_id IS NULL`,
      [legacyTxId],
    );
    const rollbackCount = await pool!.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM transactions WHERE id = $1`,
      [rollbackTxId],
    );
    const cleanupCount = await pool!.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM transactions WHERE id = $1`,
      [cleanupTxId],
    );

    expect(legacyCount.rows[0]?.count).toBe(1);
    expect(rollbackCount.rows[0]?.count).toBe(0);
    expect(cleanupCount.rows[0]?.count).toBe(0);
  });
});
