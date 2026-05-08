# Proposal: US-009 — Dashboard principal UI

> **Change:** `US-009-dashboard-ui`
> **Phase:** sdd-propose
> **Date:** 2026-05-07
> **Depends on:** US-007 (Portfolio API — implemented ✅)
> **Stack:** React 19 + Vite + Tailwind v4 + TypeScript (strict)

---

## 1. Intent

Replace the `DashboardPlaceholder` stub with a real, production-grade dashboard that consumes `GET /api/portfolio` and renders the user's aggregated multi-source portfolio.

The dashboard is the **first thing the authenticated user sees**. It must communicate four ideas at a glance:

1. **How much money is at stake** — Total Portfolio Value + Total Cost Basis.
2. **Are we winning or losing** — Total P&L in dollars and percentage, color-coded.
3. **Where the value lives** — a row per token with per-network/source disambiguation (ETH on-chain ≠ ETH on Binance — invariant from PRD §domain model).
4. **The detail behind the aggregation** — expandable rows that reveal per-wallet WAC, balance, and computed P&L (on-chain) or the single Binance Account entry (CEX).

The dashboard must auto-refresh every 60 seconds without user interaction and surface a clear "Updated Xs ago" indicator so the user always knows how fresh the data is. The view must degrade gracefully when prices fail (`priceUnavailable: true` → `—` placeholders, never a crash) and show an empty state with a CTA to Settings when no positions exist.

This story is **UI-only**. It does not introduce new endpoints, new business rules, or new persistence. All accounting truth lives in the backend (US-007); the frontend is a pure read-side projection.

---

## 2. Scope

### Files to create

```
apps/frontend/src/
├── pages/
│   └── DashboardPage.tsx                 [NEW — replaces DashboardPlaceholder usage]
├── components/
│   └── dashboard/
│       ├── SummaryCards.tsx              [NEW]
│       ├── PortfolioTable.tsx            [NEW]
│       ├── PortfolioTableEmptyState.tsx  [NEW]
│       ├── TokenRow.tsx                  [NEW — collapsed row, manages expand state]
│       ├── TokenRowExpanded.tsx          [NEW — sub-rows for walletBreakdown]
│       ├── TokenLogo.tsx                 [NEW — Trust Wallet CDN + letter-avatar fallback]
│       ├── PnlDisplay.tsx                [NEW — colored P&L value]
│       ├── SourceBadge.tsx               [NEW — Binance yellow / chain pill]
│       └── RefreshIndicator.tsx          [NEW — "Updated Xs ago"]
├── hooks/
│   ├── usePortfolio.ts                   [NEW — fetch + 60s polling]
│   └── useRelativeTime.ts                [NEW — 1s tick for "Xs ago"]
├── lib/
│   ├── format.ts                         [NEW — formatUsd / formatCrypto / formatPct]
│   └── portfolio-types.ts                [NEW — TS types mirroring API response]
└── tests/
    ├── format.test.ts                            [NEW]
    ├── use-portfolio.test.ts                     [NEW]
    ├── use-relative-time.test.ts                 [NEW]
    ├── token-logo.test.tsx                       [NEW]
    ├── pnl-display.test.tsx                      [NEW]
    ├── summary-cards.test.tsx                    [NEW]
    ├── token-row.test.tsx                        [NEW]
    └── dashboard-page.test.tsx                   [NEW — integration]
```

### Files to modify

```
apps/frontend/src/routes/router.tsx       [MODIFY — swap DashboardPlaceholder for DashboardPage]
```

### Files to delete

```
apps/frontend/src/pages/DashboardPlaceholder.tsx   [DELETE — superseded]
```

### Out of scope (explicit)

- New backend routes (US-009 consumes US-007 only).
- Token detail page / per-token deep dive (US-010+).
- Settings page (US-010+) — empty-state CTA renders as a styled, navigable link to `/settings` even though that route currently 404s; that is acceptable for this story.
- Add-transaction flow.
- Mobile-first redesign — the dashboard renders responsively via horizontal scroll on the table; a card-stack mobile layout is deferred.
- Decimal-exact arithmetic on the frontend. Display approximations are explicit (see decision §3.3).

---

## 3. Decisions

