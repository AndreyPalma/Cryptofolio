# Tasks — US-008-A · On-chain Sync (Etherscan + BSCTrace)

**Change:** `US-008-A-onchain-sync`
**Status:** done
**Created:** 2026-05-05
**Mode:** Strict TDD (every implementation task preceded by a failing test)

---

## Legend

- `[ ]` — pending
- `[x]` — done
- `(after TXX)` — dependency on task number
- Project labels: `engine` = pure unit, no DB | `sync` = integration, needs DB | `e2e` = full stack + real DB + HTTP mocks

---

## Phase 0 — Setup & Migration

- [x] **T01** — Create `db/migrations/0003_wallet_last_synced_block.sql`
  - `ALTER TABLE wallets ADD COLUMN last_synced_block INTEGER NOT NULL DEFAULT 0;`
  - Include `COMMENT ON COLUMN` and a `-- Down Migration` section
  - See design §5 for exact SQL

- [x] **T02** — Run migration against Supabase (manual step)
  - Command: `psql $DATABASE_URL -f db/migrations/0003_wallet_last_synced_block.sql`
  - Or via Supabase CLI: `supabase db push`
  - Verify with: `\d wallets` → confirm `last_synced_block integer NOT NULL DEFAULT 0`

- [x] **T03** — Verify `.env.example` already has `ETHERSCAN_API_KEY` and `BSCTRACE_API_KEY`
  - Both are present in current `.env.example` — no change needed; document as verified

---

## Phase 1 — Error Classes

- [x] **T04** — Add `ApiKeyMissingError` and `ExternalApiError` to `apps/backend/src/services/errors.ts`
  - `ApiKeyMissingError`: statusCode 400, code `'API_KEY_MISSING'`, message `"API key not configured for service '${serviceName}'"`
  - `ExternalApiError`: statusCode 502, code `'EXTERNAL_API_ERROR'`, MUST NOT expose API key in cause
  - Both MUST call `Object.setPrototypeOf(this, new.target.prototype)` for instanceof correctness
  - See design §4 for exact signatures

---

## Phase 2 — Types & Schemas

- [x] **T05** — Create `apps/backend/src/sync/clients/on-chain-api.ts` (after T04)
  - Export `NormalizedTx` type (txHash, blockNumber, transactionIndex, timeStamp, from, to, value, isError, gasUsed, methodId?)
  - Export `NormalizedTokenTx` type (txHash, blockNumber, transactionIndex, logIndex, timeStamp, from, to, contractAddress, tokenSymbol, tokenName, tokenDecimal, value)
  - Export `OnChainApiClient` interface with: `network`, `assertConfigured()`, `fetchNormalTransactions()`, `fetchTokenTransactions()`
  - All addresses documented as lower-cased on the way out
  - See design §2.1 for exact shape

- [x] **T06** — Create `apps/backend/src/sync/classify.ts` — types only (after T05)
  - Export `TxGroup` type (txHash, blockNumber, transactionIndex, timeStamp, normalTx, tokenTxs)
  - Export `DecomposedTransaction` type (id, type, txHash, txLogIndex, relatedTxId, blockNumber, transactionIndex, blockTimestamp, fromAddress, toAddress, tokenContract, tokenSymbol, tokenDecimals, amount, source)
  - See design §2.2 for exact shape

- [x] **T07** — Create `apps/backend/src/sync/cost-resolver.ts` — `CostResolution` type only (after T05)
  - Discriminated union: `{ costSource: 'INHERITED'; priceUsd: string; originPositionId: string }` | `{ costSource: 'INHERITED'; priceUsd: string; originCexTransferId: string }` | `{ costSource: 'MANUAL'; priceUsd: null }`
  - See design §2.3

- [x] **T08** — Create `apps/backend/src/schemas/sync.ts` (after T06, T07)
  - `SyncParamsSchema`: `z.object({ walletId: z.uuid() })` — use Zod 4 `z.uuid()` (not `z.string().uuid()`)
  - `SyncedTxSchema`: slim inline schema (id, type enum, txHash, blockTimestamp, amount, priceUsd, costSource)
  - `SyncResultSchema`: synced, skipped, swapsDecomposed, transfersPendingCost, transfersInheritedFromCEX, newTransactions (max 10)
  - Export `SyncParams` and `SyncResult` as `z.infer<>` types
  - See design §2.4

