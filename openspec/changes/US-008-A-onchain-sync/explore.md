# Exploration: US-008-A — On-chain Sync (ETH + BSC)

**Date**: 2026-05-05  
**Story**: US-008-A — Sync on-chain: Etherscan (ETH) + BSCTrace (BSC) con paginación y SWAP decomposition  
**Status**: draft

---

## 1. What already exists and can be reused

### 1.1 PriceService (`apps/backend/src/services/price.ts`)

Fully usable as-is. Key interface:

```ts
priceService.getOnChainPrice(network: 'ETH' | 'BSC', address: string): Promise<PriceResult>
priceService.getOnChainPricesBulk(requests): Promise<Map<string, PriceResult>>
```

- Uses DefiLlama `/coins/prices/current/{chain}:{address}`, cache TTL 60s.
- Returns `{ priceUnavailable: true }` on failure — never throws. This is exactly what SWAP decomposition needs when fetching prices for SWAP_OUT and SWAP_IN tokens.
- `__resetCacheForTests()` hook already present — sync tests can use it.
- The cache key format is `onchain:eth:0x...` (lowercase) — the sync service must use this same convention when looking up prices post-fetch.

### 1.2 PositionEngine (`apps/backend/src/position-engine/`)

`processTransaction()` handles all WAC/cycle logic. The sync service must call it for every transaction it inserts, in the same order established by `TransactionService.createTransaction()`:

1. Load OPEN position for (wallet_id, token_id)
2. Count closed cycles
3. Call `processTransaction({ position, priorClosedCycles, transaction, positionIdentity })`
4. UPSERT position, INSERT transaction (FK order: position first)

The engine already handles:
- New cycle opening (position=null → opens cycle_number=closedCycles+1)
- WAC recalculation for BUY, SWAP_IN, TRANSFER_IN
- Balance reduction without WAC change for SELL, SWAP_OUT, TRANSFER_OUT
- Position closing when balance reaches zero

**Key difference from manual flow**: the sync service must set `source='ETHERSCAN'` or `source='BSCTRACE'` (not `'MANUAL'`), and must populate `tx_hash`, `tx_log_index`, `from_address`, `to_address`.

### 1.3 TransactionService (`apps/backend/src/services/transaction.ts`)

The existing `createTransaction()` is manual-only (hardcodes `source='MANUAL'`, `tx_hash=NULL`). The sync service CANNOT reuse this function directly — it needs its own insert path that:
- Sets `source='ETHERSCAN'|'BSCTRACE'`
- Inserts `tx_hash`, `tx_log_index`, `from_address`, `to_address`
- Uses `ON CONFLICT (tx_hash, tx_log_index) DO NOTHING` for idempotency
- Links SWAP pairs via `related_tx_id`

The logic for loading positions and calling the engine CAN be extracted/shared — but the SQL is different enough to warrant a dedicated `OnChainSyncService.insertTransaction()` method.

### 1.4 DB schema (`db/migrations/0001_initial_schema.sql`)

Everything needed is already in place:
- `wallet_sync_cursors` table with `UNIQUE(wallet_id, operation)` — for block cursor per wallet
- `transactions_unique_onchain` partial index: `UNIQUE(tx_hash, tx_log_index) WHERE tx_hash IS NOT NULL AND source IN ('ETHERSCAN','BSCTRACE')` — idempotent inserts just need `ON CONFLICT ... DO NOTHING`
- `transactions.related_tx_id UUID REFERENCES transactions(id)` — for SWAP pair linking
- `transactions.from_address TEXT NULL` and `to_address TEXT NULL` — already present
- `wallets.last_synced_at TIMESTAMPTZ NULL` — already present (but AC-8 requires updating `last_synced_block`, which does NOT exist as a column — see Risk R-1 below)
- `NETWORKS` enum already has `ETH` and `BSC`

### 1.5 Env vars (`apps/backend/src/env.ts`, `.env.example`)

`ETHERSCAN_API_KEY` and `BSCTRACE_API_KEY` are already declared in both `EnvSchema` and `.env.example`. The NEGATIVE acceptance criteria (AC-13, AC-14) require returning 400 when these are missing — the route handler must check `process.env.ETHERSCAN_API_KEY` or read from the parsed env object before initiating sync.

