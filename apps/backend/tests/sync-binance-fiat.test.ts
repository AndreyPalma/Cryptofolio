import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { BinanceSyncService, type BinanceSyncDeps } from '../src/services/binance-sync.js';
import {
  FiatPermissionDeniedError,
  type BinanceApiClient,
  type BinanceConvert,
  type BinanceDeposit,
  type BinanceFiatOrder,
  type BinanceFiatPayment,
  type BinanceTrade,
  type BinanceWithdrawal,
} from '../src/sync/clients/binance-api.js';

interface FiatOrder extends BinanceFiatOrder {
  type: number;
}

type FiatPayment = BinanceFiatPayment;
type PriceServiceLike = BinanceSyncDeps['priceService'];

interface CursorUpdate {
  operation: string;
  value: string;
}

interface CommitSuccessOptionsLike {
  positions: ReadonlyMap<string, unknown>;
  cursorUpdates: readonly CursorUpdate[];
}

interface RecordedQuery {
  text: string;
  params: readonly unknown[];
}

interface HarnessState {
  cursors: Map<string, string>;
  tokenIds: Map<string, string>;
  queries: RecordedQuery[];
  transactionInserts: RecordedQuery[];
  commitCalls: { runId: string; opts: CommitSuccessOptionsLike }[];
  nextTokenId: number;
}

interface HarnessOptions {
  client?: Partial<BinanceApiClient>;
  priceService?: Partial<PriceServiceLike>;
  cursors?: Record<string, number | string>;
}

interface SyncRunModuleState {
  runId: string;
  commitHandler: ((runId: string, opts: CommitSuccessOptionsLike) => Promise<void> | void) | null;
  rollbackHandler: ((runId: string) => Promise<void> | void) | null;
  start: ReturnType<typeof vi.fn>;
  recordTxsPersisted: ReturnType<typeof vi.fn>;
  commitSuccess: ReturnType<typeof vi.fn>;
  rollback: ReturnType<typeof vi.fn>;
  loadInitial: ReturnType<typeof vi.fn>;
  apply: ReturnType<typeof vi.fn>;
}

const syncRunModuleState = vi.hoisted(() => {
  const state: SyncRunModuleState = {
    runId: 'run-fiat-1',
    commitHandler: null,
    rollbackHandler: null,
    start: vi.fn(),
    recordTxsPersisted: vi.fn(),
    commitSuccess: vi.fn(),
    rollback: vi.fn(),
    loadInitial: vi.fn(),
    apply: vi.fn(),
  };

  state.start.mockImplementation(async () => ({ runId: state.runId }));
  state.commitSuccess.mockImplementation(async (runId: string, opts: CommitSuccessOptionsLike) => {
    await state.commitHandler?.(runId, opts);
  });
  state.rollback.mockImplementation(async (runId: string) => {
    await state.rollbackHandler?.(runId);
  });
  state.loadInitial.mockResolvedValue(new Map<string, never>());
  state.apply.mockImplementation(() => undefined);

  return state;
});

vi.mock('../src/services/sync-run-helper.js', () => ({
  SyncRunHelper: vi.fn().mockImplementation(() => ({
    start: syncRunModuleState.start,
    recordTxsPersisted: syncRunModuleState.recordTxsPersisted,
    commitSuccess: syncRunModuleState.commitSuccess,
    rollback: syncRunModuleState.rollback,
  })),
}));

vi.mock('../src/services/position-state-buffer.js', () => ({
  loadInitial: syncRunModuleState.loadInitial,
  apply: syncRunModuleState.apply,
}));

