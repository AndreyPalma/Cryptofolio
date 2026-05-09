# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

The repo is implemented through **US-012 (Settings UI)**. Backend, frontend, DB schema, on-chain + Binance sync and the position engine are all real code, not stubs. SDD artifacts for finished stories live under `openspec/changes/archive/<date>-US-XXX-*`; live specs live under `openspec/specs/<capability>`.

Two reference documents are NOT code and should be treated specially:
- `prd.json` — the authoritative product spec (v5). When a rule in code disagrees with code-comments, `prd.json → resolvedDecisions` is the tiebreaker.
- `docs/prototipo/` — visual-only React/Babel-in-browser prototype loaded from `CryptoLedger.html`. It does NOT match the v5 CEX model (no `CEX_BINANCE` network, no swap decomposition, no WAC inheritance). Don't "fix" it to match the PRD unless asked. Preserve the `/*EDITMODE-BEGIN*/…/*EDITMODE-END*/` markers and the `__edit_mode_*` `postMessage` protocol in `app.jsx` — an external tool reads/writes them.

## Commands

Node 22 (`.nvmrc`). npm workspaces: `apps/*`, `packages/*`, `db`.

| Task | Command |
|---|---|
| Run backend + frontend together | `npm run dev` |
| Backend only / Frontend only | `npm run dev:backend` / `npm run dev:frontend` |
| Build everything | `npm run build` |
| Typecheck (both apps) | `npm run typecheck` |
| Lint / Lint --fix / Format | `npm run lint` / `npm run lint:fix` / `npm run format` |
| All tests | `npm test` |
| One vitest project | `npm run test:engine` · `npm run test:sync` · `npm run test:e2e` |
| One file | `npx vitest run <path>` (or with `--project <name>`) |
| One test | `npx vitest run <path> -t "<name pattern>"` |
| DB migrate up/down | `npm run db:migrate` / `npm run db:migrate:down` |
| DB seed | `npm run db:seed` |

Vitest uses a workspace (`vitest.workspace.ts`) with four projects:
- **frontend** — jsdom, `apps/frontend/src/**` and `apps/frontend/tests/**`
- **engine** — node, `apps/backend/src/**` + `apps/backend/tests/**` *excluding* `sync-*.test.ts`, plus `db/*.test.ts`
- **sync** — node, files under any `sync/` folder and `apps/backend/tests/sync-*.test.ts`
- **e2e** — node, `tests/e2e/**`. Runs **serial / single-fork** (`pool: forks`, `singleFork: true`, `fileParallelism: false`) because every file `TRUNCATE CASCADE`s the shared test DB via `resetDb()`. Don't parallelize it.

`tests/e2e/setup.ts` is a global setup — it needs `DATABASE_URL_TEST`. E2E tests will not run without it.

`db/` contains plain `.js` migrate/seed runners (`migrate.js`, `seed-runner.js`, `load-env.js`) plus `enums.ts` and `enums.test.ts` — the latter validates that the TS enum module stays in sync with the SQL `CREATE TYPE` statements. If you add a new ENUM value in SQL, update `db/enums.ts` or that test fails.

## High-level architecture

**Stack** — Backend: Fastify 5 + `fastify-type-provider-zod` + Zod 4 + `pg` + `decimal.js` + `viem`. Auth: `@fastify/cookie` + `@fastify/jwt` (HS256, 24h, cookie `token` httpOnly+Secure+SameSite=Strict). Frontend: React 19 + `react-router-dom` v7 + Tailwind v4 (`@tailwindcss/vite`) + Vite 6. DB: PostgreSQL via `node-pg-migrate`.

### Backend layering (`apps/backend/src/`)

```
index.ts            buildServer() — exported for tests; entry-point gated by isMain
env.ts              Zod EnvSchema + lazy parseEnv()
plugins/            auth.ts (JWT decoration + onRequest hook), health.ts
db/                 pool.ts (singleton pg.Pool)
routes/             HTTP layer — only Zod-validated I/O + service calls; no business logic
services/           Business logic. Each service takes a Pool, never a connection string
schemas/            Zod request/response schemas shared with routes
position-engine/    Pure FP. WAC + cycle math. No I/O. Heavily unit-tested
sync/               Adapters + classifiers
  clients/          External APIs (etherscan, bsctrace, binance-api, on-chain-api iface)
  classify.ts       Decomposes raw txs into (inbound, outbound) DecomposedTransaction[]
  cost-resolver.ts  resolveTransferCost(): wallet → CEX bridge → MANUAL fallback
  constants/        DEX router addresses for swap detection
```

