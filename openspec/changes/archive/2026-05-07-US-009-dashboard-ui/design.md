# Design: US-009 — Dashboard principal UI

> **Change:** `US-009-dashboard-ui`
> **Phase:** sdd-design
> **Date:** 2026-05-07
> **Depends on:** US-007 (Portfolio API — implemented), proposal.md, explore.md
> **Stack:** React 19 + Vite + Tailwind v4 + TypeScript (strict)

---

## 1. File structure

### New files

```
apps/frontend/src/
├── pages/
│   └── DashboardPage.tsx                       [NEW]
├── components/dashboard/
│   ├── SummaryCards.tsx                        [NEW]
│   ├── SummaryCard.tsx                         [NEW]
│   ├── PortfolioTable.tsx                      [NEW]
│   ├── PortfolioRow.tsx                        [NEW]
│   ├── PortfolioRowExpanded.tsx                [NEW]
│   ├── PortfolioTableEmptyState.tsx            [NEW]
│   ├── TokenLogo.tsx                           [NEW]
│   ├── NetworkBadge.tsx                        [NEW]
│   ├── PnlDisplay.tsx                          [NEW]
│   ├── SkeletonRow.tsx                         [NEW]
│   └── RefreshIndicator.tsx                    [NEW]
├── hooks/
│   ├── usePortfolio.ts                         [NEW]
│   └── useRelativeTime.ts                      [NEW]
├── lib/
│   ├── format.ts                               [NEW]
│   └── checksum-address.ts                     [NEW — EIP-55 helper, pure, no deps]
└── types/
    └── portfolio.ts                            [NEW — API response types]
```

### Modified files

```
apps/frontend/src/routes/router.tsx             [MODIFY — replace DashboardPlaceholder import with DashboardPage]
apps/frontend/src/index.css                     [MODIFY — add @theme tokens for binance / pnl-positive / pnl-negative]
```

### Deleted files

```
apps/frontend/src/pages/DashboardPlaceholder.tsx [DELETE — superseded by DashboardPage]
```

### New test files

```
apps/frontend/tests/
├── format.test.ts
├── checksum-address.test.ts
├── use-portfolio.test.ts
├── use-relative-time.test.ts
├── token-logo.test.tsx
├── pnl-display.test.tsx
├── network-badge.test.tsx
├── summary-cards.test.tsx
├── portfolio-row.test.tsx
├── portfolio-row-expanded.test.tsx
├── portfolio-table.test.tsx
└── dashboard-page.test.tsx
```

---

## 2. Types

All types live in `apps/frontend/src/types/portfolio.ts`. They mirror the backend Zod schema from US-007. **All numeric fields are decimal strings**, never JS numbers — this is a hard invariant from the PRD.

```typescript
// apps/frontend/src/types/portfolio.ts

/**
 * Decimal string from the backend (e.g., "1234.567890123456789").
 * Branded only by convention — TypeScript treats it as `string`.
 */
export type DecimalString = string;

export const NETWORK = {
  ETH: "ETH",
  BSC: "BSC",
  CEX_BINANCE: "CEX_BINANCE",
} as const;
export type Network = (typeof NETWORK)[keyof typeof NETWORK];

export const SOURCE_TYPE = {
  ON_CHAIN: "ON_CHAIN",
  CEX: "CEX",
} as const;
export type SourceType = (typeof SOURCE_TYPE)[keyof typeof SOURCE_TYPE];

export interface WalletBreakdown {
  walletId: string;
  label: string | null;
  balance: DecimalString;
  wac: DecimalString;
}

export interface PortfolioItem {
  symbol: string;
  network: Network;
  sourceType: SourceType;
  contractAddress: string;
  binanceSymbol: string | null;
  totalBalance: DecimalString;
  wacAggregated: DecimalString;
  totalCostBasis: DecimalString;
  currentPrice: DecimalString | null;
  totalCurrentValue: DecimalString | null;
  pnlUsd: DecimalString | null;
  pnlPct: DecimalString | null;
  walletCount: number;
  walletBreakdown: WalletBreakdown[];
  priceUnavailable?: boolean;
}

export interface PortfolioSummary {
  totalValueUsd: DecimalString;
  totalCostBasis: DecimalString;
  totalPnlUsd: DecimalString;
  totalPnlPct: DecimalString | null;
}

/**
 * Full GET /api/portfolio response. The backend response is structured as
 * { ...summary, tokens: [] } at the top level; we flatten it through the
 * `summary` and `portfolioItems` accessors at the hook boundary.
 */
export interface PortfolioResponse {
  totalValueUsd: DecimalString;
  totalCostBasis: DecimalString;
  totalPnlUsd: DecimalString;
  totalPnlPct: DecimalString | null;
  tokens: PortfolioItem[];
}
```

