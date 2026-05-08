# US-010 Token Detail UI — Proposal

## Resolved Decisions

### D1 — Backend DTO extension

**Decision: YES — extend backend in this story.**

`TransactionWithPnl` will add three nullable fields: `txHash: string | null`, `cexTradeId: string | null`, `relatedTxId: string | null`. The SQL SELECT in `getTokenDetail` (line 357, `services/portfolio.ts`) must include those three columns.

`TokenPortfolioRowSchema` will add `cycleNumber: number` (non-nullable). `buildPortfolioRow` already calls `buildVirtualPosition` which computes `maxCycle` — it just never writes it into the returned object. The fix is a one-liner: add `cycleNumber: virtual.cycleNumber` to the return literal in `buildPortfolioRow`.

`TokenDetailSchema` does NOT need its own `cycleNumber` field — the value is already inside `position.cycleNumber`. When `position === null` the badge reads "CYCLE #—" (no open position, nothing to show).

**Rationale:** AC-1 (CYCLE badge), AC-5/6 (swap tooltips), and AC-10 (withdrawal tooltip) are required acceptance criteria. Deferring to a follow-up story would block sign-off on US-010.

---

### D2 — PositionHistoryPage scope

**Decision: Implement a MINIMAL PositionHistoryPage in this story — only the data the API actually provides.**

The route `/token/:contractAddress/:network/history` and the `PositionHistoryPage` component are in scope for US-010 because AC-12 explicitly requires the "View N closed cycles" link and a working destination.

The page will render one card per closed cycle showing: cycle number badge, date range (openedAt → closedAt), and realized P&L. The prototype's aggregated stats (avgBuyPrice, totalBought, totalSold, avgSellPrice) are NOT in scope — the history endpoint does not return them and extending it is a separate story.

**Rationale:** AC-12 requires a reachable `/history` page. Shipping the link to a 404 fails acceptance. Extending the history endpoint to support aggregated stats is over-scope for a UI story — defer to a dedicated backfill story.

---

### D3 — Wallet selector filtering

**Decision: Client-side filter for balance/WAC display; server-side refetch for transaction list.**

The `TokenDetailPage` loads `TokenDetail` once (with no `wallet_id` param). The stats header always shows the aggregate across all wallets. When the user changes the wallet selector the page refetches `GET /api/portfolio/token/:contractAddress/:network?wallet_id=<id>` to get a wallet-scoped transaction list and a per-wallet position.

For the **header stats**, the `wallet_id` filter is respected — the backend already filters positions by `wallet_id` when provided, so the refetch naturally scopes balance/WAC/P&L to the selected wallet.

**Rationale:** Pure client-side filtering of a pre-loaded full list would require shipping all wallets' transaction lists upfront (unbounded). The backend already supports `wallet_id` as a query param — use it. This also keeps position stats consistent with the transaction view.

---

### D4 — Tooltip implementation

**Decision: Small inline React component using a CSS `title` attribute for simple string tooltips; a lightweight hover-reveal `<span>` for richer content.**

There is no existing tooltip library in the project. For AC-5 (swap TX hash) and AC-6 (Binance Convert orderId) a `title` attribute on the badge is acceptable — these are informational and not critical UX. For AC-7/8/9 (CostSourceBadge) and AC-10 (withdrawal badge) where the tooltip content must fit within the badge row visually, use a `group/hover` Tailwind pattern with an absolute-positioned `<span>` that appears on `group-hover`.

No tooltip library added. `title` attr for swap badges; Tailwind `group-hover` for cost/transfer badges.

**Rationale:** Installing a tooltip library (Radix, Floating UI) for five tooltips is over-engineering. The hover pattern is sufficient for informational metadata. This can be upgraded to a proper Radix Tooltip if the design system formalizes it later.

---

### D5 — Polling interval

**Decision: 30 seconds, same as Dashboard.**

`useTokenDetail` will poll every 30 seconds, matching the `usePortfolio` pattern from US-009.

**Rationale:** Consistency with the dashboard cadence. Price and P&L data change at similar rates across both views. A shorter interval would add backend pressure without meaningful UX gain.

---

### D6 — Swap pair display

**Decision: Show only the transaction hash (on-chain) or orderId (CEX) in the tooltip — NOT what was swapped FROM.**

AC-5 specifies: `'Auto-detected swap from TX 0x...'`. AC-6 specifies: `'Binance Convert #<orderId>'`. No AC mentions showing the paired token.

The `related_tx_id` field (now added per D1) is present in the DTO but is used exclusively for linking pairs — it will not be shown in the tooltip text. The paired token could be resolved by joining on `related_tx_id`, but that requires an extra query or a JOIN to the transactions table. Out of scope.

**Rationale:** Following the AC text literally. The swap-pair display is a richer feature that belongs in a dedicated enhancement story.

---

## Component Tree

```
TokenDetailPage (page, fetches via useTokenDetail + useWallets)
├── TokenHeader
│   ├── TokenLogo (reused)
│   ├── NetworkBadge (reused)
│   ├── CycleBadge (new — inline, shows "CYCLE #N" or "CYCLE #—")
│   ├── WalletSelector (new — GlassSelect; hidden for CEX_BINANCE)
│   └── ClosedCyclesLink (new — ghost button → /token/:contractAddress/:network/history)
├── TokenStatsCards
│   ├── StatCard × 6: Balance | Current Price | Current Value | WAC | Cost Basis | P&L
│   └── PnlDisplay (reused — for P&L card)
├── TransactionTable
│   ├── TypeBadge (new — BUY/SELL/SWAP_IN/SWAP_OUT/TRANSFER_IN/TRANSFER_OUT)
│   ├── SourceBadge (new — ETHERSCAN/BSCTRACE/BINANCE)
│   ├── CostSourceBadge (new — INHERITED on-chain / INHERITED Binance / MANUAL)
│   └── PnlDisplay (reused — per-lot P&L column)
└── EmptyState (inline — "No transactions recorded yet")

PositionHistoryPage (page, fetches via usePositionHistory)
├── BackLink (→ /token/:contractAddress/:network)
└── CycleCard × N
    ├── CycleBadge (reused)
    ├── DateRange
    └── PnlDisplay (reused)
```

