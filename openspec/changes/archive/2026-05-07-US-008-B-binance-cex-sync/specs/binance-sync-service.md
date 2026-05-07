# Spec — BinanceSyncService & BinanceApiClient

**Change**: US-008-B-binance-cex-sync
**Date**: 2026-05-07
**Status**: draft

---

## §1 Overview

`BinanceSyncService` is the CEX-branch counterpart to `OnChainSyncService`. It reads trade, convert, withdrawal, and deposit history from the Binance REST API, classifies each event into the existing transaction model (WAC, position cycles, swap decomposition), and persists them idempotently using the shared DB schema.

**Placement in the architecture**:

```
routes/sync.ts
  ├── wallet_type='ON_CHAIN' → OnChainSyncService   (existing)
  └── wallet_type='CEX'      → BinanceSyncService   (new)
                                    └── BinanceApiClient  (new)
                                    └── PriceService       (existing, getCexPrice)
                                    └── PositionEngine     (existing, processTransaction)
```

File locations:
- `apps/backend/src/services/binance-sync.ts` — `BinanceSyncService`
- `apps/backend/src/sync/clients/binance-api.ts` — `BinanceApiClient`

No new DB migrations required. All columns and indexes are already present in `db/migrations/0001_initial_schema.sql` and `0002_tokens_extra_fields.sql`.

---

## §2 BinanceApiClient interface

**File**: `apps/backend/src/sync/clients/binance-api.ts`

The client wraps all signed Binance REST calls. It reads `BINANCE_API_KEY` and `BINANCE_SECRET_KEY` from the process environment (already validated in `apps/backend/src/env.ts`). The secret key NEVER appears in URLs, log output, or thrown error messages.

### §2.1 assertConfigured()

```typescript
assertConfigured(): void
```

- If `BINANCE_API_KEY` is empty or absent → throw `ApiKeyMissingError('BINANCE_API_KEY')`
  - `code = 'API_KEY_MISSING'`, HTTP status 400
- If `BINANCE_SECRET_KEY` is empty or absent → throw `ApiKeyMissingError('BINANCE_SECRET_KEY')`

### §2.2 Authentication

All signed endpoints:
1. Build `URLSearchParams` with all parameters plus `timestamp=Date.now()` and `recvWindow=60000`.
2. Compute `signature = HMAC-SHA256(BINANCE_SECRET_KEY, params.toString()).digest('hex')`.
3. Append `signature` to the params.
4. Set header `X-MBX-APIKEY: BINANCE_API_KEY`.
5. Secret key MUST NOT appear in the URL, the params string sent to any logger, or in any thrown error's `message` or `context`.

### §2.3 Error mapping

| Binance error code | Thrown error |
|--------------------|--------------|
| `-2015`, `-2014` | `ValidationError('Invalid Binance API credentials or insufficient permissions', 'BINANCE_INVALID_CREDENTIALS')` — statusCode 400 |
| HTTP 429 | `ExternalApiError('binance')` with message `"External API error: binance"` — statusCode 502 |
| Any other non-2xx | `ExternalApiError('binance')` — statusCode 502 |

The raw Binance error response body is logged at `warn` level for debugging. The API key and secret MUST NOT be part of the log payload.

### §2.4 getAccountAssets()

```typescript
getAccountAssets(): Promise<{ asset: string; free: string; locked: string }[]>
```

- `GET /api/v3/account` (signed)
- Returns only assets where `parseFloat(free) + parseFloat(locked) > 0`

### §2.5 getMyTrades(symbol, startTime, endTime)

```typescript
getMyTrades(
  symbol: string,
  startTime: number,
  endTime: number
): Promise<BinanceTrade[]>
```

`BinanceTrade`:
```typescript
interface BinanceTrade {
  id: number
  orderId: number
  symbol: string
  price: string
  qty: string
  quoteQty: string
  isBuyer: boolean
  commissionAsset: string
  commission: string
  time: number
}
```

### §2.6 getConvertHistory(startTime, endTime)

```typescript
getConvertHistory(
  startTime: number,
  endTime: number
): Promise<BinanceConvert[]>
```

- `GET /sapi/v1/convert/tradeFlow` (signed)
- Returns only records where `orderStatus === 'SUCCESS'`