**Naming alignment with task brief**:
- `PortfolioItem` corresponds to `tokens[]` entries (the brief calls them `portfolioItems[]` semantically).
- `WalletBreakdown` matches the brief's `WalletBreakdown` exactly.
- `PortfolioSummary` is the top-four-cards subset of the response.
- `PortfolioResponse` is the full wrapper returned by `apiClient.get`.

**Boundary safety**: We do **not** add a Zod `parse` step at the fetch boundary in this story — backend already validates with Zod and the response shape is stable. If a future contract drift becomes a concern, we add a `portfolioResponseSchema.parse()` at the hook layer.

---

## 3. `usePortfolio` hook

### File: `apps/frontend/src/hooks/usePortfolio.ts`

### Signature

```typescript
export interface UsePortfolioResult {
  data: PortfolioResponse | null;
  loading: boolean;          // true ONLY on initial fetch (before first success or first error)
  error: Error | null;       // last non-401 error; cleared on next successful fetch
  lastUpdated: Date | null;  // timestamp of last successful fetch
  isRefetching: boolean;     // true while a background refetch is in flight (data already present)
  refresh: () => Promise<void>;
}

export function usePortfolio(): UsePortfolioResult;
```

### State managed

```typescript
const [data, setData] = useState<PortfolioResponse | null>(null);
const [loading, setLoading] = useState<boolean>(true);
const [error, setError] = useState<Error | null>(null);
const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
const [isRefetching, setIsRefetching] = useState<boolean>(false);

const pollIntervalRef = useRef<number | null>(null);
const isMountedRef = useRef<boolean>(true);
```

### Behavior

**Lifecycle on mount**:
1. Fire initial fetch — `loading=true, isRefetching=false`.
2. Start `setInterval(refresh, 60_000)` — store id in `pollIntervalRef.current`.
3. Register `document.addEventListener('visibilitychange', onVisibility)`.

**`refresh()` (the one shared fetch path)**:
```text
if first call (data === null): loading = true
else: isRefetching = true
try:
  res = await apiClient.get<PortfolioResponse>('/api/portfolio')
  if not mounted: return
  setData(res)
  setLastUpdated(new Date())
  setError(null)
catch (e):
  if e instanceof UnauthorizedError: rethrow → apiClient already redirected
  if not mounted: return
  setError(e)
  // do NOT clear data — stale-while-error is a UX requirement (proposal §3.6)
finally:
  if not mounted: return
  setLoading(false)
  setIsRefetching(false)
```

**Visibility handling**:
- `document.hidden === true` → clear interval (pause polling).
- `document.hidden === false` AND interval is null → call `refresh()` immediately, then re-arm `setInterval(refresh, 60_000)`.

**Cleanup on unmount**:
- `isMountedRef.current = false` — guards async setState.
- Clear poll interval.
- `document.removeEventListener('visibilitychange', ...)`.

**401 contract**: The hook does NOT special-case 401. `apiClient.UnauthorizedError` is thrown after `apiClient` has already triggered the auth bridge redirect. We let it bubble (the dashboard will unmount as the router navigates to `/login`). The `isMountedRef` guard prevents setState after unmount.

**Why background refetch does not flip `loading`**: Setting `loading=true` on the 60s tick would cause the table to unmount and remount, killing scroll position and per-row `expanded` state (proposal §3.2). The decision is enforced by the two-flag pattern (`loading` for initial only, `isRefetching` for background).

### `useRelativeTime` hook

### File: `apps/frontend/src/hooks/useRelativeTime.ts`

```typescript
export function useRelativeTime(date: Date | null): {
  secondsSinceUpdate: number | null;
  label: string;
};
```

