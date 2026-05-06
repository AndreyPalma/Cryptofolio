# Proposal: US-008-A — On-chain Sync (Etherscan + BSCTrace)

**Story**: US-008-A — Sync on-chain: Etherscan (ETH) + BSCTrace (BSC) con paginacion y SWAP decomposition
**Date**: 2026-05-05
**Status**: draft
**Depends on**: US-001..US-007 (scaffold, auth, wallets, tokens, transactions, position-engine, price-service)
**Reads**: `openspec/changes/US-008-A-onchain-sync/explore.md`

---

## 1. Intent

Implement the first half of the on-chain sync pipeline: a single endpoint `POST /api/sync/:walletId` that, for an `ON_CHAIN` wallet, pulls all transactions from Etherscan (ETH) or BSCTrace (BSC) since the last synced block, classifies them (BUY / SELL / TRANSFER_IN / TRANSFER_OUT / SWAP), decomposes router swaps into two `SWAP_OUT` + `SWAP_IN` rows linked by `related_tx_id`, resolves WAC for `TRANSFER_IN` against existing on-chain wallets and Binance withdrawals, and persists everything idempotently while letting `PositionEngine` keep WAC and cycles consistent.

This proposal does NOT cover: Binance sync (US-008-B), historical price fetch, nor a UI for `cost_source='MANUAL'` resolution. Those are explicit non-goals for this change.

---

## 2. Architecture decision

### 2.1 Layering

```
routes/sync.ts                 (POST /api/sync/:walletId — Fastify plugin)
   |
   v
services/sync/on-chain-sync.ts (OnChainSyncService — orchestrator, owns the DB transaction)
   |  uses
   +--> services/sync/on-chain-client.ts        (OnChainApiClient interface + RawTx type)
   |       +--> services/sync/etherscan-client.ts  (REST adapter, chainid=1)
   |       +--> services/sync/bsctrace-client.ts   (JSON-RPC 2.0 adapter, nr_getAssetTransfers)
   |
   +--> services/sync/constants/routers.ts       (SWAP_ROUTERS readonly map)
   |
   +--> services/price.ts            (existing — DefiLlama, 60s cache)
   +--> position-engine/             (existing — processTransaction)
   +--> services/errors.ts           (existing — DomainError hierarchy, +ApiKeyMissingError, +ExternalApiError)
```

The orchestrator (`OnChainSyncService`) is the only object that touches the DB during sync. The two API clients are pure HTTP wrappers that return a normalized `RawTx[]`. All per-transaction WAC logic stays in `PositionEngine` — the sync service is responsible for ordering inserts and feeding the engine.

### 2.2 Dependency injection

Constructor signature:

```ts
new OnChainSyncService({
  pool: Pool,
  priceService: PriceService,
  etherscanClient: OnChainApiClient,   // injected per-wallet based on wallet.network
  bsctraceClient: OnChainApiClient,
})
```

Tests substitute fakes for `etherscanClient` / `bsctraceClient` (no network) and reuse the real `priceService` with `__resetCacheForTests()`.

### 2.3 Route plugin

`apps/backend/src/routes/sync.ts` follows the same pattern as `wallets.ts` / `transactions.ts`:

```ts
export const syncRoutes: FastifyPluginAsync = async (fastify) => {
  const pool = createPool();
  const priceService = createPriceService();
  const service = new OnChainSyncService({ pool, priceService, ...clients });

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/:walletId',
    { schema: { params: WalletIdParam, response: { 200: SyncResultSchema } } },
    async (req) => service.sync(req.params.walletId)
  );
};
```

Registered in `apps/backend/src/index.ts` with `prefix: '/api/sync'`. Auth is already handled by the global `authPlugin` `onRequest` hook on `/api/*`.

### 2.4 DB migration

`db/migrations/0003_wallet_last_synced_block.sql`:

```sql
ALTER TABLE wallets
  ADD COLUMN last_synced_block INTEGER NOT NULL DEFAULT 0;
```

`NOT NULL DEFAULT 0` keeps existing rows valid (start-of-chain) and lets the sync service pass `WHERE block_number > last_synced_block` without null-checks. The cursor is also mirrored into `wallet_sync_cursors(operation='block')` for parity with the Binance adapter (US-008-B), but `wallets.last_synced_block` is the authoritative read for the next sync window because AC-8 names it explicitly.

---

## 3. Key design decisions

### 3.1 SWAP detection — single-pass correlation by `tx_hash`

**Decision**: After fetching `txlist` and `tokentx` for the block window, group raw rows by `tx_hash`. For each group:

