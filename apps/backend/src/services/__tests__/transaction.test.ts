// TransactionService tests — US-006
// Uses real DB via pool connected to DATABASE_URL_TEST.
// Follows the pattern established by wallet.test.ts (service-level, not e2e HTTP).

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { pool, resetDb, createUser, createOnChainWallet, createToken } from '../../../../tests/e2e/db/factories.js';
import { createTransaction, listTransactions } from '../transaction.js';
import { ValidationError, NotFoundError } from '../errors.js';
import { InsufficientBalanceError } from '../../position-engine/index.js';

const testUrl = process.env['DATABASE_URL_TEST'];

describe.skipIf(!testUrl)('TransactionService — createTransaction', () => {
  let userId: string;
  let walletId: string;
  let tokenId: string;

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

  afterAll(async () => {
    // pool is shared from factories — closing it here would break other test files.
    // The pool is closed once when the test process exits.
  });

  // ─── Happy path ──────────────────────────────────────────────────────────

  it('SC-TX-CREATE-01: BUY exitoso — posición nueva (ciclo 1)', async () => {
    const result = await createTransaction(pool, {
      wallet_id: walletId,
      token_id: tokenId,
      type: 'BUY',
      amount: '1',
      price_usd_at_time: '3000',
      block_timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    });

    expect(result.cycle_number).toBe(1);
    expect(result.status).toBe('OPEN');
    expect(result.wac).toMatch(/^3000/);
    expect(result.balance).toMatch(/^1/);
    expect(result.transaction_id).toBeTruthy();
    expect(result.position_id).toBeTruthy();

    // Verify DB rows
    const txRow = await pool.query<{ source: string; tx_hash: string | null; cex_trade_id: bigint | null }>(
      `SELECT source, tx_hash, cex_trade_id FROM transactions WHERE id = $1`,
      [result.transaction_id],
    );
    expect(txRow.rows[0]?.source).toBe('MANUAL');
    expect(txRow.rows[0]?.tx_hash).toBeNull();
    expect(txRow.rows[0]?.cex_trade_id).toBeNull();

    const posRow = await pool.query<{ status: string; wac: string; balance: string }>(
      `SELECT status, wac, balance FROM positions WHERE id = $1`,
      [result.position_id],
    );
    expect(posRow.rows[0]?.status).toBe('OPEN');
    expect(posRow.rows[0]?.wac).toMatch(/^3000/);
    expect(posRow.rows[0]?.balance).toMatch(/^1/);
  });

  it('SC-TX-CREATE-02: segundo BUY mismo token — WAC recalculado, balance acumulado', async () => {
    // First BUY: 1 ETH @ $3000 → balance=1, WAC=3000
    await createTransaction(pool, {
      wallet_id: walletId,
      token_id: tokenId,
      type: 'BUY',
      amount: '1',
      price_usd_at_time: '3000',
      block_timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    });

    // Second BUY: 1 ETH @ $4000 → balance=2, WAC=3500
    const result = await createTransaction(pool, {
      wallet_id: walletId,
      token_id: tokenId,
      type: 'BUY',
      amount: '1',
      price_usd_at_time: '4000',
      block_timestamp: new Date('2024-01-02T00:00:00Z').toISOString(),
    });

    expect(result.cycle_number).toBe(1);
    expect(result.balance).toMatch(/^2/);
    expect(result.wac).toMatch(/^3500/);
  });

  it('SC-TX-CREATE-03: SELL parcial — balance reducido, WAC sin cambio (INV-1)', async () => {
    await createTransaction(pool, {
      wallet_id: walletId,
      token_id: tokenId,
      type: 'BUY',
      amount: '1',
      price_usd_at_time: '3000',
      block_timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    });

    const buyResult = await pool.query<{ wac: string }>(
      `SELECT wac FROM positions WHERE wallet_id = $1 AND token_id = $2 AND status = 'OPEN'`,
      [walletId, tokenId],
    );
    const wacBefore = buyResult.rows[0]?.wac ?? '';

    const result = await createTransaction(pool, {
      wallet_id: walletId,
      token_id: tokenId,
      type: 'SELL',
      amount: '0.5',
      price_usd_at_time: '4000',
      block_timestamp: new Date('2024-01-02T00:00:00Z').toISOString(),
    });

    expect(result.status).toBe('OPEN');
    expect(result.balance).toMatch(/^0\.5/);
    // WAC must not change on SELL (INV-1)
    expect(result.wac).toBe(wacBefore);
  });

  it('SC-TX-CREATE-04: SELL total (balance=0) — posición CLOSED', async () => {
    await createTransaction(pool, {
      wallet_id: walletId,
      token_id: tokenId,
      type: 'BUY',
      amount: '1',
      price_usd_at_time: '3000',
      block_timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    });

    const result = await createTransaction(pool, {
      wallet_id: walletId,
      token_id: tokenId,
      type: 'SELL',
      amount: '1',
      price_usd_at_time: '3000',
      block_timestamp: new Date('2024-01-02T00:00:00Z').toISOString(),
    });

    expect(result.status).toBe('CLOSED');
    expect(result.balance).toMatch(/^0/);

    const posRow = await pool.query<{ status: string; closed_at: Date | null }>(
      `SELECT status, closed_at FROM positions WHERE id = $1`,
      [result.position_id],
    );
    expect(posRow.rows[0]?.status).toBe('CLOSED');
    expect(posRow.rows[0]?.closed_at).not.toBeNull();
  });

  it('SC-TX-LIFECYCLE-01: BUY post-cierre — ciclo 2 abierto, WAC fresh (INV-2)', async () => {
    // Open and close cycle 1
    await createTransaction(pool, {
      wallet_id: walletId,
      token_id: tokenId,
      type: 'BUY',
      amount: '1',
      price_usd_at_time: '3000',
      block_timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    });
    await createTransaction(pool, {
      wallet_id: walletId,
      token_id: tokenId,
      type: 'SELL',
      amount: '1',
      price_usd_at_time: '3000',
      block_timestamp: new Date('2024-01-02T00:00:00Z').toISOString(),
    });

    // Open cycle 2
    const result = await createTransaction(pool, {
      wallet_id: walletId,
      token_id: tokenId,
      type: 'BUY',
      amount: '0.5',
      price_usd_at_time: '2500',
      block_timestamp: new Date('2024-01-03T00:00:00Z').toISOString(),
    });

    expect(result.cycle_number).toBe(2);
    expect(result.status).toBe('OPEN');
    expect(result.wac).toMatch(/^2500/);

    // Cycle 1 still exists and is CLOSED
    const cycle1 = await pool.query<{ status: string }>(
      `SELECT status FROM positions WHERE wallet_id = $1 AND token_id = $2 AND cycle_number = 1`,
      [walletId, tokenId],
    );
    expect(cycle1.rows[0]?.status).toBe('CLOSED');
  });

  it('SC-TX-CREATE-05: TRANSFER_IN con price_usd_at_time explícito y cost_source=MANUAL', async () => {
    const result = await createTransaction(pool, {
      wallet_id: walletId,
      token_id: tokenId,
      type: 'TRANSFER_IN',
      amount: '2',
      price_usd_at_time: '1500',
      cost_source: 'MANUAL',
      block_timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    });

    expect(result.status).toBe('OPEN');
    expect(result.wac).toMatch(/^1500/);
    expect(result.balance).toMatch(/^2/);

    const txRow = await pool.query<{ cost_source: string }>(
      `SELECT cost_source FROM transactions WHERE id = $1`,
      [result.transaction_id],
    );
    expect(txRow.rows[0]?.cost_source).toBe('MANUAL');
  });

  // ─── Negative cases ───────────────────────────────────────────────────────

  it('NEGATIVE-TX-01: SELL con amount > balance → InsufficientBalanceError', async () => {
    // Setup: open position with balance=0.5
    await createTransaction(pool, {
      wallet_id: walletId,
      token_id: tokenId,
      type: 'BUY',
      amount: '0.5',
      price_usd_at_time: '3000',
      block_timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    });

    await expect(
      createTransaction(pool, {
        wallet_id: walletId,
        token_id: tokenId,
        type: 'SELL',
        amount: '1.0',
        price_usd_at_time: '4000',
        block_timestamp: new Date('2024-01-02T00:00:00Z').toISOString(),
      }),
    ).rejects.toThrow(InsufficientBalanceError);

    // Verify no extra transaction was inserted
    const txCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM transactions WHERE wallet_id = $1`,
      [walletId],
    );
    expect(txCount.rows[0]?.count).toBe('1'); // only the initial BUY
  });

  it('NEGATIVE-TX-01: InsufficientBalanceError tiene currentBalance y attempted correctos', async () => {
    await createTransaction(pool, {
      wallet_id: walletId,
      token_id: tokenId,
      type: 'BUY',
      amount: '0.5',
      price_usd_at_time: '3000',
      block_timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    });

    try {
      await createTransaction(pool, {
        wallet_id: walletId,
        token_id: tokenId,
        type: 'SELL',
        amount: '1.0',
        price_usd_at_time: '4000',
        block_timestamp: new Date('2024-01-02T00:00:00Z').toISOString(),
      });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(InsufficientBalanceError);
      const e = err as InsufficientBalanceError;
      expect(e.currentBalance).toMatch(/^0\.5/);
      expect(e.attempted).toBe('1.0');
    }
  });

  it('NEGATIVE-TX-02: TRANSFER_IN sin price_usd_at_time → ValidationError PRICE_REQUIRED_FOR_TRANSFER_IN', async () => {
    await expect(
      createTransaction(pool, {
        wallet_id: walletId,
        token_id: tokenId,
        type: 'TRANSFER_IN',
        amount: '1',
        price_usd_at_time: null,
        block_timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
      }),
    ).rejects.toMatchObject({
      code: 'PRICE_REQUIRED_FOR_TRANSFER_IN',
      message: 'Price required for manual TRANSFER_IN',
    });

    await expect(
      createTransaction(pool, {
        wallet_id: walletId,
        token_id: tokenId,
        type: 'TRANSFER_IN',
        amount: '1',
        price_usd_at_time: null,
        block_timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('NEGATIVE-TX-03: wallet_id inexistente → NotFoundError WALLET_NOT_FOUND', async () => {
    await expect(
      createTransaction(pool, {
        wallet_id: '00000000-0000-0000-0000-000000000000',
        token_id: tokenId,
        type: 'BUY',
        amount: '1',
        price_usd_at_time: '3000',
        block_timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'WALLET_NOT_FOUND' });

    await expect(
      createTransaction(pool, {
        wallet_id: '00000000-0000-0000-0000-000000000000',
        token_id: tokenId,
        type: 'BUY',
        amount: '1',
        price_usd_at_time: '3000',
        block_timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('NEGATIVE-TX-04: token_id inexistente → NotFoundError TOKEN_NOT_FOUND', async () => {
    await expect(
      createTransaction(pool, {
        wallet_id: walletId,
        token_id: '00000000-0000-0000-0000-000000000000',
        type: 'BUY',
        amount: '1',
        price_usd_at_time: '3000',
        block_timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'TOKEN_NOT_FOUND' });
  });

  it('NEGATIVE-TX-05: SELL sin posición OPEN → InvalidTransactionError OUTBOUND_WITHOUT_POSITION', async () => {
    await expect(
      createTransaction(pool, {
        wallet_id: walletId,
        token_id: tokenId,
        type: 'SELL',
        amount: '1',
        price_usd_at_time: '3000',
        block_timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
      }),
    ).rejects.toMatchObject({ reason: 'OUTBOUND_WITHOUT_POSITION' });

    // No rows persisted
    const txCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM transactions WHERE wallet_id = $1`,
      [walletId],
    );
    expect(txCount.rows[0]?.count).toBe('0');
  });

  it('NEGATIVE-TX-06: SWAP_OUT sin posición OPEN → InvalidTransactionError OUTBOUND_WITHOUT_POSITION', async () => {
    await expect(
      createTransaction(pool, {
        wallet_id: walletId,
        token_id: tokenId,
        type: 'SWAP_OUT',
        amount: '1',
        price_usd_at_time: '3000',
        block_timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
      }),
    ).rejects.toMatchObject({ reason: 'OUTBOUND_WITHOUT_POSITION' });
  });
});

