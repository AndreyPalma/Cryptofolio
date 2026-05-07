# Proposal — US-008-B-binance-cex-sync

**Date**: 2026-05-07
**Status**: proposed
**Depends on**: US-008-A (on-chain sync infrastructure)

## Intent

Extend the existing `POST /api/sync/:walletId` route to handle CEX wallets backed by Binance. The route already serves on-chain wallets (US-008-A); this change adds a dispatch branch that routes CEX wallet calls to a new `BinanceSyncService`, which pulls trades, converts, withdrawals, and deposits from the Binance REST API, classifies them into the same transaction model (WAC, position cycles, swap decomposition), and persists them idempotently using the existing schema. No new migrations are required — all columns and indexes are already in place.

---

## Scope

### In scope

- `BinanceApiClient`: HMAC-SHA256 signed HTTP client for Binance REST (trades, converts, withdrawals, deposits, account assets). Key never logged.
- `BinanceSyncService`: orchestrates the four sync operations, manages cursors, auto-creates `CEX_BINANCE` tokens, and returns a per-operation result breakdown.
- Route dispatch: `syncRoutes` loads the wallet once, then branches to `OnChainSyncService` or `BinanceSyncService` based on `wallet_type`.
- `BinanceSyncResultSchema`: separate Zod schema for the CEX response shape.
- Swap decomposition for Binance Convert: one Convert order → `SWAP_OUT (tx_log_index=0)` + `SWAP_IN (tx_log_index=1)` linked by `related_tx_id`.
- Withdrawal bridge: `tx_hash = txId` stored on `TRANSFER_OUT` rows so on-chain sync can inherit WAC via `resolveTransferCost`.
- Deposit cost resolution: INHERITED from matching ON_CHAIN wallet TRANSFER_OUT (by address + txId), else MARKET via `getCexPrice`.
- Cursor tracking per operation: `trades:SYMBOL` (24h), `converts` (30d), `withdrawals` (90d), `deposits` (90d).
- Unit tests for Convert decomposition, withdrawal bridge, deposit inheritance, and idempotency.
- E2E tests for the unified route (200 CEX sync, 400 ON_CHAIN wallet rejected, 400 missing key).
- Removal of the wallet-type guard from `OnChainSyncService.sync()` (moved to route dispatch layer).

### Out of scope

- Dust conversion (explicitly non-goal in V1 PRD).
- Multiple CEX wallets (one `CEX_BINANCE` wallet enforced at service layer, US-005).
- Historical price lookup at exact deposit/withdrawal timestamp (current price used as approximation, same as on-chain sync).
- Binance sub-accounts or portfolio margin endpoints.
- Frontend sync UI.

---

## Architecture decisions

### AD-1: Route dispatch strategy

**Chosen**: dispatch in route handler (Option A).

The route loads the wallet row once (`SELECT wallet_type FROM wallets WHERE id=$1 AND user_id=$2`), then calls `OnChainSyncService` or `BinanceSyncService`. Both services receive the pre-loaded wallet to avoid a second DB round trip.

Option B (shared abstract `SyncService` base class) adds abstraction overhead with no benefit for a two-branch switch. Option C (separate URL paths `/api/sync/onchain/:id` vs `/api/sync/cex/:id`) violates the PRD requirement for a single route and forces callers to know the wallet type.

The existing 400 guard in `OnChainSyncService.sync()` (line 73-75) is replaced by a programming-error assertion (`if (wallet.wallet_type !== 'ON_CHAIN') throw new Error('invariant')`) — the route dispatch now owns the CEX/ON_CHAIN gate.

### AD-2: tx_log_index for single-row CEX transactions

**Decision**: use `tx_log_index = 0` for all single-row CEX transactions (trades, withdrawals, deposits). Only Converts use `(0, 1)`.

**Why not NULL**: the existing partial index `UNIQUE(cex_trade_id, tx_log_index) WHERE cex_trade_id IS NOT NULL` does NOT block duplicate rows when `tx_log_index IS NULL`, because `NULL != NULL` in standard SQL — multiple rows with `(orderId, NULL)` satisfy the uniqueness constraint independently. This is idempotency risk #8 from the exploration.

**Why 0 works**: `(orderId, 0)` is a unique, concrete value. For Converts, `(orderId, 0)` = SWAP_OUT and `(orderId, 1)` = SWAP_IN. No collision is possible between trade rows and Convert rows sharing the same `cex_trade_id` because Binance issues distinct IDs for trades and Convert orders.

