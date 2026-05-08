# US-010 Token Detail UI — Technical Design

## 1. File Structure

### Backend (changes to existing files only — no new files)

```
apps/backend/src/
├── types/
│   └── portfolio.ts          MODIFY — extend TokenPortfolioRowSchema + TransactionWithPnlSchema
└── services/
    ├── portfolio.ts           MODIFY — buildPortfolioRow, TxRow, getTokenDetail SQL + mapper
    └── __tests__/
        └── portfolio.test.ts  MODIFY — update fixtures + add cycleNumber / txHash / cexTradeId / relatedTxId assertions
```

### Frontend (all new files)

```
apps/frontend/src/
├── types/
│   └── token-detail.ts        NEW — TokenDetail, TransactionWithPnl, PnlInfo, PositionHistoryResponse
├── hooks/
│   ├── useTokenDetail.ts      NEW — polls /api/portfolio/token/:contractAddress/:network
│   ├── usePositionHistory.ts  NEW — one-shot /api/portfolio/token/:contractAddress/:network/history
│   └── useWallets.ts          NEW — one-shot /api/wallets
├── pages/
│   ├── TokenDetailPage.tsx    NEW — page root, wallet selector state, routing params
│   └── PositionHistoryPage.tsx NEW — minimal closed-cycle list
├── components/
│   └── token-detail/
│       ├── TokenDetailHeader.tsx   NEW — logo, badges, CycleBadge, WalletSelector, ClosedCyclesLink
│       ├── TokenStatsCards.tsx     NEW — 6 stat cards (Balance, Price, Value, WAC, Cost Basis, P&L)
│       ├── TransactionTable.tsx    NEW — table with badge columns
│       ├── TypeBadge.tsx           NEW — BUY/SELL/SWAP_IN/SWAP_OUT/TRANSFER_IN/TRANSFER_OUT
│       ├── SourceBadge.tsx         NEW — ETHERSCAN/BSCTRACE/BINANCE
│       ├── CostSourceBadge.tsx     NEW — INHERITED/MANUAL/MARKET with tooltip
│       ├── CycleBadge.tsx          NEW — "CYCLE #N" or "CYCLE #—"
│       ├── WalletSelector.tsx      NEW — <select> over walletBreakdown entries
│       └── WithTooltip.tsx         NEW — group/group-hover wrapper
└── routes/
    └── router.tsx             MODIFY — add 2 protected routes
```

### Tests

```
apps/frontend/src/
├── hooks/
│   ├── useTokenDetail.test.ts      NEW
│   └── usePositionHistory.test.ts  NEW
├── pages/
│   ├── TokenDetailPage.test.tsx    NEW
│   └── PositionHistoryPage.test.tsx NEW
└── components/token-detail/
    ├── TransactionTable.test.tsx   NEW
    ├── TypeBadge.test.tsx          NEW
    ├── CostSourceBadge.test.tsx    NEW
    └── WithTooltip.test.tsx        NEW
```

---

## 2. Backend Changes

### 2.1 TokenPortfolioRowSchema extension

File: `apps/backend/src/types/portfolio.ts`

Add one field to `TokenPortfolioRowSchema` (after `walletBreakdown`):

```typescript
cycleNumber: z.number().int().nonnegative(),
```

The updated schema becomes:

```typescript
export const TokenPortfolioRowSchema = z.object({
  // ... existing fields unchanged ...
  walletBreakdown: z.array(WalletBreakdownEntrySchema),
  cycleNumber: z.number().int().nonnegative(),    // ← ADD
  priceUnavailable: z.boolean().optional(),
});
```

`cycleNumber` is non-nullable: `buildVirtualPosition` always sets `maxCycle ≥ 1` for OPEN positions. No sentinel value needed — a null would imply "no position" which is already expressed by `position === null` at the `TokenDetailSchema` level.

### 2.2 TransactionWithPnlSchema extension

File: `apps/backend/src/types/portfolio.ts`

Add three nullable fields to `TransactionWithPnlSchema` (after `costSource`):

```typescript
txHash:      z.string().nullable(),
cexTradeId:  z.string().nullable(),
relatedTxId: z.string().nullable(),
```

The updated schema:

