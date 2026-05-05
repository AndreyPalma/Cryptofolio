# Design: US-007 — Portfolio API (PriceService + PortfolioService + routes)

> **Goal**: Implement the three read-aggregate endpoints (`/api/portfolio`, `/api/portfolio/token/:contractAddress/:network`, and `.../history`) on top of the existing position-engine and CRUD services. The design is precise enough that an implementation agent can produce the exact code without re-deciding architectural questions.

> **Source of truth for math**: `position-engine/engine.ts::calculateWAC`. PortfolioService MUST NOT reimplement P&L math — it builds a virtual `PositionState` for the aggregated row and delegates.

---

## 1. Files & Module Layout

```
apps/backend/src/
├── services/
│   ├── price.ts                    ← NEW
│   ├── portfolio.ts                ← NEW
│   ├── token.ts                    ← MODIFIED (+findByContractAddress)
│   └── __tests__/
│       ├── price.test.ts           ← NEW
│       └── portfolio.test.ts       ← NEW
├── routes/
│   └── portfolio.ts                ← NEW
├── types/
│   └── portfolio.ts                ← NEW (Zod schemas + inferred types)
└── index.ts                        ← MODIFIED (register portfolioRoutes)

tests/e2e/api/
└── portfolio.test.ts               ← NEW
```

---

## 2. TypeScript Types — `apps/backend/src/types/portfolio.ts`

All decimal values serialize as `string` (never `number`) — same convention used by `transactions.amount`/`positions.wac` across the backend. Zod schemas are co-located with inferred types (per `zod-4` standard).

```typescript
import { z } from 'zod';
import { NETWORKS } from '../db/types.js';

// ─── Network schema (reuses DB enum) ──────────────────────────────────────────
export const TokenNetworkSchema = z.enum(NETWORKS);
export type TokenNetwork = z.infer<typeof TokenNetworkSchema>;

// ─── Source-type indicator (derived from network) ─────────────────────────────
export const TokenSourceTypeSchema = z.enum(['ON_CHAIN', 'CEX']);
export type TokenSourceType = z.infer<typeof TokenSourceTypeSchema>;

// ─── Wallet breakdown (only meaningful for ON_CHAIN, but always present) ─────
export const WalletBreakdownEntrySchema = z.object({
  walletId: z.uuid(),
  label: z.string(),
  balance: z.string(),         // Decimal as string
  wac: z.string(),             // Decimal as string
});
export type WalletBreakdownEntry = z.infer<typeof WalletBreakdownEntrySchema>;

// ─── A single row in the portfolio summary ───────────────────────────────────
// For ON_CHAIN: aggregated across wallets that hold the same (contract_address, network).
// For CEX:     one row per OPEN position (single Binance wallet by invariant).
export const TokenPortfolioRowSchema = z.object({
  symbol: z.string(),
  network: TokenNetworkSchema,
  sourceType: TokenSourceTypeSchema,
  contractAddress: z.string(),
  binanceSymbol: z.string().nullable(),
  totalBalance: z.string(),
  wacAggregated: z.string(),
  totalCostBasis: z.string(),
  currentPrice: z.string().nullable(),
  totalCurrentValue: z.string().nullable(),
  pnlUsd: z.string().nullable(),
  pnlPct: z.string().nullable(),
  walletCount: z.number().int().nonnegative(),
  walletBreakdown: z.array(WalletBreakdownEntrySchema),
  priceUnavailable: z.boolean().optional(),
});
export type TokenPortfolioRow = z.infer<typeof TokenPortfolioRowSchema>;

// ─── Portfolio summary payload ───────────────────────────────────────────────
// Totals exclude rows with priceUnavailable=true.
export const PortfolioSummarySchema = z.object({
  totalValueUsd: z.string(),
  totalCostBasis: z.string(),
  totalPnlUsd: z.string(),
  totalPnlPct: z.string(),
  tokens: z.array(TokenPortfolioRowSchema),
});
export type PortfolioSummary = z.infer<typeof PortfolioSummarySchema>;

// ─── Per-lot P&L union ───────────────────────────────────────────────────────
// Inbound with priceUsd present + currentPrice known → numeric values.
// Inbound with priceUsd null OR currentPrice unknown   → numeric fields = null.
// Outbound                                             → { displayAs: 'Sold/Out' }.
export const InboundPnlSchema = z.object({
  kind: z.literal('INBOUND'),
  lotPnlUsd: z.string().nullable(),
  lotPnlPct: z.string().nullable(),
});
export const OutboundPnlSchema = z.object({
  kind: z.literal('OUTBOUND'),
  displayAs: z.literal('Sold/Out'),
});
export const PnlInfoSchema = z.discriminatedUnion('kind', [
  InboundPnlSchema,
  OutboundPnlSchema,
]);
export type PnlInfo = z.infer<typeof PnlInfoSchema>;

// ─── Transaction with per-lot P&L enrichment ─────────────────────────────────
export const TransactionWithPnlSchema = z.object({
  id: z.uuid(),
  walletId: z.uuid(),
  tokenId: z.uuid(),
  positionId: z.uuid().nullable(),
  type: z.enum(['BUY', 'SELL', 'SWAP_IN', 'SWAP_OUT', 'TRANSFER_IN', 'TRANSFER_OUT']),
  source: z.enum(['ETHERSCAN', 'BSCTRACE', 'BINANCE', 'MANUAL']),
  blockTimestamp: z.iso.datetime(),
  amount: z.string(),
  priceUsd: z.string().nullable(),
  costSource: z.enum(['MARKET', 'INHERITED', 'MANUAL']).nullable(),
  pnl: PnlInfoSchema,
});
export type TransactionWithPnl = z.infer<typeof TransactionWithPnlSchema>;

// ─── Token detail payload ────────────────────────────────────────────────────
// Aggregated stats for ON_CHAIN match the row shape from the summary.
// CEX: one wallet, one position → walletBreakdown has one entry.
export const TokenDetailSchema = z.object({
  token: z.object({
    id: z.uuid(),
    symbol: z.string(),
    name: z.string().nullable(),
    network: TokenNetworkSchema,
    contractAddress: z.string(),
    binanceSymbol: z.string().nullable(),
    decimals: z.number().int(),
    targetExitPrice: z.string().nullable(),
  }),
  position: TokenPortfolioRowSchema,
  transactions: z.array(TransactionWithPnlSchema),
});
export type TokenDetail = z.infer<typeof TokenDetailSchema>;

// ─── Closed-cycle history entry ──────────────────────────────────────────────
export const PositionHistoryEntrySchema = z.object({
  cycleNumber: z.number().int().positive(),
  openedAt: z.iso.datetime(),
  closedAt: z.iso.datetime(),
  realizedPnlUsd: z.string(),
});
export type PositionHistoryEntry = z.infer<typeof PositionHistoryEntrySchema>;

export const PositionHistoryResponseSchema = z.object({
  cycles: z.array(PositionHistoryEntrySchema),
});
export type PositionHistoryResponse = z.infer<typeof PositionHistoryResponseSchema>;

// ─── PriceService result ─────────────────────────────────────────────────────
// Discriminated by presence of `priceUnavailable`. Using a union (not nullable
// number) lets call sites narrow safely with `noUncheckedIndexedAccess`.
export type PriceResult =
  | { readonly priceUsd: string }                  // Decimal string, never NaN
  | { readonly priceUnavailable: true };
```

