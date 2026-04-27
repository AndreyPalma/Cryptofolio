# Verification Report: US-002-db-schema

**Change**: US-002-db-schema
**Version**: spec v1 (delta para `database-schema` NEW + `project-scaffold` MODIFIED)
**Mode**: Strict TDD

---

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 45 |
| Tasks complete | 45 |
| Tasks incomplete | 0 |

✅ Todas las tasks de las 9 fases (`tasks.md`) marcadas `[x]`.

---

## Build & Tests Execution

**Build**: ✅ Passed (`npm run build` — backend tsc + frontend vite, dist generado limpio).

**Typecheck**: ✅ Passed (`npm run typecheck` — backend `tsc --noEmit -p tsconfig.build.json` + frontend `tsc --noEmit -p tsconfig.json`, exit 0).

**Lint**: ✅ Passed (`npm run lint` — exit 0; única salida es el warning informativo `MODULE_TYPELESS_PACKAGE_JSON` no relacionado).

**Tests engine**: ✅ 87 passed / 0 failed / 0 skipped (7 archivos).

**Tests e2e**: ✅ 33 passed / 0 failed / 1 skipped (14 archivos, incluye `tests/e2e/smoke.test.ts`). El skip es intencional en `negative-single-cex-wallet.test.ts > it.skip(...)` con TODO explícito a US-005.

**Coverage**: ➖ No disponible — `vitest --coverage` no está configurado en el proyecto (no hay threshold ni `@vitest/coverage-*` instalado). No es bloqueante.

**Dist hygiene**: ✅ `apps/backend/dist/` y `apps/frontend/dist/` no contienen archivos `.test.*`, `setup.*` ni `factories.*`.

---

## TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | Tabla presente en `apply-progress.md` con secciones Batch 1 + Batch 2 |
| All tasks have tests | ✅ | 13/13 archivos e2e referenciados existen + 4 archivos engine |
| RED confirmed (tests exist) | ✅ | 17/17 archivos verificados (13 e2e + `enums.test.ts`, `backend-drift.test.ts`, `pool.test.ts`, `env-negative.test.ts`) |
| GREEN confirmed (tests pass) | ✅ | 120/120 tests pasan (87 engine + 33 e2e); 1 skip intencional |
| Triangulation adequate | ✅ | Cada test e2e cubre múltiples scenarios (positive + negative); ej. `wallets-check.test.ts` con 4 cases, `tokens.test.ts` con 5 cases, `transactions-onchain.test.ts` con 4 cases |
| Safety Net for modified files | ✅ | Batch 2 corrió `engine 87/87` antes de tocar config eslint y vitest workspace |

**TDD Compliance**: 6/6 checks passed.

---

## Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Engine (unit + integration in-process) | 87 | 7 | vitest 2 |
| E2E (real Postgres) | 33 + 1 skip | 14 | vitest 2 + pg + Docker Postgres local |
| **Total** | **120 + 1 skip** | **21** | |

---

