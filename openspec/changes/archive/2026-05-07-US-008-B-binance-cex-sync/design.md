# Design — US-008-B-binance-cex-sync

**Date**: 2026-05-07

## §1 Overview

This design covers the implementation of `BinanceSyncService` and `BinanceApiClient` for US-008-B. It extends the existing `POST /api/sync/:walletId` route to dispatch CEX wallet sync to a new `BinanceSyncService` that pulls trades, converts, withdrawals, and deposits from the Binance REST API. The service classifies each event into the shared transaction model (WAC, position cycles, swap decomposition) and persists them idempotently using the existing schema. No new migrations are required.

---

## §2 Type definitions

### §2.1 BinanceApiClient interface

```typescript
// apps/backend/src/sync/clients/binance-api.ts

export type BinanceTrade = {
  symbol: string
  id: number          // Binance trade ID — fits in JS number (int53 safe)
  orderId: number
  price: string       // string decimal
  qty: string
  quoteQty: string
  isBuyer: boolean
  time: number        // unix ms
  commissionAsset: string | null
  commission: string | null
}

export type BinanceConvert = {
  orderId: string     // large integer string — up to 18 digits; parsed to BigInt for DB
  fromAsset: string
  toAsset: string
  fromAmount: string
  toAmount: string
  status: string      // 'SUCCESS' | 'FAIL' | ...
  createTime: number  // unix ms
}

export type BinanceWithdrawal = {
  id: string          // withdrawal record ID (numeric string)
  coin: string
  amount: string
  address: string
  txId: string        // on-chain tx hash — bridge for resolveTransferCost
  applyTime: number   // unix ms
  status: number      // 6 = completed
}

export type BinanceDeposit = {
  coin: string
  amount: string
  address: string     // the on-chain address it came from
  txId: string        // on-chain tx hash
  insertTime: number  // unix ms
  status: number      // 1 = success
}

export interface BinanceApiClient {
  assertConfigured(): void
  getAccountAssets(): Promise<Array<{ asset: string; free: string; locked: string }>>
  getMyTrades(symbol: string, startTime: number, endTime: number): Promise<BinanceTrade[]>
  getConvertHistory(startTime: number, endTime: number): Promise<BinanceConvert[]>
  getWithdrawHistory(startTime: number, endTime: number): Promise<BinanceWithdrawal[]>
  getDepositHistory(startTime: number, endTime: number): Promise<BinanceDeposit[]>
}
```

### §2.2 BinanceSyncService types

```typescript
// apps/backend/src/services/binance-sync.ts

export type BinanceSyncDeps = {
  pool: Pool
  priceService: PriceService
  binanceClient: BinanceApiClient
}

export type BinanceSyncResult = {
  trades: { synced: number; skipped: number; symbolsProcessed: number }
  converts: { synced: number; skipped: number }
  withdrawals: { synced: number; skipped: number }
  deposits: { synced: number; skipped: number; inherited: number; manual: number }
  tokensCreated: number
}
```

### §2.3 BinanceSyncResultSchema (Zod 4)

```typescript
// apps/backend/src/schemas/sync.ts — ADD alongside existing SyncResultSchema

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

## §3 BinanceApiClient implementation

### §3.1 Factory function

```typescript
// apps/backend/src/sync/clients/binance-api.ts

export function createBinanceApiClient(opts: {
  apiKey: string
  secretKey: string
  log: FastifyBaseLogger
}): BinanceApiClient
```

Pattern mirrors `createEtherscanClient` (same file structure, same `assertConfigured()` guard, same log-before-throw approach — see `etherscan.ts`).

- Uses Node.js built-in `crypto.createHmac('sha256', secretKey).update(queryString).digest('hex')` for signature.
- `apiKey` goes in `X-MBX-APIKEY` header — NOT in the URL.
- `secretKey` NEVER appears in URLs, logs, error messages, or `cause` objects. A dedicated `scrubParams` helper removes `signature` from logged URLSearchParams before any `log.*` call.
- Default `recvWindow=60000` (tolerates ±30s server clock drift in CI environments — see Risk R-4 in proposal).

### §3.2 `signed()` private helper

```
signed(endpoint, params):
  1. Shallow-copy params; add timestamp=Date.now(), recvWindow=60000
  2. Build URLSearchParams from all params
  3. Compute signature = HMAC-SHA256(secretKey, params.toString())
  4. Append signature to params (AFTER HMAC — do not include sig in its own hash)
  5. fetch("https://api.binance.com" + endpoint + "?" + params, {
       headers: { "X-MBX-APIKEY": apiKey }
     })
  6. On network error: throw ExternalApiError('binance', { message: String(err) })
     (no URL — it would contain signature)
  7. On HTTP 429: throw ExternalApiError('binance', { status: 429 })
  8. On non-2xx: read JSON body; check code field
     - -2015 or -2014: throw ValidationError('Invalid Binance API credentials or insufficient permissions', 'BINANCE_INVALID_CREDENTIALS')
     - other: throw ExternalApiError('binance', { status, binanceCode: body.code })
  9. Parse and return JSON as typed response
