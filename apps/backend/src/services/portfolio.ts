// PortfolioService — US-007

import type { Pool } from "pg";
import type { PriceService } from "./price.js";
import type {
  PortfolioSummary,
  TokenPortfolioRow,
  TokenDetail,
  PositionHistoryEntry,
  ClosedPositionsResponse,
  ClosedTokenGroup,
  ClosedCycle,
  TokenNetwork,
  PriceResult,
  PnlInfo,
} from "../types/portfolio.js";
import type { TransactionType, TransactionSource, CostSource } from "../db/types.js";
import { calculateWAC } from "../position-engine/index.js";
import type { PositionState } from "../position-engine/index.js";
import { toDecimal, roundToStorage, ZERO } from "../position-engine/decimal-utils.js";
import { findByContractAddress } from "./token.js";
import { NotFoundError } from "./errors.js";

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
  wallet_type: "ON_CHAIN" | "CEX";
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
  tx_hash: string | null;
  cex_trade_id: string | null;
  related_tx_id: string | null;
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
  const firstRow = rows[0];
  if (!firstRow) {
    throw new Error("buildVirtualPosition requires at least one row");
  }

  let totalBalance = ZERO;
  let weightedWacNum = ZERO;
  let totalCostBasis = ZERO;
  let totalRealizedPnl = ZERO;
  let earliestOpened = firstRow.opened_at;
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
    id: firstRow.position_id,
    walletId: firstRow.wallet_id,
    tokenId: firstRow.token_id,
    cycleNumber: maxCycle,
    status: "OPEN",
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
  const first = rows[0];
  if (!first) {
    throw new Error("buildPortfolioRow requires at least one row");
  }
  const virtual = buildVirtualPosition(rows);
  const currentPrice = "priceUsd" in priceResult ? priceResult.priceUsd : null;
  const wacResult = calculateWAC(virtual, currentPrice);
  const totalBalance = toDecimal(virtual.balance);
  const totalCurrentValue = currentPrice
    ? roundToStorage(totalBalance.times(toDecimal(currentPrice)))
    : null;

  return {
    symbol: first.symbol,
    network: first.network as TokenNetwork,
    sourceType: first.wallet_type === "ON_CHAIN" ? "ON_CHAIN" : "CEX",
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
    cycleNumber: virtual.cycleNumber,
    priceUnavailable: "priceUnavailable" in priceResult ? true : undefined,
  };
}

// ─── P&L enrichment per transaction ──────────────────────────────────────────