- Owns its own `setInterval(1_000)` for the seconds counter.
- `date === null` → `{ secondsSinceUpdate: null, label: 'Never updated' }`.
- 0–59s → `Updated Xs ago`.
- 60–3599s → `Updated Xm ago`.
- ≥ 3600s → `Updated 1h+ ago` (defensive).
- Cleanup clears the interval on unmount or when `date` reference changes.

The brief asked for `secondsSinceUpdate` as a return value — it is returned alongside the formatted `label` so the `RefreshIndicator` can render either form.

---

## 4. Components

### 4.1 `DashboardPage`

**File**: `apps/frontend/src/pages/DashboardPage.tsx`

**Props**: none — it is a route component.

**Composition**:
```tsx
export function DashboardPage() {
  const { data, loading, error, lastUpdated, isRefetching, refresh } = usePortfolio();
  const { label: relativeTime } = useRelativeTime(lastUpdated);

  if (loading && data === null) return <DashboardSkeleton />;
  if (error !== null && data === null) return <DashboardErrorState onRetry={refresh} />;
  if (data === null) return null; // unreachable defensive

  const visibleItems = data.tokens; // backend already filters balance > 0

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Portfolio</h1>
        <RefreshIndicator
          relativeTime={relativeTime}
          isRefetching={isRefetching}
          stale={error !== null}
          onRetry={refresh}
        />
      </header>

      <SummaryCards
        totalValueUsd={data.totalValueUsd}
        totalCostBasis={data.totalCostBasis}
        totalPnlUsd={data.totalPnlUsd}
        totalPnlPct={data.totalPnlPct}
      />

      {visibleItems.length === 0 ? (
        <PortfolioTableEmptyState />
      ) : (
        <PortfolioTable items={visibleItems} />
      )}
    </main>
  );
}
```

**Renders** (rules):
- Initial load (no data, no error) → `<DashboardSkeleton>` (4 placeholder cards + 5 skeleton rows).
- Hard error on initial load (no data, error) → inline error card with Retry button.
- Stale-with-error (data present + error) → renders normally, `RefreshIndicator` shows `stale=true` banner.
- Empty portfolio (`data.tokens.length === 0`) → `PortfolioTableEmptyState`. SummaryCards still render (with the zero values returned by the backend).
- Otherwise → SummaryCards + PortfolioTable.

`DashboardSkeleton` and `DashboardErrorState` are local sub-components defined in `DashboardPage.tsx` (not exported) — they are too small and tightly coupled to warrant separate files.

### 4.2 `SummaryCards`

**File**: `apps/frontend/src/components/dashboard/SummaryCards.tsx`

**Props**:
```typescript
interface SummaryCardsProps {
  totalValueUsd: DecimalString;
  totalCostBasis: DecimalString;
  totalPnlUsd: DecimalString;
  totalPnlPct: DecimalString | null;
}
```