```

### §3.3 Error-handling invariants

- `secretKey` must never be passed to any `Error` constructor, `log.*` call, or `ExternalApiError` cause object.
- `apiKey` must never appear in logged URLs or error causes.
- Logged line for failures: `[BinanceApiClient] ${endpoint} failed: status=${status}` — status code only.
- `scrubParams(params: URLSearchParams): string` removes `signature` from a copy before logging.

### §3.4 `assertConfigured()`

```typescript
assertConfigured(): void {
  if (!apiKey || !secretKey) {
    throw new ApiKeyMissingError('BINANCE_API_KEY')
  }
}
```

Uses the existing `ApiKeyMissingError` from `apps/backend/src/services/errors.ts`.

---

## §4 BinanceSyncService

### §4.1 Constructor

```typescript
export class BinanceSyncService {
  constructor(private readonly deps: BinanceSyncDeps) {}
}
```

No static factory needed — constructor injection is sufficient (consistent with `OnChainSyncService`).

### §4.2 `sync(walletId, userId)` — public entry point

```typescript
async sync(walletId: string, userId: string): Promise<BinanceSyncResult>
```

```
1. wallet = await loadWallet(pool, walletId, userId)
   // Throws NotFoundError('Wallet not found', 'WALLET_NOT_FOUND') if not found or wrong user
   // Assert: if (wallet.wallet_type !== 'CEX') throw new Error('[BinanceSyncService] invariant: wallet must be CEX')
   // (defense in depth — route dispatch already checked wallet_type)

2. binanceClient.assertConfigured()

3. pgc = await pool.connect()
try {
  tradesResult    = await syncTrades(pgc, walletId)
  convertsResult  = await syncConvert(pgc, walletId)
  withdrawResult  = await syncWithdrawals(pgc, walletId)
  depositResult   = await syncDeposits(pgc, walletId)
  return {
    trades: tradesResult,
    converts: convertsResult,
    withdrawals: withdrawResult,
    deposits: depositResult,
    tokensCreated: totalCreated  // accumulated across all sub-methods via this.tokensCreated counter
  }
} finally {
  pgc.release()
}
```

`tokensCreated` is tracked as an instance-local counter reset at the start of each `sync()` call (not a class field — reset per invocation to avoid cross-call contamination).

### §4.3 `syncTrades(pgc, walletId)`

```typescript
private async syncTrades(
  pgc: PoolClient,
  walletId: string,
): Promise<{ synced: number; skipped: number; symbolsProcessed: number }>
```

```
1. assets = await binanceClient.getAccountAssets()
   // Filter: only assets where parseFloat(free) + parseFloat(locked) > 0
   // Note: this misses fully-sold assets — PRD AC explicitly accepts this limitation

2. For each asset:
   symbol     = `${asset.asset}USDT`
   cursorKey  = `trades:${symbol}`
   startTime  = await getCursor(pgc, walletId, cursorKey) ?? (Date.now() - 30 * 24 * 60 * 60 * 1000)

   while (startTime < Date.now()):
     endTime = Math.min(startTime + 24 * 60 * 60 * 1000, Date.now())
     trades  = await binanceClient.getMyTrades(symbol, startTime, endTime)
     await pgc.query('BEGIN')
     for each trade:
       result = await processTrade(pgc, walletId, asset.asset, trade)
       synced  += result.inserted ? 1 : 0
       skipped += result.inserted ? 0 : 1
     await pgc.query('COMMIT')
     startTime = endTime

   await setCursor(pgc, walletId, cursorKey, Date.now())
   symbolsProcessed++