### 3.1 Token logo strategy → **Trust Wallet CDN + letter-avatar fallback**

**Decision**: For ON_CHAIN tokens, attempt to load from Trust Wallet's public assets repository:

```
ETH:  https://assets.trustwalletapp.com/blockchains/ethereum/assets/{checksumAddress}/logo.png
BSC:  https://assets.trustwalletapp.com/blockchains/smartchain/assets/{checksumAddress}/logo.png
```

`{checksumAddress}` is the EIP-55 checksum form of `contractAddress`. We will compute it client-side via a tiny pure helper (no library — keccak via `viem` is overkill for this story). The `<img>` `onError` handler swaps to a deterministic letter-avatar (first letter of `symbol`, colored by hash of `symbol`).

For CEX_BINANCE tokens, the logo is **always** the letter-avatar — no CDN call. This is intentional:
- Binance has no public per-symbol logo CDN compatible with our addressing model.
- The `SourceBadge` already renders a yellow "Binance" pill on the same row, so the source is visually unambiguous even with a generic avatar.

**Why not Option B (CoinGecko)**: requires an extra `GET /coins/{id}/image` API call per row (or a coin-list ID lookup table). Adds latency, a dependency, and rate-limit risk for marginal visual gain.

**Why not Option C (letter-avatar everything)**: known on-chain logos are a strong recognition cue for users. Losing them would degrade UX without any architectural benefit.

**Tradeoff accepted**: Trust Wallet's repo has incomplete coverage for long-tail tokens. The graceful fallback to letter-avatar means the experience degrades to "still readable, just less pretty" — never broken. No new backend column, no API key, no CORS dance (Trust Wallet serves with permissive headers).

**Component shape**:
```tsx
<TokenLogo symbol={symbol} contractAddress={contractAddress} network={network} sourceType={sourceType} />
```
Internally chooses CDN-or-avatar. Self-contained — nothing else in the app needs to know the strategy.

### 3.2 Polling → **`useEffect` + `setInterval(60_000)` inside a custom `usePortfolio` hook**

**Decision**: Implement polling natively. No TanStack Query, no SWR.

The exploration confirmed:
- Single endpoint, single consumer (the dashboard).
- No cache-invalidation graph, no mutations, no optimistic updates.
- Adding a 50KB+ data-fetching library to power one polling endpoint is **not justified**.

`usePortfolio` returns:
```typescript
{
  data: PortfolioSummary | null,
  loading: boolean,         // true on initial load only; false during background refetch
  error: Error | null,      // set on non-401 errors; cleared on next successful fetch
  lastFetchedAt: Date | null,
  refetch: () => Promise<void>  // manual refresh trigger (used by error retry button)
}
```

**Lifecycle**:
1. On mount → fire initial fetch (sets `loading: true`).
2. On unmount → clear interval (cleanup function in `useEffect`).
3. On tab visibility change → pause polling when hidden, resume + immediate refetch on show. This is a free win (saves API calls when the user has the tab in the background).
4. On 401 → `apiClient` already redirects to login; the hook just lets the error propagate.

**Background refetch UX**: The hook must NOT flip `loading` back to `true` on the 60s tick. That would unmount and remount the table, killing scroll position and expanded-row state. Instead, the table renders the previous `data` while the new fetch is in flight; on success, data swaps atomically.

**Memory leak safety**: The `setInterval` is stored in a ref and cleared in the `useEffect` cleanup. We will write a unit test that mounts/unmounts the hook and asserts no pending timers remain.

### 3.3 Per-wallet P&L computation → **`parseFloat` + `Intl.NumberFormat`, frontend-display only**

**Decision**: Compute per-wallet P&L on the frontend using native float arithmetic. No `decimal.js` on the frontend.

```typescript
const balance = parseFloat(entry.balance);
const wac = parseFloat(entry.wac);
const price = parseFloat(row.currentPrice ?? "0");
const pnlUsd = (price - wac) * balance;
const pnlPct = wac > 0 ? ((price - wac) / wac) * 100 : null;
```