**Renders**: Four `<SummaryCard>` instances inside a CSS grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4`):
1. `Total Portfolio Value` — `formatUsd(totalValueUsd)`, neutral color.
2. `Total Cost Basis` — `formatUsd(totalCostBasis)`, neutral color.
3. `Total P&L` — `formatUsd(totalPnlUsd)`, P&L color (positive/negative/zero).
4. `Total P&L %` — `formatPct(totalPnlPct)` or `—` if null. P&L color when not null.

### 4.3 `SummaryCard`

**File**: `apps/frontend/src/components/dashboard/SummaryCard.tsx`

**Props**:
```typescript
interface SummaryCardProps {
  label: string;
  value: string;          // already formatted by caller
  pnlSign?: "positive" | "negative" | "neutral"; // optional coloring
  testId?: string;
}
```

**Renders**: `<article>` with `bg-gray-900 rounded-lg p-4`. Contains a small `<span class="text-gray-400 text-sm">{label}</span>` and a large `<span class="text-2xl font-semibold {colorClass}">{value}</span>`.

**Color rules**: When `pnlSign === 'positive'` → `text-pnl-positive`; `negative` → `text-pnl-negative`; `neutral` (default) → `text-white`.

### 4.4 `PortfolioTable`

**File**: `apps/frontend/src/components/dashboard/PortfolioTable.tsx`

**Props**:
```typescript
interface PortfolioTableProps {
  items: PortfolioItem[];
}
```

**Renders**: A semantic `<table>` wrapped in an `overflow-x-auto` div for horizontal scroll on small screens.

**Header columns** (matches AC#2 exactly):
| | Logo | Symbol | Network/Source | Balance Total | Current Price | Current Value | WAC | Cost Basis | P&L ($) | P&L (%) |

(The leading empty column holds the expand chevron.)

Each item maps to a `<PortfolioRow>` keyed by `${item.network}-${item.contractAddress}` (network is included because ETH on-chain and ETH on Binance must NEVER share a key — domain invariant).

### 4.5 `PortfolioRow`

**File**: `apps/frontend/src/components/dashboard/PortfolioRow.tsx`

**Props**:
```typescript
interface PortfolioRowProps {
  item: PortfolioItem;
}
```

**Local state**: `const [expanded, setExpanded] = useState(false);` — proposal §3.5 (no global expanded set).

**Renders** (collapsed `<tr>`):
1. Chevron `<button aria-expanded={expanded}>` — rotates 90° when open.
2. `<TokenLogo>` (symbol + contract + network + sourceType).
3. `{item.symbol}` text + if `walletCount > 1` (ON_CHAIN only): a small badge `{walletCount} wallets`.
4. `<NetworkBadge>` for `network`/`sourceType`.
5. `formatCrypto(item.totalBalance)`.
6. `item.priceUnavailable === true || item.currentPrice === null` → `—`. Else `formatUsd(item.currentPrice)`.
7. `item.totalCurrentValue === null` → `—`. Else `formatUsd(item.totalCurrentValue)`.
8. `formatCrypto(item.wacAggregated)`.
9. `formatUsd(item.totalCostBasis)`.
10. `<PnlDisplay value={item.pnlUsd} kind="usd" />`.
11. `<PnlDisplay value={item.pnlPct} kind="pct" />`.

When `expanded === true`, a second `<tr>` follows with one `<td colSpan={11}>` containing `<PortfolioRowExpanded>`.

**Why include the expanded row inside `PortfolioRow`**: Keeping the toggle-and-detail pair colocated makes accessibility (keyboard navigation, `aria-expanded` linking) trivial and avoids prop-drilling expand state to the table.

### 4.6 `PortfolioRowExpanded`

**File**: `apps/frontend/src/components/dashboard/PortfolioRowExpanded.tsx`

**Props**:
```typescript
interface PortfolioRowExpandedProps {
  item: PortfolioItem;
}
```

**Renders**:

For **CEX** (`item.sourceType === 'CEX'`): a single sub-row labeled `Binance Account`, showing balance, wac (from the single `walletBreakdown[0]`), computed pnlUsd/pnlPct.

For **ON_CHAIN**: a sub-row per `walletBreakdown` entry. Label fallback rules:
- `entry.label` if non-null and non-empty.
- Else `entry.walletId.slice(0, 6) + "…" + entry.walletId.slice(-4)` (truncated address-style).

**Per-wallet P&L computation** (proposal §3.3 — display-only `parseFloat`):
```typescript
const balance = parseFloat(entry.balance);
const wac = parseFloat(entry.wac);
const priceStr = item.currentPrice;

