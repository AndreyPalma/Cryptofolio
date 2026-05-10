import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import {
  BINANCE_HISTORY_FLOOR_MS,
  BinanceSyncService,
  type BinanceSyncDeps,
} from '../src/services/binance-sync.js';
import type {
  BinanceApiClient,
  BinanceConvert,
  BinanceDeposit,
  BinanceFiatOrder,
  BinanceFiatPayment,
  BinanceTrade,
  BinanceWithdrawal,
} from '../src/sync/clients/binance-api.js';

interface FiatOrder extends BinanceFiatOrder {
  type: number;
}

type FiatPayment = BinanceFiatPayment;
type PriceServiceLike = BinanceSyncDeps['priceService'];

interface SyncEmitEvent {
  step: string;
  status: string;
}

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
  dbSymbols: Set<string>;
  queries: RecordedQuery[];
  transactionInserts: RecordedQuery[];
  nextTokenId: number;
}

interface HarnessOptions {
  client?: Partial<BinanceApiClient>;
  priceService?: Partial<PriceServiceLike>;
  cursors?: Record<string, number | string>;
  dbSymbols?: string[];
  skipDefaultCursors?: boolean;
  runId?: string;
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
    runId: 'run-complete-1',
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
    getCexPrice: vi.fn().mockResolvedValue({ priceUsd: '3000.00' }),
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

    if (sql.includes('select distinct t.symbol') && sql.includes('join tokens t on t.id = tx.token_id')) {
      const knownSymbols = new Set([...state.dbSymbols, ...state.tokenIds.keys()]);
      return {
        rowCount: knownSymbols.size,
        rows: Array.from(knownSymbols).map((symbol) => ({ symbol })),
      };
    }