const mockLog = {
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

function normalizeSql(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function toCursorValue(input: number | string): string {
  return typeof input === 'number' ? new Date(input).toISOString() : input;
}

function stringifyParams(params: readonly unknown[]): string[] {
  return params.map((value) => {
    if (value === null) return 'null';
    return String(value);
  });
}

function makeMockBinanceClient(
  overrides: Partial<BinanceApiClient> = {},
): BinanceApiClient {
  return {
    assertConfigured: vi.fn(),
    getAccountAssets: vi.fn().mockResolvedValue([] as { asset: string; free: string; locked: string }[]),
    getValidTradingSymbols: vi.fn().mockResolvedValue(new Set<string>()),
    getMyTrades: vi.fn().mockResolvedValue([] as BinanceTrade[]),
    getConvertHistory: vi.fn().mockResolvedValue([] as BinanceConvert[]),
    getWithdrawHistory: vi.fn().mockResolvedValue([] as BinanceWithdrawal[]),
    getDepositHistory: vi.fn().mockResolvedValue([] as BinanceDeposit[]),
    getFiatOrders: vi.fn().mockResolvedValue([] as FiatOrder[]),
    getFiatPayments: vi.fn().mockResolvedValue([] as FiatPayment[]),
    ...overrides,
  } as BinanceApiClient;
}

function makeMockPriceService(
  overrides: Partial<PriceServiceLike> = {},
): PriceServiceLike {
  return {
    getOnChainPrice: vi.fn(),
    getCexPrice: vi.fn().mockResolvedValue({ priceUsd: '1.00' }),
    getOnChainPricesBulk: vi.fn().mockResolvedValue(new Map()),
    getFiatToUsdAt: vi.fn().mockResolvedValue('1.00'),
    ...overrides,
  } as PriceServiceLike;
}

function createMockPool(state: HarnessState): BinanceSyncDeps['pool'] {
  const runQuery = async (text: string, params: readonly unknown[] = []) => {
    state.queries.push({ text, params });
    const sql = normalizeSql(text);

    if (sql.includes('select id, wallet_type from wallets')) {
      return {
        rowCount: 1,
        rows: [{ id: 'wallet-1', wallet_type: 'CEX' }],
      };
    }

    if (sql.startsWith('select last_value from wallet_sync_cursors')) {
      const operation = String(params[1]);
      const value = state.cursors.get(operation);
      return {
        rowCount: value ? 1 : 0,
        rows: value ? [{ last_value: value }] : [],
      };
    }

    if (sql.startsWith('insert into wallet_sync_cursors')) {
      const operation = String(params[1]);
      state.cursors.set(operation, toCursorValue(params[2] as number | string));
      return { rowCount: 1, rows: [] };
    }

    if (sql.includes("select symbol from tokens where network = 'cex_binance'")) {
      return {
        rowCount: state.tokenIds.size,
        rows: Array.from(state.tokenIds.keys()).map((symbol) => ({ symbol })),
      };
    }

    if (sql.includes("select id from tokens where network = 'cex_binance'")) {
      const symbol = String(params[0]).toUpperCase();
      const tokenId = state.tokenIds.get(symbol);
      return {
        rowCount: tokenId ? 1 : 0,
        rows: tokenId ? [{ id: tokenId }] : [],
      };
    }

    if (sql.startsWith('insert into tokens')) {
      const symbol = String(params[0]).toUpperCase();
      const tokenId = state.tokenIds.get(symbol) ?? `token-${state.nextTokenId++}`;
      state.tokenIds.set(symbol, tokenId);
      return { rowCount: 1, rows: [{ id: tokenId }] };
    }

    if (sql.startsWith('select * from positions')) {
      return { rowCount: 0, rows: [] };
    }

    if (sql.startsWith('select count(*)::int as count from positions')) {
      return { rowCount: 1, rows: [{ count: 0 }] };
    }

    if (sql.startsWith('insert into positions')) {
      return { rowCount: 1, rows: [] };
    }

    if (sql.startsWith("select id from transactions where wallet_id=$1 and type='transfer_in'")) {
      return { rowCount: 0, rows: [] };
    }

    if (sql.startsWith('select p.wac from transactions t')) {
      return { rowCount: 0, rows: [] };
    }

    if (sql.startsWith('insert into transactions')) {
      const entry = { text, params };
      state.transactionInserts.push(entry);
      return { rowCount: 1, rows: [{ id: `tx-${state.transactionInserts.length}` }] };
    }

    if (sql.startsWith('insert into sync_runs')) {
      return { rowCount: 1, rows: [{ id: syncRunModuleState.runId }] };
    }

    if (sql.startsWith('select wallet_id from sync_runs')) {
      return { rowCount: 1, rows: [{ wallet_id: 'wallet-1' }] };
    }

    if (sql.startsWith('update sync_runs') || sql.startsWith('delete from sync_runs')) {
      return { rowCount: 1, rows: [] };
    }

    if (
      sql === 'begin' ||
      sql === 'commit' ||
      sql === 'rollback' ||
      sql.startsWith('update wallets set last_synced_at = now()')
    ) {
      return { rowCount: 1, rows: [] };
    }

    return { rowCount: 0, rows: [] };
  };

  const client = {
    query: vi.fn(runQuery),
    release: vi.fn(),
  };

  return {
    query: vi.fn(runQuery),
    connect: vi.fn(async () => client),
  } as unknown as BinanceSyncDeps['pool'];
}

function createHarness(options: HarnessOptions = {}) {
  syncRunModuleState.start.mockClear();
  syncRunModuleState.recordTxsPersisted.mockClear();
  syncRunModuleState.commitSuccess.mockClear();
  syncRunModuleState.rollback.mockClear();
  syncRunModuleState.loadInitial.mockClear();
  syncRunModuleState.apply.mockClear();
  syncRunModuleState.loadInitial.mockResolvedValue(new Map<string, never>());
  syncRunModuleState.apply.mockImplementation(() => undefined);

  const now = Date.now();
  const state: HarnessState = {
    cursors: new Map<string, string>([
      ['converts', new Date(now).toISOString()],
      ['deposits', new Date(now).toISOString()],
      ['withdrawals', new Date(now).toISOString()],
      ['fiat:orders', new Date(now - 60_000).toISOString()],
      ['fiat:payments', new Date(now - 60_000).toISOString()],
    ]),
    tokenIds: new Map<string, string>(),
    queries: [],
    transactionInserts: [],
    commitCalls: [],
    nextTokenId: 1,
  };

  for (const [operation, value] of Object.entries(options.cursors ?? {})) {
    state.cursors.set(operation, toCursorValue(value));
  }

  syncRunModuleState.commitHandler = async (runId, opts) => {
    state.commitCalls.push({ runId, opts });
    for (const cursorUpdate of opts.cursorUpdates) {
      state.cursors.set(cursorUpdate.operation, cursorUpdate.value);
    }
  };
  syncRunModuleState.rollbackHandler = async (runId) => {
    state.transactionInserts.splice(
      0,
      state.transactionInserts.length,
      ...state.transactionInserts.filter((entry) => !entry.params.includes(runId)),
    );
  };

  const client = makeMockBinanceClient(options.client);
  const priceService = makeMockPriceService(options.priceService);
  const pool = createMockPool(state);
  const service = new BinanceSyncService({
    pool,
    priceService,
    binanceClient: client,
    log: mockLog,
  });

  return {
    client,
    priceService,
    service,
    state,
    userId: 'user-1',
    walletId: 'wallet-1',
  };
}

function findTransactionInsert(state: HarnessState, needle: string): RecordedQuery | undefined {
  return state.transactionInserts.find((entry) => entry.params.includes(needle));
}

function makePermissionDeniedError(): FiatPermissionDeniedError {
  return new FiatPermissionDeniedError('/sapi/v1/fiat/orders');
}

afterEach(() => {
  vi.restoreAllMocks();
  syncRunModuleState.commitHandler = null;
  syncRunModuleState.rollbackHandler = null;
});

describe('syncFiat', () => {
  it('fiat orders type=0 -> FIAT_IN with correct cex_order_id', async () => {
    const harness = createHarness({
      client: {
        getFiatOrders: vi.fn().mockResolvedValue([
          {
            orderNo: 'fiat-order-in-1',
            type: 0,
            fiatCurrency: 'USD',
            sourceAmount: '100.00',
            obtainAmount: '100.00',
            totalFee: '0.00',
            price: '1.00',
            status: 'Completed',
            createTime: Date.now() - 5_000,
            cryptoCurrency: 'USDT',
          },
        ]),
      },
    });

    const result = await harness.service.sync(harness.walletId, harness.userId);
    const insert = findTransactionInsert(harness.state, 'fiat-order-in-1');

    expect(result.fiat).toBe(1);
    expect(insert?.text.toLowerCase()).toContain('cex_order_id');
    expect(insert?.params).toEqual(expect.arrayContaining(['FIAT_IN', 'fiat-order-in-1', 'run-fiat-1']));
  });

  it('fiat orders type=1 -> FIAT_OUT with correct cex_order_id', async () => {
    const harness = createHarness({
      client: {
        getFiatOrders: vi.fn().mockResolvedValue([
          {
            orderNo: 'fiat-order-out-1',
            type: 1,
            fiatCurrency: 'USD',
            sourceAmount: '250.00',
            obtainAmount: '0.10',
            totalFee: '0.00',
            price: '2500.00',
            status: 'Completed',
            createTime: Date.now() - 5_000,
            cryptoCurrency: 'ETH',
          },
        ]),
      },
    });

    const result = await harness.service.sync(harness.walletId, harness.userId);
    const insert = findTransactionInsert(harness.state, 'fiat-order-out-1');

    expect(result.fiat).toBe(1);
    expect(insert?.params).toEqual(expect.arrayContaining(['FIAT_OUT', 'fiat-order-out-1']));
  });

  it('fiat payments USD -> price_usd = sourceAmount/obtainAmount', async () => {
    const harness = createHarness({
      client: {
        getFiatPayments: vi.fn().mockResolvedValue([
          {
            orderNo: 'fiat-payment-usd-1',
            fiatCurrency: 'USD',
            sourceAmount: '50.00',
            obtainAmount: '2.00',
            totalFee: '0.00',
            price: '25.00',
            status: 'Completed',
            createTime: Date.now() - 5_000,
            cryptoCurrency: 'SOL',
          },
        ]),
      },
    });

    await harness.service.sync(harness.walletId, harness.userId);
    const insert = findTransactionInsert(harness.state, 'fiat-payment-usd-1');

    expect(stringifyParams(insert?.params ?? [])).toContain('25.00000000');
  });

  it('fiat payments non-USD -> getFiatToUsdAt fallback to MANUAL', async () => {
    const harness = createHarness({
      client: {
        getFiatPayments: vi.fn().mockResolvedValue([
          {
            orderNo: 'fiat-payment-eur-1',
            fiatCurrency: 'EUR',
            sourceAmount: '90.00',
            obtainAmount: '100.00',
            totalFee: '0.00',
            price: '0.90',
            status: 'Completed',
            createTime: Date.now() - 5_000,
            cryptoCurrency: 'USDT',
          },
        ]),
      },
      priceService: {
        getFiatToUsdAt: vi.fn().mockResolvedValue(null),
      },
    });

    await harness.service.sync(harness.walletId, harness.userId);
    const insert = findTransactionInsert(harness.state, 'fiat-payment-eur-1');

    expect(insert?.params).toContain('MANUAL');
    expect(insert?.params).toContain('0');
  });

  it('403 on getFiatOrders -> syncFiat returns skipped', async () => {
    const permissionDenied = makePermissionDeniedError();
    const harness = createHarness({
      client: {
        getFiatOrders: vi.fn().mockRejectedValue(permissionDenied),
      },
    });

    const result = await harness.service.sync(harness.walletId, harness.userId);

    expect(result.fiat).toBe(0);
  });

  it('5xx on getFiatOrders -> propagates real error, NOT skipped', async () => {
    const harness = createHarness({
      client: {
        getFiatOrders: vi.fn().mockRejectedValue(new Error('binance fiat unavailable')),
      },
    });

    await expect(harness.service.sync(harness.walletId, harness.userId)).rejects.toThrow(
      'binance fiat unavailable',
    );
  });

  it('cursors fiat:orders and fiat:payments accumulate', async () => {
    const initialOrdersCursor = new Date(Date.now() - 120_000).toISOString();
    const initialPaymentsCursor = new Date(Date.now() - 180_000).toISOString();
    const harness = createHarness({
      cursors: {
        'fiat:orders': initialOrdersCursor,
        'fiat:payments': initialPaymentsCursor,
      },
    });

    await harness.service.sync(harness.walletId, harness.userId);

    expect(harness.state.cursors.get('fiat:orders')).not.toBe(initialOrdersCursor);
    expect(harness.state.cursors.get('fiat:payments')).not.toBe(initialPaymentsCursor);
  });

  it('all txs carry sync_run_id = runId', async () => {
    const harness = createHarness({
      client: {
        getFiatOrders: vi.fn().mockResolvedValue([
          {
            orderNo: 'fiat-order-sync-run-1',
            type: 0,
            fiatCurrency: 'USD',
            sourceAmount: '100.00',
            obtainAmount: '100.00',
            totalFee: '0.00',
            price: '1.00',
            status: 'Completed',
            createTime: Date.now() - 5_000,
            cryptoCurrency: 'USDT',
          },
        ]),
        getFiatPayments: vi.fn().mockResolvedValue([
          {
            orderNo: 'fiat-payment-sync-run-1',
            fiatCurrency: 'USD',
            sourceAmount: '30.00',
            obtainAmount: '1.00',
            totalFee: '0.00',
            price: '30.00',
            status: 'Completed',
            createTime: Date.now() - 5_000,
            cryptoCurrency: 'SOL',
          },
        ]),
      },
    });

    await harness.service.sync(harness.walletId, harness.userId);

    expect(syncRunModuleState.start).toHaveBeenCalledWith(harness.walletId, 'CEX');
    expect(harness.state.transactionInserts).toHaveLength(2);
    expect(
      harness.state.transactionInserts.every(
        (entry) => entry.text.toLowerCase().includes('sync_run_id') && entry.params.includes('run-fiat-1'),
      ),
    ).toBe(true);
  });
});
