# Tareas — US-013: FIAT_IN/FIAT_OUT types + columna cex_order_id

> Cambio: `us-013-fiat-types-cex-order-id`
> Generado: 2026-05-09
> Modo: Strict TDD (tests primero → implementación → quality gate)

---

## Work Unit 1: Tests TDD — fase RED (escribir tests antes de implementar)

> Los tests deben existir y fallar (rojo) ANTES de tocar cualquier archivo de
> implementación. Esto valida que los tests son sensibles al cambio.

- [x] **T01** — Crear archivo de tests para el engine con casos FIAT_IN / FIAT_OUT — `apps/backend/tests/position-engine-fiat.test.ts`

  **Qué escribir** (proyecto Vitest `engine`):
  ```
  describe("position engine — FIAT_IN / FIAT_OUT")
    ├── clasificación de tipos
    │   ├── FIAT_IN → isInbound=true, isOutbound=false        (REQ-003)
    │   ├── FIAT_OUT → isOutbound=true, isInbound=false       (REQ-003)
    │   └── tipos existentes no regresionan (BUY, SELL, SWAP_IN, SWAP_OUT, TRANSFER_IN, TRANSFER_OUT)
    ├── FIAT_IN sobre posición vacía: balance=100, wac=1, pnl=0, status=OPEN (REQ-004)
    ├── FIAT_IN sobre posición existente: WAC ponderado correcto
    ├── FIAT_OUT reduce balance y genera P&L: (priceUsd - WAC) × amount    (REQ-004)
    ├── FIAT_OUT cierra posición cuando balance llega a cero                (REQ-004)
    ├── NEGATIVE: FIAT_OUT con balance insuficiente → InsufficientBalanceError (NEGATIVE-003)
    └── NEGATIVE: FIAT_IN sin priceUsd → InvalidTransactionError           (NEGATIVE-005)
  ```

  **Estado esperado al crearlo**: ROJO — TypeScript rechazará `'FIAT_IN'` / `'FIAT_OUT'` en `TransactionType` hasta que `enums.ts` se actualice.

  **Dependencias**: ninguna (se crea primero)
  **Líneas estimadas**: ~140
  **Comando de verificación**: `npx vitest run apps/backend/tests/position-engine-fiat.test.ts --project engine`
  **Aceptación**: el archivo existe, los tests compilan y fallan por razón correcta (tipo no reconocido), NO por error de sintaxis

---

- [x] **T02** — Extender `db/enums.test.ts` para leer todos los archivos `.sql` de `migrations/` — `db/enums.test.ts`

  **Qué modificar** (decisión de arquitectura B, design §Decisión 2):
  ```typescript
  // Reemplazar:
  const migrationPath = resolve(here, "migrations/0001_initial_schema.sql");
  // ...
  const sql = readFileSync(migrationPath, "utf8");

  // Con:
  import { readdirSync } from "node:fs";
  const migrationsDir = resolve(here, "migrations");
  const sql = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(resolve(migrationsDir, f), "utf8"))
    .join("\n");
  ```
  El resto del `describe` / `it` permanece sin cambios.

  **Estado esperado al modificarlo**: ROJO — el drift guard fallará porque `FIAT_IN` / `FIAT_OUT` no aparecen en ningún SQL todavía (migración 0005 aún no existe), pero la lógica de lectura dinámica es correcta.

  **Dependencias**: T01 no bloquea, pueden hacerse en paralelo; ambos son fase RED
  **Líneas estimadas**: ~8 (3 eliminadas, 8 agregadas)
  **Comando de verificación**: `npx vitest run db/enums.test.ts --project engine`
  **Aceptación**: el test falla con mensaje claro de que `'FIAT_IN'` no está en el SQL concatenado (no por error de I/O)

---

## Work Unit 2: Migración SQL (fundación del schema)

> Debe ejecutarse después de que el drift guard roto (T02) confirma que los tests
> son sensibles. La migración es lo primero que convierte fase RED en GREEN para
> el drift guard (junto con T04).

