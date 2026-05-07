# Tasks — US-008-B-binance-cex-sync

**Change**: US-008-B-binance-cex-sync
**Date**: 2026-05-07
**Status**: done

---

## Legend

- `[TEST]` — failing test that must be written BEFORE the corresponding implementation
- `[IMPL]` — implementation that makes the preceding test(s) pass
- `[engine]` — vitest project: `engine`; pure unit tests, no DB; files in `apps/backend/src/sync/__tests__/`
- `[sync]` — vitest project: `sync`; integration tests, real DB; files in `apps/backend/tests/`
- `[e2e]` — vitest project: `e2e`; full-stack, real DB, mocked HTTP; files in `tests/e2e/api/`
- `(after TXX)` — must not start until TXX is merged/complete
- Checkboxes: `[ ]` open · `[x]` done

---

## Phase 0 — Schema verification (no migration needed)

### T00 — Confirm no migration required

- **File**: `db/migrations/` (read-only check, no changes)
- **What**:
  - Verify `wallet_sync_cursors(wallet_id, operation, last_value, updated_at)` exists with `UNIQUE(wallet_id, operation)`
  - Verify `transactions.cex_trade_id BIGINT`, `transactions.tx_log_index INTEGER`, `transactions.tx_hash TEXT`, `transactions.related_tx_id UUID` all exist
  - Verify partial index `UNIQUE(cex_trade_id, tx_log_index) WHERE cex_trade_id IS NOT NULL` exists on `transactions`
  - Verify `tokens.binance_symbol TEXT` column exists (from `0002_tokens_extra_fields.sql`)
  - Verify `transactions.source` enum includes `'BINANCE'` and `transactions.type` enum includes `BUY`, `SELL`, `SWAP_IN`, `SWAP_OUT`, `TRANSFER_IN`, `TRANSFER_OUT`
- **Dependencies**: none
- **Notes**: If any column or index is absent, add a migration before proceeding. Based on design §9, none are expected to be missing.

---

## Phase 1 — Types & Schemas

### T01 — [IMPL] Add BinanceSyncResultSchema to sync schemas

- **File**: `apps/backend/src/schemas/sync.ts`
- **What**:
  - Add `BinanceSyncResultSchema` using Zod 4 alongside the existing `SyncResultSchema`
  - Export `BinanceSyncResult` type via `z.infer<typeof BinanceSyncResultSchema>`
  - Schema shape: nested objects `trades`, `converts`, `withdrawals`, `deposits`, plus `tokensCreated`
  - All numeric fields: `z.number().int().nonnegative()` (no deprecated Zod 3 methods)
  - Do NOT remove or modify `SyncResultSchema`, `SyncParamsSchema`, or `SyncedTxSchema`
- **Dependencies**: T00
- **Notes**: `SyncResultSchema` currently uses `z.array(SyncedTxSchema).max(10)` for `newTransactions` — `BinanceSyncResultSchema` has no `newTransactions` field; that field is ON_CHAIN-specific

### T02 — [IMPL] Define Binance API types and BinanceApiClient interface

- **File**: `apps/backend/src/sync/clients/binance-api.ts` (new file)
- **What**:
  - Export named types: `BinanceTrade`, `BinanceConvert`, `BinanceWithdrawal`, `BinanceDeposit` (exact shapes from spec §2, design §2.1)
  - Export `BinanceApiClient` interface with methods: `assertConfigured()`, `getAccountAssets()`, `getMyTrades()`, `getConvertHistory()`, `getWithdrawHistory()`, `getDepositHistory()`
  - Export `createBinanceApiClient` factory function signature (implementation in T08)
  - No `any` types; `commissionAsset` and `commission` on `BinanceTrade` are `string | null`
  - `BinanceConvert.status` is `string` (not a union — Binance may add new statuses)
- **Dependencies**: T00

### T03 — [IMPL] Define BinanceSyncDeps and BinanceSyncResult types

- **File**: `apps/backend/src/services/binance-sync.ts` (new file — scaffold only)
- **What**:
  - Export `BinanceSyncDeps` type: `{ pool: Pool; priceService: PriceService; binanceClient: BinanceApiClient }`
  - Import `BinanceSyncResult` from `schemas/sync.ts` (re-export if convenient)
  - Scaffold `BinanceSyncService` class with constructor accepting `BinanceSyncDeps` — no methods yet (stubs only to satisfy TypeScript at this stage)
  - Named exports only; no `export default`
- **Dependencies**: T01, T02

---

## Phase 2 — BinanceApiClient (TDD — engine)

### T04 — [TEST] assertConfigured throws ApiKeyMissingError when key is empty

