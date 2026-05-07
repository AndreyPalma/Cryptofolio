# Exploration — US-008-B-binance-cex-sync

**Date**: 2026-05-07

---

## Codebase state

### What exists that US-008-B can reuse

| Asset | Path | What it provides |
|-------|------|-----------------|
| `OnChainSyncService` | `apps/backend/src/services/on-chain-sync.ts` | Full pipeline pattern: loadWallet → fetch → classify → cost-resolve → persistOneTransaction → update cursors. `BinanceSyncService` should mirror this structure. |
| `persistOneTransaction` | same file | Loads OPEN position FOR UPDATE, calls `processTransaction(PositionEngine)`, UPSERTs position + INSERTs transaction with ON CONFLICT. Works for CEX transactions unchanged — just swap `tx_hash`/`tx_log_index` for `cex_trade_id`/`tx_log_index`. |
| `ensureToken` | same file (private) | SELECT + INSERT ON CONFLICT DO NOTHING + re-SELECT pattern for on-chain tokens. Needs a CEX variant that looks up `(network='CEX_BINANCE', lower(symbol))` instead of `(network, lower(contract_address))`. |
| `resolveTransferCost` | `apps/backend/src/sync/cost-resolver.ts` | Step 2 already queries `source='BINANCE' AND type='TRANSFER_OUT' AND tx_hash=$1`. The CEX deposit resolver needs a different version: lookup by `deposit.address` matching an ON_CHAIN wallet with an OPEN position. |
| `PriceService.getCexPrice(binanceSymbol)` | `apps/backend/src/services/price.ts` | Already implemented — calls `GET /api/v3/ticker/price?symbol={binanceSymbol}USDT`, 10s cache. |
| `PriceService.getOnChainPrice(network, address)` | same | Needed for price of non-USDT quote assets in trades, and for some Convert legs. |
| `SyncResultSchema` | `apps/backend/src/schemas/sync.ts` | Must be extended (or a new `BinanceSyncResultSchema` added alongside) to match the per-operation response shape: `{ trades, converts, withdrawals, deposits, tokensCreated }`. |
| `SyncParamsSchema` | same | Can be used as-is — just `walletId: z.uuid()`. |
| `syncRoutes` | `apps/backend/src/routes/sync.ts` | The existing route needs to be unified (see Route Unification section). |
| Domain error classes | `apps/backend/src/services/errors.ts` | `ApiKeyMissingError`, `ExternalApiError`, `ValidationError`, `NotFoundError` — all apply directly. |
| `TransactionType`, `TransactionSource` | `apps/backend/src/db/types.ts` | All CEX values already present: `BUY`, `SELL`, `SWAP_IN`, `SWAP_OUT`, `TRANSFER_IN`, `TRANSFER_OUT`, source `BINANCE`. |
| DB schema — `wallet_sync_cursors` | `db/migrations/0001_initial_schema.sql` | `UNIQUE(wallet_id, operation)` where `operation` is a free string. Already designed for multi-operation cursors. |
| DB schema — `transactions` | same | `cex_trade_id BIGINT NULL`, `commission_asset`, `commission_amount`, `from_address`, `to_address` already present. Partial index `UNIQUE(cex_trade_id, tx_log_index) WHERE cex_trade_id IS NOT NULL` is exactly right for trades (tx_log_index=NULL) and Converts (0/1). |
| DB schema — `tokens.binance_symbol` | `db/migrations/0002_tokens_extra_fields.sql` | Already a column on `tokens`. `tokens_unique_cex` index on `(network, lower(symbol)) WHERE network='CEX_BINANCE'`. |
| Position engine | `apps/backend/src/position-engine/` | `processTransaction` is source-agnostic — works for BINANCE source unchanged. |
| Test seed helpers | `apps/backend/tests/sync-transfer-cost.test.ts` | `createUser`, `createCexWallet`, `createToken`, `createOpenPosition`, `createBinanceTransferOut` — reusable as-is for Binance sync tests. |
| HMAC auth env vars | `apps/backend/src/env.ts` | `BINANCE_API_KEY` and `BINANCE_SECRET_KEY` already in `EnvSchema`. |

