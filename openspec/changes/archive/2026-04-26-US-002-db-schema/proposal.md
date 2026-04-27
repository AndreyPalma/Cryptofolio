# Proposal: US-002 — Schema de base de datos y migraciones

Origen: PRD v5 story `US-002` (`prd.json` líneas 352-372). Depende de `US-001` (scaffold ya archivado).

## Intent

Materializar el schema híbrido **on-chain / CEX** en Postgres (Supabase) con todos los invariantes v5 enforced a nivel DB cuando es posible. Sin este schema, los engines (US-004) y APIs (US-005+) no tienen dónde escribir. La elección de `node-pg-migrate` sobre Prisma se hizo en US-001 precisamente para soportar los **partial unique indexes** que esta story requiere.

## Scope

### In Scope

- Migraciones SQL en `db/migrations/` ejecutables vía `npm run db:migrate` (reemplaza el placeholder de US-001).
- Tablas: `users`, `wallets`, `tokens`, `positions`, `transactions`, `wallet_sync_cursors`, `api_credentials`.
- ENUMs: `wallet_type`, `network` (incl. `CEX_BINANCE`), `transaction_type`, `transaction_source` (incl. `BSCTRACE`, `BINANCE`), `position_status`, `cost_source`, `service_name` (incl. `BSCTRACE`, `BINANCE_API_KEY`, `BINANCE_SECRET_KEY`).
- Partial UNIQUE indexes:
  - on-chain: `(tx_hash, tx_log_index) WHERE tx_hash IS NOT NULL AND source IN ('ETHERSCAN','BSCTRACE')`.
  - CEX: `(cex_trade_id, tx_log_index) WHERE cex_trade_id IS NOT NULL` — soporta Convert (`SWAP_OUT` log_index 0 + `SWAP_IN` log_index 1, mismo `cex_trade_id`).
- CHECK constraints en `wallets` (ON_CHAIN ⇒ address NOT NULL ∧ network ∈ {ETH,BSC}; CEX ⇒ address NULL ∧ network = CEX_BINANCE).
- Índices B-tree per AC: `transactions(position_id)`, `(wallet_id, token_id)`, `(block_timestamp DESC)`, `(tx_hash) WHERE tx_hash IS NOT NULL`, `wallet_sync_cursors(wallet_id, operation)`.
- `positions UNIQUE(wallet_id, token_id, cycle_number)`.
- Pool pg compartido en `apps/backend/src/db/` (named export, no default) — necesario para tests e2e.
- Seed (`db:seed`): 1 user, 2 wallets ON_CHAIN (ETH+BSC SafePal), 1 wallet CEX_BINANCE, tokens on-chain y CEX, posiciones con BUY/SELL/Convert/withdrawal de prueba.
- Tests e2e (vitest project `e2e`) cubriendo cada AC y los dos NEGATIVE.

### Out of Scope

- Lógica WAC y ciclos (US-004).
- Endpoints REST (US-005).
- Hash de password / login (US-003) — solo dejamos la columna `password_hash`.
- Enforcement runtime de "una sola wallet CEX_BINANCE" (capa de servicio en US-005).
- Dust conversion y reconciliación de balance (no-goal v1).

## Capabilities

### New Capabilities

- `database-schema`: define tablas, ENUMs, constraints, índices, migraciones reversibles y seed para el dominio híbrido on-chain/CEX.

### Modified Capabilities

- `project-scaffold`: los placeholders `db:migrate` / `db:seed` (Requirement "DB placeholders" del scaffold) son **reemplazados** por implementación real. La modificación del requirement se documenta como delta spec.

## Approach

Una migración inicial `0001_initial_schema.sql` (con `up` + `down`) que crea ENUMs primero, luego tablas en orden de FK (users → wallets/tokens → positions → transactions → wallet_sync_cursors → api_credentials), luego índices y partial UNIQUEs. Seed en TypeScript usando el pool pg compartido. Tests e2e arrancan contra una DB de test (env `DATABASE_URL_TEST`) — `setup.ts` ejecuta `db:migrate` antes de cada suite.

## Affected Areas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `db/migrations/0001_initial_schema.sql` | New | Schema completo + índices + partial UNIQUEs |
| `db/seed.ts` | Modified | Reemplaza placeholder con fixtures reales |
| `db/package.json` | Modified | Script `migrate` apunta a node-pg-migrate; `seed` corre `tsx seed.ts` |
| `apps/backend/src/db/pool.ts` | New | Pool pg singleton, lee `DATABASE_URL` desde EnvSchema |
| `apps/backend/package.json` | Modified | Dependencia `pg` (runtime) + `@types/pg` (dev) |
| `apps/backend/tests/db/*.test.ts` | New | Cobertura e2e por AC (positivos + 2 NEGATIVE) |
| `vitest.workspace.ts` | None | El project `e2e` ya existe |
| `.env.example` | Modified | Añade `DATABASE_URL_TEST=` |

## Risks

| Riesgo | Likelihood | Mitigación |
|--------|------------|------------|
| Partial unique index mal redactado rompe Convert | Med | Test NEGATIVE explícito + test positivo Convert (mismo cex_trade_id, tx_log_index 0 y 1, debe insertar OK) |
| `down()` migration deja huérfanos en cascade | Low | `DROP TABLE ... CASCADE` ordenado inverso, y test que aplica up→down→up sin errores |
| Seed se vuelve fixture acoplado a tests | Med | Seed solo para dev local; tests usan factories propias en `tests/db/factories.ts` |
| Drift entre ENUM SQL y tipos TS | Med | Generador `db/types.ts` derivado de un único array `as const` exportado desde `db/enums.ts` que las migraciones referencian por nombre |

## Rollback Plan

`npm run db:migrate -- down` revierte la última migración. Como esta es la migración inicial, equivale a `DROP` de todo el schema. Para repos ya seedeados: `pg_dump` antes del down. En CI/dev no hay datos productivos, rollback es trivial.

## Dependencies

- US-001 archivado (✅): scaffold, env, vitest workspace, node-pg-migrate instalado.
- Postgres accesible vía `DATABASE_URL` (Supabase local o remoto).
- `DATABASE_URL_TEST` para suite e2e (puede ser misma DB con schema separado o DB efímera).

## Success Criteria

- [ ] `npm run db:migrate` aplica `0001_initial_schema.sql` sin errores en DB limpia.
- [ ] `npm run db:migrate -- down` revierte completamente; segundo `up` deja idéntico schema.
- [ ] `npm run db:seed` inserta los fixtures del PRD sin violar constraints.
- [ ] `npm run test:e2e` pasa en verde, cubriendo cada AC del PRD US-002 incluyendo los 2 NEGATIVE.
- [ ] Inspección manual: partial UNIQUE on-chain y CEX presentes en `pg_indexes` con la cláusula `WHERE` correcta.
- [ ] No aparece `BINANCE_API_SECRET` en el ENUM `service_name` (solo `BINANCE_API_KEY`, `BINANCE_SECRET_KEY`).