3. return { synced, skipped, symbolsProcessed }
```

#### `processTrade` sub-step:

```
tokenId  = await ensureTokenCex(pgc, asset, asset)  // symbol=asset.asset, binanceSymbol=asset.asset
type     = trade.isBuyer ? 'BUY' : 'SELL'
priceUsd = await computeTradePrice(trade)
result   = await persistBinanceTx(pgc, {
  walletId,
  tokenId,
  type,
  cexTradeId: BigInt(trade.id),
  txLogIndex: 0,        // AD-2: tx_log_index=0 for single-row CEX ops (not NULL)
  txHash: null,
  amount: trade.qty,
  priceUsd,
  costSource: 'MARKET',
  commissionAsset: trade.commissionAsset ?? null,
  commissionAmount: trade.commission ?? null,
  cexTimestamp: new Date(trade.time),
})
return result
```

### §4.4 `computeTradePrice(trade)`

```typescript
private async computeTradePrice(trade: BinanceTrade): Promise<string>
```

Stable quote asset detection (suffix-based, in order):
- If symbol ends with `USDT`, `USDC`, or `BUSD`: `price_usd = Decimal(quoteQty).div(Decimal(qty)).toFixed(8)` — exact, no API call.
- Otherwise: `quoteAsset` = last 3 chars (for BTC, ETH, BNB) or last 4 chars. Use `getCexPrice(quoteAsset)` → `price_usd = Decimal(getCexPriceResult).mul(Decimal(quoteQty)).div(Decimal(qty)).toFixed(8)`.

All decimal arithmetic uses `Decimal.js` to avoid floating-point precision loss.

### §4.5 `syncConvert(pgc, walletId)`

```typescript
private async syncConvert(
  pgc: PoolClient,
  walletId: string,
): Promise<{ synced: number; skipped: number }>
```

```
startTime = await getCursor(pgc, walletId, 'converts') ?? (Date.now() - 90 * 24 * 60 * 60 * 1000)

while (startTime < Date.now()):
  endTime   = Math.min(startTime + 30 * 24 * 60 * 60 * 1000, Date.now())
  converts  = await binanceClient.getConvertHistory(startTime, endTime)
            // Filter: status === 'SUCCESS' only

  await pgc.query('BEGIN')
  for each convert:
    // Parse orderId safely
    let orderIdBigInt: bigint
    try { orderIdBigInt = BigInt(convert.orderId) }
    catch { log.warn({ orderId: convert.orderId }, 'binance-sync: unparseable Convert orderId, skipped'); continue }

    swapOutId    = randomUUID()
    swapInId     = randomUUID()
    fromTokenId  = await ensureTokenCex(pgc, convert.fromAsset, convert.fromAsset)
    toTokenId    = await ensureTokenCex(pgc, convert.toAsset, convert.toAsset)

    // Price: conserve USD value across the swap
    fromPriceUsd = isStable(convert.fromAsset)
      ? '1.0'
      : (await priceService.getCexPrice(convert.fromAsset)).toString()
    fromTotalUsd = Decimal(fromPriceUsd).mul(Decimal(convert.fromAmount))
    toPriceUsd   = fromTotalUsd.div(Decimal(convert.toAmount)).toFixed(8)

    // SWAP_OUT (tx_log_index=0)
    outResult = await persistBinanceTx(pgc, {
      id: swapOutId, walletId, tokenId: fromTokenId,
      type: 'SWAP_OUT', cexTradeId: orderIdBigInt, txLogIndex: 0,
      relatedTxId: swapInId, txHash: null,
      amount: convert.fromAmount, priceUsd: fromPriceUsd,
      costSource: 'MARKET', cexTimestamp: new Date(convert.createTime),
    })

    // SWAP_IN (tx_log_index=1)
    inResult = await persistBinanceTx(pgc, {
      id: swapInId, walletId, tokenId: toTokenId,
      type: 'SWAP_IN', cexTradeId: orderIdBigInt, txLogIndex: 1,
      relatedTxId: swapOutId, txHash: null,
      amount: convert.toAmount, priceUsd: toPriceUsd,
      costSource: 'MARKET', cexTimestamp: new Date(convert.createTime),
    })

    synced  += (outResult.inserted ? 1 : 0) + (inResult.inserted ? 1 : 0)
    skipped += (outResult.inserted ? 0 : 1) + (inResult.inserted ? 0 : 1)
  await pgc.query('COMMIT')
  startTime = endTime

await setCursor(pgc, walletId, 'converts', Date.now())
return { synced, skipped }
```

`isStable(asset)` returns `true` for `'USDT' | 'USDC' | 'BUSD'`.

### §4.6 `syncWithdrawals(pgc, walletId)`

```typescript
private async syncWithdrawals(
  pgc: PoolClient,
  walletId: string,
): Promise<{ synced: number; skipped: number }>
```

```
startTime = await getCursor(pgc, walletId, 'withdrawals') ?? (Date.now() - 90 * 24 * 60 * 60 * 1000)

