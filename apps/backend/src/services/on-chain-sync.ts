// OnChainSyncService — US-008-A
// Orchestrates on-chain sync: fetch → classify → cost-resolve → persist.
// This is the only class that holds a Postgres pool for this pipeline.

import type { Pool, PoolClient } from 'pg';
import type { PriceService } from './price.js';
import type { OnChainApiClient, NormalizedTx, NormalizedTokenTx } from '../sync/clients/on-chain-api.js';
import type { DecomposedTransaction } from '../sync/classify.js';
import type { SyncResult } from '../schemas/sync.js';
import type { PositionState } from '../position-engine/index.js';
import { groupByTxHash, classifyAndDecomposeTransaction } from '../sync/classify.js';
import { resolveTransferCost } from '../sync/cost-resolver.js';
import { processTransaction } from '../position-engine/index.js';
import {
  InvalidTransactionError,
  InsufficientBalanceError,
  InvalidPositionStateError,
} from '../position-engine/index.js';
import { NotFoundError } from './errors.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** DefiLlama convention for native assets — used to create token rows for ETH/BNB. */
const NATIVE_PSEUDO_ADDRESS: Record<'ETH' | 'BSC', string> = {
  ETH: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  BSC: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
};

const NATIVE_SYMBOL: Record<'ETH' | 'BSC', string> = {
  ETH: 'ETH',
  BSC: 'BNB',
};

const PAGE_SIZE = 1000;
const MAX_BLOCK = 99_999_999;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OnChainSyncDeps {
  readonly pool: Pool;
  readonly priceService: PriceService;
  readonly etherscanClient: OnChainApiClient;
  readonly bsctraceClient: OnChainApiClient;
}

interface WalletRow {
  id: string;
  user_id: string;
  wallet_type: 'ON_CHAIN' | 'CEX';
  network: 'ETH' | 'BSC' | 'CEX_BINANCE';
  address: string | null;
  last_synced_block: number;
}

interface SyncCounters {
  synced: number;
  skipped: number;
  swapsDecomposed: number;
  transfersPendingCost: number;
  transfersInheritedFromCEX: number;
}

// ─── OnChainSyncService ───────────────────────────────────────────────────────

export class OnChainSyncService {
  constructor(private readonly deps: OnChainSyncDeps) {}

  // ─── Public entry point ────────────────────────────────────────────────────

