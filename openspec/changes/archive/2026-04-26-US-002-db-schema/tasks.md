# Tasks: US-002 — DB Schema y Migraciones

Ref: `proposal.md`, `specs/database-schema/spec.md`, `specs/project-scaffold/spec.md`, `design.md`. Strict TDD activo (vitest, project `e2e`).

## Phase 1: Deps y config

- [x] 1.1 Añadir `pg@^8.13.0` y `@types/pg@^8.11.0` a `apps/backend/package.json`; añadir `tsx@^4.19.0` y `pg@^8.13.0` a `db/package.json`. `npm install` desde la raíz.
- [x] 1.2 Crear `db/.node-pg-migrate.json` con `{ "migrationFileLanguage": "sql", "schema": "public", "dir": "migrations" }`.
- [x] 1.3 Reescribir scripts en `db/package.json`: `migrate` → `node-pg-migrate up`, `migrate:down` → `node-pg-migrate down`, `seed` → `tsx seed.ts`. Asegurar lectura de `DATABASE_URL` por defecto.
- [x] 1.4 Reemplazar placeholders en `apps/backend/package.json` y raíz `package.json`: `db:migrate` y `db:seed` delegan a `npm -w @cryptoledger/db run migrate/seed`.
- [x] 1.5 Añadir `DATABASE_URL_TEST=postgresql://postgres:postgres@localhost:5432/cryptoledger_test` a `.env.example` y `DATABASE_URL_TEST: z.url().optional()` a `EnvSchema` en `apps/backend/src/env.ts`.

## Phase 2: ENUMs source of truth (TDD)

- [x] 2.1 RED: crear `db/enums.test.ts` que importa los 7 arrays de `./enums.ts` y verifica drift contra el SQL leyendo `migrations/0001_initial_schema.sql` (debe fallar — no existen).
- [x] 2.2 GREEN: crear `db/enums.ts` con los 7 arrays `as const` (WALLET_TYPES, NETWORKS, TRANSACTION_TYPES, TRANSACTION_SOURCES, POSITION_STATUSES, COST_SOURCES, SERVICE_NAMES) — named exports.
- [x] 2.3 Crear `apps/backend/src/db/types.ts` re-exportando `typeof X[number]` para cada ENUM.
- [x] 2.4 Wire `db/enums.test.ts` al vitest workspace (project `engine`).

## Phase 3: Migración SQL inicial (TDD por requirement)

- [x] 3.1 GREEN parcial: crear `db/migrations/0001_initial_schema.sql` con bloque `-- Up Migration` que define los 7 ENUMs (CREATE TYPE) → desbloquea Phase 2 drift test.
- [x] 3.2 Añadir tabla `users` (id UUID PK, password_hash, created_at) y `wallets` con CHECK constraint del Requirement "wallets con CHECK por tipo". `last_synced_at TIMESTAMPTZ NULL`.
- [x] 3.3 Añadir tabla `tokens` (network ENUM, contract_address NULL, binance_symbol VARCHAR(20) NULL).
- [x] 3.4 Añadir tabla `positions` con `UNIQUE(wallet_id, token_id, cycle_number)`.
- [x] 3.5 Añadir tabla `transactions` con todas las columnas (tx_hash NULL, tx_log_index NULL, cex_trade_id NULL, commission_*, related_tx_id FK self-ref NULL, source ENUM).
- [x] 3.6 Añadir partial UNIQUE on-chain `(tx_hash, tx_log_index) WHERE tx_hash IS NOT NULL AND source IN ('ETHERSCAN','BSCTRACE')`.
- [x] 3.7 Añadir partial UNIQUE CEX `(cex_trade_id, tx_log_index) WHERE cex_trade_id IS NOT NULL`.
- [x] 3.8 Añadir tabla `wallet_sync_cursors` con `UNIQUE(wallet_id, operation)`.
- [x] 3.9 Añadir tabla `api_credentials` con `service_name` ENUM canónico (sin BINANCE_API_SECRET).
- [x] 3.10 Añadir índices: `transactions(position_id)`, `(wallet_id, token_id)`, `(block_timestamp DESC)`, `(tx_hash) WHERE tx_hash IS NOT NULL`, `wallet_sync_cursors(wallet_id, operation)`.
- [x] 3.11 Añadir bloque `-- Down Migration` con DROPs en orden inverso de FK + DROP TYPE para los 7 ENUMs.

## Phase 4: Pool pg

- [x] 4.1 Crear `apps/backend/src/db/pool.ts`: singleton `Pool` desde `parseEnv().DATABASE_URL`, `max: 10`, SSL condicional por `sslmode=require`. Named export.
- [x] 4.2 Test unit `apps/backend/src/db/pool.test.ts`: dos imports devuelven misma instancia (referencial equality).

## Phase 5: Seed real

- [x] 5.1 Reescribir `db/seed.ts`: importar `pool` desde `apps/backend/src/db/pool.ts`, validar `count(*) FROM users === 0` (fail-on-existing con exit 1), insertar 1 user + 3 wallets (ETH SafePal, BSC SafePal, CEX_BINANCE) + tokens + 1 BUY + 1 SELL + Convert (2 rows) + 1 withdrawal de prueba.
- [x] 5.2 Mensaje de error claro si seed ya aplicado: `"DB already seeded — run 'npm run db:migrate -- down' to reset"`.

