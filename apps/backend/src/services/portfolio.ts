// PortfolioService — US-007

import type { Pool } from 'pg';
import type { PriceService } from './price.js';
import type {
  PortfolioSummary,
  TokenPortfolioRow,
  TokenDetail,
  PositionHistoryEntry,
  TokenNetwork,
  PriceResult,
  PnlInfo,
} from '../types/portfolio.js';
import type { TransactionType, TransactionSource, CostSource } from '../db/types.js';
import { calculateWAC } from '../position-engine/index.js';
import type { PositionState } from '../position-engine/index.js';
import { toDecimal, roundToStorage, ZERO } from '../position-engine/decimal-utils.js';
import { findByContractAddress } from './token.js';
import { NotFoundError } from './errors.js';

// ─── Internal raw row types ───────────────────────────────────────────────────

interface PositionRow {
  position_id: string;
  wallet_id: string;
  cycle_number: number;
  balance: string;
  wac: string;
  cost_basis: string;
  realized_pnl_usd: string;
  opened_at: Date;
  closed_at: Date | null;
  token_id: string;
  symbol: string;
  name: string | null;
  network: string;
  contract_address: string;
  binance_symbol: string | null;
  decimals: number;
  target_exit_price: string | null;
  wallet_label: string | null;
  wallet_type: 'ON_CHAIN' | 'CEX';
}

interface TxRow {
  id: string;
  wallet_id: string;
  token_id: string;
  position_id: string | null;
  type: TransactionType;
  source: TransactionSource;
  block_timestamp: Date | string;
  amount: string;
  price_usd: string | null;
  cost_source: CostSource | null;
}

// ─── SQL base ─────────────────────────────────────────────────────────────────

const POSITION_BASE_SQL = `
  SELECT
    p.id               AS position_id,
    p.wallet_id        AS wallet_id,
    p.cycle_number     AS cycle_number,
    p.balance          AS balance,
    p.wac              AS wac,
    p.cost_basis       AS cost_basis,
    p.realized_pnl_usd AS realized_pnl_usd,
    p.opened_at        AS opened_at,
    p.closed_at        AS closed_at,
    t.id               AS token_id,
    t.symbol           AS symbol,
    t.name             AS name,
    t.network          AS network,
    t.contract_address AS contract_address,
    t.binance_symbol   AS binance_symbol,
    t.decimals         AS decimals,
    t.target_exit_price AS target_exit_price,
    w.label            AS wallet_label,
    w.wallet_type      AS wallet_type
  FROM positions p
  JOIN tokens  t ON t.id = p.token_id
  JOIN wallets w ON w.id = p.wallet_id`;

// ─── Virtual position (aggregated across wallets) ─────────────────────────────

function buildVirtualPosition(rows: PositionRow[]): PositionState {
  let totalBalance = ZERO;
  let weightedWacNum = ZERO;
  let totalCostBasis = ZERO;
  let totalRealizedPnl = ZERO;
  let earliestOpened = rows[0]!.opened_at;
  let maxCycle = 0;

  for (const r of rows) {
    const b = toDecimal(r.balance);
    const w = toDecimal(r.wac);
    totalBalance = totalBalance.plus(b);
    weightedWacNum = weightedWacNum.plus(b.times(w));
    totalCostBasis = totalCostBasis.plus(toDecimal(r.cost_basis));
    totalRealizedPnl = totalRealizedPnl.plus(toDecimal(r.realized_pnl_usd));
    if (r.opened_at < earliestOpened) earliestOpened = r.opened_at;
    if (r.cycle_number > maxCycle) maxCycle = r.cycle_number;
  }

  const wacAggregated = totalBalance.isZero() ? ZERO : weightedWacNum.div(totalBalance);

  return {
    id: rows[0]!.position_id,
    walletId: rows[0]!.wallet_id,
    tokenId: rows[0]!.token_id,
    cycleNumber: maxCycle,
    status: 'OPEN',
    balance: roundToStorage(totalBalance),
    wac: roundToStorage(wacAggregated),
    costBasis: roundToStorage(totalCostBasis),
    realizedPnlUsd: roundToStorage(totalRealizedPnl),
    openedAt: earliestOpened,
    closedAt: null,
  };
}