### 1.6 Error system (`apps/backend/src/services/errors.ts`)

`ValidationError`, `ConflictError`, `NotFoundError` — all extend `DomainError` with `statusCode`. The route plugin reads `error.statusCode` automatically via `setErrorHandler`. New sync-specific errors (e.g., `ApiKeyMissingError`) should extend the same `DomainError` base.

### 1.7 Route plugin pattern (`apps/backend/src/routes/wallets.ts`, `transactions.ts`)

Pattern: `export const syncRoutes: FastifyPluginAsync = async (fastify) => { ... }` registered in `index.ts` with `prefix: '/api/sync'`. Pool is instantiated inside the plugin. No `preHandler` needed — `authPlugin` already adds `onRequest` hook for all `/api/*` routes.

### 1.8 Vitest workspace (`vitest.workspace.ts`)

Sync tests go in:
- `apps/backend/src/**/sync/*.{test,spec}.ts` — picked up by vitest project `sync`
- OR `apps/backend/tests/sync-*.{test,spec}.ts`

Unit tests (pure, no DB) for the pagination logic and classification logic should go in the `engine` project: `apps/backend/src/**/*.{test,spec}.ts` (excluding sync/ subdirectory per the exclude rule).

---

## 2. What needs to be built from scratch

### 2.1 `EtherscanClient` — Etherscan API v2 adapter

Wraps two endpoints per the AC:
- `txlist` — native ETH transfers (for ETH sends/receives)
- `tokentx` — ERC-20 token transfers

Parameters: `chainid=1`, `address`, `startblock`, `endblock=99999999`, `sort=asc`, `apikey`.

Interface:
```ts
interface OnChainTx { /* see §3.2 */ }
interface EtherscanClient {
  getTxList(address: string, startBlock: number): Promise<OnChainTx[]>
  getTokenTx(address: string, startBlock: number): Promise<OnChainTx[]>
}
```

### 2.2 `BSCTraceClient` — MegaNode JSON-RPC adapter

Uses `nr_getAssetTransfers` — a JSON-RPC 2.0 call (POST), not a REST GET like Etherscan. This is architecturally different:
- Request: `{ jsonrpc: '2.0', method: 'nr_getAssetTransfers', params: [...], id: 1 }`
- Pagination is by block range, same 1000-result batch strategy as Etherscan

The AC requires a unit test that the BSCTrace mock produces the same result as equivalent BscScan `txlist` — meaning the `OnChainSyncService` must normalize both adapters into the same `OnChainTx` shape before processing.

### 2.3 `OnChainSyncService` — core service

Three main methods:

**`fetchAllTransactions(walletId, network, address)`**  
Pagination loop:
```
startBlock = last cursor block (or 0)
do:
  batch = await client.getTxList(address, startBlock) // + getTokenTx
  process batch
  if batch.length === 1000: startBlock = lastBlockInBatch - 1, continue
  else: break
```
Returns raw `OnChainTx[]` (merged txlist + tokentx, deduped by tx_hash).

**`classifyAndDecomposeTransaction(rawTxs, walletAddress, network)`**  
Returns `ClassifiedTx[]` where each entry is ready for DB insertion. For swap transactions:
- Detects router address in `to_address` (see §3.3 for router list)
- Produces two `ClassifiedTx` entries: `SWAP_OUT(tx_log_index=0)` + `SWAP_IN(tx_log_index=1)`
- Both share the same `tx_hash`; `related_tx_id` links them (resolved after first insert)
- Prices fetched from DefiLlama for both legs via `priceService.getOnChainPricesBulk()`

**`resolveTransferCost(pool, txHash, fromAddress, tokenId)`**  
Three-step resolution (per AC-6 and domain invariant):
1. Query: `FROM wallets WHERE address = $fromAddress AND wallet_type = 'ON_CHAIN'` → check open position for that wallet+token → if found, inherit WAC, `cost_source='INHERITED'`
2. Query: `FROM transactions WHERE source='BINANCE' AND tx_hash=$txHash AND type='TRANSFER_OUT'` → if found, get position for that row → inherit WAC, `cost_source='INHERITED'`
3. Else: return `{ priceUsd: null, costSource: 'MANUAL' }`