Plugin registration order in `buildServer()` is **non-negotiable**: `@fastify/cookie` → `@fastify/jwt` → `authPlugin` (which registers `/api/auth/*` as public BEFORE adding the global `onRequest` hook) → all `/api/*` route modules → `healthPlugin` (public, outside `/api`).

Error handling is centralized in `setErrorHandler` — `ZodError` becomes 400 with `issues[]`, anything with a numeric `statusCode` is honored, otherwise 500. Service errors live in `services/errors.ts` (`NotFoundError`, etc.) — throw from services, don't `reply.send` from them.

`buildServer({ jwtSecret, enableAuth })` is exported so tests can spin up an app instance with `enableAuth: false` or a fixed secret. Don't call `parseEnv()` at module import time — it's lazy on purpose so tests don't need the full env.

### Frontend layering (`apps/frontend/src/`)

```
main.tsx → App.tsx → AuthProvider → ToastProvider → RouterProvider
routes/router.tsx     createBrowserRouter + ProtectedRoute
pages/                Page components (one per route)
components/<feature>/ Co-located by feature: dashboard, token-detail, add-transaction, settings
hooks/                React Query-style data hooks (usePortfolio, useTokenDetail, …)
lib/                  api-client.ts (fetch wrapper), auth-context, toast-context, format, cn
```

`lib/api-client.ts` is the single source of fetch — always `credentials: 'include'`, intercepts 401 → `redirectToLogin()` (registered via `registerAuthBridge()` from AuthContext to avoid a circular import). `BASE_URL` comes from `VITE_API_URL`.

`AuthProvider` MUST wrap `RouterProvider` (see `App.tsx` comment) — inverting it puts `useNavigate` outside the Router context and breaks the redirect.

## Domain model — non-obvious invariants

These come from `prd.json → resolvedDecisions` and `rules`. Most likely to be violated by someone skimming the schema:

- **WAC is pure.** `wac` only recalculates on `BUY`, `SWAP_IN`, `TRANSFER_IN`. `SELL`, `SWAP_OUT`, `TRANSFER_OUT` reduce balance but never touch WAC. Per-lot P&L shown in the transactions table is informational, not accounting.
- **Position cycles.** When balance reaches 0, the position is CLOSED and `realized_pnl_usd` is frozen. The next inbound event opens a new position with `cycle_number = max+1` and WAC starts from that event's price — no carry-over from prior cycles.
- **Token identity is per source.** On-chain token = `(contract_address, network ∈ {ETH,BSC})`. CEX token = `(symbol.toLowerCase(), 'CEX_BINANCE')` with `binance_symbol` for price lookups. **ETH on-chain and ETH on Binance are different tokens with independent WAC.** The dashboard must never aggregate them. CEX rows have `contract_address IS NULL` — see `0001_initial_schema.sql` and the fix in commit `3ff6b87`.
- **Swap decomposition.** Both on-chain router swaps (Uniswap v2/v3, PancakeSwap) and Binance Convert (`/sapi/v1/convert/tradeFlow`) are stored as **two rows**: `SWAP_OUT` (`tx_log_index=0`) + `SWAP_IN` (`tx_log_index=1`) linked by `related_tx_id`. Uniqueness constraints reflect this:
  - On-chain: `UNIQUE(tx_hash, tx_log_index) WHERE tx_hash IS NOT NULL AND source IN ('ETHERSCAN','BSCTRACE')`
  - CEX: `UNIQUE(cex_trade_id, tx_log_index) WHERE cex_trade_id IS NOT NULL`
  - A plain `UNIQUE(cex_trade_id)` will break Convert — explicitly called out as a v5 regression fix.