while (startTime < Date.now()):
  endTime     = Math.min(startTime + 90 * 24 * 60 * 60 * 1000, Date.now())
  withdrawals = await binanceClient.getWithdrawHistory(startTime, endTime)
              // Filter: status === 6 (completed)

  await pgc.query('BEGIN')
  for each withdrawal:
    tokenId = await ensureTokenCex(pgc, withdrawal.coin, withdrawal.coin)

    // Load current WAC from OPEN position — used as TRANSFER_OUT price
    posRow = await pgc.query(
      'SELECT wac FROM positions WHERE wallet_id=$1 AND token_id=$2 AND status=\'OPEN\' LIMIT 1',
      [walletId, tokenId]
    )
    priceUsd = posRow.rows[0]?.wac ?? '0'
    // If no open position, price=0 — TRANSFER_OUT with WAC=0 means unknown cost basis.
    // This is correct: if we don't know the cost basis, WAC=0 is the safe sentinel.

    result = await persistBinanceTx(pgc, {
      walletId, tokenId,
      type: 'TRANSFER_OUT',
      cexTradeId: BigInt(withdrawal.id),
      txLogIndex: 0,        // AD-2: single-row CEX op
      txHash: withdrawal.txId,  // CRITICAL: bridge column for on-chain resolveTransferCost step 2
      amount: withdrawal.amount,
      priceUsd,
      costSource: 'INHERITED',
      toAddress: withdrawal.address,
      cexTimestamp: new Date(withdrawal.applyTime),
    })
    synced  += result.inserted ? 1 : 0
    skipped += result.inserted ? 0 : 1
  await pgc.query('COMMIT')
  startTime = endTime

await setCursor(pgc, walletId, 'withdrawals', Date.now())
return { synced, skipped }
```

**Critical invariant**: `tx_hash = withdrawal.txId` MUST be stored. Nulling it breaks the inheritance chain for `resolveTransferCost` step 2 in `OnChainSyncService`.

### §4.7 `syncDeposits(pgc, walletId)`

```typescript
private async syncDeposits(
  pgc: PoolClient,
  walletId: string,
): Promise<{ synced: number; skipped: number; inherited: number; manual: number }>
```

```
startTime = await getCursor(pgc, walletId, 'deposits') ?? (Date.now() - 90 * 24 * 60 * 60 * 1000)

while (startTime < Date.now()):
  endTime  = Math.min(startTime + 90 * 24 * 60 * 60 * 1000, Date.now())
  deposits = await binanceClient.getDepositHistory(startTime, endTime)
           // Filter: status === 1 (success)

  await pgc.query('BEGIN')
  for each deposit:
    tokenId    = await ensureTokenCex(pgc, deposit.coin, deposit.coin)
    resolution = await resolveDepositCost(pgc, deposit, tokenId)

    result = await persistBinanceTx(pgc, {
      walletId, tokenId,
      type: 'TRANSFER_IN',
      cexTradeId: null,         // deposits have no cex_trade_id — use txHash for uniqueness
      txLogIndex: 0,
      txHash: deposit.txId,
      amount: deposit.amount,
      priceUsd: resolution.priceUsd,
      costSource: resolution.costSource,
      fromAddress: deposit.address,
      cexTimestamp: new Date(deposit.insertTime),
    })
    synced   += result.inserted ? 1 : 0
    skipped  += result.inserted ? 0 : 1
    if (result.inserted) {
      resolution.costSource === 'INHERITED' ? inherited++ : manual++
    }
  await pgc.query('COMMIT')
  startTime = endTime

await setCursor(pgc, walletId, 'deposits', Date.now())
return { synced, skipped, inherited, manual }
```

Note on deposits idempotency: deposits have no `cex_trade_id`, so the `UNIQUE(cex_trade_id, tx_log_index)` index does not apply. Idempotency relies on `tx_hash` + `wallet_id` + `token_id` application-level deduplication. The `persistBinanceTx` method must issue a `SELECT` before `INSERT` for deposit rows (no `cexTradeId`). Alternatively, a separate partial index `UNIQUE(tx_hash, wallet_id) WHERE source='BINANCE' AND type='TRANSFER_IN'` can be added — but since no migration is in scope, the SELECT-before-INSERT approach is used for V1.

### §4.8 `resolveDepositCost(pgc, deposit, tokenId)`

```typescript
private async resolveDepositCost(
  pgc: PoolClient,
  deposit: BinanceDeposit,
  tokenId: string,
): Promise<{ priceUsd: string; costSource: 'INHERITED' | 'MARKET' }>
```

Step 1 — query for matching on-chain TRANSFER_OUT:

```sql
SELECT p.wac
FROM transactions t
JOIN positions p ON p.id = t.position_id
JOIN wallets w ON w.id = t.wallet_id
WHERE w.wallet_type = 'ON_CHAIN'
  AND lower(w.address) = lower($1)   -- deposit.address (sender wallet)
  AND t.type = 'TRANSFER_OUT'
  AND t.tx_hash = $2                 -- deposit.txId (on-chain hash)
  AND t.token_id = $3                -- tokenId