---

## Phase 3 — Constants

- [x] **T09** — Create `apps/backend/src/sync/constants/routers.ts`
  - `SWAP_ROUTERS` as `Readonly<Record<'ETH' | 'BSC', ReadonlySet<string>>>` using `Set<string>`
  - ETH: Uniswap V2 Router02, V3 SwapRouter, V3 SwapRouter02, Universal Router (V4 era address from design)
  - BSC: PancakeSwap V2 Router, V3 SmartRouter, V3 SmartRouterHelper
  - All addresses stored lower-cased (O(1) lookup, no per-call normalization needed)
  - Export `SupportedNetwork = keyof typeof SWAP_ROUTERS` — derived via `typeof`, not native enum
  - See design §6 for exact addresses

---

## Phase 4 — Clients (TDD — `engine` project)

### EtherscanClient

- [x] **T10** — Write failing test: EtherscanClient `fetchNormalTransactions` returns typed `NormalizedTx[]` (engine)
  - File: `apps/backend/src/sync/__tests__/bsctrace-normalize.test.ts` (shared normalize test file)
  - Stub `fetch`; return fixture with `status='1'` and 2 tx rows
  - Assert returned array length and shape (blockNumber parsed from string, from lowercased, isError boolean)
  - Assert `status='0'` + `message='No transactions found'` → returns `[]`
  - Assert `status='0'` with other message → throws `ExternalApiError`

- [x] **T11** — Write failing test: EtherscanClient pagination triggers re-fetch when `result.length === 1000` (engine)
  - File: `apps/backend/src/sync/__tests__/pagination.test.ts`
  - Stub fetch: first call returns 1000 rows (blocks 1–5000), second call returns 50 rows (blocks 4999–5050)
  - Assert mock invoked exactly 2 times
  - Assert second call uses `startBlock = 4999` (lastBlock of first batch - 1)
  - Assert total accumulated array has 1050 rows
  - Assert no third call is made

- [x] **T12** — Implement `apps/backend/src/sync/clients/etherscan.ts` (after T10, T11)
  - Export `createEtherscanClient({ apiKey, log }): OnChainApiClient`
  - `fetchNormalTransactions`: calls `https://api.etherscan.io/v2/api` with `chainid=1`, `module=account`, `action=txlist`, `sort=asc`, `offset=1000`
  - `fetchTokenTransactions`: same endpoint, `action=tokentx`
  - Normalizes `EtherscanTx` / `EtherscanTokenTx` to `NormalizedTx` / `NormalizedTokenTx` (parseInt blockNumber, toLowerCase addresses, etc.)
  - `assertConfigured()`: throws `ApiKeyMissingError('ETHERSCAN_API_KEY')` if apiKey is empty string
  - MUST NOT log the API key — build URL with `URL` object, scrub `apikey` from searchParams before passing to cause
  - See spec §6 for normalization rules

### BSCTraceClient

- [x] **T13** — Write failing test: BSCTraceClient `nr_getAssetTransfers` response normalized to `NormalizedTx` shape (engine)
  - File: `apps/backend/src/sync/__tests__/bsctrace-normalize.test.ts`
  - Fixture: JSON-RPC 2.0 response with 2 transfers (1 native BNB, 1 ERC20)
  - Assert `NormalizedTx[]` shape matches the equivalent Etherscan-normalized output modulo `source` field
  - Assert `blockNumber` parsed from hex (`blockNum`), all addresses lowercase
  - Assert JSON-RPC `error` field → throws `ExternalApiError('bsctrace', ...)`
  - Assert empty `result.transfers` → returns `[]`

