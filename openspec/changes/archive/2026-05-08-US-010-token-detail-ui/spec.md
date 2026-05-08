# US-010 Token Detail UI — Specification

## 1. Backend DTO Changes

### 1.1 `TokenPortfolioRowSchema` — add `cycleNumber`

File: `apps/backend/src/types/portfolio.ts`

Add one non-nullable field to `TokenPortfolioRowSchema`:

```typescript
cycleNumber: z.number().int().nonnegative(),
```

`buildVirtualPosition` already computes `maxCycle` and sets it on the returned `PositionState`. The fix is one line in `buildPortfolioRow` (file: `apps/backend/src/services/portfolio.ts`):

```typescript
cycleNumber: virtual.cycleNumber,
```

`cycleNumber` is always `≥ 1` for OPEN positions (`buildVirtualPosition` iterates at least one row). No nullable fallback needed. When `position === null` the frontend renders "CYCLE #—".

**Risk R2 (proposal):** `TokenPortfolioRowSchema` is embedded inside `PortfolioSummarySchema` via `tokens: z.array(TokenPortfolioRowSchema)`. Adding a required field means all `getPortfolioSummary` paths must also populate it. `buildPortfolioRow` is the single construction site — the one-liner above covers both code paths.

### 1.2 `TransactionWithPnlSchema` — add three nullable identifier fields

File: `apps/backend/src/types/portfolio.ts`

Add to `TransactionWithPnlSchema`:

```typescript
txHash:     z.string().nullable(),
cexTradeId: z.string().nullable(),
relatedTxId: z.string().nullable(),
```

All three are nullable. Existing mocks without these fields will still pass `TransactionWithPnlSchema.parse(...)` only if the fields are `.optional()`. They MUST be `.nullable()` (not `.optional()`) so the frontend can rely on receiving them. Update existing test fixtures that call `TransactionWithPnlSchema.parse(...)` to include `txHash: null, cexTradeId: null, relatedTxId: null`.

### 1.3 `TransactionWithPnlSchema` — add `costInheritedFrom`

File: `apps/backend/src/types/portfolio.ts`

```typescript
costInheritedFrom: z.enum(['ONCHAIN', 'BINANCE']).nullable(),
```

**Why this field is needed:** The DB `cost_source` column stores only `'INHERITED'` — it does not distinguish whether the cost was inherited from an on-chain wallet or from a Binance CEX position. The frontend needs this distinction for AC-7 ("Cost inherited (wallet)") vs AC-8 ("Cost inherited (Binance)"). The backend resolver already knows the origin at sync time (see PRD rule "TRANSFER_IN COST RESOLUTION"). The computed value is derived in `getTokenDetail` when mapping transaction rows (see §1.4).

### 1.4 `TxRow` internal type — add four columns

File: `apps/backend/src/services/portfolio.ts` (inline `TxRow` interface)

```typescript
interface TxRow {
  // ... existing fields ...
  tx_hash:        string | null;
  cex_trade_id:   string | null;
  related_tx_id:  string | null;
}
```

These columns already exist in the `transactions` table. No migration required.

### 1.5 `getTokenDetail` SQL SELECT — extend column list

File: `apps/backend/src/services/portfolio.ts` (line ~357)

```sql
SELECT id, wallet_id, token_id, position_id, type, source,
       block_timestamp, amount, price_usd, cost_source,
       tx_hash, cex_trade_id, related_tx_id
  FROM transactions
 WHERE token_id = $1
   AND position_id = ANY($2::uuid[])
 ORDER BY block_timestamp DESC
 LIMIT 1000
```

### 1.6 Transaction mapper — map new fields and derive `costInheritedFrom`

File: `apps/backend/src/services/portfolio.ts` (lines ~368–385)

```typescript
const transactions = txResult.rows.map((tx) => {
  const ts = tx.block_timestamp instanceof Date
    ? tx.block_timestamp.toISOString()
    : String(tx.block_timestamp);

  // Derive costInheritedFrom for TRANSFER_IN rows with INHERITED cost.
  // A TRANSFER_IN whose on-chain txHash matches a Binance TRANSFER_OUT
  // was inherited from the CEX position; otherwise it was inherited from
  // another on-chain wallet.
  // At mapping time we distinguish by source: ETHERSCAN/BSCTRACE transfers
  // inherit from on-chain wallets; the Binance-bridge case has source
  // ETHERSCAN/BSCTRACE but the tx_hash was stamped by BinanceSyncService
  // on the CEX TRANSFER_OUT row. Since the backend resolveTransferCost()
  // already determined the origin and stored it in cost_source='INHERITED',
  // we add a `cost_inherited_from` column to resolve the ambiguity.
  // For V1: derive from source — BINANCE source → 'BINANCE', else → 'ONCHAIN'.
  // This covers the Binance Convert case. The cross-source bridge edge case
  // (ETHERSCAN tx with cost from a Binance withdrawal) is documented as a
  // known limitation; a future story may add a dedicated DB column.
  let costInheritedFrom: 'ONCHAIN' | 'BINANCE' | null = null;
  if (tx.cost_source === 'INHERITED') {
    costInheritedFrom = tx.source === 'BINANCE' ? 'BINANCE' : 'ONCHAIN';
  }

  return {
    id: tx.id,
    walletId: tx.wallet_id,
    tokenId: tx.token_id,
    positionId: tx.position_id ?? null,
    type: tx.type,
    source: tx.source,
    blockTimestamp: ts,
    amount: tx.amount,
    priceUsd: tx.price_usd ?? null,
    costSource: tx.cost_source ?? null,
    txHash: tx.tx_hash ?? null,
    cexTradeId: tx.cex_trade_id ?? null,
    relatedTxId: tx.related_tx_id ?? null,
    costInheritedFrom,
    pnl: computePnl(tx.type, tx.price_usd ?? null, currentPrice, tx.amount),
  };
});
```

