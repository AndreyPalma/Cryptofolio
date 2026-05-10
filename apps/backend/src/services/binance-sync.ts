// BinanceSyncService — US-008-B / US-014
// Orchestrates CEX sync: fiat, trades, converts, withdrawals, deposits from Binance REST API.

import crypto from 'node:crypto';
import type { Pool } from 'pg';
import { Decimal } from 'decimal.js';
import type { FastifyBaseLogger } from 'fastify';
import type { PriceService } from './price.js';
import type { PriceResult } from '../types/portfolio.js';
import type {
  BinanceApiClient,
  BinanceTrade,
  BinanceDeposit,
  BinanceFiatOrder,
  BinanceFiatPayment,
} from '../sync/clients/binance-api.js';
import { FiatPermissionDeniedError } from '../sync/clients/binance-api.js';
import type { BinanceSyncResult } from '../schemas/sync.js';
import type { PositionState } from '../position-engine/index.js';
import { SyncRunHelper } from './sync-run-helper.js';
import { loadInitial, apply } from './position-state-buffer.js';
import { NotFoundError } from './errors.js';
import type { TransactionType, CostSource } from '../db/types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

export const BINANCE_HISTORY_FLOOR_MS = new Date('2017-01-01T00:00:00.000Z').getTime();

export const QUOTE_ASSETS = ['USDT', 'USDC', 'BTC', 'ETH', 'BNB', 'FDUSD'] as const;

export const STABLE_ASSETS = new Set(['USDT', 'USDC', 'BUSD', 'USD', 'FDUSD', 'TUSD', 'DAI']);

export function isStablePair(base: string, quote: string): boolean {
  return STABLE_ASSETS.has(base.toUpperCase()) && STABLE_ASSETS.has(quote.toUpperCase());
}

/**
 * Determine the quote asset from a Binance symbol.
 * Order matters: check longest suffixes first to avoid misclassifying e.g. ETHBTC.
 */
