# US-010 Token Detail UI — Tasks

## Phase 1: Backend DTO Extension

- [ ] T-001 [RED] Write failing test: `TokenPortfolioRowSchema.parse` rejects object missing `cycleNumber` field
- [ ] T-002 [GREEN] Add `cycleNumber: z.number().int().nonnegative()` to `TokenPortfolioRowSchema` in `apps/backend/src/types/portfolio.ts`
- [ ] T-003 [RED] Write failing test: `buildPortfolioRow` result includes `cycleNumber` equal to `virtual.cycleNumber`
- [ ] T-004 [GREEN] Add `cycleNumber: virtual.cycleNumber` to `buildPortfolioRow` return literal in `apps/backend/src/services/portfolio.ts`
- [ ] T-005 [RED] Write failing test: `TransactionWithPnlSchema.parse` rejects object missing `txHash`, `cexTradeId`, `relatedTxId`
- [ ] T-006 [GREEN] Add `txHash`, `cexTradeId`, `relatedTxId` (all `z.string().nullable()`) to `TransactionWithPnlSchema`
- [ ] T-007 [RED] Write failing test: `OutboundPnlSchema.parse` rejects object missing `realizedPnlUsd` field
- [ ] T-008 [GREEN] Add `realizedPnlUsd: z.string().nullable()` to `OutboundPnlSchema`
- [ ] T-009 [RED] Write failing test: `computePnl` for SELL type returns `{ kind: 'OUTBOUND', displayAs: 'Sold/Out', realizedPnlUsd: '<value>' }` when both prices available
- [ ] T-010 [RED] Write failing test: `computePnl` for SELL type returns `realizedPnlUsd: null` when `priceUsd` is null
- [ ] T-011 [GREEN] Update `computePnl` in `apps/backend/src/services/portfolio.ts` to populate `realizedPnlUsd` for OUTBOUND types
- [ ] T-012 [RED] Write failing test: `getTokenDetail` response transactions include `txHash`, `cexTradeId`, `relatedTxId` matching the mock DB row
- [ ] T-013 [GREEN] Extend `TxRow` interface with `tx_hash`, `cex_trade_id`, `related_tx_id`; update `getTokenDetail` SQL SELECT to include those columns; map them in the transaction mapper
- [ ] T-014 [RED] Write failing test: `costInheritedFrom` is `'ONCHAIN'` for `TRANSFER_IN` with `cost_source='INHERITED'` and `source='ETHERSCAN'`
- [ ] T-015 [RED] Write failing test: `costInheritedFrom` is `'BINANCE'` for `TRANSFER_IN` with `cost_source='INHERITED'` and `source='BINANCE'`
- [ ] T-016 [GREEN] Add `costInheritedFrom: z.enum(['ONCHAIN','BINANCE']).nullable()` to `TransactionWithPnlSchema`; derive value in the transaction mapper
- [ ] T-017 [GREEN] Update existing test fixtures in `apps/backend/src/services/__tests__/portfolio.test.ts` that call `TransactionWithPnlSchema.parse` to include `txHash: null, cexTradeId: null, relatedTxId: null, costInheritedFrom: null`
- [ ] T-018 [RED] Write regression test: `getPortfolioSummary` still passes with `cycleNumber` now required in `TokenPortfolioRowSchema` (update relevant fixtures)
- [ ] T-019 [GREEN] Update `getPortfolioSummary` path fixtures/mocks to include `cycleNumber`; verify all backend portfolio tests pass via `npm run test:engine`

---

## Phase 2: Frontend Types & Utility

