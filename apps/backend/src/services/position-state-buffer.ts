import type { Pool } from 'pg';
import { processTransaction } from '../position-engine/index.js';
import type { PositionState, ProcessTransactionInput } from '../position-engine/index.js';

interface PositionRow {
  id: string;
  wallet_id: string;
  token_id: string;
  cycle_number: number;
  status: PositionState['status'];
  balance: string;
  wac: string;
  cost_basis: string;
  realized_pnl_usd: string;
  opened_at: Date;
  closed_at: Date | null;
}

function toPositionState(row: PositionRow): PositionState {
  return {
    id: row.id,
    walletId: row.wallet_id,
    tokenId: row.token_id,
    cycleNumber: row.cycle_number,
    status: row.status,
    balance: row.balance,
    wac: row.wac,
    costBasis: row.cost_basis,
    realizedPnlUsd: row.realized_pnl_usd,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
  };
}

export async function loadInitial(pool: Pool, walletId: string): Promise<Map<string, PositionState>> {
  const result = await pool.query<PositionRow>(
    `SELECT DISTINCT ON (token_id)
       id,
       wallet_id,
       token_id,
       cycle_number,
       status,
       balance::text,
       wac::text,
       cost_basis::text,
       realized_pnl_usd::text,
       opened_at,
       closed_at
     FROM positions
     WHERE wallet_id = $1
     ORDER BY token_id,
              CASE WHEN status = 'OPEN' THEN 0 ELSE 1 END,
              cycle_number DESC`,
    [walletId],
  );

  const buffer = new Map<string, PositionState>();
  for (const row of result.rows) {
    buffer.set(row.token_id, toPositionState(row));
  }

  return buffer;
}

function getTokenId(input: ProcessTransactionInput): string {
  const tokenId = input.positionIdentity?.tokenId ?? input.position?.tokenId;
  if (!tokenId) {
    throw new Error('Cannot determine tokenId from ProcessTransactionInput');
  }
  return tokenId;
}

function buildEngineInput(
  cached: PositionState | undefined,
  input: ProcessTransactionInput,
): ProcessTransactionInput {
  if (!cached) {
    return {
      position: null,
      priorClosedCycles: 0,
      transaction: input.transaction,
      positionIdentity: input.positionIdentity,
    };
  }

  if (cached.status === 'OPEN') {
    return {
      position: cached,
      priorClosedCycles: Math.max(cached.cycleNumber - 1, 0),
      transaction: input.transaction,
      positionIdentity: input.positionIdentity,
    };
  }

  return {
    position: null,
    priorClosedCycles: cached.cycleNumber,
    transaction: input.transaction,
    positionIdentity: input.positionIdentity,
  };
}

export function apply(buffer: Map<string, PositionState>, input: ProcessTransactionInput): void {
  const tokenId = getTokenId(input);
  const cached = buffer.get(tokenId);
  const result = processTransaction(buildEngineInput(cached, input));
  buffer.set(tokenId, result.position);
}
