// T22-T25 — resolveTransferCost tests (sync project, needs DB)
// Written BEFORE implementation (TDD Red phase).

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTransferCost } from '../src/sync/cost-resolver.js';

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

async function createOnChainWallet(userId: string, address: string): Promise<string> {
  const r = await pool!.query<{ id: string }>(
    `INSERT INTO wallets (user_id, wallet_type, address, network, label)
     VALUES ($1, 'ON_CHAIN', $2, 'ETH', 'test wallet') RETURNING id`,
    [userId, address],
  );
  return r.rows[0]!.id;
}

async function createToken(symbol: string): Promise<string> {
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

async function createClosedPosition(walletId: string, tokenId: string): Promise<string> {
  const r = await pool!.query<{ id: string }>(
    `INSERT INTO positions (wallet_id, token_id, cycle_number, status, wac, balance, cost_basis, realized_pnl_usd, opened_at, closed_at)
     VALUES ($1, $2, 1, 'CLOSED', '1000.0', '0.0', '10000.0', '500.0', now() - interval '1 day', now()) RETURNING id`,
    [walletId, tokenId],
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

async function createBinanceTransferOut(
  walletId: string,
  tokenId: string,
  positionId: string,
  txHash: string,
): Promise<string> {
  const r = await pool!.query<{ id: string }>(
    `INSERT INTO transactions (wallet_id, token_id, position_id, type, source, tx_hash, block_timestamp, amount, price_usd, cost_source)
     VALUES ($1, $2, $3, 'TRANSFER_OUT', 'BINANCE', $4, now(), '5.0', '1500.00', 'MARKET') RETURNING id`,
    [walletId, tokenId, positionId, txHash],
  );
  return r.rows[0]!.id;
}

describe.skipIf(!hasDb)('resolveTransferCost', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('T22 — step 1: on-chain wallet with OPEN position → INHERITED (originPositionId)', async () => {
    const userId = await createUser();
    const fromAddress = '0xsenderwallet000000000000000000000000000a';
    const walletId = await createOnChainWallet(userId, fromAddress);
    const tokenId = await createToken('ETH');
    const positionId = await createOpenPosition(walletId, tokenId, '2000.00');

    const pgc = await pool!.connect();
    try {
      const result = await resolveTransferCost(pgc, '0xtxhash', fromAddress, tokenId);

      expect(result.costSource).toBe('INHERITED');
      expect(result.priceUsd).toBe('2000.00');
      expect('originPositionId' in result && result.originPositionId).toBe(positionId);
    } finally {
      pgc.release();
    }
  });

  it('T23 — step 2: Binance TRANSFER_OUT with same tx_hash → INHERITED (originCexTransferId)', async () => {
    const userId = await createUser();
    // No on-chain wallet with fromAddress — so step 1 falls through
    const fromAddress = '0xunknownwallet000000000000000000000000000';

    const cexWalletId = await createCexWallet(userId);
    const tokenId = await createToken('USDT');

    // Create a CEX open position first so the transaction can reference it
    const cexPositionId = await createOpenPosition(cexWalletId, tokenId, '1500.00');

    const txHash = '0xbinancetxhash001';
    await createBinanceTransferOut(cexWalletId, tokenId, cexPositionId, txHash);

    const pgc = await pool!.connect();
    try {
      const result = await resolveTransferCost(pgc, txHash, fromAddress, tokenId);

      expect(result.costSource).toBe('INHERITED');
      expect(result.priceUsd).toBe('1500.00');
      expect('originCexTransferId' in result).toBe(true);
    } finally {
      pgc.release();
    }
  });

  it('T24 — step 1 CLOSED position falls through to MANUAL', async () => {
    const userId = await createUser();
    const fromAddress = '0xclosedwallet0000000000000000000000000000';
    const walletId = await createOnChainWallet(userId, fromAddress);
    const tokenId = await createToken('BNB');
    // Only a CLOSED position — step 1 skips
    await createClosedPosition(walletId, tokenId);
    // No Binance tx for this txHash — step 2 skips

    const pgc = await pool!.connect();
    try {
      const result = await resolveTransferCost(pgc, '0yuniquehash', fromAddress, tokenId);

      expect(result.costSource).toBe('MANUAL');
      expect(result.priceUsd).toBeNull();
    } finally {
      pgc.release();
    }
  });

  it('T25 — no match in any step → MANUAL', async () => {
    // Nothing in DB
    const pgc = await pool!.connect();
    try {
      const result = await resolveTransferCost(
        pgc,
        '0xnonexistenttx',
        '0xnonexistentaddress',
        '00000000-0000-0000-0000-000000000000',
      );

      expect(result.costSource).toBe('MANUAL');
      expect(result.priceUsd).toBeNull();
    } finally {
      pgc.release();
    }
  });
});
