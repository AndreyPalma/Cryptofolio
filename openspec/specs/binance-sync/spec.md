# Spec — BinanceSyncService

**Origin change**: US-008-B-binance-cex-sync
**Date**: 2026-05-07
**Status**: DONE

---

## Overview

`BinanceSyncService` is the CEX-branch sync counterpart to `OnChainSyncService`. It reads trade, convert, withdrawal, and deposit history from the Binance REST API, classifies each event into the shared transaction model (WAC, position cycles, swap decomposition), and persists them idempotently using the existing DB schema.

No DB migrations were required — all columns and indexes were already present.

---

## Architecture placement

```
routes/sync.ts
  POST /api/sync/:walletId
  ├── wallet_type='ON_CHAIN' → OnChainSyncService   (existing)
  └── wallet_type='CEX'      → BinanceSyncService   (new)
                                    └── BinanceApiClient  (new)
                                    └── PriceService       (existing, getCexPrice)
                                    └── PositionEngine     (existing, processTransaction)
```

**Files**:
- `apps/backend/src/services/binance-sync.ts` — `BinanceSyncService`
- `apps/backend/src/sync/clients/binance-api.ts` — `BinanceApiClient`

---

## Key invariants

| ID | Invariant |
|----|-----------|
| INV-1 | Each Convert `orderId` → exactly 2 rows: SWAP_OUT (tx_log_index=0) + SWAP_IN (tx_log_index=1) |
| INV-2 | SWAP_OUT.related_tx_id === SWAP_IN.id AND SWAP_IN.related_tx_id === SWAP_OUT.id |
| INV-3 | Every withdrawal row has tx_hash = withdrawal.txId (never null) — Binance→on-chain bridge |
| INV-4 | All sub-methods are idempotent (ON CONFLICT DO NOTHING); second run increments skipped only |
| INV-5 | Deposit INHERITED: price_usd equals WAC from on-chain TRANSFER_OUT matching (address, txId, tokenId) |
| INV-6 | BINANCE_SECRET_KEY and BINANCE_API_KEY never appear in logs, errors, or HTTP responses |
| INV-7 | tx_log_index=0 for all single-row CEX transactions (trades, withdrawals, deposits) |

---

## Critical constraint: tokens_source_coherence

The DB schema enforces:
```sql
CONSTRAINT tokens_source_coherence CHECK (
  (network IN ('ETH', 'BSC') AND contract_address IS NOT NULL)
  OR
  (network = 'CEX_BINANCE'   AND contract_address IS NULL)
)
```

`ensureTokenCex` MUST use `symbol` for lookup and MUST NOT include `contract_address` in the INSERT. Violating this causes `ERROR 23514` and breaks every CEX sync.

---

## Cursor operations

| Sub-method | operation key | Window |
|------------|---------------|--------|
| syncTrades | `trades:${symbol}` | 24h |
| syncConvert | `converts` | 30 days |
| syncWithdrawals | `withdrawals` | 90 days |
| syncDeposits | `deposits` | 90 days |

---

## BinanceSyncResult shape

```typescript
{
  trades:      { synced, skipped, symbolsProcessed }
  converts:    { synced, skipped }
  withdrawals: { synced, skipped }
  deposits:    { synced, skipped, inherited, manual }
  tokensCreated: number
}
```

---

## Error codes

| Scenario | Code | HTTP |
|----------|------|------|
| BINANCE_API_KEY/SECRET not set | API_KEY_MISSING | 400 |
| Binance -2015 / -2014 | BINANCE_INVALID_CREDENTIALS | 400 |
| Binance HTTP 429 or 5xx | EXTERNAL_API_ERROR | 502 |
| Wallet not found | WALLET_NOT_FOUND | 404 |

---

## Full spec

See archived change: `openspec/changes/archive/2026-05-07-US-008-B-binance-cex-sync/specs/binance-sync-service.md`
