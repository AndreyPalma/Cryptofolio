# US-010 Token Detail UI — Archive Report

## Summary

Implemented the Token Detail page for Cryptofolio, including a backend DTO extension to expose cycle number, transaction identifiers, cost inheritance metadata, and realized P&L, and a full frontend component tree (badges, stats cards, transaction table, position history, wallet selector) with 30-second polling and visibility-pause logic. All 13 acceptance criteria are covered by tests and passing.

## Final Test Counts

- Frontend: 196 tests (30 files)
- Backend engine: 236 tests (21 files)

## Verdict: PASS (warnings resolved)

No critical issues. Warnings are cosmetic (color shade `-700` vs `-900`, label "XFER IN" vs "TRANSFER IN") and do not block the story.

## Key Decisions

- Backend DTO extended: `cycleNumber`, `txHash`/`cexTradeId`/`relatedTxId`, `costInheritedFrom`, `realizedPnlUsd`
- `costInheritedFrom` derived from `cost_source` + `source` (no DB migration needed — pure query-time derivation)
- Wallet selector triggers server-side refetch with `?wallet_id=` query param instead of client-side filtering
- Tooltips implemented via Tailwind `group`/`group-hover` pattern (`WithTooltip` wrapper component)
- `PositionHistoryPage`: minimal implementation — closed cycles list with `CycleBadge`, date range, and realized P&L
- 30s polling in `useTokenDetail` with `visibilitychange` pause (pauses when tab hidden, immediate refetch on return)

## Files Added/Modified

### Backend
- `apps/backend/src/types/portfolio.ts` — added `cycleNumber` to `TokenPortfolioRowSchema`; added `txHash`, `cexTradeId`, `relatedTxId`, `costInheritedFrom` to `TransactionWithPnlSchema`; added `realizedPnlUsd` to `OutboundPnlSchema`
- `apps/backend/src/services/portfolio.ts` — `buildPortfolioRow` populates `cycleNumber`; `computePnl` populates `realizedPnlUsd`; `getTokenDetail` SQL extended; `costInheritedFrom` derived in mapper
- `apps/backend/src/services/__tests__/portfolio.test.ts` — new RED/GREEN tests for all DTO additions + regression tests

### Frontend (new)
- `apps/frontend/src/types/token-detail.ts` — all token detail types
- `apps/frontend/src/hooks/useTokenDetail.ts` — 30s poll, visibility pause, wallet param, stale-while-error
- `apps/frontend/src/hooks/usePositionHistory.ts` — one-shot fetch
- `apps/frontend/src/hooks/useWallets.ts` — one-shot fetch
- `apps/frontend/src/components/token-detail/TypeBadge.tsx`
- `apps/frontend/src/components/token-detail/SourceBadge.tsx`
- `apps/frontend/src/components/token-detail/CostSourceBadge.tsx`
- `apps/frontend/src/components/token-detail/WithTooltip.tsx`
- `apps/frontend/src/components/token-detail/CycleBadge.tsx`
- `apps/frontend/src/components/token-detail/WalletSelector.tsx`
- `apps/frontend/src/components/token-detail/TokenStatsCards.tsx`
- `apps/frontend/src/components/token-detail/TokenDetailHeader.tsx`
- `apps/frontend/src/components/token-detail/TransactionTable.tsx`
- `apps/frontend/src/pages/TokenDetailPage.tsx`
- `apps/frontend/src/pages/PositionHistoryPage.tsx`

### Frontend (modified)
- `apps/frontend/src/routes/router.tsx` — added `/token/:contractAddress/:network` and `/token/:contractAddress/:network/history` routes
- `apps/frontend/src/components/dashboard/PortfolioRow.tsx` — symbol cell wrapped in `<Link>` to token detail route

### Frontend tests (new)
- `apps/frontend/tests/type-badge.test.tsx`
- `apps/frontend/tests/cost-source-badge.test.tsx`
- `apps/frontend/tests/with-tooltip.test.tsx`
- `apps/frontend/tests/token-detail-header.test.tsx`
- `apps/frontend/tests/wallet-selector.test.tsx`
- `apps/frontend/tests/transaction-table.test.tsx`
- `apps/frontend/tests/use-token-detail.test.ts`
- `apps/frontend/tests/use-position-history.test.ts`
- `apps/frontend/tests/use-wallets.test.ts`
- `apps/frontend/tests/token-detail-page.test.tsx`
- `apps/frontend/tests/position-history-page.test.tsx`
- `apps/frontend/tests/portfolio-row.test.tsx` (extended)