### What needs to be created

| File | Purpose |
|------|---------|
| `apps/backend/src/services/binance-sync.ts` | `BinanceSyncService` class with `syncTrades`, `syncConvert`, `syncWithdrawals`, `syncDeposits`. |
| `apps/backend/src/sync/clients/binance-api.ts` | `BinanceApiClient` — HMAC-signed HTTP calls to Binance REST API. Handles signature generation, `recvWindow`, key scrubbing from logs/errors. |
| `apps/backend/src/schemas/sync.ts` (extend) | Add `BinanceSyncResultSchema` with per-operation breakdown. Keep existing `SyncResultSchema` for on-chain. |
| `apps/backend/src/sync/__tests__/binance-classify.test.ts` | Unit tests for Convert decomposition (T-new-1), withdrawal bridge (T-new-2), deposit inheritance (T-new-3), idempotency (T-new-4). |
| `apps/backend/tests/binance-sync.test.ts` | Integration tests for `BinanceSyncService` using mocked HTTP (msw or vi.fn on fetch) — no live Binance calls. |

### What needs to be modified

| File | Change |
|------|--------|
| `apps/backend/src/routes/sync.ts` | Unify route: load wallet first, then dispatch to `OnChainSyncService` or `BinanceSyncService` based on `wallet_type`. Remove the early 400 throw in `OnChainSyncService` — move wallet-type gate to the route. |
| `apps/backend/src/services/on-chain-sync.ts` | Remove `if (wallet.wallet_type === 'CEX') throw new ValidationError(...)` — the route now handles dispatch, so the service can assert `wallet_type === 'ON_CHAIN'` as a programming-error guard only. |

---

## Key findings

### Route unification (critical)

**Current state**: `OnChainSyncService.sync()` line 73-75 throws a 400 for CEX wallets. The route blindly calls it for all walletIds.

**Option A — dispatch in route handler** (recommended): Load the wallet row once in the route, then call `OnChainSyncService` or `BinanceSyncService` based on `wallet_type`. This is cleanest: single route, single pool, no abstraction overhead.

```
POST /api/sync/:walletId
  → load wallet (pool query)
  → if ON_CHAIN → OnChainSyncService.sync(...)
  → if CEX      → BinanceSyncService.sync(...)
```

**Option B — shared abstract SyncService**: Over-engineered for a 2-branch switch. Reject.

**Option C — separate paths** (`/api/sync/onchain/:id` vs `/api/sync/cex/:id`): Forces callers to know wallet type. The PRD says same route. Reject.

Implication: `syncRoutes` needs a `pool.query` for wallet load before dispatching. Both services receive the pre-loaded wallet to avoid double DB round trips.

### Binance API authentication

All signed endpoints require `timestamp` + `signature` = `HMAC-SHA256(BINANCE_SECRET_KEY, queryString)`.

Pattern (from Binance official docs):
```
const params = new URLSearchParams({ symbol, startTime, endTime, timestamp: Date.now() });
const signature = crypto.createHmac('sha256', BINANCE_SECRET_KEY)
                        .update(params.toString())
                        .digest('hex');
params.append('signature', signature);
GET https://api.binance.com/api/v3/myTrades?{params}
  Authorization: header NOT used — key in query param `apiKey` is NOT standard.
  Instead: X-MBX-APIKEY: BINANCE_API_KEY  (header)
```

- `BINANCE_API_KEY` goes in header `X-MBX-APIKEY`.
- `BINANCE_SECRET_KEY` is the HMAC secret — NEVER appears in URLs or logs.
- Binance error code `−2015` / `−2014` = invalid API key. Should throw `ValidationError('Invalid Binance API credentials or insufficient permissions', 'BINANCE_INVALID_CREDENTIALS')` → 400.
- `recvWindow`: default 5000ms is fine; no need to tune unless server clock skew is an issue.