ORDER BY t.block_timestamp DESC
LIMIT 1
```

Parameters: `[deposit.address, deposit.txId, tokenId]`

- If row found: `return { priceUsd: row.wac, costSource: 'INHERITED' }`

Step 2 — market fallback:

```typescript
const price = await priceService.getCexPrice(deposit.coin)
return { priceUsd: String(price), costSource: 'MARKET' }
```

`getCexPrice` is already implemented in `price.ts` — calls `GET /api/v3/ticker/price?symbol={coin}USDT` with 10s cache. Returns current price (historical lookup not available — same limitation as on-chain sync, accepted by PRD).

### §4.9 `ensureTokenCex(pgc, symbol, binanceSymbol?)`

```typescript
private async ensureTokenCex(
  pgc: PoolClient,
  symbol: string,
  binanceSymbol?: string,
): Promise<{ tokenId: string; created: boolean }>
```

Three-step pattern (same as `ensureToken` in `OnChainSyncService`, adapted for CEX):

```sql
-- Step 1: optimistic SELECT
SELECT id FROM tokens
WHERE network = 'CEX_BINANCE'
  AND lower(contract_address) = lower($1)
LIMIT 1
```

If found: `return { tokenId: row.id, created: false }`

```sql
-- Step 2: INSERT ON CONFLICT DO NOTHING
INSERT INTO tokens (id, symbol, network, contract_address, decimals, binance_symbol)
VALUES (gen_random_uuid(), $1, 'CEX_BINANCE', lower($1), 8, $2)
ON CONFLICT DO NOTHING
```

`decimals=8` — Binance amounts have up to 8 decimal places (convention established here, must be consistent with position engine amount parsing).

```sql
-- Step 3: re-SELECT (handles race condition)
SELECT id FROM tokens
WHERE network = 'CEX_BINANCE'
  AND lower(contract_address) = lower($1)
LIMIT 1
```

Returns `{ tokenId: row.id, created: step2RowCount === 1 }`.

Side effect: if `created === true`, increment the `tokensCreated` counter for the current `sync()` invocation.

### §4.10 `persistBinanceTx(pgc, opts)`

```typescript
type PersistBinanceTxOpts = {
  id?: string                           // pre-generated UUID (for swap pair linking)
  walletId: string
  tokenId: string
  type: TransactionType
  cexTradeId: bigint | null
  txLogIndex: number
  relatedTxId?: string | null
  txHash?: string | null
  amount: string
  priceUsd: string
  costSource: 'INHERITED' | 'MARKET' | 'MANUAL'
  fromAddress?: string | null
  toAddress?: string | null
  commissionAsset?: string | null
  commissionAmount?: string | null
  cexTimestamp: Date
}

private async persistBinanceTx(
  pgc: PoolClient,
  opts: PersistBinanceTxOpts,
): Promise<{ inserted: boolean }>
```

```
-- 1. Load OPEN position FOR UPDATE (same pattern as persistOneTransaction in OnChainSyncService)
positionRow = SELECT * FROM positions
  WHERE wallet_id=$walletId AND token_id=$tokenId AND status='OPEN'
  FOR UPDATE SKIP LOCKED    -- avoid deadlocks under concurrent sync
  LIMIT 1

closedCount = SELECT count(*)::int FROM positions
  WHERE wallet_id=$walletId AND token_id=$tokenId AND status='CLOSED'

-- 2. Build PositionEngine-compatible transaction shape
engineTx = {
  id: opts.id ?? randomUUID(),
  type: opts.type,
  source: 'BINANCE',
  amount: opts.amount,
  priceUsd: opts.priceUsd,
  costSource: opts.costSource,
  relatedTxId: opts.relatedTxId ?? null,
  timestamp: opts.cexTimestamp,
}

-- 3. Run position engine (pure, no side effects)
engineResult = processTransaction(engineTx, positionRow ?? null, closedCount)
// engineResult: { position: PositionState, transaction: ProcessedTransaction }

-- 4. UPSERT position
INSERT INTO positions (id, wallet_id, token_id, status, wac, balance, cost_basis_usd,
  realized_pnl_usd, cycle_number, opened_at, closed_at)
VALUES (engineResult.position.id, $walletId, $tokenId, ...)
ON CONFLICT (id) DO UPDATE SET
  status=EXCLUDED.status, wac=EXCLUDED.wac, balance=EXCLUDED.balance,
  cost_basis_usd=EXCLUDED.cost_basis_usd, realized_pnl_usd=EXCLUDED.realized_pnl_usd,
  closed_at=EXCLUDED.closed_at, updated_at=now()

-- 5. INSERT transaction — ON CONFLICT DO NOTHING (idempotency)
result = INSERT INTO transactions (
  id, wallet_id, token_id, position_id,
  source, type, amount, price_usd, cost_source,
  cex_trade_id, tx_log_index, tx_hash, related_tx_id,
  from_address, to_address,
  commission_asset, commission_amount,
  block_timestamp,   -- use cexTimestamp for CEX rows
  created_at
)
VALUES (
  engineTx.id, $walletId, $tokenId, engineResult.position.id,
  'BINANCE', $type, $amount, $priceUsd, $costSource,
  $cexTradeId, $txLogIndex, $txHash, $relatedTxId,
  $fromAddress, $toAddress,
  $commissionAsset, $commissionAmount,
  $cexTimestamp, now()
)
ON CONFLICT DO NOTHING
RETURNING id

