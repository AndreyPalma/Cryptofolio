# US-010 Token Detail UI — Exploration

## Existing Infrastructure (reusable)

### Components (`apps/frontend/src/components/dashboard/`)
All of these can be used directly or trivially extended for the token detail page:

| Component | Reuse |
|-----------|-------|
| `TokenLogo` | Direct — already supports `sm/md/lg`, `CEX_BINANCE`, avatar fallback |
| `NetworkBadge` | Direct — covers ETH / BSC / Binance |
| `PnlDisplay` | Direct — handles `usd`/`pct` kind, positive/negative coloring |
| `SkeletonRow` | Pattern reference — build equivalent skeleton for token detail |
| `RefreshIndicator` | Direct — shows last-updated pulse dot |
| `SummaryCard` / `SummaryCards` | Pattern reference — build stat cards row for header |
| `PortfolioRowExpanded` | Pattern reference for wallet-per-row sub-breakdown |

### Hooks (`apps/frontend/src/hooks/`)
- `useRelativeTime` — direct reuse for last-updated indicator
- `usePortfolio` — architecture pattern to clone for `useTokenDetail`

### Lib (`apps/frontend/src/lib/`)
- `apiClient` — `apiClient.get<T>(url)` with 401 auto-redirect; direct reuse
- `cn()` — clsx + tailwind-merge; direct reuse
- `format.ts` — `formatUsd`, `formatPct`, `formatCrypto`; direct reuse
- `token-logo-utils.ts` — `trustWalletUrl`, `computeAvatarColor`; direct reuse
- `auth-context.tsx` — `useAuth()` for `ProtectedRoute`; no changes needed

### Types (`apps/frontend/src/types/portfolio.ts`)
Already defines `NETWORK`, `Network`, `SourceType`, `DecimalString`, `PortfolioItem`, `WalletBreakdown`. Need to add new types for `TokenDetail`, `TransactionWithPnl`, `PnlInfo`, `PositionHistoryEntry`.

### Router (`apps/frontend/src/routes/router.tsx`)
Uses `createBrowserRouter` from `react-router-dom`. Currently only has `/login` and `/` routes.

---

## Backend API Surface

### Route prefix: `/api/portfolio` (registered in `index.ts`)

#### GET `/api/portfolio/token/:contractAddress/:network`
- **Query params**: `wallet_id` (optional, ignored for CEX)
- **Response shape** (`TokenDetail`):
  ```typescript
  {
    token: {
      id: string;
      symbol: string;
      name: string | null;
      network: 'ETH' | 'BSC' | 'CEX_BINANCE';
      contractAddress: string;
      binanceSymbol: string | null;
      decimals: number;
      targetExitPrice: string | null;
    };
    position: TokenPortfolioRow | null;   // null when no OPEN position
    transactions: TransactionWithPnl[];
    priceUnavailable?: boolean;
  }
  ```
- **`TokenPortfolioRow`** includes: `symbol`, `network`, `sourceType`, `totalBalance`, `wacAggregated`, `totalCostBasis`, `currentPrice`, `totalCurrentValue`, `pnlUsd`, `pnlPct`, `walletCount`, `walletBreakdown[]`, `priceUnavailable`
- **`TransactionWithPnl`** includes: `id`, `walletId`, `tokenId`, `positionId`, `type`, `source`, `blockTimestamp` (ISO string), `amount`, `priceUsd`, `costSource`, `pnl: PnlInfo`
- **`PnlInfo`** discriminated union:
  - `{ kind: 'INBOUND', lotPnlUsd: string | null, lotPnlPct: string | null }`
  - `{ kind: 'OUTBOUND', displayAs: 'Sold/Out' }`
- **Note**: `position` is an aggregate across all wallets. `walletBreakdown` lists per-wallet balance+WAC. `cycleNumber` is not directly in the response — the `position` is always the current OPEN cycle; cycle number must be derived from context or shown as "CYCLE #?" until we verify how to obtain it.

  **IMPORTANT GAP**: `TransactionWithPnl` does NOT include `tx_hash`, `cex_trade_id`, or `related_tx_id`. The tooltips for AC-5 ("Auto-detected swap from TX 0x...") and AC-6 ("Binance Convert #orderId") and AC-10 ("Withdrawal tx: 0x...") require these fields. The backend query in `getTokenDetail` only selects a subset of columns.

#### GET `/api/portfolio/token/:contractAddress/:network/history`
- **Query params**: `wallet_id` (optional, ignored for CEX)
- **Response shape**: `{ cycles: PositionHistoryEntry[] }`
- **`PositionHistoryEntry`**: `{ cycleNumber: number; openedAt: string; closedAt: string; realizedPnlUsd: string }`