### Token identity for CEX

```
network     = 'CEX_BINANCE'
contract_address = symbol.toLowerCase()   (auto-generated, no real contract)
binance_symbol   = base asset symbol (e.g. 'ETH', 'BTC')
```

- `ensureTokenCex(pgc, symbol, binanceSymbol)` should:
  1. `SELECT id FROM tokens WHERE network='CEX_BINANCE' AND lower(contract_address)=lower($1)` (contract_address stores symbol)
  2. `INSERT INTO tokens (symbol, name, network, contract_address, decimals, binance_symbol) VALUES ($1, null, 'CEX_BINANCE', lower($1), 8, $2) ON CONFLICT DO NOTHING RETURNING id`
  3. Re-select on conflict.
- Decimals for CEX tokens: use `8` as default (Binance amounts have up to 8 decimal places). This is a new convention — must be consistent with how the position engine reads amounts.
- `binance_symbol` is the key for `getCexPrice(binanceSymbol)` — e.g. `'ETH'` (not `'ETHUSDT'`).

### Cursor tracking

All cursors stored in `wallet_sync_cursors(wallet_id, operation)` with `last_value` as ISO timestamp string.

| Endpoint | operation key | Window size | last_value semantics |
|----------|---------------|-------------|----------------------|
| `GET /api/v3/myTrades?symbol=X` | `trades:ETHUSDT` | 24h | last `time` of last trade in window, or start of last window |
| `GET /sapi/v1/convert/tradeFlow` | `converts` | 30 days | last `createTime` of last convert |
| `GET /sapi/v1/capital/withdraw/history` | `withdrawals` | 90 days | last `applyTime` of last withdrawal |
| `GET /sapi/v1/capital/deposit/hisrec` | `deposits` | 90 days | last `insertTime` of last deposit |

Iteration pattern (same for all):
```
let startTime = cursor?.last_value ?? (now - maxWindow)
while (startTime < now):
  endTime = min(startTime + windowSize, now)
  fetch(startTime, endTime)
  persist
  startTime = endTime
update cursor to now
```

For trades: must first discover which symbols to sync via `GET /api/v3/account` (returns assets with non-zero balance). Each asset `XUSDT` is a separate cursor.

### Swap decomposition (Converts)

Binance Convert API (`/sapi/v1/convert/tradeFlow`) returns one object per Convert order. Each becomes two rows:

```
SWAP_OUT: {
  type: 'SWAP_OUT',
  source: 'BINANCE',
  cex_trade_id: orderId,       // Binance orderId (bigint)
  tx_log_index: 0,
  amount: fromAmount,
  token: fromAsset (ensureTokenCex)
  price_usd: fromAmountUsd (if fromAsset is USDT/BUSD/USDC → 1.0 × fromAmount; else DefiLlama)
  related_tx_id: swapInId
}
SWAP_IN: {
  type: 'SWAP_IN',
  source: 'BINANCE',
  cex_trade_id: orderId,       // same orderId
  tx_log_index: 1,
  amount: toAmount,
  token: toAsset (ensureTokenCex)
  price_usd: toAmountUsd = fromAmountUsd (value is conserved in a swap for WAC purposes)
  related_tx_id: swapOutId
}
```

Idempotency: `UNIQUE(cex_trade_id, tx_log_index) WHERE cex_trade_id IS NOT NULL` — the schema already has this index. ON CONFLICT DO NOTHING is safe.

Ordering: SWAP_OUT first (tx_log_index=0), SWAP_IN second (tx_log_index=1) — same as on-chain convention.

### Withdrawal bridge

`BinanceSyncService.syncWithdrawals` writes `tx_hash = txId` (the on-chain transaction hash) on the TRANSFER_OUT row. This is the bridge for `resolveTransferCost` step 2.