export function getQuoteAsset(symbol: string): string {
  for (const suffix of ['FDUSD', 'USDT', 'USDC', 'BUSD', 'BNB', 'BTC', 'ETH']) {
    if (symbol.endsWith(suffix)) return suffix;
  }
  return symbol.slice(-3);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type SyncEmitter = (event: Record<string, unknown>) => void;

export interface BinanceSyncDeps {
  pool: Pool;
  priceService: PriceService;
  binanceClient: BinanceApiClient;
  log: FastifyBaseLogger;
}

interface PersistBinanceTxOpts {
  id?: string;
  walletId: string;
  tokenId: string;
  type: TransactionType;
  cexTradeId: bigint | null;
  cexOrderId?: string | null;
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
  syncRunId: string;
}

interface CursorUpdate { operation: string; value: string }
type DeferCursor = (op: string, ms: number) => void;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract numeric price string from PriceResult; returns '0' if price unavailable. */
function extractPrice(result: PriceResult): string {
  return 'priceUsd' in result ? result.priceUsd : '0';
}

// ─── BinanceSyncService ───────────────────────────────────────────────────────

export class BinanceSyncService {
  constructor(private readonly deps: BinanceSyncDeps) {}

  // ─── Public entry point ────────────────────────────────────────────────────

  async sync(
    walletId: string,
    userId: string,
    opts?: { emit?: SyncEmitter; signal?: AbortSignal },
  ): Promise<BinanceSyncResult> {
    const walletResult = await this.deps.pool.query<{
      id: string;
      wallet_type: 'ON_CHAIN' | 'CEX';
    }>(
      'SELECT id, wallet_type FROM wallets WHERE id=$1 AND user_id=$2',
      [walletId, userId],
    );

    const wallet = walletResult.rows[0];
    if (!wallet) throw new NotFoundError('Wallet not found', 'WALLET_NOT_FOUND');
    if (wallet.wallet_type !== 'CEX') {
      throw new Error('[BinanceSyncService] invariant: expected CEX wallet');
    }

    this.deps.binanceClient.assertConfigured();

    const log = this.deps.log;
    log.info({ walletId }, '[BinanceSync] starting sync');
    const syncStart = Date.now();

    const syncRunHelper = new SyncRunHelper(this.deps.pool);
    const { runId } = await syncRunHelper.start(walletId, 'CEX');
    const buffer = await loadInitial(this.deps.pool, walletId);

    const cursorUpdates: CursorUpdate[] = [];
    const deferCursor: DeferCursor = (op, ms) => {
      cursorUpdates.push({ operation: op, value: new Date(ms).toISOString() });
    };

    let tokensCreated = 0;
    const onTokenCreated = (n: number): void => { tokensCreated += n; };

    try {
      log.info({ walletId }, '[BinanceSync] step 1/5 — fiat');
      const fiatResult = await this.syncFiat(walletId, runId, buffer, deferCursor, onTokenCreated, opts);
      this.checkAborted(opts?.signal);

      log.info({ walletId }, '[BinanceSync] step 2/5 — deposits');
      const deposits = await this.syncDeposits(walletId, runId, buffer, deferCursor, onTokenCreated, opts);
      this.checkAborted(opts?.signal);

      log.info({ walletId }, '[BinanceSync] step 3/5 — withdrawals');
      const withdrawals = await this.syncWithdrawals(walletId, runId, buffer, deferCursor, onTokenCreated, opts);
      this.checkAborted(opts?.signal);

      log.info({ walletId }, '[BinanceSync] step 4/5 — converts');
      const converts = await this.syncConvert(walletId, runId, buffer, deferCursor, onTokenCreated, opts);
      this.checkAborted(opts?.signal);

      log.info({ walletId }, '[BinanceSync] step 5/5 — trades');
      const trades = await this.syncTrades(walletId, runId, buffer, deferCursor, onTokenCreated, opts);

      const totalPersisted =
        fiatResult + deposits.synced + withdrawals.synced + converts.synced + trades.synced;
      syncRunHelper.recordTxsPersisted(runId, totalPersisted);

      await syncRunHelper.commitSuccess(runId, { positions: buffer, cursorUpdates });

      try {
        await this.deps.pool.query('UPDATE wallets SET last_synced_at = now() WHERE id = $1', [walletId]);
      } catch (err) {
        log.error({ walletId, err }, '[BinanceSync] failed to update last_synced_at — best-effort');
      }

      const durationMs = Date.now() - syncStart;
      log.info({ walletId, durationMs, tokensCreated }, '[BinanceSync] sync complete');

      return { trades, converts, withdrawals, deposits, fiat: fiatResult, tokensCreated };
    } catch (err) {
      await syncRunHelper.rollback(runId).catch(() => undefined);
      throw err;
    }
  }

  // ─── Private: checkAborted ────────────────────────────────────────────────

  private checkAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new Error('ABORTED');
  }

  // ─── Private: applyToBuffer ───────────────────────────────────────────────

  private applyToBuffer(
    buffer: Map<string, PositionState>,
    walletId: string,
    tokenId: string,
    type: TransactionType,
    amount: string,
    priceUsd: string | null,
    costSource: CostSource,
    blockTimestamp: Date,
  ): void {
    try {
      apply(buffer, {
        position: buffer.get(tokenId) ?? null,
        priorClosedCycles: 0,
        transaction: { type, amount, priceUsd, costSource, source: 'BINANCE', blockTimestamp },
        positionIdentity: buffer.has(tokenId)
          ? undefined
          : { id: crypto.randomUUID(), walletId, tokenId },
      });
    } catch {
      // swallow engine errors — buffer is best-effort; positions persisted via commitSuccess
    }
  }

  // ─── Private: getCursorFromPool ───────────────────────────────────────────

  private async getCursorFromPool(walletId: string, operation: string): Promise<number | null> {
    const r = await this.deps.pool.query<{ last_value: string }>(
      'SELECT last_value FROM wallet_sync_cursors WHERE wallet_id=$1 AND operation=$2',
      [walletId, operation],
    );
    if (!r.rows[0]) return null;
    return Date.parse(r.rows[0].last_value);
  }

  // ─── Private: ensureTokenCexFromPool ─────────────────────────────────────

  private async ensureTokenCexFromPool(
    symbol: string,
    binanceSymbol: string,
    onCreated: (n: number) => void,
  ): Promise<string> {
    const existing = await this.deps.pool.query<{ id: string }>(
      `SELECT id FROM tokens WHERE network = 'CEX_BINANCE' AND lower(symbol) = lower($1) LIMIT 1`,
      [symbol],
    );
    if (existing.rows[0]) return existing.rows[0].id;

    const inserted = await this.deps.pool.query<{ id: string }>(
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

    const retry = await this.deps.pool.query<{ id: string }>(
      `SELECT id FROM tokens WHERE network = 'CEX_BINANCE' AND lower(symbol) = lower($1) LIMIT 1`,
      [symbol],
    );
    const retryRow = retry.rows[0];
    if (!retryRow) {
      throw new Error(`[BinanceSyncService] token row must exist after ON CONFLICT: ${symbol}`);
    }
    return retryRow.id;
  }

  // ─── Private: persistBinanceTxAtomic ─────────────────────────────────────

  private async persistBinanceTxAtomic(
    opts: PersistBinanceTxOpts,
  ): Promise<{ inserted: boolean; id: string }> {
    const txId = opts.id ?? crypto.randomUUID();

    let txResult: { rowCount: number | null };
    try {
      txResult = await this.deps.pool.query(
        `INSERT INTO transactions (
          id, wallet_id, token_id, type, source,
          cex_trade_id, cex_order_id, tx_log_index, related_tx_id, tx_hash,
          amount, price_usd, cost_source,
          from_address, to_address,
          commission_asset, commission_amount,
          block_timestamp, sync_run_id, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,now())
        ON CONFLICT DO NOTHING`,
        [
          txId,
          opts.walletId,
          opts.tokenId,
          opts.type,
          'BINANCE',
          opts.cexTradeId ?? null,
          opts.cexOrderId ?? null,
          opts.txLogIndex,
          opts.relatedTxId ?? null,
          opts.txHash ?? null,
          opts.amount,
          opts.priceUsd,
          opts.costSource,
          opts.fromAddress ?? null,
          opts.toAddress ?? null,
          opts.commissionAsset ?? null,
          opts.commissionAmount ?? null,
          opts.cexTimestamp,
          opts.syncRunId,
        ],
      );
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === '22003'
      ) {
        return { inserted: false, id: txId };
      }
      throw err;
    }

    const inserted = (txResult.rowCount ?? 0) > 0;
    return { inserted, id: txId };
  }

  // ─── Private: computeTradePrice ──────────────────────────────────────────

  async computeTradePrice(trade: BinanceTrade): Promise<string> {
    const quoteAsset = getQuoteAsset(trade.symbol);

    if (STABLE_ASSETS.has(quoteAsset.toUpperCase())) {
      return new Decimal(trade.quoteQty).div(new Decimal(trade.qty)).toFixed(8);
    }

    const priceResult = await this.deps.priceService.getCexPrice(quoteAsset);
    const quotePriceUsd = extractPrice(priceResult);
    return new Decimal(quotePriceUsd)
      .mul(new Decimal(trade.quoteQty))
      .div(new Decimal(trade.qty))
      .toFixed(8);
  }

  // ─── Private: resolveDepositCost ─────────────────────────────────────────

  async resolveDepositCost(
    deposit: BinanceDeposit,
    tokenId: string,
  ): Promise<{ priceUsd: string; costSource: 'INHERITED' | 'MARKET' }> {
    const r = await this.deps.pool.query<{ wac: string }>(
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

    const priceResult = await this.deps.priceService.getCexPrice(deposit.coin);
    return { priceUsd: extractPrice(priceResult), costSource: 'MARKET' };
  }

  // ─── Private: discoverAssets ─────────────────────────────────────────────

  private async discoverAssets(walletId: string): Promise<string[]> {
    const result = await this.deps.pool.query<{ symbol: string }>(
      `SELECT DISTINCT t.symbol
       FROM transactions tx
       JOIN tokens t ON t.id = tx.token_id
       WHERE tx.wallet_id = $1
         AND tx.source = 'BINANCE'
         AND t.network = 'CEX_BINANCE'`,
      [walletId],
    );

    const assetSet = new Set<string>();
    for (const row of result.rows) {
      const sym = row.symbol.toUpperCase();
      if (!STABLE_ASSETS.has(sym)) assetSet.add(sym);
    }
    return Array.from(assetSet);
  }

  // ─── Private: syncFiat ────────────────────────────────────────────────────

  private async syncFiat(
    walletId: string,
    runId: string,
    buffer: Map<string, PositionState>,
    deferCursor: DeferCursor,
    onTokenCreated: (n: number) => void,
    opts?: { emit?: SyncEmitter; signal?: AbortSignal },
  ): Promise<number> {
    const emit = opts?.emit;
    const signal = opts?.signal;
    emit?.({ step: 'fiat', status: 'running' });

    let total = 0;

    // ── Orders ────────────────────────────────────────────────────────────────
    const ordersOp = 'fiat:orders';
    const now = Date.now();
    let ordersStart = (await this.getCursorFromPool(walletId, ordersOp)) ?? BINANCE_HISTORY_FLOOR_MS;

    try {
      while (ordersStart < now) {
        this.checkAborted(signal);
        const endTime = Math.min(ordersStart + 90 * 24 * 60 * 60 * 1000, now);
        const [buys, sells] = await Promise.all([
          this.deps.binanceClient.getFiatOrders({ beginTime: ordersStart, endTime, transactionType: 0, signal }),
          this.deps.binanceClient.getFiatOrders({ beginTime: ordersStart, endTime, transactionType: 1, signal }),
        ]);
        for (const order of buys) {
          total += await this.persistFiatTx(walletId, 'FIAT_IN', order, runId, buffer, onTokenCreated);
        }
        for (const order of sells) {
          total += await this.persistFiatTx(walletId, 'FIAT_OUT', order, runId, buffer, onTokenCreated);
        }
        ordersStart = endTime;
      }
      deferCursor(ordersOp, Date.now());
    } catch (err) {
      if (err instanceof FiatPermissionDeniedError) {
        this.deps.log.info({ walletId }, '[BinanceSync/fiat] orders permission denied — skipping');
        emit?.({
          step: 'fiat',
          status: 'skipped',
          reason: 'Tu API key no tiene permisos para historial fiat',
        });
        return 0;
      }
      throw err;
    }

    // ── Payments ──────────────────────────────────────────────────────────────
    const paymentsOp = 'fiat:payments';
    const now2 = Date.now();
    let paymentsStart = (await this.getCursorFromPool(walletId, paymentsOp)) ?? BINANCE_HISTORY_FLOOR_MS;

    try {
      while (paymentsStart < now2) {
        this.checkAborted(signal);
        const endTime = Math.min(paymentsStart + 90 * 24 * 60 * 60 * 1000, now2);
        const [buys, sells] = await Promise.all([
          this.deps.binanceClient.getFiatPayments({ beginTime: paymentsStart, endTime, transactionType: 0, signal }),
          this.deps.binanceClient.getFiatPayments({ beginTime: paymentsStart, endTime, transactionType: 1, signal }),
        ]);
        for (const payment of buys) {
          total += await this.persistFiatPaymentTx(walletId, 'FIAT_IN', payment, runId, buffer, onTokenCreated);
        }
        for (const payment of sells) {
          total += await this.persistFiatPaymentTx(walletId, 'FIAT_OUT', payment, runId, buffer, onTokenCreated);
        }
        paymentsStart = endTime;
      }
      deferCursor(paymentsOp, Date.now());
    } catch (err) {
      if (err instanceof FiatPermissionDeniedError) {
        this.deps.log.info({ walletId }, '[BinanceSync/fiat] payments permission denied — continuing with orders');
        emit?.({ step: 'fiat', status: 'done', synced: total, skipped: 0, message: 'payments skipped (permissions)' });
        return total;
      }
      throw err;
    }

    emit?.({ step: 'fiat', status: 'done', synced: total, skipped: 0 });
    return total;
  }

  // ─── Private: persistFiatTx ───────────────────────────────────────────────

  private async persistFiatTx(
    walletId: string,
    type: 'FIAT_IN' | 'FIAT_OUT',
    order: BinanceFiatOrder,
    runId: string,
    buffer: Map<string, PositionState>,
    onTokenCreated: (n: number) => void,
  ): Promise<number> {
    const tokenId = await this.ensureTokenCexFromPool(
      order.cryptoCurrency,
      order.cryptoCurrency,
      onTokenCreated,
    );
    const ts = new Date(order.createTime);
    const result = await this.persistBinanceTxAtomic({
      walletId,
      tokenId,
      type,
      cexTradeId: null,
      cexOrderId: order.orderNo,
      txLogIndex: 0,
      amount: order.obtainAmount,
      priceUsd: order.price,
      costSource: 'MARKET',
      cexTimestamp: ts,
      syncRunId: runId,
    });
    if (result.inserted) {
      this.applyToBuffer(buffer, walletId, tokenId, type, order.obtainAmount, order.price, 'MARKET', ts);
      return 1;
    }
    return 0;
  }

  // ─── Private: persistFiatPaymentTx ───────────────────────────────────────

  private async persistFiatPaymentTx(
    walletId: string,
    type: 'FIAT_IN' | 'FIAT_OUT',
    payment: BinanceFiatPayment,
    runId: string,
    buffer: Map<string, PositionState>,
    onTokenCreated: (n: number) => void,
  ): Promise<number> {
    const tokenId = await this.ensureTokenCexFromPool(
      payment.cryptoCurrency,
      payment.cryptoCurrency,
      onTokenCreated,
    );

    let priceUsd: string | null;
    let costSource: CostSource;

    if (payment.fiatCurrency.toUpperCase() === 'USD') {
      priceUsd = new Decimal(payment.sourceAmount).div(new Decimal(payment.obtainAmount)).toFixed(8);
      costSource = 'MARKET';
    } else {
      const rate = await this.deps.priceService.getFiatToUsdAt(payment.fiatCurrency, payment.createTime);
      if (rate) {
        priceUsd = new Decimal(rate)
          .mul(new Decimal(payment.sourceAmount))
          .div(new Decimal(payment.obtainAmount))
          .toFixed(8);
        costSource = 'MARKET';
      } else {
        priceUsd = null;
        costSource = 'MANUAL';
      }
    }

    const ts = new Date(payment.createTime);
    const result = await this.persistBinanceTxAtomic({
      walletId,
      tokenId,
      type,
      cexTradeId: null,
      cexOrderId: payment.orderNo,
      txLogIndex: 0,
      amount: payment.obtainAmount,
      priceUsd: priceUsd ?? '0',
      costSource,
      cexTimestamp: ts,
      syncRunId: runId,
    });

    if (result.inserted && priceUsd !== null) {
      this.applyToBuffer(buffer, walletId, tokenId, type, payment.obtainAmount, priceUsd, costSource, ts);
    }

    return result.inserted ? 1 : 0;
  }

  // ─── Private: syncTrades ──────────────────────────────────────────────────

  private async syncTrades(
    walletId: string,
    runId: string,
    buffer: Map<string, PositionState>,
    deferCursor: DeferCursor,
    onTokenCreated: (n: number) => void,
    opts?: { emit?: SyncEmitter; signal?: AbortSignal },
  ): Promise<{ synced: number; skipped: number; symbolsProcessed: number }> {
    const emit = opts?.emit;
    const signal = opts?.signal;
    emit?.({ step: 'trades', status: 'running' });

    let synced = 0;
    let skipped = 0;
    let symbolsProcessed = 0;

    const [assets, validSymbols] = await Promise.all([
      this.discoverAssets(walletId),
      this.deps.binanceClient.getValidTradingSymbols(signal),
    ]);

    const log = this.deps.log;
    const candidates: string[] = [];
    for (const asset of assets) {
      for (const quote of QUOTE_ASSETS) {
        if (asset === quote) continue;
        if (isStablePair(asset, quote)) continue;
        const symbol = `${asset}${quote}`;
        if (validSymbols.has(symbol)) candidates.push(symbol);
      }
    }
    log.info({ walletId, assets: assets.length, candidates: candidates.length }, '[BinanceSync/trades] symbol plan');

    for (const asset of assets) {
      for (const quote of QUOTE_ASSETS) {
        if (asset === quote) continue;
        if (isStablePair(asset, quote)) continue;
        const symbol = `${asset}${quote}`;
        if (!validSymbols.has(symbol)) continue;

        this.checkAborted(signal);

        const cursorKey = `trades:${symbol}`;
        const now = Date.now();
        let startTime = (await this.getCursorFromPool(walletId, cursorKey)) ?? BINANCE_HISTORY_FLOOR_MS;

        while (startTime < now) {
          this.checkAborted(signal);
          const endTime = Math.min(startTime + 24 * 60 * 60 * 1000, now);
          const trades = await this.deps.binanceClient.getMyTrades(symbol, startTime, endTime, signal);
          if (trades === null) {
            log.warn({ walletId, symbol }, '[BinanceSync/trades] symbol rejected by exchange — skipping');
            break;
          }

          for (const trade of trades) {
            const tokenId = await this.ensureTokenCexFromPool(asset, asset, onTokenCreated);
            const type: TransactionType = trade.isBuyer ? 'BUY' : 'SELL';
            const priceUsd = await this.computeTradePrice(trade);
            const ts = new Date(trade.time);

            const result = await this.persistBinanceTxAtomic({
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
              cexTimestamp: ts,
              syncRunId: runId,
            });

            if (result.inserted) {
              synced++;
              this.applyToBuffer(buffer, walletId, tokenId, type, trade.qty, priceUsd, 'MARKET', ts);
            } else {
              skipped++;
            }
          }

          startTime = endTime;
        }

        deferCursor(cursorKey, Date.now());
        symbolsProcessed++;
      }
    }

    emit?.({ step: 'trades', status: 'done', synced, skipped, symbolsProcessed });
    return { synced, skipped, symbolsProcessed };
  }

  // ─── Private: syncConvert ────────────────────────────────────────────────

  private async syncConvert(
    walletId: string,
    runId: string,
    buffer: Map<string, PositionState>,
    deferCursor: DeferCursor,
    onTokenCreated: (n: number) => void,
    opts?: { emit?: SyncEmitter; signal?: AbortSignal },
  ): Promise<{ synced: number; skipped: number }> {
    const emit = opts?.emit;
    const signal = opts?.signal;
    emit?.({ step: 'converts', status: 'running' });

    let synced = 0;
    let skipped = 0;

    const now = Date.now();
    let startTime = (await this.getCursorFromPool(walletId, 'converts')) ?? BINANCE_HISTORY_FLOOR_MS;

    while (startTime < now) {
      this.checkAborted(signal);
      const endTime = Math.min(startTime + 30 * 24 * 60 * 60 * 1000, now);
      const converts = await this.deps.binanceClient.getConvertHistory(startTime, endTime, signal);

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

        const fromTokenId = await this.ensureTokenCexFromPool(
          convert.fromAsset, convert.fromAsset, onTokenCreated,
        );
        const toTokenId = await this.ensureTokenCexFromPool(
          convert.toAsset, convert.toAsset, onTokenCreated,
        );

        const fromIsStable = STABLE_ASSETS.has(convert.fromAsset.toUpperCase());
        const fromPriceUsd = fromIsStable
          ? '1.0'
          : extractPrice(await this.deps.priceService.getCexPrice(convert.fromAsset));

        const fromTotalUsd = new Decimal(fromPriceUsd).mul(new Decimal(convert.fromAmount));
        const toPriceUsd = fromTotalUsd.div(new Decimal(convert.toAmount)).toFixed(8);
        const ts = new Date(convert.createTime);

        const outResult = await this.persistBinanceTxAtomic({
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
          cexTimestamp: ts,
          syncRunId: runId,
        });

        if (!outResult.inserted) {
          skipped += 2;
          continue;
        }

        this.applyToBuffer(buffer, walletId, fromTokenId, 'SWAP_OUT', convert.fromAmount, fromPriceUsd, 'MARKET', ts);

        const inResult = await this.persistBinanceTxAtomic({
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
          cexTimestamp: ts,
          syncRunId: runId,
        });

        this.applyToBuffer(buffer, walletId, toTokenId, 'SWAP_IN', convert.toAmount, toPriceUsd, 'MARKET', ts);

        synced += 1 + (inResult.inserted ? 1 : 0);
        skipped += inResult.inserted ? 0 : 1;
      }

      startTime = endTime;
    }

    deferCursor('converts', Date.now());
    emit?.({ step: 'converts', status: 'done', synced, skipped });
    return { synced, skipped };
  }

  // ─── Private: syncWithdrawals ─────────────────────────────────────────────

  private async syncWithdrawals(
    walletId: string,
    runId: string,
    buffer: Map<string, PositionState>,
    deferCursor: DeferCursor,
    onTokenCreated: (n: number) => void,
    opts?: { emit?: SyncEmitter; signal?: AbortSignal },
  ): Promise<{ synced: number; skipped: number }> {
    const emit = opts?.emit;
    const signal = opts?.signal;
    emit?.({ step: 'withdrawals', status: 'running' });

    let synced = 0;
    let skipped = 0;

    const now = Date.now();
    let startTime = (await this.getCursorFromPool(walletId, 'withdrawals')) ?? BINANCE_HISTORY_FLOOR_MS;

    while (startTime < now) {
      this.checkAborted(signal);
      const endTime = Math.min(startTime + 90 * 24 * 60 * 60 * 1000, now);
      const withdrawals = await this.deps.binanceClient.getWithdrawHistory(startTime, endTime, signal);

      for (const withdrawal of withdrawals) {
        let withdrawalIdBigInt: bigint;
        try {
          withdrawalIdBigInt = BigInt(withdrawal.id);
        } catch {
          skipped++;
          continue;
        }

        const tokenId = await this.ensureTokenCexFromPool(
          withdrawal.coin, withdrawal.coin, onTokenCreated,
        );

    const openPos = buffer.get(tokenId);
    const priceUsd = openPos?.status === 'OPEN' ? openPos.wac : '0';
        const ts = new Date(withdrawal.applyTime);

        const result = await this.persistBinanceTxAtomic({
          walletId,
          tokenId,
          type: 'TRANSFER_OUT',
          cexTradeId: withdrawalIdBigInt,
          txLogIndex: 0,
          txHash: withdrawal.txId,
          amount: withdrawal.amount,
          priceUsd,
          costSource: 'INHERITED',
          toAddress: withdrawal.address,
          cexTimestamp: ts,
          syncRunId: runId,
        });

        if (result.inserted) {
          synced++;
          this.applyToBuffer(buffer, walletId, tokenId, 'TRANSFER_OUT', withdrawal.amount, priceUsd, 'INHERITED', ts);
        } else {
          skipped++;
        }
      }

      startTime = endTime;
    }

    deferCursor('withdrawals', Date.now());
    emit?.({ step: 'withdrawals', status: 'done', synced, skipped });
    return { synced, skipped };
  }

  // ─── Private: syncDeposits ────────────────────────────────────────────────

  private async syncDeposits(
    walletId: string,
    runId: string,
    buffer: Map<string, PositionState>,
    deferCursor: DeferCursor,
    onTokenCreated: (n: number) => void,
    opts?: { emit?: SyncEmitter; signal?: AbortSignal },
  ): Promise<{ synced: number; skipped: number; inherited: number; manual: number }> {
    const emit = opts?.emit;
    const signal = opts?.signal;
    emit?.({ step: 'deposits', status: 'running' });

    let synced = 0;
    let skipped = 0;
    let inherited = 0;
    let manual = 0;

    const now = Date.now();
    let startTime = (await this.getCursorFromPool(walletId, 'deposits')) ?? BINANCE_HISTORY_FLOOR_MS;

    while (startTime < now) {
      this.checkAborted(signal);
      const endTime = Math.min(startTime + 90 * 24 * 60 * 60 * 1000, now);
      const deposits = await this.deps.binanceClient.getDepositHistory(startTime, endTime, signal);

      for (const deposit of deposits) {
        const tokenId = await this.ensureTokenCexFromPool(deposit.coin, deposit.coin, onTokenCreated);

        const existing = await this.deps.pool.query<{ id: string }>(
          `SELECT id FROM transactions
           WHERE wallet_id=$1 AND type='TRANSFER_IN' AND source='BINANCE' AND tx_hash=$2
           LIMIT 1`,
          [walletId, deposit.txId],
        );

        if (existing.rows[0]) {
          skipped++;
          continue;
        }

        const resolution = await this.resolveDepositCost(deposit, tokenId);
        const ts = new Date(deposit.insertTime);

        const result = await this.persistBinanceTxAtomic({
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
          cexTimestamp: ts,
          syncRunId: runId,
        });

        if (result.inserted) {
          synced++;
          if (resolution.costSource === 'INHERITED') inherited++;
          else manual++;
          this.applyToBuffer(
            buffer, walletId, tokenId, 'TRANSFER_IN',
            deposit.amount, resolution.priceUsd, resolution.costSource, ts,
          );
        } else {
          skipped++;
        }
      }

      startTime = endTime;
    }

    deferCursor('deposits', Date.now());
    emit?.({ step: 'deposits', status: 'done', synced, skipped, inherited, manual });
    return { synced, skipped, inherited, manual };
  }
}