**Why this is acceptable**:
- The accounting truth (`totalPnlUsd`, `totalPnlPct`, aggregated values) is **already computed on the backend with decimal precision** and shipped as decimal strings. The dashboard renders those backend values verbatim.
- The only client-computed values are the **per-wallet breakdown** in the expanded row, where a few pennies of float drift on a $50K balance are imperceptible and never affect any persisted state.
- Adding `decimal.js` (~10KB gz) to compute display-only values is a poor tradeoff.

**Constraints**:
- The `formatUsd`/`formatPct` helpers must accept either a decimal string (backend value) OR a number (computed value). Internally, both go through `Intl.NumberFormat` with stable currency/locale config.
- Tests must cover the fallback path: `wac = 0` → P&L percentage is `null` → display `"—"` (mirrors backend behavior for `totalPnlPct`).

### 3.4 Data fetching → **`apiClient.get`, no new wrapper**

**Decision**: Reuse the existing `apiClient.get<T>('/api/portfolio')`. No new abstraction.

The `apiClient` already handles:
- `credentials: 'include'` for cookie auth.
- 401 → redirect to login via the auth bridge.
- JSON parsing.

`usePortfolio` calls `apiClient.get<PortfolioSummary>('/api/portfolio')` directly. The TypeScript response type lives in `src/lib/portfolio-types.ts` and mirrors the backend Zod schema.

**Why not introduce a typed-route helper**: One endpoint, one consumer. Premature.

### 3.5 Expandable rows → **Local `useState<boolean>` per `TokenRow`**

**Decision**: Each `TokenRow` owns its own `expanded` boolean state via `useState`. No global expanded-rows set.

Rationale:
- Rows are independent. Expanding one does not affect others.
- React Compiler memoizes the parent table, so unrelated rows do not re-render when one row toggles.
- A global `Set<string>` of expanded keys would require a key on every row and an extra context — no benefit.

**Accessibility**: The expand toggle is a `<button>` with `aria-expanded={expanded}` and a chevron icon that rotates 90deg when open.

### 3.6 Error handling and loading states

| State | UI |
|-------|----|
| Initial load (`loading && !data`) | Skeleton: 4 gray summary cards + 5 skeleton table rows. No spinner. |
| Background refetch (`!loading && data && !error`) | Render previous data; `RefreshIndicator` shows current "Xs ago" and a subtle pulse on the dot during the fetch. |
| Non-401 error (`error && !data`) | Inline error card: "Couldn't load portfolio. [Retry]" — Retry calls `refetch()`. |
| Non-401 error (`error && data`) | Render stale data with a small banner above the table: "Last update failed — showing data from Xs ago. [Retry]" |
| Empty portfolio (`data.tokens.length === 0`) | `PortfolioTableEmptyState`: "Add your first wallet in Settings" with a styled link to `/settings`. SummaryCards still render with zeros. |
| `priceUnavailable: true` per row | Render Current Price, Current Value, P&L $, P&L % as `—`. WAC, Balance, Cost Basis still render normally (those are backend-computed without price). |
| `totalPnlPct === null` | The P&L % summary card renders `—` instead of a percentage. The dollar P&L card still renders. |

### 3.7 Color tokens (Tailwind v4)

The PRD pins specific hex values that are NOT in the default Tailwind palette. We define them inline via Tailwind v4's CSS custom property layer in `src/index.css`:

```css
@theme {
  --color-binance: #F0B90B;
  --color-pnl-positive: #22C55E;  /* matches green-500 */
  --color-pnl-negative: #EF4444;  /* matches red-500 */
}
```

In components, use Tailwind classes: `bg-binance text-pnl-positive` etc. No inline `style={{}}` for these.

### 3.8 "Updated Xs ago" indicator

**Decision**: A separate `useRelativeTime(date: Date | null)` hook returns a human-readable string and re-renders every second.