### Type-naming conventions enforced

- **Named exports only** (project standard).
- Zod schemas suffixed `Schema`, inferred types unsuffixed.
- DB enums (`NETWORKS`, etc.) imported from `db/types.ts` — DO NOT redeclare.
- All money/balance fields `z.string()` (decimal-as-string), never `z.number()`.

---

## 3. PriceService — `apps/backend/src/services/price.ts`

### 3.1. Module shape

Module-level singleton cache (per-process), exported as a namespaced object so it is **trivially mockable** in tests. No class — keeps consistent with `wallet.ts`/`token.ts`/`transaction.ts` style.

```typescript
import { z } from 'zod';
import type { FastifyBaseLogger } from 'fastify';

// ─── Cache primitives ────────────────────────────────────────────────────────
type CacheEntry = {
  readonly priceUsd: string | null;     // null = "fetch failed last attempt"
  readonly expiresAt: number;           // Date.now() + TTL
};

const TTL_DEFILLAMA_MS = 60_000;
const TTL_BINANCE_MS   = 10_000;
const FETCH_TIMEOUT_MS = 5_000;

const cache = new Map<string, CacheEntry>();

// ─── Cache key helpers ───────────────────────────────────────────────────────
function onChainKey(network: 'ETH' | 'BSC', address: string): string {
  return `onchain:${network.toLowerCase()}:${address.toLowerCase()}`;
}
function cexKey(binanceSymbol: string): string {
  return `cex:${binanceSymbol.toUpperCase()}`;
}

// ─── DefiLlama chain mapping ─────────────────────────────────────────────────
function defiLlamaChain(network: 'ETH' | 'BSC'): 'ethereum' | 'bsc' {
  return network === 'ETH' ? 'ethereum' : 'bsc';
}
```

