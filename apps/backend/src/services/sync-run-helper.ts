import type { Pool } from 'pg';
import type { PositionState } from '../position-engine/index.js';

interface CursorUpdate {
  readonly operation: string;
  readonly value: string;
}

interface CommitSuccessOptions {
  readonly positions: ReadonlyMap<string, PositionState>;
  readonly cursorUpdates: readonly CursorUpdate[];
}

interface SyncRunInsertRow {
  id: string;
}

interface SyncRunWalletRow {
  wallet_id: string;
}

/**
 * Orchestrates sync-run atomicity for CEX and on-chain sync operations.
 *
 * **Why `status` only has 'running' | 'completed' (no 'failed' / 'aborted'):**
 * A failed sync calls `rollback()` which DELETEs the sync_runs row entirely,
 * so failed runs are never persisted. Only successful runs survive in DB.
 * See RD-015 in prd-binance-sync-fix.json for the design rationale.
 *
 * **Multi-instance extension path:**
 * Currently relies on single-instance guarantee (cleanupStaleRuns at startup).
 * For multi-instance, replace `status='running'` with a lease pattern:
 * add `lease_expires_at TIMESTAMPTZ` column, cleanup = WHERE status='running'
 * AND lease_expires_at < now(), and start() sets lease_expires_at = now() + TTL.
 */
export class SyncRunHelper {
  private readonly txsPersistedByRun = new Map<string, number>();

  constructor(private readonly pool: Pool) {}

  async start(walletId: string, type: 'CEX' | 'ON_CHAIN'): Promise<{ runId: string }> {
    const result = await this.pool.query<SyncRunInsertRow>(
      `INSERT INTO sync_runs (wallet_id, type, status)
       VALUES ($1, $2, 'running')
       RETURNING id`,
      [walletId, type],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error('INSERT RETURNING must return a row');
    }
    const runId = row.id;
    this.txsPersistedByRun.set(runId, 0);
    return { runId };
  }

  recordTxsPersisted(runId: string, count: number): void {
    const current = this.txsPersistedByRun.get(runId) ?? 0;
    this.txsPersistedByRun.set(runId, current + count);
  }

  async commitSuccess(runId: string, opts: CommitSuccessOptions): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const runResult = await client.query<SyncRunWalletRow>(
        `SELECT wallet_id FROM sync_runs WHERE id = $1 FOR UPDATE`,
        [runId],
      );
      const run = runResult.rows[0];
      if (!run) {
        throw new Error(`Sync run not found: ${runId}`);
      }

      for (const position of opts.positions.values()) {
        await client.query(
          `INSERT INTO positions (
            id, wallet_id, token_id, cycle_number, status,
            balance, wac, cost_basis, realized_pnl_usd,
            opened_at, closed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (wallet_id, token_id, cycle_number)
          DO UPDATE SET
            status           = EXCLUDED.status,
            balance          = EXCLUDED.balance,
            wac              = EXCLUDED.wac,
            cost_basis       = EXCLUDED.cost_basis,
            realized_pnl_usd = EXCLUDED.realized_pnl_usd,
            closed_at        = EXCLUDED.closed_at`,
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

      for (const cursorUpdate of opts.cursorUpdates) {
        await client.query(
          `INSERT INTO wallet_sync_cursors (wallet_id, operation, last_value, last_synced_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (wallet_id, operation)
           DO UPDATE SET
             last_value = EXCLUDED.last_value,
             last_synced_at = EXCLUDED.last_synced_at`,
          [run.wallet_id, cursorUpdate.operation, cursorUpdate.value],
        );
      }

      const txsPersisted = this.txsPersistedByRun.get(runId) ?? 0;
      await client.query(
        `UPDATE sync_runs
         SET status = 'completed', completed_at = now(), txs_persisted = $2
         WHERE id = $1`,
        [runId, txsPersisted],
      );

      await client.query('COMMIT');
      this.txsPersistedByRun.delete(runId);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      await this.rollback(runId).catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async rollback(runId: string): Promise<void> {
    await this.pool.query(`DELETE FROM sync_runs WHERE id = $1`, [runId]);
    this.txsPersistedByRun.delete(runId);
  }
}

export async function cleanupStaleRuns(pool: Pool): Promise<{ deleted: number }> {
  const result = await pool.query<{ id: string }>(
    `DELETE FROM sync_runs WHERE status = 'running' RETURNING id`,
  );

  return { deleted: result.rowCount ?? 0 };
}
