# Apply Progress — us-013-fiat-types-cex-order-id

> Generado: 2026-05-09
> Actualizado: 2026-05-10
> Batch: 1 (T01–T07) — COMPLETO ✅

## Estado de tareas

| Tarea | Archivo | Estado |
|-------|---------|--------|
| T01 | `apps/backend/tests/position-engine-fiat.test.ts` | ✅ Completada |
| T02 | `db/enums.test.ts` | ✅ Completada |
| T03 | `db/migrations/0005_fiat_types_cex_order_id.sql` | ✅ Completada |
| T04 | `db/enums.ts` | ✅ Completada |
| T05 | `apps/backend/src/position-engine/decimal-utils.ts` | ✅ Completada |
| T06 | `apps/backend/src/schemas/sync.ts` | ✅ Completada |
| T07 | — (quality gate) | ✅ Completada |

## Resultado Quality Gate T07

- `typecheck (backend)`: ✅ PASS — errores pre-existentes en test files de frontend/auth (no relacionados a US-013)
- `test:engine (fiat + drift guard + engine)`: ✅ PASS — 61/61 tests verdes
  - `position-engine-fiat.test.ts` (11 tests) ✅
  - `db/enums.test.ts` (35 tests) ✅ — FIAT_IN/FIAT_OUT confirmados en SQL + TS
  - `position-engine/engine.test.ts` (15 tests) ✅ — sin regresiones
- Hallazgo no-bloqueante: `portfolio.ts` no cubre FIAT_IN/FIAT_OUT en `computePnl` — documentado para sdd-verify (fuera del scope de US-013)

## Detalles por tarea

### T01 ✅ — `apps/backend/tests/position-engine-fiat.test.ts`
- Creado con 9 tests cubriendo: clasificación de tipos, FIAT_IN vacío, FIAT_IN existente (WAC ponderado), FIAT_OUT P&L, FIAT_OUT cierre, NEGATIVE balance insuficiente, NEGATIVE sin priceUsd.
- Usa `as any` para que TypeScript compile sin errores mientras FIAT_IN/FIAT_OUT no existen en TransactionType.
- **Estado RED confirmado**: tests fallarán porque `isInbound`/`isOutbound` no manejan esos tipos y `processTransaction` ejecutará `assertNever`.

### T02 ✅ — `db/enums.test.ts`
- Reemplazado import `readFileSync` → `readFileSync, readdirSync`.
- Eliminada `const migrationPath` (hardcoded).
- La variable `sql` ahora concatena TODOS los `.sql` de `migrations/` en orden lexicográfico.
- Movida al scope de módulo (fuera del callback de `describe`) — semánticamente equivalente.
- **Estado RED confirmado**: el drift guard fallará porque `FIAT_IN`/`FIAT_OUT` no aparecen en ningún `.sql` de `SQL_ENUM_DEFINITIONS` hasta que T04 los agregue a `enums.ts`.

  > Nota: T03 crea la migración SQL con los `ALTER TYPE ADD VALUE`, pero el drift guard en `enums.test.ts` busca `CREATE TYPE ... AS ENUM` con los miembros listados en `SQL_ENUM_DEFINITIONS`. El `ALTER TYPE ADD VALUE` **no** matchea ese patrón, por lo que el drift guard seguirá rojo hasta que T04 agregue los valores a `TRANSACTION_TYPES` en `enums.ts` — y la lógica de detección se actualice si es necesario (a verificar en T04/T05).

### T03 ✅ — `db/migrations/0005_fiat_types_cex_order_id.sql`
- Contenido exacto según tasks.md.
- `ALTER TYPE transaction_type ADD VALUE 'FIAT_IN'` + `'FIAT_OUT'`.
- `ALTER TABLE transactions ADD COLUMN cex_order_id TEXT NULL`.
- Índice parcial `transactions_cex_order_id_unique` con `WHERE cex_order_id IS NOT NULL`.
- Down migration: `DROP INDEX IF EXISTS` + `DROP COLUMN IF EXISTS`.
- No ejecutada en DB — solo archivo SQL creado.