```typescript
export const TransactionWithPnlSchema = z.object({
  // ... existing fields unchanged ...
  costSource: z.enum(COST_SOURCES).nullable(),
  txHash:      z.string().nullable(),   // ← ADD
  cexTradeId:  z.string().nullable(),   // ← ADD
  relatedTxId: z.string().nullable(),   // ← ADD
  pnl: PnlInfoSchema,
});
```

All three are nullable: CEX transactions have no `tx_hash`; on-chain transactions have no `cex_trade_id`. `related_tx_id` is null for non-swap transactions.

### 2.3 Query changes

#### TxRow internal type (`apps/backend/src/services/portfolio.ts`)

Extend `TxRow` to include the three new columns:

```typescript
interface TxRow {
  id: string;
  wallet_id: string;
  token_id: string;
  position_id: string | null;
  type: TransactionType;
  source: TransactionSource;
  block_timestamp: Date | string;
  amount: string;
  price_usd: string | null;
  cost_source: CostSource | null;
  tx_hash: string | null;        // ← ADD
  cex_trade_id: string | null;   // ← ADD
  related_tx_id: string | null;  // ← ADD
}
```

#### `getTokenDetail` SQL SELECT (step 5, around line 357)

Change:

```sql
SELECT id, wallet_id, token_id, position_id, type, source,
       block_timestamp, amount, price_usd, cost_source
  FROM transactions
```

To:

```sql
SELECT id, wallet_id, token_id, position_id, type, source,
       block_timestamp, amount, price_usd, cost_source,
       tx_hash, cex_trade_id, related_tx_id
  FROM transactions
```

No migration required — these columns already exist on the `transactions` table.

#### Transaction mapper (step 6, around line 368)

Add three lines to the return literal:

```typescript
txHash:      tx.tx_hash      ?? null,
cexTradeId:  tx.cex_trade_id ?? null,
relatedTxId: tx.related_tx_id ?? null,
```

#### `buildPortfolioRow` — cycleNumber propagation

Add one field to the return literal (around line 135):

```typescript
cycleNumber: virtual.cycleNumber,
```

`virtual` is `PositionState` which already has `cycleNumber: maxCycle` set in `buildVirtualPosition`. This is the one-liner fix described in the proposal.

#### wallet_id filter support

Already implemented — `getTokenDetail` already accepts `walletId?: string` and the route passes `query.wallet_id`. No changes needed here.

---

## 3. Frontend Architecture

### 3.1 Types (`apps/frontend/src/types/token-detail.ts`)

Mirror the updated backend schemas. All numeric fields are `DecimalString` (string, per PRD invariant).

```typescript
import type { DecimalString, Network } from "./portfolio";

export const TRANSACTION_TYPE = {
  BUY:          "BUY",
  SELL:         "SELL",
  SWAP_IN:      "SWAP_IN",
  SWAP_OUT:     "SWAP_OUT",
  TRANSFER_IN:  "TRANSFER_IN",
  TRANSFER_OUT: "TRANSFER_OUT",
} as const;
export type TransactionType = (typeof TRANSACTION_TYPE)[keyof typeof TRANSACTION_TYPE];

export const TRANSACTION_SOURCE = {
  ETHERSCAN: "ETHERSCAN",
  BSCTRACE:  "BSCTRACE",
  BINANCE:   "BINANCE",
  MANUAL:    "MANUAL",
} as const;
export type TransactionSource = (typeof TRANSACTION_SOURCE)[keyof typeof TRANSACTION_SOURCE];

export const COST_SOURCE = {
  MARKET:    "MARKET",
  INHERITED: "INHERITED",
  MANUAL:    "MANUAL",
} as const;
export type CostSource = (typeof COST_SOURCE)[keyof typeof COST_SOURCE];

export type PnlInfo =
  | { kind: "INBOUND"; lotPnlUsd: DecimalString | null; lotPnlPct: DecimalString | null }
  | { kind: "OUTBOUND"; displayAs: "Sold/Out" };

export interface TokenInfo {
  id: string;
  symbol: string;
  name: string | null;
  network: Network;
  contractAddress: string;
  binanceSymbol: string | null;
  decimals: number;
  targetExitPrice: DecimalString | null;
}

export interface WalletBreakdown {
  walletId: string;
  label: string | null;
  balance: DecimalString;
  wac: DecimalString;
}

export interface PositionStats {
  symbol: string;
  network: Network;
  sourceType: "ON_CHAIN" | "CEX";
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
  cycleNumber: number;
  priceUnavailable?: boolean;
}

export interface TransactionWithPnl {
  id: string;
  walletId: string;
  tokenId: string;
  positionId: string | null;
  type: TransactionType;
  source: TransactionSource;
  blockTimestamp: string;
  amount: DecimalString;
  priceUsd: DecimalString | null;
  costSource: CostSource | null;
  txHash: string | null;
  cexTradeId: string | null;
  relatedTxId: string | null;
  pnl: PnlInfo;
}

export interface TokenDetail {
  token: TokenInfo;
  position: PositionStats | null;
  transactions: TransactionWithPnl[];
  priceUnavailable?: boolean;
}

export interface PositionHistoryEntry {
  cycleNumber: number;
  openedAt: string;
  closedAt: string;
  realizedPnlUsd: DecimalString;
}

export interface PositionHistoryResponse {
  cycles: PositionHistoryEntry[];
}
```