## Spec Compliance Matrix — `database-schema/spec.md`

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Migración inicial reversible | Up sobre DB limpia | `migration-reversible.test.ts > crea las 7 tablas del dominio sobre DB limpia` | ✅ COMPLIANT |
| Migración inicial reversible | Up → down → up es idempotente | `migration-reversible.test.ts > up → down → up es idempotente: el snapshot de columnas es idéntico` | ✅ COMPLIANT |
| Tabla `wallets` con CHECK por tipo | Wallet ON_CHAIN válida | `wallets-check.test.ts > ON_CHAIN con address y network ETH inserta OK` | ✅ COMPLIANT |
| Tabla `wallets` con CHECK por tipo | ON_CHAIN sin address falla | `wallets-check.test.ts > ON_CHAIN sin address falla con CHECK violation` | ✅ COMPLIANT |
| Tabla `wallets` con CHECK por tipo | CEX con address falla | `wallets-check.test.ts > CEX con address falla con CHECK violation` | ✅ COMPLIANT |
| Wallet `last_synced_at` nullable | Wallet nueva sin sync | `wallets-last-synced.test.ts > una wallet recién creada tiene last_synced_at = NULL` | ✅ COMPLIANT |
| `wallet_sync_cursors` UNIQUE compuesto | Cursor por símbolo coexiste con cursor genérico | `wallet-sync-cursors.test.ts > permite múltiples operations distintas para la misma wallet` | ✅ COMPLIANT |
| `wallet_sync_cursors` UNIQUE compuesto | Cursor duplicado falla | `wallet-sync-cursors.test.ts > rechaza un (wallet_id, operation) duplicado con UNIQUE violation` | ✅ COMPLIANT |
| Tabla `tokens` soporta on-chain y CEX | Token on-chain | `tokens.test.ts > inserta un token on-chain con contract_address válido` | ✅ COMPLIANT |
| Tabla `tokens` soporta on-chain y CEX | Token CEX | `tokens.test.ts > inserta un token CEX con binance_symbol y sin contract_address` | ✅ COMPLIANT |
| Tabla `transactions` soporta on-chain + CEX + swap | BUY on-chain | `transactions-onchain.test.ts > inserta una BUY on-chain con tx_hash + tx_log_index=0` | ✅ COMPLIANT |
| Tabla `transactions` soporta on-chain + CEX + swap | Convert Binance (dos rows mismo cex_trade_id) | `transactions-convert.test.ts > inserta un Convert como dos rows: SWAP_OUT (log 0) + SWAP_IN (log 1) linkeadas por related_tx_id` | ✅ COMPLIANT |
| Partial UNIQUE on-chain | Mismo tx_hash con distinto log_index permitido | `transactions-onchain.test.ts > permite mismo tx_hash con distinto tx_log_index (router swap multi-log)` | ✅ COMPLIANT |
| Partial UNIQUE on-chain | Duplicado on-chain falla | `transactions-onchain.test.ts > rechaza duplicado on-chain (mismo tx_hash, mismo tx_log_index, source ETHERSCAN)` | ✅ COMPLIANT |
| Partial UNIQUE CEX (NEGATIVE PRD) | Convert válido — mismo cex_trade_id, distinto tx_log_index | `transactions-convert.test.ts > inserta un Convert como dos rows...` (covers it) | ✅ COMPLIANT |
| Partial UNIQUE CEX (NEGATIVE PRD) | Duplicado CEX falla (NEGATIVE) | `negative-cex-duplicate.test.ts > rechaza un INSERT idéntico (cex_trade_id=999, tx_log_index=0) con código 23505` | ✅ COMPLIANT |
| `api_credentials.service_name` ENUM canónico | Insertar BINANCE_SECRET_KEY OK | `negative-binance-api-secret.test.ts > acepta el alias canónico 'BINANCE_SECRET_KEY'` | ✅ COMPLIANT |
| `api_credentials.service_name` ENUM canónico | Insertar BINANCE_API_SECRET falla | `negative-binance-api-secret.test.ts > rechaza el INSERT con código 22P02 (invalid_text_representation)` | ✅ COMPLIANT |
| `positions` UNIQUE por ciclo | Dos ciclos misma wallet+token | `positions-cycles.test.ts > permite dos ciclos consecutivos sobre la misma (wallet, token)` | ✅ COMPLIANT |
| `positions` UNIQUE por ciclo | Mismo ciclo duplicado falla | `positions-cycles.test.ts > rechaza dos posiciones con el mismo cycle_number` | ✅ COMPLIANT |
| Índices de consulta | Índices presentes en pg_indexes | `indexes.test.ts > declara los 5 índices de transactions/wallet_sync_cursors con sus cláusulas WHERE` + `... declara los partial UNIQUE on-chain y CEX con sus cláusulas WHERE correctas` | ✅ COMPLIANT |
| Seed reproducible | Seed exitoso desde DB migrada | `seed.test.ts > puebla la DB con los counts esperados (1 user, 3 wallets, 4 tokens, ≥4 transactions)` | ✅ COMPLIANT |
| Seed reproducible | Seed idempotente | `seed.test.ts > la segunda corrida sin reset falla limpiamente con exit != 0 y mensaje 'already seeded'` | ✅ COMPLIANT |
| Pool pg compartido | Pool reusable entre requests | `apps/backend/src/db/pool.test.ts > exports a singleton Pool instance (referential equality across imports)` | ✅ COMPLIANT |
| Pool pg compartido | Pool falla rápido si DATABASE_URL inválido | `apps/backend/tests/env-negative.test.ts` (cubre el fail-fast en env, ya cubierto por scaffold) | ✅ COMPLIANT |