let pnlUsd: number | null = null;
let pnlPct: number | null = null;
if (priceStr !== null && !item.priceUnavailable) {
  const price = parseFloat(priceStr);
  pnlUsd = (price - wac) * balance;
  pnlPct = wac > 0 ? ((price - wac) / wac) * 100 : null;
}
```

`<PnlDisplay>` accepts `number | null` as well as `DecimalString | null`.

Sub-row layout: an inner table with columns `Label | Balance | WAC | Cost Basis | P&L ($) | P&L (%)`. Background: slightly darker than the outer row (`bg-gray-950/50`) to communicate hierarchy.

### 4.7 `PortfolioTableEmptyState`

**File**: `apps/frontend/src/components/dashboard/PortfolioTableEmptyState.tsx`

**Props**: none.

**Renders**: A centered card with the message "Add your first wallet in Settings" and a styled `<Link to="/settings">` underneath. The link will 404 until US-010 ships — accepted (proposal §7).

### 4.8 `TokenLogo`

**File**: `apps/frontend/src/components/dashboard/TokenLogo.tsx`

**Props**:
```typescript
interface TokenLogoProps {
  symbol: string;
  contractAddress: string;
  network: Network;
  sourceType: SourceType;
  size?: number; // default 32
}
```

**Renders**:

If `sourceType === 'ON_CHAIN'`:
- Compute `checksumAddress = toChecksumAddress(contractAddress)` via the local `checksum-address.ts` helper.
- Render `<img src={trustWalletUrl(network, checksumAddress)} alt={symbol} onError={...}>`.
- On error → swap `src` to a data-URI letter avatar (or render an inline `<span>` letter avatar by toggling local `failed` state).

If `sourceType === 'CEX'`:
- Render letter avatar directly. No CDN call (proposal §3.1 — Binance has no addressable per-symbol CDN).

**Trust Wallet URL helper** (in same file, exported for testing):
```typescript
export function trustWalletUrl(network: Network, checksumAddress: string): string | null {
  if (network === NETWORK.ETH) {
    return `https://assets.trustwalletapp.com/blockchains/ethereum/assets/${checksumAddress}/logo.png`;
  }
  if (network === NETWORK.BSC) {
    return `https://assets.trustwalletapp.com/blockchains/smartchain/assets/${checksumAddress}/logo.png`;
  }
  return null; // CEX_BINANCE → no CDN
}
```

**Letter avatar**:
```typescript
function letterAvatar(symbol: string): { letter: string; bgColor: string; fgColor: string } {
  const letter = (symbol[0] ?? "?").toUpperCase();
  const hash = simpleHash(symbol); // pure, deterministic
  const hue = hash % 360;
  return { letter, bgColor: `hsl(${hue}, 60%, 35%)`, fgColor: "#ffffff" };
}
```

The HSL color is the only place where `style={{}}` is permitted (Tailwind v4 rule: dynamic computed values only).

### 4.9 `NetworkBadge`

**File**: `apps/frontend/src/components/dashboard/NetworkBadge.tsx`

**Props**:
```typescript
interface NetworkBadgeProps {
  network: Network;
  sourceType: SourceType;
}
```

**Renders** (small pill, rounded, uppercase text):
- `network === 'ETH'` → label `Ethereum`, classes `bg-gray-700 text-gray-100`.
- `network === 'BSC'` → label `BSC`, classes `bg-gray-700 text-gray-100`.
- `network === 'CEX_BINANCE'` (or `sourceType === 'CEX'`) → label `Binance`, classes `bg-binance text-black` (yellow #F0B90B).

The `bg-binance` token is defined in `index.css` `@theme` (see §6 Color tokens).

### 4.10 `PnlDisplay`

**File**: `apps/frontend/src/components/dashboard/PnlDisplay.tsx`

**Props**:
```typescript
interface PnlDisplayProps {
  value: DecimalString | number | null;
  kind: "usd" | "pct";
}
```

**Renders**:
- `value === null` → `<span class="text-gray-400">—</span>`.
- Else: convert to `number` for sign detection (via `parseFloat` if string, else as-is). Format using `formatUsd` (kind=`usd`) or `formatPct` (kind=`pct`). Apply class `text-pnl-positive` if `> 0`, `text-pnl-negative` if `< 0`, `text-gray-300` if `=== 0`.

### 4.11 `SkeletonRow`

**File**: `apps/frontend/src/components/dashboard/SkeletonRow.tsx`

**Props**: none.

**Renders**: A `<tr>` with 11 `<td>` cells, each containing an animated gray placeholder (`animate-pulse bg-gray-800 h-4 rounded`). Used by `DashboardSkeleton` inside `DashboardPage`.

### 4.12 `RefreshIndicator`

**File**: `apps/frontend/src/components/dashboard/RefreshIndicator.tsx`

**Props**:
```typescript
interface RefreshIndicatorProps {
  relativeTime: string;     // "Updated 12s ago" | "Never updated" | ...
  isRefetching: boolean;
  stale: boolean;           // true when last refetch failed
  onRetry: () => void;
}
```

**Renders**:
- Pulse dot (`bg-pnl-positive` when fresh, `bg-pnl-negative` when stale, animated when `isRefetching`).
- The `relativeTime` text.
- If `stale`: a small `[Retry]` button calling `onRetry`.

---

## 5. Data flow

```
                    ┌────────────────────────────────────┐
                    │         DashboardPage              │
                    │  (route component, no props)       │
                    └─────────────┬──────────────────────┘
                                  │ calls
                                  ▼
                    ┌────────────────────────────────────┐
                    │     usePortfolio()                 │
                    │  → apiClient.get<PortfolioResponse>│
                    │       ('/api/portfolio')           │
                    │  → setInterval(60_000)             │
                    │  → visibilitychange listener       │
                    │  returns: data, loading, error,    │
                    │           lastUpdated, isRefetching│
                    └─────────────┬──────────────────────┘
                                  │
                                  │ data
              ┌───────────────────┼───────────────────┐
              │                   │                   │
              ▼                   ▼                   ▼
     ┌────────────────┐  ┌────────────────┐  ┌────────────────────┐
     │ SummaryCards   │  │RefreshIndicator│  │  PortfolioTable    │
     │ (summary 4 nums│  │(relativeTime)  │  │  (items[])         │
     │ via            │  │                │  │                    │
     │ useRelativeTime│  │                │  │                    │
     │ if needed)     │  │                │  │                    │
     └────────┬───────┘  └────────────────┘  └─────────┬──────────┘
              │                                        │ map
              ▼                                        ▼
     ┌────────────────┐                       ┌────────────────────┐
     │ SummaryCard ×4 │                       │ PortfolioRow       │
     └────────────────┘                       │  (own expand state)│
                                              └─────────┬──────────┘
                                                        │ when expanded
                                                        ▼
                                              ┌────────────────────┐
                                              │PortfolioRowExpanded│
                                              │ (per-wallet rows;  │
                                              │  computes pnl via  │
                                              │  parseFloat)       │
                                              └────────────────────┘