`BinanceConvert`:
```typescript
interface BinanceConvert {
  orderId: string
  fromAsset: string
  toAsset: string
  fromAmount: string
  toAmount: string
  orderStatus: string
  createTime: number
}
```

### §2.7 getWithdrawHistory(startTime, endTime)

```typescript
getWithdrawHistory(
  startTime: number,
  endTime: number
): Promise<BinanceWithdrawal[]>
```

- `GET /sapi/v1/capital/withdraw/history` (signed)
- Returns only records where `status === 6` (completed)

`BinanceWithdrawal`:
```typescript
interface BinanceWithdrawal {
  id: string
  coin: string
  amount: string
  address: string
  txId: string
  applyTime: string
  status: number
}
```

### §2.8 getDepositHistory(startTime, endTime)

```typescript
getDepositHistory(
  startTime: number,
  endTime: number
): Promise<BinanceDeposit[]>
```

- `GET /sapi/v1/capital/deposit/hisrec` (signed)
- Returns only records where `status === 1` (success)

`BinanceDeposit`:
```typescript
interface BinanceDeposit {
  coin: string
  amount: string
  address: string
  txId: string
  insertTime: number
  status: number
}
```

---

## §3 BinanceSyncService.sync(walletId, userId)

```typescript
sync(walletId: string, userId: string): Promise<BinanceSyncResult>
```

**Steps** (in order):

1. Load wallet: `SELECT id, wallet_type, address FROM wallets WHERE id=$1 AND user_id=$2`
   - Not found → `NotFoundError('Wallet not found', 'WALLET_NOT_FOUND')`
2. Guard: if `wallet.wallet_type !== 'CEX'` → throw `new Error('invariant: BinanceSyncService.sync called with non-CEX wallet')` (programming-error, not a user-facing error — route dispatch owns the gate)
3. Call `binanceClient.assertConfigured()` — throws `ApiKeyMissingError` if keys missing
4. Acquire `pgc` (pool client), begin transaction
5. Run in sequence (all within the same pool client):
   - `syncTrades(pgc, walletId)` → `tradesResult`
   - `syncConvert(pgc, walletId)` → `convertsResult`
   - `syncWithdrawals(pgc, walletId)` → `withdrawalsResult`
   - `syncDeposits(pgc, walletId)` → `depositsResult`
6. Commit transaction
7. Return `BinanceSyncResult` assembled from all sub-results

---

## §4 syncTrades(pgc, walletId)

```typescript
private syncTrades(
  pgc: PoolClient,
  walletId: string
): Promise<{ synced: number; skipped: number; symbolsProcessed: number }>
```

**Step-by-step**:

1. `binanceClient.getAccountAssets()` → assets where `free + locked > 0`
2. For each asset, derive `symbol = '${asset}USDT'`
3. Load cursor: `operation = 'trades:${symbol}'`
   - If cursor exists: `startTime = cursor.last_value` (ISO string → epoch ms)
   - Else: `startTime = Date.now() - 30 * 24 * 60 * 60 * 1000` (30 days back as initial window)
4. Window iteration (24h per window):
   ```
   while (startTime < now):
     endTime = min(startTime + 24h, now)
     trades = binanceClient.getMyTrades(symbol, startTime, endTime)
     for each trade:
       persist(trade)
     startTime = endTime
   ```
5. Per trade classification:
   - `isBuyer === true` → `type = 'BUY'`
   - `isBuyer === false` → `type = 'SELL'`
6. Price resolution per trade:
   - Derive `quoteAsset` from `symbol` (e.g. `ETHUSDT` → `USDT`, `BTCETH` → `ETH`)
   - If `quoteAsset ∈ { 'USDT', 'BUSD', 'USDC' }` → `price_usd = parseFloat(quoteQty) / parseFloat(qty)` (exact, no API call)
   - Else → `price_usd = getCexPrice(quoteAsset) × (parseFloat(quoteQty) / parseFloat(qty))`