- 0–59s → `"Updated Xs ago"`
- 60–3599s → `"Updated Xm ago"`
- ≥1h → `"Updated 1h+ ago"` (we don't expect this — polling is 60s — but defensive)
- `null` → `"Never updated"` (only during initial load before first response)

The hook owns its own `setInterval(1000)` cleanup. Tested in isolation with `vi.useFakeTimers()`.

---

## 4. Component breakdown

```
DashboardPage
├─ usePortfolio()  →  { data, loading, error, lastFetchedAt, refetch }
├─ useRelativeTime(lastFetchedAt)  →  "Xs ago"
│
├─ <SummaryCards>
│    Props: { totalValueUsd, totalCostBasis, totalPnlUsd, totalPnlPct }
│    Renders: 4 cards. P&L cards use <PnlDisplay>.
│    Handles: totalPnlPct === null → "—"
│
├─ <RefreshIndicator>
│    Props: { lastFetchedAt, isRefetching }
│    Renders: "Updated Xs ago" + a pulse dot during refetch.
│
└─ <PortfolioTable>
     Props: { tokens: TokenPortfolioRow[] }
     Renders:
       - empty → <PortfolioTableEmptyState>
       - non-empty → <table> with <TokenRow> per token
     │
     ├─ <TokenRow>  (one per token, manages own expanded state)
     │    Renders:
     │      [chevron] [TokenLogo] Symbol [SourceBadge] | Balance | Price | Value | WAC | Cost Basis | <PnlDisplay $> | <PnlDisplay %>
     │    On click of chevron → toggles expanded
     │    When expanded → renders <TokenRowExpanded> as a nested row (colspan=full)
     │
     └─ <TokenRowExpanded>
          Props: { walletBreakdown, currentPrice, sourceType }
          Renders: per-wallet sub-rows with computed pnlUsd/pnlPct
          For CEX: single row labeled "Binance Account"
          For ON_CHAIN: one row per wallet, label fallback to truncated walletId
```

Supporting primitives:
- `<TokenLogo>` — img with onError → letter-avatar fallback.
- `<SourceBadge>` — pill: `Binance` (yellow #F0B90B), `Ethereum` (gray), `BSC` (gray). For grouped on-chain rows with `walletCount > 1`, additional pill: `N wallets`.
- `<PnlDisplay>` — formats value, applies positive/negative color, supports `null` → `"—"`.

---

## 5. Constraints

### Carried from CLAUDE.md / PRD
- **TypeScript strict** (`noUncheckedIndexedAccess: true`). No `any`. Use `unknown` + Zod at any boundary that crosses fetch.
- **Named exports only** — no default exports.
- **React 19**: no manual `useMemo` / `useCallback`. React Compiler handles memoization.
- **`ref` is a regular prop** — no `forwardRef`.
- **Tailwind v4** — class-first. `style={{}}` only for dynamic computed values (e.g., a dynamic letter-avatar background derived from a hash). Use the `cn()` helper in `src/lib/cn.ts` for conditional composition.
- **Domain invariants** — UI must NEVER aggregate ETH on-chain with ETH on Binance. The backend already returns them as separate rows; the frontend just renders them as-is. (Tested via fixture asserting both rows render distinct values.)
- **Decimal strings** — every numeric API field is a string. The TS types reflect this. We never call `Number(x)` blindly on backend values; we route through `formatUsd` / `formatCrypto` / `formatPct`.

### Carried from US-007 contract
- Empty portfolio response is a well-defined shape (`tokens: []`, totals as zero strings). Empty state is detected by `tokens.length === 0`, not by checking totals.
- `priceUnavailable: true` rows have `currentPrice/currentValue/pnlUsd/pnlPct` all `null`.
- `walletBreakdown[].label` is `string | null`.

---

## 6. Non-goals

- **No global state library** (Redux/Zustand/Jotai). Local component state + the `usePortfolio` hook is enough.
- **No data fetching library** (TanStack Query/SWR). The 60s polling is a 20-line hook.
- **No `decimal.js` on the frontend.** Backend is the source of truth for accounting precision; frontend computes display values with native floats.
- **No virtualization** (react-window/react-virtual). We expect under 200 token rows for any realistic portfolio. Can be revisited later if profiling shows scroll jank.
- **No animations beyond a chevron rotation and a subtle pulse on the refresh dot.** No row-expand height-animation libraries.
- **No internationalization framework.** Currency and number formatting use `Intl.NumberFormat('en-US', { currency: 'USD' })` directly. i18n is a separate concern.
- **No mobile-specific layout.** The table is horizontally scrollable on small screens. A card-stack layout for mobile is a follow-up.

---

## 7. Tradeoffs considered

### Polling vs. WebSockets / Server-Sent Events
- **Chosen**: 60s polling.
- **Why**: The PRD specifies 60s explicitly. WebSockets add backend complexity (connection state, reconnect, scaling) for a use case where data only changes when the user manually triggers a sync or when prices tick — neither requires sub-second latency. Polling is also dead-simple to test (no socket mocks).

### Trust Wallet CDN vs. on-chain logo column in DB
- **Chosen**: Trust Wallet CDN.
- **Why**: Adding a `logo_url` column to `tokens` requires a sync-time ingestion strategy (where do we fetch it from? when does it refresh?) and a DB migration. Trust Wallet's CDN solves it for free with one `<img src>` and an onError fallback. If coverage proves insufficient in production, we can revisit with a DB-backed cache.

### Single `usePortfolio` hook vs. splitting fetch + polling
- **Chosen**: Single hook, polling is an implementation detail.
- **Why**: The dashboard is the only consumer. A hypothetical `useFetch` + `usePolling` split would be over-engineered for one call site. If a second polling endpoint appears, refactor then.

### Skeleton loading vs. spinner
- **Chosen**: Skeleton on initial load, no UI change on background refetch.
- **Why**: Skeletons preserve layout, prevent jank on fast networks, and communicate structure. Spinners on background refetch would create visual noise every 60 seconds.

### `parseFloat` vs. `decimal.js` for per-wallet P&L
- **Chosen**: `parseFloat`, display-only.
- **Why**: Backend owns accounting truth. A 14-decimal value × a 14-decimal value in JS doubles is precise to ~15 significant figures — far beyond what we display (2 decimals for USD). Adding a decimal library to the frontend bundle is a net negative.

### Local `useState` for expand vs. URL-synced state
- **Chosen**: Local `useState`.
- **Why**: Expanded-row state is ephemeral. Encoding it in the URL (`?expanded=ETH-0xabc,CEX-PEPE`) is a feature, not a requirement. Adds router coupling without a clear benefit. Can be added later if deep-linking to expanded rows becomes a need.

### Empty state link to non-existent `/settings` route
- **Chosen**: Render the link as a styled anchor pointing to `/settings`. If clicked before US-010 ships, the user gets a 404 from React Router.
- **Why**: Stubbing a fake "soon" page is worse UX than letting the link exist. The 404 is harmless and the link will start working when Settings ships. Documenting this is enough.

---

## 8. Risk follow-ups (from explore.md)

| # | Risk | Resolution in this proposal |
|---|------|-----------------------------|
| R1 | Token logos undefined | **Resolved** — Trust Wallet CDN + letter-avatar fallback (§3.1). |
| R2 | `totalPnlPct` can be null | **Resolved** — `<PnlDisplay>` handles `null` → `"—"` (§3.6). |
| R3 | `priceUnavailable` rows | **Resolved** — `<TokenRow>` renders `"—"` for price-dependent columns (§3.6). |
| R4 | Per-wallet float precision | **Resolved** — `parseFloat` is acceptable for display-only (§3.3). |
| R5 | 60s polling memory leak | **Resolved** — interval stored in ref + cleanup function + unit test (§3.2). |
| R6 | `useRelativeTime` tick cost | **Resolved** — separate hook with own cleanup, tested (§3.8). |
| R7 | Settings page doesn't exist | **Accepted** — link is rendered as a regular anchor; 404 when clicked is acceptable until US-010 (§7). |
| R8 | WAC long decimal display | **Resolved** — `formatCrypto()` truncates to 8 significant figures (§3.6 / §2 lib/format.ts). |
| R9 | `walletBreakdown.label` nullable | **Resolved** — `<TokenRowExpanded>` falls back to truncated `walletId` (§4). |

### Open questions resolved

1. **Logo source** → Trust Wallet CDN + letter-avatar.
2. **Per-wallet P&L precision** → `parseFloat` (display-only).
3. **Mobile layout** → horizontal scroll on table; card-stack deferred.
4. **Initial loading UX** → skeleton, not spinner.
5. **Error state** → inline error card with Retry; stale-data banner if a refetch fails after first success.

No questions remain blocking for sdd-spec / sdd-design.