```sql
INSERT INTO transactions (
  ..., source='BINANCE', type='TRANSFER_OUT',
  cex_trade_id = withdrawal.id,
  tx_hash = withdrawal.txId,          -- the on-chain hash (bridge)
  tx_log_index = NULL,                -- single row, no decomposition
  price_usd = current WAC of CEX position at time of withdrawal
)
```

Critical invariant: `tx_hash` MUST be stored. Nulling it breaks the inheritance chain for `resolveTransferCost` step 2 (on-chain sync looking for a matching Binance TRANSFER_OUT).

Price for withdrawal TRANSFER_OUT: use current WAC of the OPEN CEX position for that token at the time of processing. This means loading the position before persisting — same approach as `persistOneTransaction`.

### Deposit cost resolution

`BinanceSyncService.syncDeposits` resolves cost for each TRANSFER_IN using:

1. `from_address` field in deposit matches a registered ON_CHAIN wallet that has a TRANSFER_OUT with same `txId`. This is different from `resolveTransferCost` (which is for on-chain TRANSFER_INs). For CEX deposits:
   - Query: `SELECT t.id, p.wac FROM transactions t JOIN positions p ON p.id = t.position_id JOIN wallets w ON w.id = t.wallet_id WHERE w.wallet_type = 'ON_CHAIN' AND lower(w.address) = lower($depositAddress) AND t.type = 'TRANSFER_OUT' AND t.tx_hash = $txId AND p.token_id = $tokenId ORDER BY t.block_timestamp DESC LIMIT 1`
   - If found: `cost_source='INHERITED'`, `price_usd=WAC`
2. Else: `price_usd` via `PriceService.getOnChainPrice` (DefiLlama) for the on-chain token at deposit timestamp, `cost_source='MARKET'`. Note: CEX token has `network='CEX_BINANCE'` but for price lookup we need to use `binance_symbol` with `getCexPrice`, not DefiLlama. The PRD rule says "price_usd via DefiLlama en insertTime" — but since it's a CEX token, use `getCexPrice(binanceSymbol)` (Binance public ticker, no auth). Actual price at exact timestamp is not retrievable from Binance ticker (it's current price). Use current price as approximation (same limitation as on-chain sync).

### Price source for CEX tokens

| Token type | Price method | TTL |
|------------|-------------|-----|
| On-chain (`ETH`, `BSC`) | `PriceService.getOnChainPrice(network, contractAddress)` → DefiLlama | 60s |
| CEX (`CEX_BINANCE`) | `PriceService.getCexPrice(binanceSymbol)` → Binance public `GET /api/v3/ticker/price?symbol={X}USDT` | 10s |

Already implemented in `price.ts`. `getCexPrice` takes the base symbol (`'ETH'`, not `'ETHUSDT'`).

Trade price rules:
- If `quoteAsset` is USDT/BUSD/USDC: `price_usd = quoteQty / qty` (exact, no API needed)
- If `quoteAsset` is BTC/ETH/BNB: `price_usd_base = getCexPrice(quoteAsset)`, then `price_usd = price_usd_base × (quoteQty / qty)`

Convert price rules:
- SWAP_OUT: if `fromAsset` is USDT/BUSD/USDC → `price_usd = 1.0`. Else `getCexPrice(fromAsset)`.
- SWAP_IN: `toAmountUsd = fromAmountUsd` (conserves USD value across the swap, consistent with WAC formula).

---

## Schema gaps

No migrations needed. All required columns already exist in migration `0001_initial_schema.sql`:
- `transactions.cex_trade_id BIGINT NULL` ✓
- `transactions.tx_hash VARCHAR(80) NULL` (for withdrawal bridge) ✓
- `transactions.commission_asset / commission_amount` ✓
- `transactions.from_address / to_address` ✓
- `tokens.binance_symbol VARCHAR(20)` ✓
- `wallet_sync_cursors.operation VARCHAR(80)` ✓
- Partial index `transactions_unique_cex ON (cex_trade_id, tx_log_index) WHERE cex_trade_id IS NOT NULL` ✓