- **WAC inheritance on `TRANSFER_IN`** — see `prd.json → rules → "TRANSFER_IN COST RESOLUTION"`. Resolution order is implemented in `sync/cost-resolver.ts` / `OnChainSyncService`:
  1. `from_address` matches a registered `ON_CHAIN` wallet with an OPEN position → inherit WAC, `cost_source='INHERITED'`.
  2. Else: find a transaction with `source='BINANCE'`, `type='TRANSFER_OUT'`, same `tx_hash` (Binance stores the on-chain txId in withdraw-history) → inherit WAC from that CEX position, `cost_source='INHERITED'`.
  3. Else: `price_usd=null`, `cost_source='MANUAL'`, UI prompts user.
- **Binance withdrawal as cross-source bridge.** `BinanceSyncService.syncWithdrawals` writes the on-chain `txId` into `transactions.tx_hash` on the CEX-side `TRANSFER_OUT` row. That's what makes step 2 above possible. Don't null out `tx_hash` on CEX transfers.
- **Env var name:** `BINANCE_SECRET_KEY`, **not** `BINANCE_API_SECRET`. `api_credentials.service_name` enum, `EnvSchema` and `.env.example` must agree.
- **Only one `CEX_BINANCE` wallet.** Enforced by service layer (US-005), not DB. `ON_CHAIN` wallets must have `address` + `network ∈ {ETH,BSC}`; `CEX` wallets must have `address IS NULL` + `network='CEX_BINANCE'`. The DB CHECK `wallets_type_coherence` enforces the per-row coherence; the singleton rule is service-level.
- **Dust conversion is explicitly a non-goal** in V1. Balance Validation (vs `/sapi/v1/accountSnapshot`) showing small discrepancies is the dust, not a bug.

## Sync pagination and cursors

`wallet_sync_cursors` has `UNIQUE(wallet_id, operation)` where `operation` is a string like `'trades:ETHUSDT'`, `'converts'`, `'withdrawals'`, `'deposits'`. Per-endpoint windows:

- Binance `myTrades` — **24h** per symbol, one cursor per symbol
- Binance `convert/tradeFlow` — **30 days**
- Binance `capital/withdraw/history` + `deposit/hisrec` — **90 days**
- Etherscan / BSCTrace — delta-by-block, batch 1000; if `result.length === 1000`, re-query with `startblock = last_block - 1` until `< 1000`

All syncs are idempotent (`ON CONFLICT … DO NOTHING` against the constraints above) — re-running is safe.

## Price sources

- On-chain: DefiLlama (`/coins/prices/current/{chain}:{address}`), cached 60s. ETH/BNB use the pseudo-addresses in `on-chain-sync.ts → NATIVE_PSEUDO_ADDRESS`.
- CEX: Binance public `/api/v3/ticker/price?symbol=<binance_symbol>USDT` (no auth), cached 10s
- On price-source failure: return `{ priceUnavailable: true }`, never 500. The UI surfaces a "manual price" prompt for `cost_source='MANUAL'` rows.

## Commits and SDD workflow

- **Conventional commits only.** Recent history: `feat(scope):`, `fix(scope):`, `chore(sdd):`. **Never** add `Co-Authored-By` or AI attribution.
- Stories follow Spec-Driven Development. The `openspec` skills (`/sdd-new`, `/sdd-continue`, `/sdd-apply`, `/sdd-verify`, `/sdd-archive`) drive each US-XXX cycle. Live specs live under `openspec/specs/<capability>/` and are updated by `sdd-archive` when a change closes.
- Project skill registry lives under `.agents/skills/` (react-19, tailwind-4, typescript, zod-4, nodejs-backend-patterns, supabase, supabase-postgres-best-practices). The orchestrator pre-resolves these into compact rules — sub-agents do NOT read them directly.

## Working with the PRD

- Language is Spanish-leaning with English technical terms. Keep it that way when editing.
- `resolvedDecisions` entries document **why** a rule exists; read them before changing a rule, not just the `rules` section.
- `stories[].acceptanceCriteria` include `NEGATIVE:` lines — those are required error-case tests, not nice-to-haves.
- The `version` field bumps when accounting semantics change. If you materially alter a rule, bump it and note the change in `overview`.