### 3.2 Hook: useTokenDetail

File: `apps/frontend/src/hooks/useTokenDetail.ts`

Signature:

```typescript
export interface UseTokenDetailResult {
  data: TokenDetail | null;
  loading: boolean;
  error: Error | null;
  lastUpdated: Date | null;
  isRefetching: boolean;
  refresh: () => Promise<void>;
}

export function useTokenDetail(
  contractAddress: string,
  network: string,
  walletId?: string,
): UseTokenDetailResult
```

Polling logic — modeled directly on `usePortfolio`:

- Internal state: `data`, `loading`, `error`, `lastUpdated`, `isRefetching`
- Refs: `isMountedRef`, `pollIntervalRef`, `isFetchingRef`, `dataRef`, `refreshRef`
- `refresh()`: guards with `isFetchingRef`, sets `loading` (first fetch) or `isRefetching` (subsequent), calls `apiClient.get<TokenDetail>` with URL built from params, stale-while-error (never clears `data` on error)
- `useEffect` (deps `[contractAddress, network, walletId]`): initial fetch → setInterval 30 000ms → visibilitychange handler (pause on hidden, immediate refetch + re-arm on visible) → cleanup on unmount
- URL construction: `/api/portfolio/token/${contractAddress}/${network}${walletId ? `?wallet_id=${walletId}` : ""}`
- On `UnauthorizedError`: re-throw (let auth context handle redirect), reset `isFetchingRef`

**Key difference from `usePortfolio`**: deps array includes `[contractAddress, network, walletId]` — the effect re-runs when any of these change (wallet selector switch triggers a full re-fetch cycle restart).

### Hook: usePositionHistory

File: `apps/frontend/src/hooks/usePositionHistory.ts`

```typescript
export interface UsePositionHistoryResult {
  data: PositionHistoryResponse | null;
  loading: boolean;
  error: Error | null;
}

export function usePositionHistory(
  contractAddress: string,
  network: string,
): UsePositionHistoryResult
```

- One-shot fetch (no polling, no interval)
- Deps: `[contractAddress, network]`
- URL: `/api/portfolio/token/${contractAddress}/${network}/history`

### Hook: useWallets

File: `apps/frontend/src/hooks/useWallets.ts`

```typescript
export interface WalletEntry {
  id: string;
  label: string | null;
  walletType: "ON_CHAIN" | "CEX";
  network: string;
}

export interface UseWalletsResult {
  data: WalletEntry[] | null;
  loading: boolean;
  error: Error | null;
}

export function useWallets(): UseWalletsResult
```

- One-shot fetch from `/api/wallets`
- Used only to provide label text for WalletSelector options; `walletBreakdown` inside `position` already has `walletId` + `label` so this hook may be redundant — the WalletSelector can derive options directly from `position.walletBreakdown`. See §4.3.

### 3.3 Component Hierarchy