- **File**: `apps/backend/src/sync/__tests__/binance-api-client.test.ts` (new file)
- **What**:
  - Use `vi.stubEnv` or pass `apiKey: ''` to `createBinanceApiClient` to simulate missing key
  - Assert `assertConfigured()` throws `ApiKeyMissingError` with `code='API_KEY_MISSING'`
  - Also assert throws when `apiKey` is whitespace-only (trim guard)
  - Also assert throws when `secretKey` is empty (both keys must be present)
  - Test does NOT make any network calls (no fetch mock needed — throws before any I/O)
- **Dependencies**: T02
- **Label**: `[engine]`

### T05 — [IMPL] assertConfigured implementation in createBinanceApiClient

- **File**: `apps/backend/src/sync/clients/binance-api.ts`
- **What**:
  - Implement `createBinanceApiClient({ apiKey, secretKey, log })` factory
  - `assertConfigured()`: throws `ApiKeyMissingError('BINANCE_API_KEY')` if `!apiKey?.trim()`; throws `ApiKeyMissingError('BINANCE_SECRET_KEY')` if `!secretKey?.trim()`
  - Import `ApiKeyMissingError` from `../../services/errors.js`
  - `log` parameter typed as `FastifyBaseLogger` (imported from `fastify`)
- **Dependencies**: T04

### T06 — [TEST] getMyTrades normalizes BinanceTrade response correctly

- **File**: `apps/backend/src/sync/__tests__/binance-api-client.test.ts`
- **What**:
  - Mock `global.fetch` with `vi.fn()` returning a valid Binance `/api/v3/myTrades` JSON fixture
  - Assert returned array matches `BinanceTrade[]` shape (all fields present, correct types)
  - Assert `isBuyer` is boolean (Binance returns it as boolean — verify no accidental string coercion)
  - Assert `time` is a number (unix ms)
  - Assert `commission` and `commissionAsset` are `null` when absent from response
- **Dependencies**: T05
- **Label**: `[engine]`

### T07 — [TEST] HMAC signature is appended last and secretKey never appears in request URL

- **File**: `apps/backend/src/sync/__tests__/binance-api-client.test.ts`
- **What**:
  - Mock `global.fetch` with `vi.fn()`, capture the URL argument
  - Call `getMyTrades(...)` and inspect the captured URL
  - Assert URL query string contains `signature=` as the LAST parameter
  - Assert URL query string does NOT contain the literal `secretKey` value
  - Assert `X-MBX-APIKEY` header equals `apiKey` (not `secretKey`)
  - Assert `timestamp` and `recvWindow=60000` are present in query string
- **Dependencies**: T05
- **Label**: `[engine]`

### T08 — [TEST] Binance error code -2015 maps to ValidationError BINANCE_INVALID_CREDENTIALS

- **File**: `apps/backend/src/sync/__tests__/binance-api-client.test.ts`
- **What**:
  - Mock `fetch` to return HTTP 200 with body `{ code: -2015, msg: 'Invalid API-key...' }` (Binance wraps auth errors as 200 with error body sometimes, but also returns 401 — test the `code: -2015` case via non-2xx path)
  - Also mock `fetch` returning HTTP 401 with body `{ code: -2015, msg: '...' }`
  - Assert thrown error is `ValidationError` with `code='BINANCE_INVALID_CREDENTIALS'`, `statusCode=400`
  - Assert error `message` does NOT contain the literal `secretKey` value
  - Also test `code: -2014` → same error
- **Dependencies**: T05
- **Label**: `[engine]`

### T09 — [TEST] HTTP 429 from Binance maps to ExternalApiError (502)

- **File**: `apps/backend/src/sync/__tests__/binance-api-client.test.ts`
- **What**:
  - Mock `fetch` returning HTTP 429
  - Assert thrown error is `ExternalApiError` with `statusCode=502`, `code='EXTERNAL_API_ERROR'`
  - Assert error message does NOT contain `apiKey` or `secretKey` values
  - Also test generic HTTP 500 from Binance → same `ExternalApiError`
- **Dependencies**: T05
- **Label**: `[engine]`

### T10 — [IMPL] Full BinanceApiClient implementation (signed helper + all methods)