- [ ] T-020 [SCHEMA] Create `apps/frontend/src/types/token-detail.ts` with all types: `TransactionType`, `TransactionSource`, `CostSource`, `CostInheritedFrom`, `PnlInfo` (INBOUND + OUTBOUND with `realizedPnlUsd`), `TransactionWithPnl`, `TokenInfo`, `PositionStats`, `WalletBreakdown`, `TokenDetail`, `PositionHistoryEntry`, `PositionHistoryResponse`, `WalletEntry`
- [ ] T-021 [RED] Write failing test for `useTokenDetail`: initial fetch sets `loading: true` then populates `data` when resolved
- [ ] T-022 [RED] Write failing test for `useTokenDetail`: polling fires every 30 s (mock `setInterval`, assert call count after timer advance)
- [ ] T-023 [RED] Write failing test for `useTokenDetail`: visibility `hidden` pauses polling; `visible` triggers immediate refetch and re-arms interval
- [ ] T-024 [RED] Write failing test for `useTokenDetail`: changing `walletId` appends `?wallet_id=` to the fetch URL
- [ ] T-025 [RED] Write failing test for `useTokenDetail`: `UnauthorizedError` re-throws without populating `error` state
- [ ] T-026 [RED] Write failing test for `useTokenDetail`: fetch error preserves stale `data` (stale-while-error)
- [ ] T-027 [GREEN] Implement `useTokenDetail` in `apps/frontend/src/hooks/useTokenDetail.ts` (30 s poll, visibility pause, wallet param, stale-while-error, UnauthorizedError re-throw)
- [ ] T-028 [RED] Write failing test for `usePositionHistory`: one-shot fetch — sets `loading → data`, no interval set
- [ ] T-029 [GREEN] Implement `usePositionHistory` in `apps/frontend/src/hooks/usePositionHistory.ts` (single fetch, no polling)
- [ ] T-030 [RED] Write failing test for `useWallets`: one-shot fetch from `/api/wallets`, populates `data`
- [ ] T-031 [GREEN] Implement `useWallets` in `apps/frontend/src/hooks/useWallets.ts` (single fetch, no polling)

---

## Phase 3: Leaf Components

- [ ] T-032 [RED] Write failing tests for `TypeBadge`: all 6 types render correct CSS class; `tooltip` prop sets `title` attribute; absent `tooltip` → no `title`
- [ ] T-033 [GREEN] Implement `TypeBadge` in `apps/frontend/src/components/token-detail/TypeBadge.tsx` (TYPE_CONFIG map, `title` attr for swap tooltips)
- [ ] T-034 [RED] Write failing tests for `SourceBadge`: all 4 sources render correct label; Binance withdrawal `tooltip` sets `title` attribute
- [ ] T-035 [GREEN] Implement `SourceBadge` in `apps/frontend/src/components/token-detail/SourceBadge.tsx` (SOURCE_CONFIG map)
- [ ] T-036 [RED] Write failing tests for `CostSourceBadge`: `INHERITED+ONCHAIN` → "Cost inherited (wallet)" green; `INHERITED+BINANCE` → "Cost inherited (Binance)" green; `MANUAL` → "Manual cost" gray; `costSource=null` → renders nothing; `costSource='MARKET'` → renders nothing
- [ ] T-037 [GREEN] Implement `CostSourceBadge` in `apps/frontend/src/components/token-detail/CostSourceBadge.tsx` (using `CostInheritedFrom` field for label derivation)
- [ ] T-038 [RED] Write failing tests for `WithTooltip`: `text={null}` renders children with no wrapper span; `text="msg"` renders tooltip span with `role="tooltip"`; span has `opacity-0` + `group-hover:opacity-100` classes
- [ ] T-039 [GREEN] Implement `WithTooltip` in `apps/frontend/src/components/token-detail/WithTooltip.tsx` (group/group-hover pattern)
- [ ] T-040 [SCHEMA] Implement `CycleBadge` in `apps/frontend/src/components/token-detail/CycleBadge.tsx` (`cycleNumber: number | undefined` → "CYCLE #N" or "CYCLE #—")

---

## Phase 4: Composite Components

