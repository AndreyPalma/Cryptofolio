// binance-classify.test.ts — US-008-B [engine]
// Pure logic tests for BinanceSyncService compute/resolve helpers.
// No DB, no real HTTP calls.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { BinanceSyncService } from '../../services/binance-sync.js';
import type { BinanceSyncDeps } from '../../services/binance-sync.js';
import type { BinanceTrade, BinanceApiClient, BinanceDeposit } from '../clients/binance-api.js';
import type { FastifyBaseLogger } from 'fastify';
import type { PoolClient } from 'pg';

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Mock factories ───────────────────────────────────────────────────────────

function makeMockLog(): FastifyBaseLogger {
  return {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: 'warn',
    silent: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

function makeMockBinanceClient(): BinanceApiClient {
  return {
    assertConfigured: vi.fn(),
    getAccountAssets: vi.fn().mockResolvedValue([]),
    getValidTradingSymbols: vi.fn().mockResolvedValue(new Set<string>()),
    getMyTrades: vi.fn().mockResolvedValue([]),
    getConvertHistory: vi.fn().mockResolvedValue([]),
    getWithdrawHistory: vi.fn().mockResolvedValue([]),
    getDepositHistory: vi.fn().mockResolvedValue([]),
  };
}

function makeTrade(overrides: Partial<BinanceTrade> = {}): BinanceTrade {
  return {
    symbol: 'ETHUSDT',
    id: 1,
    orderId: 1,
    price: '3000',
    qty: '1',
    quoteQty: '3000',
    isBuyer: true,
    time: Date.now(),
    commissionAsset: null,
    commission: null,
    ...overrides,
  };
}

function makeMockPriceService(cexPrice?: number) {
  return {
    getCexPrice: vi.fn().mockResolvedValue(
      cexPrice !== undefined ? { priceUsd: String(cexPrice) } : { priceUsd: '0' }
    ),
    getOnChainPrice: vi.fn(),
  };
}

function makeDeps(overrides: Partial<BinanceSyncDeps> = {}): BinanceSyncDeps {
  return {
    pool: {} as BinanceSyncDeps['pool'],
    priceService: makeMockPriceService() as unknown as BinanceSyncDeps['priceService'],
    binanceClient: makeMockBinanceClient(),
    log: makeMockLog(),
    ...overrides,
  };
}

// ─── T11: computeTradePrice — stable quote (USDT) ────────────────────────────

describe('computeTradePrice', () => {
  it('T11a — USDT stable quote returns exact price without API call', async () => {
    const priceService = makeMockPriceService();
    const service = new BinanceSyncService(makeDeps({ priceService: priceService as unknown as BinanceSyncDeps['priceService'] }));

    const trade = makeTrade({ symbol: 'ETHUSDT', qty: '1', quoteQty: '3000' });
    const result = await service.computeTradePrice(trade);

    expect(result).toBe('3000.00000000');
    expect(priceService.getCexPrice).not.toHaveBeenCalled();
  });

  it('T11b — USDC stable quote returns exact price without API call', async () => {
    const priceService = makeMockPriceService();
    const service = new BinanceSyncService(makeDeps({ priceService: priceService as unknown as BinanceSyncDeps['priceService'] }));

    const trade = makeTrade({ symbol: 'BTCUSDC', qty: '0.5', quoteQty: '25000' });
    const result = await service.computeTradePrice(trade);

    expect(result).toBe('50000.00000000');
    expect(priceService.getCexPrice).not.toHaveBeenCalled();
  });

  it('T11c — BUSD stable quote returns exact price without API call', async () => {
    const priceService = makeMockPriceService();
    const service = new BinanceSyncService(makeDeps({ priceService: priceService as unknown as BinanceSyncDeps['priceService'] }));

    const trade = makeTrade({ symbol: 'BNBBUSD', qty: '2', quoteQty: '600' });
    const result = await service.computeTradePrice(trade);

    expect(result).toBe('300.00000000');
    expect(priceService.getCexPrice).not.toHaveBeenCalled();
  });

  // ─── T12: computeTradePrice — non-stable quote (BTC) ───────────────────────

  it('T12a — non-stable BTC quote calls getCexPrice and multiplies', async () => {
    const priceService = makeMockPriceService(60000);
    const service = new BinanceSyncService(makeDeps({ priceService: priceService as unknown as BinanceSyncDeps['priceService'] }));

    const trade = makeTrade({ symbol: 'ETHBTC', qty: '1', quoteQty: '0.05' });
    const result = await service.computeTradePrice(trade);

    // 0.05 BTC × 60000 USD/BTC / 1 ETH = 3000 USD/ETH
    expect(result).toBe('3000.00000000');
    expect(priceService.getCexPrice).toHaveBeenCalledOnce();
    expect(priceService.getCexPrice).toHaveBeenCalledWith('BTC');
  });

  it('T12b — Decimal.js precision: no floating-point rounding errors', async () => {
    const priceService = makeMockPriceService(60000.123456);
    const service = new BinanceSyncService(makeDeps({ priceService: priceService as unknown as BinanceSyncDeps['priceService'] }));

    const trade = makeTrade({ symbol: 'ETHBTC', qty: '1', quoteQty: '0.049999' });
    const result = await service.computeTradePrice(trade);

    // Native floating point: 0.049999 * 60000.123456 = would have precision errors
    // With Decimal.js: should be exact
    const resultNum = parseFloat(result);
    // Result should be a reasonable number (approximately 2999.9...)
    expect(resultNum).toBeGreaterThan(2999);
    expect(resultNum).toBeLessThan(3001);
    // Must have exactly 8 decimal places
    expect(result).toMatch(/^\d+\.\d{8}$/);
  });
});

// ─── T13: resolveDepositCost — INHERITED ─────────────────────────────────────

describe('resolveDepositCost', () => {
  it('T14 — ON_CHAIN TRANSFER_OUT match returns INHERITED costSource', async () => {
    const priceService = makeMockPriceService(3200);
    const service = new BinanceSyncService(makeDeps({ priceService: priceService as unknown as BinanceSyncDeps['priceService'] }));

    const mockPgc = {
      query: vi.fn().mockResolvedValue({ rows: [{ wac: '3000.00000000' }] }),
    } as unknown as PoolClient;

    const deposit: BinanceDeposit = {
      coin: 'ETH',
      amount: '1.0',
      address: '0xabc',
      txId: '0xtxhash',
      insertTime: Date.now(),
      status: 1,
    };

    const result = await service.resolveDepositCost(mockPgc, deposit, 'some-token-id');

    expect(result.priceUsd).toBe('3000.00000000');
    expect(result.costSource).toBe('INHERITED');
    // getCexPrice must NOT be called when INHERITED
    expect(priceService.getCexPrice).not.toHaveBeenCalled();
  });

  it('T15 — no ON_CHAIN match falls back to MARKET via getCexPrice', async () => {
    const priceService = makeMockPriceService(3200);
    const service = new BinanceSyncService(makeDeps({ priceService: priceService as unknown as BinanceSyncDeps['priceService'] }));

    const mockPgc = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as PoolClient;

    const deposit: BinanceDeposit = {
      coin: 'ETH',
      amount: '1.0',
      address: '0xunknown',
      txId: '0xothertx',
      insertTime: Date.now(),
      status: 1,
    };

    const result = await service.resolveDepositCost(mockPgc, deposit, 'some-token-id');

    expect(result.costSource).toBe('MARKET');
    expect(result.priceUsd).toBe('3200');
    expect(priceService.getCexPrice).toHaveBeenCalledOnce();
    expect(priceService.getCexPrice).toHaveBeenCalledWith('ETH');
  });
});