```

Supporting primitives (`TokenLogo`, `NetworkBadge`, `PnlDisplay`, `SkeletonRow`) are leaf components used by `PortfolioRow`, `PortfolioRowExpanded`, and `SummaryCards`.

---

## 6. Trust Wallet logo URL

### URL pattern

```typescript
// apps/frontend/src/components/dashboard/TokenLogo.tsx (helper)
function trustWalletUrl(network: Network, checksumAddress: string): string | null {
  switch (network) {
    case "ETH":
      return `https://assets.trustwalletapp.com/blockchains/ethereum/assets/${checksumAddress}/logo.png`;
    case "BSC":
      return `https://assets.trustwalletapp.com/blockchains/smartchain/assets/${checksumAddress}/logo.png`;
    case "CEX_BINANCE":
      return null;
    default: {
      const _exhaustive: never = network;
      return _exhaustive;
    }
  }
}
```

### Checksum address

Trust Wallet's repository keys files by EIP-55 checksum address. Lowercase addresses 404. We compute checksum client-side via a tiny pure helper.

**File**: `apps/frontend/src/lib/checksum-address.ts`

EIP-55 requires `keccak256` of the lowercase ASCII address. `keccak256` is not in the Node/web standard library. Options considered:

1. **Add `viem` (or `ethers`)** — pulls a multi-MB dep for one function. **Rejected.**
2. **Inline `js-sha3` (~3KB gz)** — minimal pure-JS keccak. **Selected.**
3. **Skip checksum (use lowercase)** — Trust Wallet 404s on lowercase. The fallback letter-avatar would always trigger. **Rejected** (defeats the purpose of the CDN).

**Decision**: Add `js-sha3` (3KB gz, zero deps) as a frontend dependency. The helper:

```typescript
import { keccak_256 } from "js-sha3";