  async sync(walletId: string, userId: string): Promise<SyncResult> {
    const wallet = await this.loadWallet(walletId, userId);

    if (wallet.wallet_type !== 'ON_CHAIN') {
      throw new Error(`[OnChainSyncService] invariant violation: expected ON_CHAIN wallet, got ${wallet.wallet_type}`);
    }

    const network = wallet.network as 'ETH' | 'BSC';
    const apiClient = network === 'ETH' ? this.deps.etherscanClient : this.deps.bsctraceClient;

    // Fail fast if API key is missing — before any network call
    apiClient.assertConfigured();

    const walletAddress = wallet.address!.toLowerCase();

    // Fetch all raw transactions (paginated)
    const { normalTxs, tokenTxs } = await this.fetchAllRawTransactions(
      apiClient,
      walletAddress,
      wallet.last_synced_block,
    );

    // Group + classify + decompose (pure, no DB)
    const groups = groupByTxHash(normalTxs, tokenTxs);
    const decomposed: DecomposedTransaction[] = groups.flatMap((g) =>
      classifyAndDecomposeTransaction(g, walletAddress, network),
    );

    // CRITICAL: sort by (blockNumber, transactionIndex, txLogIndex) ASC
    // WAC calculations in PositionEngine are order-sensitive
    decomposed.sort(
      (a, b) =>
        a.blockNumber - b.blockNumber ||
        a.transactionIndex - b.transactionIndex ||
        a.txLogIndex - b.txLogIndex,
    );

    const counters: SyncCounters = {
      synced: 0,
      skipped: 0,
      swapsDecomposed: 0,
      transfersPendingCost: 0,
      transfersInheritedFromCEX: 0,
    };
    const newTransactionIds: string[] = [];

    // Single DB transaction for all rows — ON CONFLICT keeps re-runs safe
    const pgc = await this.deps.pool.connect();
    try {
      await pgc.query('BEGIN');

      for (const tx of decomposed) {
        const tokenContract = tx.tokenContract ?? NATIVE_PSEUDO_ADDRESS[network];
        const tokenId = await this.ensureToken(
          pgc,
          network,
          tokenContract,
          tx.tokenSymbol,
          tx.tokenDecimals,
        );

        // Resolve price + costSource per transaction type
        let priceUsd: string | null = null;
        let costSource: 'MARKET' | 'INHERITED' | 'MANUAL' | null = null;

        if (tx.type === 'BUY' || tx.type === 'SWAP_IN') {
          const r = await this.deps.priceService.getOnChainPrice(network, tokenContract);
          priceUsd = 'priceUsd' in r ? r.priceUsd : null;
          costSource = 'MARKET';
        } else if (tx.type === 'TRANSFER_IN') {
          const cost = await resolveTransferCost(pgc, tx.txHash, tx.fromAddress, tokenId);
          priceUsd = cost.priceUsd;
          costSource = cost.costSource;
          if (cost.costSource === 'MANUAL') counters.transfersPendingCost++;
          else if ('originCexTransferId' in cost) counters.transfersInheritedFromCEX++;
        } else {
          // SELL, SWAP_OUT, TRANSFER_OUT — live price for P&L (optional)
          const r = await this.deps.priceService.getOnChainPrice(network, tokenContract);
          priceUsd = 'priceUsd' in r ? r.priceUsd : null;
          costSource = null;
        }

        const { inserted } = await this.persistOneTransaction(
          pgc,
          walletId,
          tokenId,
          tx,
          priceUsd,
          costSource,
        );

        if (inserted) {
          counters.synced++;
          newTransactionIds.push(tx.id);
          if (tx.type === 'SWAP_OUT') counters.swapsDecomposed++;
        } else {
          counters.skipped++;
        }
      }

      // Update authoritative cursor
      const lastBlock =
        decomposed.length > 0
          ? decomposed[decomposed.length - 1]!.blockNumber
          : wallet.last_synced_block;

      await pgc.query(
        `UPDATE wallets SET last_synced_block = $1, last_synced_at = now() WHERE id = $2`,
        [lastBlock, walletId],
      );

      await pgc.query(
        `INSERT INTO wallet_sync_cursors (wallet_id, operation, last_value, last_synced_at)
         VALUES ($1, 'block', $2::text, now())
         ON CONFLICT (wallet_id, operation)
         DO UPDATE SET last_value = EXCLUDED.last_value, last_synced_at = EXCLUDED.last_synced_at`,
        [walletId, String(lastBlock)],
      );

      await pgc.query('COMMIT');
    } catch (err) {
      await pgc.query('ROLLBACK');
      throw err;
    } finally {
      pgc.release();
    }

    return this.buildResult(counters, newTransactionIds);
  }

  // ─── Private: loadWallet ──────────────────────────────────────────────────

  private async loadWallet(walletId: string, userId: string): Promise<WalletRow> {
    const result = await this.deps.pool.query<WalletRow>(
      `SELECT id, user_id, wallet_type, network, address, last_synced_block
         FROM wallets WHERE id = $1`,
      [walletId],
    );

    const wallet = result.rows[0];
    if (!wallet || wallet.user_id !== userId) {
      throw new NotFoundError('Wallet not found', 'WALLET_NOT_FOUND');
    }

    return wallet;
  }

  // ─── Private: pagination ──────────────────────────────────────────────────