1. If any row in the group has `to.toLowerCase()` in `SWAP_ROUTERS[network]`, it is a swap.
2. Within the group, identify:
   - **Outbound leg**: row with `from.toLowerCase() === walletAddress.toLowerCase()` going to a router OR going to a token address that routes through one (token->token case, see R-2).
   - **Inbound leg**: row with `to.toLowerCase() === walletAddress.toLowerCase()` coming from a router.
3. Generate two UUIDs upfront. Build:
   - `SWAP_OUT`: `id=uuidA`, `tx_log_index=0`, `related_tx_id=uuidB`
   - `SWAP_IN` : `id=uuidB`, `tx_log_index=1`, `related_tx_id=uuidA`
4. Insert both in a single SQL transaction with `ON CONFLICT (tx_hash, tx_log_index) DO NOTHING`. If the conflict fires on the OUT leg, the IN leg's `ON CONFLICT` will also fire — idempotency is preserved (we never have a half-decomposed swap).

Token->token swaps (R-2): when neither leg appears in `txlist`, both legs come from `tokentx`. The same grouping by `tx_hash` works because `tokentx` rows include the wallet on either `from` or `to`. The router address shows up as the counterparty on at least one of the two `tokentx` rows for the same hash.

### 3.2 `resolveTransferCost` lives on the service, not the engine

**Decision**: `PositionEngine` is DB-free by contract (it accepts position+transaction and returns the new state). `resolveTransferCost(pool, txHash, fromAddress, tokenId)` runs three SQL lookups, so it MUST live on `OnChainSyncService`. The engine receives the resolved `priceUsd` + `cost_source` as inputs to `processTransaction`.

This also keeps the engine project (vitest `engine`) DB-free and the resolver in the `sync` project.

### 3.3 WAC update after sync — call PositionEngine per row, in chronological order

**Decision**: After classifying and decomposing, sort the resulting `ClassifiedTx[]` by `(blockNumber, transactionIndex, tx_log_index)` ascending. For each row, inside a single `BEGIN ... COMMIT`:

1. `ensureToken(network, contractAddress, symbol, decimals)` -> `token_id`
2. Load current OPEN position for `(wallet_id, token_id)` via `positionRepo.findOpen()`
3. Count closed cycles via `positionRepo.countClosed()`
4. Call `PositionEngine.processTransaction({ position, priorClosedCycles, transaction, positionIdentity })`
5. UPSERT position; INSERT transaction with `ON CONFLICT (tx_hash, tx_log_index) DO NOTHING`
6. If the insert reports `rowCount === 0`, increment `skipped`, otherwise `synced`

This mirrors `TransactionService.createTransaction()`'s ordering contract verbatim, which is the only safe way to keep WAC and cycles consistent. The whole loop runs in one DB transaction so a partial sync rolls back cleanly.

### 3.4 Error handling boundaries

| Failure | HTTP | Error class | Notes |
|---|---|---|---|
| Wallet not found | 404 | `NotFoundError` | reuse existing |
| `wallet_type === 'CEX'` | 400 | `ValidationError` | AC-1 |
| `ETHERSCAN_API_KEY` missing for ETH wallet | 400 | `ApiKeyMissingError extends DomainError` (new) | AC-13 — fail fast before HTTP call |
| `BSCTRACE_API_KEY` missing for BSC wallet | 400 | `ApiKeyMissingError` | AC-14 |
| Etherscan/BSCTrace 5xx, timeout, malformed JSON | 502 | `ExternalApiError extends DomainError` (new) | upstream is the actual cause |
| DefiLlama price failure | 200 | none — `{ priceUnavailable: true }` | per existing PriceService contract |
| Postgres failure | 500 | bubble up | Fastify default handler |

`ApiKeyMissingError(serviceName)` carries `statusCode=400`, `code='API_KEY_MISSING'`, `message` includes which env var is missing (without dumping it). `ExternalApiError(serviceName, cause)` carries `statusCode=502`, `code='EXTERNAL_API_ERROR'` and never logs the API key.

### 3.5 Migration strategy

**Decision**: `last_synced_block INTEGER NOT NULL DEFAULT 0`. Reasons:

- Keeps existing wallets queryable without a `COALESCE`.
- Block 0 means "start from the beginning" — the EVM genesis is block 0, so `WHERE block_number > 0` correctly returns everything from block 1 up.
- Avoids nullable arithmetic in pagination.

The migration is forward-only and additive — no rollback risk for the V1 cohort (single user).

### 3.6 Pagination skipped-count accounting (R-3)