#### GET `/api/wallets`
- Returns array of `Wallet` objects: `{ id, user_id, wallet_type, address, network, label, last_synced_at, created_at }`
- Needed for the wallet selector (AC-2) — to map `walletId` from `walletBreakdown` to human-readable `label`

### Route for position detail note
- **CEX path**: `GET /api/portfolio/token/CEX_BINANCE_SYMBOL/CEX_BINANCE` — the `contractAddress` param holds the CEX symbol (`btc`, `eth`, etc.) since `findByContractAddress` in the service uses `contract_address` column which stores the lowercase symbol for CEX tokens.

---

## Routing

**Current setup** (`apps/frontend/src/routes/router.tsx`):
- `/login` → `LoginPage` (public)
- `/` → `ProtectedRoute` → `DashboardPage`

**Needed additions**:
```typescript
{
  path: "/token/:contractAddress/:network",
  element: <ProtectedRoute><TokenDetailPage /></ProtectedRoute>
},
{
  path: "/token/:contractAddress/:network/history",
  element: <ProtectedRoute><PositionHistoryPage /></ProtectedRoute>
}
```

`useParams()` from `react-router-dom` will provide `contractAddress` and `network` as strings. `network` must be validated against the `NETWORK` constant.

**Navigation from Dashboard**: `PortfolioRow` currently has no link to token detail. A click on the token symbol/row needs to be added to `DashboardPage` / `PortfolioRow` as part of this story or as a follow-up.

---

## Prototype Reference (`docs/prototipo/pages-token.jsx`)

Key UI decisions visible in the prototype:

1. **Header layout**: `TokenLogo` (42px) + token name + `NetworkBadge` + `CICLO #N` badge + wallet selector (ON_CHAIN only) + "Ver N ciclos cerrados" ghost button
2. **Stats row**: Responsive auto-fit grid with glass cards: Balance, Precio Actual, Valor Actual, WAC, Costo Base, P&L (value + pct as subValue)
3. **Transaction table columns**: Fecha | Tipo | Wallet (with CostBadge below) | Cantidad | Precio TX | Valor TX | Precio Act. | Valor Act. | P&L Lote
4. **Outbound rows**: Precio Act. and Valor Act. show `—`; P&L Lote shows italic "Sold/Out"
5. **TypeBadge colors from prototype**: BUY=green, SELL=red, SWAP_IN=blue, SWAP_OUT=orange, TRANSFER_IN=purple, TRANSFER_OUT=gray
6. **CostBadge** (prototype name) shown below wallet alias in the Wallet column — for INHERITED (green "WAC heredado") and MANUAL (gray "Costo manual")
7. **Wallet selector**: `GlassSelect` with "Todas las Wallets" + individual wallets — only shown for ON_CHAIN; hidden for CEX
8. **PositionHistoryPage**: Cards per cycle, each showing cycleNumber badge, date range, realizedPnlUsd prominently, plus stats grid (totalBought, avgBuyPrice, totalSold, avgSellPrice) — NOTE: the history endpoint only returns `cycleNumber/openedAt/closedAt/realizedPnlUsd`, the aggregated buy/sell stats are NOT in the API response

---

## Gaps — Needs Building

### New frontend files
1. **`apps/frontend/src/pages/TokenDetailPage.tsx`** — main token detail page
2. **`apps/frontend/src/pages/PositionHistoryPage.tsx`** — closed cycles history page
3. **`apps/frontend/src/hooks/useTokenDetail.ts`** — fetches `/api/portfolio/token/:contractAddress/:network`
4. **`apps/frontend/src/hooks/usePositionHistory.ts`** — fetches `/api/portfolio/token/:contractAddress/:network/history`
5. **`apps/frontend/src/hooks/useWallets.ts`** — fetches `/api/wallets` for wallet label lookup
6. **`apps/frontend/src/components/token/TypeBadge.tsx`** — BUY/SELL/SWAP_IN/SWAP_OUT/TRANSFER_IN/TRANSFER_OUT with correct colors
7. **`apps/frontend/src/components/token/CostSourceBadge.tsx`** — INHERITED(on-chain)/INHERITED(Binance)/MANUAL badges with tooltips
8. **`apps/frontend/src/components/token/TransactionTable.tsx`** — full TX table with all AC columns
9. **`apps/frontend/src/components/token/TokenHeader.tsx`** — logo+symbol+network+cycle+wallet selector
10. **`apps/frontend/src/components/token/TokenStatsCards.tsx`** — stats row (balance, price, value, WAC, cost, P&L)