- **File**: `apps/backend/src/sync/clients/binance-api.ts`
- **What**:
  - Implement private `signed(endpoint, params)` helper: builds URLSearchParams, adds `timestamp` + `recvWindow=60000`, computes HMAC-SHA256 signature using Node.js `crypto.createHmac`, appends `signature` LAST, sets `X-MBX-APIKEY` header
  - Implement `scrubParams` helper: copies URLSearchParams, deletes `signature`, returns string — used before any `log.*` call
  - Implement `getAccountAssets()`: `GET /api/v3/account` → filter `parseFloat(free) + parseFloat(locked) > 0`
  - Implement `getMyTrades(symbol, startTime, endTime)`: `GET /api/v3/myTrades`
  - Implement `getConvertHistory(startTime, endTime)`: `GET /sapi/v1/convert/tradeFlow` → filter `status === 'SUCCESS'`
  - Implement `getWithdrawHistory(startTime, endTime)`: `GET /sapi/v1/capital/withdraw/history` → filter `status === 6`
  - Implement `getDepositHistory(startTime, endTime)`: `GET /sapi/v1/capital/deposit/hisrec` → filter `status === 1`
  - Error mapping: `-2015`/`-2014` → `ValidationError('Invalid Binance API credentials or insufficient permissions', 'BINANCE_INVALID_CREDENTIALS')`; HTTP 429 → `ExternalApiError('binance', { status: 429 })`; other non-2xx → `ExternalApiError('binance', ...)`
  - `secretKey` NEVER passed to any `Error` constructor, `log.*` call, URL, or cause object
- **Dependencies**: T06, T07, T08, T09

---

## Phase 3 — Pure logic (TDD — engine)

### T11 — [TEST] computeTradePrice — stable quote (USDT) returns exact price without API call

- **File**: `apps/backend/src/sync/__tests__/binance-classify.test.ts` (new file)
- **What**:
  - Call `computeTradePrice` (or equivalent exported pure function) with `symbol='ETHUSDT'`, `qty='1'`, `quoteQty='3000'`
  - Assert result equals `'3000.00000000'` (8 decimal places via Decimal.js)
  - Assert `priceService.getCexPrice` is NOT called (spy or mock — stable quote must be resolved locally)
  - Repeat for `BUSD` and `USDC` suffixes — all stable, no API call
- **Dependencies**: T03
- **Label**: `[engine]`

### T12 — [TEST] computeTradePrice — non-stable quote (BTC) calls getCexPrice and multiplies

- **File**: `apps/backend/src/sync/__tests__/binance-classify.test.ts`
- **What**:
  - Mock `priceService.getCexPrice('BTC')` returning `60000`
  - Call `computeTradePrice` with `symbol='ETHBTC'`, `qty='1'`, `quoteQty='0.05'`
  - Assert result equals `'3000.00000000'` (`0.05 × 60000 / 1`)
  - Assert `getCexPrice` was called exactly once with `'BTC'`
  - Verify Decimal.js precision: `quoteQty='0.049999'`, `getCexPrice=60000.123456` → result should not have floating-point rounding errors
- **Dependencies**: T11
- **Label**: `[engine]`

### T13 — [TEST] Convert decomposition produces two cross-linked rows with tx_log_index 0 and 1

- **File**: `apps/backend/src/sync/__tests__/binance-classify.test.ts`
- **What**:
  - Call the convert-pair logic (exported pure function or test via BinanceSyncService with mocked DB) for a convert: `orderId='123'`, `fromAsset='USDT'`, `fromAmount='3000'`, `toAsset='ETH'`, `toAmount='1'`
  - Assert exactly 2 rows are produced
  - Assert SWAP_OUT row: `type='SWAP_OUT'`, `txLogIndex=0`, `cexTradeId=BigInt(123)`
  - Assert SWAP_IN row: `type='SWAP_IN'`, `txLogIndex=1`, `cexTradeId=BigInt(123)` (same orderId)
  - Assert `SWAP_OUT.relatedTxId === SWAP_IN.id` AND `SWAP_IN.relatedTxId === SWAP_OUT.id` (cross-linked)
  - Assert USD value is conserved: `fromAmount × fromPrice ≈ toAmount × toPrice`
- **Dependencies**: T03
- **Label**: `[engine]`

### T14 — [TEST] resolveDepositCost — ON_CHAIN TRANSFER_OUT match returns INHERITED

- **File**: `apps/backend/src/sync/__tests__/binance-classify.test.ts`
- **What**:
  - Mock `pgc.query` to return a row with `wac='3000.00000000'` for the WAC lookup SQL
  - Call `resolveDepositCost(pgc, deposit, tokenId)` with `deposit.address='0xabc'`, `deposit.txId='0xtxhash'`
  - Assert result: `{ priceUsd: '3000.00000000', costSource: 'INHERITED' }`
  - Assert `priceService.getCexPrice` is NOT called (INHERITED means no market lookup needed)
- **Dependencies**: T03
- **Label**: `[engine]`

### T15 — [TEST] resolveDepositCost — no ON_CHAIN match falls back to MARKET