7. `tokenId = ensureTokenCex(pgc, baseAsset, baseAsset)` (e.g. baseAsset = `'ETH'`)
8. `persistBinanceTx(pgc, { walletId, tokenId, type, cexTradeId: trade.id, txLogIndex: 0, relatedTxId: null, txHash: null, amount: trade.qty, priceUsd, costSource: 'MARKET', fromAddress: null, toAddress: null, commissionAsset: trade.commissionAsset, commissionAmount: trade.commission })`
   - `txLogIndex` is ALWAYS `0` for trades (single-row, see AD-2 in proposal)
9. After all windows for all symbols: `setCursor(pgc, walletId, 'trades:${symbol}', now)`
10. Returns `{ synced, skipped, symbolsProcessed: assets.length }`

**tx_log_index clarification**: The PRD wording says `tx_log_index=NULL` for trades. This spec overrides that wording. Use `tx_log_index=0` for all single-row CEX transactions. The `UNIQUE(cex_trade_id, tx_log_index) WHERE cex_trade_id IS NOT NULL` index does NOT prevent duplicates when `tx_log_index IS NULL` (NULL != NULL in standard SQL). Using `0` makes the index effective. This is the correct implementation of the PRD's idempotency intent.

---

## §5 syncConvert(pgc, walletId)

```typescript
private syncConvert(
  pgc: PoolClient,
  walletId: string
): Promise<{ synced: number; skipped: number }>
```

**Step-by-step**:

1. Load cursor: `operation = 'converts'`
   - If cursor exists: `startTime = cursor.last_value`
   - Else: `startTime = Date.now() - 30 * 24 * 60 * 60 * 1000`
2. Window iteration (30 days per window):
   ```
   while (startTime < now):
     endTime = min(startTime + 30d, now)
     converts = binanceClient.getConvertHistory(startTime, endTime)
     for each convert (status='SUCCESS' already filtered in client):
       persistConvertPair(pgc, walletId, convert)
     startTime = endTime
   ```
3. Per Convert order, two rows are inserted in sequence:

   **SWAP_OUT row** (tx_log_index = 0):
   - `type = 'SWAP_OUT'`
   - `source = 'BINANCE'`
   - `cex_trade_id = BigInt(convert.orderId)`
   - `tx_log_index = 0`
   - `amount = convert.fromAmount`
   - `tokenId = ensureTokenCex(pgc, convert.fromAsset, convert.fromAsset)`
   - Price: if `fromAsset ∈ { 'USDT', 'BUSD', 'USDC' }` → `fromPriceUsd = 1.0`; else `fromPriceUsd = getCexPrice(convert.fromAsset)`
   - `related_tx_id = swapInId` (ID of the SWAP_IN row inserted next — see note)
   - `persistBinanceTx(...)` → `swapOutId`

   **SWAP_IN row** (tx_log_index = 1):
   - `type = 'SWAP_IN'`
   - `source = 'BINANCE'`
   - `cex_trade_id = BigInt(convert.orderId)` (same orderId)
   - `tx_log_index = 1`
   - `amount = convert.toAmount`
   - `tokenId = ensureTokenCex(pgc, convert.toAsset, convert.toAsset)`
   - `priceUsd = (fromPriceUsd × parseFloat(convert.fromAmount)) / parseFloat(convert.toAmount)` (USD value conserved)
   - `related_tx_id = swapOutId`
   - `persistBinanceTx(...)` → `swapInId`

   **Cross-link**: after both rows are inserted, update `SWAP_OUT.related_tx_id = swapInId` via `UPDATE transactions SET related_tx_id=$1 WHERE id=$2`.

   **Idempotency**: `ON CONFLICT DO NOTHING` on `UNIQUE(cex_trade_id, tx_log_index) WHERE cex_trade_id IS NOT NULL`. If the SWAP_OUT already exists (skipped), skip the SWAP_IN as well (check `inserted=false` from `persistBinanceTx`).

4. After all windows: `setCursor(pgc, walletId, 'converts', now)`
5. Returns `{ synced, skipped }` — `synced` counts Convert orders where both rows were inserted; `skipped` counts orders where SWAP_OUT was already present

---

## §6 syncWithdrawals(pgc, walletId)

```typescript
private syncWithdrawals(
  pgc: PoolClient,
  walletId: string
): Promise<{ synced: number; skipped: number }>
```

**Step-by-step**:

1. Load cursor: `operation = 'withdrawals'`
   - Else: `startTime = Date.now() - 90 * 24 * 60 * 60 * 1000`
