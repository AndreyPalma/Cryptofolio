// OnChainSyncService — US-008-A / US-016
// Orchestrates on-chain sync: fetch → classify → cost-resolve → persist (batched).
// Follows the BinanceSyncService pattern: SyncRunHelper lifecycle, PositionStateBuffer, SyncEmitter.

import type { Pool } from "pg";
import type { PriceService } from "./price.js";
import type {
  OnChainApiClient,
  NormalizedTx,
  NormalizedTokenTx,
} from "../sync/clients/on-chain-api.js";
import type { DecomposedTransaction } from "../sync/classify.js";
import type { SyncResult } from "../schemas/sync.js";
import type { PositionState, ProcessTransactionInput } from "../position-engine/index.js";
import { groupByTxHash, classifyAndDecomposeTransaction } from "../sync/classify.js";
import { resolveTransferCost } from "../sync/cost-resolver.js";
import {
  InvalidTransactionError,
  InsufficientBalanceError,
  InvalidPositionStateError,
} from "../position-engine/index.js";
import { NotFoundError } from "./errors.js";
import { SyncRunHelper } from "./sync-run-helper.js";
import { loadInitial, apply } from "./position-state-buffer.js";
import type { SyncEmitter } from "./binance-sync.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** DefiLlama convention for native assets — used to create token rows for ETH/BNB. */
const NATIVE_PSEUDO_ADDRESS: Record<"ETH" | "BSC", string> = {
  ETH: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  BSC: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
};

const PAGE_SIZE = 1000;
const MAX_BLOCK = 99_999_999;