  private async paginateNormal(
    client: OnChainApiClient,
    address: string,
    fromBlock: number,
  ): Promise<NormalizedTx[]> {
    const all: NormalizedTx[] = [];
    let startBlock = fromBlock + 1; // fromBlock is inclusive of "already done"

    while (true) {
      const batch = await client.fetchNormalTransactions(address, startBlock, MAX_BLOCK);
      all.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      const lastBlock = batch[batch.length - 1]!.blockNumber;
      startBlock = lastBlock - 1; // overlap by 1 to avoid gaps; ON CONFLICT handles dups
    }
    return all;
  }

  private async paginateToken(
    client: OnChainApiClient,
    address: string,
    fromBlock: number,
  ): Promise<NormalizedTokenTx[]> {
    const all: NormalizedTokenTx[] = [];
    let startBlock = fromBlock + 1;

    while (true) {
      const batch = await client.fetchTokenTransactions(address, startBlock, MAX_BLOCK);
      all.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      const lastBlock = batch[batch.length - 1]!.blockNumber;
      startBlock = lastBlock - 1;
    }
    return all;
  }

  private async fetchAllRawTransactions(
    client: OnChainApiClient,
    address: string,
    fromBlock: number,
  ): Promise<{ normalTxs: NormalizedTx[]; tokenTxs: NormalizedTokenTx[] }> {
    const [normalTxs, tokenTxs] = await Promise.all([
      this.paginateNormal(client, address, fromBlock),
      this.paginateToken(client, address, fromBlock),
    ]);
    return { normalTxs, tokenTxs };
  }

  // ─── Private: ensureToken ─────────────────────────────────────────────────

  private async ensureToken(
    pgc: PoolClient,
    network: 'ETH' | 'BSC',
    contractAddress: string,
    symbol: string,
    decimals: number,
  ): Promise<string> {
    const addr = contractAddress.toLowerCase();

    // Try to find existing token first (avoids touching the expression unique index)
    const existing = await pgc.query<{ id: string }>(
      `SELECT id FROM tokens WHERE network = $1 AND lower(contract_address) = lower($2)`,
      [network, addr],
    );
    if (existing.rows[0]) {
      return existing.rows[0].id;
    }

    // Insert; if a concurrent insert races us, do nothing and re-select
    const result = await pgc.query<{ id: string }>(
      `INSERT INTO tokens (symbol, network, contract_address, decimals)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [symbol, network, addr, decimals],
    );
    if (result.rows[0]) {
      return result.rows[0].id;
    }

    // Re-select after conflict
    const retry = await pgc.query<{ id: string }>(
      `SELECT id FROM tokens WHERE network = $1 AND lower(contract_address) = lower($2)`,
      [network, addr],
    );
    return retry.rows[0]!.id;
  }

  // ─── Private: persistOneTransaction ──────────────────────────────────────

  private async persistOneTransaction(
    pgc: PoolClient,
    walletId: string,
    tokenId: string,
    tx: DecomposedTransaction,
    priceUsd: string | null,
    costSource: 'MARKET' | 'INHERITED' | 'MANUAL' | null,
  ): Promise<{ inserted: boolean }> {
    // Load OPEN position FOR UPDATE (prevents concurrent race in future)
    const openPosResult = await pgc.query<{
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
       LIMIT 1
       FOR UPDATE`,
      [walletId, tokenId],
    );

    const openPositionRow = openPosResult.rows[0];
    const openPosition: PositionState | null = openPositionRow
      ? {
          id: openPositionRow.id,
          walletId: openPositionRow.wallet_id,
          tokenId: openPositionRow.token_id,
          cycleNumber: openPositionRow.cycle_number,
          status: openPositionRow.status as 'OPEN' | 'CLOSED',
          balance: openPositionRow.balance,
          wac: openPositionRow.wac,
          costBasis: openPositionRow.cost_basis,
          realizedPnlUsd: openPositionRow.realized_pnl_usd,
          openedAt: openPositionRow.opened_at,
          closedAt: openPositionRow.closed_at,
        }
      : null;

    // Count closed cycles
    const closedResult = await pgc.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM positions
       WHERE wallet_id = $1 AND token_id = $2 AND status = 'CLOSED'`,
      [walletId, tokenId],
    );
    const priorClosedCycles = closedResult.rows[0]?.count ?? 0;

    // New cycle identity
    const positionIdentity =
      openPosition === null
        ? { id: crypto.randomUUID(), walletId, tokenId }
        : undefined;

    // Call position engine
    let engineResult;
    try {
      engineResult = processTransaction({
        position: openPosition,
        priorClosedCycles,
        transaction: {
          type: tx.type,
          amount: tx.amount,
          priceUsd,
          costSource: costSource ?? undefined,
          source: tx.source,
          blockTimestamp: tx.blockTimestamp,
          relatedTxId: tx.relatedTxId ?? undefined,
        },
        positionIdentity,
      });
    } catch (err) {
      if (
        err instanceof InvalidTransactionError ||
        err instanceof InsufficientBalanceError ||
        err instanceof InvalidPositionStateError
      ) {
        // Non-fatal: skip this row (e.g. SWAP_IN with priceUnavailable)
        return { inserted: false };
      }
      throw err;
    }

    const pos = engineResult.position;

    // UPSERT position (FK: transactions.position_id → positions.id)
    await pgc.query(
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
        closed_at        = EXCLUDED.closed_at`,
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

    // INSERT transaction with ON CONFLICT DO NOTHING for idempotency
    const txResult = await pgc.query<{ id: string }>(
      `INSERT INTO transactions (
        id, wallet_id, token_id, position_id, type, source,
        tx_hash, tx_log_index, related_tx_id,
        block_timestamp, amount, price_usd, cost_source, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
      ON CONFLICT DO NOTHING
      RETURNING id`,
      [
        tx.id,
        walletId,
        tokenId,
        pos.id,
        tx.type,
        tx.source,
        tx.txHash,
        tx.txLogIndex,
        tx.relatedTxId ?? null,
        tx.blockTimestamp,
        tx.amount,
        priceUsd,
        costSource,
      ],
    );

    return { inserted: (txResult.rowCount ?? 0) === 1 };
  }