describe.skipIf(!testUrl)('TransactionService — listTransactions', () => {
  let userId: string;
  let walletId: string;
  let tokenId: string;
  let walletId2: string;
  let tokenId2: string;

  beforeEach(async () => {
    await resetDb();
    userId = await createUser();
    walletId = await createOnChainWallet({ userId });
    walletId2 = await createOnChainWallet({ userId, address: '0x0000000000000000000000000000000000000001', network: 'BSC' });
    tokenId = await createToken({
      symbol: 'ETH',
      network: 'ETH',
      contractAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    });
    tokenId2 = await createToken({
      symbol: 'BNB',
      network: 'BSC',
      contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });
  });

  it('SC-TX-LIST-01: filtro wallet_id — retorna solo las de esa wallet ordenadas por block_timestamp DESC', async () => {
    // Create 2 transactions in wallet 1
    await createTransaction(pool, {
      wallet_id: walletId,
      token_id: tokenId,
      type: 'BUY',
      amount: '1',
      price_usd_at_time: '3000',
      block_timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    });
    await createTransaction(pool, {
      wallet_id: walletId,
      token_id: tokenId,
      type: 'BUY',
      amount: '1',
      price_usd_at_time: '3500',
      block_timestamp: new Date('2024-01-02T00:00:00Z').toISOString(),
    });

    // Create 1 transaction in wallet 2
    await createTransaction(pool, {
      wallet_id: walletId2,
      token_id: tokenId2,
      type: 'BUY',
      amount: '1',
      price_usd_at_time: '200',
      block_timestamp: new Date('2024-01-03T00:00:00Z').toISOString(),
    });

    const result = await listTransactions(pool, {
      wallet_id: walletId,
      limit: 20,
      offset: 0,
    });

    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);

    // Verify all belong to wallet 1
    for (const tx of result.data) {
      expect(tx.wallet_id).toBe(walletId);
    }

    // Verify DESC order
    const timestamps = result.data.map(tx => new Date(tx.block_timestamp).getTime());
    expect(timestamps[0]).toBeGreaterThanOrEqual(timestamps[1] ?? 0);
  });

  it('SC-TX-LIST-02: filtro token_id — retorna solo del par (wallet_id, token_id)', async () => {
    await createTransaction(pool, {
      wallet_id: walletId,
      token_id: tokenId,
      type: 'BUY',
      amount: '1',
      price_usd_at_time: '3000',
      block_timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    });

    // Create CEX token in same wallet not possible (ON_CHAIN wallet only accepts ETH/BSC tokens)
    // Use a second BSC token in wallet2 instead
    await createTransaction(pool, {
      wallet_id: walletId2,
      token_id: tokenId2,
      type: 'BUY',
      amount: '1',
      price_usd_at_time: '200',
      block_timestamp: new Date('2024-01-02T00:00:00Z').toISOString(),
    });

    const result = await listTransactions(pool, {
      wallet_id: walletId,
      token_id: tokenId,
      limit: 20,
      offset: 0,
    });

    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.data[0]?.token_id).toBe(tokenId);
  });

  it('SC-TX-LIST-03: paginación limit=2, offset=2 sobre 5 filas', async () => {
    // Create 5 transactions
    for (let i = 1; i <= 5; i++) {
      await createTransaction(pool, {
        wallet_id: walletId,
        token_id: tokenId,
        type: 'BUY',
        amount: String(i),
        price_usd_at_time: '3000',
        block_timestamp: new Date(`2024-01-0${i}T00:00:00Z`).toISOString(),
      });
    }

    const result = await listTransactions(pool, {
      wallet_id: walletId,
      limit: 2,
      offset: 2,
    });

    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(5);
    expect(result.limit).toBe(2);
    expect(result.offset).toBe(2);
  });

  it('SC-TX-LIST-04: wallet sin transacciones → { data: [], total: 0 }', async () => {
    const result = await listTransactions(pool, {
      wallet_id: walletId,
      limit: 20,
      offset: 0,
    });

    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });
});
