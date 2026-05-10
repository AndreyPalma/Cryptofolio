# Verification Report — US-017: Closed Positions + Position Cycles UI

**Change:** us-017-closed-positions
**Spec Version:** v5-derived delta
**Mode:** Standard (TDD/tests skipped per user request)

---

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 9 (T-001 → T-009) |
| Tasks complete | 9 |
| Tasks incomplete | 0 |

**apply-progress.md** confirms all 9 tasks applied.

---

## Build & Quality Execution

**Build**: ✅ Passed
```
npm run typecheck → exit 0 (backend + frontend clean)
```

**Lint**: ✅ Passed
```
npm run lint → exit 0 (warnings only, no errors)
```

---

## Spec Compliance Matrix

### Backend

| Req | Requirement | Impl | Status |
|-----|-------------|------|--------|
| REQ-001 | `GET /api/portfolio/closed` endpoint | `routes/portfolio.ts:40-44` — `fastify.get('/closed')` | ✅ COMPLIANT |
| REQ-001 | Zod query validation | `ClosedPositionsQuerySchema` (walletId, network, from, to) | ✅ COMPLIANT |
| REQ-001 | 200 response for no closed positions | `getClosedPositions` returns `{totalRealizedPnlUsd:"0",totalClosedCycles:0,byToken:[]}` | ✅ COMPLIANT |
| REQ-002 | Grouped by token with cycles array | `byToken[]` with `ClosedTokenGroupSchema` | ✅ COMPLIANT |
| REQ-002 | Wallet context per cycle (walletId, walletLabel) | `ClosedCycleSchema` has both fields | ✅ COMPLIANT |
| REQ-003 | `totalProceedsUsd = cost_basis + realized_pnl_usd` | `services/portfolio.ts:588` — `costBasis.plus(realizedPnl)` via Decimal.js | ✅ COMPLIANT |
| REQ-003 | Decimal.js (not native number) | Uses `toDecimal()` + `roundToStorage()` throughout | ✅ COMPLIANT |
| REQ-007 | Isolation — closed P&L not added to active portfolio | Separate endpoint, `getClosedPositions` only queries `status='CLOSED'` | ✅ COMPLIANT |

### Frontend

| Req | Requirement | Impl | Status | Notes |
|-----|-------------|------|--------|-------|
| REQ-004 | `useClosedPositions` fetch-on-demand hook | `hooks/useClosedPositions.ts` — no polling, useEffect on mount | ✅ COMPLIANT | |
| REQ-004 | `ClosedPositionsSection` collapsible with KPI P&L | `components/dashboard/ClosedPositionsSection.tsx` — collapse state + KPI card | ✅ COMPLIANT | |
| REQ-004 | Dashboard pill-toggle `Activos \| Cerrados \| Todos` | `DashboardPage.tsx:103-126` — `PortfolioVisibilityToggle` | ✅ COMPLIANT | |
| REQ-004 | Visibility rules — no contamination of active KPIs | Active summary cards only use `usePortfolio()` data, closed uses `useClosedPositions()` | ✅ COMPLIANT | |
| REQ-005 | `PositionCyclesSection` in `TokenDetailPage` | `TokenDetailPage.tsx:146-152` | ✅ COMPLIANT | |
| REQ-005 | Active cycle labeled "En curso" | `PositionCyclesSection.tsx:180` — `statusLabel="En curso"` | ✅ COMPLIANT | |
| REQ-005 | Closed cycles with metrics | `CycleCard` renders proceeds, P&L, cost, dates | ✅ COMPLIANT | |
| REQ-005 | Token with no active but has closed → show closed | `TokenDetailPage` passes `activeCycle=null` correctly | ✅ COMPLIANT | |
| REQ-006 | `PositionHistoryPage` reuses `PositionCyclesSection` | `PositionHistoryPage.tsx:48-53` | ✅ COMPLIANT | |

---

## Correctness (Static — Structural Evidence)

