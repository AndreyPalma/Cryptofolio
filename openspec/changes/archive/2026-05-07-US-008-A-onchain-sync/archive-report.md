# Archive Report — US-008-A-onchain-sync

**Archived**: 2026-05-07
**Status**: CLOSED
**Verdict**: PASS WITH WARNINGS (warnings resolved in follow-up commit)

## Commits
- `f8df4a1` — feat(sync): add on-chain sync service for ETH and BSC wallets
- `f82c070` — fix(sync): enforce wallet ownership, fix error messages, strengthen idempotency assertion

## Summary

US-008-A implements the on-chain sync pipeline for ETH (Etherscan) and BSC (BSCTrace) wallets:
- EtherscanClient + BSCTraceClient (OnChainApiClient interface)
- SWAP_ROUTERS with ReadonlySet (O(1) router lookup for swap decomposition)
- groupByTxHash + classifyAndDecomposeTransaction (ETH native, ERC20 token, swap pairs)
- resolveTransferCost (3-step: on-chain wallet WAC → Binance CEX TRANSFER_OUT → MANUAL)
- OnChainSyncService.sync: full pipeline with pagination (re-query when batch=1000), atomic DB transaction
- POST /api/sync/:walletId route (authenticated, ownership-checked)
- Migration 0003: wallets.last_synced_block
- 208 engine unit tests passing, typecheck clean

## Warnings resolved
- W-01: Route now passes userId for wallet ownership check
- W-02: ApiKeyMissingError message: "${envVar} is not configured"
- W-03: ExternalApiError message: "External API error: ${serviceName}"
- W-05: T35 idempotency assertion strengthened

## Remaining notes (non-blocking)
- W-06: SWAP_ROUTERS uses V4-era Universal Router address (deliberate, documented in design §6)
- W-07: decimal.js in cost-resolver (runtime dep, not a correctness issue)
- W-08: Pre-existing transaction.test.ts import path error (unrelated to this change)
- S-01: Single DB transaction for all rows (acceptable for V1 single-wallet history)
- S-02: buildResult slices newTransactionIds by insertion order, not timestamp

## Files
- `apps/backend/src/sync/clients/on-chain-api.ts`
- `apps/backend/src/sync/clients/etherscan.ts`
- `apps/backend/src/sync/clients/bsctrace.ts`
- `apps/backend/src/sync/constants/routers.ts`
- `apps/backend/src/sync/classify.ts`
- `apps/backend/src/sync/cost-resolver.ts`
- `apps/backend/src/services/on-chain-sync.ts`
- `apps/backend/src/services/errors.ts`
- `apps/backend/src/schemas/sync.ts`
- `apps/backend/src/routes/sync.ts`
- `apps/backend/src/index.ts`
- `db/migrations/0003_wallet_last_synced_block.sql`
- `tests/e2e/api/sync.test.ts`
- `apps/backend/src/sync/__tests__/bsctrace-normalize.test.ts`
- `apps/backend/src/sync/__tests__/pagination.test.ts`
- `apps/backend/src/sync/__tests__/classify-decompose.test.ts`
- `apps/backend/tests/sync-transfer-cost.test.ts`