- [x] **T14** — Implement `apps/backend/src/sync/clients/bsctrace.ts` (after T13)
  - Export `createBSCTraceClient({ apiKey, log }): OnChainApiClient`
  - `fetchNormalTransactions` and `fetchTokenTransactions` both call `nr_getAssetTransfers` JSON-RPC 2.0
  - Request body: `method: 'nr_getAssetTransfers'`, params with `fromBlock`/`toBlock` as `'0x' + n.toString(16)`, `category: ['external', 'erc20']`, `maxCount: '0x3e8'`, `withMetadata: true`, `excludeZeroValue: true`
  - Normalization: `blockNum` hex → parseInt(16), `metadata.blockTimestamp` → unix timestamp, `rawContract.address` → tokenAddress (null for external/native), `isError: false` (BSCTrace excludes failed txs)
  - `assertConfigured()`: throws `ApiKeyMissingError('BSCTRACE_API_KEY')` if apiKey is empty string
  - See spec §7 and design §6 for mapping table

---

## Phase 5 — Pure Classification (TDD — `engine` project)

- [x] **T15** — Write failing test: `groupByTxHash` groups normal + token txs by hash (engine)
  - File: `apps/backend/src/sync/__tests__/classify-decompose.test.ts`
  - Input: 3 normalTxs and 2 tokenTxs (2 hashes shared, 1 unique)
  - Assert resulting groups count, that tokenTxs within a group are sorted by logIndex ASC

- [x] **T16** — Write failing test: `classifyAndDecomposeTransaction` — ETH native transfer → 1 TRANSFER_IN row (engine)
  - File: `apps/backend/src/sync/__tests__/classify-decompose.test.ts`
  - Group: normalTx with `to=walletAddress`, counterparty is EOA (not in SWAP_ROUTERS), `isError='0'`, `value > '0'`
  - Assert: returns 1 `DecomposedTransaction` with `type='TRANSFER_IN'`, `txLogIndex=0`, `relatedTxId=null`

- [x] **T17** — Write failing test: `classifyAndDecomposeTransaction` — token transfer to contract → 1 BUY row (engine)
  - File: `apps/backend/src/sync/__tests__/classify-decompose.test.ts`
  - Group: tokenTx with `from=walletAddress`, counterparty is a contract address (not a router)
  - Assert: 1 `DecomposedTransaction` with `type='SELL'` or `type='BUY'` per heuristic (counterparty=contract → BUY/SELL)

- [x] **T18** — Write failing test: `classifyAndDecomposeTransaction` — SWAP via router → 2 rows SWAP_OUT + SWAP_IN (engine)
  - File: `apps/backend/src/sync/__tests__/classify-decompose.test.ts`
  - Group: normalTx with `to` in SWAP_ROUTERS['ETH'] + 1 tokenTx with `to=walletAddress`
  - Assert: returns 2 `DecomposedTransaction[]`, first has `type='SWAP_OUT'` + `txLogIndex=0`, second has `type='SWAP_IN'` + `txLogIndex=1`
  - Assert: `SWAP_OUT.relatedTxId === SWAP_IN.id` AND `SWAP_IN.relatedTxId === SWAP_OUT.id`

- [x] **T19** — Write failing test: `classifyAndDecomposeTransaction` — token-to-token swap → 2 rows (engine)
  - File: `apps/backend/src/sync/__tests__/classify-decompose.test.ts`
  - Group: 2 tokenTxs same hash, one has `from` in router set, other has `to=walletAddress`; no normalTx ETH value
  - Assert: 2 `DecomposedTransaction[]` with SWAP_OUT (lower logIndex) and SWAP_IN (higher logIndex), cross-linked relatedTxId

- [x] **T20** — Write failing test: `classifyAndDecomposeTransaction` — `isError='1'` → returns [] (engine)
  - File: `apps/backend/src/sync/__tests__/classify-decompose.test.ts`
  - Group: normalTx with `isError='1'`
  - Assert: returns empty array

- [x] **T21** — Implement `apps/backend/src/sync/classify.ts` — `groupByTxHash` and `classifyAndDecomposeTransaction` (after T15–T20)
  - `groupByTxHash(normalTxs, tokenTxs): TxGroup[]` — builds Map<txHash, {...}>, sorts tokenTxs by logIndex, returns groups sorted by (blockNumber, transactionIndex) ASC
  - `classifyAndDecomposeTransaction(group, walletAddress, network): DecomposedTransaction[]` — SWAP detection via Set membership in `SWAP_ROUTERS[network]`, decomposeSwap generates 2 UUIDs upfront, heuristic for BUY/SELL vs TRANSFER based on counterparty type
  - `decomposeSwap` invariants: OUT leg = `from === wallet`, IN leg = `to === wallet`; for token-to-token sort by logIndex ASC → lower=OUT
  - Filter: `isError === '1'` → return `[]`
  - See design §3.2 for full algorithm