**Known limitation:** A `TRANSFER_IN` on Ethereum whose cost was inherited from a Binance withdrawal has `source='ETHERSCAN'` and `cost_source='INHERITED'`. With this V1 derivation rule it will display "Cost inherited (wallet)" instead of "Cost inherited (Binance)". Resolving this correctly requires either (a) a new `cost_inherited_from` DB column or (b) a join to find the matching Binance `TRANSFER_OUT` row at query time. Both are deferred to a follow-up story. The AC-8 case (Binance → wallet bridge) is expected to be rare in V1.

---

## 2. Frontend Types

File: `apps/frontend/src/types/token-detail.ts` (new file)

```typescript
import type { DecimalString, Network } from './portfolio';

export type TransactionType =
  | 'BUY'
  | 'SELL'
  | 'SWAP_IN'
  | 'SWAP_OUT'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT';

export type TransactionSource = 'ETHERSCAN' | 'BSCTRACE' | 'BINANCE' | 'MANUAL';

export type CostSource = 'MARKET' | 'INHERITED' | 'MANUAL' | null;

export type CostInheritedFrom = 'ONCHAIN' | 'BINANCE' | null;

export interface PnlInfoInbound {
  kind: 'INBOUND';
  lotPnlUsd: DecimalString | null;
  lotPnlPct: DecimalString | null;
}

export interface PnlInfoOutbound {
  kind: 'OUTBOUND';
  displayAs: 'Sold/Out';
}

export type PnlInfo = PnlInfoInbound | PnlInfoOutbound;

export interface TransactionWithPnl {
  id: string;
  walletId: string;
  tokenId: string;
  positionId: string | null;
  type: TransactionType;
  source: TransactionSource;
  blockTimestamp: string;      // ISO-8601
  amount: DecimalString;
  priceUsd: DecimalString | null;
  costSource: CostSource;
  txHash: string | null;
  cexTradeId: string | null;
  relatedTxId: string | null;
  costInheritedFrom: CostInheritedFrom;
  pnl: PnlInfo;
}

/** Mirrors TokenPortfolioRowSchema with the new cycleNumber field. */
export interface TokenDetailPosition {
  symbol: string;
  network: Network;
  sourceType: 'ON_CHAIN' | 'CEX';
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
  walletBreakdown: WalletBreakdownEntry[];
  priceUnavailable?: boolean;
  cycleNumber: number;
}

export interface WalletBreakdownEntry {
  walletId: string;
  label: string | null;
  balance: DecimalString;
  wac: DecimalString;
}

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

export interface TokenDetailResponse {
  token: TokenInfo;
  position: TokenDetailPosition | null;
  transactions: TransactionWithPnl[];
  priceUnavailable?: boolean;
}

export interface PositionHistoryEntry {
  cycleNumber: number;
  openedAt: string;   // ISO-8601
  closedAt: string;   // ISO-8601
  realizedPnlUsd: DecimalString;
}

export interface PositionHistoryResponse {
  cycles: PositionHistoryEntry[];
}
```

**Wallet type for selector** (reuses the existing `Wallet` interface from the backend, mirrored for the frontend in `apps/frontend/src/types/wallet.ts` — already exists or is created in US-005):

```typescript
export interface WalletSummary {
  id: string;
  wallet_type: 'ON_CHAIN' | 'CEX';
  address: string | null;
  network: string;
  label: string | null;
}
```

---

## 3. API Contract

### 3.1 `GET /api/portfolio/token/:contractAddress/:network`

Query param: `wallet_id` (optional, UUID string)

**Response shape** (updated with D1 fields):