**Compliance summary**: 25/25 scenarios del spec `database-schema` cubiertos.

---

## Spec Compliance Matrix — `project-scaffold/spec.md` (delta MODIFIED)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| DB placeholders | Migrate aplica schema sobre DB limpia | `migration-reversible.test.ts > crea las 7 tablas...` (verifica que migración real aplica) | ✅ COMPLIANT |
| DB placeholders | Seed inserta fixtures sobre schema migrado | `seed.test.ts > puebla la DB con los counts esperados...` | ✅ COMPLIANT |

**Stdout no contiene "placeholder"**: ⚠️ PARTIAL — el AC explícito `stdout MUST NOT contener la cadena "placeholder"` no es asertado directamente por ningún test. Está cubierto implícitamente (los scripts fueron reemplazados — corren código real, no el stub `"placeholder: US-002 will implement"`). Ver WARNING abajo.

**Compliance summary**: 2/2 scenarios cubiertos comportamentalmente; 1 sub-aserción explícita no testeada.

---

## Correctness (Static — Structural Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| 7 ENUMs (wallet_type, network, transaction_type, transaction_source, position_status, cost_source, service_name) | ✅ Implemented | `0001_initial_schema.sql:11-37`; drift validado por `db/enums.test.ts` y `db/backend-drift.test.ts` |
| 7 tablas (users, wallets, tokens, positions, transactions, wallet_sync_cursors, api_credentials) | ✅ Implemented | `0001_initial_schema.sql:42-201`; verificado en `migration-reversible.test.ts` |
| CHECK constraints (wallets, tokens) | ✅ Implemented | Líneas 62-66 (wallets), 84-88 (tokens) |
| Partial UNIQUE on-chain | ✅ Implemented | `transactions_unique_onchain` línea 147-149 |
| Partial UNIQUE CEX | ✅ Implemented | `transactions_unique_cex` línea 153-155 |
| `positions UNIQUE(wallet_id, token_id, cycle_number)` | ✅ Implemented | Línea 116 |
| 5 índices B-tree | ✅ Implemented | Líneas 158-169 |
| `wallet_sync_cursors` UNIQUE | ✅ Implemented | Línea 183 |
| Pool pg singleton | ✅ Implemented | `apps/backend/src/db/pool.ts` |
| Seed real (1 user, 3 wallets, 4 tokens, 5 transactions) | ✅ Implemented | `db/seed.ts` |
| E2E harness (globalSetup + factories) | ✅ Implemented | `tests/e2e/setup.ts`, `tests/e2e/db/factories.ts` |
| Down migration completa | ✅ Implemented | `0001_initial_schema.sql:204-220` |

---

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| ENUMs `as const` en TS como SoT + drift test | ✅ Yes | `db/enums.ts` + `db/enums.test.ts` (33 tests) |
| Migraciones SQL crudas, no JS | ✅ Yes | `migrationFileLanguage: "sql"` en `db/.node-pg-migrate.json`, archivo `.sql` plano |
| Pool pg config (max:10, SSL condicional) | ✅ Yes | `pool.ts` exactamente como design ln 31 |
| Test DB strategy (`DATABASE_URL_TEST` + `globalSetup`) | ✅ Yes | `tests/e2e/setup.ts` |
| Seed idempotency: fail-on-existing | ✅ Yes | `seed.ts` con `count(users) > 0` → `exit 1` |
| Backend types.ts duplica `as const` (rootDir restrict) | ⚠️ Deviated | Documentado en design + apply-progress como compromiso necesario por `tsconfig.build.json` rootDir; drift guard via `backend-drift.test.ts` |
| e2e parallelism: design no especificaba | ⚠️ Deviated | Apply-progress documentó: requirió `singleFork: true` para evitar race en `TRUNCATE CASCADE`. Improvement, no regression. |
| Manual seed inspection (psql) | ⚠️ Deviated | Apply-progress reemplazó por automatizado en `seed.test.ts`. Más rigoroso. |
| Lint relaxations en `eslint.config.js` | ⚠️ Deviated | Override en tests/db para `no-non-null-assertion` y `no-dynamic-delete`; `db/*.js` ignorados. Necesario para que `npm run lint` pase con código de Batch 1. Production code mantiene rules estrictas. |