This deviates from the literal PRD wording ("tx_log_index=NULL for trades") but is the correct implementation — the PRD intent is idempotency, and `tx_log_index=0` is the only approach that achieves it with the existing index definition. This clarification will be documented in the spec.

### AD-3: Binance orderId in BIGINT

**Assessment**: safe, no migration needed.

PostgreSQL `BIGINT` is a signed 64-bit integer with max value `9,223,372,036,854,775,807` (~9.2×10^18). Binance `orderId` for Convert orders is up to 18 decimal digits (e.g. `123456789012345678`). The maximum observed Binance orderId as of 2026 is well within the signed 64-bit range.

**Risk**: Binance does not guarantee orderId will stay within signed 64-bit. If a future orderId exceeds `9,223,372,036,854,775,807`, the INSERT will throw a numeric overflow. Mitigation: the `persistBinanceTx` method should catch `22003` (numeric_value_out_of_range) PostgreSQL error and log it as a skipped row with a warning, rather than failing the full sync. A migration to `NUMERIC(20,0)` for `cex_trade_id` can be done as a non-breaking follow-up if overflow is actually observed. No migration required now.

### AD-4: Separate BinanceSyncResultSchema

**Decision**: add `BinanceSyncResultSchema` alongside the existing `SyncResultSchema` in `apps/backend/src/schemas/sync.ts`. The route response is typed as `z.union([SyncResultSchema, BinanceSyncResultSchema])`.

The two schemas are semantically incompatible: on-chain returns `{ synced, skipped, swapsDecomposed, transfersPendingCost, transfersInheritedFromCEX, newTransactions }` while CEX returns `{ trades: { synced, skipped, symbolsProcessed }, converts: { synced, skipped }, withdrawals: { synced, skipped }, deposits: { synced, skipped, inherited, manual }, tokensCreated }`. Merging them into a single schema would require many optional fields, making the contract unclear for API consumers.

The route handler returns whichever shape matches the wallet type. Fastify Zod type provider validates via the union.

### AD-5: Price source for CEX tokens

**Decision**: `PriceService.getCexPrice(binanceSymbol)` for all CEX token pricing. `PriceService.getOnChainPrice` is NOT used for CEX tokens.

Rationale: `getCexPrice` calls `GET /api/v3/ticker/price?symbol={X}USDT` (Binance public endpoint, no auth, 10s cache) — already implemented in `price.ts`. CEX tokens have `network='CEX_BINANCE'` and no DefiLlama-compatible contract address, so `getOnChainPrice` would fail or return garbage.

Exception rule for trades: if `quoteAsset` is USDT/BUSD/USDC, compute `price_usd = quoteQty / qty` exactly without any API call (preferred — no network round trip, exact price). If `quoteAsset` is a non-stable asset (BTC, ETH, BNB), compute `price_usd = getCexPrice(quoteAsset) × (quoteQty / qty)`.

Convert pricing: SWAP_OUT price = 1.0 if `fromAsset` is stable, else `getCexPrice(fromAsset)`. SWAP_IN price = SWAP_OUT total USD value divided by `toAmount` (USD value is conserved across the swap, consistent with WAC formula).

### AD-6: Deposit cost resolution

**Decision**: two-step resolution specific to CEX deposits, separate from the existing `resolveTransferCost` (which handles on-chain TRANSFER_INs).

Step 1 — INHERITED: query for a matching on-chain `TRANSFER_OUT` by `deposit.address` (the wallet that sent the funds) AND `deposit.txId` (the on-chain transaction hash). If found, use that position's WAC as `price_usd`, set `cost_source='INHERITED'`.

```sql
SELECT t.price_usd, p.wac
FROM transactions t
JOIN positions p ON p.id = t.position_id
JOIN wallets w ON w.id = t.wallet_id
WHERE w.wallet_type = 'ON_CHAIN'
  AND lower(w.address) = lower($depositAddress)
  AND t.type = 'TRANSFER_OUT'
  AND t.tx_hash = $txId
  AND p.token_id = $tokenId
ORDER BY t.block_timestamp DESC
LIMIT 1
```

Step 2 — MARKET: if no match, use `getCexPrice(binanceSymbol)` for current price, `cost_source='MARKET'`.

This is intentionally different from `resolveTransferCost` in `sync/cost-resolver.ts`, which handles the reverse direction (on-chain TRANSFER_IN looking for a Binance TRANSFER_OUT). Both resolvers are kept separate; no shared abstraction is introduced.

---

## New files