```json
{
  "token": {
    "id": "uuid",
    "symbol": "WETH",
    "name": "Wrapped Ether",
    "network": "ETH",
    "contractAddress": "0x...",
    "binanceSymbol": null,
    "decimals": 18,
    "targetExitPrice": null
  },
  "position": {
    "symbol": "WETH",
    "network": "ETH",
    "sourceType": "ON_CHAIN",
    "contractAddress": "0x...",
    "binanceSymbol": null,
    "totalBalance": "2.500000000000000000",
    "wacAggregated": "2500.000000000000000000",
    "totalCostBasis": "6250.000000000000000000",
    "currentPrice": "3000.00",
    "totalCurrentValue": "7500.000000000000000000",
    "pnlUsd": "1250.000000000000000000",
    "pnlPct": "20.000000000000000000",
    "walletCount": 2,
    "walletBreakdown": [...],
    "cycleNumber": 1
  },
  "transactions": [
    {
      "id": "uuid",
      "walletId": "uuid",
      "tokenId": "uuid",
      "positionId": "uuid",
      "type": "BUY",
      "source": "ETHERSCAN",
      "blockTimestamp": "2024-03-15T14:23:00.000Z",
      "amount": "1.000000000000000000",
      "priceUsd": "2000.00",
      "costSource": "MARKET",
      "txHash": "0xabc...",
      "cexTradeId": null,
      "relatedTxId": null,
      "costInheritedFrom": null,
      "pnl": {
        "kind": "INBOUND",
        "lotPnlUsd": "1000.000000000000000000",
        "lotPnlPct": "50.000000000000000000"
      }
    }
  ]
}
```

**Error responses:**
- `404` with `{ statusCode: 404, error: "Not Found", message: "Token '...' on network '...' not found", code: "TOKEN_NOT_FOUND" }` when token does not exist.
- `400` with `{ statusCode: 400, error: "Bad Request" }` when `network` is not a valid NETWORK enum value.

### 3.2 `GET /api/portfolio/token/:contractAddress/:network/history`

Query param: `wallet_id` (optional, unused for CEX)

**Response shape** (unchanged from existing implementation):

```json
{
  "cycles": [
    {
      "cycleNumber": 1,
      "openedAt": "2024-01-01T00:00:00.000Z",
      "closedAt": "2024-06-30T00:00:00.000Z",
      "realizedPnlUsd": "2500.000000000000000000"
    }
  ]
}
```

**Error responses:**
- `404` when token does not exist (same shape as above).

### 3.3 `GET /api/wallets`

Existing endpoint. Used by `useWallets` to populate the wallet selector.

**Response shape** (array, existing):

```json
[
  {
    "id": "uuid",
    "user_id": "uuid",
    "wallet_type": "ON_CHAIN",
    "address": "0x...",
    "network": "ETH",
    "label": "My Main Wallet",
    "last_synced_at": "2024-03-15T14:00:00.000Z",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
]
```

The `WalletSelector` filters this list to `wallet_type === 'ON_CHAIN'` wallets only.

---

## 4. Component Specifications

### 4.1 `TokenDetailPage` (page)

File: `apps/frontend/src/pages/TokenDetailPage.tsx`

**Route params** (via `useParams`): `contractAddress: string`, `network: string`

On mount, validate `network` against `NETWORK` constant. If invalid, redirect to `/` with an error toast.

**State:**
- `selectedWalletId: string | null` — `null` means "All Wallets"
- Data fetched by `useTokenDetail(contractAddress, network, selectedWalletId)`

**Behavior:**
- Initial render: fetch with no `walletId` → aggregate view.
- When user selects a wallet: refetch with `?wallet_id=<id>` → per-wallet view.
- Polling: every 30 seconds; paused when `document.visibilityState === 'hidden'`; immediate refetch on tab focus (same pattern as `usePortfolio`).
- Loading state: skeleton replaces header and table.
- Error + data present: show stale data + error banner.
- Error + no data: show full error state with retry button.

**Layout:**

```
<main>
  <BackLink → /> (text: "← Portfolio")
  <TokenDetailHeader token={token} position={position} />
  <WalletSelector />           {/* hidden when network === 'CEX_BINANCE' */}
  <TokenStatsCards />
  <TransactionTable />         {/* or empty state */}
</main>
```

**Props:** none (page component, reads from router).

### 4.2 `TokenDetailHeader`

File: `apps/frontend/src/components/token-detail/TokenDetailHeader.tsx`

**Props:**

```typescript
interface TokenDetailHeaderProps {
  token: TokenInfo;
  position: TokenDetailPosition | null;
  closedCycleCount: number;   // from PositionHistoryResponse.cycles.length
}
```

**Displayed elements (AC-1):**
1. `TokenLogo` (reused from dashboard) — `symbol`, `contractAddress`, `network`, `sourceType`
2. `symbol` text (large, bold)
3. `NetworkBadge` (reused) — `network`
4. `CycleBadge` — shows "CYCLE #N" where N = `position.cycleNumber`; shows "CYCLE #—" when `position === null`
5. "View N closed cycles" link (ghost button, only shown when `closedCycleCount > 0`) → navigates to `/token/${contractAddress}/${network}/history`. Label: "View {closedCycleCount} closed cycle{closedCycleCount !== 1 ? 's' : ''}"

