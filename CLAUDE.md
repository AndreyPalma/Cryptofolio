# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

This repo is **pre-implementation**. It currently contains two things:

- `prd.json` — the authoritative product spec (v5). Treat it as the source of truth over any stale code or prototype file.
- `prototipo/` — a visual-only UI prototype; no build, no backend, no persistence.

The backend/frontend described in the PRD (`/apps/backend`, `/apps/frontend`, `/db/migrations`) **do not exist yet**. Story US-001 (scaffold) is still `open`. Do not assume npm scripts, migrations, or services exist — verify before referencing them.

## The prototype (`prototipo/`)

Runnable by opening `prototipo/CryptoLedger.html` directly in a browser — no build step. It loads React 18 + ReactDOM + `@babel/standalone` via unpkg and transpiles the `.jsx` files in-browser via `<script type="text/babel">`.

File load order is fixed by `CryptoLedger.html`; each file relies on globals from the previous ones:

1. `mock-data.jsx` — `MOCK_WALLETS`, `MOCK_TOKENS`, `MOCK_PORTFOLIO`, `MOCK_TRANSACTIONS`
2. `components.jsx` — shared UI primitives (`TokenLogo`, `NetworkBadge`, `TypeBadge`, etc.)
3. `layout.jsx` — `AppLayout`, `LoginPage`
4. `pages-main.jsx` — `DashboardPage`, `AddTransactionPage`
5. `pages-token.jsx` — `TokenDetailPage`, `PositionHistoryPage`
6. `pages-settings.jsx` — `SettingsPage`
7. `app.jsx` — `App` root, in-memory routing, `TweaksPanel`

Routing is a plain `useState('/')` with string matching in `app.jsx:77-93` — there is no router library. `findTokenByRoute` resolves `/token/:address/:network` against `MOCK_TOKENS`.

The `TweaksPanel` (`app.jsx:10`) and `TWEAK_DEFAULTS` with `/*EDITMODE-BEGIN*/…/*EDITMODE-END*/` markers are part of an external edit-mode protocol that `postMessage`s `__edit_mode_*` events to `window.parent`. Preserve the markers and the message protocol when editing that file — another tool reads/writes them.

The prototype hardcodes only `ETH` + `BSC` + an on-chain-style Binance badge; it does **not** yet reflect the v5 CEX model (no `CEX_BINANCE` network, no swap decomposition, no WAC inheritance). Don't "fix" the prototype to match the PRD unless asked — it's a visual reference, not a contract.

## Domain model — non-obvious invariants

These come from `prd.json` → `resolvedDecisions` and `rules`. They are the rules most likely to be violated by someone skimming the schema:

- **WAC is pure.** `wac` only recalculates on `BUY`, `SWAP_IN`, `TRANSFER_IN`. `SELL`, `SWAP_OUT`, `TRANSFER_OUT` reduce balance but never touch WAC. Per-lot P&L shown in the transactions table is informational, not accounting.
- **Position cycles.** When balance reaches 0, the position is CLOSED and `realized_pnl_usd` is frozen. The next inbound event opens a new position with `cycle_number = max+1` and WAC starts from that event's price — no carry-over from prior cycles.
- **Token identity is per source.** On-chain token = `(contract_address, network∈{ETH,BSC})`. CEX token = `(symbol.toLowerCase(), 'CEX_BINANCE')` with `binance_symbol` for price lookups. **ETH on-chain and ETH on Binance are different tokens with independent WAC.** The dashboard must never aggregate them.
- **Swap decomposition.** Both on-chain router swaps (Uniswap v2/v3, PancakeSwap) and Binance Convert (`/sapi/v1/convert/tradeFlow`) are stored as **two rows**: `SWAP_OUT` (`tx_log_index=0`) + `SWAP_IN` (`tx_log_index=1`) linked by `related_tx_id`. This is why the CEX uniqueness constraint is compound:
  - On-chain: `UNIQUE(tx_hash, tx_log_index) WHERE tx_hash IS NOT NULL AND source IN ('ETHERSCAN','BSCTRACE')`
  - CEX: `UNIQUE(cex_trade_id, tx_log_index) WHERE cex_trade_id IS NOT NULL`
  - A plain `UNIQUE(cex_trade_id)` will break Convert — this is explicitly called out as a regression that was fixed in v5.