- **File**: `apps/backend/src/sync/__tests__/binance-classify.test.ts`
- **What**:
  - Mock `pgc.query` to return empty rows (no match)
  - Mock `priceService.getCexPrice('ETH')` returning `3200`
  - Call `resolveDepositCost(pgc, { ...deposit, coin: 'ETH' }, tokenId)`
  - Assert result: `{ priceUsd: '3200', costSource: 'MARKET' }`
  - Assert `getCexPrice` was called with `'ETH'`
- **Dependencies**: T14
- **Label**: `[engine]`

---

## Phase 4 — BinanceSyncService (TDD — sync project, needs DB)

### T16 — [TEST] syncConvert idempotency — double run produces exactly 2 rows (SWAP_OUT + SWAP_IN)

- **File**: `apps/backend/tests/binance-sync.test.ts` (new file)
- **What**:
  - Seed a CEX wallet in the test DB
  - Mock `binanceClient.getConvertHistory` returning one Convert with `orderId='999'`, `fromAsset='USDT'`, `toAsset='ETH'`
  - Mock `binanceClient.getAccountAssets` returning empty (only testing converts)
  - Run `binanceSyncService.sync(walletId, userId)` twice
  - Assert `SELECT COUNT(*) FROM transactions WHERE cex_trade_id=999` returns exactly 2 (not 4)
  - Assert one row has `tx_log_index=0`, `type='SWAP_OUT'`; the other has `tx_log_index=1`, `type='SWAP_IN'`
  - Assert both rows have `related_tx_id` pointing to the other row's `id`
- **Dependencies**: T13 (logic), T10 (client)
- **Label**: `[sync]`

### T17 — [TEST] syncWithdrawals stores tx_hash=txId as bridge column (never null)

- **File**: `apps/backend/tests/binance-sync.test.ts`
- **What**:
  - Seed a CEX wallet with an open ETH position (WAC=3000)
  - Mock `binanceClient.getWithdrawHistory` returning one withdrawal: `id='w1'`, `coin='ETH'`, `txId='0xbridge123'`, `status=6`
  - Run `binanceSyncService.sync(walletId, userId)`
  - Assert `SELECT tx_hash, type, source FROM transactions WHERE cex_trade_id=...` returns row with `tx_hash='0xbridge123'`, `type='TRANSFER_OUT'`, `source='BINANCE'`
  - Assert `tx_hash` is NOT null (critical invariant INV-3)
  - Assert `tx_log_index=0`
- **Dependencies**: T10
- **Label**: `[sync]`

### T18 — [TEST] syncDeposits INHERITED — on-chain TRANSFER_OUT match sets cost_source=INHERITED

- **File**: `apps/backend/tests/binance-sync.test.ts`
- **What**:
  - Seed an ON_CHAIN wallet with a `TRANSFER_OUT` transaction (`tx_hash='0xdeposit'`, `token_id=ETH-on-chain`, WAC=2800)
  - Seed a CEX wallet
  - Mock `binanceClient.getDepositHistory` returning one deposit: `coin='ETH'`, `txId='0xdeposit'`, `address=<on-chain wallet address>`, `status=1`
  - Run `binanceSyncService.sync(cexWalletId, userId)`
  - Assert the resulting `TRANSFER_IN` row has `cost_source='INHERITED'` and `price_usd='2800...'` (matching the on-chain WAC)
- **Dependencies**: T15 (logic), T10
- **Label**: `[sync]`

### T19 — [TEST] ensureTokenCex — creates token on first call, returns same id on second call

- **File**: `apps/backend/tests/binance-sync.test.ts`
- **What**:
  - Call the service method (or helper) for `ensureTokenCex(pgc, 'ETH', 'ETH')` twice within a transaction
  - Assert only ONE row exists in `tokens` with `network='CEX_BINANCE'` and `lower(contract_address)='eth'`
  - Assert both calls return the same UUID
  - Assert `symbol='ETH'`, `binance_symbol='ETH'`, `decimals=8`
  - Verify concurrent safety: insert ON CONFLICT DO NOTHING (no unique violation error on second call)
- **Dependencies**: T03
- **Label**: `[sync]`

### T20 — [IMPL] BinanceSyncService — getCursor, setCursor, ensureTokenCex

- **File**: `apps/backend/src/services/binance-sync.ts`
- **What**:
  - Implement private `getCursor(pgc, walletId, operation)`: `SELECT last_value FROM wallet_sync_cursors WHERE wallet_id=$1 AND operation=$2` → return `Date.parse(row.last_value)` or `null`
  - Implement private `setCursor(pgc, walletId, operation, valueMs)`: `INSERT ... ON CONFLICT DO UPDATE SET last_value=..., updated_at=now()`; store as ISO timestamp text
  - Implement private `ensureTokenCex(pgc, symbol, binanceSymbol?)`: three-step SELECT → INSERT ON CONFLICT DO NOTHING → re-SELECT; `decimals=8`, `network='CEX_BINANCE'`, `contract_address=lower(symbol)`; return `tokenId` string (not `{ tokenId, created }` — increment internal `tokensCreated` counter as side-effect)
  - All SQL uses parameterized queries (`$1`, `$2`, ...)
