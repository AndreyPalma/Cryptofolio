# Explore: US-009 — Dashboard principal UI

> **Change:** `US-009-dashboard-ui`
> **Phase:** sdd-explore
> **Date:** 2026-05-07
> **Depends on:** US-007 (Portfolio API — implemented ✅)

---

## 1. Existing frontend structure

### File tree

```
apps/frontend/
├── package.json
├── vite.config.ts
├── tsconfig.json          (extends ../../tsconfig.base.json)
├── src/
│   ├── main.tsx           — StrictMode + createRoot
│   ├── index.css          — @import "tailwindcss" (Tailwind v4)
│   ├── App.tsx            — AuthProvider wraps RouterProvider
│   ├── lib/
│   │   ├── api-client.ts  — fetch wrapper (credentials:include, 401 interceptor)
│   │   ├── auth-context.tsx — isAuthenticated state + AuthBridge
│   │   └── cn.ts          — clsx + tailwind-merge helper
│   ├── routes/
│   │   └── router.tsx     — createBrowserRouter, ProtectedRoute
│   └── pages/
│       ├── LoginPage.tsx  — full implementation
│       └── DashboardPlaceholder.tsx — stub ("Dashboard — US-004 pendiente")
└── tests/
    ├── api-client.test.ts
    ├── auth-context.test.ts
    ├── login-page.test.tsx
    └── protected-route.test.tsx
```

### Patterns observed

- **No component library** — all UI is hand-written Tailwind classes. LoginPage is the only non-stub page; its style establishes the color vocabulary: `gray-950`/`gray-900`/`gray-800` backgrounds, `indigo-600` primary, `red-400` errors, `white` text.
- **Named exports only** — consistent throughout (no default exports).
- **React 19** — `react` + `react-dom` 19.x; no `useMemo`/`useCallback` in existing code (React Compiler assumed).
- **cn()** is already available in `src/lib/cn.ts` (clsx + tailwind-merge).
- **No state management library** — no Redux, Zustand, Jotai, or TanStack Query. Auth state is a plain `useState` in AuthContext.
- **No HTTP caching layer** — apiClient is a plain fetch wrapper with no polling, retry, or stale-while-revalidate semantics.
- **No shared component directory** — only `lib/` utilities exist. A `components/` folder must be created for US-009.
- **Prototype is absent** — the `prototipo/` directory is empty (files were removed). Visual reference must come from the PRD acceptance criteria directly.

### Routing

`router.tsx` uses `createBrowserRouter` (React Router v7). The dashboard route is `"/"` wrapped in `ProtectedRoute`. US-009 replaces `DashboardPlaceholder` with the real `DashboardPage`.

---

## 2. Portfolio API endpoints (US-007 — implemented)

All routes are protected by the global JWT auth plugin at `/api/*`.

### GET /api/portfolio

Returns aggregated portfolio summary.

**Response shape (`PortfolioSummary`)**:
```typescript
{
  totalValueUsd: string,       // DecimalString
  totalCostBasis: string,      // DecimalString
  totalPnlUsd: string,         // DecimalString
  totalPnlPct: string | null,  // null when costBasis = 0
  tokens: TokenPortfolioRow[]
}
```

**`TokenPortfolioRow`**:
```typescript
{
  symbol: string,
  network: 'ETH' | 'BSC' | 'CEX_BINANCE',
  sourceType: 'ON_CHAIN' | 'CEX',
  contractAddress: string,
  binanceSymbol: string | null,
  totalBalance: string,
  wacAggregated: string,
  totalCostBasis: string,
  currentPrice: string | null,
  totalCurrentValue: string | null,
  pnlUsd: string | null,
  pnlPct: string | null,
  walletCount: number,
  walletBreakdown: WalletBreakdownEntry[],
  priceUnavailable?: boolean
}
```

**`WalletBreakdownEntry`**:
```typescript
{
  walletId: string,
  label: string | null,
  balance: string,
  wac: string
}
```