```
TokenDetailPage                     apps/frontend/src/pages/TokenDetailPage.tsx
├── (loading state) SkeletonDetail  — inline or minimal skeleton divs
├── (error state) ErrorBanner       — inline <p> with error.message
├── TokenDetailHeader               apps/frontend/src/components/token-detail/TokenDetailHeader.tsx
│   ├── TokenLogo                   apps/frontend/src/components/dashboard/TokenLogo.tsx  (reused)
│   ├── NetworkBadge                apps/frontend/src/components/dashboard/NetworkBadge.tsx  (reused)
│   ├── CycleBadge                  apps/frontend/src/components/token-detail/CycleBadge.tsx
│   ├── WalletSelector              apps/frontend/src/components/token-detail/WalletSelector.tsx
│   └── ClosedCyclesLink            — inline <Link> inside TokenDetailHeader
├── TokenStatsCards                 apps/frontend/src/components/token-detail/TokenStatsCards.tsx
│   └── PnlDisplay                  apps/frontend/src/components/dashboard/PnlDisplay.tsx  (reused)
└── TransactionTable | EmptyState   apps/frontend/src/components/token-detail/TransactionTable.tsx
    ├── TypeBadge                   apps/frontend/src/components/token-detail/TypeBadge.tsx
    ├── SourceBadge                 apps/frontend/src/components/token-detail/SourceBadge.tsx
    ├── CostSourceBadge             apps/frontend/src/components/token-detail/CostSourceBadge.tsx
    │   └── WithTooltip             apps/frontend/src/components/token-detail/WithTooltip.tsx
    └── PnlDisplay                  (reused)

PositionHistoryPage                 apps/frontend/src/pages/PositionHistoryPage.tsx
├── BackLink                        — inline <Link>
└── CycleCard × N                  — inline component inside PositionHistoryPage
    ├── CycleBadge                  (reused)
    └── PnlDisplay                  (reused)
```

### 3.4 Routing additions (`apps/frontend/src/routes/router.tsx`)

Add two routes after the existing `/` route:

```typescript
import { TokenDetailPage }       from "../pages/TokenDetailPage";
import { PositionHistoryPage }   from "../pages/PositionHistoryPage";

// Inside createBrowserRouter([...]):
{
  path: "/token/:contractAddress/:network",
  element: (
    <ProtectedRoute>
      <TokenDetailPage />
    </ProtectedRoute>
  ),
},
{
  path: "/token/:contractAddress/:network/history",
  element: (
    <ProtectedRoute>
      <PositionHistoryPage />
    </ProtectedRoute>
  ),
},
```

Also add a `<Link>` on the symbol cell in `PortfolioRow.tsx`:

```typescript
import { Link } from "react-router-dom";

// Replace the <span> for item.symbol with:
<Link
  to={`/token/${item.contractAddress}/${item.network}`}
  className="font-medium text-white hover:text-blue-400"
>
  {item.symbol}
</Link>
```

---

## 4. Component Designs

### 4.1 TokenDetailPage

File: `apps/frontend/src/pages/TokenDetailPage.tsx`

```typescript
// Routing params extracted via useParams()
// State: selectedWalletId (string | undefined)
// Validates network against NETWORK constant; redirects to "/" on invalid

import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { useTokenDetail } from "../hooks/useTokenDetail";
import { NETWORK } from "../types/portfolio";
import { TokenDetailHeader } from "../components/token-detail/TokenDetailHeader";
import { TokenStatsCards }   from "../components/token-detail/TokenStatsCards";
import { TransactionTable }  from "../components/token-detail/TransactionTable";

export function TokenDetailPage() {
  const { contractAddress, network } = useParams<{
    contractAddress: string;
    network: string;
  }>();
  const navigate = useNavigate();
  const [selectedWalletId, setSelectedWalletId] = useState<string | undefined>();

  // Guard: invalid network → redirect
  useEffect(() => {
    if (!network || !(Object.values(NETWORK) as string[]).includes(network)) {
      void navigate("/", { replace: true });
    }
  }, [network, navigate]);

  const { data, loading, error } = useTokenDetail(
    contractAddress ?? "",
    network ?? "",
    selectedWalletId,
  );

  // Render: loading skeleton → error banner → content
  // Content: TokenDetailHeader + TokenStatsCards + (transactions.length > 0 ? TransactionTable : EmptyState)
}
```

Props: none (page component, reads from router params).

### 4.2 TokenDetailHeader

File: `apps/frontend/src/components/token-detail/TokenDetailHeader.tsx`

```typescript
interface TokenDetailHeaderProps {
  token: TokenInfo;
  position: PositionStats | null;
  selectedWalletId: string | undefined;
  onWalletChange: (walletId: string | undefined) => void;
  contractAddress: string;
  network: string;
}
```

Layout skeleton:

```
<div className="flex items-center gap-4 p-6">
  <TokenLogo ... size="lg" />
  <div className="flex flex-col gap-1">
    <div className="flex items-center gap-2">
      <h1 className="text-2xl font-bold text-white">{token.symbol}</h1>
      <NetworkBadge ... />
      <CycleBadge cycleNumber={position?.cycleNumber} />
    </div>
    {token.name && <p className="text-sm text-gray-400">{token.name}</p>}
  </div>
  <div className="ml-auto flex items-center gap-3">
    {/* WalletSelector: hidden when network === "CEX_BINANCE" */}
    {network !== "CEX_BINANCE" && position && (
      <WalletSelector
        wallets={position.walletBreakdown}
        selectedWalletId={selectedWalletId}
        onChange={onWalletChange}
      />
    )}
    {/* ClosedCyclesLink: shown when history endpoint has data */}
    <Link to={`/token/${contractAddress}/${network}/history`}
          className="text-sm text-gray-400 hover:text-white">
      View closed cycles →
    </Link>
  </div>
</div>
```

The `ClosedCyclesLink` is always rendered (AC-12 requires it to be reachable); it links to the history page which shows an empty list if there are no closed cycles.

### 4.3 WalletSelector

File: `apps/frontend/src/components/token-detail/WalletSelector.tsx`

```typescript
interface WalletSelectorProps {
  wallets: WalletBreakdown[];          // from position.walletBreakdown
  selectedWalletId: string | undefined;
  onChange: (walletId: string | undefined) => void;
}
```

Implementation: native `<select>` element (no library needed for a functional requirement with ≤ ~10 options).

```tsx
<select
  value={selectedWalletId ?? ""}
  onChange={(e) => onChange(e.target.value || undefined)}
  className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white"
>
  <option value="">All wallets</option>
  {wallets.map((w) => (
    <option key={w.walletId} value={w.walletId}>
      {w.label ?? w.walletId.slice(0, 8) + "…"}
    </option>
  ))}
</select>
```

Selecting "All wallets" resets `selectedWalletId` to `undefined`, triggering a refetch without `?wallet_id=`.

### 4.4 TransactionTable

File: `apps/frontend/src/components/token-detail/TransactionTable.tsx`

```typescript
interface TransactionTableProps {
  transactions: TransactionWithPnl[];
  currentPrice: string | null;
}
```

Column config (in order):

| # | Header | Cell content |
|---|--------|-------------|
| 1 | Date | `blockTimestamp` formatted as `YYYY-MM-DD HH:mm` |
| 2 | Type | `<TypeBadge type={tx.type} txHash={tx.txHash} cexTradeId={tx.cexTradeId} />` |
| 3 | Source | `<SourceBadge source={tx.source} />` |
| 4 | Amount | `formatCrypto(tx.amount)` |
| 5 | Price | `tx.priceUsd ? formatUsd(tx.priceUsd) : "—"` |
| 6 | Cost Source | `<CostSourceBadge costSource={tx.costSource} source={tx.source} txHash={tx.txHash} />` |
| 7 | P&L | `<PnlDisplay ... />` (INBOUND only; OUTBOUND shows "Sold/Out" in muted text) |

Empty state (when `transactions.length === 0`):

```tsx
<p className="py-8 text-center text-sm text-gray-500">
  No transactions recorded yet
</p>
```

Row render: `<tr key={tx.id}>` — stable key, no index.

### 4.5 TypeBadge

File: `apps/frontend/src/components/token-detail/TypeBadge.tsx`

```typescript
const TYPE_CONFIG = {
  BUY:          { label: "BUY",        className: "bg-green-900 text-green-300" },
  SELL:         { label: "SELL",       className: "bg-red-900 text-red-300" },
  SWAP_IN:      { label: "SWAP IN",    className: "bg-blue-900 text-blue-300" },
  SWAP_OUT:     { label: "SWAP OUT",   className: "bg-orange-900 text-orange-300" },
  TRANSFER_IN:  { label: "XFER IN",   className: "bg-purple-900 text-purple-300" },
  TRANSFER_OUT: { label: "XFER OUT",  className: "bg-gray-700 text-gray-300" },
} as const satisfies Record<TransactionType, { label: string; className: string }>;
```

Tooltip logic (D4/D6):

- `SWAP_IN` / `SWAP_OUT` with `txHash` → `title={`Auto-detected swap from TX ${txHash}`}`
- `SWAP_IN` / `SWAP_OUT` with `cexTradeId` → `title={`Binance Convert #${cexTradeId}`}`
- All others: no `title`