When `result.length === 1000`, we re-query with `startblock = lastBlockInBatch - 1`. Rows from the boundary block re-appear and hit `ON CONFLICT DO NOTHING`. The `synced` counter increments only when `rowCount === 1`; the `skipped` counter increments on `rowCount === 0`. Since the first batch hasn't hit the DB yet on iteration 2, this is correct — the boundary rows are seen as "skipped" only if they were inserted in iteration 1 of the same `sync()` call. We therefore commit each batch's inserts before fetching the next batch — this keeps the conflict detection meaningful AND limits transaction size on very large wallets.

**Trade-off**: per-batch commits mean a mid-sync failure leaves partial state. Acceptable because `ON CONFLICT DO NOTHING` makes re-running safe, and `last_synced_block` is updated only at the very end of the whole sync (single user, no concurrent syncs in V1 — R-8 accepted).

---

## 4. Files to create / modify

### 4.1 New files

| Path | Purpose |
|---|---|
| `db/migrations/0003_wallet_last_synced_block.sql` | Add `wallets.last_synced_block INTEGER NOT NULL DEFAULT 0` |
| `apps/backend/src/services/sync/on-chain-client.ts` | `OnChainApiClient` interface + `RawTx` type (normalized shape from §3.2 of explore.md) |
| `apps/backend/src/services/sync/etherscan-client.ts` | `EtherscanClient` — REST `chainid=1`, `module=account`, `action=txlist`/`tokentx`, sort=asc, batch 1000 |
| `apps/backend/src/services/sync/bsctrace-client.ts` | `BSCTraceClient` — JSON-RPC 2.0 `nr_getAssetTransfers`, normalizes to `RawTx` |
| `apps/backend/src/services/sync/constants/routers.ts` | `SWAP_ROUTERS = { ETH: [...], BSC: [...] } as const` (Uniswap v2/v3, PancakeSwap v2/v3) |
| `apps/backend/src/services/sync/on-chain-sync.ts` | `OnChainSyncService` class: `sync()`, `fetchAllTransactions()`, `classifyAndDecomposeTransaction()`, `resolveTransferCost()`, `ensureToken()` |
| `apps/backend/src/services/sync/__tests__/pagination.test.ts` | engine project — AC-10 |
| `apps/backend/src/services/sync/__tests__/classify-decompose.test.ts` | engine project — AC-11 plus router detection |
| `apps/backend/src/services/sync/__tests__/bsctrace-normalize.test.ts` | engine project — AC-11 BSCTrace mock matches Etherscan shape |
| `apps/backend/tests/sync-transfer-cost.test.ts` | sync project — AC-12 (CEX inheritance), needs DB |
| `apps/backend/tests/e2e-sync.test.ts` | e2e project — AC-1, AC-2, AC-3, AC-9 happy path + 400/404 negatives |
| `apps/backend/src/routes/sync.ts` | Fastify plugin `syncRoutes` exposing `POST /:walletId` |

### 4.2 Modified files

| Path | Change |
|---|---|
| `apps/backend/src/index.ts` | Register `syncRoutes` with `prefix: '/api/sync'` |
| `apps/backend/src/services/errors.ts` | Add `ApiKeyMissingError` (400) and `ExternalApiError` (502) extending `DomainError` |
| `apps/backend/src/db/types.ts` | No change expected — `TransactionSource` already includes `'ETHERSCAN'` and `'BSCTRACE'`. Verify and document if missing |

### 4.3 Not modified

`PriceService`, `PositionEngine`, `TransactionService`, `WalletService` — left untouched. The sync service has its own insert path because `TransactionService.createTransaction()` hardcodes `source='MANUAL'`.

---

## 5. Test strategy

| Project | File | What it asserts |
|---|---|---|
| `engine` | `pagination.test.ts` | `fetchAllTransactions` with mocked `OnChainApiClient` returns 1050 rows when first page returns 1000 and second page returns 50 (single re-query). The boundary block is included exactly once after dedupe. |
| `engine` | `classify-decompose.test.ts` | Pure function: given a fixture of 3 raw txs (1 BUY, 1 router-SWAP with native+ERC20 legs, 1 TRANSFER_IN), produces 4 `ClassifiedTx` rows with correct `tx_log_index` and `related_tx_id` cross-links (UUIDs pre-generated). Token->token swap fixture covered as a separate case. |
| `engine` | `bsctrace-normalize.test.ts` | A fixed `nr_getAssetTransfers` JSON-RPC response and a fixed `BscScan txlist` REST response both normalize to identical `RawTx[]` (modulo address checksum case). |
| `sync` | `sync-transfer-cost.test.ts` | `resolveTransferCost` with seeded DB: (a) on-chain wallet with OPEN position -> INHERITED; (b) Binance `TRANSFER_OUT` row matching `tx_hash` -> INHERITED; (c) neither -> MANUAL with `priceUsd=null`. Closed positions correctly fall through to step 2. |
| `e2e` | `e2e-sync.test.ts` | `POST /api/sync/:walletId`: 200 with mocked HTTP clients for happy path; 400 when wallet is CEX; 400 when API key env var is unset; 404 when wallet doesn't exist; verifies `wallets.last_synced_block` is updated and `transactions` row count matches `synced + skipped + 2*swapsDecomposed - skipped`. |