2. Window iteration (90 days per window):
   ```
   while (startTime < now):
     endTime = min(startTime + 90d, now)
     withdrawals = binanceClient.getWithdrawHistory(startTime, endTime)
     for each withdrawal:
       persistWithdrawal(pgc, walletId, withdrawal)
     startTime = endTime
   ```
3. Per withdrawal:
   - `type = 'TRANSFER_OUT'`
   - `source = 'BINANCE'`
   - `cex_trade_id = BigInt(withdrawal.id)`
   - `tx_log_index = 0`
   - `tx_hash = withdrawal.txId` — MUST NOT be null (this is the Binance→on-chain bridge used by `resolveTransferCost` step 2)
   - `amount = withdrawal.amount`
   - `tokenId = ensureTokenCex(pgc, withdrawal.coin, withdrawal.coin)`
   - `priceUsd`: load the OPEN CEX position for this token BEFORE inserting — use `position.wac` as the price. If no open position exists, use `getCexPrice(withdrawal.coin)`.
   - `from_address = null`
   - `to_address = withdrawal.address`
   - `persistBinanceTx(pgc, { ..., txHash: withdrawal.txId, costSource: 'INHERITED' })` (WAC from own position)
4. After all windows: `setCursor(pgc, walletId, 'withdrawals', now)`
5. Returns `{ synced, skipped }`

**Critical invariant**: `tx_hash = withdrawal.txId` must always be stored (never null). On-chain sync's `resolveTransferCost` step 2 queries `WHERE source='BINANCE' AND type='TRANSFER_OUT' AND tx_hash=$txId`. If `tx_hash` is null this cross-source WAC inheritance silently breaks.

---

## §7 syncDeposits(pgc, walletId)

```typescript
private syncDeposits(
  pgc: PoolClient,
  walletId: string
): Promise<{ synced: number; skipped: number; inherited: number; manual: number }>
```

**Step-by-step**:

1. Load cursor: `operation = 'deposits'`
   - Else: `startTime = Date.now() - 90 * 24 * 60 * 60 * 1000`
2. Window iteration (90 days per window)
3. Per deposit:
   - `type = 'TRANSFER_IN'`
   - `source = 'BINANCE'`
   - `tx_hash = deposit.txId` (on-chain hash for traceability)
   - `tx_log_index = 0`
   - `tokenId = ensureTokenCex(pgc, deposit.coin, deposit.coin)`
   - `cex_trade_id`: parse `deposit.txId` as BigInt if it is a numeric string; else `null` (some deposits use a non-numeric hash as the identifier — use `tx_hash` for tracing those)
   - `amount = deposit.amount`
   - `from_address = deposit.address`
   - `to_address = null`

   **Cost resolution** (two steps):

   Step 1 — INHERITED:
   ```sql
   SELECT p.wac
   FROM transactions t
   JOIN positions p ON p.id = t.position_id
   JOIN wallets w ON w.id = t.wallet_id
   WHERE w.wallet_type = 'ON_CHAIN'
     AND lower(w.address) = lower($1)   -- deposit.address
     AND t.type = 'TRANSFER_OUT'
     AND t.tx_hash = $2                 -- deposit.txId
     AND p.token_id = $3               -- tokenId
   ORDER BY t.block_timestamp DESC
   LIMIT 1
   ```
   If row found: `price_usd = row.wac`, `cost_source = 'INHERITED'`, increment `inherited`

   Step 2 — MARKET:
   If no row found: `price_usd = getCexPrice(deposit.coin)`, `cost_source = 'MARKET'`, increment `manual`

4. `persistBinanceTx(pgc, { ..., priceUsd, costSource })`
5. After all windows: `setCursor(pgc, walletId, 'deposits', now)`
6. Returns `{ synced, skipped, inherited, manual }`

---

## §8 ensureTokenCex(pgc, symbol, binanceSymbol)

```typescript
private ensureTokenCex(
  pgc: PoolClient,
  symbol: string,
  binanceSymbol: string
): Promise<string>  // returns tokenId (UUID)
```