### 2.4 `POST /api/sync/:walletId` route

```
GET wallet by id → 404 if not found
Check wallet_type === 'ON_CHAIN' → 400 if CEX
Check ETHERSCAN_API_KEY (if ETH) → 400 if missing
Check BSCTRACE_API_KEY (if BSC) → 400 if missing
call OnChainSyncService.sync(walletId, wallet.address, wallet.network)
return { synced, skipped, swapsDecomposed, transfersPendingCost, transfersInheritedFromCEX, newTransactions: [...last 10] }
```

### 2.5 Migration for `last_synced_block`

The wallets table has `last_synced_at TIMESTAMPTZ` but **not** `last_synced_block INTEGER`. AC-8 says "Updates wallet.last_synced_block to highest block processed." A new migration is needed:

```sql
ALTER TABLE wallets ADD COLUMN last_synced_block INTEGER NULL;
```

The cursor (block number) can also be stored in `wallet_sync_cursors` with `operation='block'` and `last_value=<block_number>::text`. Using the cursors table is cleaner and avoids a migration — but the AC explicitly names `wallet.last_synced_block`, so the migration is required.

---

## 3. Key design questions and recommended answers

### 3.1 Etherscan vs BSCTrace adapters — shared interface vs separate

**Recommended**: define a shared `OnChainApiClient` interface, with two implementations: `EtherscanClient` and `BSCTraceClient`. `OnChainSyncService` receives the client as a constructor parameter (dependency injection). This is what makes the unit tests possible (mock the client, not the network).

```ts
interface OnChainApiClient {
  getTxList(address: string, startBlock: number): Promise<RawTx[]>
  getTokenTx(address: string, startBlock: number): Promise<RawTx[]>
}
```

BSCTraceClient maps `nr_getAssetTransfers` output to the same `RawTx` shape. The AC unit test (AC-11) specifically validates this normalization: "mock of `nr_getAssetTransfers` produces same result as equivalent BscScan txlist."

### 3.2 RawTx shape (normalized from both APIs)

```ts
interface RawTx {
  hash: string           // tx_hash
  blockNumber: number
  timeStamp: number      // unix epoch
  from: string
  to: string
  value: string          // in wei (ETH native) or token units (ERC-20)
  contractAddress: string | null   // null for native ETH
  tokenSymbol: string | null
  tokenDecimal: number | null
  isError?: string       // Etherscan returns "0"/"1"
}
```

Failed transactions (`isError='1'`) must be filtered out before classification.

### 3.3 SWAP router detection — hardcoded list vs configurable

**Recommended**: hardcoded `as const` array in a constants file. Known routers:

```ts
// ETH Uniswap v2/v3
const UNISWAP_V2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'
const UNISWAP_V3_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564'
const UNISWAP_V3_ROUTER_02 = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'

// BSC PancakeSwap v2/v3
const PANCAKESWAP_V2_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E'
const PANCAKESWAP_V3_ROUTER = '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4'
```

Detection logic: if a tx's `to` address (lowercased) is in this set, it is a swap. NOT configurable in DB — router addresses are stable blockchain constants.

Tradeoff: If a new router is deployed, it requires a code update + redeploy. Acceptable for V1. Configurable DB approach would require a new table and adds complexity.

### 3.4 Two-pass nature of SWAP decomposition

This is the trickiest part. Etherscan provides two types of data:
- `txlist` — shows native ETH transfers (value field)
- `tokentx` — shows ERC-20 transfers

A swap of ETH→USDC on Uniswap generates:
- In `txlist`: 1 row with `to=routerAddress`, `value=<eth_amount>` (the ETH sent)
- In `tokentx`: 1 row with `from=routerAddress`, `to=walletAddress`, value=<usdc_amount> (the token received)

Both have the same `tx_hash`.

**Recommended approach: single-pass correlation by tx_hash**