**Key behaviors**:
- ON_CHAIN tokens with the same `(contractAddress, network)` across multiple wallets are **pre-aggregated** by the backend into one row (`walletCount > 1`, `walletBreakdown` has multiple entries).
- CEX_BINANCE tokens are **never aggregated** with on-chain — they appear as separate rows with `sourceType: 'CEX'`.
- Rows with `balance = 0` are excluded server-side (only OPEN positions are returned).
- When price fetch fails: `priceUnavailable: true`, `currentPrice: null`, `pnlUsd: null`, `pnlPct: null`. Never a 500.
- `totalPnlPct` is `null` when `totalCostBasis` is zero (avoids division by zero).
- All numeric fields are **decimal strings**, never JS numbers.
- Empty portfolio: `{ totalValueUsd:'0.000...', totalCostBasis:'0.000...', totalPnlUsd:'0.000...', totalPnlPct:null, tokens:[] }`

### GET /api/portfolio/token/:contractAddress/:network

Returns full token detail with per-lot P&L enriched transactions. Not needed for the dashboard page — relevant for a future TokenDetail page (US-010 or similar).

### GET /api/portfolio/token/:contractAddress/:network/history

Returns closed position cycles. Also not needed for dashboard.

---

## 3. Data grouping logic

**The grouping is done entirely on the backend.** The frontend receives a flat `tokens: TokenPortfolioRow[]` array where each entry is already the correct unit to render as one table row.

Grouping rules (enforced by `PortfolioService.getPortfolioSummary`):
- **ON_CHAIN**: positions with same `lower(contractAddress)` + `network` across multiple wallets → one row, `walletCount = N`, `walletBreakdown = [...]`. WAC is weighted average: `Σ(balance_i × wac_i) / Σbalance_i`.
- **CEX_BINANCE**: never grouped with on-chain, always `walletCount = 1` (single Binance wallet invariant from PRD). `binanceSymbol` is present for price badge display.
- **ETH on-chain vs ETH on Binance**: ALWAYS two separate rows — same `symbol`, different `network` (`'ETH'` vs `'CEX_BINANCE'`). Dashboard MUST NOT merge them.

For the expandable breakdown rows:
- ON_CHAIN: `walletBreakdown` provides per-wallet `{ walletId, label, balance, wac }`. P&L per wallet must be computed client-side (current price × balance − wac × balance) or fetched from `/api/portfolio/token/:addr/:network?wallet_id=...`.
- CEX: `walletBreakdown` has exactly one entry: the Binance Account.

**Note**: `walletBreakdown` does NOT include `pnlUsd` per wallet — only `balance` and `wac`. Per-wallet P&L must be computed in the frontend: `pnlUsd = (currentPrice - wac) × balance`.

---

## 4. HTTP client pattern

### Current pattern: plain fetch wrapper

`apps/frontend/src/lib/api-client.ts` is a thin wrapper around the native `fetch` API:

```
apiClient.get<T>(url) → Promise<T>
apiClient.post<T>(url, body) → Promise<T>
```

- Always sets `credentials: 'include'` (cookie-based JWT).
- 401 → redirects to login via `_redirectToLogin` bridge.
- No retry, no caching, no polling, no background refetch.
- Errors thrown as `new Error(`HTTP ${status}`)` for non-401 errors.

### What this means for US-009

The 60-second auto-refresh requirement must be implemented manually using `useEffect` + `setInterval` (or a custom `usePolling` hook). There is no React Query or SWR to handle this automatically.

The `"Updated Xs ago"` timestamp indicator requires tracking `lastFetchedAt: Date` in local state and updating a display counter with a 1-second `setInterval`.

---

## 5. Dependencies gap

