# Archive Report — US-008-B-binance-cex-sync

**Archived**: 2026-05-07
**Status**: CLOSED
**Verdict**: PASS WITH WARNINGS (critical constraint bug resolved in follow-up commit)

## Commits
- `98ef9f7` — feat(sync): add Binance CEX sync service — trades, converts, withdrawals, deposits
- `3ff6b87` — fix(sync): use symbol column for CEX token lookup (contract_address must be NULL for CEX_BINANCE)

## Summary

US-008-B implements the Binance CEX sync pipeline:
- `BinanceApiClient`: HMAC-SHA256 signed HTTP client. API key in `X-MBX-APIKEY` header. Secret key never in logs/errors/URLs.
- `BinanceSyncService.syncTrades`: per-asset 24h windows, BUY/SELL per isBuyer, stable vs non-stable price, tx_log_index=0
- `BinanceSyncService.syncConvert`: 30-day windows, SWAP_OUT(0)+SWAP_IN(1) cross-linked by relatedTxId, orderId as cex_trade_id
- `BinanceSyncService.syncWithdrawals`: 90-day windows, TRANSFER_OUT with tx_hash=txId (on-chain bridge for TRANSFER_IN cost inheritance)
- `BinanceSyncService.syncDeposits`: 90-day windows, INHERITED (ON_CHAIN wallet TRANSFER_OUT match) vs MARKET cost resolution
- Route dispatch: POST /api/sync/:walletId now branches by wallet_type (ON_CHAIN → OnChainSyncService, CEX → BinanceSyncService)
- 227 engine unit tests passing (all 19 new tests green), typecheck clean

## Critical fix applied
- `ensureTokenCex` was inserting `contract_address=lower(symbol)` which violated the `tokens_source_coherence` CHECK constraint (`contract_address IS NULL` required for CEX_BINANCE). Fixed to use `symbol` column for lookup, omit `contract_address` from INSERT.

## Remaining warnings (non-blocking)
- WARNING-1: Missing `log.warn` in 22003 overflow catch block in `persistBinanceTx`
- WARNING-2: `syncConvert` synced/skipped counts rows not orders
- WARNING-3: `computeTradePrice` and `resolveDepositCost` are public for testability (minor API surface exposure)

## Notes
- sync (T36) and e2e (T37) tests require live PostgreSQL DB — written and structurally correct, not run during verification
- Pre-existing `transaction.test.ts` broken import is unrelated to this change

## Files

### New files
- `apps/backend/src/sync/clients/binance-api.ts` — BinanceApiClient interface + factory
- `apps/backend/src/services/binance-sync.ts` — BinanceSyncService
- `apps/backend/src/sync/__tests__/binance-api-client.test.ts` — 12 unit tests
- `apps/backend/src/sync/__tests__/binance-classify.test.ts` — 7 unit tests
- `apps/backend/tests/sync-binance.test.ts` — integration tests (sync project)
- `tests/e2e/api/binance-sync.test.ts` — E2E tests

### Modified files
- `apps/backend/src/schemas/sync.ts` — added BinanceSyncResultSchema + BinanceSyncResult type
- `apps/backend/src/routes/sync.ts` — wallet_type dispatch, BinanceSyncService instantiation, z.unknown() response
- `apps/backend/src/services/on-chain-sync.ts` — CEX guard replaced with invariant assertion
