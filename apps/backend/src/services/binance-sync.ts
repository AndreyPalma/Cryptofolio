// BinanceSyncService — US-008-B
// Orchestrates CEX sync: trades, converts, withdrawals, deposits from Binance REST API.
// Mirror of OnChainSyncService for the CEX branch.

import crypto from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { Decimal } from 'decimal.js';
import type { PriceService } from './price.js';
import type { PriceResult } from '../types/portfolio.js';
import type { BinanceApiClient, BinanceTrade, BinanceDeposit, BinanceWithdrawal } from '../sync/clients/binance-api.js';
import type { BinanceSyncResult } from '../schemas/sync.js';
import type { PositionState } from '../position-engine/index.js';
import { processTransaction } from '../position-engine/index.js';
import {
  InvalidTransactionError,
  InsufficientBalanceError,
  InvalidPositionStateError,
} from '../position-engine/index.js';
import { NotFoundError } from './errors.js';
import type { TransactionType, CostSource } from '../db/types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type BinanceSyncDeps = {
  pool: Pool;
  priceService: PriceService;
  binanceClient: BinanceApiClient;
};

type PersistBinanceTxOpts = {
  id?: string;
  walletId: string;
  tokenId: string;
  type: TransactionType;
  cexTradeId: bigint | null;
  txLogIndex: number;
  relatedTxId?: string | null;
  txHash?: string | null;
  amount: string;
  priceUsd: string;
  costSource: CostSource;
  fromAddress?: string | null;
  toAddress?: string | null;
  commissionAsset?: string | null;
  commissionAmount?: string | null;
  cexTimestamp: Date;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract numeric price string from PriceResult; returns '0' if price unavailable. */
function extractPrice(result: PriceResult): string {
  return 'priceUsd' in result ? result.priceUsd : '0';
}

const STABLE_ASSETS = new Set(['USDT', 'USDC', 'BUSD']);

function isStable(asset: string): boolean {
  return STABLE_ASSETS.has(asset.toUpperCase());
}

/**
 * Determine the quote asset from a Binance symbol.
 * Order matters: check longest suffixes first to avoid misclassifying e.g. ETHBTC as TBTC.
 */
function getQuoteAsset(symbol: string): string {
  for (const suffix of ['USDT', 'USDC', 'BUSD', 'BNB', 'BTC', 'ETH']) {
    if (symbol.endsWith(suffix)) return suffix;
  }
  // Fallback: last 3 chars
  return symbol.slice(-3);
}

// ─── BinanceSyncService ───────────────────────────────────────────────────────

export class BinanceSyncService {
  constructor(private readonly deps: BinanceSyncDeps) {}

  // ─── Public entry point ────────────────────────────────────────────────────

  async sync(walletId: string, userId: string): Promise<BinanceSyncResult> {
    // 1. Load wallet
    const walletResult = await this.deps.pool.query<{
      id: string;
      wallet_type: 'ON_CHAIN' | 'CEX';
      address: string | null;
    }>(
      'SELECT id, wallet_type, address FROM wallets WHERE id=$1 AND user_id=$2',
      [walletId, userId],
    );

    const wallet = walletResult.rows[0];
    if (!wallet) {
      throw new NotFoundError('Wallet not found', 'WALLET_NOT_FOUND');
    }

    if (wallet.wallet_type !== 'CEX') {
      throw new Error('[BinanceSyncService] invariant: expected CEX wallet');
    }

    // 2. Validate API keys before acquiring DB connection
    this.deps.binanceClient.assertConfigured();

    // 3. Acquire pool client and run all sub-methods
    let tokensCreated = 0;
    const pgc = await this.deps.pool.connect();
    try {
      const tradesResult = await this.syncTrades(pgc, walletId, (n) => { tokensCreated += n; });
      const convertsResult = await this.syncConvert(pgc, walletId, (n) => { tokensCreated += n; });
      const withdrawalsResult = await this.syncWithdrawals(pgc, walletId, (n) => { tokensCreated += n; });
      const depositsResult = await this.syncDeposits(pgc, walletId, (n) => { tokensCreated += n; });

      // Best-effort: update last_synced_at. If this fails, sync data is already persisted — do not propagate.
      try {
        await pgc.query('UPDATE wallets SET last_synced_at = now() WHERE id = $1', [walletId]);
      } catch (err) {
        // eslint-disable-next-line no-console -- logger not injected at this level; best-effort only
        console.error('[BinanceSyncService] Failed to update last_synced_at after sync — best-effort', err);
      }

      return {
        trades: tradesResult,
        converts: convertsResult,
        withdrawals: withdrawalsResult,
        deposits: depositsResult,
        tokensCreated,
      };
    } finally {
      pgc.release();
    }
  }

  // ─── Private: getCursor ────────────────────────────────────────────────────

  private async getCursor(pgc: PoolClient, walletId: string, operation: string): Promise<number | null> {
    const r = await pgc.query<{ last_value: string }>(
      'SELECT last_value FROM wallet_sync_cursors WHERE wallet_id=$1 AND operation=$2',
      [walletId, operation],
    );
    if (!r.rows[0]) return null;
    return Date.parse(r.rows[0].last_value);
  }

  // ─── Private: setCursor ────────────────────────────────────────────────────

  private async setCursor(pgc: PoolClient, walletId: string, operation: string, valueMs: number): Promise<void> {
    await pgc.query(
      `INSERT INTO wallet_sync_cursors (wallet_id, operation, last_value, last_synced_at)
       VALUES ($1, $2, to_timestamp($3 / 1000.0)::text, now())
       ON CONFLICT (wallet_id, operation)
       DO UPDATE SET last_value = EXCLUDED.last_value, last_synced_at = EXCLUDED.last_synced_at`,
      [walletId, operation, valueMs],
    );
  }

  // ─── Private: ensureTokenCex ──────────────────────────────────────────────

  private async ensureTokenCex(
    pgc: PoolClient,
    symbol: string,
    binanceSymbol: string,
    onCreated: (n: number) => void,
  ): Promise<string> {
    // Step 1: optimistic SELECT (tokens_unique_cex index: network + lower(symbol))
    const existing = await pgc.query<{ id: string }>(
      `SELECT id FROM tokens WHERE network = 'CEX_BINANCE' AND lower(symbol) = lower($1) LIMIT 1`,
      [symbol],
    );
    if (existing.rows[0]) return existing.rows[0].id;

    // Step 2: INSERT ON CONFLICT DO NOTHING
    // contract_address must be NULL for CEX_BINANCE (tokens_source_coherence constraint)
    const inserted = await pgc.query<{ id: string }>(
      `INSERT INTO tokens (symbol, network, decimals, binance_symbol)
       VALUES ($1, 'CEX_BINANCE', 8, $2)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [symbol, binanceSymbol],
    );
    if (inserted.rows[0]) {
      onCreated(1);
      return inserted.rows[0].id;
    }

    // Step 3: re-SELECT (race condition — another worker inserted first)
    const retry = await pgc.query<{ id: string }>(
      `SELECT id FROM tokens WHERE network = 'CEX_BINANCE' AND lower(symbol) = lower($1) LIMIT 1`,
      [symbol],
    );
    return retry.rows[0]!.id;
  }

  // ─── Private: persistBinanceTx ────────────────────────────────────────────

  private async persistBinanceTx(
    pgc: PoolClient,
    opts: PersistBinanceTxOpts,
  ): Promise<{ inserted: boolean; id: string | null }> {
    const txId = opts.id ?? crypto.randomUUID();

    // 1. Load OPEN position FOR UPDATE
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
       WHERE wallet_id=$1 AND token_id=$2 AND status='OPEN'
       ORDER BY cycle_number DESC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [opts.walletId, opts.tokenId],
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

    // 2. Count closed cycles
    const closedResult = await pgc.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM positions WHERE wallet_id=$1 AND token_id=$2 AND status='CLOSED'`,
      [opts.walletId, opts.tokenId],
    );
    const priorClosedCycles = closedResult.rows[0]?.count ?? 0;

    const positionIdentity =
      openPosition === null
        ? { id: crypto.randomUUID(), walletId: opts.walletId, tokenId: opts.tokenId }
        : undefined;

    // 3. Call position engine
    let engineResult;
    try {
      engineResult = processTransaction({
        position: openPosition,
        priorClosedCycles,
        transaction: {
          type: opts.type,
          amount: opts.amount,
          priceUsd: opts.priceUsd,
          costSource: opts.costSource,
          source: 'BINANCE',
          blockTimestamp: opts.cexTimestamp,
          relatedTxId: opts.relatedTxId ?? undefined,
        },
        positionIdentity,
      });
    } catch (err) {
      if (
        err instanceof InvalidTransactionError ||
        err instanceof InsufficientBalanceError ||
        err instanceof InvalidPositionStateError
      ) {
        return { inserted: false, id: null };
      }
      throw err;
    }

    const pos = engineResult.position;

    // 4. UPSERT position
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

    // 5. INSERT transaction ON CONFLICT DO NOTHING
    let txResult: { rowCount: number | null; rows: Array<{ id: string }> };
    try {
      txResult = await pgc.query<{ id: string }>(
        `INSERT INTO transactions (
          id, wallet_id, token_id, position_id,
          source, type, amount, price_usd, cost_source,
          cex_trade_id, tx_log_index, tx_hash, related_tx_id,
          from_address, to_address,
          commission_asset, commission_amount,
          block_timestamp, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, now())
        ON CONFLICT DO NOTHING
        RETURNING id`,
        [
          txId,
          opts.walletId,
          opts.tokenId,
          pos.id,
          'BINANCE',
          opts.type,
          opts.amount,
          opts.priceUsd,
          opts.costSource,
          opts.cexTradeId !== null ? opts.cexTradeId : null,
          opts.txLogIndex,
          opts.txHash ?? null,
          opts.relatedTxId ?? null,
          opts.fromAddress ?? null,
          opts.toAddress ?? null,
          opts.commissionAsset ?? null,
          opts.commissionAmount ?? null,
          opts.cexTimestamp,
        ],
      );
    } catch (err: unknown) {
      // PostgreSQL 22003: numeric_value_out_of_range (BigInt overflow in cex_trade_id)
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === '22003') {
        // Log without exposing key values
        return { inserted: false, id: null };
      }
      throw err;
    }

    const inserted = (txResult.rowCount ?? 0) === 1;
    return { inserted, id: inserted ? (txResult.rows[0]?.id ?? txId) : null };
  }

  // ─── Private: computeTradePrice ──────────────────────────────────────────

  async computeTradePrice(trade: BinanceTrade): Promise<string> {
    const quoteAsset = getQuoteAsset(trade.symbol);

    if (isStable(quoteAsset)) {
      // Exact: quoteQty / qty (both are string decimals)
      return new Decimal(trade.quoteQty).div(new Decimal(trade.qty)).toFixed(8);
    }

    // Non-stable: get current price of quoteAsset in USD and multiply
    const priceResult = await this.deps.priceService.getCexPrice(quoteAsset);
    const quotePriceUsd = extractPrice(priceResult);
    return new Decimal(quotePriceUsd)
      .mul(new Decimal(trade.quoteQty))
      .div(new Decimal(trade.qty))
      .toFixed(8);
  }

  // ─── Private: resolveDepositCost ─────────────────────────────────────────

  async resolveDepositCost(
    pgc: PoolClient,
    deposit: BinanceDeposit,
    tokenId: string,
  ): Promise<{ priceUsd: string; costSource: 'INHERITED' | 'MARKET' }> {
    // Step 1: look for matching on-chain TRANSFER_OUT
    const r = await pgc.query<{ wac: string }>(
      `SELECT p.wac
       FROM transactions t
       JOIN positions p ON p.id = t.position_id
       JOIN wallets w ON w.id = t.wallet_id
       WHERE w.wallet_type = 'ON_CHAIN'
         AND lower(w.address) = lower($1)
         AND t.type = 'TRANSFER_OUT'
         AND t.tx_hash = $2
         AND t.token_id = $3
       ORDER BY t.block_timestamp DESC
       LIMIT 1`,
      [deposit.address, deposit.txId, tokenId],
    );

    if (r.rows[0]) {
      return { priceUsd: r.rows[0].wac, costSource: 'INHERITED' };
    }

    // Step 2: market fallback
    const priceResult = await this.deps.priceService.getCexPrice(deposit.coin);
    return { priceUsd: extractPrice(priceResult), costSource: 'MARKET' };
  }

  // ─── Private: syncTrades ──────────────────────────────────────────────────

  private async syncTrades(
    pgc: PoolClient,
    walletId: string,
    onTokenCreated: (n: number) => void,
  ): Promise<{ synced: number; skipped: number; symbolsProcessed: number }> {
    let synced = 0;
    let skipped = 0;
    let symbolsProcessed = 0;

    const assets = await this.deps.binanceClient.getAccountAssets();

    for (const asset of assets) {
      const symbol = `${asset.asset}USDT`;
      const cursorKey = `trades:${symbol}`;
      const now = Date.now();
      let startTime = (await this.getCursor(pgc, walletId, cursorKey)) ?? (now - 30 * 24 * 60 * 60 * 1000);

      while (startTime < now) {
        const endTime = Math.min(startTime + 24 * 60 * 60 * 1000, now);
        const trades = await this.deps.binanceClient.getMyTrades(symbol, startTime, endTime);

        await pgc.query('BEGIN');
        try {
          for (const trade of trades) {
            const tokenId = await this.ensureTokenCex(pgc, asset.asset, asset.asset, onTokenCreated);
            const type: TransactionType = trade.isBuyer ? 'BUY' : 'SELL';
            const priceUsd = await this.computeTradePrice(trade);

            const result = await this.persistBinanceTx(pgc, {
              walletId,
              tokenId,
              type,
              cexTradeId: BigInt(trade.id),
              txLogIndex: 0,
              txHash: null,
              amount: trade.qty,
              priceUsd,
              costSource: 'MARKET',
              commissionAsset: trade.commissionAsset ?? null,
              commissionAmount: trade.commission ?? null,
              cexTimestamp: new Date(trade.time),
            });

            if (result.inserted) synced++;
            else skipped++;
          }
          await pgc.query('COMMIT');
        } catch (err) {
          await pgc.query('ROLLBACK');
          throw err;
        }

        startTime = endTime;
      }

      await this.setCursor(pgc, walletId, cursorKey, Date.now());
      symbolsProcessed++;
    }

    return { synced, skipped, symbolsProcessed };
  }

  // ─── Private: syncConvert ────────────────────────────────────────────────

  private async syncConvert(
    pgc: PoolClient,
    walletId: string,
    onTokenCreated: (n: number) => void,
  ): Promise<{ synced: number; skipped: number }> {
    let synced = 0;
    let skipped = 0;

    const now = Date.now();
    let startTime = (await this.getCursor(pgc, walletId, 'converts')) ?? (now - 30 * 24 * 60 * 60 * 1000);

    while (startTime < now) {
      const endTime = Math.min(startTime + 30 * 24 * 60 * 60 * 1000, now);
      const converts = await this.deps.binanceClient.getConvertHistory(startTime, endTime);

      await pgc.query('BEGIN');
      try {
        for (const convert of converts) {
          let orderIdBigInt: bigint;
          try {
            orderIdBigInt = BigInt(convert.orderId);
          } catch {
            skipped++;
            continue;
          }

          const swapOutId = crypto.randomUUID();
          const swapInId = crypto.randomUUID();

          const fromTokenId = await this.ensureTokenCex(pgc, convert.fromAsset, convert.fromAsset, onTokenCreated);
          const toTokenId = await this.ensureTokenCex(pgc, convert.toAsset, convert.toAsset, onTokenCreated);

          const fromPriceUsd = isStable(convert.fromAsset)
            ? '1.0'
            : extractPrice(await this.deps.priceService.getCexPrice(convert.fromAsset));

          const fromTotalUsd = new Decimal(fromPriceUsd).mul(new Decimal(convert.fromAmount));
          const toPriceUsd = fromTotalUsd.div(new Decimal(convert.toAmount)).toFixed(8);

          // SWAP_OUT (tx_log_index=0)
          const outResult = await this.persistBinanceTx(pgc, {
            id: swapOutId,
            walletId,
            tokenId: fromTokenId,
            type: 'SWAP_OUT',
            cexTradeId: orderIdBigInt,
            txLogIndex: 0,
            relatedTxId: swapInId,
            txHash: null,
            amount: convert.fromAmount,
            priceUsd: fromPriceUsd,
            costSource: 'MARKET',
            cexTimestamp: new Date(convert.createTime),
          });

          if (!outResult.inserted) {
            // Already synced — skip SWAP_IN as well
            skipped += 2;
            continue;
          }

          // SWAP_IN (tx_log_index=1)
          const inResult = await this.persistBinanceTx(pgc, {
            id: swapInId,
            walletId,
            tokenId: toTokenId,
            type: 'SWAP_IN',
            cexTradeId: orderIdBigInt,
            txLogIndex: 1,
            relatedTxId: swapOutId,
            txHash: null,
            amount: convert.toAmount,
            priceUsd: toPriceUsd,
            costSource: 'MARKET',
            cexTimestamp: new Date(convert.createTime),
          });

          synced += (outResult.inserted ? 1 : 0) + (inResult.inserted ? 1 : 0);
          skipped += (!outResult.inserted ? 1 : 0) + (!inResult.inserted ? 1 : 0);
        }
        await pgc.query('COMMIT');
      } catch (err) {
        await pgc.query('ROLLBACK');
        throw err;
      }

      startTime = endTime;
    }

    await this.setCursor(pgc, walletId, 'converts', Date.now());
    return { synced, skipped };
  }

  // ─── Private: syncWithdrawals ─────────────────────────────────────────────

  private async syncWithdrawals(
    pgc: PoolClient,
    walletId: string,
    onTokenCreated: (n: number) => void,
  ): Promise<{ synced: number; skipped: number }> {
    let synced = 0;
    let skipped = 0;

    const now = Date.now();
    let startTime = (await this.getCursor(pgc, walletId, 'withdrawals')) ?? (now - 90 * 24 * 60 * 60 * 1000);

    while (startTime < now) {
      const endTime = Math.min(startTime + 90 * 24 * 60 * 60 * 1000, now);
      const withdrawals = await this.deps.binanceClient.getWithdrawHistory(startTime, endTime);

      await pgc.query('BEGIN');
      try {
        for (const withdrawal of withdrawals) {
          const tokenId = await this.ensureTokenCex(pgc, withdrawal.coin, withdrawal.coin, onTokenCreated);

          // Load current WAC from OPEN position
          const posRow = await pgc.query<{ wac: string }>(
            `SELECT wac FROM positions WHERE wallet_id=$1 AND token_id=$2 AND status='OPEN' LIMIT 1`,
            [walletId, tokenId],
          );
          const priceUsd = posRow.rows[0]?.wac ?? '0';

          const result = await this.persistBinanceTx(pgc, {
            walletId,
            tokenId,
            type: 'TRANSFER_OUT',
            cexTradeId: BigInt(withdrawal.id),
            txLogIndex: 0,
            txHash: withdrawal.txId,   // CRITICAL: bridge column — must not be null
            amount: withdrawal.amount,
            priceUsd,
            costSource: 'INHERITED',
            toAddress: withdrawal.address,
            cexTimestamp: new Date(withdrawal.applyTime),
          });

          if (result.inserted) synced++;
          else skipped++;
        }
        await pgc.query('COMMIT');
      } catch (err) {
        await pgc.query('ROLLBACK');
        throw err;
      }

      startTime = endTime;
    }

    await this.setCursor(pgc, walletId, 'withdrawals', Date.now());
    return { synced, skipped };
  }

  // ─── Private: syncDeposits ────────────────────────────────────────────────

  private async syncDeposits(
    pgc: PoolClient,
    walletId: string,
    onTokenCreated: (n: number) => void,
  ): Promise<{ synced: number; skipped: number; inherited: number; manual: number }> {
    let synced = 0;
    let skipped = 0;
    let inherited = 0;
    let manual = 0;

    const now = Date.now();
    let startTime = (await this.getCursor(pgc, walletId, 'deposits')) ?? (now - 90 * 24 * 60 * 60 * 1000);

    while (startTime < now) {
      const endTime = Math.min(startTime + 90 * 24 * 60 * 60 * 1000, now);
      const deposits = await this.deps.binanceClient.getDepositHistory(startTime, endTime);

      await pgc.query('BEGIN');
      try {
        for (const deposit of deposits) {
          const tokenId = await this.ensureTokenCex(pgc, deposit.coin, deposit.coin, onTokenCreated);

          // Idempotency for deposits (no cex_trade_id) — check before inserting
          const existing = await pgc.query<{ id: string }>(
            `SELECT id FROM transactions
             WHERE wallet_id=$1 AND type='TRANSFER_IN' AND source='BINANCE' AND tx_hash=$2
             LIMIT 1`,
            [walletId, deposit.txId],
          );

          if (existing.rows[0]) {
            skipped++;
            continue;
          }

          const resolution = await this.resolveDepositCost(pgc, deposit, tokenId);

          const result = await this.persistBinanceTx(pgc, {
            walletId,
            tokenId,
            type: 'TRANSFER_IN',
            cexTradeId: null,
            txLogIndex: 0,
            txHash: deposit.txId,
            amount: deposit.amount,
            priceUsd: resolution.priceUsd,
            costSource: resolution.costSource,
            fromAddress: deposit.address,
            cexTimestamp: new Date(deposit.insertTime),
          });

          if (result.inserted) {
            synced++;
            if (resolution.costSource === 'INHERITED') inherited++;
            else manual++;
          } else {
            skipped++;
          }
        }
        await pgc.query('COMMIT');
      } catch (err) {
        await pgc.query('ROLLBACK');
        throw err;
      }

      startTime = endTime;
    }

    await this.setCursor(pgc, walletId, 'deposits', Date.now());
    return { synced, skipped, inherited, manual };
  }
}
