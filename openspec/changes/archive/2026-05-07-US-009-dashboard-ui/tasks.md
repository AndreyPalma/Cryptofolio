# Tasks: US-009 — Dashboard principal UI

> **Change:** `US-009-dashboard-ui`
> **Phase:** sdd-tasks
> **Date:** 2026-05-07
> **Mode:** Strict TDD — RED → GREEN → TYPECHECK on every phase
> **Test runner:** `npm run test:engine` (vitest, pure unit)

---

## Phase 1 — Types & API client extension

- [ ] 1.1 [GREEN] Create `apps/frontend/src/types/portfolio.ts` with all domain types:
  - `DecimalString` type alias
  - `NETWORK` as-const object + `Network` extracted type (`ETH | BSC | CEX_BINANCE`)
  - `SOURCE_TYPE` as-const object + `SourceType` extracted type (`ON_CHAIN | CEX`)
  - `WalletBreakdown` interface (`walletId`, `label`, `balance`, `wac`)
  - `PortfolioItem` interface (all fields from design §2 — use `DecimalString` for numeric fields, never `number`)
  - `PortfolioSummary` interface (`totalValueUsd`, `totalCostBasis`, `totalPnlUsd`, `totalPnlPct`)
  - `PortfolioResponse` interface (flat shape: summary fields + `tokens: PortfolioItem[]`)
  - Export all as named exports; no default exports

- [ ] 1.2 [GREEN] Add `getPortfolio()` method to `apps/frontend/src/lib/api-client.ts` (or wherever the existing api client lives):
  - Returns `Promise<PortfolioResponse>`
  - Calls `GET /api/portfolio` with `credentials: 'include'`
  - Throws `UnauthorizedError` on 401 (re-use existing pattern in api-client)
  - No mock, no stub — this is real integration code

- [ ] 1.3 [CHECK] Run `npm run typecheck` — no errors in the two new/modified files

---

## Phase 2 — Utility functions (RED → GREEN)