```sql
-- Step 1: try to find existing
SELECT id FROM tokens
WHERE network = 'CEX_BINANCE'
  AND lower(contract_address) = lower($1)
LIMIT 1;

-- Step 2: insert if missing
INSERT INTO tokens (symbol, network, contract_address, decimals, binance_symbol)
VALUES ($1, 'CEX_BINANCE', lower($1), 8, $2)
ON CONFLICT DO NOTHING;

-- Step 3: re-select on conflict
SELECT id FROM tokens
WHERE network = 'CEX_BINANCE'
  AND lower(contract_address) = lower($1)
LIMIT 1;
```

- `contract_address` stores `lower(symbol)` — no real contract address exists for CEX tokens
- `decimals = 8` (Binance amounts have up to 8 decimal places)
- `binance_symbol` is the base asset symbol (e.g. `'ETH'`) — used by `PriceService.getCexPrice`
- Increments `tokensCreated` counter in the parent sync context when a new row is actually inserted

---

## §9 persistBinanceTx

```typescript
private persistBinanceTx(
  pgc: PoolClient,
  params: {
    walletId: string
    tokenId: string
    type: TransactionType
    cexTradeId: bigint | null
    txLogIndex: number
    relatedTxId: string | null
    txHash: string | null
    amount: string
    priceUsd: number | null
    costSource: 'INHERITED' | 'MARKET' | 'MANUAL'
    fromAddress: string | null
    toAddress: string | null
    commissionAsset?: string
    commissionAmount?: string
  }
): Promise<{ inserted: boolean; id: string }>
```

**Steps** (mirrors `persistOneTransaction` from `on-chain-sync.ts`):

1. Load OPEN position `FOR UPDATE`:
   ```sql
   SELECT * FROM positions
   WHERE wallet_id = $1 AND token_id = $2 AND status = 'OPEN'
   FOR UPDATE
   ```
2. Count closed cycles:
   ```sql
   SELECT MAX(cycle_number) FROM positions
   WHERE wallet_id = $1 AND token_id = $2 AND status = 'CLOSED'
   ```
3. Call `PositionEngine.processTransaction(position, tx)` → `{ newPosition, processedTx }`
4. UPSERT position:
   ```sql
   INSERT INTO positions (...) VALUES (...)
   ON CONFLICT (wallet_id, token_id, status) WHERE status='OPEN'
   DO UPDATE SET ...
   ```
5. INSERT transaction:
   ```sql
   INSERT INTO transactions (
     wallet_id, token_id, type, source,
     cex_trade_id, tx_log_index, tx_hash, related_tx_id,
     amount, price_usd, cost_source,
     from_address, to_address,
     commission_asset, commission_amount,
     position_id, block_timestamp
   ) VALUES (...)
   ON CONFLICT DO NOTHING
   RETURNING id
   ```
   - If `RETURNING id` returns no row → `inserted = false`, `id = null`
   - Else → `inserted = true`, `id = returned UUID`
6. Returns `{ inserted, id }`

**BIGINT overflow guard**: if PostgreSQL returns error code `22003` (numeric_value_out_of_range) — likely a Binance orderId exceeding signed 64-bit max — catch it, log a `warn` message (without the key), increment `skipped`, and return `{ inserted: false, id: null }`.

---

## §10 Response schema (BinanceSyncResultSchema)

Defined in `apps/backend/src/schemas/sync.ts` alongside the existing `SyncResultSchema`.

```typescript
export const BinanceSyncResultSchema = z.object({
  trades: z.object({
    synced: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    symbolsProcessed: z.number().int().nonnegative(),
  }),
  converts: z.object({
    synced: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
  withdrawals: z.object({
    synced: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
  deposits: z.object({
    synced: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    inherited: z.number().int().nonnegative(),
    manual: z.number().int().nonnegative(),
  }),
  tokensCreated: z.number().int().nonnegative(),
})

export type BinanceSyncResult = z.infer<typeof BinanceSyncResultSchema>
```

---

## §11 Error scenarios