**Hooks:**
- `useTokenDetail(contractAddress, network, walletId?)` — polls every 30s
- `usePositionHistory(contractAddress, network)` — one-shot, no polling
- `useWallets()` — one-shot, fetches `/api/wallets` for label lookup in WalletSelector

**Types** (`apps/frontend/src/types/token-detail.ts`):
- `TokenDetail`, `TransactionWithPnl`, `PnlInfo`, `PositionHistoryEntry` — mirror backend Zod schemas after D1 extensions

---

## Backend Changes

### 1. `apps/backend/src/types/portfolio.ts`

**`TokenPortfolioRowSchema`** — add one field:
```typescript
cycleNumber: z.number().int().nonnegative(),
```

**`TransactionWithPnlSchema`** — add three nullable fields:
```typescript
txHash: z.string().nullable(),
cexTradeId: z.string().nullable(),
relatedTxId: z.string().nullable(),
```

### 2. `apps/backend/src/services/portfolio.ts`

**`buildPortfolioRow`** — add `cycleNumber` to the returned object:
```typescript
cycleNumber: virtual.cycleNumber,   // virtual is PositionState which already has it
```

**`getTokenDetail` SQL SELECT** — extend column list:
```sql
SELECT id, wallet_id, token_id, position_id, type, source,
       block_timestamp, amount, price_usd, cost_source,
       tx_hash, cex_trade_id, related_tx_id         -- add these three
  FROM transactions
```

**`TxRow` type** (inline or in `db/types.ts`) — add the three columns: `tx_hash: string | null`, `cex_trade_id: string | null`, `related_tx_id: string | null`.

**transaction mapper** (lines 368–385) — map the three new fields:
```typescript
txHash: tx.tx_hash ?? null,
cexTradeId: tx.cex_trade_id ?? null,
relatedTxId: tx.related_tx_id ?? null,
```

No migration needed — these columns already exist in the `transactions` table.

---

## Routing Additions

**`apps/frontend/src/routes/router.tsx`** — add two protected routes:

```typescript
{
  path: "/token/:contractAddress/:network",
  element: <ProtectedRoute><TokenDetailPage /></ProtectedRoute>,
},
{
  path: "/token/:contractAddress/:network/history",
  element: <ProtectedRoute><PositionHistoryPage /></ProtectedRoute>,
},
```

**`apps/frontend/src/components/dashboard/PortfolioRow.tsx`** — add a `<Link>` on the token symbol cell navigating to `/token/${contractAddress}/${network}`. This is a small change but necessary so the feature is reachable; it is in scope.

---

## Out of Scope

- **Aggregated buy/sell stats per cycle** in `PositionHistoryPage` (avgBuyPrice, totalBought etc.) — history endpoint does not return them; a dedicated story should extend the endpoint.
- **Radix or Floating UI tooltip library** — Tailwind hover pattern is sufficient for V1.
- **Transaction pagination** — the backend already limits to 1000 rows; a paginated TX table is a follow-up.
- **Edit/delete transactions** from the detail view.
- **Target exit price editing** — `token.targetExitPrice` is in the DTO but editing it is outside US-010.
- **Swap pair resolution** (what was swapped FROM/TO beyond tx hash/orderId) — see D6.
- **History endpoint aggregation extension** — deferred.

---

## Risks & Mitigations

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| R1 | Backend schema extension (D1) may break existing portfolio.test.ts assertions that mock `TransactionWithPnl` without the new fields | MEDIUM | New fields are nullable — existing mocks will still pass Zod validation. Update test fixtures that use `TransactionWithPnlSchema.parse(...)` to include `txHash: null, cexTradeId: null, relatedTxId: null`. |
| R2 | `TokenPortfolioRow` adding `cycleNumber` propagates to `PortfolioSummarySchema` (it embeds `TokenPortfolioRowSchema`) — the dashboard response shape changes | MEDIUM | `cycleNumber` is now a required field. `buildPortfolioRow` must always populate it. No nullable fallback — `buildVirtualPosition` always sets `maxCycle ≥ 1` for OPEN positions. Verify `getPortfolioSummary` tests still pass. |
| R3 | `useParams()` returns untyped strings — invalid `network` values could reach the API | LOW | Validate `network` against the `NETWORK` constant at the hook level; redirect to `/` with a toast on invalid params. |
| R4 | CEX route collision: `/token/eth/CEX_BINANCE` vs `/token/eth/ETH` (on-chain ETH with a hypothetical lowercase address) | NEGLIGIBLE | On-chain addresses are always `0x...` hex strings. CEX symbols are lowercase alpha. No real collision. |
| R5 | Empty state edge case: `position === null` but `transactions` is non-empty (closed positions with orphaned TXs) | LOW | This state is theoretically possible if a position is manually closed. Show transactions normally; render empty state only when BOTH are absent. Document in component. |