After fetching both `txlist` and `tokentx` for all blocks:
1. Group all raw transactions by `tx_hash`
2. For each tx_hash group:
   - If `to` address is a known router → it's a swap candidate
   - Collect all ERC-20 transfers in the same tx (from tokentx)
   - Identify the outbound leg: token/ETH sent from wallet to router
   - Identify the inbound leg: token received by wallet from router
   - Produce SWAP_OUT + SWAP_IN with matching `tx_log_index` 0 and 1

For BSCTrace (`nr_getAssetTransfers`), the response includes both native and ERC-20 in a single call, indexed by `assetTransferIndex` — the tx_hash grouping works the same way.

**Insert order for related_tx_id**: insert SWAP_OUT first (get its UUID), then insert SWAP_IN with `related_tx_id = swap_out.id`. Then update SWAP_OUT's `related_tx_id = swap_in.id`. This requires a two-step insert within a transaction.

Alternative: generate both UUIDs upfront in the service (before DB), then insert both rows in one transaction with cross-references pre-set. This is cleaner — no update step needed.

**Recommended**: generate UUIDs upfront. Insert both rows in a single DB transaction. Use `ON CONFLICT DO NOTHING` — if the first already exists, the second will also already exist (idempotent).

### 3.5 Where does `classifyAndDecomposeTransaction` fit?

It's a pure function of (rawTxs, walletAddress, knownRouters) → ClassifiedTx[]. No DB access needed. Place it as a standalone exported function in `OnChainSyncService` module so it can be unit tested with mock data (vitest `engine` project — no DB required).

`resolveTransferCost` does need DB access → belongs on the service class/object (receives `pool`).

### 3.6 Token auto-registration

When a new token is encountered in a synced transaction, the sync service must `INSERT INTO tokens ... ON CONFLICT DO NOTHING`. The token metadata (symbol, decimals, contractAddress) comes from the `tokentx` response. This is a new responsibility not in any existing service — add it to `OnChainSyncService` as a private helper `ensureToken(pool, network, contractAddress, symbol, decimals)`.

---

## 4. Risks and edge cases

**R-1 (HIGH): `last_synced_block` column doesn't exist**  
The `wallets` table has `last_synced_at` but not `last_synced_block`. AC-8 explicitly requires updating this field. A migration `0003_wallet_last_synced_block.sql` is needed before implementation. The cursor can also be mirrored in `wallet_sync_cursors(operation='block')` for recovery, but the column is required by the AC.

**R-2 (MEDIUM): SWAP detection gap for token→token swaps**  
When swapping USDC→DAI, neither leg appears in `txlist` (no native ETH). Both legs appear in `tokentx`, with `from=routerAddress` for one and `to=routerAddress` for the other. Detection must handle this case: look for any transfer `from=walletAddress` to a router address in `tokentx`, not just `txlist` native ETH.

**R-3 (MEDIUM): Re-entrant pagination and duplicate blocks**  
When `result.length === 1000`, re-query with `startblock = last_block - 1`. This means the last block of the previous batch is re-fetched. The `ON CONFLICT DO NOTHING` idempotency guarantee handles duplicates cleanly, but the counter (`synced` vs `skipped`) must distinguish new vs already-known rows correctly. Track skipped count from `ON CONFLICT` results (check `rowCount` after each insert).

**R-4 (MEDIUM): Price fetch timing for historical swaps**  
DefiLlama's `/coins/prices/current/` returns the CURRENT price, not historical. For historical SWAP transactions, the price will be wrong. This is accepted in V1 — `cost_source='MARKET'` flags that it's current-price-as-proxy. Future work: use DefiLlama's `/coins/prices/historical/` endpoint.

**R-5 (LOW): BSCTrace `nr_getAssetTransfers` pagination boundary**  
The Etherscan pagination is by `startblock/endblock` with `sort=asc` and a 1000-row batch. BSCTrace's `nr_getAssetTransfers` may use different pagination parameters. Must verify the exact API spec (blockRange, cursor vs block offset) — the unit test (AC-11) should confirm the behavior with a mock before hitting the real API.