- **Dependencies**: T19

### T21 — [IMPL] BinanceSyncService — persistBinanceTx

- **File**: `apps/backend/src/services/binance-sync.ts`
- **What**:
  - Implement private `persistBinanceTx(pgc, opts)` matching the `PersistBinanceTxOpts` type from design §4.10
  - Step 1: `SELECT * FROM positions WHERE wallet_id=$1 AND token_id=$2 AND status='OPEN' FOR UPDATE SKIP LOCKED LIMIT 1`
  - Step 2: `SELECT count(*)::int FROM positions WHERE wallet_id=$1 AND token_id=$2 AND status='CLOSED'`
  - Step 3: call `processTransaction(engineTx, positionRow ?? null, closedCount)` from `position-engine/index.ts`
  - Step 4: UPSERT position via `INSERT ... ON CONFLICT (id) DO UPDATE SET ...`
  - Step 5: `INSERT INTO transactions (...) ON CONFLICT DO NOTHING RETURNING id`; map `rowCount === 1` to `inserted: boolean`
  - Catch PostgreSQL error code `22003` (numeric_value_out_of_range): log `warn` with `{ type, cexTradeId: opts.cexTradeId?.toString() }` (no key values), return `{ inserted: false }`
  - `block_timestamp` column receives `opts.cexTimestamp` (a `Date`) — CEX rows have no block number
  - Return type: `{ inserted: boolean }` (no `id` field needed by callers except convert cross-link — see T22)
- **Dependencies**: T20

### T22 — [IMPL] BinanceSyncService — syncConvert (including cross-link UPDATE)

- **File**: `apps/backend/src/services/binance-sync.ts`
- **What**:
  - Implement private `syncConvert(pgc, walletId)` per spec §5 and design §4.5
  - Pre-generate `swapOutId = randomUUID()` and `swapInId = randomUUID()` before both inserts
  - Insert SWAP_OUT with `relatedTxId: swapInId`, `txLogIndex: 0`; insert SWAP_IN with `relatedTxId: swapOutId`, `txLogIndex: 1`
  - After both inserts, issue `UPDATE transactions SET related_tx_id=$1 WHERE id=$2` to cross-link SWAP_OUT → SWAP_IN
  - If SWAP_OUT `ON CONFLICT DO NOTHING` (already exists): skip SWAP_IN as well (check `inserted=false` from first persist)
  - Parse `orderId` with `BigInt()` in try/catch; on parse failure log `warn` and `continue`
  - Idempotency: second run of same convert → `skipped` increments by 1, `synced` stays same
  - Window: 30 days per iteration
  - `isStable(asset)` inline helper: returns `true` for `'USDT' | 'USDC' | 'BUSD'`
- **Dependencies**: T21, T16 (test must pass)

### T23 — [IMPL] BinanceSyncService — syncWithdrawals

- **File**: `apps/backend/src/services/binance-sync.ts`
- **What**:
  - Implement private `syncWithdrawals(pgc, walletId)` per spec §6 and design §4.6
  - For each withdrawal: load open position WAC via `SELECT wac FROM positions WHERE wallet_id=$1 AND token_id=$2 AND status='OPEN' LIMIT 1`; if no position: `priceUsd='0'`
  - `txHash = withdrawal.txId` — MUST NOT be null or empty (invariant INV-3)
  - `cexTradeId = BigInt(withdrawal.id)` — withdrawal IDs are numeric strings
  - `txLogIndex = 0`, `costSource = 'INHERITED'`, `toAddress = withdrawal.address`
  - Window: 90 days per iteration
- **Dependencies**: T21, T17 (test must pass)

### T24 — [IMPL] BinanceSyncService — syncDeposits + resolveDepositCost

- **File**: `apps/backend/src/services/binance-sync.ts`
- **What**:
  - Implement private `resolveDepositCost(pgc, deposit, tokenId)` per spec §7 step 3 and design §4.8
  - SQL: join `transactions`, `positions`, `wallets` matching `wallet_type='ON_CHAIN'`, `lower(address)=lower(deposit.address)`, `type='TRANSFER_OUT'`, `tx_hash=deposit.txId`, `token_id=tokenId`
  - Implement private `syncDeposits(pgc, walletId)` per spec §7 and design §4.7
  - Deposits have no `cex_trade_id` → `cexTradeId: null`; idempotency via SELECT-before-INSERT: `SELECT id FROM transactions WHERE wallet_id=$1 AND type='TRANSFER_IN' AND source='BINANCE' AND tx_hash=$2 LIMIT 1` — skip if found
  - `tx_hash = deposit.txId` (on-chain hash, used for tracing and idempotency)
  - `txLogIndex = 0`, `fromAddress = deposit.address`, `toAddress = null`
  - Increment `inherited` or `manual` only when `inserted = true`
  - Window: 90 days per iteration