```tsx
interface TypeBadgeProps {
  type: TransactionType;
  txHash: string | null;
  cexTradeId: string | null;
}

export function TypeBadge({ type, txHash, cexTradeId }: TypeBadgeProps) {
  const cfg = TYPE_CONFIG[type];
  const isSwap = type === "SWAP_IN" || type === "SWAP_OUT";
  const tooltip = isSwap
    ? txHash
      ? `Auto-detected swap from TX ${txHash}`
      : cexTradeId
        ? `Binance Convert #${cexTradeId}`
        : undefined
    : undefined;
  return (
    <span
      className={cn("rounded px-2 py-0.5 text-xs font-medium", cfg.className)}
      title={tooltip}
    >
      {cfg.label}
    </span>
  );
}
```

### 4.6 SourceBadge

File: `apps/frontend/src/components/token-detail/SourceBadge.tsx`

```typescript
const SOURCE_CONFIG = {
  ETHERSCAN: { label: "Etherscan", className: "bg-indigo-900 text-indigo-300" },
  BSCTRACE:  { label: "BSCScan",   className: "bg-yellow-900 text-yellow-300" },
  BINANCE:   { label: "Binance",   className: "bg-amber-900 text-amber-300" },
  MANUAL:    { label: "Manual",    className: "bg-gray-700 text-gray-400" },
} as const satisfies Record<TransactionSource, { label: string; className: string }>;

interface SourceBadgeProps {
  source: TransactionSource;
}

export function SourceBadge({ source }: SourceBadgeProps) {
  const cfg = SOURCE_CONFIG[source];
  return (
    <span className={cn("rounded px-2 py-0.5 text-xs font-medium", cfg.className)}>
      {cfg.label}
    </span>
  );
}
```

### 4.7 CostSourceBadge

File: `apps/frontend/src/components/token-detail/CostSourceBadge.tsx`

Implements AC-7 (INHERITED on-chain), AC-8 (INHERITED Binance), AC-9 (MANUAL). Uses `<WithTooltip>` for the hover pattern.

```typescript
const COST_SOURCE_CONFIG = {
  MARKET:    { label: "MARKET",    className: "bg-gray-700 text-gray-400", tooltip: null },
  INHERITED: { label: "INHERITED", className: "bg-teal-900 text-teal-300", tooltip: null },
  MANUAL:    { label: "MANUAL",    className: "bg-yellow-900 text-yellow-300",
               tooltip: "Price set manually — edit to update" },
} as const satisfies Record<CostSource, { label: string; className: string; tooltip: string | null }>;

interface CostSourceBadgeProps {
  costSource: CostSource | null;
  source: TransactionSource;
  txHash: string | null;
}
```

Tooltip text derivation:

- `costSource === "INHERITED"` AND `source === "BINANCE"` → tooltip: `"WAC inherited from Binance CEX position"`
- `costSource === "INHERITED"` AND `source !== "BINANCE"` → tooltip: `"WAC inherited from on-chain wallet"`
- `costSource === "MANUAL"` → tooltip: `"Price set manually — edit to update"` (AC-9)
- `costSource === "MARKET"` or `null` → no tooltip

When `costSource === null`: render `"—"` (no badge).

```tsx
export function CostSourceBadge({ costSource, source, txHash }: CostSourceBadgeProps) {
  if (costSource === null) return <span className="text-gray-600">—</span>;
  const cfg = COST_SOURCE_CONFIG[costSource];
  const tooltip =
    costSource === "INHERITED"
      ? source === "BINANCE"
        ? "WAC inherited from Binance CEX position"
        : "WAC inherited from on-chain wallet"
      : cfg.tooltip;
  return (
    <WithTooltip text={tooltip}>
      <span className={cn("rounded px-2 py-0.5 text-xs font-medium", cfg.className)}>
        {cfg.label}
      </span>
    </WithTooltip>
  );
}
```

### 4.8 WithTooltip

File: `apps/frontend/src/components/token-detail/WithTooltip.tsx`

Implements D4: Tailwind `group`/`group-hover` pattern for absolute-positioned tooltip text. Used for badges where `title` is insufficient (cost source, transfer badges).

```typescript
interface WithTooltipProps {
  children: React.ReactNode;
  text: string | null;
}