- [x] **T03** — Crear migración `0005_fiat_types_cex_order_id.sql` — `db/migrations/0005_fiat_types_cex_order_id.sql`

  **Contenido exacto** (REQ-001 / REQ-006, design §Decisión 1):
  ```sql
  -- Up Migration
  -- REQ-001: Extend transaction_type enum with FIAT_IN and FIAT_OUT.
  -- PostgreSQL >= 12 allows ALTER TYPE ADD VALUE inside a transaction.
  -- Each ALTER TYPE must be a separate statement (PostgreSQL requirement).
  ALTER TYPE transaction_type ADD VALUE 'FIAT_IN';
  ALTER TYPE transaction_type ADD VALUE 'FIAT_OUT';

  -- REQ-006: Add cex_order_id column for Binance fiat order deduplication.
  -- Fiat orders use orderId (text), distinct from cex_trade_id (used by trades/converts).
  ALTER TABLE transactions ADD COLUMN cex_order_id TEXT NULL;

  -- Partial unique index: allows multiple NULL rows (on-chain txs) but enforces uniqueness
  -- when cex_order_id is set (fiat orders). NULLs are excluded from the index.
  CREATE UNIQUE INDEX transactions_cex_order_id_unique
    ON transactions (cex_order_id)
    WHERE cex_order_id IS NOT NULL;


  -- Down Migration
  -- NOTE: PostgreSQL does not support DROP VALUE on an ENUM type.
  -- The values FIAT_IN and FIAT_OUT will remain in the type after rollback
  -- but will be unused (no rows with those values if all fiat rows are removed).
  -- Full enum reversion would require recreating the type (destructive) — intentionally skipped.
  DROP INDEX IF EXISTS transactions_cex_order_id_unique;
  ALTER TABLE transactions DROP COLUMN IF EXISTS cex_order_id;
  ```

  **Dependencias**: T01, T02 (fase RED confirmada primero)
  **Líneas estimadas**: ~25
  **Comando de verificación**: `npm run db:migrate` (exit code 0)
  **Aceptación**: migración aplica sin error; `pg_enum` contiene `FIAT_IN` y `FIAT_OUT`; columna `cex_order_id` existe como `TEXT NULL`; índice parcial `transactions_cex_order_id_unique` existe

---

## Work Unit 3: Enum TypeScript — sincronización TS ↔ SQL

> Actualizar el array `TRANSACTION_TYPES`. Una vez aplicado junto a T03, el drift
> guard de T02 debe pasar (verde). `TransactionType` derivado se actualiza
> automáticamente en toda la aplicación.

- [ ] **T04** — Agregar `'FIAT_IN'` y `'FIAT_OUT'` a `TRANSACTION_TYPES` — `db/enums.ts`

  **Qué modificar** (REQ-002):
  ```typescript
  export const TRANSACTION_TYPES = [
    "BUY",
    "SELL",
    "SWAP_IN",
    "SWAP_OUT",
    "TRANSFER_IN",
    "TRANSFER_OUT",
    "FIAT_IN",   // REQ-002
    "FIAT_OUT",  // REQ-002
  ] as const;
  ```

  **Dependencias**: T03 (la migración debe existir para que el drift guard pase)
  **Líneas estimadas**: ~4 (2 valores + 2 comentarios)
  **Comando de verificación**: `npx vitest run db/enums.test.ts --project engine`
  **Aceptación**: drift guard pasa (verde); `TRANSACTION_TYPES.length === 8`

---

## Work Unit 4: Position Engine — type guards

> Con `TransactionType` ya extendido (T04), actualizar `isInbound` e `isOutbound`
> para que los tests de T01 pasen. `engine.ts` no requiere cambios — TypeScript
> mantiene exhaustividad automáticamente.

- [ ] **T05** — Extender `isInbound` e `isOutbound` con los nuevos tipos — `apps/backend/src/position-engine/decimal-utils.ts`

  **Qué modificar** (REQ-003, REQ-M02):
  ```typescript
  export function isInbound(
    type: TransactionType,
  ): type is 'BUY' | 'SWAP_IN' | 'TRANSFER_IN' | 'FIAT_IN' {
    return (
      type === 'BUY' ||
      type === 'SWAP_IN' ||
      type === 'TRANSFER_IN' ||
      type === 'FIAT_IN'
    );
  }

  export function isOutbound(
    type: TransactionType,
  ): type is 'SELL' | 'SWAP_OUT' | 'TRANSFER_OUT' | 'FIAT_OUT' {
    return (
      type === 'SELL' ||
      type === 'SWAP_OUT' ||
      type === 'TRANSFER_OUT' ||
      type === 'FIAT_OUT'
    );
  }
  ```

  **Dependencias**: T04 (necesita `TransactionType` extendido para que la firma sea correcta)
  **Líneas estimadas**: ~12 (expansión de las dos funciones)
  **Comando de verificación**: `npm run test:engine`
  **Aceptación**: todos los tests de `position-engine-fiat.test.ts` pasan; suite completa `test:engine` verde (NEGATIVE-004: sin regresiones)

