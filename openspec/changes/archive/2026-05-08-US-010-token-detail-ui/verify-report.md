# US-010 Verify Report

## Test Results

- **Frontend:** 196 tests passing / 0 failing (30 test files)
- **Backend engine:** 236 tests passing / 0 failing (1 pre-existing suite load failure — `transaction.test.ts` references missing `tests/e2e/db/factories.js`, introduced in commit `4f29440` before US-010; unrelated to this story)

## Acceptance Criteria Status

| AC | Status | Notes |
|----|--------|-------|
| AC-1 | ✅ | Header renders `TokenLogo`, `symbol`, `NetworkBadge`, `CycleBadge ("CYCLE #N")`; `TokenStatsCards` shows Balance, Current Price, Current Value, WAC, Cost Basis, P&L (6 cards). All show `—` when `position === null`. `priceUnavailable` correctly hides price/value/P&L. |
| AC-2 | ✅ | `WalletSelector` rendered only when `token.network !== "CEX_BINANCE"`. Confirmed by `TokenDetailHeader.tsx` guard and T-050a/T-050b tests. |
| AC-3 | ✅ | 9 columns present: Date, Type, Source, Amount, Price at Time, Value at Time, Current Price, Current Value, P&L. All headers confirmed in `SC-TT-01`. |
| AC-4 | ⚠️ | Badge colors implemented. **Spec says `-700` shades** (`bg-green-700`, `bg-red-700`, `bg-blue-700`, `bg-orange-700`, `bg-gray-700`). **Design and implementation use `-900` shades** (`bg-green-900`, `bg-red-900`, etc.). TRANSFER_IN uses `bg-purple-900` (not `bg-gray-700` as spec says). **No functional impact — tests check color family only** (`bg-green`, `bg-red`, etc.). Spec vs design discrepancy, design wins. |
| AC-5 | ✅ | `TypeBadge` sets `title="Auto-detected swap from TX ${txHash}"` for SWAP_IN/SWAP_OUT on-chain transactions. Confirmed by SC-TB-07 and SC-TT-03. |
| AC-6 | ✅ | `TypeBadge` sets `title="Binance Convert #${cexTradeId}"` for SWAP_IN/SWAP_OUT Binance. Confirmed by SC-TB-07b and SC-TT-04. |
| AC-7 | ✅ | `CostSourceBadge` renders "Cost inherited (wallet)" with `bg-green-900 text-green-300` for `INHERITED` + `ONCHAIN`. SC-CSB-01 and SC-TT-05 pass. |
| AC-8 | ✅ | `CostSourceBadge` renders "Cost inherited (Binance)" for `INHERITED` + `BINANCE`. SC-CSB-02 passes. |
| AC-9 | ✅ | `CostSourceBadge` renders "Manual cost" with gray classes for `MANUAL`. SC-CSB-03 passes. |
| AC-10 | ✅ | `SourceBadge` receives `title="Withdrawal tx: ${txHash}"` for `TRANSFER_OUT` + `BINANCE` + `txHash !== null`. SC-TT-06 passes. |
| AC-11 | ✅ | SELL/SWAP_OUT P&L cell has class `italic` applied. `realizedPnlUsd` present in `OutboundPnlSchema` and populated by `computePnl`. SC-TT-07 passes. |
| AC-12 | ✅ | "View N closed cycles" link shown when `closedCycleCount > 0`; hidden when `= 0`. Navigates to `/token/:contractAddress/:network/history`. SC-TDH-04 and SC-TDH-05 pass. |
| AC-13 | ✅ | "No transactions recorded yet" rendered when `transactions.length === 0`. NEGATIVE-TT-01 and T-053 pass. |

## CRITICAL Issues

None.

## WARNINGS

1. **TypeBadge labels for TRANSFER_IN/TRANSFER_OUT**: Spec (§4.6) says labels should be "TRANSFER IN" / "TRANSFER OUT". Design (§4.5) and implementation use "XFER IN" / "XFER OUT". Tests assert on `XFER IN`/`XFER OUT`, so they pass. This is a spec vs design divergence — if the product requires the full label, the design and implementation need updating. Low risk for V1.

2. **TypeBadge color shade**: Spec says `bg-green-700` / `bg-red-700` / `bg-blue-700` / `bg-orange-700` for BUY/SELL/SWAP_IN/SWAP_OUT; TRANSFER_IN spec says `bg-gray-700`. Design and implementation use `-900` variants and `bg-purple-900` for TRANSFER_IN. Visual contrast difference only. Tests do not pin the exact shade so all pass.

3. **`act(...)` warnings in position-history-page.test.tsx and login-page.test.tsx**: React state updates not wrapped in `act()`. Tests pass but emit runtime warnings. Pre-existing issue, not introduced by US-010.

4. **`CostSourceBadge` not in the table row itself**: TRANSFER_IN cost badges render in a separate `<div>` below the table (not in a table cell). This is a design divergence — the spec says "inline badge column" (§4.5 note). Functionally the badge renders and tests pass, but it breaks the visual table alignment. If product requires the badge to be inside a table cell (for proper row alignment), this needs a fix.

## SUGGESTIONS

1. Consider adding `walletAddress` to `WalletBreakdown` so `WalletSelector` can show truncated `0x…last4` for wallets without labels (currently falls back to first 6 chars of `walletId` UUID, which is not a wallet address). The spec says truncate address to `0x…last4` — but `walletBreakdown` doesn't carry the address field. Low impact for V1 since labeled wallets are the common case.

2. The `usePositionHistory` hook is called unconditionally inside `TokenDetailPage`, meaning an extra network request fires on every token detail load regardless of whether there are closed cycles. A lazy approach (fetch only when the "View closed cycles" link is visible) would reduce unnecessary requests. Acceptable for V1.

## TypeScript

No new TypeScript errors. `npm run typecheck` exits cleanly with 0 errors for both backend and frontend workspaces.

## Verdict: PASS WITH WARNINGS

All 13 acceptance criteria are implemented and tested. Both test suites are green (196 frontend + 236 backend). The backend suite's one failure is a pre-existing load error in `transaction.test.ts` (missing E2E factory file) with zero tests inside — not caused by US-010. Warnings are cosmetic/minor and do not block the story.