// ─── Portfolio row builder ────────────────────────────────────────────────────

function buildPortfolioRow(rows: PositionRow[], priceResult: PriceResult): TokenPortfolioRow {
  const first = rows[0]!;
  const virtual = buildVirtualPosition(rows);
  const currentPrice = 'priceUsd' in priceResult ? priceResult.priceUsd : null;
  const wacResult = calculateWAC(virtual, currentPrice);
  const totalBalance = toDecimal(virtual.balance);
  const totalCurrentValue = currentPrice
    ? roundToStorage(totalBalance.times(toDecimal(currentPrice)))
    : null;

  return {
    symbol: first.symbol,
    network: first.network as TokenNetwork,
    sourceType: first.wallet_type === 'ON_CHAIN' ? 'ON_CHAIN' : 'CEX',
    contractAddress: first.contract_address,
    binanceSymbol: first.binance_symbol,
    totalBalance: virtual.balance,
    wacAggregated: virtual.wac,
    totalCostBasis: virtual.costBasis,
    currentPrice,
    totalCurrentValue,
    pnlUsd: wacResult.unrealizedPnlUsd,
    pnlPct: wacResult.unrealizedPnlPct,
    walletCount: rows.length,
    walletBreakdown: rows.map((r) => ({
      walletId: r.wallet_id,
      label: r.wallet_label,
      balance: r.balance,
      wac: r.wac,
    })),
    priceUnavailable: 'priceUnavailable' in priceResult ? true : undefined,
  };
}

// ─── P&L enrichment per transaction ──────────────────────────────────────────

function computePnl(
  type: string,
  priceUsd: string | null,
  currentPrice: string | null,
  amount: string,
): PnlInfo {
  if (type === 'BUY' || type === 'SWAP_IN' || type === 'TRANSFER_IN') {
    if (priceUsd === null || currentPrice === null) {
      return { kind: 'INBOUND', lotPnlUsd: null, lotPnlPct: null };
    }
    const priceD = toDecimal(priceUsd);
    const currentD = toDecimal(currentPrice);
    const amtD = toDecimal(amount);
    const lotPnlUsd = roundToStorage(currentD.minus(priceD).times(amtD));
    const lotPnlPct = priceD.isZero()
      ? null
      : roundToStorage(currentD.minus(priceD).div(priceD).times(100));
    return { kind: 'INBOUND', lotPnlUsd, lotPnlPct };
  }
  return { kind: 'OUTBOUND', displayAs: 'Sold/Out' };
}

// ─────────────────────────────────────────────────────────────────────────────
// getPortfolioSummary
// ─────────────────────────────────────────────────────────────────────────────