One potential gap: the `transactions` INSERT in `persistOneTransaction` references columns `tx_hash, tx_log_index, related_tx_id` but not `cex_trade_id, commission_asset, commission_amount, from_address, to_address`. The Binance persist method needs a wider INSERT that fills these columns. The existing `persistOneTransaction` can either be generalized (optional Binance fields) or a `BinanceSyncService`-specific override can be written.

---

## Risks / non-obvious issues

1. **`persistOneTransaction` is on-chain-specific** — it receives a `DecomposedTransaction` which is typed with `source: Extract<TransactionSource, 'ETHERSCAN' | 'BSCTRACE'>`. A new type `DecomposedBinanceTransaction` (or a union type) is needed for CEX. The persist method needs to be either: (a) duplicated in `BinanceSyncService`, or (b) the shared method generalized to accept both on-chain and CEX rows.

2. **Trade pagination requires account asset discovery** — `GET /api/v3/myTrades` requires a specific symbol. We must first call `GET /api/v3/account` to get assets with positive balance, then build symbols like `ETHUSDT`. Edge case: assets that have been fully sold still need their trade history. The PRD says "assets con balance>0" — but this misses historical trades for fully-sold assets. Mitigation: sync cursors preserve history already fetched; future manual syncs can handle edge cases. This is an AC constraint, not a gap.

3. **Binance `orderId` for Converts vs trade `id`** — `cex_trade_id` is `BIGINT` in DB. Binance `orderId` for converts is a string like `"123456789012345678"` (18+ digits). Must verify it fits in `BIGINT` (PostgreSQL BIGINT is `int8`, max `9223372036854775807` ≈ 9.2×10^18). Large order IDs close to the `int8` max could overflow. Safe mitigation: store as `NUMERIC` or cast carefully. Current schema uses `BIGINT` — need to confirm Binance order IDs fit within signed 64-bit range. If not, a migration to `NUMERIC` for `cex_trade_id` may be needed.

4. **Clock sync / `recvWindow`** — HMAC signature includes `timestamp=Date.now()`. If server clock drifts >1000ms from Binance server, all calls will fail with code `-1021` (timestamp outside recvWindow). Consider adding `recvWindow=60000` to avoid this in CI/test environments.

5. **Rate limits** — Binance has a 1200 requests/minute weight limit. Each `myTrades` call has weight=20. With many symbols and historical windows, it's possible to hit rate limits. The service should check for HTTP 429 and throw `ExternalApiError('Binance rate limit exceeded')`.

6. **Deposits: price at `insertTime` is not available** — Binance deposit history only returns the deposit timestamp (`insertTime`). Neither DefiLlama nor Binance ticker can return historical prices. Current price is used as an approximation for `cost_source='MARKET'`. This is the same limitation as on-chain sync (current price, not historical). Documented in PRD as acceptable.

7. **One `CEX_BINANCE` wallet constraint** — enforced at service layer (US-005, `createCexWallet`), not DB. `BinanceSyncService.sync` must still call `loadWallet` + confirm `wallet_type === 'CEX'` — even though the route dispatch already checks it. Defense in depth.

8. **`tx_log_index=NULL` for normal trades** — The PRD says trades use `UNIQUE(cex_trade_id, tx_log_index=NULL)`. PostgreSQL partial unique indexes treat NULL specially: multiple NULL values are NOT considered duplicates unless using `NULLS NOT DISTINCT` (PG15+). The current index `UNIQUE(cex_trade_id, tx_log_index) WHERE cex_trade_id IS NOT NULL` with `tx_log_index=NULL` for trades — check if this correctly prevents duplicate trades. Since `NULL != NULL` in standard SQL, the index may NOT block duplicate trades with `tx_log_index=NULL`. This is a potential idempotency gap. Mitigation options: (a) use `tx_log_index=0` for all trades (single row per trade), (b) add a separate partial index `UNIQUE(cex_trade_id) WHERE tx_log_index IS NULL AND cex_trade_id IS NOT NULL`, or (c) upgrade to PG15 `NULLS NOT DISTINCT`. **This requires a schema decision before implementation.**