return { inserted: result.rowCount === 1 }
```

**AD-3 mitigation**: Wrap the INSERT in a try/catch for PostgreSQL error code `22003` (numeric_value_out_of_range). On overflow, log a warning with `{ type, cexTradeId: opts.cexTradeId?.toString() }` and return `{ inserted: false }`.

### §4.11 `getCursor` and `setCursor` helpers

```typescript
private async getCursor(
  pgc: PoolClient,
  walletId: string,
  operation: string,
): Promise<number | null>
```

```sql
SELECT last_value FROM wallet_sync_cursors
WHERE wallet_id=$1 AND operation=$2
```

Returns `Date.parse(row.last_value)` (milliseconds) or `null` if no cursor exists.

```typescript
private async setCursor(
  pgc: PoolClient,
  walletId: string,
  operation: string,
  valueMs: number,
): Promise<void>
```

```sql
INSERT INTO wallet_sync_cursors (wallet_id, operation, last_value)
VALUES ($1, $2, to_timestamp($3 / 1000.0)::text)
ON CONFLICT (wallet_id, operation)
DO UPDATE SET last_value = EXCLUDED.last_value, updated_at = now()
```

`$3` is the unix millisecond timestamp; dividing by 1000.0 gives seconds for `to_timestamp`. Storing as text preserves consistency with the existing cursor format used by `OnChainSyncService`.

---

## §5 Route changes

### §5.1 Dispatch pattern

```typescript
// apps/backend/src/routes/sync.ts

fastify.withTypeProvider<ZodTypeProvider>().post(
  '/:walletId',
  { schema: { params: SyncParamsSchema } },
  async (req, reply) => {
    const userId = (req.user as { sub: string }).sub

    const walletRes = await pool.query<{ wallet_type: 'ON_CHAIN' | 'CEX' }>(
      'SELECT wallet_type FROM wallets WHERE id=$1 AND user_id=$2',
      [req.params.walletId, userId],
    )
    const wallet = walletRes.rows[0]
    if (!wallet) throw new NotFoundError('Wallet not found', 'WALLET_NOT_FOUND')

    if (wallet.wallet_type === 'ON_CHAIN') {
      const result = await onChainService.sync(req.params.walletId, userId)
      return reply.send(result)
    }

    const result = await binanceService.sync(req.params.walletId, userId)
    return reply.send(result)
  },
)
```

No response schema validation on the route — the service returns the correct shape and Zod typing covers compile-time safety. Adding `z.union([SyncResultSchema, BinanceSyncResultSchema])` as a response schema is optional; avoid it to reduce per-request serialization overhead for a non-public internal route.

### §5.2 Service instantiation

Both services are instantiated once in the plugin closure:

```typescript
// apps/backend/src/routes/sync.ts plugin closure

const pool = new Pool({ connectionString: env.DATABASE_URL })
const priceService = new PriceService(fastify.log)
const etherscanClient = createEtherscanClient({ apiKey: env.ETHERSCAN_API_KEY, log: fastify.log })
const bsctraceClient  = createBscTraceClient({ apiKey: env.BSCTRACE_API_KEY, log: fastify.log })
const onChainService  = new OnChainSyncService({ pool, priceService, etherscanClient, bsctraceClient })
const binanceService  = new BinanceSyncService({
  pool,
  priceService,
  binanceClient: createBinanceApiClient({
    apiKey: env.BINANCE_API_KEY,
    secretKey: env.BINANCE_SECRET_KEY,
    log: fastify.log,
  }),
})
```

### §5.3 Remove wallet-type guard from OnChainSyncService

In `apps/backend/src/services/on-chain-sync.ts`, replace lines 73-75:

```typescript
// REMOVE:
if (wallet.wallet_type === 'CEX') {
  throw new ValidationError('Wallet is not an on-chain wallet', 'NOT_ON_CHAIN_WALLET');
}