  // ─── Private: buildResult ────────────────────────────────────────────────

  private async buildResult(counters: SyncCounters, newTxIds: string[]): Promise<SyncResult> {
    if (newTxIds.length === 0) {
      return {
        synced: counters.synced,
        skipped: counters.skipped,
        swapsDecomposed: counters.swapsDecomposed,
        transfersPendingCost: counters.transfersPendingCost,
        transfersInheritedFromCEX: counters.transfersInheritedFromCEX,
        newTransactions: [],
      };
    }

    // Fetch up to 10 of the new transactions for the response
    const ids = newTxIds.slice(0, 10);
    const result = await this.deps.pool.query<{
      id: string;
      type: string;
      tx_hash: string;
      block_timestamp: Date;
      amount: string;
      price_usd: string | null;
      cost_source: string | null;
    }>(
      `SELECT id, type, tx_hash, block_timestamp, amount, price_usd, cost_source
         FROM transactions
        WHERE id = ANY($1::uuid[])
        ORDER BY block_timestamp DESC`,
      [ids],
    );

    const newTransactions = result.rows.map((r) => ({
      id: r.id,
      type: r.type as 'BUY' | 'SELL' | 'SWAP_IN' | 'SWAP_OUT' | 'TRANSFER_IN' | 'TRANSFER_OUT',
      txHash: r.tx_hash,
      blockTimestamp: r.block_timestamp instanceof Date
        ? r.block_timestamp.toISOString()
        : String(r.block_timestamp),
      amount: r.amount,
      priceUsd: r.price_usd ?? null,
      costSource: (r.cost_source as 'MARKET' | 'INHERITED' | 'MANUAL' | null) ?? null,
    }));

    return {
      synced: counters.synced,
      skipped: counters.skipped,
      swapsDecomposed: counters.swapsDecomposed,
      transfersPendingCost: counters.transfersPendingCost,
      transfersInheritedFromCEX: counters.transfersInheritedFromCEX,
      newTransactions,
    };
  }
}