export function computePnl(
  type: string,
  priceUsd: string | null,
  currentPrice: string | null,
  amount: string,
): PnlInfo {
  if (type === "BUY" || type === "SWAP_IN" || type === "TRANSFER_IN" || type === "FIAT_IN") {
    if (priceUsd === null || currentPrice === null) {
      return { kind: "INBOUND", lotPnlUsd: null, lotPnlPct: null };
    }
    const priceD = toDecimal(priceUsd);
    const currentD = toDecimal(currentPrice);
    const amtD = toDecimal(amount);
    const lotPnlUsd = roundToStorage(currentD.minus(priceD).times(amtD));
    const lotPnlPct = priceD.isZero()
      ? null
      : roundToStorage(currentD.minus(priceD).div(priceD).times(100));
    return { kind: "INBOUND", lotPnlUsd, lotPnlPct };
  }
  // OUTBOUND: SELL, SWAP_OUT, TRANSFER_OUT, FIAT_OUT
  // realizedPnlUsd = (currentPrice - priceUsd) × amount; null when either price is null
  const realizedPnlUsd =
    priceUsd !== null && currentPrice !== null
      ? roundToStorage(toDecimal(currentPrice).minus(toDecimal(priceUsd)).times(toDecimal(amount)))
      : null;
  return { kind: "OUTBOUND", displayAs: "Sold/Out", realizedPnlUsd };
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
      row.wallet_type === "ON_CHAIN"
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
  const onChainRequests: { network: "ETH" | "BSC"; address: string }[] = [];
  const cexSymbolsSet = new Set<string>();

  for (const [, groupRows] of groups) {
    const first = groupRows[0];
    if (!first) continue;
    if (first.wallet_type === "ON_CHAIN") {
      onChainRequests.push({
        network: first.network as "ETH" | "BSC",
        address: first.contract_address,
      });
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
    const first = groupRows[0];
    if (!first) continue;
    let priceResult: PriceResult;

    if (first.wallet_type === "ON_CHAIN") {
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
  userId?: string,
): Promise<TokenDetail> {
  // 1. Resolve token → 404 if absent
  const token = await findByContractAddress(pool, contractAddress, network);
  if (!token) {
    throw new NotFoundError(
      `Token '${contractAddress}' on network '${network}' not found`,
      "TOKEN_NOT_FOUND",
    );
  }

  const isCex = network === "CEX_BINANCE";

  // 2. Query OPEN positions for this token (optional wallet filter for ON_CHAIN)
  const posParams: unknown[] = [token.id];
  let walletClause = "";
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
      { network: network, address: contractAddress },
    ]);
    const key = `onchain:${network.toLowerCase()}:${contractAddress.toLowerCase()}`;
    priceResult = pm.get(key) ?? { priceUnavailable: true };
  }

  const currentPrice = "priceUsd" in priceResult ? priceResult.priceUsd : null;

  // 4. Build aggregated position row (null when no OPEN positions)
  const positionRow = posRows.length > 0 ? buildPortfolioRow(posRows, priceResult) : null;

  // 5. Fetch transactions for this token
  //    When walletId is provided → filter by that wallet.
  //    When walletId is absent  → filter by user_id via wallets join so closed-cycle
  //    transactions are still visible even when there is no OPEN position.
  const txParams: unknown[] = [token.id];
  let txFilter = "";
  if (walletId) {
    txParams.push(walletId);
    txFilter = `AND t.wallet_id = $${String(txParams.length)}`;
  } else if (userId) {
    txParams.push(userId);
    txFilter = `AND w.user_id = $${String(txParams.length)}`;
  } else {
    // Fallback: only transactions linked to currently-open positions
    const positionIds = posRows.map((r) => r.position_id);
    txParams.push(positionIds);
    txFilter = `AND t.position_id = ANY($${String(txParams.length)}::uuid[])`;
  }

  const txResult = await pool.query<
    TxRow & { position_wac: string | null; position_status: string | null }
  >(
    `SELECT t.id, t.wallet_id, t.token_id, t.position_id, t.type, t.source,
            t.block_timestamp, t.amount, t.price_usd, t.cost_source,
            t.tx_hash, t.cex_trade_id, t.related_tx_id,
            p.wac AS position_wac, p.status AS position_status
       FROM transactions t
       JOIN wallets w ON w.id = t.wallet_id
       LEFT JOIN positions p ON p.id = t.position_id
      WHERE t.token_id = $1
        ${txFilter}
      ORDER BY t.block_timestamp DESC
      LIMIT 1000`,
    txParams,
  );

  // 6. Enrich each transaction with per-lot P&L
  const transactions = txResult.rows.map((tx) => {
    const ts =
      tx.block_timestamp instanceof Date ? tx.block_timestamp.toISOString() : tx.block_timestamp;

    // Derive costInheritedFrom for INHERITED rows.
    // V1 rule: BINANCE source → 'BINANCE', else → 'ONCHAIN'
    let costInheritedFrom: "ONCHAIN" | "BINANCE" | null = null;
    if (tx.cost_source === "INHERITED") {
      costInheritedFrom = tx.source === "BINANCE" ? "BINANCE" : "ONCHAIN";
    }

    // For closed positions, compute realized P&L using position WAC
    // For open positions, compute unrealized P&L using current market price
    const isClosedPosition = tx.position_status === "CLOSED";
    const wac = tx.position_wac;
    let pnl;
    if (isClosedPosition && wac !== null) {
      // Realized P&L for closed cycles: (price - WAC) * amount
      pnl = computePnl(tx.type, tx.price_usd ?? null, wac, tx.amount);
    } else {
      // Unrealized P&L for open positions: (currentPrice - price) * amount
      pnl = computePnl(tx.type, tx.price_usd ?? null, currentPrice, tx.amount);
    }

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
      txHash: tx.tx_hash ?? null,
      cexTradeId: tx.cex_trade_id ?? null,
      relatedTxId: tx.related_tx_id ?? null,
      costInheritedFrom,
      pnl,
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
    currentPrice,
    priceUnavailable: "priceUnavailable" in priceResult ? true : undefined,
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
      "TOKEN_NOT_FOUND",
    );
  }

  const isCex = network === "CEX_BINANCE";
  const params: unknown[] = [token.id];
  let walletClause = "";
  if (!isCex && walletId) {
    params.push(walletId);
    walletClause = `AND wallet_id = $${String(params.length)}`;
  }

  // 2. Query CLOSED positions ordered by cycle_number ASC
  const result = await pool.query<{
    position_id: string;
    cycle_number: number;
    opened_at: Date | string;
    closed_at: Date | string;
    realized_pnl_usd: string;
  }>(
    `SELECT id AS position_id, cycle_number, opened_at, closed_at, realized_pnl_usd
       FROM positions
      WHERE token_id = $1
        AND status = 'CLOSED'
        ${walletClause}
      ORDER BY cycle_number ASC`,
    params,
  );

  // 3. Derive realized P&L from transaction sums (cost_basis is 0 for closed cycles)
  const positionIds = result.rows.map((r) => r.position_id);
  const txTotals =
    positionIds.length > 0
      ? await pool.query<{
          position_id: string;
          tx_total_cost: string;
          tx_total_proceeds: string;
        }>(
          `SELECT
           position_id,
           COALESCE(SUM(
             CASE WHEN type IN ('BUY','SWAP_IN','TRANSFER_IN')
                  THEN amount * COALESCE(price_usd, 0)
                  ELSE 0
             END
           ), 0) AS tx_total_cost,
           COALESCE(SUM(
             CASE WHEN type IN ('SELL','SWAP_OUT','TRANSFER_OUT')
                  THEN amount * COALESCE(price_usd, 0)
                  ELSE 0
             END
           ), 0) AS tx_total_proceeds
         FROM transactions
         WHERE position_id = ANY($1::uuid[])
         GROUP BY position_id`,
          [positionIds],
        )
      : { rows: [] };

  const txTotalsMap = new Map(
    txTotals.rows.map((r) => [
      r.position_id,
      { cost: toDecimal(r.tx_total_cost), proceeds: toDecimal(r.tx_total_proceeds) },
    ]),
  );

  // 4. Map to PositionHistoryEntry
  return result.rows.map((r) => {
    const txTotal = txTotalsMap.get(r.position_id);
    const cost = txTotal?.cost ?? ZERO;
    const proceeds = txTotal?.proceeds ?? ZERO;
    const realizedPnl = proceeds.minus(cost);
    return {
      cycleNumber: r.cycle_number,
      openedAt: r.opened_at instanceof Date ? r.opened_at.toISOString() : r.opened_at,
      closedAt: r.closed_at instanceof Date ? r.closed_at.toISOString() : r.closed_at,
      realizedPnlUsd: roundToStorage(realizedPnl),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// getClosedPositions — US-017
// ─────────────────────────────────────────────────────────────────────────────

interface ClosedPositionRow {
  position_id: string;
  wallet_id: string;
  cycle_number: number;
  cost_basis: string;
  realized_pnl_usd: string;
  opened_at: Date;
  closed_at: Date;
  token_id: string;
  symbol: string;
  network: string;
  contract_address: string | null;
  wallet_label: string | null;
}

export interface ClosedPositionsFilters {
  walletId?: string;
  network?: string;
  from?: string;
  to?: string;
}

export async function getClosedPositions(
  pool: Pool,
  filters?: ClosedPositionsFilters,
): Promise<ClosedPositionsResponse> {
  const params: unknown[] = [];
  const clauses: string[] = ["p.status = 'CLOSED'"];

  if (filters?.walletId) {
    params.push(filters.walletId);
    clauses.push(`p.wallet_id = $${String(params.length)}`);
  }
  if (filters?.network) {
    params.push(filters.network);
    clauses.push(`t.network = $${String(params.length)}`);
  }
  if (filters?.from) {
    params.push(filters.from);
    clauses.push(`p.closed_at >= $${String(params.length)}::date`);
  }
  if (filters?.to) {
    params.push(filters.to);
    clauses.push(`p.closed_at < ($${String(params.length)}::date + interval '1 day')`);
  }

  const result = await pool.query<ClosedPositionRow>(
    `SELECT
       p.id               AS position_id,
       p.wallet_id        AS wallet_id,
       p.cycle_number     AS cycle_number,
       p.cost_basis       AS cost_basis,
       p.realized_pnl_usd AS realized_pnl_usd,
       p.opened_at        AS opened_at,
       p.closed_at        AS closed_at,
       t.id               AS token_id,
       t.symbol           AS symbol,
       t.network          AS network,
       t.contract_address AS contract_address,
       w.label            AS wallet_label
     FROM positions p
     JOIN tokens  t ON t.id = p.token_id
     JOIN wallets w ON w.id = p.wallet_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY t.symbol ASC, t.network ASC, p.closed_at DESC`,
    params,
  );

  // Fetch transaction totals (cost & proceeds) for all returned positions.
  // We do this because cost_basis on a closed position is 0
  // (WAC × 0 balance), so the historic cycle cost must be derived
  // from the raw transaction rows.
  const positionIds = result.rows.map((r) => r.position_id);
  const txTotals =
    positionIds.length > 0
      ? await pool.query<{
          position_id: string;
          tx_total_cost: string;
          tx_total_proceeds: string;
        }>(
          `SELECT
           position_id,
           COALESCE(SUM(
             CASE WHEN type IN ('BUY','SWAP_IN','TRANSFER_IN')
                  THEN amount * COALESCE(price_usd, 0)
                  ELSE 0
             END
           ), 0) AS tx_total_cost,
           COALESCE(SUM(
             CASE WHEN type IN ('SELL','SWAP_OUT','TRANSFER_OUT')
                  THEN amount * COALESCE(price_usd, 0)
                  ELSE 0
             END
           ), 0) AS tx_total_proceeds
         FROM transactions
         WHERE position_id = ANY($1::uuid[])
         GROUP BY position_id`,
          [positionIds],
        )
      : { rows: [] };

  const txTotalsMap = new Map(
    txTotals.rows.map((r) => [
      r.position_id,
      { cost: toDecimal(r.tx_total_cost), proceeds: toDecimal(r.tx_total_proceeds) },
    ]),
  );

  // Group by token_id
  const tokenGroups = new Map<string, ClosedPositionRow[]>();
  for (const row of result.rows) {
    const existing = tokenGroups.get(row.token_id);
    if (existing) {
      existing.push(row);
    } else {
      tokenGroups.set(row.token_id, [row]);
    }
  }

  let grandTotalPnl = ZERO;
  let grandTotalCycles = 0;
  const byToken: ClosedTokenGroup[] = [];

  for (const [tokenId, rows] of tokenGroups) {
    const first = rows[0];
    if (!first) continue;
    let tokenPnl = ZERO;
    const cycles: ClosedCycle[] = [];

    for (const row of rows) {
      // Use transaction-derived totals when available; fallback to the
      // stored cost_basis (non-zero for open positions, zero for closed).
      const txTotal = txTotalsMap.get(row.position_id);
      const costBasis = txTotal?.cost ?? toDecimal(row.cost_basis);
      const proceeds = txTotal?.proceeds ?? ZERO;
      const realizedPnl = proceeds.minus(costBasis);
      const pnlPct = costBasis.isZero()
        ? null
        : roundToStorage(realizedPnl.div(costBasis).times(100));

      tokenPnl = tokenPnl.plus(realizedPnl);
      cycles.push({
        cycleNumber: row.cycle_number,
        walletId: row.wallet_id,
        walletLabel: row.wallet_label,
        openedAt:
          row.opened_at instanceof Date ? row.opened_at.toISOString() : String(row.opened_at),
        closedAt:
          row.closed_at instanceof Date ? row.closed_at.toISOString() : String(row.closed_at),
        totalCostUsd: roundToStorage(costBasis),
        totalProceedsUsd: roundToStorage(proceeds),
        realizedPnlUsd: roundToStorage(realizedPnl),
        realizedPnlPct: pnlPct,
      });
    }

    grandTotalPnl = grandTotalPnl.plus(tokenPnl);
    grandTotalCycles += cycles.length;

    byToken.push({
      tokenId,
      symbol: first.symbol,
      network: first.network as TokenNetwork,
      contractAddress: first.contract_address,
      totalRealizedPnlUsd: roundToStorage(tokenPnl),
      cycleCount: cycles.length,
      cycles,
    });
  }

  return {
    totalRealizedPnlUsd: roundToStorage(grandTotalPnl),
    totalClosedCycles: grandTotalCycles,
    byToken,
  };
}
