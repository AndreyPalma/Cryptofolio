// PortfolioService unit tests — US-007
// Mock Pool (pool.query vi.fn) + stub PriceService. Sin DB real.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import type { PriceResult } from '../../types/portfolio.js';
import type { PriceService } from '../price.js';
import { NotFoundError } from '../errors.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMockPool(queryFn = vi.fn()): Pool {
  return { query: queryFn } as unknown as Pool;
}

function makeStubPriceService(overrides: Partial<PriceService> = {}): PriceService {
  return {
    getOnChainPrice: vi.fn().mockResolvedValue({ priceUsd: '2000.00' }),
    getCexPrice: vi.fn().mockResolvedValue({ priceUsd: '2000.00' }),
    getOnChainPricesBulk: vi.fn().mockResolvedValue(new Map()),
    ...overrides,
  };
}

// ─── Test fixtures ────────────────────────────────────────────────────────────

const basePositionRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  position_id: 'pos-1',
  wallet_id: 'wallet-1',
  cycle_number: 1,
  status: 'OPEN',
  balance: '1.000000000000000000',
  wac: '2000.000000000000000000',
  cost_basis: '2000.000000000000000000',
  realized_pnl_usd: '0.000000000000000000',
  opened_at: new Date('2024-01-01'),
  closed_at: null,
  token_id: 'token-1',
  symbol: 'WETH',
  name: 'Wrapped Ether',
  network: 'ETH',
  contract_address: '0xaaa',
  binance_symbol: null,
  decimals: 18,
  target_exit_price: null,
  wallet_label: 'My Wallet',
  wallet_type: 'ON_CHAIN',
  ...overrides,
});

const { getPortfolioSummary, getTokenDetail, getPositionHistory } = await import('../portfolio.js');

// ─────────────────────────────────────────────────────────────────────────────
// getPortfolioSummary
// ─────────────────────────────────────────────────────────────────────────────

