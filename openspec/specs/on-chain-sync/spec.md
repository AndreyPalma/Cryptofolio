# Spec — On-Chain Sync (ETH + BSC)

**Story**: US-008-A
**Status**: IMPLEMENTED (2026-05-07)
**Source change**: `openspec/changes/archive/2026-05-07-US-008-A-onchain-sync/`

## Scope

Sync on-chain transaction history for ETH (Etherscan) and BSC (BSCTrace) wallets into the Cryptofolio DB, computing WAC/positions via the existing PositionEngine.

## Endpoint

`POST /api/sync/:walletId` — authenticated (JWT cookie). Returns `SyncResult`.

## Key invariants

- Only `ON_CHAIN` wallets with `network ∈ {ETH, BSC}` are supported. CEX wallets → 400.
- Missing API key → 400 `API_KEY_MISSING` before any network call.
- Wallet must belong to the authenticated user → 404 otherwise.
- Pagination: re-query while batch size === 1000, with `startBlock = lastBlock - 1`.
- All DB writes for a sync run are in a single atomic transaction.
- Idempotent: `INSERT ... ON CONFLICT (tx_hash, tx_log_index) DO NOTHING`.
- External API failures → 502 `EXTERNAL_API_ERROR` (API key never exposed in response/logs).

## Transaction classification

| Pattern | Types emitted |
|---------|--------------|
| Native ETH/BNB to wallet | TRANSFER_IN |
| Native ETH/BNB from wallet | TRANSFER_OUT |
| Token tx to wallet (non-router counterparty) | TRANSFER_IN or BUY |
| Token tx from wallet (non-router counterparty) | TRANSFER_OUT or SELL |
| normalTx.to ∈ SWAP_ROUTERS + tokenTx(s) | SWAP_OUT (logIndex=0) + SWAP_IN (logIndex=1) |
| isError === '1' | [] (skip) |

Swap pairs are cross-linked via `related_tx_id` (both directions).

## Transfer cost resolution (TRANSFER_IN)

1. `from_address` matches ON_CHAIN wallet with OPEN position → `costSource='INHERITED'`, inherit WAC.
2. Binance TRANSFER_OUT with same `tx_hash` → `costSource='INHERITED'`, inherit WAC from CEX position.
3. No match → `costSource='MANUAL'`, `price_usd=null`, UI prompts user.

## Migration

`db/migrations/0003_wallet_last_synced_block.sql` — adds `wallets.last_synced_block INTEGER NOT NULL DEFAULT 0`.

## Implementation files

- `apps/backend/src/sync/clients/on-chain-api.ts` — OnChainApiClient interface + normalized types
- `apps/backend/src/sync/clients/etherscan.ts` — EtherscanClient
- `apps/backend/src/sync/clients/bsctrace.ts` — BSCTraceClient
- `apps/backend/src/sync/constants/routers.ts` — SWAP_ROUTERS ReadonlySet
- `apps/backend/src/sync/classify.ts` — groupByTxHash + classifyAndDecomposeTransaction
- `apps/backend/src/sync/cost-resolver.ts` — resolveTransferCost
- `apps/backend/src/services/on-chain-sync.ts` — OnChainSyncService
- `apps/backend/src/routes/sync.ts` — Fastify plugin
- `apps/backend/src/schemas/sync.ts` — Zod 4 schemas