---

## Phase 6 — Cost Resolver (TDD — `sync` project, needs DB)

- [x] **T22** — Write failing test: `resolveTransferCost` — step 1: on-chain wallet with OPEN position → INHERITED (sync)
  - File: `apps/backend/tests/sync-transfer-cost.test.ts`
  - Seed: wallet WA on-chain, position OPEN for tokenId T1 with wac='2000.00'
  - Assert: returns `{ costSource: 'INHERITED', priceUsd: '2000.00', originPositionId: <uuid> }`

- [x] **T23** — Write failing test: `resolveTransferCost` — step 2: Binance TRANSFER_OUT with same tx_hash → INHERITED from CEX (sync)
  - File: `apps/backend/tests/sync-transfer-cost.test.ts`
  - Seed: transaction source='BINANCE', type='TRANSFER_OUT', tx_hash=X, token_id=T1; position wac='1500.00'; no on-chain wallet with fromAddress
  - Assert: returns `{ costSource: 'INHERITED', priceUsd: '1500.00', originCexTransferId: <uuid> }`

- [x] **T24** — Write failing test: `resolveTransferCost` — step 1 CLOSED position falls through to MANUAL (sync)
  - File: `apps/backend/tests/sync-transfer-cost.test.ts`
  - Seed: wallet WC on-chain, position CLOSED for T1; no Binance tx with txHash=Y
  - Assert: returns `{ costSource: 'MANUAL', priceUsd: null }`

- [x] **T25** — Write failing test: `resolveTransferCost` — step D: no match in any step → MANUAL (sync)
  - File: `apps/backend/tests/sync-transfer-cost.test.ts`
  - No wallet with fromAddress, no Binance tx with txHash
  - Assert: returns `{ costSource: 'MANUAL', priceUsd: null }`

- [x] **T26** — Implement `apps/backend/src/sync/cost-resolver.ts` — `resolveTransferCost` function (after T22–T25)
  - `resolveTransferCost(pgc: PoolClient, txHash: string, fromAddress: string, tokenId: string): Promise<CostResolution>`
  - Step 1: SQL JOIN wallets+positions WHERE wallet_type='ON_CHAIN' AND lower(w.address)=$1 AND p.token_id=$2 AND p.status='OPEN' LIMIT 1
  - Step 2 (only if step 1 fails): SQL JOIN transactions+positions WHERE source='BINANCE' AND type='TRANSFER_OUT' AND tx_hash=$1 LIMIT 1
  - Step 3: return `{ costSource: 'MANUAL', priceUsd: null }`
  - Steps MUST run sequentially — abort chain on first match
  - MUST NOT log WAC values in production
  - See design §3.3 for exact SQL

---

## Phase 7 — OnChainSyncService (TDD — `engine` + `e2e` projects)

- [x] **T27** — Write failing test: `fetchAllRawTransactions` — pagination: mock returns 1000 then 50 → total 1050 (engine)
  - File: `apps/backend/src/sync/__tests__/pagination.test.ts`
  - Mock `OnChainApiClient.fetchNormalTransactions` and `fetchTokenTransactions`
  - normalTxs: first call → 1000 rows (last blockNumber=5000), second call → 50 rows
  - Assert: client called exactly twice for normalTxs; second call startBlock=4999; accumulated total=1050 rows
  - tokenTxs: mock returns < 1000 (single call); assert no extra calls

