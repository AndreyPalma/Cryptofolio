# Apply Progress: US-009 — Dashboard principal UI

> **Date:** 2026-05-07  
> **Mode:** Strict TDD — RED → GREEN  
> **Test runner:** `npx vitest run --project frontend`

---

## Phase Status

| Phase | Status | Notes |
|-------|--------|-------|
| 1 — Types & API client extension | ✅ done | `portfolio.ts` types created; `apiClient.get<PortfolioResponse>` used directly (already existed) |
| 2 — Utility functions (RED → GREEN) | ✅ done | format.ts, checksum-address.ts, token-logo-utils.ts |
| 3 — `usePortfolio` hook (RED → GREEN) | ✅ done | useRelativeTime.ts, usePortfolio.ts |
| 4 — Presentational components (RED → GREEN) | ✅ done | PnlDisplay, NetworkBadge, TokenLogo, SummaryCard, SummaryCards, SkeletonRow |
| 5 — PortfolioTable (RED → GREEN) | ✅ done | PortfolioRow, PortfolioRowExpanded, PortfolioTable, PortfolioTableEmptyState |
| 6 — DashboardPage integration | ✅ done | DashboardPage.tsx, router.tsx updated, DashboardPlaceholder.tsx deleted |
| 7 — Tailwind theme tokens | ✅ done | @theme block added to index.css |
| 8 — Typecheck & final verification | ✅ done | 0 typecheck errors, 133/133 tests passing, 0 frontend lint errors |

---

## Files Created

### Source files
- `apps/frontend/src/types/portfolio.ts` — Domain types: DecimalString, Network, SourceType, WalletBreakdown, PortfolioItem, PortfolioSummary, PortfolioResponse
- `apps/frontend/src/lib/format.ts` — formatUsd, formatPct, formatCrypto
- `apps/frontend/src/lib/checksum-address.ts` — toChecksumAddress (lowercase normalization, no js-sha3)
- `apps/frontend/src/lib/token-logo-utils.ts` — simpleHash, computeAvatarColor, networkToChain
- `apps/frontend/src/hooks/useRelativeTime.ts` — Ticking relative-time hook
- `apps/frontend/src/hooks/usePortfolio.ts` — Data-fetching hook with polling, tab visibility, stale-while-error
- `apps/frontend/src/components/dashboard/PnlDisplay.tsx`
- `apps/frontend/src/components/dashboard/NetworkBadge.tsx`
- `apps/frontend/src/components/dashboard/TokenLogo.tsx` + `trustWalletUrl` export
- `apps/frontend/src/components/dashboard/SummaryCard.tsx`
- `apps/frontend/src/components/dashboard/SummaryCards.tsx`
- `apps/frontend/src/components/dashboard/SkeletonRow.tsx`
- `apps/frontend/src/components/dashboard/PortfolioRowExpanded.tsx`
- `apps/frontend/src/components/dashboard/PortfolioRow.tsx`
- `apps/frontend/src/components/dashboard/PortfolioTable.tsx`
- `apps/frontend/src/components/dashboard/PortfolioTableEmptyState.tsx`
- `apps/frontend/src/components/dashboard/RefreshIndicator.tsx`
- `apps/frontend/src/pages/DashboardPage.tsx`

### Test files
- `apps/frontend/tests/format.test.ts`
- `apps/frontend/tests/checksum-address.test.ts`
- `apps/frontend/tests/token-logo-utils.test.ts`
- `apps/frontend/tests/use-relative-time.test.ts`
- `apps/frontend/tests/use-portfolio.test.ts`
- `apps/frontend/tests/pnl-display.test.tsx`
- `apps/frontend/tests/network-badge.test.tsx`
- `apps/frontend/tests/token-logo.test.tsx`
- `apps/frontend/tests/summary-card.test.tsx`
- `apps/frontend/tests/summary-cards.test.tsx`
- `apps/frontend/tests/skeleton-row.test.tsx`
- `apps/frontend/tests/portfolio-row-expanded.test.tsx`
- `apps/frontend/tests/portfolio-row.test.tsx`
- `apps/frontend/tests/portfolio-table.test.tsx`
- `apps/frontend/tests/dashboard-page.test.tsx`

---

## Files Modified

- `apps/frontend/src/routes/router.tsx` — Replaced DashboardPlaceholder with DashboardPage
- `apps/frontend/src/index.css` — Added @theme block with binance/pnl-positive/pnl-negative tokens

## Files Deleted

- `apps/frontend/src/pages/DashboardPlaceholder.tsx` — Superseded by DashboardPage

---

## Test Results

```
Test Files  19 passed (19)
Tests       133 passed (133)
```

All 133 tests green, including 118 pre-existing tests (api-client, auth-context, login-page, protected-route) and 15 new test files.

---

## Deviations from Design/Tasks

### js-sha3 not installed (expected deviation)
- **Task 2.4** planned to install `js-sha3` for EIP-55 checksum. Per the task brief: "Do NOT add it as a dependency. Instead, implement a simple inline hex checksum or skip the checksum (just use `contractAddress.toLowerCase()`)."
- **Solution**: `toChecksumAddress` normalizes to lowercase `0x` prefix. Trust Wallet CDN URLs use lowercase addresses. Tests updated to match lowercase normalization semantics.

### DashboardSkeleton uses divs, not table
- The spec said "do NOT render `<table>` in skeleton state". The original implementation used `<table>` in the skeleton, which failed the test. Changed to `<div>`-based skeleton rows to keep the portfolio `<table>` as the reliable signal for "data loaded".

### `token-logo-utils.ts` vs task 2.5-2.6
- The task referenced `computeAvatarColor` returning a hex color from a fixed palette. Implementation matches — 8-color hex palette (no HSL), deterministic via djb2 hash. The design mentioned HSL but the task spec mentioned hex palette; hex palette was implemented for predictability in tests.

### usePortfolio: `visibilityState` vs `document.hidden`
- Changed `document.hidden` check to `document.visibilityState === 'hidden'` for jsdom test compatibility. Semantically equivalent in browsers.

---

## Typecheck Result

```
✅ PASS — 0 errors across all frontend files
```

## Lint Result

```
✅ PASS — 0 errors in apps/frontend/**
(Pre-existing backend lint errors in binance-sync.ts, on-chain-sync.ts, portfolio.ts, sync.ts — not introduced by this change)
```

## Domain Invariant Verification

`apps/frontend/tests/portfolio-table.test.tsx` includes:
- Fixture with `(symbol='ETH', network='ETH', sourceType='ON_CHAIN')` AND `(symbol='ETH', network='CEX_BINANCE', sourceType='CEX')`
- Test: "domain invariant: ETH on-chain and ETH CEX_BINANCE render as two distinct rows" — ✅ GREEN
- Row key strategy: `${item.network}-${item.contractAddress ?? item.symbol}` ensures distinct keys

## React 19 / Tailwind v4 Compliance Verification

- ✅ No `useMemo` or `useCallback` anywhere
- ✅ No `forwardRef` anywhere  
- ✅ No default exports in any new file
- ✅ `style={{}}` only for letter-avatar `backgroundColor` (dynamic computed value)
- ✅ `cn()` helper used for all conditional class composition