| Scenario | Error class | Code | HTTP |
|----------|-------------|------|------|
| `BINANCE_API_KEY` not set or empty | `ApiKeyMissingError('BINANCE_API_KEY')` | `API_KEY_MISSING` | 400 |
| `BINANCE_SECRET_KEY` not set or empty | `ApiKeyMissingError('BINANCE_SECRET_KEY')` | `API_KEY_MISSING` | 400 |
| Binance returns `-2015` or `-2014` | `ValidationError('Invalid Binance API credentials or insufficient permissions', 'BINANCE_INVALID_CREDENTIALS')` | `BINANCE_INVALID_CREDENTIALS` | 400 |
| Binance HTTP 429 | `ExternalApiError('binance')` | `EXTERNAL_API_ERROR` | 502 |
| Any other Binance HTTP failure | `ExternalApiError('binance')` | `EXTERNAL_API_ERROR` | 502 |
| `wallet_type !== 'CEX'` (programming guard) | `Error('invariant: ...')` — not a user-facing error | — | 500 |
| Wallet not found | `NotFoundError('Wallet not found', 'WALLET_NOT_FOUND')` | `WALLET_NOT_FOUND` | 404 |

Error responses MUST NOT include `BINANCE_API_KEY` or `BINANCE_SECRET_KEY` values in any field (`message`, `context`, stack trace, or Fastify error serialization).

---

## §12 Invariants

All of the following must hold after any call to `sync()`:

| ID | Invariant |
|----|-----------|
| INV-1 | Each Convert `orderId` generates exactly 2 rows: `SWAP_OUT` with `tx_log_index=0` and `SWAP_IN` with `tx_log_index=1` |
| INV-2 | `SWAP_OUT.related_tx_id === SWAP_IN.id` AND `SWAP_IN.related_tx_id === SWAP_OUT.id` |
| INV-3 | Every withdrawal row has `tx_hash = withdrawal.txId` (never null) |
| INV-4 | Running any sync sub-method twice with identical Binance data produces the same DB state (second run: `skipped` counter increments, no duplicate rows, no position double-processing) |
| INV-5 | Deposit with `cost_source='INHERITED'`: `price_usd` equals the `wac` from the on-chain `TRANSFER_OUT` row matching `(deposit.address, deposit.txId, tokenId)` |
| INV-6 | `BINANCE_SECRET_KEY` and `BINANCE_API_KEY` values never appear in log output, thrown error messages, or HTTP responses |
| INV-7 | `tx_log_index = 0` for all single-row CEX transactions (trades, withdrawals, deposits) |

---

## §13 Negative test cases

Tests are written with Vitest 2.1. All must have a failing test before implementation (Strict TDD Mode).

| ID | Scenario | Expected |
|----|----------|----------|
| NEGATIVE-CEX-01 | `POST /api/sync/:walletId` where wallet is `wallet_type='ON_CHAIN'` — route dispatch rejects at route level, BinanceSyncService is never called | 400, code discriminated by route guard (this tests that the dispatch works, not the service guard) |
| NEGATIVE-CEX-02 | `BINANCE_API_KEY` is empty string or not set when `sync()` is called | 400, `code='API_KEY_MISSING'` |
| NEGATIVE-CEX-03 | `BinanceApiClient` receives a Binance error response with `code=-2015` | 400, `code='BINANCE_INVALID_CREDENTIALS'`, response body does NOT contain the key value |
| NEGATIVE-CEX-04 | Binance endpoint returns HTTP 500 | 502, `code='EXTERNAL_API_ERROR'`, response body does NOT contain `BINANCE_API_KEY` or `BINANCE_SECRET_KEY` values |

---

## §14 Cursor contract

All cursors use `wallet_sync_cursors(wallet_id, operation)` with `UNIQUE(wallet_id, operation)`.

| Sub-method | operation key | Window size | `last_value` semantics |
|------------|---------------|-------------|------------------------|
| `syncTrades` | `trades:${symbol}` (e.g. `trades:ETHUSDT`) | 24h | ISO timestamp of the last window's `endTime` |
| `syncConvert` | `converts` | 30 days | ISO timestamp of the last window's `endTime` |
| `syncWithdrawals` | `withdrawals` | 90 days | ISO timestamp of the last window's `endTime` |
| `syncDeposits` | `deposits` | 90 days | ISO timestamp of the last window's `endTime` |

Cursors are updated after all windows for a sub-method complete (not per-window). If an error occurs mid-window, the cursor is not advanced — the next run will re-fetch from the last cursor position (idempotent by `ON CONFLICT DO NOTHING`).