| Need | Current state | Gap |
|------|---------------|-----|
| Data fetching | `apiClient` (fetch wrapper) | None — sufficient for polling |
| Auto-polling | None | Must implement with `useEffect + setInterval` |
| Stale timer ("Updated Xs ago") | None | Must implement with `setInterval` for display |
| Decimal display formatting | None | Need `Intl.NumberFormat` or a small helper for formatting DecimalString → `$1,234.56` |
| Token logo images | None | Logo source unknown — PRD mentions logo column but no CDN or API defined. Risk: may need placeholder. |
| TanStack Query / SWR | Not installed | NOT required given simple single-endpoint fetch. Adding a full cache library for one polling endpoint adds unnecessary complexity. |
| Tailwind v4 | `@tailwindcss/vite` + `@import "tailwindcss"` | Already configured ✅ |
| clsx + tailwind-merge | Installed ✅ | `cn()` already available ✅ |
| React Router v7 | Installed ✅ | Already wired ✅ |
| Testing libs | `@testing-library/react` + `vitest` + `jsdom` | Already in workspace ✅ |

**Net gap**: No new `npm install` is strictly required. The polling and timer logic is standard `useEffect` work.

**Possible addition**: A `formatUSD(decimalStr)` and `formatPct(decimalStr)` utility to avoid scattering `Intl.NumberFormat` calls across components. This is a utility, not a dependency.

---

## 6. Prototype UI insights

The `prototipo/` directory is empty — prototype files have been removed from the repository. Insights must be derived from the PRD acceptance criteria directly:

- **Color palette** (from acceptance criteria):
  - Binance badge: `#F0B90B` (yellow)
  - P&L positive: `#22C55E` (Tailwind `green-500`)
  - P&L negative: `#EF4444` (Tailwind `red-500`)
- **Established color vocabulary** (from `LoginPage.tsx`):
  - Page background: `bg-gray-950`
  - Card/surface background: `bg-gray-900`
  - Input background: `bg-gray-800`
  - Primary action: `bg-indigo-600`
  - Text: `text-white` (primary), `text-gray-400` (muted)
- **Layout pattern**: centered card layout in LoginPage suggests dark-theme dashboard with card surfaces on gray-950 background.

---

## 7. Architecture considerations

### Component breakdown (proposed)

```
src/
├── pages/
│   └── DashboardPage.tsx           — replaces DashboardPlaceholder; orchestrates data fetch + polling
├── components/
│   ├── dashboard/
│   │   ├── SummaryCards.tsx        — 4 metric cards (Total Value, Cost Basis, P&L $, P&L %)
│   │   ├── PortfolioTable.tsx      — table wrapper + empty state
│   │   ├── TokenRow.tsx            — one expandable row (collapsed state)
│   │   ├── TokenRowExpanded.tsx    — breakdown sub-rows (wallet entries)
│   │   ├── PnlBadge.tsx            — colored P&L display (green/red)
│   │   └── NetworkBadge.tsx        — source badge (Binance yellow, chain name)
│   └── ui/
│       ├── RefreshIndicator.tsx    — "Updated Xs ago" display
│       └── LoadingSpinner.tsx      — skeleton or spinner for initial load
└── hooks/
    ├── usePortfolio.ts             — fetch + 60s polling + lastFetchedAt tracking
    └── useRelativeTime.ts          — "Xs ago" counter (1s tick)
```

### Data flow

```
DashboardPage
  └─ usePortfolio()
       ├─ apiClient.get<PortfolioSummary>('/api/portfolio')
       ├─ setInterval(refetch, 60_000)  [cleared on unmount]
       └─ returns { data, loading, error, lastFetchedAt }
  ├─ SummaryCards(data)
  ├─ RefreshIndicator(lastFetchedAt)
  └─ PortfolioTable(data.tokens)
       └─ TokenRow[] (each manages its own expanded: boolean state)
            └─ TokenRowExpanded (walletBreakdown entries)
```

### Formatting decisions

All API values are decimal strings (e.g., `"1234.567890123456789"`). The UI needs:
- `formatUSD(str): string` → `"$1,234.57"` (2 decimal places, locale separator)
- `formatCrypto(str): string` → `"0.000001234"` (variable decimals, no truncation below 6 significant figures)
- `formatPct(str): string` → `"+12.34%"` or `"-5.67%"` (sign-prefixed)

These should live in `src/lib/format.ts`.

### Expandable row state