---

## Work Unit 5: Zod Schema — validación de entrada

> Último cambio de implementación. No tiene dependencia de los tests de engine
> pero depende de que `TransactionType` esté extendido (T04) para que el tipo
> inferido por Zod sea consistente con el dominio.

- [ ] **T06** — Agregar `'FIAT_IN'` y `'FIAT_OUT'` al `z.enum` de `SyncedTxSchema` — `apps/backend/src/schemas/sync.ts`

  **Qué modificar** (REQ-005):
  ```typescript
  // Dentro de SyncedTxSchema (o donde esté definido el z.enum del campo type):
  type: z.enum([
    'BUY', 'SELL',
    'SWAP_IN', 'SWAP_OUT',
    'TRANSFER_IN', 'TRANSFER_OUT',
    'FIAT_IN', 'FIAT_OUT',   // REQ-005
  ]),
  ```

  **Dependencias**: T04 (TypeScript infiere correctamente si el enum TS está extendido)
  **Líneas estimadas**: ~4
  **Comando de verificación**: `npm run typecheck`
  **Aceptación**: `typecheck` pasa sin errores; `FIAT_DEPOSIT` continúa siendo rechazado por el schema (NEGATIVE-001)

---

## Work Unit 6: Quality Gate

> Verificación final de que toda la cadena (migración → enum → engine → schema) es
> coherente y no hay regresiones.

- [ ] **T07** — Ejecutar quality gate completo — (no crea ni modifica archivos)

  **Comandos en orden**:
  1. `npm run typecheck` — verifica exhaustividad de `assertNever` con 8 tipos (REQ-004)
  2. `npm run lint` — sin warnings en los 5 archivos modificados
  3. `npm run test:engine` — drift guard + engine fiat tests + engine existentes (NEGATIVE-004)
  4. `npm run test:sync` — verificar que ningún sync existente rompe por el schema extendido

  **Dependencias**: T01–T06 completadas
  **Líneas estimadas**: 0 (solo ejecución)
  **Aceptación**: los 4 comandos retornan exit code 0; ningún test en amarillo o rojo

---

## Resumen de Archivos

| ID | Archivo | Acción | REQs cubiertos |
|----|---------|--------|----------------|
| T01 | `apps/backend/tests/position-engine-fiat.test.ts` | CREAR | REQ-003, REQ-004, NEGATIVE-003, NEGATIVE-005 |
| T02 | `db/enums.test.ts` | MODIFICAR | REQ-002 (drift guard) |
| T03 | `db/migrations/0005_fiat_types_cex_order_id.sql` | CREAR | REQ-001, REQ-006, REQ-M01 |
| T04 | `db/enums.ts` | MODIFICAR | REQ-002, REQ-M01 |
| T05 | `apps/backend/src/position-engine/decimal-utils.ts` | MODIFICAR | REQ-003, REQ-M02 |
| T06 | `apps/backend/src/schemas/sync.ts` | MODIFICAR | REQ-005 |
| T07 | — (quality gate) | EJECUTAR | REQ-004, NEGATIVE-004 |

**Sin cambios** (por diseño):
- `apps/backend/src/position-engine/engine.ts` — exhaustividad via type guards, sin lógica nueva
- `apps/backend/src/db/types.ts` — `TransactionType` derivado automáticamente de `TRANSACTION_TYPES`

---

## Review Workload Forecast

| Métrica | Estimado |
|---------|----------|
| Total estimado líneas cambiadas | ~193 |
| Archivos tocados | 5 (más 1 nuevo archivo SQL, 1 nuevo archivo de test) |
| Chained PRs recommended | No |
| 400-line budget risk | Low |
| Decision needed before apply | No |

> **Desglose de líneas**: `position-engine-fiat.test.ts` ~140 · `enums.test.ts` ~8 · `0005_*.sql` ~25 · `enums.ts` ~4 · `decimal-utils.ts` ~12 · `sync.ts` ~4
>
> El cambio es aditivo en todas las capas. No hay refactores ni movimientos de lógica existente. Sin riesgo de regresión más allá de lo que los tests ya cubren.