### Type extensions
11. **`apps/frontend/src/types/token-detail.ts`** — `TokenDetail`, `TransactionWithPnl`, `PnlInfo`, `PositionHistoryEntry` types (mirror backend Zod schemas)

### Router update
12. **`apps/frontend/src/routes/router.tsx`** — add `/token/:contractAddress/:network` and `/token/:contractAddress/:network/history` routes

### Dashboard link
13. **`apps/frontend/src/components/dashboard/PortfolioRow.tsx`** — add clickable link on symbol cell to navigate to `/token/:contractAddress/:network`

### Backend gap — tooltip data missing
14. **`apps/backend/src/services/portfolio.ts`** — `getTokenDetail` query needs to include `tx_hash`, `cex_trade_id` columns in the SELECT for AC-5, AC-6, AC-10 tooltips. The `TransactionWithPnl` type and Zod schema must also expose these fields.

### Backend gap — cycle number
15. The `position` object in `TokenDetail` is a virtual aggregate. The `cycleNumber` for the OPEN position needs to be returned explicitly. Currently `buildVirtualPosition` sets `cycleNumber: maxCycle` — but this is not exposed in `TokenPortfolioRow`. Proposal: add `cycleNumber` to `TokenPortfolioRow` or add a top-level `currentCycleNumber` field to `TokenDetail`.

---

## Open Questions

1. **Cycle number display**: Should the "CICLO #N" badge read from `position.cycleNumber`? The backend virtual position already tracks `maxCycle` but doesn't serialize it in `TokenPortfolioRow`. Does it need to be added or is it already there? (Currently `TokenPortfolioRowSchema` does not include `cycleNumber`.)

2. **Tooltip data for swaps/transfers**: AC-5 needs `tx_hash`, AC-6 needs `cex_trade_id`, AC-10 needs `tx_hash` on TRANSFER_OUT. These are not returned by the current `getTokenDetail` query. Should the backend be extended in this story or deferred?

3. **Wallet selector label source**: `walletBreakdown` includes `walletId` and `label` (can be null). For ON_CHAIN tokens the label is already in the response — do we need `GET /api/wallets` or is `walletBreakdown[].label` sufficient? The fallback pattern in `PortfolioRowExpanded` truncates the `walletId` when label is null, which may be good enough.

4. **PositionHistoryPage stats**: The prototype shows avgBuyPrice/avgSellPrice/totalBought/totalSold per cycle, but the API only returns `realizedPnlUsd`. Should we simplify the history view to match what the API actually provides (cycleNumber, openedAt, closedAt, realizedPnlUsd)?

5. **Navigation from Dashboard**: Is adding a click-to-navigate to `PortfolioRow` in scope for US-010 or should it remain a separate story?

6. **Empty state when no position AND no transactions**: AC-13 says "No transactions recorded yet" — this happens when `position === null` AND `transactions === []`. Confirm this is the only empty case (no partial state where position=null but transactions exist).

---

## Risks

1. **Backend API gap (HIGH)**: `TransactionWithPnl` omits `tx_hash`, `cex_trade_id`, and `related_tx_id`. Without backend changes, AC-5, AC-6, and AC-10 (swap/transfer tooltips) cannot be implemented. This requires coordinating a backend schema extension alongside the frontend work.

2. **Cycle number not serialized (MEDIUM)**: `cycleNumber` is computed in `buildVirtualPosition` but not included in `TokenPortfolioRow`. Without it, the "CICLO #N" badge in the header (AC-1) cannot display the correct number. Requires a small backend addition.

3. **Route collision for CEX tokens (MEDIUM)**: CEX tokens use `contract_address` = lowercase symbol (e.g. `btc`, `eth`). On-chain ETH uses a hex address `0x...`. The route `/token/:contractAddress/:network` is ambiguous — `network=ETH` and `network=CEX_BINANCE` both being valid means the frontend must pass the correct network. No collision risk if the full `(contractAddress, network)` pair is always used together.

4. **PositionHistoryPage data gap (LOW-MEDIUM)**: The prototype shows aggregated stats (avgBuyPrice, totalBought) per closed cycle but the history endpoint only returns `cycleNumber/openedAt/closedAt/realizedPnlUsd`. Either simplify the UI to match the API, or extend the history endpoint — decision needed before design phase.

5. **React Router params are untyped strings (LOW)**: `useParams()` returns `Record<string, string | undefined>`. `network` must be validated at runtime against `NETWORK` values and the component must handle invalid routes gracefully (redirect to 404 or dashboard).