- [ ] T-041 [RED] Write failing tests for `TokenDetailHeader`: renders symbol + NetworkBadge; `CycleBadge` shows "CYCLE #1" when position present; "CYCLE #—" when null; "View 2 closed cycles" link shown when `closedCycleCount=2`; link hidden when `closedCycleCount=0`
- [ ] T-042 [GREEN] Implement `TokenDetailHeader` in `apps/frontend/src/components/token-detail/TokenDetailHeader.tsx` (reuses `TokenLogo`, `NetworkBadge`, `CycleBadge`; inline ClosedCyclesLink)
- [ ] T-043 [RED] Write failing tests for `WalletSelector`: "All Wallets" is first option; renders one option per wallet; selecting a wallet calls `onSelect(walletId)`; selecting "All Wallets" calls `onSelect(null)`; label used when available; truncated address used when label is null
- [ ] T-044 [GREEN] Implement `WalletSelector` in `apps/frontend/src/components/token-detail/WalletSelector.tsx` (native `<select>`, derives options from `walletBreakdown`)
- [ ] T-045 [SCHEMA] Implement `TokenStatsCards` in `apps/frontend/src/components/token-detail/TokenStatsCards.tsx` (6 stat cards: Balance, Current Price, Current Value, WAC, Cost Basis, P&L; all show "—" when `position === null`; price/value/P&L show "—" when `priceUnavailable`)
- [ ] T-046 [RED] Write failing tests for `TransactionTable`: all 9 column headers present; BUY row shows formatted amount and price; SWAP_IN on-chain → `TypeBadge` has `title` containing "Auto-detected swap"; SWAP_IN Binance → `title` contains "Binance Convert #"; TRANSFER_IN INHERITED ONCHAIN → `CostSourceBadge` renders "Cost inherited (wallet)"; TRANSFER_OUT Binance with txHash → `SourceBadge title` contains "Withdrawal tx"; SELL row P&L in italic; INBOUND pnl renders value; empty array → "No transactions recorded yet"; null `priceUsd` → "Value at Time" shows "—"; null `currentPrice` → "Current Value" shows "—"
- [ ] T-047 [GREEN] Implement `TransactionTable` in `apps/frontend/src/components/token-detail/TransactionTable.tsx` (full 9-column table; AC-3 columns; badge rules for swap/transfer/withdrawal; italic OUTBOUND P&L; empty state; Value at Time/Current Value null guards)

---

## Phase 5: Page Integration

- [ ] T-048 [RED] Write failing test for `TokenDetailPage`: invalid `network` URL param → redirects to `/`
- [ ] T-049 [RED] Write failing test for `TokenDetailPage`: loading skeleton shown during initial fetch; header + stats visible after data arrives
- [ ] T-050 [RED] Write failing test for `TokenDetailPage`: `WalletSelector` rendered for ON_CHAIN network; NOT rendered for `CEX_BINANCE`
- [ ] T-051 [RED] Write failing test for `TokenDetailPage`: selecting a wallet triggers API call with `?wallet_id=` query param
- [ ] T-052 [RED] Write failing test for `TokenDetailPage`: poll fires after 30 s (advance fake timers, verify second API call)
- [ ] T-053 [RED] Write failing test for `TokenDetailPage`: `position=null` + `transactions=[]` → "No transactions recorded yet" shown
- [ ] T-054 [RED] Write failing test for `TokenDetailPage`: API error with stale data → stale data + error banner both visible simultaneously
- [ ] T-055 [GREEN] Implement `TokenDetailPage` in `apps/frontend/src/pages/TokenDetailPage.tsx` (network guard, `useTokenDetail` with polling, `selectedWalletId` state, conditional `WalletSelector`, `TokenDetailHeader`, `TokenStatsCards`, `TransactionTable`/empty state, error banner, skeleton)

---

## Phase 6: PositionHistoryPage + Routing

- [ ] T-056 [RED] Write failing test for `PositionHistoryPage`: renders one `CycleCard` per `PositionHistoryEntry`
- [ ] T-057 [RED] Write failing test for `PositionHistoryPage`: renders "No closed cycles yet" when `cycles.length === 0`
- [ ] T-058 [RED] Write failing test for `PositionHistoryPage`: BackLink href navigates to `/token/:contractAddress/:network`
- [ ] T-059 [GREEN] Implement `PositionHistoryPage` in `apps/frontend/src/pages/PositionHistoryPage.tsx` (one-shot `usePositionHistory`, inline `CycleCard` with `CycleBadge` + date range + `PnlDisplay`, empty state, BackLink)
- [ ] T-060 [CONFIG] Add two protected routes to `apps/frontend/src/routes/router.tsx`: `/token/:contractAddress/:network` → `TokenDetailPage`; `/token/:contractAddress/:network/history` → `PositionHistoryPage`
- [ ] T-061 [RED] Write failing test for `PortfolioRow`: symbol cell renders a `<Link>` navigating to `/token/:contractAddress/:network`
- [ ] T-062 [GREEN] Wrap symbol cell in `<Link>` in `apps/frontend/src/components/dashboard/PortfolioRow.tsx`
- [ ] T-063 [GREEN] Run full frontend test suite (`npx vitest run --project frontend`) — all tests green; run `npm run test:engine` — all backend tests green