| File | Purpose |
|------|---------|
| `apps/backend/src/services/binance-sync.ts` | `BinanceSyncService` — orchestrates syncTrades, syncConvert, syncWithdrawals, syncDeposits; manages cursors; auto-creates CEX tokens; returns `BinanceSyncResult` |
| `apps/backend/src/sync/clients/binance-api.ts` | `BinanceApiClient` — HMAC-SHA256 signed HTTP client; `assertConfigured()`, `getAccountAssets()`, `getMyTrades()`, `getConvertHistory()`, `getWithdrawHistory()`, `getDepositHistory()`; secret never logged |
| `apps/backend/src/sync/__tests__/binance-sync.test.ts` | Unit tests: Convert decomposition, withdrawal bridge, deposit inheritance, idempotency |

---

## Modified files

| File | Change |
|------|--------|
| `apps/backend/src/routes/sync.ts` | Load wallet row first; dispatch to `OnChainSyncService` or `BinanceSyncService`; return `z.union([SyncResultSchema, BinanceSyncResultSchema])` |
| `apps/backend/src/schemas/sync.ts` | Add `BinanceSyncResultSchema` with per-operation breakdown and `tokensCreated` |
| `apps/backend/src/services/on-chain-sync.ts` | Replace lines 73-75 CEX 400 guard with a programming-error invariant assertion; remove `wallet_type` branch logic |

---

## Test strategy

| Test | Type | What it covers |
|------|------|----------------|
| Unit: Convert decomposition | engine | Single Convert order → SWAP_OUT `(orderId, 0)` + SWAP_IN `(orderId, 1)`, same `cex_trade_id`, linked `related_tx_id`, USD value conserved |
| Unit: withdrawal bridge | engine | `syncWithdrawals` stores `tx_hash = withdrawal.txId` on the TRANSFER_OUT row; verifies the bridge column is not null |
| Unit: deposit inheritance | engine | Deposit address matches ON_CHAIN wallet TRANSFER_OUT by txId → `cost_source='INHERITED'`, price = WAC; no match → `cost_source='MARKET'` |
| Unit: idempotency | engine | Double-run of syncTrades with same `cex_trade_id` + `tx_log_index=0` → second insert skipped, counters reflect `skipped++` |
| Unit: `BinanceApiClient` auth | engine | HMAC signature correct; `BINANCE_SECRET_KEY` absent from any logged or thrown string |
| E2E: 200 CEX sync | e2e | `POST /api/sync/:cexWalletId` returns 200 with `BinanceSyncResult` shape |
| E2E: 400 ON_CHAIN wallet rejected | e2e | `POST /api/sync/:onchainWalletId` for a CEX-only test → verifies route-level dispatch (not service-level) rejects correctly |
| E2E: 400 missing BINANCE_API_KEY | e2e | Unset `BINANCE_API_KEY` → 400 with error code `BINANCE_API_KEY_MISSING` |
| E2E: 400 invalid credentials | e2e | `BinanceApiClient` returns Binance error `-2015` → 400 with `BINANCE_INVALID_CREDENTIALS` |

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Binance orderId overflows BIGINT | Low | Medium | Catch PG error `22003` in `persistBinanceTx`, skip with warning; migrate to NUMERIC if observed |
| Server clock drift causes `-1021` recvWindow errors | Low | High | Use `recvWindow=60000` in `BinanceApiClient` (tolerates ±30s drift) |
| Binance rate limit (1200 req/min weight) hit during initial historical sync | Medium | Medium | Check HTTP 429, throw `ExternalApiError('Binance rate limit exceeded')`; rely on cursor to resume from last completed window |
| Trade pagination misses fully-sold assets (account balance=0) | Medium | Low | PRD AC explicitly says "assets con balance>0" — by-design limitation; cursors preserve already-fetched history |
| `tx_log_index=0` for trades conflicts with Convert SWAP_OUT sharing same `cex_trade_id` | None (impossible) | High | Binance assigns distinct IDs for `myTrades` vs Convert orders — no shared `cex_trade_id` across endpoints |
| `persistOneTransaction` type mismatch (on-chain `DecomposedTransaction`) | Certain | Medium | `BinanceSyncService` writes its own `persistBinanceTx` method; no attempt to reuse the on-chain variant |

---

## Estimated complexity

**Medium.**

The accounting model (WAC, position engine, swap decomposition) is already implemented and source-agnostic. The schema already has all required columns and indexes. The main work is: (1) implementing `BinanceApiClient` with correct HMAC auth and pagination, (2) the four sync methods in `BinanceSyncService` with their cursor logic, and (3) the deposit cost resolver query. The route change is a minimal 10-line addition. Test surface is well-defined by the AC. No migrations required.