    if (sql.includes("select symbol from tokens where network = 'cex_binance'")) {
      const knownSymbols = new Set([...state.dbSymbols, ...state.tokenIds.keys()]);
      return {
        rowCount: knownSymbols.size,
        rows: Array.from(knownSymbols).map((symbol) => ({ symbol })),
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
      state.dbSymbols.add(symbol);
      return { rowCount: 1, rows: [{ id: tokenId }] };
    }

    if (sql.startsWith('select * from positions')) {
      return { rowCount: 0, rows: [] };
    }

    if (sql.startsWith('select count(*)::int as count from positions')) {
      return { rowCount: 1, rows: [{ count: 0 }] };
    }

    if (sql.startsWith('select wac from positions')) {
      return { rowCount: 0, rows: [] };
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
  syncRunModuleState.runId = options.runId ?? 'run-complete-1';
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
    cursors: new Map<string, string>(),
    tokenIds: new Map<string, string>(),
    dbSymbols: new Set((options.dbSymbols ?? []).map((symbol) => symbol.toUpperCase())),
    queries: [],
    transactionInserts: [],
    nextTokenId: 1,
  };

  if (!options.skipDefaultCursors) {
    state.cursors.set('converts', new Date(now).toISOString());
    state.cursors.set('deposits', new Date(now).toISOString());
    state.cursors.set('withdrawals', new Date(now).toISOString());
    state.cursors.set('fiat:orders', new Date(now).toISOString());
    state.cursors.set('fiat:payments', new Date(now).toISOString());
  }

  for (const [operation, value] of Object.entries(options.cursors ?? {})) {
    state.cursors.set(operation, toCursorValue(value));
  }

  syncRunModuleState.commitHandler = async (_runId, opts) => {
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

afterEach(() => {
  vi.restoreAllMocks();
  syncRunModuleState.commitHandler = null;
  syncRunModuleState.rollbackHandler = null;
});

describe('BinanceSyncService complete flow with atomicity', () => {
  it('sync success -> commitSuccess with positions+cursors', async () => {
    const harness = createHarness({
      client: {
        getFiatOrders: vi.fn().mockResolvedValue([
          {
            orderNo: 'fiat-order-complete-1',
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

    await harness.service.sync(harness.walletId, harness.userId);

    expect(syncRunModuleState.start).toHaveBeenCalledWith(harness.walletId, 'CEX');
    expect(syncRunModuleState.commitSuccess).toHaveBeenCalledTimes(1);
    expect(syncRunModuleState.commitSuccess).toHaveBeenCalledWith(
      'run-complete-1',
      expect.objectContaining({
        positions: expect.any(Map),
        cursorUpdates: expect.arrayContaining([
          expect.objectContaining({ operation: 'fiat:orders' }),
          expect.objectContaining({ operation: 'fiat:payments' }),
        ]),
      }),
    );
  });

  it('failure in syncWithdrawals -> rollback deletes fiat+deposits txs', async () => {
    const harness = createHarness({
      client: {
        getDepositHistory: vi.fn().mockResolvedValue([
          {
            coin: 'ETH',
            amount: '1.00',
            address: '0xsender',
            txId: '0xdeposit-1',
            insertTime: Date.now() - 5_000,
            status: 1,
          },
        ]),
        getWithdrawHistory: vi.fn().mockRejectedValue(new Error('withdrawals exploded')),
        getFiatOrders: vi.fn().mockResolvedValue([
          {
            orderNo: 'fiat-order-rollback-1',
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
      runId: 'run-rollback-1',
    });

    await expect(harness.service.sync(harness.walletId, harness.userId)).rejects.toThrow('withdrawals exploded');

    expect(syncRunModuleState.rollback).toHaveBeenCalledWith('run-rollback-1');
    expect(harness.state.transactionInserts).toHaveLength(0);
  });

  it('sync with emit -> events emitted in correct order', async () => {
    const harness = createHarness();
    const events: SyncEmitEvent[] = [];
    const emit = vi.fn((event: SyncEmitEvent) => {
      events.push(event);
    });

    await harness.service.sync(harness.walletId, harness.userId, { emit });

    expect(
      events.filter((event) => event.status === 'running').map((event) => event.step),
    ).toEqual(['fiat', 'deposits', 'withdrawals', 'converts', 'trades']);
  });

  it('sync with signal.aborted -> interrupts between steps', async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const emit = vi.fn((event: SyncEmitEvent) => {
      if (event.step === 'fiat') {
        controller.abort();
      }
    });

    await expect(
      harness.service.sync(harness.walletId, harness.userId, {
        emit,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/abort/i);
    expect(harness.client.getWithdrawHistory).not.toHaveBeenCalled();
  });

  it('BINANCE_HISTORY_FLOOR_MS used in first sync and not SYNC_START_MS', async () => {
    const harness = createHarness({
      skipDefaultCursors: true,
      client: {
        getConvertHistory: vi.fn().mockResolvedValue([]),
      },
    });
    await harness.service.sync(harness.walletId, harness.userId);

    expect(harness.client.getConvertHistory).toHaveBeenCalled();
    const [startTime, endTime, signal] = vi.mocked(harness.client.getConvertHistory).mock.calls[0] ?? [];
    expect(startTime).toBe(BINANCE_HISTORY_FLOOR_MS);
    expect(endTime).toEqual(expect.any(Number));
    expect(signal).toBeUndefined();
  });

  it('discoverAssets returns assets from prior txs and not balance', async () => {
    const harness = createHarness({
      dbSymbols: ['ETH'],
      cursors: {
        'trades:ETHUSDT': Date.now() - 30_000,
        'trades:BTCUSDT': Date.now() - 30_000,
      },
      client: {
        getAccountAssets: vi.fn().mockResolvedValue([
          { asset: 'BTC', free: '1.0', locked: '0.0' },
        ]),
        getValidTradingSymbols: vi.fn().mockResolvedValue(new Set(['ETHUSDT', 'BTCUSDT'])),
        getMyTrades: vi.fn().mockResolvedValue([]),
      },
    });

    await harness.service.sync(harness.walletId, harness.userId);

    expect(harness.client.getMyTrades).toHaveBeenCalledWith(
      'ETHUSDT',
      expect.any(Number),
      expect.any(Number),
      undefined,
    );
    expect(harness.client.getMyTrades).not.toHaveBeenCalledWith(
      'BTCUSDT',
      expect.any(Number),
      expect.any(Number),
      undefined,
    );
  });

  it('getValidTradingSymbols called exactly 1 time', async () => {
    const harness = createHarness({
      dbSymbols: ['ETH'],
      cursors: {
        'trades:ETHUSDT': Date.now() - 30_000,
      },
      client: {
        getValidTradingSymbols: vi.fn().mockResolvedValue(new Set(['ETHUSDT'])),
      },
    });

    await harness.service.sync(harness.walletId, harness.userId);

    expect(harness.client.getValidTradingSymbols).toHaveBeenCalledTimes(1);
  });

  it('BinanceSyncResult includes fiat field', async () => {
    const harness = createHarness();

    const result = await harness.service.sync(harness.walletId, harness.userId);

    expect(result.fiat).toBe(0);
  });

  it('sync with emit undefined -> no errors', async () => {
    const harness = createHarness();

    await expect(
      harness.service.sync(harness.walletId, harness.userId, { emit: undefined }),
    ).resolves.toMatchObject({
      trades: expect.any(Object),
      converts: expect.any(Object),
      withdrawals: expect.any(Object),
      deposits: expect.any(Object),
    });
  });
});