describe('getPortfolioSummary', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('SC-PORT-SUMMARY-01: 2 wallets ON_CHAIN mismo token → 1 fila agregada, WAC ponderado', async () => {
    const row1 = basePositionRow({ wallet_id: 'w1', balance: '1.000000000000000000', wac: '2000.000000000000000000', cost_basis: '2000.000000000000000000', wallet_label: 'W1' });
    const row2 = basePositionRow({ wallet_id: 'w2', balance: '2.000000000000000000', wac: '3000.000000000000000000', cost_basis: '6000.000000000000000000', wallet_label: 'W2' });

    const priceMap = new Map([['onchain:eth:0xaaa', { priceUsd: '2500.00' } as PriceResult]]);
    const ps = makeStubPriceService({ getOnChainPricesBulk: vi.fn().mockResolvedValue(priceMap) });
    const pool = makeMockPool(vi.fn().mockResolvedValue({ rows: [row1, row2] }));

    const summary = await getPortfolioSummary(pool, ps);

    expect(summary.tokens).toHaveLength(1);
    const token = summary.tokens[0]!;
    expect(token.walletCount).toBe(2);
    expect(token.totalBalance).toMatch(/^3/);
    // WAC ponderado: (1×2000 + 2×3000) / 3 = 2666.666...
    expect(token.wacAggregated).toMatch(/^2666\.666/);
    expect(token.totalCostBasis).toMatch(/^8000/);
  });

  it('SC-PORT-SUMMARY-02: ETH on-chain + ETH CEX → 2 filas separadas, jamás agrupadas', async () => {
    const onChainRow = basePositionRow({ wallet_type: 'ON_CHAIN', network: 'ETH', contract_address: '0xeee', symbol: 'ETH', token_id: 't-onchain' });
    const cexRow = basePositionRow({ wallet_type: 'CEX', network: 'CEX_BINANCE', contract_address: 'eth', symbol: 'ETH', token_id: 't-cex', binance_symbol: 'ETHUSDT', wallet_id: 'w-cex' });

    const ps = makeStubPriceService({
      getOnChainPricesBulk: vi.fn().mockResolvedValue(new Map([['onchain:eth:0xeee', { priceUsd: '3000' } as PriceResult]])),
      getCexPrice: vi.fn().mockResolvedValue({ priceUsd: '3000' } as PriceResult),
    });
    const pool = makeMockPool(vi.fn().mockResolvedValue({ rows: [onChainRow, cexRow] }));

    const summary = await getPortfolioSummary(pool, ps);

    expect(summary.tokens).toHaveLength(2);
    const networks = summary.tokens.map((t) => t.network);
    expect(networks).toContain('ETH');
    expect(networks).toContain('CEX_BINANCE');
  });

  it('SC-PORT-SUMMARY-03: precio no disponible → fila con priceUnavailable, totales excluyen', async () => {
    const row = basePositionRow({ cost_basis: '5000.000000000000000000' });
    const priceMap = new Map([['onchain:eth:0xaaa', { priceUnavailable: true } as PriceResult]]);
    const ps = makeStubPriceService({ getOnChainPricesBulk: vi.fn().mockResolvedValue(priceMap) });
    const pool = makeMockPool(vi.fn().mockResolvedValue({ rows: [row] }));

    const summary = await getPortfolioSummary(pool, ps);

    expect(summary.tokens[0]?.priceUnavailable).toBe(true);
    expect(summary.tokens[0]?.currentPrice).toBeNull();
    expect(summary.tokens[0]?.pnlUsd).toBeNull();
    // totalValueUsd excluye esta fila
    expect(summary.totalValueUsd).toBe('0.000000000000000000');
    // totalCostBasis siempre suma todos
    expect(summary.totalCostBasis).toMatch(/^5000/);
  });

  it('SC-PORT-SUMMARY-04: balance cero → fila excluida (no NaN)', async () => {
    const row = basePositionRow({ balance: '0.000000000000000000' });
    const pool = makeMockPool(vi.fn().mockResolvedValue({ rows: [row] }));
    const ps = makeStubPriceService();

    const summary = await getPortfolioSummary(pool, ps);

    expect(summary.tokens).toHaveLength(0);
  });

  it('NEGATIVE-PORT-05: totalCostBasis=0 → totalPnlPct null, no NaN', async () => {
    const pool = makeMockPool(vi.fn().mockResolvedValue({ rows: [] }));
    const ps = makeStubPriceService();

    const summary = await getPortfolioSummary(pool, ps);

    expect(summary.totalPnlPct).toBeNull();
    expect(summary.totalValueUsd).toBe('0.000000000000000000');
  });

  it('triangulación: 2 tokens distintos → 2 filas, totales suman ambos', async () => {
    const row1 = basePositionRow({ token_id: 't1', contract_address: '0xaaa', symbol: 'WETH', cost_basis: '2000.000000000000000000' });
    const row2 = basePositionRow({ token_id: 't2', contract_address: '0xbbb', symbol: 'USDC', network: 'BSC', balance: '5000.000000000000000000', wac: '1.000000000000000000', cost_basis: '5000.000000000000000000' });

    const priceMap = new Map<string, PriceResult>([
      ['onchain:eth:0xaaa', { priceUsd: '3000' }],
      ['onchain:bsc:0xbbb', { priceUsd: '1.00' }],
    ]);
    const ps = makeStubPriceService({ getOnChainPricesBulk: vi.fn().mockResolvedValue(priceMap) });
    const pool = makeMockPool(vi.fn().mockResolvedValue({ rows: [row1, row2] }));

    const summary = await getPortfolioSummary(pool, ps);

    expect(summary.tokens).toHaveLength(2);
    expect(summary.totalCostBasis).toMatch(/^7000/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getTokenDetail
// ─────────────────────────────────────────────────────────────────────────────

describe('getTokenDetail', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const tokenRow = {
    id: 'token-1', symbol: 'WETH', name: 'Wrapped Ether', network: 'ETH',
    contract_address: '0xaaa', decimals: 18, binance_symbol: null,
    is_hidden: false, target_exit_price: null, created_at: new Date().toISOString(),
  };

  const txRow = {
    id: 'tx-1', wallet_id: 'w1', token_id: 'token-1', position_id: 'pos-1',
    type: 'BUY', source: 'MANUAL', block_timestamp: new Date('2024-01-01'),
    amount: '1.000000000000000000', price_usd: '2000.000000000000000000',
    cost_source: 'MARKET',
  };

  it('SC-PORT-DETAIL-01: ON_CHAIN con walletId → filtra posición y txs de esa wallet', async () => {
    const posRow = basePositionRow();
    const queryFn = vi.fn()
      .mockResolvedValueOnce({ rows: [tokenRow] })  // findByContractAddress
      .mockResolvedValueOnce({ rows: [posRow] })     // positions
      .mockResolvedValueOnce({ rows: [txRow] });     // transactions

    const priceMap = new Map([['onchain:eth:0xaaa', { priceUsd: '3000' } as PriceResult]]);
    const ps = makeStubPriceService({ getOnChainPricesBulk: vi.fn().mockResolvedValue(priceMap) });
    const pool = makeMockPool(queryFn);

    const detail = await getTokenDetail(pool, ps, '0xaaa', 'ETH', 'w1');

    expect(detail.token.symbol).toBe('WETH');
    expect(detail.position).not.toBeNull();
    expect(detail.transactions).toHaveLength(1);
  });

  it('SC-PORT-DETAIL-02: CEX ignora walletId', async () => {
    const cexToken = { ...tokenRow, network: 'CEX_BINANCE', contract_address: 'eth', binance_symbol: 'ETHUSDT' };
    const cexPos = basePositionRow({ network: 'CEX_BINANCE', wallet_type: 'CEX', contract_address: 'eth', binance_symbol: 'ETHUSDT' });
    const queryFn = vi.fn()
      .mockResolvedValueOnce({ rows: [cexToken] })
      .mockResolvedValueOnce({ rows: [cexPos] })
      .mockResolvedValueOnce({ rows: [] });

    const ps = makeStubPriceService({ getCexPrice: vi.fn().mockResolvedValue({ priceUsd: '3000' } as PriceResult) });
    const pool = makeMockPool(queryFn);

    const detail = await getTokenDetail(pool, ps, 'eth', 'CEX_BINANCE', 'some-other-wallet-id');

    expect(detail.token.network).toBe('CEX_BINANCE');
    expect(detail.position).not.toBeNull();
  });

  it('SC-PORT-DETAIL-03: BUY inbound → lotPnlUsd y lotPnlPct calculados', async () => {
    const posRow = basePositionRow({ wac: '2000.000000000000000000' });
    const queryFn = vi.fn()
      .mockResolvedValueOnce({ rows: [tokenRow] })
      .mockResolvedValueOnce({ rows: [posRow] })
      .mockResolvedValueOnce({ rows: [txRow] }); // BUY, price_usd='2000', amount='1'

    const priceMap = new Map([['onchain:eth:0xaaa', { priceUsd: '3000.00' } as PriceResult]]);
    const ps = makeStubPriceService({ getOnChainPricesBulk: vi.fn().mockResolvedValue(priceMap) });
    const pool = makeMockPool(queryFn);

    const detail = await getTokenDetail(pool, ps, '0xaaa', 'ETH');
    const tx = detail.transactions[0]!;

    expect(tx.pnl.kind).toBe('INBOUND');
    if (tx.pnl.kind === 'INBOUND') {
      expect(tx.pnl.lotPnlUsd).toMatch(/^1000/); // (3000-2000)×1 = 1000
      expect(tx.pnl.lotPnlPct).toMatch(/^50/);   // 1000/(2000×1)×100 = 50
    }
  });

  it('SC-PORT-DETAIL-04: SELL → kind OUTBOUND, displayAs Sold/Out', async () => {
    const sellTx = { ...txRow, id: 'tx-sell', type: 'SELL', price_usd: '3000.000000000000000000' };
    const posRow = basePositionRow();
    const queryFn = vi.fn()
      .mockResolvedValueOnce({ rows: [tokenRow] })
      .mockResolvedValueOnce({ rows: [posRow] })
      .mockResolvedValueOnce({ rows: [sellTx] });

    const priceMap = new Map([['onchain:eth:0xaaa', { priceUsd: '3000' } as PriceResult]]);
    const ps = makeStubPriceService({ getOnChainPricesBulk: vi.fn().mockResolvedValue(priceMap) });
    const pool = makeMockPool(queryFn);

    const detail = await getTokenDetail(pool, ps, '0xaaa', 'ETH');
    const tx = detail.transactions[0]!;

    expect(tx.pnl.kind).toBe('OUTBOUND');
    if (tx.pnl.kind === 'OUTBOUND') {
      expect(tx.pnl.displayAs).toBe('Sold/Out');
    }
  });

  it('SC-PORT-DETAIL-05: TRANSFER_IN con price_usd null → lotPnlUsd null', async () => {
    const transferTx = { ...txRow, type: 'TRANSFER_IN', price_usd: null, cost_source: 'MANUAL' };
    const posRow = basePositionRow();
    const queryFn = vi.fn()
      .mockResolvedValueOnce({ rows: [tokenRow] })
      .mockResolvedValueOnce({ rows: [posRow] })
      .mockResolvedValueOnce({ rows: [transferTx] });

    const priceMap = new Map([['onchain:eth:0xaaa', { priceUsd: '3000' } as PriceResult]]);
    const ps = makeStubPriceService({ getOnChainPricesBulk: vi.fn().mockResolvedValue(priceMap) });
    const pool = makeMockPool(queryFn);

    const detail = await getTokenDetail(pool, ps, '0xaaa', 'ETH');
    const tx = detail.transactions[0]!;

    expect(tx.pnl.kind).toBe('INBOUND');
    if (tx.pnl.kind === 'INBOUND') {
      expect(tx.pnl.lotPnlUsd).toBeNull();
      expect(tx.pnl.lotPnlPct).toBeNull();
    }
  });

  it('SC-PORT-DETAIL-06: price_usd cero → lotPnlPct null (no div/0)', async () => {
    const zeroTx = { ...txRow, price_usd: '0.000000000000000000' };
    const posRow = basePositionRow({ wac: '0.000000000000000000' });
    const queryFn = vi.fn()
      .mockResolvedValueOnce({ rows: [tokenRow] })
      .mockResolvedValueOnce({ rows: [posRow] })
      .mockResolvedValueOnce({ rows: [zeroTx] });

    const priceMap = new Map([['onchain:eth:0xaaa', { priceUsd: '1.00' } as PriceResult]]);
    const ps = makeStubPriceService({ getOnChainPricesBulk: vi.fn().mockResolvedValue(priceMap) });
    const pool = makeMockPool(queryFn);

    const detail = await getTokenDetail(pool, ps, '0xaaa', 'ETH');
    const tx = detail.transactions[0]!;

    if (tx.pnl.kind === 'INBOUND') {
      expect(tx.pnl.lotPnlPct).toBeNull();
    }
  });

  it('SC-PORT-DETAIL-07: token no encontrado → NotFoundError', async () => {
    const pool = makeMockPool(vi.fn().mockResolvedValue({ rows: [] }));
    const ps = makeStubPriceService();

    await expect(
      getTokenDetail(pool, ps, '0xnone', 'ETH'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('NEGATIVE-PORT-03: token exists but no OPEN position → position null (no error)', async () => {
    const queryFn = vi.fn()
      .mockResolvedValueOnce({ rows: [tokenRow] })
      .mockResolvedValueOnce({ rows: [] })   // no OPEN positions
      .mockResolvedValueOnce({ rows: [] });  // no txs

    const priceMap = new Map<string, PriceResult>();
    const ps = makeStubPriceService({ getOnChainPricesBulk: vi.fn().mockResolvedValue(priceMap) });
    const pool = makeMockPool(queryFn);

    const detail = await getTokenDetail(pool, ps, '0xaaa', 'ETH');

    expect(detail.position).toBeNull();
    expect(detail.transactions).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getPositionHistory
// ─────────────────────────────────────────────────────────────────────────────

describe('getPositionHistory', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const tokenRow = {
    id: 'token-1', symbol: 'WETH', name: null, network: 'ETH',
    contract_address: '0xaaa', decimals: 18, binance_symbol: null,
    is_hidden: false, target_exit_price: null, created_at: new Date().toISOString(),
  };

  it('SC-PORT-HISTORY-01: retorna solo CLOSED, ordenados ASC', async () => {
    const historyRows = [
      { cycle_number: 1, opened_at: new Date('2024-01-01'), closed_at: new Date('2024-02-01'), realized_pnl_usd: '500.000000000000000000' },
      { cycle_number: 2, opened_at: new Date('2024-03-01'), closed_at: new Date('2024-04-01'), realized_pnl_usd: '-100.000000000000000000' },
    ];
    const queryFn = vi.fn()
      .mockResolvedValueOnce({ rows: [tokenRow] })     // findByContractAddress
      .mockResolvedValueOnce({ rows: historyRows });   // CLOSED positions

    const pool = makeMockPool(queryFn);

    const result = await getPositionHistory(pool, '0xaaa', 'ETH');

    expect(result).toHaveLength(2);
    expect(result[0]!.cycleNumber).toBe(1);
    expect(result[1]!.cycleNumber).toBe(2);
    expect(result[0]!.realizedPnlUsd).toMatch(/^500/);
  });

  it('SC-PORT-HISTORY-02: sin ciclos cerrados → array vacío', async () => {
    const queryFn = vi.fn()
      .mockResolvedValueOnce({ rows: [tokenRow] })
      .mockResolvedValueOnce({ rows: [] });

    const pool = makeMockPool(queryFn);

    const result = await getPositionHistory(pool, '0xaaa', 'ETH');

    expect(result).toHaveLength(0);
    expect(Array.isArray(result)).toBe(true);
  });

  it('token no encontrado → NotFoundError', async () => {
    const pool = makeMockPool(vi.fn().mockResolvedValue({ rows: [] }));

    await expect(
      getPositionHistory(pool, '0xnone', 'ETH'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