---

## Assertion Quality

Audité los 13 archivos e2e Batch 2 + 3 archivos engine relevantes. Una observación menor:

| File | Line | Assertion | Issue | Severity |
|------|------|-----------|-------|----------|
| `tests/e2e/db/negative-single-cex-wallet.test.ts` | 16 | `expect(true).toBe(true);` | Tautology — pero está dentro de `it.skip(...)` (placeholder explícito para US-005, nunca ejecuta) | WARNING (intencional) |

**Assertion quality**: 0 CRITICAL, 1 WARNING (tautology dentro de `it.skip`, justificado por TODO US-005 explícito). El resto de las 33 aserciones activas verifican comportamiento real (constraint codes 23505/23514/22P02, counts SQL, snapshot de `information_schema.columns`, `pg_indexes` definitions, related_tx_id linkeo, etc.).

---

## Quality Metrics

**Linter**: ✅ No errors (después de los overrides documentados).
**Type Checker**: ✅ No errors (backend + frontend).
**Build**: ✅ Passed.
**Dist hygiene**: ✅ Clean.

---

## Issues Found

### CRITICAL (must fix before archive)

**Ninguno.**

### WARNING (should fix)

1. **Tautology dentro de `it.skip` en `negative-single-cex-wallet.test.ts:16`** — `expect(true).toBe(true)` jamás corre, pero la convención TDD estricta marca tautologías como CRITICAL. Aquí lo bajo a WARNING porque el test está skippeado y existe un TODO explícito a US-005. Sugerencia: reemplazar por `it.todo("...")` (vitest soporta `todo` que comunica intención sin necesidad de assertion).
2. **Sub-aserción `stdout MUST NOT contener "placeholder"` no testeada explícitamente** — el delta del project-scaffold lo lista como AC. Cubierto implícitamente porque `seed.ts` y `migrate.js` no contienen esa string, pero no hay un test que afirme la negación. Sugerencia: añadir un assertion adicional en `seed.test.ts` verificando `expect(result.stdout).not.toMatch(/placeholder/i)`.
3. **Coverage tool no configurado** — `vitest` corre sin `--coverage`; no se mide cobertura per-archivo. No bloqueante para US-002 (testing capabilities del proyecto no incluyen coverage), pero conviene incorporarlo en alguna story posterior si el proyecto crece.
4. **`dist/` se construye fuera de `db/`** — `db/` no tiene script `build` ni `dist`; es solo runtime via `tsx`. Esto está bien, pero conviene documentar en CLAUDE.md o README que `db/` es un workspace ESM puro sin compilación.

### SUGGESTION (nice to have)

1. **`closePool()` en factories no se invoca en ningún `afterAll`** — vitest cierra el proceso al terminar y el pool muere igual; no es leak real. Si vitest empieza a quejarse de open handles, agregar `afterAll(() => closePool())` en uno de los archivos (o como teardown del `globalSetup`).
2. **Reemplazar `it.skip(...)` por `it.todo(...)`** en `negative-single-cex-wallet.test.ts` para semántica más clara (vitest reporta `todo` separado de `skipped`).
3. **Añadir `db:reset` script** que combine `db:migrate:down` + `db:migrate` + `db:seed` para flujo dev local rápido (cosmético).
4. **Documentar `singleFork: true` para e2e en CLAUDE.md** — la decisión es invisible para cualquier dev nuevo y, si la quita por error, los tests rompen con FK violations crípticos.
5. **TDD evidence table en `apply-progress.md`** podría incluir un link a cada archivo (ya lo hace mayormente con backticks). Cosmético.

---

## Verdict

**PASS WITH WARNINGS**

US-002-db-schema cumple con todas las CRITICAL: 25/25 scenarios del spec `database-schema` y 2/2 del delta `project-scaffold` están cubiertos por tests que pasan. TDD evidence completa, build/lint/typecheck/tests todos en verde, dist limpio. Los 4 WARNINGS son menores: 1 tautología intencional dentro de `it.skip`, 1 sub-aserción de stdout no explícita, 1 coverage no configurado, 1 nota sobre db workspace. Ninguno bloquea archivado.

**Recomendación**: proceder con `sdd-archive`. Las WARNINGS pueden atenderse opcionalmente antes (pequeñas) o registrarse como follow-ups.