export function WithTooltip({ children, text }: WithTooltipProps) {
  if (!text) return <>{children}</>;
  return (
    <span className="group relative inline-block">
      {children}
      <span
        className={cn(
          "pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2",
          "w-max max-w-xs rounded bg-gray-900 px-2 py-1 text-xs text-gray-200 shadow-lg",
          "opacity-0 transition-opacity group-hover:opacity-100",
        )}
        role="tooltip"
      >
        {text}
      </span>
    </span>
  );
}
```

When `text` is null/undefined, renders children directly with no wrapper overhead.

### 4.9 PositionHistoryPage

File: `apps/frontend/src/pages/PositionHistoryPage.tsx`

Minimal scope per D2: one card per closed cycle with cycle number, date range, realized P&L.

```typescript
// Reads :contractAddress and :network from useParams()
// Uses usePositionHistory(contractAddress, network) — one-shot, no polling
// Renders:
//   - BackLink → /token/:contractAddress/:network
//   - heading: "Position History"
//   - (loading) skeleton
//   - (error) error banner
//   - (cycles.length === 0) "No closed cycles yet"
//   - (cycles.length > 0) list of CycleCards
```

CycleCard (inline component in the same file):

```typescript
function CycleCard({ entry }: { entry: PositionHistoryEntry }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <div className="flex items-center justify-between">
        <CycleBadge cycleNumber={entry.cycleNumber} />
        <PnlDisplay value={entry.realizedPnlUsd} kind="usd" />
      </div>
      <p className="mt-2 text-xs text-gray-500">
        {formatDate(entry.openedAt)} → {formatDate(entry.closedAt)}
      </p>
    </div>
  );
}
```

`formatDate` — a simple helper in `format.ts` (to be added): `new Date(iso).toLocaleDateString()`.

### CycleBadge

File: `apps/frontend/src/components/token-detail/CycleBadge.tsx`

```typescript
interface CycleBadgeProps {
  cycleNumber: number | undefined;  // undefined when position === null
}

export function CycleBadge({ cycleNumber }: CycleBadgeProps) {
  return (
    <span className="rounded bg-gray-700 px-2 py-0.5 text-xs font-mono text-gray-300">
      CYCLE #{cycleNumber ?? "—"}
    </span>
  );
}
```

### TokenStatsCards

File: `apps/frontend/src/components/token-detail/TokenStatsCards.tsx`

```typescript
interface TokenStatsCardsProps {
  position: PositionStats | null;
}
```

Six stat cards in a responsive grid (`grid-cols-2 sm:grid-cols-3 xl:grid-cols-6`):

| Card | Value | Null/unavailable fallback |
|------|-------|--------------------------|
| Balance | `formatCrypto(position.totalBalance)` | `"—"` when position null |
| Current Price | `formatUsd(position.currentPrice)` | `"Unavailable"` when priceUnavailable |
| Current Value | `formatUsd(position.totalCurrentValue)` | `"—"` |
| WAC | `formatUsd(position.wacAggregated)` | `"—"` |
| Cost Basis | `formatUsd(position.totalCostBasis)` | `"—"` |
| P&L | `<PnlDisplay value={position.pnlUsd} kind="usd" />` | — (PnlDisplay handles null) |

When `position === null`: all cards render `"—"` with a sub-label "No open position".

---

## 5. Data Flow

```
URL params: /token/:contractAddress/:network
          [?wallet_id=xxx after wallet selector change]
                │
                ▼
TokenDetailPage
  ├── useParams() → contractAddress, network
  ├── useState(selectedWalletId) — initially undefined
  │
  ├── useTokenDetail(contractAddress, network, selectedWalletId)
  │     │  polls GET /api/portfolio/token/:contractAddress/:network[?wallet_id=xxx]
  │     │  every 30s; pauses when tab hidden
  │     └─→ { data: TokenDetail | null, loading, error, isRefetching }
  │
  ├── TokenDetailHeader receives: token, position, selectedWalletId, onWalletChange
  │     └── WalletSelector.onChange(id) → setSelectedWalletId(id)
  │           → useTokenDetail re-executes with new walletId
  │           → new URL param appended: ?wallet_id=xxx
  │           → backend scopes position stats + transactions to that wallet
  │
  ├── TokenStatsCards receives: position (null or scoped PositionStats)
  │
  └── TransactionTable receives: transactions (scoped to wallet when wallet_id set)
        └── each row: TypeBadge, SourceBadge, CostSourceBadge, PnlDisplay