- **Dependencies**: T21, T18, T15 (tests must pass)

### T25 — [IMPL] BinanceSyncService — syncTrades

- **File**: `apps/backend/src/services/binance-sync.ts`
- **What**:
  - Implement private `syncTrades(pgc, walletId)` per spec §4 and design §4.3
  - `getAccountAssets()` → derive `symbol = ${asset.asset}USDT` for each asset
  - Cursor key: `trades:${symbol}`; initial window: 30 days back; window size: 24h per iteration
  - `isBuyer=true` → `type='BUY'`; `isBuyer=false` → `type='SELL'`
  - Call `computeTradePrice(trade)`: stable quote suffix (USDT/USDC/BUSD) → exact division; other → `getCexPrice(quoteAsset) × ratio`; use Decimal.js for all arithmetic; result formatted to 8 decimal places
  - `txLogIndex = 0`, `costSource = 'MARKET'`, `txHash = null`
  - `cexTradeId = BigInt(trade.id)` (trade IDs are safe int53 numbers from Binance)
  - After all windows for all symbols, call `setCursor` for each symbol
  - Return `{ synced, skipped, symbolsProcessed: assets.length }`
- **Dependencies**: T21, T12, T11

### T26 — [IMPL] BinanceSyncService — sync() public entry point

- **File**: `apps/backend/src/services/binance-sync.ts`
- **What**:
  - Implement `async sync(walletId, userId)` per spec §3 and design §4.2
  - Load wallet: `SELECT id, wallet_type, address FROM wallets WHERE id=$1 AND user_id=$2`; not found → `NotFoundError('Wallet not found', 'WALLET_NOT_FOUND')`
  - Assert `wallet_type === 'CEX'`: if not → `throw new Error('[BinanceSyncService] invariant: expected CEX wallet')` (not a user-facing error)
  - Call `binanceClient.assertConfigured()` before acquiring DB connection
  - Acquire `pgc = await pool.connect()`, run all four sub-methods in sequence, release in `finally`
  - Track `tokensCreated` as a local variable reset each `sync()` call (not a class field) — accumulate from all `ensureTokenCex` calls
  - Return assembled `BinanceSyncResult`
- **Dependencies**: T22, T23, T24, T25

---

## Phase 5 — Route unification (TDD — e2e)

### T27 — [TEST] POST /api/sync/:cexWalletId returns 200 with BinanceSyncResult shape

- **File**: `tests/e2e/api/binance-sync.test.ts` (new file)
- **What**:
  - Seed a CEX wallet (type=`'CEX'`, network=`'CEX_BINANCE'`)
  - Mock all Binance HTTP endpoints to return empty arrays (no trades, converts, etc.)
  - `POST /api/sync/:cexWalletId` with valid JWT
  - Assert status 200
  - Assert response body passes `BinanceSyncResultSchema.parse()` without throwing
  - Assert `trades.symbolsProcessed === 0`, all counters equal 0
- **Dependencies**: T26
- **Label**: `[e2e]`

### T28 — [TEST] POST /api/sync/:onChainWalletId still dispatches to OnChainSyncService

- **File**: `tests/e2e/api/binance-sync.test.ts`
- **What**:
  - Seed an ON_CHAIN wallet (type=`'ON_CHAIN'`, network=`'ETH'`)
  - Spy or mock `onChainService.sync` to verify it is called (not `binanceService.sync`)
  - `POST /api/sync/:onChainWalletId` with valid JWT
  - Assert `onChainService.sync` was called exactly once
  - Assert `binanceService.sync` was NOT called
  - Assert response body matches `SyncResultSchema` shape (existing test in `tests/e2e/api/sync.test.ts` should still pass — verify no regressions)
- **Dependencies**: T27
- **Label**: `[e2e]`

### T29 — [TEST] BINANCE_API_KEY not configured → 400 API_KEY_MISSING

- **File**: `tests/e2e/api/binance-sync.test.ts`
- **What**:
  - Seed a CEX wallet
  - Start Fastify server with `BINANCE_API_KEY=''` (or unset via env override)
  - `POST /api/sync/:cexWalletId`
  - Assert status 400
  - Assert `body.code === 'API_KEY_MISSING'`
  - Assert response body does NOT contain the literal empty string or any key values