- [ ] 2.1 [RED] Write `apps/frontend/tests/format.test.ts` with failing tests for all format helpers:
  - `formatUsd(null)` → `"—"`
  - `formatUsd(undefined)` → `"—"` (edge: TypeScript won't allow it, but test defensive runtime path)
  - `formatUsd("NaN")` → `"—"`
  - `formatUsd("0.00")` → `"$0.00"`
  - `formatUsd("12345.67")` → `"$12,345.67"`
  - `formatUsd(-500)` → `"-$500.00"`
  - `formatPct(null)` → `"—"`
  - `formatPct("NaN")` → `"—"`
  - `formatPct("0.00")` → `"0.00%"` (no sign prefix for zero)
  - `formatPct("23.4567")` → `"+23.46%"`
  - `formatPct("-5.0000")` → `"-5.00%"`
  - `formatCrypto(null)` → `"—"`
  - `formatCrypto("0.00000001")` → non-scientific notation string
  - `formatCrypto("1.23456789123")` → at most 8 significant figures, no trailing zeros

- [ ] 2.2 [GREEN] Implement `apps/frontend/src/lib/format.ts`:
  - `formatUsd(value: DecimalString | number | null): string` — uses `Intl.NumberFormat` with 2 decimal places
  - `formatPct(value: DecimalString | number | null): string` — `toFixed(2)`, prefixes `"+"` for positive values
  - `formatCrypto(value: DecimalString | number | null): string` — 8 significant figures, no scientific notation, trims trailing zeros
  - All three return `"—"` for null, undefined, or NaN inputs
  - Exported as named exports only

- [ ] 2.3 [RED] Write `apps/frontend/tests/checksum-address.test.ts` with failing tests:
  - EIP-55 reference vector 1: `"0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"` → same (already checksummed)
  - EIP-55 reference vector 2: `"0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359"` (lowercase input) → `"0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359"`
  - All-lowercase input → checksummed output (at least 2 known EIP-55 vectors)
  - Input without `0x` prefix → output with `0x` prefix
  - Empty string → throws or returns `"0x"` without crashing

- [ ] 2.4 [GREEN] Implement `apps/frontend/src/lib/checksum-address.ts`:
  - Install `js-sha3` if not present: `npm install js-sha3` (frontend workspace)
  - `import { keccak_256 } from "js-sha3"`
  - `export function toChecksumAddress(address: string): string` — EIP-55 algorithm per design §6
  - If input is empty or throws, return input unchanged (letter-avatar fallback handles it in TokenLogo)

- [ ] 2.5 [RED] Write `apps/frontend/tests/token-logo-utils.test.ts` with failing tests for exported utilities:
  - `computeAvatarColor("ETH")` returns a valid CSS color string (hex or hsl)
  - `computeAvatarColor("ETH")` === `computeAvatarColor("ETH")` (deterministic across calls)
  - `computeAvatarColor("ETH")` !== `computeAvatarColor("BNB")` (different symbols → different colors, probabilistic)
  - `computeAvatarColor("")` does not throw and returns a valid string
  - `networkToChain("ETH")` → `"ethereum"`
  - `networkToChain("BSC")` → `"smartchain"`

- [ ] 2.6 [GREEN] Implement `apps/frontend/src/lib/token-logo-utils.ts`:
  - `simpleHash(s: string): number` — deterministic numeric hash (djb2 variant from design §6)
  - `computeAvatarColor(symbol: string): string` — hash % palette size, returns CSS hex from an 8-color palette (indigo-500, violet-500, teal-500, rose-500, amber-500, cyan-500, emerald-500, orange-500); excludes #F0B90B
  - `networkToChain(network: 'ETH' | 'BSC'): 'ethereum' | 'smartchain'` — simple switch
  - All exported as named exports

- [ ] 2.7 [CHECK] Run `npm run typecheck` — no errors; run `npm run test:engine` — all Phase 2 tests pass

---

## Phase 3 — `usePortfolio` hook (RED → GREEN)

- [ ] 3.1 [RED] Write `apps/frontend/tests/use-relative-time.test.ts` with failing tests:
  - `date === null` → label is `"Never updated"`
  - 5 seconds elapsed → `"Updated 5s ago"`
  - 59 seconds elapsed → `"Updated 59s ago"`
  - 60 seconds elapsed → `"Updated 1m ago"`
  - 3599 seconds elapsed → `"Updated 59m ago"`
  - 3600 seconds elapsed → `"Updated 1h+ ago"`
  - Counter updates every second (use `vi.useFakeTimers()` + `vi.advanceTimersByTime(1000)`)
  - Cleanup: advancing time after unmount does not throw or call setState

- [ ] 3.2 [GREEN] Implement `apps/frontend/src/hooks/useRelativeTime.ts`:
  - `export function useRelativeTime(date: Date | null): { secondsSinceUpdate: number | null; label: string }`
  - Uses `setInterval(1_000)` internally, clears on unmount and when `date` changes
  - Label rules from spec §6: null → `"Never updated"`, 0-59s → `"Updated Xs ago"`, 60-3599s → `"Updated Xm ago"`, ≥3600s → `"Updated 1h+ ago"`

- [ ] 3.3 [RED] Write `apps/frontend/tests/use-portfolio.test.ts` with failing tests:
  - Mock `fetch` globally via `vi.stubGlobal('fetch', mockFetch)`
  - Initial mount → `loading: true`, `data: null`
  - After successful fetch resolves → `loading: false`, `data` populated, `lastUpdated` set to a Date
  - Background refetch (60s tick via `vi.useFakeTimers()`) → `loading` stays `false` throughout; `data` updates
  - Failed initial fetch → `loading: false`, `error` set, `data` remains null
  - Failed background refetch (stale data) → `error` set, previous `data` retained (not cleared)
  - Tab hidden (`document.visibilityState = 'hidden'`, dispatch `visibilitychange`) → 60s tick does NOT trigger a fetch
  - Tab visible again → immediate refetch fires, interval re-arms
  - Unmount before fetch resolves → no state update, no React "unmounted component" warning
  - `refresh()` called while fetch in-flight → second fetch does NOT fire (tracks `isFetching` ref)
  - Unmount while timer is active → no further fetches after unmount (interval cleared)

- [ ] 3.4 [GREEN] Implement `apps/frontend/src/hooks/usePortfolio.ts`:
  - State: `data`, `loading`, `error`, `lastUpdated`, `isRefetching` (two-flag pattern from design §3)
  - Refs: `isMountedRef`, `pollIntervalRef`, `isFetchingRef`
  - `refresh()`: if `data === null` set `loading=true`, else `isRefetching=true`; call `apiClient.get<PortfolioResponse>('/api/portfolio')`; guard all state updates with `isMountedRef.current`
  - `setInterval(refresh, 60_000)` on mount; clear in `useEffect` cleanup
  - `visibilitychange` listener: pause interval on hide, call `refresh()` + re-arm on show
  - 401 (`UnauthorizedError`) → rethrow (apiClient already redirected); `isMountedRef` guard prevents setState

- [ ] 3.5 [CHECK] Run `npm run typecheck` and `npm run test:engine` — all Phase 3 tests pass

---

## Phase 4 — Presentational components (RED → GREEN)

- [ ] 4.1 [RED] Write `apps/frontend/tests/pnl-display.test.tsx` with failing tests:
  - `value === null` → renders `"—"` with neutral/gray styling
  - `value = "2345.67"`, `kind = "usd"` → renders `"$2,345.67"` with `text-pnl-positive` class
  - `value = "-500.00"`, `kind = "usd"` → renders `"-$500.00"` with `text-pnl-negative` class
  - `value = "0.00"`, `kind = "usd"` → renders `"$0.00"` with neutral class (not positive, not negative)
  - `value = "23.46"`, `kind = "pct"` → renders `"+23.46%"` with `text-pnl-positive` class
  - `value = 1500` (number), `kind = "usd"` → renders `"$1,500.00"` with `text-pnl-positive` class

- [ ] 4.2 [GREEN] Implement `apps/frontend/src/components/dashboard/PnlDisplay.tsx`:
  - Props: `{ value: DecimalString | number | null; kind: "usd" | "pct" }`
  - `value === null` → `<span class="text-gray-400">—</span>`
  - Positive → `text-pnl-positive`; negative → `text-pnl-negative`; zero → `text-gray-300`
  - Format via `formatUsd` or `formatPct` depending on `kind`
  - Named export only

- [ ] 4.3 [RED] Write `apps/frontend/tests/network-badge.test.tsx` with failing tests:
  - `network="ETH"` → renders text `"Ethereum"`, does NOT contain `"Binance"` or `"BSC"`
  - `network="BSC"` → renders text `"BSC"`, does NOT contain `"Ethereum"` or `"Binance"`
  - `network="CEX_BINANCE"` → renders text `"Binance"`, has class `bg-binance` (or verifiable yellow styling)
  - `network="ETH"` → does NOT have `bg-binance` class

- [ ] 4.4 [GREEN] Implement `apps/frontend/src/components/dashboard/NetworkBadge.tsx`:
  - Props: `{ network: Network; sourceType?: SourceType }`
  - ETH → `"Ethereum"` pill, `bg-gray-700 text-gray-100`
  - BSC → `"BSC"` pill, `bg-gray-700 text-gray-100`
  - CEX_BINANCE → `"Binance"` pill, `bg-binance text-black`
  - Named export only

- [ ] 4.5 [RED] Write `apps/frontend/tests/token-logo.test.tsx` with failing tests:
  - `network="ETH"`, `contractAddress="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"` → renders `<img>` with URL containing `"ethereum"` and the checksum address
  - `network="BSC"`, `contractAddress="0x..."` → URL contains `"smartchain"`
  - `network="CEX_BINANCE"` → NO `<img>` rendered; renders letter-avatar instead
  - `network="ETH"`, `contractAddress=null` → renders letter-avatar (no CDN attempt)
  - `onError` fires on the img → letter-avatar replaces `<img>` (simulate via `fireEvent.error(img)`)
  - `symbol="ETH"` → letter-avatar shows `"E"`
  - `symbol=""` → letter-avatar shows `"?"` (no crash)
  - `size="sm"` → container has `w-6 h-6` (or equivalent 24px class)
  - `size="lg"` → container has `w-10 h-10` (or equivalent 40px class)

- [ ] 4.6 [GREEN] Implement `apps/frontend/src/components/dashboard/TokenLogo.tsx`:
  - Props: `{ symbol: string; contractAddress: string | null; network: Network; sourceType?: SourceType; size?: 'sm' | 'md' | 'lg' }`
  - Rendering path decided by `network` (not `contractAddress`): CEX_BINANCE → letter-avatar immediately; ETH/BSC → CDN img with `onError` fallback
  - Local state: `const [useFallback, setUseFallback] = useState(false)`
  - CDN URL via `trustWalletUrl` helper (design §6); `toChecksumAddress` from `checksum-address.ts`
  - If `contractAddress === null` → render letter-avatar immediately
  - Letter-avatar: `computeAvatarColor(symbol)` for bg (from `token-logo-utils.ts`); first letter uppercase or `"?"`; `style={{ backgroundColor }}` is the only `style={{}}` permitted
  - Size classes: `sm → w-6 h-6`, `md → w-8 h-8`, `lg → w-10 h-10`
  - Named export only; also export `trustWalletUrl` as named export for test access

- [ ] 4.7 [RED] Write `apps/frontend/tests/summary-card.test.tsx` with failing tests for `SummaryCard`:
  - Renders `label` text
  - Renders `value` text
  - `pnlSign="positive"` → value element has `text-pnl-positive` class
  - `pnlSign="negative"` → value element has `text-pnl-negative` class
  - `pnlSign="neutral"` or absent → value element has `text-white` class (or no P&L class)

- [ ] 4.8 [GREEN] Implement `apps/frontend/src/components/dashboard/SummaryCard.tsx`:
  - Props: `{ label: string; value: string; pnlSign?: "positive" | "negative" | "neutral"; testId?: string }`
  - `<article data-testid={testId}>` with `bg-gray-900 rounded-lg p-4`
  - Label `<span class="text-gray-400 text-sm">`; value `<span class="text-2xl font-semibold {colorClass}">`
  - Named export only

- [ ] 4.9 [RED] Write `apps/frontend/tests/summary-cards.test.tsx` with failing tests for `SummaryCards`:
  - Renders "Total Portfolio Value" card with `formatUsd(totalValueUsd)` value
  - Renders "Total Cost Basis" card with `formatUsd(totalCostBasis)` value
  - Renders "Total P&L" card with sign-prefixed USD; `pnlSign="positive"` when `totalPnlUsd > 0`
  - Renders "Total P&L %" card with `formatPct(totalPnlPct)` when not null
  - `totalPnlPct === null` → 4th card renders `"—"` in neutral color
  - `totalPnlUsd = "0.00"` → P&L $ card has neutral color (not positive, not negative)
  - `totalPnlUsd = "-500.00"` → P&L $ card has `text-pnl-negative` class
  - `totalPnlPct = "0.00"` (not null) → renders `"0.00%"` not `"—"`

- [ ] 4.10 [GREEN] Implement `apps/frontend/src/components/dashboard/SummaryCards.tsx`:
  - Props: `{ totalValueUsd: DecimalString; totalCostBasis: DecimalString; totalPnlUsd: DecimalString; totalPnlPct: DecimalString | null }`
  - CSS grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4`
  - P&L sign helper: `parseFloat(value) > 0 → "positive"`, `< 0 → "negative"`, `=== 0 → "neutral"`
  - Card 3: `withSign(totalPnlUsd, formatUsd(totalPnlUsd))` — prepend `"+"` for positive
  - Card 4: `totalPnlPct === null ? "—" : formatPct(totalPnlPct)` with sign prefix
  - Named export only

- [ ] 4.11 [RED] Write `apps/frontend/tests/skeleton-row.test.tsx` with failing tests:
  - Renders a `<tr>` element
  - Contains exactly 11 `<td>` cells
  - Each `<td>` contains an element with `animate-pulse` class

- [ ] 4.12 [GREEN] Implement `apps/frontend/src/components/dashboard/SkeletonRow.tsx`:
  - Props: none
  - `<tr>` with 11 `<td>` cells; each cell: `<div class="animate-pulse bg-gray-800 h-4 rounded">`
  - Named export only

- [ ] 4.13 [CHECK] Run `npm run typecheck` and `npm run test:engine` — all Phase 4 tests pass

---

## Phase 5 — PortfolioTable (RED → GREEN)

- [ ] 5.1 [RED] Write `apps/frontend/tests/portfolio-row-expanded.test.tsx` with failing tests:
  - CEX item → renders exactly one sub-row labeled `"Binance Account"`
  - ON_CHAIN item with 2 wallet entries → renders 2 sub-rows
  - Sub-row label uses `entry.label` when not null/empty
  - Sub-row label falls back to `walletId.slice(0,6) + "…" + walletId.slice(-4)` when label is null
  - `priceUnavailable === true` → P&L columns in sub-rows render `"—"`
  - `priceUnavailable === false` and `currentPrice` present → pnlUsd computed as `(price - wac) * balance`
  - `wac === 0` with price present → `pnlPct` is null, renders `"—"` for pct column
  - `walletBreakdown[0]` undefined on CEX item → no crash, renders no sub-rows

- [ ] 5.2 [GREEN] Implement `apps/frontend/src/components/dashboard/PortfolioRowExpanded.tsx`:
  - Props: `{ item: PortfolioItem }`
  - CEX path (`sourceType === 'CEX'`): single `"Binance Account"` sub-row from `walletBreakdown[0]`
  - ON_CHAIN path: one sub-row per `walletBreakdown` entry with label + computed P&L
  - P&L computation (display-only parseFloat) from design §7.2
  - `<PnlDisplay>` for P&L cells; `priceUnavailable` guards
  - Named export only

- [ ] 5.3 [RED] Write `apps/frontend/tests/portfolio-row.test.tsx` with failing tests:
  - Collapsed by default → expanded sub-row NOT in DOM
  - Click expand button → `aria-expanded` becomes `"true"`, `PortfolioRowExpanded` renders
  - Click expand button again → collapses, sub-row removed from DOM
  - `priceUnavailable === true` → Current Price cell renders `"—"`; P&L cells render `"—"`
  - ON_CHAIN row with `walletCount > 1` → renders wallet-count pill (e.g., `"3 wallets"`)
  - ON_CHAIN row with `walletCount === 1` → no wallet-count pill
  - CEX row → no wallet-count pill
  - Renders `<NetworkBadge>` component
  - Renders `<TokenLogo>` component

- [ ] 5.4 [GREEN] Implement `apps/frontend/src/components/dashboard/PortfolioRow.tsx`:
  - Props: `{ item: PortfolioItem }`
  - Local state: `const [expanded, setExpanded] = useState(false)`
  - Renders a `<tr>` with 11 cells in spec order (expand toggle, logo, symbol, network, balance, price, value, wac, costBasis, pnlUsd, pnlPct)
  - When `expanded === true`: renders a second `<tr>` with `<td colSpan={11}><PortfolioRowExpanded item={item} /></td>`
  - Uses `<NetworkBadge>`, `<TokenLogo>`, `<PnlDisplay>`, `formatUsd`, `formatCrypto`
  - Named export only

- [ ] 5.5 [RED] Write `apps/frontend/tests/portfolio-table.test.tsx` with failing tests:
  - Zero-balance items filtered: item with `balance="0"` not rendered in DOM
  - Non-zero items rendered: item with `balance="1.5"` rendered
  - Empty items array → `PortfolioTableEmptyState` rendered; `<table>` NOT in DOM
  - All-zero-balance items after filter → `PortfolioTableEmptyState` rendered
  - Domain invariant: fixture with `(symbol='ETH', network='ETH', sourceType='ON_CHAIN')` AND `(symbol='ETH', network='CEX_BINANCE', sourceType='CEX')` → two distinct rows in DOM, not one merged row
  - ON_CHAIN row with `walletBreakdown.length > 1` → wallet-count badge visible
  - CEX row → no wallet-count badge
  - `priceUnavailable === true` row → Current Price cell renders `"—"`
  - Renders `<th>` elements for all column headers (including empty ones for expand/logo)

- [ ] 5.6 [GREEN] Implement `apps/frontend/src/components/dashboard/PortfolioTable.tsx`:
  - Props: `{ items: PortfolioItem[] }`
  - Zero-balance filter: `items.filter(i => parseFloat(i.totalBalance) !== 0)`
  - Empty filtered list → `<PortfolioTableEmptyState />`
  - Non-empty → `<table>` with `<thead>` + `<tbody>` mapping to `<PortfolioRow>` keyed by `${item.network}-${item.contractAddress ?? item.symbol}`
  - Wrapped in `<div class="overflow-x-auto">`
  - Named export only

- [ ] 5.7 [GREEN] Implement `apps/frontend/src/components/dashboard/PortfolioTableEmptyState.tsx`:
  - Props: none
  - Centered card with `"Add your first wallet in Settings"` message
  - `<Link to="/settings">` styled as primary CTA (existing router Link component)
  - Named export only

- [ ] 5.8 [CHECK] Run `npm run typecheck` and `npm run test:engine` — all Phase 5 tests pass

---

## Phase 6 — DashboardPage integration (RED → GREEN)

- [ ] 6.1 [GREEN] Implement `apps/frontend/src/components/dashboard/RefreshIndicator.tsx`:
  - Props: `{ relativeTime: string; isRefetching: boolean; stale: boolean; onRetry: () => void }`
  - Renders pulse dot: green (`bg-pnl-positive`) when fresh, red (`bg-pnl-negative`) when stale, animated when `isRefetching`
  - Renders `relativeTime` text
  - When `stale === true`: renders `[Retry]` button calling `onRetry`
  - Named export only
  - Note: no unit test required for this component (purely presentational with no logic)

- [ ] 6.2 [RED] Write `apps/frontend/tests/dashboard-page.test.tsx` with failing integration tests:
  - Mock `apiClient.get` via `vi.mock('../../src/lib/api-client')`
  - While fetch is pending → skeleton is rendered (4 card skeletons + 5 row skeletons); `<table>` NOT in DOM
  - After fetch resolves with data → `SummaryCards` renders, `PortfolioTable` renders
  - After fetch resolves with empty `tokens: []` → `PortfolioTableEmptyState` renders; `SummaryCards` still renders
  - Fetch rejects with non-401 error → error card renders with `"Couldn't load portfolio."` text; Retry button present
  - Click Retry button → `apiClient.get` called again
  - Stale data state (second fetch fails, first succeeded) → old data visible + stale banner visible
  - Error card uses `aria-live="polite"` region

- [ ] 6.3 [GREEN] Implement `apps/frontend/src/pages/DashboardPage.tsx`:
  - No props (route component)
  - Calls `usePortfolio()` and `useRelativeTime(lastUpdated)`
  - `loading && data === null` → `<DashboardSkeleton>` (local sub-component, not exported): 4 card skeleton placeholders + `<table>` with 5 `<SkeletonRow>`
  - `error && data === null` → `<DashboardErrorState onRetry={refresh}>` (local sub-component): inline error card in `aria-live="polite"`, Retry button with `aria-label="Retry loading portfolio"`
  - Otherwise → `<main>` with header, `<SummaryCards>`, conditional `<PortfolioTableEmptyState>` or `<PortfolioTable>`
  - `RefreshIndicator` rendered in header when data is present
  - Named export only

- [ ] 6.4 [GREEN] Update `apps/frontend/src/routes/router.tsx`:
  - Replace `DashboardPlaceholder` import with `DashboardPage` from `../pages/DashboardPage`
  - Remove `DashboardPlaceholder` import

- [ ] 6.5 [GREEN] Delete `apps/frontend/src/pages/DashboardPlaceholder.tsx` (if it exists):
  - Verify no other file imports it before deleting

- [ ] 6.6 [CHECK] Run `npm run typecheck` and `npm run test:engine` — all Phase 6 tests pass

---

## Phase 7 — Tailwind theme tokens

- [ ] 7.1 [GREEN] Add `@theme` block to `apps/frontend/src/index.css`:
  ```css
  @theme {
    --color-binance: #F0B90B;
    --color-pnl-positive: #22C55E;
    --color-pnl-negative: #EF4444;
  }
  ```
  - Verify the block does not duplicate an existing `@theme` block — merge into any existing one if present
  - This generates Tailwind utility classes: `bg-binance`, `text-binance`, `text-pnl-positive`, `text-pnl-negative`, etc.

- [ ] 7.2 [CHECK] Run `npm run typecheck` — no errors introduced by the CSS change

---

## Phase 8 — Typecheck & final verification

- [ ] 8.1 [CHECK] Run `npm run typecheck` — zero errors across the entire frontend workspace
- [ ] 8.2 [CHECK] Run `npm run lint` — zero warnings or errors introduced by this change
- [ ] 8.3 [CHECK] Run `npm run test:engine` — all tests green, no skipped tests
- [ ] 8.4 [REVIEW] Verify domain invariant manually: in `portfolio-table.test.tsx`, confirm the ETH on-chain vs ETH on Binance fixture is present and green — this is the PRD-critical invariant from `domain model` §"Token identity is per source"
- [ ] 8.5 [REVIEW] Verify no `useMemo`, `useCallback`, `forwardRef`, or default exports introduced in any new file

---

## Implementation notes

### Strict TDD reminder
Every RED task must produce a **failing test** before the GREEN task is started. Running `npm run test:engine` after a RED task must show test failure(s) for exactly the new tests — not pre-existing failures.

### `js-sha3` dependency
Task 2.4 adds `js-sha3` to the frontend workspace. If rejected, replace `toChecksumAddress` with a function that always throws, and update `TokenLogo` to treat any checksum failure as a CDN skip → letter-avatar immediately. Update task 2.3 accordingly.

### `cn()` helper
Use the existing `apps/frontend/src/lib/cn.ts` for all conditional class composition. Do not install `clsx` or `tailwind-merge` separately unless they are not already present.

### No `parseFloat` for accounting
`parseFloat` is permitted ONLY in:
- P&L coloring comparisons (sign detection)
- Per-wallet P&L computation in `PortfolioRowExpanded` (display-only)
- Zero-balance filter in `PortfolioTable`

Never use `parseFloat` to mutate or store accounting data. All accounting values stay as `DecimalString`.

### Key naming for `PortfolioRow`
Row key: `${item.network}-${item.contractAddress ?? item.symbol}` — ensures ETH on-chain and ETH CEX_BINANCE never share a React key (domain invariant codified in render).