**CycleBadge** (inline or sub-component):
- `cycleNumber: number | null`
- Visual: small pill badge, muted color scheme (e.g. `bg-gray-700 text-gray-200 text-xs`)
- Text: `CYCLE #${cycleNumber}` or `CYCLE #—` when null

### 4.3 `TokenStatsCards`

File: `apps/frontend/src/components/token-detail/TokenStatsCards.tsx`

**Props:**

```typescript
interface TokenStatsCardsProps {
  position: TokenDetailPosition | null;
  priceUnavailable?: boolean;
}
```

**Six stat cards (AC-1):**

| # | Label | Value source | Format |
|---|-------|-------------|--------|
| 1 | Balance | `position.totalBalance` | `formatCrypto()` |
| 2 | Current Price | `position.currentPrice` | `formatUsd()` — shows `—` if null or `priceUnavailable` |
| 3 | Current Value | `position.totalCurrentValue` | `formatUsd()` — shows `—` if null or `priceUnavailable` |
| 4 | WAC | `position.wacAggregated` | `formatUsd()` |
| 5 | Cost Basis | `position.totalCostBasis` | `formatUsd()` |
| 6 | P&L | `position.pnlUsd` + `position.pnlPct` | `PnlDisplay` (usd + pct side by side) |

When `position === null`: all six cards show `—`.
When `priceUnavailable === true`: cards 2, 3, 6 show `—`.

Uses `SummaryCard` component (reused from dashboard) or equivalent card primitive.

### 4.4 `WalletSelector`

File: `apps/frontend/src/components/token-detail/WalletSelector.tsx`

**Props:**

```typescript
interface WalletSelectorProps {
  wallets: WalletSummary[];
  selectedWalletId: string | null;
  onSelect: (walletId: string | null) => void;
}
```

**Behavior (AC-2):**
- Only rendered when `network !== 'CEX_BINANCE'` (controlled by parent `TokenDetailPage`).
- For CEX (`CEX_BINANCE`): the selector is NOT rendered. The header implicitly shows "Binance" without a selector.
- First option: "All Wallets" (value `null`).
- Subsequent options: one per ON_CHAIN wallet, label = `wallet.label ?? wallet.address ?? wallet.id` (truncate address to `0x…last4`).
- Selecting triggers `onSelect(walletId)` which causes `TokenDetailPage` to refetch with `?wallet_id=`.

**Implementation:** uses a `<select>` or custom glass-style dropdown consistent with the design system.

### 4.5 `TransactionTable`

File: `apps/frontend/src/components/token-detail/TransactionTable.tsx`

**Props:**

```typescript
interface TransactionTableProps {
  transactions: TransactionWithPnl[];
}
```

**Columns (AC-3):**

| Column | Header | Content |
|--------|--------|---------|
| Date | "Date" | `blockTimestamp` formatted as `MMM D, YYYY HH:mm` (local time) |
| Type | "Type" | `TypeBadge` |
| Source | "Source" | `SourceBadge` |
| Amount | "Amount" | `formatCrypto(amount)` |
| Price at Time | "Price at Time" | `formatUsd(priceUsd)` — `—` when null |
| Value at Time | "Value at Time" | `formatUsd(amount × priceUsd)` — `—` when either is null |
| Current Price | "Current Price" | from `TokenDetailPage` context (currentPrice from position) |
| Current Value | "Current Value" | `formatUsd(amount × currentPrice)` — `—` when currentPrice null |
| P&L | "P&L" | See §P&L column rules below |

**P&L column rules (AC-11):**
- `pnl.kind === 'INBOUND'`: show `PnlDisplay` for `pnl.lotPnlUsd` (kind "usd") + `pnl.lotPnlPct` (kind "pct") in normal weight.
- `pnl.kind === 'OUTBOUND'` (SELL or SWAP_OUT): display the realized P&L value in **italic** style. The realized P&L for a SELL row is the lot-level value stored on the transaction. Since the current `computePnl` returns `{ kind: 'OUTBOUND', displayAs: 'Sold/Out' }` for outbound types, the table renders a specific italic cell with the realized value. **Note:** to show realized P&L for SELL/SWAP_OUT, the backend must add `realizedPnlUsd` to the outbound pnl shape. See §1.7.

**Special badge rules per row:**
- `type === 'SWAP_IN'` or `type === 'SWAP_OUT'`, `source === 'ETHERSCAN' | 'BSCTRACE'`: show `Tooltip` on `TypeBadge` with text `"Auto-detected swap from TX ${txHash ?? relatedTxId}"` (AC-5).
- `type === 'SWAP_IN'` or `type === 'SWAP_OUT'`, `source === 'BINANCE'`: show `Tooltip` with text `"Binance Convert #${cexTradeId}"` (AC-6).
- `type === 'TRANSFER_IN'`, `costSource === 'INHERITED'`: show `CostSourceBadge` in a dedicated sub-row or inline badge column.
- `type === 'TRANSFER_OUT'`, `source === 'BINANCE'`, `txHash !== null`: show `Tooltip` on `SourceBadge` with text `"Withdrawal tx: ${txHash}"` (AC-10).