- [x] **T28** — Implement `apps/backend/src/services/on-chain-sync.ts` — `OnChainSyncService` (after T26, T27, T21)
  - Constructor takes `OnChainSyncDeps` (pool, priceService, etherscanClient, bsctraceClient)
  - `sync(walletId)`: loadWallet → ValidationError if CEX → assertConfigured() → fetchAllRawTransactions → groupByTxHash → classifyAndDecomposeTransaction per group → sort by (blockNumber, transactionIndex, txLogIndex) ASC → BEGIN transaction → for each tx: ensureToken + resolveTransferCost + PriceService + PositionEngine + persistOneTransaction → UPDATE wallets.last_synced_block → UPSERT wallet_sync_cursors → COMMIT → buildResult
  - `paginateNormal` and `paginateToken`: loop while batch.length === 1000, re-query with startBlock = lastBlock - 1
  - `fetchAllRawTransactions`: runs paginateNormal + paginateToken in parallel with Promise.all
  - `ensureToken`: UPSERT token row, return token_id
  - `persistOneTransaction`: load OPEN position FOR UPDATE → countClosed → PositionEngine.processTransaction → UPSERT position → INSERT transaction ON CONFLICT (tx_hash, tx_log_index) DO NOTHING → return { inserted: rowCount === 1 }
  - `NATIVE_PSEUDO_ADDRESS`: `{ ETH: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', BSC: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c' }`
  - See design §2.5 and §3.4 for class shape and WAC update flow

---

## Phase 8 — Route (TDD — `e2e` project)

- [x] **T29** — Write failing e2e test: `POST /api/sync/:walletId` — 400 for CEX wallet (e2e)
  - File: `apps/backend/tests/e2e-sync.test.ts`
  - Seed CEX wallet belonging to auth'd user; POST to its walletId
  - Assert: 400 `{ statusCode: 400, error: 'ValidationError', message: 'Wallet is not an on-chain wallet' }`
  - Assert: no HTTP call made to Etherscan/BSCTrace (use MockAgent/nock)

- [x] **T30** — Write failing e2e test: `POST /api/sync/:walletId` — 400 for missing ETHERSCAN_API_KEY (e2e)
  - File: `apps/backend/tests/e2e-sync.test.ts`
  - `delete process.env.ETHERSCAN_API_KEY` before request; restore after
  - Seed ETH on-chain wallet belonging to auth'd user
  - Assert: 400 `{ statusCode: 400, code: 'API_KEY_MISSING' }`
  - Assert: no HTTP call made to Etherscan (fail-fast before network)

- [x] **T31** — Write failing e2e test: `POST /api/sync/:walletId` — 404 for wallet not belonging to user (e2e)
  - File: `apps/backend/tests/e2e-sync.test.ts`
  - Seed wallet belonging to user U2; auth'd as U1
  - Assert: 404; variant: walletId is valid UUID but doesn't exist → 404

- [x] **T32** — Write failing e2e test: `POST /api/sync/:walletId` — 400 for non-UUID walletId (e2e)
  - File: `apps/backend/tests/e2e-sync.test.ts`
  - `POST /api/sync/not-a-uuid` with valid JWT
  - Assert: 400 Zod validation error (never reaches handler)

- [x] **T33** — Write failing e2e test: `POST /api/sync/:walletId` — 401 for missing JWT (e2e)
  - File: `apps/backend/tests/e2e-sync.test.ts`
  - No Authorization header; assert: 401 from global middleware (handler not reached)

- [x] **T34** — Write failing e2e test: `POST /api/sync/:walletId` — 502 on Etherscan HTTP failure (e2e)
  - File: `apps/backend/tests/e2e-sync.test.ts`
  - Mock Etherscan to return HTTP 500; also variant: `TypeError: fetch failed`
  - Assert: 502 `{ statusCode: 502, code: 'EXTERNAL_API_ERROR', message: 'External API error: ...' }`
  - Assert: API key does NOT appear in response body or logs

- [x] **T35** — Write failing e2e test: `POST /api/sync/:walletId` — 200 success + idempotency (e2e)
  - File: `apps/backend/tests/e2e-sync.test.ts`
  - Mock Etherscan to return 5 txs in blocks 100–200; ETH wallet with last_synced_block=0
  - First call: assert 200, body matches SyncResultSchema, synced=5, skipped=0
  - Second call: assert synced=0, skipped=5
  - Query DB: exactly 5 rows in transactions for that wallet (no duplicates)
  - Assert `wallets.last_synced_block` updated to 200 after first sync

