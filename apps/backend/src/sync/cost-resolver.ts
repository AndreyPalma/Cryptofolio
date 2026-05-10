// cost-resolver.ts — resolveTransferCost (3-step DB lookup)
// US-008-A
// Receives a PoolClient — stateless, no module-level DB. Lives in sync/ so the
// engine vitest project can import the type without a Pool dependency.

import { Decimal } from "decimal.js";
import type { PoolClient } from "pg";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CostResolution =
  | {
      readonly costSource: "INHERITED";
      readonly priceUsd: string;
      readonly originPositionId: string;
    }
  | {
      readonly costSource: "INHERITED";
      readonly priceUsd: string;
      readonly originCexTransferId: string;
    }
  | { readonly costSource: "MANUAL"; readonly priceUsd: null };

// ─── resolveTransferCost ─────────────────────────────────────────────────────

/**
 * Resolves WAC for a TRANSFER_IN transaction (per PRD rules).
 *
 * Step 1 — On-chain wallet with OPEN position for same token.
 * Step 2 — Binance TRANSFER_OUT with same tx_hash (cross-source bridge).
 * Step 3 — Fallback: user must enter price manually.
 *
 * Steps run SEQUENTIALLY; the chain aborts on the first match.
 * MUST NOT log WAC values.
 */
export async function resolveTransferCost(
  pgc: PoolClient,
  txHash: string,
  fromAddress: string,
  tokenId: string,
): Promise<CostResolution> {
  const fromLower = fromAddress.toLowerCase();

  // Step 1 — on-chain wallet with OPEN position for the same token
  const step1 = await pgc.query<{ position_id: string; wac: string }>(
    `SELECT p.id AS position_id, p.wac
       FROM wallets w
       JOIN positions p ON p.wallet_id = w.id
      WHERE w.wallet_type = 'ON_CHAIN'
        AND lower(w.address) = $1
        AND p.token_id = $2
        AND p.status   = 'OPEN'
      LIMIT 1`,
    [fromLower, tokenId],
  );

  if (step1.rows[0]) {
    return {
      costSource: "INHERITED",
      priceUsd: new Decimal(step1.rows[0].wac).toFixed(2),
      originPositionId: step1.rows[0].position_id,
    };
  }

  // Step 2 — Binance withdrawal that wrote this txHash on a CEX TRANSFER_OUT
  // NOTE: This path is currently unreachable (dead code) because
  // BinanceSyncService never populates `position_id` on CEX TRANSFER_OUT rows.
  // The JOIN positions therefore matches nothing, and the lookup falls through
  // to Step 3 (MANUAL) for all cases. Kept for documentation and future fix.
  const step2 = await pgc.query<{ id: string; wac: string }>(
    `SELECT t.id, p.wac
       FROM transactions t
       JOIN positions    p ON p.id = t.position_id
      WHERE t.source = 'BINANCE'
        AND t.type   = 'TRANSFER_OUT'
        AND t.tx_hash = $1
      ORDER BY t.block_timestamp DESC
      LIMIT 1`,
    [txHash.toLowerCase()],
  );

  if (step2.rows[0]) {
    return {
      costSource: "INHERITED",
      priceUsd: new Decimal(step2.rows[0].wac).toFixed(2),
      originCexTransferId: step2.rows[0].id,
    };
  }

  // Step 3 — fallback: user must enter price manually
  return { costSource: "MANUAL", priceUsd: null };
}