export const ON_CHAIN_PERSIST_BATCH_SIZE = 500;

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
  wallet_type: "ON_CHAIN" | "CEX";
  network: "ETH" | "BSC" | "CEX_BINANCE";
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

  async sync(
    walletId: string,
    userId: string,
    opts?: { emit?: SyncEmitter; signal?: AbortSignal },
  ): Promise<SyncResult> {
    const emit = opts?.emit;
    const signal = opts?.signal;

    const wallet = await this.loadWallet(walletId, userId);

    if (wallet.wallet_type !== "ON_CHAIN") {
      throw new Error(
        `[OnChainSyncService] invariant violation: expected ON_CHAIN wallet, got ${wallet.wallet_type}`,
      );
    }

    const network = wallet.network as "ETH" | "BSC";
    const apiClient = network === "ETH" ? this.deps.etherscanClient : this.deps.bsctraceClient;

    // Fail fast if API key is missing — before any network call
    apiClient.assertConfigured();

    if (!wallet.address) {
      throw new Error(
        `[OnChainSyncService] invariant violation: ON_CHAIN wallet must have an address`,
      );
    }
    const walletAddress = wallet.address.toLowerCase();

    const syncRunHelper = new SyncRunHelper(this.deps.pool);
    const { runId } = await syncRunHelper.start(walletId, "ON_CHAIN");
    const buffer = await loadInitial(this.deps.pool, walletId);

    try {
      // ── Step 1: fetch_normal ──
      emit?.({ step: "fetch_normal", status: "running" });
      const normalTxs = await this.paginateNormal(
        apiClient,
        walletAddress,
        wallet.last_synced_block,
      );
      emit?.({ step: "fetch_normal", status: "done", synced: normalTxs.length, skipped: 0 });
      this.checkAborted(signal);

      // ── Step 2: fetch_tokens ──
      emit?.({ step: "fetch_tokens", status: "running" });
      const tokenTxs = await this.paginateToken(apiClient, walletAddress, wallet.last_synced_block);
      emit?.({ step: "fetch_tokens", status: "done", synced: tokenTxs.length, skipped: 0 });
      this.checkAborted(signal);

      // ── Step 3: classify ──
      emit?.({ step: "classify", status: "running" });
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
      emit?.({ step: "classify", status: "done", synced: decomposed.length, skipped: 0 });
      this.checkAborted(signal);

      // ── Step 4: persist (batched) ──
      const { counters, newTransactionIds } = await this.persistBatched(
        walletId,
        network,
        runId,
        buffer,
        decomposed,
        emit,
        signal,
      );

      // ── Cursor + commit ──
      const lastDecomposed = decomposed[decomposed.length - 1];
      const lastBlock =
        lastDecomposed !== undefined ? lastDecomposed.blockNumber : wallet.last_synced_block;

      syncRunHelper.recordTxsPersisted(runId, counters.synced);
      await syncRunHelper.commitSuccess(runId, {
        positions: buffer,
        cursorUpdates: [{ operation: "block", value: String(lastBlock) }],
      });

      // Best-effort last_synced_at
      await this.deps.pool
        .query("UPDATE wallets SET last_synced_at = now() WHERE id = $1", [walletId])
        .catch(() => undefined);

      return await this.buildResult(counters, newTransactionIds);
    } catch (err) {
      await syncRunHelper.rollback(runId).catch(() => undefined);
      throw err;
    }
  }

  // ─── Private: checkAborted ───────────────────────────────────────────────

  private checkAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new Error("ABORTED");
  }

  // ─── Private: persistBatched ─────────────────────────────────────────────

  private async persistBatched(
    walletId: string,
    network: "ETH" | "BSC",
    runId: string,
    buffer: Map<string, PositionState>,
    decomposed: DecomposedTransaction[],
    emit?: SyncEmitter,
    signal?: AbortSignal,
  ): Promise<{ counters: SyncCounters; newTransactionIds: string[] }> {
    const counters: SyncCounters = {
      synced: 0,
      skipped: 0,
      swapsDecomposed: 0,
      transfersPendingCost: 0,
      transfersInheritedFromCEX: 0,
    };
    const newTransactionIds: string[] = [];

    emit?.({ step: "persist", status: "running" });

    for (let i = 0; i < decomposed.length; i += ON_CHAIN_PERSIST_BATCH_SIZE) {
      const batch = decomposed.slice(i, i + ON_CHAIN_PERSIST_BATCH_SIZE);

      for (const tx of batch) {
        const tokenContract = tx.tokenContract ?? NATIVE_PSEUDO_ADDRESS[network];
        const tokenId = await this.ensureToken(
          network,
          tokenContract,
          tx.tokenSymbol,
          tx.tokenDecimals,
        );

        let priceUsd: string | null = null;
        let costSource: "MARKET" | "INHERITED" | "MANUAL" | null = null;

        // Use historical price at transaction time for BUY/SWAP_IN.
        // For SELL/SWAP_OUT/TRANSFER_OUT we also fetch historical so P&L
        // is computed against the price at the moment of the transaction.
        const txTimestampSec = Math.floor(tx.blockTimestamp.getTime() / 1000);

        if (tx.type === "BUY" || tx.type === "SWAP_IN") {
          const r = await this.deps.priceService.getHistoricalPrice(
            network,
            tokenContract,
            txTimestampSec,
          );
          priceUsd = "priceUsd" in r ? r.priceUsd : null;
          costSource = "MARKET";
        } else if (tx.type === "TRANSFER_IN") {
          const pgc = await this.deps.pool.connect();
          try {
            const cost = await resolveTransferCost(pgc, tx.txHash, tx.fromAddress, tokenId);
            priceUsd = cost.priceUsd;
            costSource = cost.costSource;
            if (cost.costSource === "MANUAL") counters.transfersPendingCost++;
            else if ("originCexTransferId" in cost) counters.transfersInheritedFromCEX++;
          } finally {
            pgc.release();
          }
        } else {
          // SELL, SWAP_OUT, TRANSFER_OUT — historical price at transaction time
          const r = await this.deps.priceService.getHistoricalPrice(
            network,
            tokenContract,
            txTimestampSec,
          );
          priceUsd = "priceUsd" in r ? r.priceUsd : null;
          costSource = null;
        }

        const { inserted } = await this.persistOneTransaction(
          walletId,
          tokenId,
          runId,
          buffer,
          tx,
          priceUsd,
          costSource,
        );

        if (inserted) {
          counters.synced++;
          newTransactionIds.push(tx.id);
          if (tx.type === "SWAP_OUT") counters.swapsDecomposed++;
        } else {
          counters.skipped++;
        }
      }

      const done = Math.min(i + batch.length, decomposed.length);
      emit?.({ type: "batchProgress", done, total: decomposed.length });
      this.checkAborted(signal);
    }

    emit?.({ step: "persist", status: "done", synced: counters.synced, skipped: 0 });
    return { counters, newTransactionIds };
  }

  // ─── Private: loadWallet ──────────────────────────────────────────────────

  private async loadWallet(walletId: string, userId: string): Promise<WalletRow> {
    const result = await this.deps.pool.query<WalletRow>(
      `SELECT id, user_id, wallet_type, network, address, last_synced_block
         FROM wallets WHERE id = $1`,
      [walletId],
    );

    const wallet = result.rows[0];
    if (wallet?.user_id !== userId) {
      throw new NotFoundError("Wallet not found", "WALLET_NOT_FOUND");
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

    for (;;) {
      const batch = await client.fetchNormalTransactions(address, startBlock, MAX_BLOCK);
      all.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      const lastNormal = batch[batch.length - 1];
      if (!lastNormal) break;
      startBlock = lastNormal.blockNumber - 1; // overlap by 1 to avoid gaps; ON CONFLICT handles dups
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

    for (;;) {
      const batch = await client.fetchTokenTransactions(address, startBlock, MAX_BLOCK);
      all.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      const lastToken = batch[batch.length - 1];
      if (!lastToken) break;
      startBlock = lastToken.blockNumber - 1;
    }
    return all;
  }

  // ─── Private: ensureToken ─────────────────────────────────────────────────

  private async ensureToken(
    network: "ETH" | "BSC",
    contractAddress: string,
    symbol: string,
    decimals: number,
  ): Promise<string> {
    const addr = contractAddress.toLowerCase();

    // Try to find existing token first (avoids touching the expression unique index)
    const existing = await this.deps.pool.query<{ id: string }>(
      `SELECT id FROM tokens WHERE network = $1 AND lower(contract_address) = lower($2)`,
      [network, addr],
    );
    if (existing.rows[0]) {
      return existing.rows[0].id;
    }

    // Insert; if a concurrent insert races us, do nothing and re-select
    const result = await this.deps.pool.query<{ id: string }>(
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
    const retry = await this.deps.pool.query<{ id: string }>(
      `SELECT id FROM tokens WHERE network = $1 AND lower(contract_address) = lower($2)`,
      [network, addr],
    );
    const retryRow = retry.rows[0];
    if (!retryRow) {
      throw new Error(
        `[OnChainSyncService] token row must exist after ON CONFLICT: ${network}/${addr}`,
      );
    }
    return retryRow.id;
  }

  // ─── Private: persistOneTransaction ──────────────────────────────────────

  private async persistOneTransaction(
    walletId: string,
    tokenId: string,
    runId: string,
    buffer: Map<string, PositionState>,
    tx: DecomposedTransaction,
    priceUsd: string | null,
    costSource: "MARKET" | "INHERITED" | "MANUAL" | null,
  ): Promise<{ inserted: boolean }> {
    // Build engine input — buffer state takes precedence via apply()
    const positionIdentity: ProcessTransactionInput["positionIdentity"] = {
      id: crypto.randomUUID(),
      walletId,
      tokenId,
    };

    const input: ProcessTransactionInput = {
      position: null,
      priorClosedCycles: 0,
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
    };

    // Apply to in-memory buffer (processTransaction runs inside apply)
    try {
      apply(buffer, input);
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

    const pos = buffer.get(tokenId);
    if (!pos) {
      throw new Error(
        `[OnChainSyncService] buffer must have position for token ${tokenId} after apply`,
      );
    }

    // Upsert position BEFORE transaction — FK requires the row to exist.
    // commitSuccess will still do a final upsert of all positions.
    await this.deps.pool.query(
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
        pos.id,
        pos.walletId,
        pos.tokenId,
        pos.cycleNumber,
        pos.status,
        pos.balance,
        pos.wac,
        pos.costBasis,
        pos.realizedPnlUsd,
        pos.openedAt,
        pos.closedAt,
      ],
    );

    // Retrieve the canonical DB id — pos.id may be a generated UUID that differs
    // from the existing row when ON CONFLICT DO UPDATE fires.
    const idResult = await this.deps.pool.query<{ id: string }>(
      `SELECT id FROM positions WHERE wallet_id = $1 AND token_id = $2 AND cycle_number = $3`,
      [pos.walletId, pos.tokenId, pos.cycleNumber],
    );
    const canonicalPositionId = idResult.rows[0]?.id;
    if (!canonicalPositionId) {
      throw new Error(
        `[OnChainSyncService] position row not found after upsert for ${pos.walletId}/${pos.tokenId}/${String(pos.cycleNumber)}`,
      );
    }

    const txResult = await this.deps.pool.query<{ id: string }>(
      `INSERT INTO transactions (
        id, wallet_id, token_id, position_id, type, source,
        tx_hash, tx_log_index, related_tx_id,
        block_timestamp, amount, price_usd, cost_source, sync_run_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
      ON CONFLICT DO NOTHING
      RETURNING id`,
      [
        tx.id,
        walletId,
        tokenId,
        canonicalPositionId,
        tx.type,
        tx.source,
        tx.txHash,
        tx.txLogIndex,
        tx.relatedTxId ?? null,
        tx.blockTimestamp,
        tx.amount,
        priceUsd,
        costSource,
        runId,
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
      type: r.type as "BUY" | "SELL" | "SWAP_IN" | "SWAP_OUT" | "TRANSFER_IN" | "TRANSFER_OUT",
      txHash: r.tx_hash,
      blockTimestamp:
        r.block_timestamp instanceof Date
          ? r.block_timestamp.toISOString()
          : String(r.block_timestamp),
      amount: r.amount,
      priceUsd: r.price_usd ?? null,
      costSource: (r.cost_source as "MARKET" | "INHERITED" | "MANUAL" | null) ?? null,
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