The `engine` tests run on every commit (pure, fast). The `sync` and `e2e` projects run against the dockerized Postgres in CI.

---

## 6. Response shape (AC-9)

```ts
const SyncResultSchema = z.object({
  synced: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  swapsDecomposed: z.number().int().nonnegative(),
  transfersPendingCost: z.number().int().nonnegative(),
  transfersInheritedFromCEX: z.number().int().nonnegative(),
  newTransactions: z.array(TransactionSchema).max(10),
});
type SyncResult = z.infer<typeof SyncResultSchema>;
```

`newTransactions` is the last 10 inserts of the current call (not historical), ordered by `block_timestamp DESC`.

---

## 7. Risks (carried from explore + new)

| Id | Severity | Description | Mitigation |
|---|---|---|---|
| R-1 | HIGH | `wallets.last_synced_block` does not exist | Migration `0003` (this proposal) |
| R-2 | MED | Token->token swaps don't appear in `txlist` | Detect by router presence in `tokentx` group, not just `txlist` (§3.1) |
| R-3 | MED | Re-pagination duplicates boundary block | Per-batch commit + `ON CONFLICT DO NOTHING`; counters track `rowCount` (§3.6) |
| R-4 | MED | DefiLlama returns current price only | Accepted in V1; `cost_source='MARKET'` flags it. Future: historical endpoint |
| R-5 | LOW | BSCTrace pagination params unverified | `bsctrace-normalize.test.ts` uses mock; integration call deferred to e2e with stub. Real call validated post-merge against MegaNode docs |
| R-6 | LOW | EIP-55 address case sensitivity | `.toLowerCase()` everywhere for comparisons; store EIP-55 for display |
| R-7 | LOW | TRANSFER_IN from same user's CLOSED wallet | `resolveTransferCost` step 1 requires OPEN position; falls through to step 2 |
| R-8 | LOW | Concurrent sync of the same wallet | V1 single-user; idempotent inserts make double-running safe; cursor lock deferred |

---

## 8. Acceptance criteria coverage map

| AC | Where it's satisfied |
|---|---|
| 1 — POST /api/sync/:walletId, 400 if CEX | `routes/sync.ts` + service guard |
| 2 — Etherscan v2 chainid=1 txlist+tokentx | `EtherscanClient` |
| 3 — BSCTrace nr_getAssetTransfers JSON-RPC | `BSCTraceClient` |
| 4 — Pagination 1000+ with re-query | `OnChainSyncService.fetchAllTransactions` |
| 5 — Router detection + SWAP decomposition | `classifyAndDecomposeTransaction` + `routers.ts` |
| 6 — 3-step `resolveTransferCost` | `OnChainSyncService.resolveTransferCost` |
| 7 — Idempotent insert ON CONFLICT | `INSERT ... ON CONFLICT (tx_hash, tx_log_index) DO NOTHING` |
| 8 — Updates `wallet.last_synced_block` | Migration 0003 + final UPDATE in `sync()` |
| 9 — Response shape | `SyncResultSchema` |
| 10 — Unit test 1000+50 pagination | `pagination.test.ts` (engine) |
| 11 — BSCTrace mock = BscScan shape | `bsctrace-normalize.test.ts` (engine) |
| 12 — CEX inheritance test | `sync-transfer-cost.test.ts` (sync) |
| 13 — 400 if ETHERSCAN_API_KEY missing | `routes/sync.ts` env guard + `ApiKeyMissingError` |
| 14 — 400 if BSCTRACE_API_KEY missing | `routes/sync.ts` env guard + `ApiKeyMissingError` |

---

## 9. Out of scope (explicit non-goals)

- Binance sync (trades, converts, withdrawals, deposits) — owned by US-008-B
- Historical price lookup (DefiLlama `/coins/prices/historical/`) — V2
- UI for `cost_source='MANUAL'` resolution (price input form) — separate story
- Concurrent-sync locking via `SELECT ... FOR UPDATE` — V2
- Dust reconciliation against `/sapi/v1/accountSnapshot` — explicit non-goal in V1 (per CLAUDE.md)
- Configurable router addresses via DB — accepted code-update + redeploy for V1

---

## 10. Next phase

`sdd-spec` should produce the delta spec capturing each AC as a Gherkin scenario, plus the error matrix from §3.4 as NEGATIVE scenarios.