**Empty state (AC-13):** when `transactions.length === 0`, render inline:

```
<p className="text-center text-gray-400 py-8">No transactions recorded yet</p>
```

Do NOT render the table at all — render only the empty message. This applies when BOTH `position === null` AND `transactions.length === 0`.

**Edge case (risk R5 from proposal):** when `position === null` but `transactions` is non-empty, render the table normally. Empty state only fires when `transactions.length === 0`.

### 4.5a Backend prerequisite — `OutboundPnlSchema` extended with `realizedPnlUsd`

> This is a backend change required by section 4.5 (TransactionTable). It belongs to the backend DTO layer (§1) but is documented here for traceability with AC-11.

To satisfy AC-11 (italic realized P&L for SELL/SWAP_OUT), the `OUTBOUND` pnl shape needs the realized amount:

File: `apps/backend/src/types/portfolio.ts`

```typescript
export const OutboundPnlSchema = z.object({
  kind: z.literal('OUTBOUND'),
  displayAs: z.literal('Sold/Out'),
  realizedPnlUsd: z.string().nullable(),   // ADD THIS
});
```

`computePnl` must be updated to populate `realizedPnlUsd` for SELL/SWAP_OUT:

```typescript
// For OUTBOUND types:
// realizedPnlUsd = (currentPrice - priceUsd) × amount
// If either price is null → null
const realizedPnlUsd = (priceUsd !== null && currentPrice !== null)
  ? roundToStorage(toDecimal(currentPrice).minus(toDecimal(priceUsd)).times(toDecimal(amount)))
  : null;
return { kind: 'OUTBOUND', displayAs: 'Sold/Out', realizedPnlUsd };
```

**Frontend type update** (`apps/frontend/src/types/token-detail.ts`):

```typescript
export interface PnlInfoOutbound {
  kind: 'OUTBOUND';
  displayAs: 'Sold/Out';
  realizedPnlUsd: DecimalString | null;
}
```

### 4.6 `TypeBadge`

File: `apps/frontend/src/components/token-detail/TypeBadge.tsx`

**Props:**

```typescript
interface TypeBadgeProps {
  type: TransactionType;
  tooltip?: string;   // shown via title attr on the badge span
}
```

**Color mapping (AC-4):**

| Type | Background | Text | Label |
|------|------------|------|-------|
| `BUY` | `bg-green-700` | `text-green-100` | "BUY" |
| `SELL` | `bg-red-700` | `text-red-100` | "SELL" |
| `SWAP_IN` | `bg-blue-700` | `text-blue-100` | "SWAP IN" |
| `SWAP_OUT` | `bg-orange-700` | `text-orange-100` | "SWAP OUT" |
| `TRANSFER_IN` | `bg-gray-700` | `text-gray-200` | "TRANSFER IN" |
| `TRANSFER_OUT` | `bg-gray-700` | `text-gray-200` | "TRANSFER OUT" |

When `tooltip` is provided, add `title={tooltip}` to the badge `<span>`. The `title` attribute is sufficient per D4 for swap tooltips (AC-5, AC-6).

### 4.7 `SourceBadge`

File: `apps/frontend/src/components/token-detail/SourceBadge.tsx`

**Props:**

```typescript
interface SourceBadgeProps {
  source: TransactionSource;
  tooltip?: string;
}
```

**Display values (AC-3):**

| Source | Label | Style |
|--------|-------|-------|
| `ETHERSCAN` | "Etherscan" | `bg-gray-700 text-gray-200` |
| `BSCTRACE` | "BSCTrace" | `bg-gray-700 text-gray-200` |
| `BINANCE` | "Binance" | `bg-binance text-black` |
| `MANUAL` | "Manual" | `bg-gray-600 text-gray-300` |

When `tooltip` is provided, apply Tailwind `group`/`group-hover` pattern (see §4.8) for rich content, or `title={tooltip}` for plain string content. For AC-10 (Binance withdrawal tx hash), use `title`.

### 4.8 `CostSourceBadge`

File: `apps/frontend/src/components/token-detail/CostSourceBadge.tsx`

**Props:**

```typescript
interface CostSourceBadgeProps {
  costSource: CostSource;
  costInheritedFrom: CostInheritedFrom;
}
```

Only rendered for `TRANSFER_IN` rows. Hide (return `null`) when `costSource === null` or `costSource === 'MARKET'`.

**Rendering rules (AC-7, AC-8, AC-9):**

| `costSource` | `costInheritedFrom` | Badge | Color |
|--------------|---------------------|-------|-------|
| `'INHERITED'` | `'ONCHAIN'` | "Cost inherited (wallet)" | `bg-green-900 text-green-300` |
| `'INHERITED'` | `'BINANCE'` | "Cost inherited (Binance)" | `bg-green-900 text-green-300` |
| `'MANUAL'` | `null` | "Manual cost" | `bg-gray-700 text-gray-400` |