### 3.2. Public API

```typescript
export interface PriceService {
  getOnChainPrice(network: 'ETH' | 'BSC', address: string): Promise<PriceResult>;
  getCexPrice(binanceSymbol: string): Promise<PriceResult>;
  getOnChainPricesBulk(
    requests: ReadonlyArray<{ network: 'ETH' | 'BSC'; address: string }>,
  ): Promise<Map<string, PriceResult>>; // key = onChainKey(network, address)
  /** Test-only — not exported in production builds. */
  __resetCacheForTests?(): void;
}

export function createPriceService(log: FastifyBaseLogger): PriceService;
```

> **Why `createPriceService(log)` factory rather than top-level functions?** The cache itself stays module-level (process singleton — survives across requests), but the factory captures the Fastify logger so failure logging carries request context. Tests build it with a stub logger.

### 3.3. DefiLlama call (single + bulk)

Endpoint: `GET https://coins.llama.fi/prices/current/{coins}` where `{coins}` is comma-separated `chain:address` (e.g. `ethereum:0xaaa...,bsc:0xbbb...`).

```typescript
// Bulk request — used by PortfolioService for the summary endpoint
async function fetchDefiLlamaBulk(
  requests: ReadonlyArray<{ network: 'ETH' | 'BSC'; address: string }>,
  log: FastifyBaseLogger,
): Promise<Map<string, PriceResult>> {
  const result = new Map<string, PriceResult>();
  if (requests.length === 0) return result;

  const coinsParam = requests
    .map((r) => `${defiLlamaChain(r.network)}:${r.address.toLowerCase()}`)
    .join(',');

  const url = `https://coins.llama.fi/prices/current/${coinsParam}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      log.warn({ url, status: res.status, source: 'DEFILLAMA' }, 'price fetch non-200');
      // Mark every requested key as unavailable (so caller doesn't retry within TTL)
      for (const r of requests) markUnavailable(onChainKey(r.network, r.address), TTL_DEFILLAMA_MS);
      // Populate result map with priceUnavailable
      for (const r of requests) result.set(onChainKey(r.network, r.address), { priceUnavailable: true });
      return result;
    }

    const json: unknown = await res.json();
    const parsed = DefiLlamaResponseSchema.safeParse(json);
    if (!parsed.success) {
      log.warn({ url, source: 'DEFILLAMA', issues: parsed.error.issues }, 'price schema mismatch');
      for (const r of requests) {
        markUnavailable(onChainKey(r.network, r.address), TTL_DEFILLAMA_MS);
        result.set(onChainKey(r.network, r.address), { priceUnavailable: true });
      }
      return result;
    }

    // Map each requested key. DefiLlama returns missing tokens by simply omitting them.
    for (const r of requests) {
      const apiKey = `${defiLlamaChain(r.network)}:${r.address.toLowerCase()}`;
      const coin = parsed.data.coins[apiKey];
      const cKey = onChainKey(r.network, r.address);
      if (!coin) {
        markUnavailable(cKey, TTL_DEFILLAMA_MS);
        result.set(cKey, { priceUnavailable: true });
      } else {
        const priceStr = String(coin.price);
        cache.set(cKey, { priceUsd: priceStr, expiresAt: Date.now() + TTL_DEFILLAMA_MS });
        result.set(cKey, { priceUsd: priceStr });
      }
    }
    return result;
  } catch (err) {
    log.warn({ url, source: 'DEFILLAMA', err: String(err) }, 'price fetch threw');
    for (const r of requests) {
      markUnavailable(onChainKey(r.network, r.address), TTL_DEFILLAMA_MS);
      result.set(onChainKey(r.network, r.address), { priceUnavailable: true });
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

function markUnavailable(key: string, ttl: number): void {
  cache.set(key, { priceUsd: null, expiresAt: Date.now() + ttl });
}

// Zod schema for DefiLlama response — `unknown` narrowed at boundary
const DefiLlamaCoinSchema = z.object({
  price: z.number(),
  symbol: z.string().optional(),
  decimals: z.number().optional(),
  timestamp: z.number().optional(),
  confidence: z.number().optional(),
});
const DefiLlamaResponseSchema = z.object({
  coins: z.record(z.string(), DefiLlamaCoinSchema),
});
```

### 3.4. Binance ticker call

Endpoint: `GET https://api.binance.com/api/v3/ticker/price?symbol={binanceSymbol}USDT`. Per-symbol only (no batch with arbitrary symbols).

```typescript
async function fetchBinanceTicker(
  binanceSymbol: string,
  log: FastifyBaseLogger,
): Promise<PriceResult> {
  const cKey = cexKey(binanceSymbol);
  const url = `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(
    binanceSymbol.toUpperCase(),
  )}USDT`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      log.warn({ url, status: res.status, source: 'BINANCE' }, 'price fetch non-200');
      markUnavailable(cKey, TTL_BINANCE_MS);
      return { priceUnavailable: true };
    }
    const json: unknown = await res.json();
    const parsed = BinanceTickerSchema.safeParse(json);
    if (!parsed.success) {
      log.warn({ url, source: 'BINANCE', issues: parsed.error.issues }, 'price schema mismatch');
      markUnavailable(cKey, TTL_BINANCE_MS);
      return { priceUnavailable: true };
    }
    cache.set(cKey, { priceUsd: parsed.data.price, expiresAt: Date.now() + TTL_BINANCE_MS });
    return { priceUsd: parsed.data.price };
  } catch (err) {
    log.warn({ url, source: 'BINANCE', err: String(err) }, 'price fetch threw');
    markUnavailable(cKey, TTL_BINANCE_MS);
    return { priceUnavailable: true };
  } finally {
    clearTimeout(timer);
  }
}

const BinanceTickerSchema = z.object({
  symbol: z.string(),
  price: z.string(),  // Binance returns price as string already — keep as-is
});
```

### 3.5. Cache lookup

`getOnChainPrice` and `getCexPrice` both check cache first; fall through to fetch if expired. `null` cached entry is treated as `priceUnavailable` until TTL elapses (prevents thundering herd on persistent failures).

```typescript
function readCache(key: string): PriceResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.priceUsd === null
    ? { priceUnavailable: true }
    : { priceUsd: entry.priceUsd };
}
```

### 3.6. Failure invariants (CRITICAL — PRD)

- `fetch` rejects → `priceUnavailable: true` + warn log.
- HTTP non-2xx → `priceUnavailable: true` + warn log.
- Schema parse fails → `priceUnavailable: true` + warn log (truncated body in log).
- Timeout (5s `AbortController`) → `priceUnavailable: true` + warn log.
- **PriceService NEVER throws.** Every public method returns `Promise<PriceResult>` or `Promise<Map<string, PriceResult>>`.

---

## 4. PortfolioService — `apps/backend/src/services/portfolio.ts`

### 4.1. Public API

```typescript
import type { Pool } from 'pg';
import type { PriceService } from './price.js';
import type {
  PortfolioSummary,
  TokenDetail,
  PositionHistoryEntry,
  TokenNetwork,
} from '../types/portfolio.js';

export async function getPortfolioSummary(
  pool: Pool,
  priceService: PriceService,
): Promise<PortfolioSummary>;

export async function getTokenDetail(
  pool: Pool,
  priceService: PriceService,
  contractAddress: string,
  network: TokenNetwork,
  walletId?: string,
): Promise<TokenDetail>;

export async function getPositionHistory(
  pool: Pool,
  contractAddress: string,
  network: TokenNetwork,
  walletId?: string,
): Promise<PositionHistoryEntry[]>;
```

### 4.2. Internal row shape (raw query result)

```typescript
interface PositionRow {
  // positions
  position_id: string;
  wallet_id: string;
  cycle_number: number;
  status: 'OPEN' | 'CLOSED';
  balance: string;
  wac: string;
  cost_basis: string;
  realized_pnl_usd: string;
  opened_at: Date;
  closed_at: Date | null;
  // tokens
  token_id: string;
  symbol: string;
  name: string | null;
  network: TokenNetwork;
  contract_address: string;
  binance_symbol: string | null;
  decimals: number;
  target_exit_price: string | null;
  // wallets
  wallet_label: string;
  wallet_type: 'ON_CHAIN' | 'CEX';
}
```

### 4.3. `getPortfolioSummary` — algorithm

```
1. SQL: load every OPEN position joined with token + wallet metadata.
2. Group rows by groupKey(row):
     - ON_CHAIN: lower(contract_address) + ':' + network
     - CEX:     position_id (one row, CEX never aggregates)
   Use Map<string, PositionRow[]>.
3. Build the price-fetch plan from grouped data:
     - One DefiLlama bulk call: every distinct (network, contract_address) where wallet_type='ON_CHAIN'.
     - Promise.all of Binance ticker calls: every distinct binance_symbol where wallet_type='CEX' and binance_symbol is not null.
     - CEX with binance_symbol=null → priceUnavailable: true (no fetch).
4. For each group, build a virtual PositionState:
     - balance       = Σ row.balance                 (Decimal, then roundToStorage)
     - wac           = Σ(balance_i × wac_i) / balance (Decimal, then roundToStorage)
     - costBasis     = Σ row.cost_basis              (Decimal, then roundToStorage)
     - realizedPnlUsd = Σ row.realized_pnl_usd       (kept for completeness; not used for unrealized)
     - cycleNumber   = max row.cycle_number          (single-row groups: that row's value)
     - status        = 'OPEN'
     - openedAt      = min row.opened_at
     - closedAt      = null
     - id, walletId, tokenId — first row's values (placeholder; not used by calculateWAC math)
5. priceLookup → PriceResult per group.
6. Call calculateWAC(virtualPosition, priceResult.priceUsd ?? null) to get unrealizedPnlUsd / unrealizedPnlPct.
7. Build TokenPortfolioRow:
     - currentPrice         = priceResult.priceUsd or null
     - totalCurrentValue    = if currentPrice: balance × currentPrice (Decimal); else null
     - pnlUsd / pnlPct      = wacResult.unrealizedPnlUsd / unrealizedPnlPct
     - walletCount          = group.length
     - walletBreakdown      = group.map(r => ({ walletId, label, balance, wac }))
     - priceUnavailable     = (priceResult is { priceUnavailable: true }) ? true : undefined
8. Totals (rows with priceUnavailable EXCLUDED from totalValueUsd / totalPnlUsd / totalPnlPct;
   totalCostBasis sums ALL rows since cost basis exists regardless of price availability):
     - totalValueUsd        = Σ row.totalCurrentValue   where currentPrice != null
     - totalCostBasis       = Σ row.totalCostBasis
     - totalPnlUsd          = Σ row.pnlUsd              where pnlUsd != null
     - totalPnlPct          = (totalPnlUsd / totalCostBasis) × 100, or "0" if costBasis is zero
9. Sort tokens array by symbol ASC then network ASC for deterministic output.
```

#### 4.3.1. Decimal helpers

Reuse `position-engine/decimal-utils.ts::{ toDecimal, roundToStorage, ZERO }`. **Never use `Number()` or JS arithmetic operators on balance/price/wac strings.**

```typescript
import { toDecimal, roundToStorage, ZERO } from '../position-engine/decimal-utils.js';
import { calculateWAC, type PositionState } from '../position-engine/index.js';
```

#### 4.3.2. Virtual position construction (key snippet)

```typescript
function buildVirtualPosition(rows: PositionRow[]): PositionState {
  let totalBalance = ZERO;
  let weightedWacNumerator = ZERO;       // Σ(balance_i × wac_i)
  let totalCostBasis = ZERO;
  let totalRealizedPnl = ZERO;
  let earliestOpened: Date = rows[0]!.opened_at;
  let maxCycle = 0;

  for (const r of rows) {
    const b = toDecimal(r.balance);
    const w = toDecimal(r.wac);
    totalBalance = totalBalance.plus(b);
    weightedWacNumerator = weightedWacNumerator.plus(b.times(w));
    totalCostBasis = totalCostBasis.plus(toDecimal(r.cost_basis));
    totalRealizedPnl = totalRealizedPnl.plus(toDecimal(r.realized_pnl_usd));
    if (r.opened_at < earliestOpened) earliestOpened = r.opened_at;
    if (r.cycle_number > maxCycle) maxCycle = r.cycle_number;
  }

  const wacAggregated = totalBalance.isZero()
    ? ZERO
    : weightedWacNumerator.div(totalBalance);

  return {
    id: rows[0]!.position_id,            // placeholder; not used by calculateWAC
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
```

### 4.4. `getTokenDetail` — algorithm

```
1. tokenService.findByContractAddress(pool, contractAddress, network) → 404 if null.
2. Determine wallet filter:
     - ON_CHAIN + walletId present  → filter by wallet_id
     - ON_CHAIN + walletId absent   → all ON_CHAIN positions for that token
     - CEX                          → ignore walletId silently (always single Binance wallet)
3. Run the same query as getPortfolioSummary but with WHERE token.id = $1 [AND wallet_id = $2 if ON_CHAIN].
   If no OPEN rows → 404 (token exists but no active position).
4. Build the aggregated TokenPortfolioRow exactly like in getPortfolioSummary (single group).
5. Fetch transactions for the position(s):
     - If single position → existing transactionService.listTransactions({ wallet_id, token_id, position_id, limit: 1000, offset: 0 }).
     - If multiple positions (multi-wallet ON_CHAIN, no walletId filter) → query directly:
         SELECT * FROM transactions WHERE token_id = $1 AND position_id = ANY($2::uuid[])
         ORDER BY block_timestamp DESC LIMIT 1000.
6. Enrich each transaction with PnlInfo:
     - If type ∈ {BUY, SWAP_IN, TRANSFER_IN}:
         kind = 'INBOUND'
         if priceUsd != null AND currentPrice != null:
           lotPnlUsd = (currentPrice - priceUsd) × amount      [Decimal, roundToStorage]
           lotPnlPct = (currentPrice - priceUsd) / priceUsd × 100  [Decimal, roundToStorage; null if priceUsd is zero]
         else:
           lotPnlUsd = null
           lotPnlPct = null
     - If type ∈ {SELL, SWAP_OUT, TRANSFER_OUT}:
         kind = 'OUTBOUND', displayAs = 'Sold/Out'
7. Return { token, position: aggregatedRow, transactions: enriched }.
```

### 4.5. `getPositionHistory` — algorithm

```
1. tokenService.findByContractAddress(pool, contractAddress, network) → 404 if null.
2. Run history SQL (see §5.2). If walletId provided AND token is ON_CHAIN, add wallet filter.
3. Map each row to PositionHistoryEntry with ISO-8601 strings for openedAt/closedAt.
4. Return array sorted by cycle_number ASC (DB already orders, but call site MUST NOT depend on driver order — assert in test).
```

---

## 5. SQL Queries (final, verbatim)

### 5.1. Portfolio summary query

```sql
SELECT
  p.id            AS position_id,
  p.wallet_id     AS wallet_id,
  p.cycle_number  AS cycle_number,
  p.status        AS status,
  p.balance       AS balance,
  p.wac           AS wac,
  p.cost_basis    AS cost_basis,
  p.realized_pnl_usd AS realized_pnl_usd,
  p.opened_at     AS opened_at,
  p.closed_at     AS closed_at,
  t.id            AS token_id,
  t.symbol        AS symbol,
  t.name          AS name,
  t.network       AS network,
  t.contract_address AS contract_address,
  t.binance_symbol   AS binance_symbol,
  t.decimals      AS decimals,
  t.target_exit_price AS target_exit_price,
  w.label         AS wallet_label,
  w.wallet_type   AS wallet_type
FROM positions p
JOIN tokens   t ON t.id = p.token_id
JOIN wallets  w ON w.id = p.wallet_id
WHERE p.status = 'OPEN'
ORDER BY t.symbol ASC, t.network ASC, w.created_at ASC;
```

### 5.2. Position history query

```sql
SELECT cycle_number, opened_at, closed_at, realized_pnl_usd
FROM positions
WHERE token_id = $1
  AND status = 'CLOSED'
  -- optional: AND wallet_id = $2
ORDER BY cycle_number ASC;
```

### 5.3. Token detail query (one token)

```sql
-- Same select as §5.1 plus:
WHERE p.status = 'OPEN'
  AND t.id = $1
  -- optional: AND p.wallet_id = $2     (ON_CHAIN only)
ORDER BY w.created_at ASC;
```

### 5.4. Multi-position transactions query (when no walletId filter on ON_CHAIN)

```sql
SELECT
  id, wallet_id, token_id, position_id, type, source,
  tx_hash, tx_log_index, cex_trade_id, related_tx_id,
  block_timestamp, amount, price_usd, cost_source,
  commission_asset, commission_amount, from_address, to_address, created_at
FROM transactions
WHERE token_id = $1
  AND position_id = ANY($2::uuid[])
ORDER BY block_timestamp DESC
LIMIT 1000;
```

---

## 6. Route plugin — `apps/backend/src/routes/portfolio.ts`

```typescript
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import pg from 'pg';
import {
  getPortfolioSummary,
  getTokenDetail,
  getPositionHistory,
} from '../services/portfolio.js';
import { createPriceService } from '../services/price.js';
import { TokenNetworkSchema } from '../types/portfolio.js';

const { Pool } = pg;

const TokenParamsSchema = z.object({
  contractAddress: z.string().min(1),
  network: TokenNetworkSchema,
});

const TokenDetailQuerySchema = z.object({
  wallet_id: z.uuid().optional(),
});

// eslint-disable-next-line @typescript-eslint/require-await
export const portfolioRoutes: FastifyPluginAsync = async (fastify) => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const priceService = createPriceService(fastify.log);

  // GET /
  fastify.get('/', async (_req, reply) => {
    const summary = await getPortfolioSummary(pool, priceService);
    return reply.status(200).send(summary);
  });

  // GET /token/:contractAddress/:network
  fastify.get('/token/:contractAddress/:network', async (req, reply) => {
    const params = TokenParamsSchema.parse(req.params);
    const query  = TokenDetailQuerySchema.parse(req.query);
    const detail = await getTokenDetail(
      pool, priceService,
      params.contractAddress, params.network,
      query.wallet_id,
    );
    return reply.status(200).send(detail);
  });

  // GET /token/:contractAddress/:network/history
  fastify.get('/token/:contractAddress/:network/history', async (req, reply) => {
    const params = TokenParamsSchema.parse(req.params);
    const query  = TokenDetailQuerySchema.parse(req.query);
    const cycles = await getPositionHistory(
      pool,
      params.contractAddress, params.network,
      query.wallet_id,
    );
    return reply.status(200).send({ cycles });
  });
};
```

> **Note**: ZodError handling is centralized in `index.ts::setErrorHandler`. Service-level errors (`NotFoundError`, etc. from `services/errors.ts`) bubble through the same handler. JWT auth on `/api/*` is inherited from `authPlugin` — nothing to wire here.

---

## 7. Modifications to existing files

### 7.1. `apps/backend/src/services/token.ts` — add `findByContractAddress`

Append after `updateToken`:

```typescript
export async function findByContractAddress(
  pool: Pool,
  contractAddress: string,
  network: string,
): Promise<Token | null> {
  const result = await pool.query<Token>(
    `SELECT id, symbol, name, network, contract_address, decimals, binance_symbol,
            is_hidden, target_exit_price, created_at
       FROM tokens
       WHERE network = $1 AND lower(contract_address) = lower($2)
       LIMIT 1`,
    [network, contractAddress],
  );
  return result.rows[0] ?? null;
}
```

Uses the existing partial UNIQUE index `(network, lower(contract_address)) WHERE contract_address IS NOT NULL`, so it's an index hit. Returns `null` when not found — caller (`PortfolioService`) raises `NotFoundError`.

### 7.2. `apps/backend/src/index.ts` — register portfolio plugin

Add inside `buildServer`, after the existing `transactionRoutes` registration:

```typescript
const { portfolioRoutes } = await import('./routes/portfolio.js');
await fastify.register(portfolioRoutes, { prefix: '/api/portfolio' });
```

### 7.3. `apps/backend/src/types/token.ts` — no change required

The existing `Token` interface already covers `findByContractAddress`'s return shape.

---

## 8. Test plan

All tests follow strict-TDD: **RED → GREEN → REFACTOR**, one assertion at a time.

### 8.1. Unit — `services/__tests__/price.test.ts`

`vi.stubGlobal('fetch', vi.fn())` per test; `__resetCacheForTests()` in `beforeEach`.

| # | Case | Setup | Assertion |
|---|------|-------|-----------|
| P1 | DefiLlama bulk happy path | mock fetch → 200 + valid JSON for 2 tokens | one fetch call; URL has comma-separated coins; map has `priceUsd` per key |
| P2 | DefiLlama partial response | mock returns coins for only 1 of 2 requested | first key `priceUsd`, second key `priceUnavailable: true` |
| P3 | DefiLlama 5xx | mock 500 | all keys `priceUnavailable: true`; warn called |
| P4 | DefiLlama timeout | mock fetch hangs > 5s, rely on AbortError | all keys `priceUnavailable: true`; warn called |
| P5 | DefiLlama schema mismatch | mock returns `{ wrong: 'shape' }` | priceUnavailable + warn |
| P6 | Cache hit DefiLlama | call twice within 60s | fetch called once |
| P7 | Cache expiry DefiLlama | call once, advance `vi.useFakeTimers()` past 60s, call again | fetch called twice |
| P8 | Negative cache | fetch fails → next call within TTL → returns priceUnavailable without re-fetching | fetch called once |
| P9 | Binance happy | mock 200 + `{symbol:"BTCUSDT",price:"60000.00"}` | `priceUsd: '60000.00'` |
| P10 | Binance per-symbol parallel | call getCexPrice for 3 symbols simultaneously | 3 fetches, all return correctly |
| P11 | Binance 4xx | mock 400 | priceUnavailable + warn |
| P12 | Binance schema mismatch | wrong shape | priceUnavailable + warn |
| P13 | Cache key normalization | call with mixed-case symbol/address | second call with different casing hits cache |

### 8.2. Unit — `services/__tests__/portfolio.test.ts`

Mock `Pool` (`vi.fn` for `pool.query`) and a stub `PriceService`. No DB.

| # | Case | Assertion |
|---|------|-----------|
| F1 | Two ON_CHAIN wallets, same token (ETH+BSC distinct) | 2 separate rows (different network) |
| F2 | Two ON_CHAIN wallets, same (network, contractAddress) | 1 row aggregated; walletCount=2; weighted WAC correct via decimal.js |
| F3 | ETH on-chain + ETH on Binance | 2 separate rows (one ON_CHAIN, one CEX); never merged |
| F4 | Token without OPEN position | not in result |
| F5 | Price unavailable for one row | row has `priceUnavailable: true`; `currentPrice/totalCurrentValue/pnlUsd/pnlPct` are null; totals exclude this row's value/pnl |
| F6 | Decimal precision | weighted WAC of `0.123456789` and `0.987654321` does NOT drift (compare exact string) |
| F7 | `getTokenDetail` ON_CHAIN with `walletId` | filters to one position; walletBreakdown.length = 1 |
| F8 | `getTokenDetail` CEX with walletId | walletId ignored; uses Binance wallet |
| F9 | `getTokenDetail` token not found | throws NotFoundError |
| F10 | `getTokenDetail` token exists, no OPEN position | throws NotFoundError |
| F11 | Per-lot P&L: BUY with priceUsd + currentPrice | `kind:'INBOUND'`, lotPnlUsd computed, lotPnlPct computed |
| F12 | Per-lot P&L: TRANSFER_IN with priceUsd null | `kind:'INBOUND'`, both null |
| F13 | Per-lot P&L: SELL | `kind:'OUTBOUND', displayAs:'Sold/Out'` |
| F14 | Per-lot P&L: priceUsd zero | lotPnlPct null (avoid div-by-zero) |
| F15 | `getPositionHistory` returns CLOSED only, sorted ASC | assert order + only CLOSED |
| F16 | Totals: pnlPct = 0 when costBasis is zero | no NaN |
| F17 | calculateWAC reuse — verify by spying that engine's calculateWAC is called with virtual position | spy assertion |

### 8.3. E2E — `tests/e2e/api/portfolio.test.ts`

Real Supabase test DB + `buildServer()` + `vi.stubGlobal('fetch', ...)` for external APIs only.

Setup helper: insert 2 ON_CHAIN wallets (ETH+BSC), 1 CEX wallet, 3 tokens (ETH/BSC ERC-20 + Binance ETH), seed transactions to open 2 OPEN positions and 1 CLOSED cycle on one token.

| # | Case | Assertion |
|---|------|-----------|
| E1 | `GET /api/portfolio` happy | 200; `tokens.length` ≥ 2; totals sum correctly; ON_CHAIN aggregation correct |
| E2 | `GET /api/portfolio` fetch always throws | 200 (NEVER 500); every row `priceUnavailable: true`; warns logged |
| E3 | `GET /api/portfolio` ETH on-chain + ETH Binance | exactly 2 distinct rows; symbols equal but networks differ |
| E4 | `GET /api/portfolio/token/:address/:network` valid | 200; position object present; transactions array enriched |
| E5 | Same with `?wallet_id=` valid | only that wallet's slice |
| E6 | Same for CEX with `?wallet_id=` ON_CHAIN id | walletId silently ignored, returns CEX row |
| E7 | Token does not exist | 404 |
| E8 | Token exists but no OPEN position | 404 |
| E9 | History endpoint returns CLOSED cycles ordered | array length matches seeded closed cycles |
| E10 | NEGATIVE: CEX token without `binance_symbol` | row has `priceUnavailable: true`; no 500 |
| E11 | NEGATIVE: token with priceUsd null on a TRANSFER_IN tx | tx in detail has `lotPnlUsd: null` |
| E12 | Auth — request without JWT cookie | 401 (inherited from authPlugin) |

---

## 9. Open Questions / Deferred

- **R5 (cache stampede)** — multiple concurrent requests during cold start can each fire a fetch for the same key. Documented in proposal. Mitigation deferred (in-flight `Map<key, Promise>` is straightforward but out-of-scope for V1; current TTL + single-instance Render makes this acceptable).
- **DefiLlama rate limit headers** — not parsed; if 429 happens we log and treat as unavailable. Future story can introduce backoff.
- **Multiple OPEN positions per (wallet,token)** — invariant violation would still produce coherent output (balances sum), but no DB UNIQUE enforces it. Tracked in proposal R6, no design action.