Parallel: PositionHistoryPage
  ├── useParams() → contractAddress, network
  ├── usePositionHistory(contractAddress, network)
  │     GET /api/portfolio/token/:contractAddress/:network/history (one-shot)
  └── renders CycleCard list
```

Wallet filter flow:

1. Initial load: no `wallet_id` → backend returns aggregate across all wallets
2. User selects a wallet → `setSelectedWalletId(id)` → `useTokenDetail` effect re-runs (dep changed) → re-fetches with `?wallet_id=id` → backend returns per-wallet position + filtered transactions
3. User selects "All wallets" → `setSelectedWalletId(undefined)` → re-fetches without param → aggregate view restored

---

## 6. Test File Layout

### Backend

**`apps/backend/src/services/__tests__/portfolio.test.ts`** (MODIFY existing)

- Update `baseTxRow` fixture to include `tx_hash: null, cex_trade_id: null, related_tx_id: null`
- Add assertion: `getTokenDetail` response transactions contain `txHash`, `cexTradeId`, `relatedTxId` fields
- Add assertion: `TokenPortfolioRowSchema.parse(...)` succeeds with `cycleNumber` field
- Add test: `buildPortfolioRow` result includes `cycleNumber` equal to max cycle across positions
- Verify existing `getPortfolioSummary` tests still pass (cycleNumber now required — fixtures need it)

### Frontend hooks

**`apps/frontend/src/hooks/useTokenDetail.test.ts`** (NEW)

- SC-001: initial fetch sets `loading: true` then `data` when resolved
- SC-002: polling interval is 30s (mock setInterval, verify call count)
- SC-003: visibility hidden pauses polling; visible resumes + immediate refetch
- SC-004: `walletId` change triggers re-fetch with `?wallet_id=` param
- SC-005: `UnauthorizedError` re-throws without setting error state
- SC-006: fetch error keeps stale data (stale-while-error)

**`apps/frontend/src/hooks/usePositionHistory.test.ts`** (NEW)

- SC-001: one-shot fetch, no polling
- SC-002: sets `loading → data` on success

### Frontend pages

**`apps/frontend/src/pages/TokenDetailPage.test.tsx`** (NEW)

- SC-001: invalid network param → redirects to `/`
- SC-002: renders TokenDetailHeader, TokenStatsCards when data loaded
- SC-003: renders EmptyState when `transactions.length === 0`
- SC-004: WalletSelector hidden when `network === "CEX_BINANCE"`
- SC-005: wallet selection triggers refetch with wallet_id query param

**`apps/frontend/src/pages/PositionHistoryPage.test.tsx`** (NEW)

- SC-001: renders one CycleCard per entry
- SC-002: renders "No closed cycles yet" when `cycles.length === 0`
- SC-003: BackLink navigates to `/token/:contractAddress/:network`

### Frontend components

**`apps/frontend/src/components/token-detail/TransactionTable.test.tsx`** (NEW)

- SC-001: renders one row per transaction
- SC-002: renders empty state paragraph when transactions is empty
- SC-003: date column formatted correctly

**`apps/frontend/src/components/token-detail/TypeBadge.test.tsx`** (NEW)

- SC-001: SWAP_IN with txHash → title contains "Auto-detected swap from TX"
- SC-002: SWAP_IN with cexTradeId → title contains "Binance Convert #"
- SC-003: BUY → no title attribute
- SC-004: all 6 types render without crashing

**`apps/frontend/src/components/token-detail/CostSourceBadge.test.tsx`** (NEW)

- SC-001: INHERITED + BINANCE source → tooltip "WAC inherited from Binance CEX position"
- SC-002: INHERITED + ETHERSCAN source → tooltip "WAC inherited from on-chain wallet"
- SC-003: MANUAL → tooltip "Price set manually"
- SC-004: MARKET → no tooltip (WithTooltip renders children directly)
- SC-005: null costSource → renders "—"

**`apps/frontend/src/components/token-detail/WithTooltip.test.tsx`** (NEW)

- SC-001: `text={null}` → renders children, no wrapper span
- SC-002: `text="some tooltip"` → tooltip span present with `role="tooltip"`
- SC-003: tooltip span has `opacity-0` base class and `group-hover:opacity-100`
