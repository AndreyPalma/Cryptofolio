# Verify Report — US-009-dashboard-ui

> **Date:** 2026-05-07  
> **Verifier:** sdd-verify  
> **Artifact store:** openspec

---

## Test Results

- **Frontend tests:** 133/133 passing (19 test files)
- **Typecheck:** PASS — 0 errors across backend and frontend workspaces

---

## Acceptance Criteria

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | Cards: Total Portfolio Value, Total Cost Basis, Total P&L ($), Total P&L (%) | ✅ | All four cards implemented with correct labels and formatting |
| 2 | Table columns: Logo \| Symbol \| Network/Source \| Balance \| Price \| Value \| WAC \| Cost Basis \| P&L ($) \| P&L (%) | ⚠️ | All 11 columns present; WAC column uses `formatCrypto` instead of `formatUsd` (see WARNING-1) |
| 3 | On-chain tokens grouped by (symbol, network) with wallet count badge | ✅ | `walletCount > 1` renders wallet-count pill; grouping is server-side per design |
| 4 | CEX_BINANCE badge yellow (#F0B90B) 'Binance', never merged with on-chain | ✅ | `bg-binance` class applied; `@theme` token `--color-binance: #F0B90B` defined |
| 5 | Expandable on-chain rows: per-wallet breakdown (Balance, WAC, P&L) | ✅ | `PortfolioRowExpanded` renders one sub-row per `walletBreakdown` entry with computed P&L |
| 6 | Expandable CEX rows: 'Binance Account' | ✅ | CEX path renders single sub-row labeled "Binance Account" |
| 7 | P&L green (#22C55E) positive, red (#EF4444) negative | ✅ | `text-pnl-positive` / `text-pnl-negative` via Tailwind `@theme` tokens |
| 8 | Auto-refresh 60s with 'Updated Xs ago' indicator | ✅ | `setInterval(60_000)` in `usePortfolio`; `useRelativeTime` ticks label every second |
| 9 | Balance = 0 tokens hidden | ✅ | `PortfolioTable` filters `parseFloat(totalBalance) === 0` before rendering rows |
| 10 | NEGATIVE: empty portfolio → 'Add your first wallet in Settings' | ⚠️ | Message present but text differs from exact spec wording (see WARNING-2) |

---

## Findings

### CRITICAL

None.

---

### WARNING

**WARNING-1: WAC column formatted as crypto quantity instead of USD price**

- **Spec:** `portfolio-table.md §5` — Column 8 (WAC) → `formatUsd(wacUsd)` — "always rendered"
- **Implementation:** `PortfolioRow.tsx:101` — `{formatCrypto(item.wacAggregated)}`
- **Impact:** WAC (Weighted Average Cost) is a price per token expressed in USD (e.g., "$2,000.00"), not a crypto quantity. Using `formatCrypto` renders it without a dollar sign and with crypto-style precision (e.g., "2000.000" instead of "$2,000.00"). The column reads incorrectly to users.
- **Fix:** Change `formatCrypto(item.wacAggregated)` to `formatUsd(item.wacAggregated)` in `PortfolioRow.tsx:101`.

---

**WARNING-2: Empty state text deviates from spec wording**

- **Spec:** `portfolio-table.md §4` — "Add your first wallet in Settings" as the message, styled as a navigable link to `/settings`
- **Spec:** `dashboard-page.md §4.5` — message: `"Add your first wallet in Settings"` with a `<Link to="/settings">`
- **Implementation:** `PortfolioTableEmptyState.tsx` — `<p>` with "Add your first wallet in Settings to start tracking your portfolio." + a separate `<Link>` button labeled "Go to Settings"
- **Impact:** Tests only check for `toContain("Add your first wallet")` which passes, but the exact spec message is not present. The navigable link is separate from the message text (spec says the message itself is the navigable link). Low UX impact, but diverges from spec.
- **Fix:** Change message text to "Add your first wallet in Settings" and either make the message a link or keep the separate CTA button — both approaches are acceptable per spec note in `summary-cards.md §4`.

---

**WARNING-3: Stale-data-with-error test case missing**

- **Tasks:** `tasks.md §6.2` — "Stale data state (second fetch fails, first succeeded) → old data visible + stale banner visible" is an explicitly required test
- **Implementation:** `dashboard-page.test.tsx` has 6 tests; this scenario is NOT among them
- **Impact:** The stale-while-error behavior is implemented correctly in `usePortfolio.ts` and in `DashboardPage.tsx` (stale prop passed to `RefreshIndicator`), but the integration test is missing. This is a TDD protocol gap — regression risk if the behavior is inadvertently removed.
- **Fix:** Add a 7th test to `dashboard-page.test.tsx` that: (1) resolves the first fetch, (2) rejects the second background fetch, (3) asserts old data still visible, (4) asserts stale indicator is shown.

---

**WARNING-4: EIP-55 checksum not implemented — CDN may 404 for some tokens**

- **Spec:** `token-logo.md §4.1` — "Where {checksumAddress} is the EIP-55 checksum form of contractAddress" and "Checksum computation: implemented as a pure client-side helper function"
- **Design:** `design.md §6` — explicitly selects `js-sha3` (3KB gz) and documents the EIP-55 algorithm
- **Implementation:** `checksum-address.ts` — `toChecksumAddress` returns `0x` + lowercase (no keccak256). `js-sha3` was NOT installed.
- **Impact:** Trust Wallet CDN URLs use EIP-55 checksum addresses as their path component. Per the design's own note: "Lowercase addresses 404. We compute checksum client-side." With lowercase normalization, CDN logos may 404 for many tokens, causing the letter-avatar fallback to always activate for on-chain tokens. The CDN integration is functionally broken for tokens that require checksum casing.
- **Documented deviation:** The apply-progress correctly documents this as an accepted deviation ("Trust Wallet CDN accepts lowercase addresses") — but this claim is **not verified** and contradicts the design's explicit rationale for adding js-sha3.
- **Fix (recommended):** Install `js-sha3` as a frontend dev dependency and implement true EIP-55 in `checksum-address.ts`. Update tests to use EIP-55 reference vectors.
- **Alternative:** Confirm empirically that Trust Wallet CDN accepts lowercase. If it does, close this as a non-issue and update the spec note.

---

**WARNING-5: `withSign` helper not exported from `format.ts`**

- **Spec:** `summary-cards.md §8` — defines `withSign(value: string | number, formatted: string): string` as a named export from `src/lib/format.ts`
- **Implementation:** No `withSign` export in `format.ts`. The sign prefix logic is inlined in `SummaryCards.tsx` (an IIFE that prepends `"+"` to the `formatUsd` result for positive values).
- **Impact:** Minor — the behavior is correct. But the spec explicitly calls for this as a testable export, and `summary-cards.test.tsx` does not test the sign-prefix logic in isolation.
- **Fix:** Extract sign logic into a named `withSign` export in `format.ts` and add a unit test for it in `format.test.ts`.

---

### SUGGESTION

**SUGGESTION-1: `priceUnavailable` rendering not covered for Current Value column**

- Spec: `portfolio-table.md §8` — when `priceUnavailable=true`, columns 6 (Current Price), 7 (Current Value), 10 (P&L $), and 11 (P&L %) all render "—"
- Implementation: `PortfolioRow.tsx:23-28` — `totalCurrentValue` check is `=== null` only, does NOT check `priceUnavailable`. When `priceUnavailable=true` but `totalCurrentValue` is not null, the value will display instead of "—".
- Severity: Low — backend likely returns `null` for `totalCurrentValue` when `priceUnavailable`, but the frontend guard is incomplete per spec.
- Fix: Change value cell condition to: `item.priceUnavailable === true || item.totalCurrentValue === null`.

**SUGGESTION-2: `SkeletonRow` component imported but unused in skeleton**

- `DashboardPage.tsx` imports `SkeletonRow` but `DashboardSkeleton` uses an inline `RowSkeleton` div-based component instead.
- The `SkeletonRow` component renders `<tr>` elements designed for `<tbody>` context. The `DashboardSkeleton` uses `<div>`-based skeletons (intentional deviation per apply-progress).
- The import is unused — TypeScript/lint should have caught this. Verify it does not generate a lint warning.

**SUGGESTION-3: No test for `DashboardPage` stale-data inline banner wording**

- Spec §4.4: stale banner text should include "Last update failed — showing data from Xs ago. [Retry]"
- The stale state is exposed via `RefreshIndicator` `stale` prop (shows `[Retry]` button), not a separate dismissible banner as spec §4.4 describes.
- Minor wording gap: RefreshIndicator shows `relativeTime` + `[Retry]` when stale, but does not render "Last update failed" text. The UX is functional but the exact prescribed message differs from spec §4.4.

---

## Verdict

**PASS WITH WARNINGS**

The implementation is functionally complete: 133/133 tests pass, typecheck is clean, all major acceptance criteria are met, and the domain invariant (ETH on-chain ≠ ETH CEX) is codified in tests and enforced by row key strategy. Three of the five warnings represent spec deviations that should be fixed before shipping (WAC format, stale test, EIP-55), while two are minor (withSign export, empty state text). No critical blockers.