export async function getPortfolioSummary(
  pool: Pool,
  priceService: PriceService,
): Promise<PortfolioSummary> {
  // 1. Load all OPEN positions joined with token + wallet metadata
  const result = await pool.query<PositionRow>(
    `${POSITION_BASE_SQL}
     WHERE p.status = 'OPEN'
     ORDER BY t.symbol ASC, t.network ASC, w.created_at ASC`,
  );

  // 2. Group by (contract_address, network) for ON_CHAIN; by position_id for CEX
  const groups = new Map<string, PositionRow[]>();
  for (const row of result.rows) {
    if (toDecimal(row.balance).isZero()) continue;
    const key =
      row.wallet_type === 'ON_CHAIN'
        ? `${row.contract_address.toLowerCase()}:${row.network}`
        : row.position_id;
    const existing = groups.get(key);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  // 3. Collect price-fetch plan
  const onChainRequests: Array<{ network: 'ETH' | 'BSC'; address: string }> = [];
  const cexSymbolsSet = new Set<string>();

  for (const [, groupRows] of groups) {
    const first = groupRows[0]!;
    if (first.wallet_type === 'ON_CHAIN') {
      onChainRequests.push({ network: first.network as 'ETH' | 'BSC', address: first.contract_address });
    } else if (first.binance_symbol) {
      cexSymbolsSet.add(first.binance_symbol);
    }
  }

  const cexSymbols = [...cexSymbolsSet];

  // 4. Fetch all prices in parallel
  const [priceMap, cexPriceMap] = await Promise.all([
    priceService.getOnChainPricesBulk(onChainRequests),
    Promise.all(
      cexSymbols.map(async (sym) => {
        const res = await priceService.getCexPrice(sym);
        return [sym, res] as [string, PriceResult];
      }),
    ).then((pairs) => new Map<string, PriceResult>(pairs)),
  ]);

  // 5. Build TokenPortfolioRow per group
  const tokenRows: TokenPortfolioRow[] = [];

  for (const [, groupRows] of groups) {
    const first = groupRows[0]!;
    let priceResult: PriceResult;

    if (first.wallet_type === 'ON_CHAIN') {
      const key = `onchain:${first.network.toLowerCase()}:${first.contract_address.toLowerCase()}`;
      priceResult = priceMap.get(key) ?? { priceUnavailable: true };
    } else {
      priceResult = first.binance_symbol
        ? (cexPriceMap.get(first.binance_symbol) ?? { priceUnavailable: true })
        : { priceUnavailable: true };
    }

    tokenRows.push(buildPortfolioRow(groupRows, priceResult));
  }

  // 6. Sort by symbol ASC, network ASC
  tokenRows.sort((a, b) => {
    const s = a.symbol.localeCompare(b.symbol);
    return s !== 0 ? s : a.network.localeCompare(b.network);
  });

  // 7. Compute totals — priceUnavailable rows excluded from value and pnl
  let totalValueUsd = ZERO;
  let totalCostBasis = ZERO;
  let totalPnlUsd = ZERO;

  for (const row of tokenRows) {
    totalCostBasis = totalCostBasis.plus(toDecimal(row.totalCostBasis));
    if (!row.priceUnavailable) {
      if (row.totalCurrentValue !== null) {
        totalValueUsd = totalValueUsd.plus(toDecimal(row.totalCurrentValue));
      }
      if (row.pnlUsd !== null) {
        totalPnlUsd = totalPnlUsd.plus(toDecimal(row.pnlUsd));
      }
    }
  }

  const totalPnlPct = totalCostBasis.isZero()
    ? null
    : roundToStorage(totalPnlUsd.div(totalCostBasis).times(100));

  return {
    totalValueUsd: roundToStorage(totalValueUsd),
    totalCostBasis: roundToStorage(totalCostBasis),
    totalPnlUsd: roundToStorage(totalPnlUsd),
    totalPnlPct,
    tokens: tokenRows,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getTokenDetail
// ─────────────────────────────────────────────────────────────────────────────

export async function getTokenDetail(
  pool: Pool,
  priceService: PriceService,
  contractAddress: string,
  network: TokenNetwork,
  walletId?: string,
): Promise<TokenDetail> {
  // 1. Resolve token → 404 if absent
  const token = await findByContractAddress(pool, contractAddress, network);
  if (!token) {
    throw new NotFoundError(
      `Token '${contractAddress}' on network '${network}' not found`,
      'TOKEN_NOT_FOUND',
    );
  }

  const isCex = network === 'CEX_BINANCE';

  // 2. Query OPEN positions for this token (optional wallet filter for ON_CHAIN)
  const posParams: unknown[] = [token.id];
  let walletClause = '';
  if (!isCex && walletId) {
    posParams.push(walletId);
    walletClause = `AND p.wallet_id = $${String(posParams.length)}`;
  }

  const posResult = await pool.query<PositionRow>(
    `${POSITION_BASE_SQL}
     WHERE p.status = 'OPEN'
       AND t.id = $1
       ${walletClause}
     ORDER BY w.created_at ASC`,
    posParams,
  );
  const posRows = posResult.rows;

  // 3. Fetch current price
  let priceResult: PriceResult;
  if (isCex) {
    priceResult = token.binance_symbol
      ? await priceService.getCexPrice(token.binance_symbol)
      : { priceUnavailable: true };
  } else {
    const pm = await priceService.getOnChainPricesBulk([
      { network: network as 'ETH' | 'BSC', address: contractAddress },
    ]);
    const key = `onchain:${network.toLowerCase()}:${contractAddress.toLowerCase()}`;
    priceResult = pm.get(key) ?? { priceUnavailable: true };
  }

  const currentPrice = 'priceUsd' in priceResult ? priceResult.priceUsd : null;

  // 4. Build aggregated position row (null when no OPEN positions)
  const positionRow = posRows.length > 0 ? buildPortfolioRow(posRows, priceResult) : null;

  // 5. Fetch transactions linked to these positions
  const positionIds = posRows.map((r) => r.position_id);
  const txResult = await pool.query<TxRow>(
    `SELECT id, wallet_id, token_id, position_id, type, source,
            block_timestamp, amount, price_usd, cost_source
       FROM transactions
      WHERE token_id = $1
        AND position_id = ANY($2::uuid[])
      ORDER BY block_timestamp DESC
      LIMIT 1000`,
    [token.id, positionIds],
  );

  // 6. Enrich each transaction with per-lot P&L
  const transactions = txResult.rows.map((tx) => {
    const ts =
      tx.block_timestamp instanceof Date
        ? tx.block_timestamp.toISOString()
        : String(tx.block_timestamp);
    return {
      id: tx.id,
      walletId: tx.wallet_id,
      tokenId: tx.token_id,
      positionId: tx.position_id ?? null,
      type: tx.type,
      source: tx.source,
      blockTimestamp: ts,
      amount: tx.amount,
      priceUsd: tx.price_usd ?? null,
      costSource: tx.cost_source ?? null,
      pnl: computePnl(tx.type, tx.price_usd ?? null, currentPrice, tx.amount),
    };
  });

  return {
    token: {
      id: token.id,
      symbol: token.symbol,
      name: token.name ?? null,
      network: token.network as TokenNetwork,
      contractAddress: token.contract_address ?? contractAddress,
      binanceSymbol: token.binance_symbol,
      decimals: token.decimals,
      targetExitPrice: token.target_exit_price ?? null,
    },
    position: positionRow,
    transactions,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getPositionHistory
// ─────────────────────────────────────────────────────────────────────────────

export async function getPositionHistory(
  pool: Pool,
  contractAddress: string,
  network: TokenNetwork,
  walletId?: string,
): Promise<PositionHistoryEntry[]> {
  // 1. Resolve token → 404 if absent
  const token = await findByContractAddress(pool, contractAddress, network);
  if (!token) {
    throw new NotFoundError(
      `Token '${contractAddress}' on network '${network}' not found`,
      'TOKEN_NOT_FOUND',
    );
  }

  const isCex = network === 'CEX_BINANCE';
  const params: unknown[] = [token.id];
  let walletClause = '';
  if (!isCex && walletId) {
    params.push(walletId);
    walletClause = `AND wallet_id = $${String(params.length)}`;
  }

  // 2. Query CLOSED positions ordered by cycle_number ASC
  const result = await pool.query<{
    cycle_number: number;
    opened_at: Date | string;
    closed_at: Date | string;
    realized_pnl_usd: string;
  }>(
    `SELECT cycle_number, opened_at, closed_at, realized_pnl_usd
       FROM positions
      WHERE token_id = $1
        AND status = 'CLOSED'
        ${walletClause}
      ORDER BY cycle_number ASC`,
    params,
  );

  // 3. Map to PositionHistoryEntry
  return result.rows.map((r) => ({
    cycleNumber: r.cycle_number,
    openedAt: r.opened_at instanceof Date ? r.opened_at.toISOString() : String(r.opened_at),
    closedAt: r.closed_at instanceof Date ? r.closed_at.toISOString() : String(r.closed_at),
    realizedPnlUsd: r.realized_pnl_usd,
  }));
}