// REPLACE WITH (programming-error assertion — route owns dispatch):
if (wallet.wallet_type !== 'ON_CHAIN') {
  throw new Error(`[OnChainSyncService] invariant violation: expected ON_CHAIN wallet, got ${wallet.wallet_type}`);
}
```

---

## §6 Binance API endpoints reference

| Method | Endpoint | Auth | Window |
|--------|----------|------|--------|
| `getAccountAssets` | `GET /api/v3/account` | signed | N/A |
| `getMyTrades` | `GET /api/v3/myTrades` | signed | 24h max |
| `getConvertHistory` | `GET /sapi/v1/convert/tradeFlow` | signed | 30 days max |
| `getWithdrawHistory` | `GET /sapi/v1/capital/withdraw/history` | signed | 90 days max |
| `getDepositHistory` | `GET /sapi/v1/capital/deposit/hisrec` | signed | 90 days max |

All requests require:
- Header: `X-MBX-APIKEY: <apiKey>`
- Query param: `signature=HMAC-SHA256(<secretKey>, queryString)` appended LAST
- Query param: `timestamp=<Date.now()>` included in the signed queryString
- Query param: `recvWindow=60000`

---

## §7 Architecture decision records

### ADR-1: tx_log_index = 0 for single-row CEX ops (not NULL)

**Decision**: All single-row CEX transactions (trades, withdrawals, deposits) use `tx_log_index = 0`. Only Converts use `(0, 1)`.

**Why not NULL**: The partial index `UNIQUE(cex_trade_id, tx_log_index) WHERE cex_trade_id IS NOT NULL` does NOT prevent duplicate rows when `tx_log_index IS NULL` because `NULL != NULL` in standard SQL — each `(orderId, NULL)` pair satisfies the uniqueness constraint independently. Using `NULL` here breaks idempotency entirely.

**Why 0 works**: `(orderId, 0)` is a concrete, unique value. Convert orders use `(orderId, 0)` + `(orderId, 1)`. No collision is possible with trade rows because Binance assigns distinct IDs for `myTrades` vs Convert orders.

**Deviation from PRD literal wording**: The PRD says "tx_log_index=NULL for trades" — this is the PRD intent (idempotency), not the correct implementation. `tx_log_index=0` achieves the intent with the existing index definition.

### ADR-2: Binance orderId in existing BIGINT column

**Decision**: Use existing `BIGINT` column. No migration.

**Rationale**: PostgreSQL `BIGINT` max is `9,223,372,036,854,775,807` (~9.2×10^18). Binance `orderId` for Converts is up to 18 decimal digits — within signed 64-bit range as of 2026.

**Mitigation for future overflow**: `persistBinanceTx` catches PostgreSQL error `22003` (numeric_value_out_of_range), logs a warning with stringified orderId, and returns `{ inserted: false }`. A migration to `NUMERIC(20,0)` can be added as a non-breaking follow-up if overflow is observed.

### ADR-3: Deposit idempotency via SELECT-before-INSERT

**Decision**: For deposit TRANSFER_IN rows (no `cex_trade_id`), use a SELECT-before-INSERT check keyed on `(tx_hash, wallet_id, type='TRANSFER_IN', source='BINANCE')` rather than relying on a DB unique index.

**Why**: The existing `UNIQUE(cex_trade_id, tx_log_index) WHERE cex_trade_id IS NOT NULL` index only fires when `cex_trade_id` is set. Deposits lack a `cex_trade_id`. A new migration to add a dedicated index is out of scope for V1.

**Risk**: Race condition under concurrent sync of the same wallet (two `POST /api/sync/:walletId` calls racing). Acceptable for V1 — only one `CEX_BINANCE` wallet per user, and the route has no concurrency protection regardless.

### ADR-4: Separate BinanceSyncResultSchema

**Decision**: Add `BinanceSyncResultSchema` alongside `SyncResultSchema` in `sync.ts`. No union on the route response.

**Why separate**: The two response shapes are semantically incompatible (`SyncResult` is flat; `BinanceSyncResult` is nested by operation). Merging them would require many optional fields, making the contract unclear. The route returns whichever shape matches the wallet type — TypeScript's return type union covers compile-time safety without runtime overhead.

### ADR-5: persistBinanceTx as a standalone private method

**Decision**: `BinanceSyncService` writes its own `persistBinanceTx` instead of reusing `persistOneTransaction` from `OnChainSyncService`.

**Why**: `persistOneTransaction` accepts a `DecomposedTransaction` typed with `source: Extract<TransactionSource, 'ETHERSCAN' | 'BSCTRACE'>`. Making it generic enough to accept CEX fields would require a significant type change that touches on-chain tests. The two persist methods share the same PositionEngine call — the difference is only in which DB columns are populated (tx_hash vs cex_trade_id, block_number vs cex_timestamp). Duplication is justified.

---

## §8 Test strategy

### Unit tests — engine project (no DB)

**File**: `apps/backend/src/sync/__tests__/binance-classify.test.ts`

| ID | Description | Key assertion |
|----|-------------|---------------|
| T-B01 | Convert decomposition — USDT→ETH orderId=123 | 2 rows returned; SWAP_OUT tx_log_index=0, SWAP_IN tx_log_index=1; relatedTxId cross-linked; USD value conserved (fromAmount×price = toAmount×price) |
| T-B02 | Withdrawal — coin=ETH, txId='0xabc', open position WAC=3000 | TRANSFER_OUT with tx_hash='0xabc', price_usd='3000.00000000', cost_source='INHERITED' |
| T-B03 | Deposit inheritance — mock pgc returns TRANSFER_OUT match for address+txId | resolveDepositCost returns { priceUsd: WAC, costSource: 'INHERITED' } |
| T-B04 | Deposit market fallback — mock pgc returns empty rows | resolveDepositCost calls getCexPrice, returns { priceUsd: currentPrice, costSource: 'MARKET' } |
| T-B05 | Trade price — ETHUSDT, qty='1', quoteQty='3000', isBuyer=true | BUY, price_usd='3000.00000000' (exact, no API call) |
| T-B06 | Trade price — ETHBTC (non-stable quote), quoteQty='0.05', BTC price=60000 | price_usd='3000.00000000' (0.05 × 60000) |
| T-B07 | Idempotency — persistBinanceTx called twice with same cexTradeId+txLogIndex | Second call returns { inserted: false }; DB has exactly 1 row |
| T-B08 | `assertConfigured` with empty keys | Throws ApiKeyMissingError('BINANCE_API_KEY') |
| T-B09 | HMAC signature does not leak secretKey | Spy on log.warn / log.error; assert secretKey string absent from all call args |

### Integration tests — sync project (real DB, mocked HTTP)

**File**: `apps/backend/tests/binance-sync.test.ts`

| ID | Description | Key assertion |
|----|-------------|---------------|
| T-B10 | syncConvert idempotency — BinanceApiClient mock returns same convert twice | DB has exactly 2 rows after 2 sync runs (SWAP_OUT + SWAP_IN, not 4) |
| T-B11 | syncWithdrawals bridge — mock returns withdrawal with txId='0xbridge' | transactions row has tx_hash='0xbridge', type='TRANSFER_OUT', source='BINANCE' |
| T-B12 | syncDeposits INHERITED — seed ON_CHAIN wallet with TRANSFER_OUT matching txId | Deposit row has cost_source='INHERITED', price_usd=seeded WAC |
| T-B13 | syncDeposits MARKET fallback — no matching on-chain TRANSFER_OUT | Deposit row has cost_source='MARKET', price_usd from getCexPrice mock |
| T-B14 | syncTrades full cycle — BUY then SELL same token | Position WAC correctly updated; final SELL reduces balance; realized_pnl_usd set |

### E2E tests — e2e project (Fastify + real DB + mocked HTTP)

**File**: `tests/e2e/api/binance-sync.test.ts`

| ID | Description | Key assertion |
|----|-------------|---------------|
| T-B15 | POST /api/sync/:cexWalletId — happy path | 200, body matches BinanceSyncResultSchema |
| T-B16 | POST /api/sync/:onChainWalletId — ON_CHAIN wallet dispatches to onChainService | Route does not call BinanceSyncService; onChainService.sync called once |
| T-B17 | BINANCE_API_KEY not set | 400, body.code='BINANCE_API_KEY_MISSING' (or ApiKeyMissingError code) |
| T-B18 | Binance returns -2015 | 400, body.code='BINANCE_INVALID_CREDENTIALS' |
| T-B19 | Binance returns HTTP 500 | 502, body.code='EXTERNAL_API_ERROR'; secretKey absent from body |
| T-B20 | POST /api/sync/:nonExistentId | 404, body.code='WALLET_NOT_FOUND' |

---

## §9 Dependency on existing code

| Dependency | Path | How used |
|------------|------|----------|
| `processTransaction` | `apps/backend/src/position-engine/index.ts` | Called inside `persistBinanceTx` — source-agnostic, works for BINANCE unchanged |
| `PriceService.getCexPrice` | `apps/backend/src/services/price.ts` | CEX token pricing; already implemented; 10s cache |
| `ApiKeyMissingError`, `ExternalApiError`, `ValidationError`, `NotFoundError` | `apps/backend/src/services/errors.ts` | Reused as-is in `BinanceApiClient` and `BinanceSyncService` |
| `TransactionType`, `TransactionSource` | `apps/backend/src/db/types.ts` | CEX values already present: BUY, SELL, SWAP_IN, SWAP_OUT, TRANSFER_IN, TRANSFER_OUT, source BINANCE |
| `wallet_sync_cursors` table | `db/migrations/0001_initial_schema.sql` | UNIQUE(wallet_id, operation) cursor store |
| `tokens.binance_symbol` column | `db/migrations/0002_tokens_extra_fields.sql` | Populated in `ensureTokenCex` |
| Partial index `transactions_unique_cex` | `db/migrations/0001_initial_schema.sql` | `UNIQUE(cex_trade_id, tx_log_index) WHERE cex_trade_id IS NOT NULL` — idempotency for trades + converts |
| `SyncParamsSchema` | `apps/backend/src/schemas/sync.ts` | Reused as-is for route param validation |

No new migrations required.