- **Dependencies**: T27
- **Label**: `[e2e]`

### T30 — [TEST] Binance returns -2015 → 400 BINANCE_INVALID_CREDENTIALS

- **File**: `tests/e2e/api/binance-sync.test.ts`
- **What**:
  - Seed a CEX wallet; configure valid `BINANCE_API_KEY` and `BINANCE_SECRET_KEY` in test env
  - Mock Binance `/api/v3/account` to return HTTP 401 with `{ code: -2015, msg: 'Invalid API-key' }`
  - `POST /api/sync/:cexWalletId`
  - Assert status 400
  - Assert `body.code === 'BINANCE_INVALID_CREDENTIALS'`
  - Assert `body.message` does NOT contain the `BINANCE_API_KEY` or `BINANCE_SECRET_KEY` values
- **Dependencies**: T29
- **Label**: `[e2e]`

### T31 — [TEST] Binance HTTP 500 → 502 EXTERNAL_API_ERROR, keys absent from body

- **File**: `tests/e2e/api/binance-sync.test.ts`
- **What**:
  - Mock Binance endpoint to return HTTP 500
  - `POST /api/sync/:cexWalletId`
  - Assert status 502
  - Assert `body.code === 'EXTERNAL_API_ERROR'`
  - Assert `JSON.stringify(body)` does NOT include the literal `BINANCE_API_KEY` env value
  - Assert `JSON.stringify(body)` does NOT include the literal `BINANCE_SECRET_KEY` env value
- **Dependencies**: T30
- **Label**: `[e2e]`

### T32 — [TEST] Wallet belonging to another user → 404 WALLET_NOT_FOUND

- **File**: `tests/e2e/api/binance-sync.test.ts`
- **What**:
  - Seed two users; seed a CEX wallet belonging to user B
  - Authenticate as user A; `POST /api/sync/:walletIdBelongingToUserB`
  - Assert status 404
  - Assert `body.code === 'WALLET_NOT_FOUND'`
- **Dependencies**: T27
- **Label**: `[e2e]`

### T33 — [IMPL] Modify sync route — dispatch by wallet_type, add BinanceSyncService instantiation

- **File**: `apps/backend/src/routes/sync.ts`
- **What**:
  - Import `BinanceSyncService` from `../services/binance-sync.js`
  - Import `createBinanceApiClient` from `../sync/clients/binance-api.js`
  - Import `NotFoundError` from `../services/errors.js`
  - Import `BinanceSyncResultSchema` from `../schemas/sync.js`
  - In the plugin closure, instantiate `BinanceSyncService` with `createBinanceApiClient({ apiKey: process.env.BINANCE_API_KEY ?? '', secretKey: process.env.BINANCE_SECRET_KEY ?? '', log: fastify.log })`
  - Change route handler: query wallet first (`SELECT wallet_type FROM wallets WHERE id=$1 AND user_id=$2`); throw `NotFoundError` if not found; dispatch `ON_CHAIN` → existing `OnChainSyncService`; `CEX` → new `BinanceSyncService`
  - Change route `response` schema from `{ 200: SyncResultSchema }` to `{ 200: z.unknown() }` (union not feasible in Fastify/Zod without overhead — TypeScript types are authoritative)
  - `userId` extracted from `req.user as { sub: string }` — consistent with existing pattern
  - Clients (`etherscanClient`, `bsctraceClient`) remain created per-request (existing approach) for env override compatibility in tests
- **Dependencies**: T26, T32

### T34 — [IMPL] Remove CEX wallet-type guard from OnChainSyncService.sync()

- **File**: `apps/backend/src/services/on-chain-sync.ts`
- **What**:
  - Remove lines 73–75: `if (wallet.wallet_type === 'CEX') { throw new ValidationError('Wallet is not an on-chain wallet', 'NOT_ON_CHAIN_WALLET'); }`
  - Replace with programming-error assertion: `if (wallet.wallet_type !== 'ON_CHAIN') { throw new Error(\`[OnChainSyncService] invariant violation: expected ON_CHAIN wallet, got \${wallet.wallet_type}\`); }`
  - Remove import of `ValidationError` from errors.ts IF no other usage in the file (check first)
  - All existing tests in `tests/e2e/api/sync.test.ts` must still pass — no behavioral change for ON_CHAIN wallets
- **Dependencies**: T33

---

## Phase 6 — Integration verification

### T35 — Run engine tests and typecheck