Each `TokenRow` manages its own `expanded: boolean` with local `useState`. No global expanded state needed — rows are independent.

### P&L per wallet in expanded breakdown

`walletBreakdown` from the API has `{ balance, wac }` but no `pnlUsd`. To show per-wallet P&L in the expanded row, the frontend must compute:
```
walletPnlUsd = (currentPrice - wac) × balance   [all decimal strings]
walletPnlPct = (currentPrice - wac) / wac × 100
```
This requires a decimal arithmetic helper. Options:
1. Use the `decimal.js` library (already a transitive dep in the backend — NOT available in frontend bundle).
2. Use native `parseFloat` for display-only computation (acceptable since we're only formatting for display, not for accounting).
3. Create a minimal decimal helper that avoids the worst float drift for display purposes.

**Recommendation**: Use `parseFloat` + `Intl.NumberFormat` for display-only wallet P&L. The accounting truth lives in the backend. Frontend calculations are presentational only.

### Empty state

When `tokens.length === 0`, show: `"Add your first wallet in Settings"` — requires a link or button pointing to a Settings page (US-010+ territory). For US-009, render the text as a static message with a disabled/styled link.

---

## 8. Risks and open questions

| # | Risk / Question | Severity | Notes |
|---|-----------------|----------|-------|
| R1 | **Token logos**: The table requires a Logo column but no logo source is defined in the PRD, the API response, or the DB schema. | HIGH | Options: (a) Coinbase/Trust Wallet CDN logos by contract address, (b) placeholder icon, (c) first-letter avatar. Must be decided before proposal. |
| R2 | **`totalPnlPct` can be `null`**: The API returns `null` when `totalCostBasis = 0`. The SummaryCards component must handle this gracefully (show `—` or `N/A`). | MEDIUM | Low complexity to handle but must not be forgotten. |
| R3 | **`priceUnavailable` tokens in the table**: The API can return rows with `currentPrice: null`. The table must show `—` for Value, P&L columns instead of crashing on null. | MEDIUM | Well-defined behavior from spec — just needs implementation. |
| R4 | **Per-wallet P&L float precision**: Computing P&L client-side with `parseFloat` on large balances can drift. If the design decision is to show exact values, `decimal.js` must be added to the frontend. | MEDIUM | Scope decision: display-only approximation vs. exact. |
| R5 | **60s polling memory leak**: `setInterval` in `useEffect` must be properly cleared on unmount. Standard React pattern but must be explicit in the hook. | LOW | Standard pattern, low risk if implemented via cleanup function. |
| R6 | **`useRelativeTime` tick cost**: Updating "Updated Xs ago" every second creates a 1-second `setInterval`. This is fine but must also be cleared on unmount. | LOW | Standard pattern. |
| R7 | **Settings page doesn't exist yet**: The empty-state CTA links to Settings. If no `/settings` route exists, the link must render as text-only or navigate to `"#"`. | LOW | Deferred to Settings story. |
| R8 | **WAC precision display**: `wacAggregated` can be a very long decimal string (`"0.00000001234567890123"`). The table must truncate for display (e.g., 8 significant figures) without losing the raw value. | LOW | Purely presentational — handled in `formatCrypto()`. |
| R9 | **`walletBreakdown.label` is nullable**: Label can be `null` for unnamed wallets. The expanded row must handle missing label with a fallback (e.g., truncated wallet address or `"Wallet N"`). | LOW | API schema confirms `label: string | null`. |

### Open questions for proposal phase

1. **Logo source**: Which logo provider/strategy? (Affects `TokenRow` API shape and possibly a new API route.)
2. **Per-wallet P&L**: `parseFloat` display approximation or `decimal.js` for exactness?
3. **Table vs. cards layout on mobile**: PRD doesn't specify. Responsive behavior defaults to standard overflow-scroll on mobile?
4. **Skeleton loading vs. spinner**: During initial load (no cached data), show skeleton rows or a centered spinner?
5. **Error state**: If `GET /api/portfolio` returns a non-401 error, what does the UI show? A toast? An inline error banner?