9. **`SyncResultSchema` response shape mismatch** — the existing schema returns `{ synced, skipped, swapsDecomposed, transfersPendingCost, transfersInheritedFromCEX, newTransactions }`. US-008-B requires `{ trades: { synced, skipped, symbolsProcessed }, converts: { synced, skipped }, withdrawals: { synced, skipped }, deposits: { synced, skipped, inherited, manual }, tokensCreated }`. These are incompatible. The route must return different schemas for ON_CHAIN vs CEX — either via a union response type or separate Zod schemas per branch.

---

## Recommended approach

### Overall structure

```
BinanceSyncService (new file: services/binance-sync.ts)
├── constructor({ pool, priceService, binanceClient })
├── sync(walletId, userId): Promise<BinanceSyncResult>
│   ├── loadWallet(walletId, userId)  [assert wallet_type='CEX']
│   ├── binanceClient.assertConfigured()
│   ├── syncTrades(pgc, walletId)    → { synced, skipped, symbolsProcessed }
│   ├── syncConvert(pgc, walletId)   → { synced, skipped }
│   ├── syncWithdrawals(pgc, walletId) → { synced, skipped }
│   ├── syncDeposits(pgc, walletId)  → { synced, skipped, inherited, manual }
│   └── return BinanceSyncResult
├── private ensureTokenCex(pgc, symbol, binanceSymbol) → tokenId
├── private persistBinanceTx(pgc, walletId, tokenId, tx, priceUsd, costSource) → { inserted }
├── private getCursor(pgc, walletId, operation) → Date | null
└── private setCursor(pgc, walletId, operation, value) → void
```

```
BinanceApiClient (new file: sync/clients/binance-api.ts)
├── assertConfigured()  [throws ApiKeyMissingError if keys missing]
├── getAccountAssets()  → { asset, free, locked }[]
├── getMyTrades(symbol, startTime, endTime) → BinanceTrade[]
├── getConvertHistory(startTime, endTime) → BinanceConvert[]
├── getWithdrawHistory(startTime, endTime) → BinanceWithdrawal[]
└── getDepositHistory(startTime, endTime) → BinanceDeposit[]
```

### Route unification (minimal change)

```typescript
// routes/sync.ts — modified
fastify.post('/:walletId', async (req) => {
  const walletResult = await pool.query(
    'SELECT wallet_type FROM wallets WHERE id=$1', [req.params.walletId]
  );
  const wallet = walletResult.rows[0];
  if (!wallet) throw new NotFoundError('Wallet not found', 'WALLET_NOT_FOUND');

  if (wallet.wallet_type === 'ON_CHAIN') {
    return onChainService.sync(req.params.walletId, userId);
  }
  return binanceService.sync(req.params.walletId, userId);
});
```

Response schema: use `z.union([SyncResultSchema, BinanceSyncResultSchema])` or simply remove the response schema from the route definition and let the service return the appropriate shape. The Zod validation on response is optional for internal routes.

### Idempotency for normal trades (risk #8 resolution)

Use `tx_log_index = 0` for all single-row CEX transactions (trades, withdrawals, deposits). This makes the `UNIQUE(cex_trade_id, tx_log_index)` index effective: `(orderId, 0)` is the unique key for trades, `(withdrawalId, 0)` for withdrawals, `(depositId, 0)` for deposits. Only Converts use `(orderId, 0)` + `(orderId, 1)`. This is cleaner than relying on NULL behavior.

**Verify this is consistent with the PRD**: The PRD acceptance criteria says "Idempotencia: UNIQUE(cex_trade_id, tx_log_index=NULL)" for trades. This is the risky NULL-based approach. Resolution: use `tx_log_index=0` for normal trades (single-row CEX ops) and document this as a clarification over the PRD — the NULL approach has undefined idempotency behavior in standard SQL partial indexes.