export function toChecksumAddress(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, "");
  const hash = keccak_256(lower);
  let result = "0x";
  for (let i = 0; i < lower.length; i++) {
    const c = lower[i] ?? "";
    const h = hash[i] ?? "0";
    result += parseInt(h, 16) >= 8 ? c.toUpperCase() : c;
  }
  return result;
}
```

If the user objects to adding `js-sha3`, the fallback is to **always** use the letter avatar (skip the CDN). This is a one-line config change in `TokenLogo.tsx` and degrades the UX from "logos when known" to "always letter-avatar". Document this fallback in the task list as an alternative path.

### Letter-avatar (CEX, fallback, and unknown)

For `sourceType === 'CEX'`, on Trust Wallet 404, or on any image load error:

```typescript
function letterAvatar(symbol: string): { letter: string; bgColor: string } {
  const letter = (symbol[0] ?? "?").toUpperCase();
  const hue = simpleHash(symbol) % 360;
  return { letter, bgColor: `hsl(${hue}, 60%, 35%)` };
}

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
```

Rendered as a `<span>` with `style={{ backgroundColor: bgColor }}` (the only sanctioned `style={{}}` use — dynamic computed value per Tailwind v4 rules).

---

## 7. Key implementation notes

### 7.1 `apiClient` already handles auth headers

The existing `apiClient.get<T>('/api/portfolio')` sets `credentials: 'include'` and intercepts 401 → redirect-to-login via the auth bridge. No new abstraction is needed in this story (proposal §3.4). The hook calls it directly.

### 7.2 `walletBreakdown` per-wallet P&L computation

The API does NOT include `pnlUsd` per wallet entry. The frontend computes:

```typescript
const balance = parseFloat(b.balance);
const wac = parseFloat(b.wac);
const pricePresent = item.currentPrice !== null && item.priceUnavailable !== true;
const pnlUsd = pricePresent
  ? (parseFloat(item.currentPrice as string) - wac) * balance
  : null;
const pnlPct = pricePresent && wac > 0
  ? ((parseFloat(item.currentPrice as string) - wac) / wac) * 100
  : null;
```

This is **display-only float arithmetic** — the proposal explicitly accepts the precision tradeoff (proposal §3.3, §7). The backend retains accounting truth via decimal arithmetic.

The brief's hint formula `parseFloat(b.balance) * (parseFloat(item.currentPriceUsd ?? '0') - parseFloat(b.wacUsd))` is functionally equivalent. We choose the explicit `priceUnavailable` guard form to avoid silently displaying "$0" P&L when price is unavailable.

### 7.3 `priceUnavailable: true` rendering rules

When a row has `priceUnavailable === true` OR `currentPrice === null`:

| Column | Rendered as |
|--------|-------------|
| Logo | normal |
| Symbol | normal |
| Network/Source | normal |
| Balance Total | normal (`formatCrypto`) |
| Current Price | `—` |
| Current Value | `—` |
| WAC | normal (`formatCrypto`) |
| Cost Basis | normal (`formatUsd`) |
| P&L ($) | `—` |
| P&L (%) | `—` |

The `—` is rendered through `<PnlDisplay value={null} ... />` for P&L columns and a plain `<span class="text-gray-400">—</span>` for Current Price / Current Value (matches proposal §3.6).

### 7.4 `totalPnlPct: null` rendering

Backend returns `null` when `totalCostBasis === 0`. The 4th summary card displays `—` (via `formatPct(null)` → returns `"—"`, or via `<PnlDisplay value={null} kind="pct">`). The dollar P&L card still renders normally (it can be `0` without ambiguity).

### 7.5 Empty portfolio after filtering

The backend already excludes `balance = 0` positions server-side (explore.md §2). Therefore:
- `data.tokens` arriving is the post-filter set.
- Empty portfolio detection: `data.tokens.length === 0`.
- This branch renders `<PortfolioTableEmptyState>` (the message "Add your first wallet in Settings" with a link to `/settings`).

The SummaryCards STILL render in this case (with the all-zeros backend response). This makes the empty-state experience feel structured rather than blank.

### 7.6 React 19 / Tailwind v4 compliance

- **No `useMemo` / `useCallback`** anywhere — React Compiler handles memoization (proposal §5, project standards).
- **No `forwardRef`** — `ref` is a regular prop in React 19. No component in this design needs ref forwarding.
- **No default exports** — every new file uses named exports only.
- **`cn()` for conditional classes** — `apps/frontend/src/lib/cn.ts` is already available.
- **`style={{}}` only for dynamic computed values** — the single permitted use is the letter-avatar `backgroundColor: \`hsl(${hue}, ...)\``. Everything else is Tailwind classes.
- **`@theme` tokens** in `index.css`:
  ```css
  @theme {
    --color-binance: #F0B90B;
    --color-pnl-positive: #22C55E;
    --color-pnl-negative: #EF4444;
  }
  ```
  Tailwind v4 generates `bg-binance`, `text-binance`, `text-pnl-positive`, `text-pnl-negative` automatically.