### 4.9 `Tooltip`

File: `apps/frontend/src/components/token-detail/Tooltip.tsx`

Only used when the tooltip content must appear inline as a visually styled element (not a browser `title` attr). Per D4, the `group`/`group-hover` Tailwind pattern is used for cost and transfer badges.

**Props:**

```typescript
interface TooltipProps {
  children: React.ReactNode;   // the trigger element
  content: string;
}
```

**Pattern:**

```tsx
<span className="group relative inline-flex">
  {children}
  <span className={cn(
    "pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2",
    "whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs text-gray-100",
    "opacity-0 transition-opacity group-hover:opacity-100 z-10"
  )}>
    {content}
  </span>
</span>
```

This component is an OPTIONAL enhancement for cases where `title` attr is insufficient. For V1, `title` attr is preferred unless the UX specifically requires the styled tooltip. `TransactionTable` uses `title` for swap and withdrawal tooltips (AC-5, AC-6, AC-10).

### 4.10 `PositionHistoryPage` (minimal)

File: `apps/frontend/src/pages/PositionHistoryPage.tsx`

**Route:** `/token/:contractAddress/:network/history`

**Route params:** `contractAddress: string`, `network: string`

**Data:** fetched by `usePositionHistory(contractAddress, network)` — one-shot, no polling.

**Layout:**

```
<main>
  <BackLink → /token/:contractAddress/:network> (text: "← Token Detail")
  <h1>Position History</h1>
  <CycleCard × N />    {/* one per PositionHistoryEntry */}
  {/* or empty state */}
</main>
```

**`CycleCard` sub-component (inline, not exported):**

```typescript
interface CycleCardProps {
  entry: PositionHistoryEntry;
}
```

Displays:
- `CycleBadge` with `cycleNumber`
- Date range: `formatDate(openedAt) → formatDate(closedAt)` (e.g., "Jan 1, 2024 → Jun 30, 2024")
- Realized P&L: `PnlDisplay` with `value={entry.realizedPnlUsd}` kind="usd"

**Empty state:** when `cycles.length === 0`, render:

```
<p className="text-center text-gray-400 py-8">No closed cycles yet</p>
```

**Out of scope (D2):** aggregated stats per cycle (avgBuyPrice, totalBought, totalSold). The history endpoint does not return these.

---

## 5. Hooks

### 5.1 `useTokenDetail`

File: `apps/frontend/src/hooks/useTokenDetail.ts`

```typescript
export interface UseTokenDetailResult {
  data: TokenDetailResponse | null;
  loading: boolean;
  error: Error | null;
  lastUpdated: Date | null;
  isRefetching: boolean;
  refresh: () => Promise<void>;
}

export function useTokenDetail(
  contractAddress: string,
  network: string,
  walletId?: string | null,
): UseTokenDetailResult
```

- Polls every **30 seconds** (not 60s like `usePortfolio`) per D5.
- Pauses polling on `visibilitychange` to `hidden`; immediate refetch + re-arm on `visible`.
- When `walletId` changes: cancel pending interval, fire immediate fetch, re-arm interval.
- On `UnauthorizedError`: re-throw (auth context handles redirect).
- Stale-while-error: do NOT clear `data` on poll failure — show stale data + error banner.

URL construction:
```typescript
const url = walletId
  ? `/api/portfolio/token/${contractAddress}/${network}?wallet_id=${walletId}`
  : `/api/portfolio/token/${contractAddress}/${network}`;
```

### 5.2 `usePositionHistory`

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

- One-shot fetch only (no polling).
- No interval, no visibility handling.

### 5.3 `useWallets`

File: `apps/frontend/src/hooks/useWallets.ts`

```typescript
export interface UseWalletsResult {
  wallets: WalletSummary[];
  loading: boolean;
  error: Error | null;
}

export function useWallets(): UseWalletsResult
```

- One-shot fetch from `GET /api/wallets`.
- No polling.

---

## 6. Routing Additions

File: `apps/frontend/src/routes/router.tsx`

Add two protected routes:

```typescript
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

File: `apps/frontend/src/components/dashboard/PortfolioRow.tsx`

Add a `<Link>` on the symbol cell:

```tsx
import { Link } from "react-router-dom";

// In the symbol cell:
<Link
  to={`/token/${item.contractAddress}/${item.network}`}
  className="font-medium text-white hover:text-indigo-300 transition-colors"
>
  {item.symbol}