- [x] **T36** — Implement `apps/backend/src/routes/sync.ts` — Fastify plugin `syncRoutes` (after T28–T35)
  - `export const syncRoutes: FastifyPluginAsync`
  - Creates Pool, priceService, etherscanClient, bsctraceClient, OnChainSyncService from env vars
  - Uses `fastify.withTypeProvider<ZodTypeProvider>().post('/:walletId', { schema: { params: SyncParamsSchema, response: { 200: SyncResultSchema } } }, handler)`
  - Handler calls `service.sync(req.params.walletId)` — no per-route auth preHandler (global onRequest covers it)
  - See design §7 for full plugin code

- [x] **T37** — Register `syncRoutes` in `apps/backend/src/index.ts` (after T36)
  - Add dynamic import + `await fastify.register(syncRoutes, { prefix: '/api/sync' })` after existing route registrations and after `authPlugin`
  - See spec §12 for exact placement

---

## Phase 9 — Integration Verification

- [x] **T38** — Run all vitest projects and confirm they pass (after T37)
  - `npm run test:engine` — pagination, classify-decompose, bsctrace-normalize tests green
  - `npm run test:sync` — sync-transfer-cost tests green
  - `npm run test:e2e` — e2e-sync tests green
  - Document any env vars required for sync/e2e runs

- [x] **T39** — Run typecheck and confirm zero errors (after T37)
  - `npm run typecheck`
  - Fix any type errors introduced across the new files

- [x] **T40** — Commit: `feat(sync): add on-chain sync service for ETH and BSC wallets` (after T38, T39)
  - Stage only new/modified files under `apps/backend/src/sync/`, `apps/backend/src/services/`, `apps/backend/src/routes/sync.ts`, `apps/backend/src/schemas/sync.ts`, `apps/backend/src/index.ts`, `db/migrations/0003_wallet_last_synced_block.sql`, test files
  - Conventional commit format; no AI attribution in commit message

---

## Dependency graph (compressed)

```
T01 (migration SQL)
T02 (run migration) — after T01
T03 (env.example verify) — independent

T04 (errors.ts) — independent
T05 (on-chain-api.ts) — after T04
T06 (classify types) — after T05
T07 (cost-resolver types) — after T05
T08 (schemas/sync.ts) — after T06, T07

T09 (routers.ts) — independent

T10, T11 (Etherscan tests) — after T05, T09
T12 (etherscan.ts) — after T10, T11
T13 (BSCTrace test) — after T05
T14 (bsctrace.ts) — after T13

T15–T20 (classify tests) — after T06, T09
T21 (classify.ts impl) — after T15–T20

T22–T25 (cost-resolver tests) — after T07
T26 (cost-resolver.ts impl) — after T22–T25

T27 (pagination test) — after T05, T08
T28 (OnChainSyncService) — after T26, T27, T21, T12, T14, T08

T29–T35 (route e2e tests) — after T08, T28
T36 (sync.ts route) — after T29–T35
T37 (index.ts wiring) — after T36

T38 (test run) — after T37
T39 (typecheck) — after T37
T40 (commit) — after T38, T39
```

---

## Task count summary

| Phase | Tasks | Notes |
|-------|-------|-------|
| 0 — Setup | T01–T03 | Migration + env verification |
| 1 — Errors | T04 | Extends existing errors.ts |
| 2 — Types & Schemas | T05–T08 | Pure types + Zod 4 schemas |
| 3 — Constants | T09 | SWAP_ROUTERS as Set (not array) |
| 4 — Clients (TDD) | T10–T14 | 3 tests + 2 implementations |
| 5 — Classification (TDD) | T15–T21 | 6 tests + 1 implementation |
| 6 — Cost Resolver (TDD) | T22–T26 | 4 tests + 1 implementation |
| 7 — Service (TDD) | T27–T28 | 1 test + 1 implementation |
| 8 — Route (TDD) | T29–T37 | 7 tests + route + wiring |
| 9 — Integration | T38–T40 | Verify + commit |
| **Total** | **40** | |
