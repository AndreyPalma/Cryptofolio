// TransactionService — US-006
// Funciones puras que reciben Pool como parámetro para ser testeables sin Fastify.

import type { Pool } from "pg";
import type {
  CreateTransactionInput,
  CreateTransactionResult,
  Transaction,
  TransactionListQuery,
  TransactionListResult,
} from "../types/transaction.js";
import {
  processTransaction,
  type TransactionInput,
  type PositionState,
  InsufficientBalanceError,
  InvalidTransactionError,
  InvalidPositionStateError,
} from "../position-engine/index.js";
import { ValidationError, NotFoundError } from "./errors.js";

// ─────────────────────────────────────────────────────────────────────────────
// createTransaction
// ─────────────────────────────────────────────────────────────────────────────

export async function createTransaction(
  pool: Pool,
  input: CreateTransactionInput,
): Promise<CreateTransactionResult> {
  // Step 1: Domain rule — TRANSFER_IN without price (before any DB call)
  if (input.type === "TRANSFER_IN" && input.price_usd_at_time === null) {
    throw new ValidationError(
      "Price required for manual TRANSFER_IN",
      "PRICE_REQUIRED_FOR_TRANSFER_IN",
    );
  }

  // Step 2: Verify wallet exists
  const walletCheck = await pool.query<{ id: string }>(`SELECT id FROM wallets WHERE id = $1`, [
    input.wallet_id,
  ]);
  if (!walletCheck.rows[0]) {
    throw new NotFoundError("Wallet not found", "WALLET_NOT_FOUND");
  }

  // Step 3: Verify token exists
  const tokenCheck = await pool.query<{ id: string }>(`SELECT id FROM tokens WHERE id = $1`, [
    input.token_id,
  ]);
  if (!tokenCheck.rows[0]) {
    throw new NotFoundError("Token not found", "TOKEN_NOT_FOUND");
  }

  // Step 4: Acquire client and begin transaction
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Step 5: Load active OPEN position
    const openPosResult = await client.query<{
      id: string;
      wallet_id: string;
      token_id: string;
      cycle_number: number;
      status: string;
      balance: string;
      wac: string;
      cost_basis: string;
      realized_pnl_usd: string;
      opened_at: Date;
      closed_at: Date | null;
    }>(
      `SELECT * FROM positions
       WHERE wallet_id = $1 AND token_id = $2 AND status = 'OPEN'
       ORDER BY cycle_number DESC
       LIMIT 1`,
      [input.wallet_id, input.token_id],
    );

    const openPositionRow = openPosResult.rows[0];
    const openPosition: PositionState | null = openPositionRow
      ? {
          id: openPositionRow.id,
          walletId: openPositionRow.wallet_id,
          tokenId: openPositionRow.token_id,
          cycleNumber: openPositionRow.cycle_number,
          status: openPositionRow.status as "OPEN" | "CLOSED",
          balance: openPositionRow.balance,
          wac: openPositionRow.wac,
          costBasis: openPositionRow.cost_basis,
          realizedPnlUsd: openPositionRow.realized_pnl_usd,
          openedAt: openPositionRow.opened_at,
          closedAt: openPositionRow.closed_at,
        }
      : null;

    // Step 6: Count closed cycles for this (wallet, token) pair
    const closedResult = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM positions
       WHERE wallet_id = $1 AND token_id = $2 AND status = 'CLOSED'`,
      [input.wallet_id, input.token_id],
    );
    const priorClosedCycles = closedResult.rows[0]?.count ?? 0;

    // Step 7: Build positionIdentity for new cycles
    const positionIdentity =
      openPosition === null
        ? { id: crypto.randomUUID(), walletId: input.wallet_id, tokenId: input.token_id }
        : undefined;

    // Step 8: Build TransactionInput for the engine
    const txInput: TransactionInput = {
      type: input.type,
      amount: input.amount,
      priceUsd: input.price_usd_at_time,
      costSource: input.cost_source,
      source: "MANUAL",
      blockTimestamp: new Date(input.block_timestamp),
    };

    // Step 9: Call the position engine (may throw — let InsufficientBalanceError propagate)
    let engineResult;
    try {
      engineResult = processTransaction({
        position: openPosition,
        priorClosedCycles,
        transaction: txInput,
        positionIdentity,
      });
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        // Propagate to route handler for the extended 400 body
        throw err;
      }
      if (err instanceof InvalidTransactionError) {
        throw new ValidationError(err.reason, err.reason);
      }
      if (err instanceof InvalidPositionStateError) {
        throw new ValidationError(err.reason, err.reason);
      }
      throw err;
    }

    const pos = engineResult.position;

    // Step 10: UPSERT positions FIRST (FK: transactions.position_id → positions.id)
    const positionUpsertResult = await client.query<{
      id: string;
      cycle_number: number;
      status: string;
      wac: string;
      balance: string;
    }>(
      `INSERT INTO positions (
        id, wallet_id, token_id, cycle_number, status,
        wac, balance, cost_basis, realized_pnl_usd,
        opened_at, closed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (wallet_id, token_id, cycle_number)
      DO UPDATE SET
        status           = EXCLUDED.status,
        wac              = EXCLUDED.wac,
        balance          = EXCLUDED.balance,
        cost_basis       = EXCLUDED.cost_basis,
        realized_pnl_usd = EXCLUDED.realized_pnl_usd,
        closed_at        = EXCLUDED.closed_at
      RETURNING id, cycle_number, status, wac, balance`,
      [
        pos.id,
        pos.walletId,
        pos.tokenId,
        pos.cycleNumber,
        pos.status,
        pos.wac,
        pos.balance,
        pos.costBasis,
        pos.realizedPnlUsd,
        pos.openedAt,
        pos.closedAt,
      ],
    );

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- UPSERT RETURNING always returns a row on success
    const positionRow = positionUpsertResult.rows[0]!;

    // Step 11: INSERT transaction AFTER position exists (FK constraint satisfied)
    const txInsertResult = await client.query<{ id: string }>(
      `INSERT INTO transactions (
        wallet_id, token_id, position_id, type, source,
        tx_hash, cex_trade_id, block_timestamp, amount,
        price_usd, cost_source, created_at
      ) VALUES (
        $1, $2, $3, $4, 'MANUAL',
        NULL, NULL, $5, $6, $7, $8, now()
      )
      RETURNING id`,
      [
        input.wallet_id,
        input.token_id,
        positionRow.id,
        input.type,
        new Date(input.block_timestamp),
        input.amount,
        input.price_usd_at_time,
        input.cost_source ?? null,
      ],
    );

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- INSERT RETURNING always returns a row on success
    const txRow = txInsertResult.rows[0]!;

    // Step 12: Commit
    await client.query("COMMIT");

    // Step 15: Return result
    return {
      transaction_id: txRow.id,
      position_id: positionRow.id,
      cycle_number: positionRow.cycle_number,
      status: positionRow.status as "OPEN" | "CLOSED",
      wac: positionRow.wac,
      balance: positionRow.balance,
    };
  } catch (err) {
    // Step 14: ROLLBACK on any error (except already-propagated domain errors that haven't touched DB)
    await client.query("ROLLBACK");
    throw err;
  } finally {
    // Step 13: Always release the client
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// listTransactions
// ─────────────────────────────────────────────────────────────────────────────

export async function listTransactions(
  pool: Pool,
  query: TransactionListQuery,
): Promise<TransactionListResult> {
  const params: unknown[] = [query.wallet_id];
  const conditions: string[] = ["wallet_id = $1"];
  let paramIdx = 2;

  if (query.token_id !== undefined) {
    conditions.push(`token_id = $${String(paramIdx)}`);
    params.push(query.token_id);
    paramIdx++;
  }

  if (query.position_id !== undefined) {
    conditions.push(`position_id = $${String(paramIdx)}`);
    params.push(query.position_id);
    paramIdx++;
  }

  params.push(query.limit, query.offset);
  const limitIdx = String(paramIdx);
  const offsetIdx = String(paramIdx + 1);

  const sql = `
    SELECT *, COUNT(*) OVER() AS total_count
    FROM transactions
    WHERE ${conditions.join(" AND ")}
    ORDER BY block_timestamp DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const result = await pool.query<Transaction & { total_count: string }>(sql, params);

  return {
    data: result.rows.map(({ total_count: _tc, ...tx }) => tx),
    total: result.rows[0] ? parseInt(result.rows[0].total_count, 10) : 0,
    limit: query.limit,
    offset: query.offset,
  };
}