### 7.7 Format helpers (`apps/frontend/src/lib/format.ts`)

```typescript
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatUsd(value: DecimalString | number | null): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "number" ? value : parseFloat(value);
  if (Number.isNaN(n)) return "—";
  return usdFormatter.format(n);
}

export function formatPct(value: DecimalString | number | null): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "number" ? value : parseFloat(value);
  if (Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function formatCrypto(value: DecimalString | number | null): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "number" ? value : parseFloat(value);
  if (Number.isNaN(n)) return "—";
  // 8 significant figures, no scientific notation, drop trailing zeros
  return Number.parseFloat(n.toPrecision(8)).toString();
}
```

Tested standalone in `tests/format.test.ts` (covers null, NaN, zero, positive, negative, very small, very large).

### 7.8 Test strategy (Strict TDD mode)

Each component / hook / helper has a paired test file. Order of authoring (test first → implementation):

1. `format.test.ts` → `format.ts`
2. `checksum-address.test.ts` → `checksum-address.ts` (vector cases from EIP-55 spec)
3. `use-relative-time.test.ts` → `useRelativeTime.ts` (vi.useFakeTimers)
4. `use-portfolio.test.ts` → `usePortfolio.ts` (mock `apiClient`, fake timers; assert no leaked intervals on unmount)
5. `pnl-display.test.tsx` → `PnlDisplay.tsx`
6. `network-badge.test.tsx` → `NetworkBadge.tsx`
7. `token-logo.test.tsx` → `TokenLogo.tsx` (mock Image.onError)
8. `summary-cards.test.tsx` → `SummaryCards.tsx`
9. `portfolio-row.test.tsx` → `PortfolioRow.tsx` (expand toggle, priceUnavailable rendering)
10. `portfolio-row-expanded.test.tsx` → `PortfolioRowExpanded.tsx` (CEX label, fallback label, computed P&L)
11. `portfolio-table.test.tsx` → `PortfolioTable.tsx` (header columns, row keys distinguish ETH-on-chain vs ETH-on-Binance)
12. `dashboard-page.test.tsx` → `DashboardPage.tsx` (integration: mock apiClient, assert skeleton → cards → table progression; assert empty state; assert error retry)

Domain-invariant test (mandatory): `portfolio-table.test.tsx` includes a fixture with both `(symbol='ETH', network='ETH')` and `(symbol='ETH', network='CEX_BINANCE')` and asserts that two distinct rows are rendered with distinct values. This codifies the PRD invariant in test form.

---

## 8. Decisions made (summary)

1. **No new global state library and no data-fetching library** — single hook, single endpoint (proposal §3.2, §3.4).
2. **`PortfolioResponse` flat shape** — types live in `src/types/portfolio.ts` and mirror the backend response 1:1, no Zod re-validation in this story.
3. **Two-flag loading model in `usePortfolio`** — `loading` (initial only) + `isRefetching` (background) — preserves expand state and scroll.
4. **Visibility-aware polling** — pause on tab hide, resume + immediate refetch on show. Free win, ~zero implementation cost.
5. **Per-row `useState` for expand state** — no global expanded set (proposal §3.5).
6. **`parseFloat` for per-wallet P&L** — display-only; backend retains accounting truth (proposal §3.3).
7. **Trust Wallet CDN with EIP-55 checksum** — adds `js-sha3` (3KB gz). Letter-avatar fallback for CEX, unknown, and image errors.
8. **`@theme` color tokens** for `--color-binance`, `--color-pnl-positive`, `--color-pnl-negative` — keeps style class-first (Tailwind v4 native).
9. **Accessibility**: `<button aria-expanded={expanded}>` for the chevron; semantic `<table>`/`<thead>`/`<tbody>`/`<tr>`/`<th scope="col">`.
10. **Domain invariant codified in tests**: ETH on-chain vs ETH on Binance rendered as two distinct rows — test fixture proves the row key strategy enforces it.
