# Spec: PortfolioTable — US-009

> **Change:** `US-009-dashboard-ui`
> **Phase:** sdd-spec
> **Date:** 2026-05-07

---

## 1. Overview

PortfolioTable renders the main token grid. It receives `portfolioItems` from the API (already grouped server-side) and renders one `TokenRow` per item. It handles zero-balance filtering, the empty state, and delegates expand/collapse to individual rows.

---

## 2. Props Contract

All numeric values are decimal strings from the backend.

```typescript
interface PortfolioTableProps {
  items: PortfolioItem[]
}

interface PortfolioItem {
  tokenId: number
  symbol: string
  network: 'ETH' | 'BSC' | 'CEX_BINANCE'
  contractAddress: string | null     // null for CEX
  binanceSymbol: string | null
  balance: string                    // decimal string
  currentPriceUsd: string | null
  currentValueUsd: string | null
  wacUsd: string
  costBasisUsd: string
  pnlUsd: string | null
  pnlPct: string | null
  priceUnavailable: boolean
  walletBreakdown: WalletBreakdownEntry[]
}

interface WalletBreakdownEntry {
  walletId: number
  walletAlias: string | null
  balance: string
  wacUsd: string
  costBasisUsd: string
  // pnlUsd is NOT provided — computed client-side
}
```

---

## 3. Zero-Balance Filtering

GIVEN items is received from the parent
WHEN PortfolioTable renders
THEN it filters out any item where parseFloat(item.balance) === 0 before rendering rows
AND only the filtered list is passed to TokenRow components
AND zero-balance items never appear in the DOM

---

## 4. Empty State

GIVEN the filtered items list is empty (after zero-balance filter)
THEN PortfolioTable renders PortfolioTableEmptyState instead of the table element
AND PortfolioTableEmptyState displays: "Add your first wallet in Settings"
AND the message includes a navigable link to /settings styled as a primary call-to-action
AND the table element is NOT present in the DOM

---

## 5. Column Definitions

The table renders these columns in this exact order:

| # | Column Header    | Source Field                        | Format                     | Notes                       |
|---|------------------|-------------------------------------|----------------------------|-----------------------------|
| 1 | (expand toggle)  | —                                   | button + chevron icon      | No header text              |
| 2 | (logo)           | contractAddress, symbol, network    | TokenLogo component        | No header text              |
| 3 | Symbol           | symbol                              | plain string               |                             |
| 4 | Network / Source | network                             | SourceBadge component      |                             |
| 5 | Balance          | balance                             | formatCrypto(balance)      |                             |
| 6 | Current Price    | currentPriceUsd                     | formatUsd(currentPriceUsd) | "—" when priceUnavailable   |
| 7 | Current Value    | currentValueUsd                     | formatUsd(currentValueUsd) | "—" when priceUnavailable   |
| 8 | WAC              | wacUsd                              | formatUsd(wacUsd)          | always rendered             |
| 9 | Cost Basis       | costBasisUsd                        | formatUsd(costBasisUsd)    | always rendered             |
| 10 | P&L ($)         | pnlUsd                              | PnlDisplay component       | "—" when priceUnavailable   |
| 11 | P&L (%)         | pnlPct                              | PnlDisplay (isPercent)     | "—" when priceUnavailable   |

Columns 1 and 2 have no header text and no sortable behavior.

---

## 6. Row Grouping

The API already returns on-chain tokens grouped by (symbol, network) — there is no client-side aggregation needed. The frontend renders one row per PortfolioItem as returned.

CRITICAL INVARIANT: ETH on-chain (network ETH) and ETH on Binance (network CEX_BINANCE) MUST render as separate rows. They are separate PortfolioItem entries from the API. The table must NEVER merge them.

---

## 7. Source Badge Rendering

SourceBadge is determined by item.network:

| network value | Badge rendered  | Style                                      |
|---------------|----------------|--------------------------------------------|
| CEX_BINANCE   | "Binance" pill  | Background bg-binance (#F0B90B), dark text |
| ETH           | "Ethereum" pill | Gray background, neutral text              |
| BSC           | "BSC" pill      | Gray background, neutral text              |

For ON_CHAIN rows (ETH or BSC):
- If walletBreakdown.length > 1, render a second pill: "N wallets" (e.g., "3 wallets")
- If walletBreakdown.length === 1, no wallet-count pill — single wallet is self-evident

For CEX rows: no wallet-count pill.

---

## 8. priceUnavailable Handling

GIVEN item.priceUnavailable === true
THEN columns 6 (Current Price), 7 (Current Value), 10 (P&L $), and 11 (P&L %) all render "—"
AND columns 5 (Balance), 8 (WAC), and 9 (Cost Basis) render normally — backend-computed without price
AND no error indicator is shown — "—" is the expected degraded state, not an error

---

## 9. Expand/Collapse Behavior

### GIVEN a TokenRow is collapsed (default state)
WHEN the user clicks the expand toggle button
THEN TokenRow sets its local expanded state to true
AND TokenRowExpanded renders as a full-width sub-row (tr with colSpan = total column count)
AND the chevron icon rotates 90 degrees
AND the button sets aria-expanded="true"

### GIVEN a TokenRow is expanded
WHEN the user clicks the expand toggle button again
THEN expanded becomes false
AND TokenRowExpanded is removed from the DOM
AND the chevron returns to its default orientation

### GIVEN multiple rows are visible
WHEN the user expands row A and then row B
THEN both rows are independently expanded — expanding one does NOT collapse others
AND there is no shared state between rows

---

## 10. TokenRowExpanded Sub-Row Content

```typescript
interface TokenRowExpandedProps {
  walletBreakdown: WalletBreakdownEntry[]
  currentPriceUsd: string | null
  priceUnavailable: boolean
  network: 'ETH' | 'BSC' | 'CEX_BINANCE'
}
```

### For ON_CHAIN tokens (ETH or BSC)

- Render one sub-row per walletBreakdown entry.
- Sub-row label: walletAlias ?? "Wallet #" + walletId (truncated to reasonable width).
- Sub-row columns: Balance, WAC, Cost Basis, P&L ($), P&L (%).
- P&L values are computed client-side (display only — not accounting truth):

```typescript
const price = parseFloat(currentPriceUsd ?? '0')
const wac = parseFloat(entry.wacUsd)
const bal = parseFloat(entry.balance)
const pnlUsd = (price - wac) * bal
const pnlPct = wac > 0 ? ((price - wac) / wac) * 100 : null
```

- When priceUnavailable === true, P&L columns in sub-rows also render "—".

### For CEX tokens (CEX_BINANCE)

- Render exactly one sub-row labeled "Binance Account".
- The single walletBreakdown[0] entry provides Balance, WAC, Cost Basis.
- P&L computed client-side using the same formula.
- When priceUnavailable === true, P&L columns render "—".

---

## 11. GIVEN/WHEN/THEN Scenarios

### GIVEN a portfolio with ETH on-chain and ETH on Binance
WHEN the table renders
THEN two separate rows appear for ETH
AND one has a gray "Ethereum" badge and one has a yellow "Binance" badge (#F0B90B)
AND their Balance, WAC, Cost Basis, and P&L values are fully independent
AND they are NEVER merged into a single row

### GIVEN a token with 3 wallets on ETH
WHEN the row renders collapsed
THEN the source badge area shows both "Ethereum" and "3 wallets" pills
WHEN the user expands the row
THEN 3 sub-rows appear, one per wallet, each with its own Balance/WAC/P&L

### GIVEN a CEX token row (network = CEX_BINANCE)
WHEN the row is expanded
THEN exactly one sub-row appears labeled "Binance Account"
AND no wallet-count pill is shown on the parent row

### GIVEN all portfolioItems have balance = "0"
THEN after zero-balance filtering the filtered list is empty
AND PortfolioTableEmptyState renders with the CTA link to /settings

---

## 12. NEGATIVE Cases

### NEGATIVE: walletBreakdown is empty array on an ON_CHAIN item
THEN TokenRowExpanded renders no sub-rows
AND the expand toggle is still present (user can still click it)
AND no error is thrown

### NEGATIVE: walletBreakdown[0] is undefined on a CEX item
THEN TokenRowExpanded renders no sub-rows for "Binance Account"
AND no crash occurs (use optional chaining: walletBreakdown[0]?.balance)

### NEGATIVE: item has network = CEX_BINANCE AND contractAddress !== null (backend contract violation)
THEN SourceBadge still renders "Binance" badge based on network field
AND TokenLogo uses letter-avatar path (CEX path triggered by network === 'CEX_BINANCE', not contractAddress)

### NEGATIVE: pnlUsd and pnlPct are both null where priceUnavailable === false
THEN render "—" for both P&L cells gracefully
AND no error is thrown

---

## 13. File Locations

```
apps/frontend/src/components/dashboard/PortfolioTable.tsx
apps/frontend/src/components/dashboard/PortfolioTableEmptyState.tsx
apps/frontend/src/components/dashboard/TokenRow.tsx
apps/frontend/src/components/dashboard/TokenRowExpanded.tsx
apps/frontend/src/components/dashboard/SourceBadge.tsx
apps/frontend/src/components/dashboard/PnlDisplay.tsx
```
