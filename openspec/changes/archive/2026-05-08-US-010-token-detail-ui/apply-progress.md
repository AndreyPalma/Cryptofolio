# US-010 Token Detail UI — Apply Progress

**Status:** COMPLETE (all 6 phases done)  
**Frontend tests:** 196 passing  
**Backend tests:** 236 passing (1 pre-existing failure unrelated to US-010)  

---

## Phase 1: Backend DTO Extension ✅

- [x] T-001 [RED] TokenPortfolioRowSchema.parse rejects object missing cycleNumber
- [x] T-002 [GREEN] Add `cycleNumber: z.number().int().nonnegative()` to TokenPortfolioRowSchema
- [x] T-003 [RED] buildPortfolioRow result includes cycleNumber
- [x] T-004 [GREEN] Add `cycleNumber: virtual.cycleNumber` to buildPortfolioRow
- [x] T-005 [RED] TransactionWithPnlSchema rejects missing txHash/cexTradeId/relatedTxId
- [x] T-006 [GREEN] Add txHash/cexTradeId/relatedTxId (all z.string().nullable()) to schema
- [x] T-007 [RED] OutboundPnlSchema rejects missing realizedPnlUsd
- [x] T-008 [GREEN] Add realizedPnlUsd: z.string().nullable() to OutboundPnlSchema
- [x] T-009 [RED] computePnl SELL returns realizedPnlUsd when both prices available
- [x] T-010 [RED] computePnl SELL returns realizedPnlUsd null when priceUsd is null
- [x] T-011 [GREEN] Update computePnl to populate realizedPnlUsd for OUTBOUND types
- [x] T-012 [RED] getTokenDetail transactions include txHash/cexTradeId/relatedTxId
- [x] T-013 [GREEN] Extend TxRow interface + SQL SELECT + transaction mapper
- [x] T-014 [RED] costInheritedFrom is 'ONCHAIN' for INHERITED ETHERSCAN TRANSFER_IN
- [x] T-015 [RED] costInheritedFrom is 'BINANCE' for INHERITED BINANCE TRANSFER_IN
- [x] T-016 [GREEN] Add costInheritedFrom to TransactionWithPnlSchema; derive in mapper
- [x] T-017 [GREEN] Updated existing test fixtures (txRow in getTokenDetail tests has tx_hash etc via DB mock)
- [x] T-018 [RED] Regression: getPortfolioSummary still passes with cycleNumber required
- [x] T-019 [GREEN] All backend portfolio tests pass (236 total)

---

## Phase 2: Frontend Types & Utility ✅

- [x] T-020 [SCHEMA] Created `apps/frontend/src/types/token-detail.ts`
- [x] T-021 [RED] useTokenDetail initial fetch sets loading → data
- [x] T-022 [RED] useTokenDetail polling fires every 30s
- [x] T-023 [RED] useTokenDetail visibility hidden pauses; visible resumes + refetch
- [x] T-024 [RED] useTokenDetail walletId change appends ?wallet_id= to URL
- [x] T-025 [RED] useTokenDetail UnauthorizedError re-throws without error state
- [x] T-026 [RED] useTokenDetail fetch error preserves stale data
- [x] T-027 [GREEN] Implemented useTokenDetail in `apps/frontend/src/hooks/useTokenDetail.ts`
- [x] T-028 [RED] usePositionHistory one-shot fetch, no interval
- [x] T-029 [GREEN] Implemented usePositionHistory in `apps/frontend/src/hooks/usePositionHistory.ts`
- [x] T-030 [RED] useWallets one-shot fetch from /api/wallets
- [x] T-031 [GREEN] Implemented useWallets in `apps/frontend/src/hooks/useWallets.ts`

---

## Phase 3: Leaf Components ✅

- [x] T-032 [RED] TypeBadge tests (6 types, tooltip prop, absent tooltip)
- [x] T-033 [GREEN] TypeBadge in `apps/frontend/src/components/token-detail/TypeBadge.tsx`
- [x] T-034 [RED] SourceBadge tests
- [x] T-035 [GREEN] SourceBadge in `apps/frontend/src/components/token-detail/SourceBadge.tsx`
- [x] T-036 [RED] CostSourceBadge tests (INHERITED+ONCHAIN, INHERITED+BINANCE, MANUAL, null, MARKET)
- [x] T-037 [GREEN] CostSourceBadge in `apps/frontend/src/components/token-detail/CostSourceBadge.tsx`
- [x] T-038 [RED] WithTooltip tests (null text, tooltip span, opacity classes)
- [x] T-039 [GREEN] WithTooltip in `apps/frontend/src/components/token-detail/WithTooltip.tsx`
- [x] T-040 [SCHEMA] CycleBadge in `apps/frontend/src/components/token-detail/CycleBadge.tsx`

---

## Phase 4: Composite Components ✅

- [x] T-041 [RED] TokenDetailHeader tests (symbol, network, cycle badge, closed cycles link)
- [x] T-042 [GREEN] TokenDetailHeader in `apps/frontend/src/components/token-detail/TokenDetailHeader.tsx`
- [x] T-043 [RED] WalletSelector tests (All Wallets, options, onChange callbacks, label fallback)
- [x] T-044 [GREEN] WalletSelector in `apps/frontend/src/components/token-detail/WalletSelector.tsx`
- [x] T-045 [SCHEMA] TokenStatsCards in `apps/frontend/src/components/token-detail/TokenStatsCards.tsx`
- [x] T-046 [RED] TransactionTable tests (all 11 scenarios)
- [x] T-047 [GREEN] TransactionTable in `apps/frontend/src/components/token-detail/TransactionTable.tsx`

---

## Phase 5: Page Integration ✅

- [x] T-048 [RED] TokenDetailPage invalid network → redirect to /
- [x] T-049 [RED] TokenDetailPage loading → data rendered
- [x] T-050 [RED] TokenDetailPage WalletSelector shown/hidden based on network
- [x] T-051 [RED] TokenDetailPage wallet selection triggers refetch with wallet_id (covered by T-024)
- [x] T-052 [RED] TokenDetailPage poll fires after 30s
- [x] T-053 [RED] TokenDetailPage position=null + transactions=[] → empty state
- [x] T-054 [RED] TokenDetailPage stale data + error banner simultaneously
- [x] T-055 [GREEN] TokenDetailPage in `apps/frontend/src/pages/TokenDetailPage.tsx`

---

## Phase 6: PositionHistoryPage + Routing ✅

- [x] T-056 [RED] PositionHistoryPage renders one CycleCard per entry
- [x] T-057 [RED] PositionHistoryPage renders "No closed cycles yet" when empty
- [x] T-058 [RED] PositionHistoryPage BackLink navigates to /token/:contractAddress/:network
- [x] T-059 [GREEN] PositionHistoryPage in `apps/frontend/src/pages/PositionHistoryPage.tsx`
- [x] T-060 [CONFIG] Updated `apps/frontend/src/routes/router.tsx` with 2 protected routes
- [x] T-061 [RED] PortfolioRow symbol cell renders Link to /token/:contractAddress/:network
- [x] T-062 [GREEN] Wrapped symbol cell in Link in `apps/frontend/src/components/dashboard/PortfolioRow.tsx`
- [x] T-063 [GREEN] All tests GREEN (196 frontend, 236 backend)