- **WAC inheritance on `TRANSFER_IN`** — see `rules` → "TRANSFER_IN COST RESOLUTION". Resolution order, in `OnChainSyncService.resolveTransferCost(txHash, fromAddress, tokenId)`:
  1. `from_address` matches a registered `ON_CHAIN` wallet with an OPEN position → inherit WAC, `cost_source='INHERITED'`.
  2. Else: find a transaction with `source='BINANCE'`, `type='TRANSFER_OUT'`, same `tx_hash` (Binance stores the on-chain txId in withdraw-history) → inherit WAC from that CEX position, `cost_source='INHERITED'`.
  3. Else: `price_usd=null`, `cost_source='MANUAL'`, UI prompts user for price.
- **Binance withdrawal as cross-source bridge.** `BinanceSyncService.syncWithdrawals` writes the on-chain `txId` into `transactions.tx_hash` on the CEX-side `TRANSFER_OUT` row. That's what makes step 2 above possible. Don't null out `tx_hash` on CEX transfers.
- **Env var name:** `BINANCE_SECRET_KEY`, not `BINANCE_API_SECRET`. This was a v4 bug fix — `api_credentials.service_name` enum and `.env.example` must match.
- **Only one `CEX_BINANCE` wallet.** Enforced by service layer (US-005), not a DB constraint. `ON_CHAIN` wallets must have address + `network ∈ {ETH,BSC}`; `CEX` wallets must have `address IS NULL` and `network='CEX_BINANCE'`.
- **Dust conversion is explicitly a non-goal** in V1. Expect Balance Validation (vs `/sapi/v1/accountSnapshot`) to show small discrepancies — that's the dust, not a bug.

## Sync pagination and cursors

`wallet_sync_cursors` has `UNIQUE(wallet_id, operation)` where `operation` is a string like `'trades:ETHUSDT'`, `'converts'`, `'withdrawals'`, `'deposits'`. Windows differ per endpoint:

- Binance `myTrades` — **24h** per symbol, one cursor per symbol
- Binance `convert/tradeFlow` — **30 days**
- Binance `capital/withdraw/history` + `deposit/hisrec` — **90 days**
- Etherscan / BSCTrace — delta-by-block, batch 1000; if `result.length === 1000`, re-query with `startblock = last_block - 1` until `< 1000`

All syncs are idempotent (`ON CONFLICT … DO NOTHING` against the constraints above) — re-running is safe.

## Price sources

- On-chain: DefiLlama (`/coins/prices/current/{chain}:{address}`), cached 60s
- CEX: Binance public `/api/v3/ticker/price?symbol=<binance_symbol>USDT` (no auth), cached 10s
- On price source failure: return `{ priceUnavailable: true }`, never 500

## Planned stack (from `prd.json` → `stack`)

- Backend: Fastify + TypeScript + Zod 4 (Node.js), deployed on Render
- Frontend: React + Vite + Tailwind, Render
- DB: Supabase (PostgreSQL)
- Auth: JWT HS256 24h in cookie `httpOnly + Secure + SameSite=Strict`, bcrypt factor 12 for the single `users` row

When scaffolding (US-001), the PRD requires these npm scripts to exist — even as placeholders — before later stories can build on them: `dev`, `build`, `typecheck`, `lint`, `test:engine`, `test:sync`, `test:e2e`, `db:migrate`, `db:seed`.

## Working with the PRD

- Language is Spanish-leaning with English technical terms. Keep it that way when editing.
- `resolvedDecisions` entries document **why** a rule exists; read them before changing a rule, not just the `rules` section.
- `stories[].acceptanceCriteria` include `NEGATIVE:` lines — those are required error-case tests, not nice-to-haves.
- The `version` field bumps when accounting semantics change. If you materially alter a rule, bump it and note the change in `overview`.