## Phase 6: E2E harness

- [x] 6.1 Crear `tests/e2e/setup.ts` (vitest `globalSetup` para project `e2e`): valida `DATABASE_URL_TEST`, ejecuta `db:migrate -- down -1` (best effort, swallow error) → `db:migrate up`. Usa `child_process.execSync` con env override.
- [x] 6.2 Modificar `vitest.workspace.ts` project `e2e`: agregar `globalSetup: ['./tests/e2e/setup.ts']`.
- [x] 6.3 Crear `tests/e2e/db/factories.ts`: helpers `createUser`, `createOnChainWallet`, `createCexWallet`, `createToken`, `createTransaction` que usan el pool y limpian con `TRUNCATE ... CASCADE` en helper `resetDb()`.

## Phase 7: E2E tests por requirement (RED → GREEN ya cubierto por Phase 3)

- [x] 7.1 RED+GREEN: `tests/e2e/db/migration-reversible.test.ts` — up sobre DB limpia (`pg_tables` contiene 7 tablas) y up→down→up idempotente (snapshot de `information_schema.columns`).
- [x] 7.2 `tests/e2e/db/wallets-check.test.ts` — 4 scenarios: ON_CHAIN válida, ON_CHAIN sin address falla, CEX con address falla, ON_CHAIN con CEX_BINANCE falla.
- [x] 7.3 `tests/e2e/db/wallets-last-synced.test.ts` — wallet nueva tiene `last_synced_at = NULL`; update + read concreto.
- [x] 7.4 `tests/e2e/db/wallet-sync-cursors.test.ts` — coexistencia 4 operations distintas; misma operation en wallets distintas; duplicado falla con 23505.
- [x] 7.5 `tests/e2e/db/tokens.test.ts` — token on-chain OK; token CEX OK; ETH on-chain ≠ ETH CEX coexisten; CHECK violations on-chain sin contract / CEX con contract.
- [x] 7.6 `tests/e2e/db/transactions-onchain.test.ts` — BUY OK; mismo `tx_hash` distinto `log_index` permitido; duplicado ETHERSCAN rechazado; MANUAL fuera del partial UNIQUE.
- [x] 7.7 `tests/e2e/db/transactions-convert.test.ts` — Convert (`cex_trade_id` con log 0 + 1 + `related_tx_id`); CEX puro sin tx_hash.
- [x] 7.8 `tests/e2e/db/positions-cycles.test.ts` — dos ciclos misma wallet+token OK; mismo ciclo duplicado falla con 23505.
- [x] 7.9 `tests/e2e/db/indexes.test.ts` — `pg_indexes` contiene los 5 índices con cláusulas correctas; partial UNIQUE on-chain (ETHERSCAN/BSCTRACE) y CEX (`cex_trade_id IS NOT NULL`) verificadas.
- [x] 7.10 `tests/e2e/db/seed.test.ts` — `seed()` exitoso → counts esperados; segunda corrida → exit != 0 con mensaje `already seeded`.

## Phase 8: NEGATIVE tests del PRD (explícitos)

- [x] 8.1 `tests/e2e/db/negative-cex-duplicate.test.ts` — INSERT `(cex_trade_id=999, tx_log_index=0)` duplicado → 23505 con `constraint='transactions_unique_cex'`.
- [x] 8.2 `tests/e2e/db/negative-binance-api-secret.test.ts` — INSERT con `service_name='BINANCE_API_SECRET'` → 22P02; alias canónico `BINANCE_SECRET_KEY` aceptado.
- [x] 8.3 `tests/e2e/db/negative-single-cex-wallet.test.ts` — `it.skip(...)` con NOTE `// Service-layer enforcement: see US-005`; test paralelo confirma que DB NO enforce la unicidad (acepta dos rows CEX_BINANCE).

## Phase 9: Verificación final

- [x] 9.1 `npm run typecheck` → exit 0 (backend + frontend).
- [x] 9.2 `npm run lint` → exit 0 tras override en `eslint.config.js` para tests/db (off `no-non-null-assertion`, `no-dynamic-delete`) e ignore de `db/*.js` scripts.
- [x] 9.3 `npm run test:engine` → 87/87 GREEN.
- [x] 9.4 `npm run test:e2e` → 33/33 GREEN + 1 skip intencional (US-005). Configurado `pool: 'forks' + singleFork: true` en project `e2e` para serializar acceso a la DB compartida.
- [x] 9.5 Inspección automatizada por `seed.test.ts`: ejecuta `npm run db:seed` real contra test DB y valida `users=1, wallets=3, tokens=4, transactions>=4`; segunda corrida emite `already seeded` con exit != 0.
- [x] 9.6 `npm run build` → dist limpio: `apps/backend/dist/` y `apps/frontend/dist/` no contienen `.test.*`, `setup.*` ni `factories.*`.
- [x] 9.7 `apply-progress.md` actualizado con TDD Cycle Evidence Batch 2 mergeado con Batch 1. Listo para sdd-verify.