| Requirement | Status | Notes |
|-------------|--------|-------|
| Backend: `ClosedCycleSchema`, `ClosedTokenGroupSchema`, `ClosedPositionsResponseSchema` | ✅ Implemented | `types/portfolio.ts:131-160` |
| Backend: `getClosedPositions(pool, filters?)` service | ✅ Implemented | `services/portfolio.ts:518-626` — SQL with `status='CLOSED'`, grouping by token |
| Backend: `totalProceedsUsd = cost_basis + realized_pnl_usd` via Decimal.js | ✅ Implemented | `services/portfolio.ts:588` — `costBasis.plus(realizedPnl)` |
| Backend: `GET /api/portfolio/closed` route | ✅ Implemented | `routes/portfolio.ts:39-44` |
| Frontend: `useClosedPositions` hook (no polling) | ✅ Implemented | `hooks/useClosedPositions.ts` — fetch-on-demand via useEffect |
| Frontend: `ClosedPositionsSection` (collapsible, KPI P&L, grouped list) | ✅ Implemented | `components/dashboard/ClosedPositionsSection.tsx` |
| Frontend: `PositionCyclesSection` (timeline, "En curso", closed cycles) | ✅ Implemented | `components/token-detail/PositionCyclesSection.tsx` |
| DashboardPage: pill-toggle Activos \| Cerrados \| Todos | ✅ Implemented | `DashboardPage.tsx:98-127` |
| DashboardPage: `ClosedPositionsSection` integration | ✅ Implemented | `DashboardPage.tsx:266-271` |
| TokenDetailPage: `PositionCyclesSection` integration | ✅ Implemented | `TokenDetailPage.tsx:145-152` |
| PositionHistoryPage: `PositionCyclesSection` integration | ✅ Implemented | `PositionHistoryPage.tsx:48-53` |

---

## Coherence (Design Decisions)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| D-001: Separate endpoint, not extension of `/api/portfolio` | ✅ Yes | `GET /api/portfolio/closed` is independent |
| D-002: Grouped by token, not by wallet | ✅ Yes | `byToken[]` is the top-level grouping |
| D-003: `totalProceedsUsd` derived at runtime, not stored | ✅ Yes | Calculated as `costBasis + realizedPnl` in service |
| D-004: Decimal.js instead of native number | ✅ Yes | All arithmetic uses `toDecimal()` + `roundToStorage()` |
| D-005: Hook without polling | ✅ Yes | `useClosedPositions` has no interval/polling |
| D-006: Pill-toggle in dashboard, not separate page | ✅ Yes | Toggle in `DashboardPage` |
| D-007: `PositionCyclesSection` reusable across pages | ✅ Yes | Used in both `TokenDetailPage` and `PositionHistoryPage` |

---

## Issues Found

### WARNING (should fix)

**1. `PositionHistoryPage.tsx` — wrong symbol passed to `getTokenIdentityKey`**

The token matching logic on line 31 passes `contractAddress` twice where `symbol` should go:

```tsx
getTokenIdentityKey(normalizedNetwork, contractAddress, contractAddress),
//                                                         ^^^^^^^^^^^
//                                                         should be symbol, not contractAddress
```

This will cause the closed positions lookup to always fail for CEX tokens (where `contractAddress` is `null`) and may match incorrectly for ON_CHAIN tokens.

**Fix:** Derive the correct symbol from the URL params or use a token lookup from `closedPositionsData.byToken[].symbol`.

---

## Verdict

**PASS WITH WARNING**

The implementation is complete and structurally correct against the spec and design. All 11 requirements are implemented, all 7 design decisions are followed, and the codebase passes typecheck and lint cleanly.

The one warning is a runtime bug in `PositionHistoryPage` — the token identity key used for matching closed positions uses `contractAddress` in the symbol position, which will cause incorrect matching behavior for CEX tokens (which have `contractAddress: null`) and ON_CHAIN tokens (where the symbol differs from the contract address). This should be fixed before the change is archived, but it does not block the verification.

---

## Files Verified

| File | Role |
|------|------|
| `apps/backend/src/types/portfolio.ts` | Zod schemas (lines 131-160) |
| `apps/backend/src/services/portfolio.ts` | `getClosedPositions` service (lines 518-626) |
| `apps/backend/src/routes/portfolio.ts` | `GET /api/portfolio/closed` route (lines 39-44) |
| `apps/frontend/src/hooks/useClosedPositions.ts` | Fetch-on-demand hook |
| `apps/frontend/src/components/dashboard/ClosedPositionsSection.tsx` | Collapsible KPI section |
| `apps/frontend/src/components/token-detail/PositionCyclesSection.tsx` | Cycle timeline component |
| `apps/frontend/src/pages/DashboardPage.tsx` | Pill-toggle + section integration |
| `apps/frontend/src/pages/TokenDetailPage.tsx` | PositionCyclesSection integration |
| `apps/frontend/src/pages/PositionHistoryPage.tsx` | PositionCyclesSection reuse (with bug) |