**R-6 (LOW): EIP-55 checksum normalization**  
Etherscan returns addresses in mixed case; BSCTrace may vary. All addresses must be lowercased before comparison (router detection, wallet address matching). The existing `WalletService` uses `viem.getAddress()` for EIP-55 — the sync service should use `address.toLowerCase()` consistently for comparisons, and store EIP-55 checksum for display. The DB partial index uses `lower(contract_address)` — consistent.

**R-7 (LOW): TRANSFER_IN from same user's other wallet**  
`resolveTransferCost` step 1 checks if `fromAddress` is a registered ON_CHAIN wallet. If the user has two wallets and transfers between them, the WAC is inherited. This is correct per the domain invariant. Edge case: the source wallet must have an OPEN position — if it's CLOSED (balance=0), fallback to step 2 then step 3.

**R-8 (LOW): Sync during ongoing pagination**  
If a second sync request comes in while the first is still paginating (e.g., large wallet), both will conflict on `wallet_sync_cursors` update. For V1, accept this — the idempotent inserts mean double-running is safe; just the cursor may be incorrect. A real lock would require `SELECT ... FOR UPDATE` on `wallet_sync_cursors`.

---

## 5. Files to create / modify

### New files

```
apps/backend/src/services/sync/
  on-chain-client.ts          # OnChainApiClient interface + RawTx type
  etherscan-client.ts         # EtherscanClient implements OnChainApiClient
  bsctrace-client.ts          # BSCTraceClient implements OnChainApiClient
  on-chain-sync.ts            # OnChainSyncService (fetchAll, classify, resolveTransfer, sync)
  router-addresses.ts         # SWAP_ROUTERS constant map { ETH: string[], BSC: string[] }
  __tests__/
    pagination.test.ts        # Unit: AC-10 pagination mock (1000+50=1050)
    bsctrace-normalize.test.ts # Unit: AC-11 BSCTrace mock produces same shape
    transfer-cost.test.ts     # Unit+DB: AC-12 CEX inheritance (sync project)

apps/backend/src/routes/sync.ts  # POST /api/sync/:walletId route plugin

db/migrations/
  0003_wallet_last_synced_block.sql  # ALTER TABLE wallets ADD COLUMN last_synced_block INTEGER NULL
```

### Modified files

```
apps/backend/src/index.ts    # Register syncRoutes at prefix '/api/sync'
apps/backend/src/db/types.ts # No change needed — TransactionSource already has ETHERSCAN, BSCTRACE
```

### Vitest project assignment

| Test file | vitest project |
|-----------|----------------|
| `pagination.test.ts` | `engine` (pure unit, no DB) |
| `bsctrace-normalize.test.ts` | `engine` (pure unit, no DB) |
| `transfer-cost.test.ts` | `sync` (needs DB) |

---

## 6. Token auto-registration detail

The sync service encounters tokens that may not exist in the `tokens` table yet. Required behavior:
1. Try to find token by `(network, lower(contract_address))`
2. If not found: INSERT with symbol/decimals from the API response
3. Return token_id for use in the transaction insert

This is an `ensureToken` helper — not exposed to the route layer. It must be called within the same DB transaction as the position upsert + transaction insert to avoid partial state.

---

## 7. sync() method response shape

```ts
interface SyncResult {
  synced: number              // new transactions inserted
  skipped: number             // ON CONFLICT DO NOTHING (already known)
  swapsDecomposed: number     // SWAP pairs created (each pair = 1 swap)
  transfersPendingCost: number // TRANSFER_IN with cost_source='MANUAL' (needs user input)
  transfersInheritedFromCEX: number // TRANSFER_IN with cost_source='INHERITED' via Binance bridge
  newTransactions: Transaction[]    // last 10 inserted (ordered by block_timestamp DESC)
}
```

The `skipped` count requires checking `INSERT ... ON CONFLICT DO NOTHING` result: `result.rowCount === 0` means skipped.

---

## 8. Summary of dependency graph

```
PriceService (exists)
PositionEngine (exists)
TokenService.ensureToken (new helper, internal)
  └── OnChainApiClient (new interface)
        ├── EtherscanClient (new)
        └── BSCTraceClient (new)
              └── OnChainSyncService (new)
                    └── POST /api/sync/:walletId (new route)
```