</Link>
```

---

## 7. Test Scenarios

### 7.1 `TokenDetailHeader` — unit

File: `apps/frontend/src/components/token-detail/__tests__/TokenDetailHeader.test.tsx`

| ID | Description | Assertion |
|----|-------------|-----------|
| SC-TDH-01 | Renders symbol and network badge | `getByText('WETH')`, `getByText('Ethereum')` |
| SC-TDH-02 | CycleBadge shows "CYCLE #1" when position present | `getByText('CYCLE #1')` |
| SC-TDH-03 | CycleBadge shows "CYCLE #—" when position is null | `getByText('CYCLE #—')` |
| SC-TDH-04 | "View 2 closed cycles" link shown when closedCycleCount=2 | `getByText('View 2 closed cycles')`, has correct href |
| SC-TDH-05 | "View N closed cycles" link hidden when closedCycleCount=0 | `queryByText(/closed cycles/)` is null |
| NEGATIVE-TDH-01 | No position → all stat cards show "—" (via TokenStatsCards) | `getAllByText('—').length >= 6` |

### 7.2 `WalletSelector` — unit

File: `apps/frontend/src/components/token-detail/__tests__/WalletSelector.test.tsx`

| ID | Description | Assertion |
|----|-------------|-----------|
| SC-WS-01 | Renders "All Wallets" as first option | `getByText('All Wallets')` |
| SC-WS-02 | Renders one option per wallet | `getAllByRole('option').length === wallets.length + 1` |
| SC-WS-03 | Selecting a wallet calls onSelect with walletId | `vi.fn()` called with `'wallet-1'` |
| SC-WS-04 | Selecting "All Wallets" calls onSelect with null | `vi.fn()` called with `null` |
| SC-WS-05 | Wallet label used when available | `getByText('My Wallet')` |
| SC-WS-06 | Truncated address used when label is null | address fallback shown |

### 7.3 `TypeBadge` — unit

File: `apps/frontend/src/components/token-detail/__tests__/TypeBadge.test.tsx`

| ID | Description | Assertion |
|----|-------------|-----------|
| SC-TB-01 | BUY → green badge | element has `bg-green-700` class |
| SC-TB-02 | SELL → red badge | element has `bg-red-700` class |
| SC-TB-03 | SWAP_IN → blue badge | element has `bg-blue-700` class |
| SC-TB-04 | SWAP_OUT → orange badge | element has `bg-orange-700` class |
| SC-TB-05 | TRANSFER_IN → gray badge | element has `bg-gray-700` class |
| SC-TB-06 | TRANSFER_OUT → gray badge | element has `bg-gray-700` class |
| SC-TB-07 | tooltip prop → title attribute set | element has `title="..."` |
| NEGATIVE-TB-01 | No tooltip prop → no title attribute | `title` attribute absent |

### 7.4 `CostSourceBadge` — unit

File: `apps/frontend/src/components/token-detail/__tests__/CostSourceBadge.test.tsx`

| ID | Description | Assertion |
|----|-------------|-----------|
| SC-CSB-01 | INHERITED + ONCHAIN → "Cost inherited (wallet)" green | `getByText('Cost inherited (wallet)')`, green class |
| SC-CSB-02 | INHERITED + BINANCE → "Cost inherited (Binance)" green | `getByText('Cost inherited (Binance)')`, green class |
| SC-CSB-03 | MANUAL + null → "Manual cost" gray | `getByText('Manual cost')`, gray class |
| NEGATIVE-CSB-01 | costSource=null → renders nothing | `container.firstChild === null` |
| NEGATIVE-CSB-02 | costSource='MARKET' → renders nothing | `container.firstChild === null` |

### 7.5 `TransactionTable` — unit

File: `apps/frontend/src/components/token-detail/__tests__/TransactionTable.test.tsx`

| ID | Description | Assertion |
|----|-------------|-----------|
| SC-TT-01 | Renders all 9 column headers | check `getByText` for each header label |
| SC-TT-02 | BUY row: amount formatted, priceUsd shown | `getByText(/formatCrypto result/)` |
| SC-TT-03 | SWAP_IN on-chain: TypeBadge has title="Auto-detected swap from TX 0x..." | `title` attr contains "Auto-detected swap" |
| SC-TT-04 | SWAP_IN Binance: TypeBadge has title="Binance Convert #..." | `title` attr contains "Binance Convert" |
| SC-TT-05 | TRANSFER_IN INHERITED ONCHAIN: CostSourceBadge renders "Cost inherited (wallet)" | badge text present |
| SC-TT-06 | TRANSFER_OUT Binance with txHash: SourceBadge has title="Withdrawal tx: 0x..." | `title` contains "Withdrawal tx" |
| SC-TT-07 | SELL row P&L column: value shown in italic | cell has `italic` class |
| SC-TT-08 | INBOUND pnl: P&L column shows lotPnlUsd | `PnlDisplay` rendered with pnl value |
| NEGATIVE-TT-01 | Empty transactions array → "No transactions recorded yet" | `getByText('No transactions recorded yet')` |
| NEGATIVE-TT-02 | priceUsd null → "Value at Time" shows "—" | `getAllByText('—')` includes value-at-time cell |
| NEGATIVE-TT-03 | currentPrice null → "Current Value" shows "—" | cell shows "—" |

### 7.6 `TokenDetailPage` — integration (mock API)

File: `apps/frontend/src/pages/__tests__/TokenDetailPage.test.tsx`

Uses `msw` (or `vi.spyOn(apiClient, 'get')`) to mock API responses.

| ID | Description | Assertion |
|----|-------------|-----------|
| SC-TDP-01 | Initial load: skeleton shown → data rendered | loading skeleton disappears, header visible |
| SC-TDP-02 | ON_CHAIN network: WalletSelector rendered | `getByRole('combobox')` or selector element |
| SC-TDP-03 | CEX_BINANCE: WalletSelector NOT rendered | wallet selector absent |
| SC-TDP-04 | Wallet selection triggers refetch with wallet_id | API called with `?wallet_id=...` |
| SC-TDP-05 | Invalid network in URL → redirect to "/" | router navigates to "/" |
| SC-TDP-06 | 404 response → error state shown | error message visible |
| SC-TDP-07 | Poll fires after 30s | advance timers by 30000ms, verify 2nd API call |
| SC-TDP-08 | Tab hidden → polling paused; tab visible → immediate refetch | visibilitychange events, timer assertions |
| NEGATIVE-TDP-01 | position=null + transactions=[] → empty state | "No transactions recorded yet" present |
| NEGATIVE-TDP-02 | API error with stale data → stale data shown + error banner | both present simultaneously |

### 7.7 Backend — `getTokenDetail` extended fields

File: `apps/backend/src/services/__tests__/portfolio.test.ts`

| ID | Description | Assertion |
|----|-------------|-----------|
| SC-BE-01 | `cycleNumber` present in position row | `result.position.cycleNumber === 1` |
| SC-BE-02 | `txHash` / `cexTradeId` / `relatedTxId` present in transaction | values match mock DB row |
| SC-BE-03 | SELL row: `pnl.kind === 'OUTBOUND'` with `realizedPnlUsd` populated | not null when prices available |
| SC-BE-04 | SELL row: `pnl.realizedPnlUsd === null` when `priceUsd` is null | null value |
| SC-BE-05 | `costInheritedFrom='ONCHAIN'` for INHERITED ETHERSCAN TRANSFER_IN | correct derivation |
| SC-BE-06 | `costInheritedFrom='BINANCE'` for INHERITED BINANCE TRANSFER_IN | correct derivation |
| SC-BE-07 | Existing portfolio summary tests still pass with `cycleNumber` | no regressions |
| NEGATIVE-BE-01 | `getTokenDetail` with unknown contractAddress → `NotFoundError` | throws with `TOKEN_NOT_FOUND` code |

---

## 8. File Map

| File | Action | Notes |
|------|--------|-------|
| `apps/backend/src/types/portfolio.ts` | MODIFY | Add `cycleNumber`, three tx fields, `costInheritedFrom`, extend `OutboundPnlSchema` |
| `apps/backend/src/services/portfolio.ts` | MODIFY | `buildPortfolioRow`, `TxRow`, SQL SELECT, mapper, `computePnl` |
| `apps/backend/src/services/__tests__/portfolio.test.ts` | MODIFY | Update fixtures, add new scenarios |
| `apps/frontend/src/types/token-detail.ts` | CREATE | All frontend types for this story |
| `apps/frontend/src/hooks/useTokenDetail.ts` | CREATE | 30s polling hook |
| `apps/frontend/src/hooks/usePositionHistory.ts` | CREATE | One-shot fetch hook |
| `apps/frontend/src/hooks/useWallets.ts` | CREATE | One-shot wallet fetch |
| `apps/frontend/src/pages/TokenDetailPage.tsx` | CREATE | Page component |
| `apps/frontend/src/pages/PositionHistoryPage.tsx` | CREATE | Minimal history page |
| `apps/frontend/src/components/token-detail/TokenDetailHeader.tsx` | CREATE | Header with logo, badges, link |
| `apps/frontend/src/components/token-detail/TokenStatsCards.tsx` | CREATE | Six stat cards |
| `apps/frontend/src/components/token-detail/WalletSelector.tsx` | CREATE | ON_CHAIN only |
| `apps/frontend/src/components/token-detail/TransactionTable.tsx` | CREATE | Full TX table |
| `apps/frontend/src/components/token-detail/TypeBadge.tsx` | CREATE | All six types + colors |
| `apps/frontend/src/components/token-detail/SourceBadge.tsx` | CREATE | Four sources |
| `apps/frontend/src/components/token-detail/CostSourceBadge.tsx` | CREATE | Three cost states |
| `apps/frontend/src/components/token-detail/Tooltip.tsx` | CREATE | group/group-hover pattern |
| `apps/frontend/src/routes/router.tsx` | MODIFY | Add two new protected routes |
| `apps/frontend/src/components/dashboard/PortfolioRow.tsx` | MODIFY | Add Link on symbol cell |