- **File**: (no file change)
- **What**:
  - Run `pnpm --filter backend test:engine` — all tests in `apps/backend/src/**/__tests__/*.test.ts` must pass
  - Run `pnpm --filter backend typecheck` — zero TypeScript errors
  - Fix any type errors found (likely `import` path issues, missing `.js` extensions in imports)
  - Verify no `any` types introduced in new files
  - Confirm all new exports are named exports (no `export default`)
- **Dependencies**: T10, T15, T13

### T36 — Run sync integration tests

- **File**: (no file change)
- **What**:
  - Run `pnpm --filter backend test:sync` (requires DB connection)
  - All tests in `apps/backend/tests/binance-sync.test.ts` must pass: T16, T17, T18, T19
  - Verify existing sync tests (`sync-smoke.test.ts`, `sync-transfer-cost.test.ts`) still pass (no regressions from T34)
- **Dependencies**: T26, T34

### T37 — Run e2e tests

- **File**: (no file change)
- **What**:
  - Run `pnpm test:e2e` (requires DB + running backend)
  - All tests in `tests/e2e/api/binance-sync.test.ts` must pass: T27–T32
  - Existing `tests/e2e/api/sync.test.ts` must still pass after route change (T33)
  - Verify `tests/e2e/db/negative-binance-api-secret.test.ts` still passes (env var name `BINANCE_SECRET_KEY`, not `BINANCE_API_SECRET`)
- **Dependencies**: T33, T34, T36

### T38 — Commit

- **File**: (no file change)
- **What**:
  - Stage all new files: `binance-api.ts`, `binance-sync.ts`, `binance-api-client.test.ts`, `binance-classify.test.ts`, `binance-sync.test.ts` (sync), `binance-sync.test.ts` (e2e)
  - Stage modified files: `schemas/sync.ts`, `routes/sync.ts`, `services/on-chain-sync.ts`
  - Conventional commit: `feat(sync): add Binance CEX sync service — trades, converts, withdrawals, deposits`
  - No Co-Authored-By attribution
- **Dependencies**: T35, T36, T37

---

## Dependency graph (compressed)

```
T00
├── T01 ──────────────────────────────────────────────────── T03
├── T02 ── T03
│
T02
├── T04(test) ── T05(impl) ── T06(test) ── T08(test) ── T09(test) ── T10(impl)
│                              T07(test) ──────────────────────────────┘
│
T03
├── T11(test) ── T12(test) ─────────────────── T25(impl)
├── T13(test) ──────────────────────────────── T22(impl) ─┐
├── T14(test) ── T15(test) ──────────────────── T24(impl) │
├── T19(test) ── T20(impl) ── T21(impl) ────────┼──────── ┤ T26 ── T27(e2e) ─ T28 ─ T29 ─ T30 ─ T31
│                              └─────────────────┤        │                          └───────────── T32
│                                                T22 ─────┤
│                                                T23 ─────┘
│
T10 ─ T16(test) ─ T22(impl) ──┐
      T17(test) ─ T23(impl) ──┤
      T18(test) ─ T24(impl) ──┤
                               T26 ── T33 ── T34
                                       └──── T35 ── T36 ── T37 ── T38
```

---

## Task count summary

| Phase | Tests | Impls | Total |
|-------|-------|-------|-------|
| 0 — Schema verification | 0 | 1 | 1 |
| 1 — Types & Schemas | 0 | 3 | 3 |
| 2 — BinanceApiClient | 4 (engine) | 2 | 6 |
| 3 — Pure logic | 5 (engine) | 0 | 5 |
| 4 — BinanceSyncService | 4 (sync) | 7 | 11 |
| 5 — Route unification | 6 (e2e) | 2 | 8 |
| 6 — Integration verification | 0 | 4 | 4 |
| **Total** | **19** | **19** | **38** |

---

## New files created by this change

| File | Type |
|------|------|
| `apps/backend/src/sync/clients/binance-api.ts` | Implementation + types |
| `apps/backend/src/services/binance-sync.ts` | Implementation |
| `apps/backend/src/sync/__tests__/binance-api-client.test.ts` | Unit tests (engine) |
| `apps/backend/src/sync/__tests__/binance-classify.test.ts` | Unit tests (engine) |
| `apps/backend/tests/binance-sync.test.ts` | Integration tests (sync) |
| `tests/e2e/api/binance-sync.test.ts` | E2E tests (e2e) |

## Modified files

| File | Change |
|------|--------|
| `apps/backend/src/schemas/sync.ts` | Add `BinanceSyncResultSchema` + `BinanceSyncResult` type |
| `apps/backend/src/routes/sync.ts` | Add dispatch logic + `BinanceSyncService` instantiation |
| `apps/backend/src/services/on-chain-sync.ts` | Replace CEX guard with invariant assertion |
