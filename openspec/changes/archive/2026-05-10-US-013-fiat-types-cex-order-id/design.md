# Design: US-013 — FIAT_IN/FIAT_OUT types + columna cex_order_id

## Enfoque Técnico

Cambio puramente aditivo en cuatro capas: migración SQL (nuevo enum values + columna + índice), enum TypeScript (single source of truth), type guards del position engine, y schema Zod de sync. La única modificación no trivial es el drift guard (`enums.test.ts`) que actualmente lee un único archivo de migración y debe extenderse para leer todos los archivos del directorio — decisión que future-proofs el guard para cualquier ALTER TYPE futuro. El `engine.ts` no requiere modificaciones porque el flujo `isInbound → appendToOpenPosition` / `isOutbound → reduceOpenPosition` / `assertNever` mantiene exhaustividad automáticamente tras extender los type guards.

---

## Decisiones de Arquitectura

### Decisión 1: Numeración de la migración

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| `0002_fiat_types_cex_order_id.sql` (como dice el proposal) | Colisiona con `0002_tokens_extra_fields.sql` existente | **DESCARTADA** |
| `0005_fiat_types_cex_order_id.sql` | Sigue la secuencia real (0001→0004 ya existen) | **ELEGIDA** |

**Rationale**: Las migraciones `0002_tokens_extra_fields.sql`, `0003_wallet_last_synced_block.sql` y `0004_widen_tx_hash.sql` fueron creadas después del proposal de US-013. El nombre en el proposal es incorrecto. La numeración correcta es `0005`.

---

### Decisión 2: Estrategia para el drift guard (RISK-001)

**Contexto**: `db/enums.test.ts` lee exclusivamente `0001_initial_schema.sql` y verifica que cada miembro del array TS aparezca en ese SQL (como string literal `'MEMBER'`). Los nuevos valores `FIAT_IN`/`FIAT_OUT` aparecerán en un `ALTER TYPE` dentro de `0005`, no en `0001`. Si se agrega FIAT_IN/FIAT_OUT al array TS sin cambiar el test, el drift guard fallará.

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| A: Hardcodear referencia a `0005` junto a `0001` | Requiere actualizar el test cada vez que un migration agrega un enum value | DESCARTADA |
| B: Leer todos los archivos `.sql` de `migrations/` (glob + sort + concat) | Test automáticamente cubre migraciones futuras; sin cambios adicionales cuando hay nueva ALTER TYPE | **ELEGIDA** |
| C: No modificar `enums.test.ts` y duplicar los valores en `0001` | Viola la naturaleza incremental de las migraciones; introduce inconsistencia | DESCARTADA |

**Rationale**: La Opción B es la más robusta. El test concatena todos los archivos ordenados; el `CREATE TYPE transaction_type AS ENUM` sigue encontrándose en `0001`, y `'FIAT_IN'` / `'FIAT_OUT'` se encuentran en `0005` vía `ALTER TYPE transaction_type ADD VALUE 'FIAT_IN'`. La lógica de búsqueda usa `.toContain("'FIAT_IN'")` que funciona sobre cualquier contexto SQL (CREATE TYPE body o ALTER TYPE).

**Cambio exacto en `enums.test.ts`**:

```typescript
// ANTES
const migrationPath = resolve(here, "migrations/0001_initial_schema.sql");
// ...
const sql = readFileSync(migrationPath, "utf8");

// DESPUÉS
import { readdirSync } from "node:fs";

const migrationsDir = resolve(here, "migrations");
const sql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()                              // orden lexicográfico = orden cronológico
  .map((f) => readFileSync(resolve(migrationsDir, f), "utf8"))
  .join("\n");
```

El resto del test (los `describe`/`it` loops) permanece **sin cambios**.

---

### Decisión 3: ¿Necesita cambios `engine.ts`?

| Pregunta | Análisis | Decisión |
|----------|----------|----------|
| ¿El switch/assertNever sigue siendo exhaustivo? | Sí. Tras extender `isInbound` para incluir `FIAT_IN` y `isOutbound` para `FIAT_OUT`, TypeScript estrecha `tx.type` a `never` antes de llegar a `assertNever`. Las 8 variantes quedan cubiertas. | **engine.ts sin cambios** |

**Rationale**: El flujo de `processTransaction` no usa un switch explícito sobre los tipos; usa `isInbound(tx.type)` e `isOutbound(tx.type)` como guards. TypeScript infiere que si ambos retornan `false`, `tx.type` es `never`. Agregar FIAT_IN a `isInbound` y FIAT_OUT a `isOutbound` mantiene la exhaustividad sin tocar `engine.ts`.

**Comportamiento de FIAT_OUT en `reduceOpenPosition`**: La función tiene una rama especial para `TRANSFER_OUT` con `priceUsd === null` (sin P&L). `FIAT_OUT` **no** es `TRANSFER_OUT`, así que si llega con `priceUsd === null` arroja `InvalidTransactionError('OUTBOUND_REQUIRES_PRICE')`. Esto es correcto: las operaciones fiat siempre tienen precio de mercado.

---

### Decisión 4: `TransactionType` derivado — sin cambios en `db/types.ts`

`apps/backend/src/db/types.ts` line 40:
```typescript
export type TransactionType = (typeof TRANSACTION_TYPES)[number];
```
Al agregar `'FIAT_IN'` / `'FIAT_OUT'` al array en `db/enums.ts`, `TransactionType` incluye automáticamente los nuevos valores en toda la aplicación. **Sin cambios necesarios en `db/types.ts`.**

---

## Flujo de Datos (Type Flow)

```
SQL (PostgreSQL)
└── CREATE TYPE transaction_type AS ENUM (... 6 values ...)   [0001_initial_schema.sql]
    └── ALTER TYPE transaction_type ADD VALUE 'FIAT_IN'        [0005_fiat_types_cex_order_id.sql]
    └── ALTER TYPE transaction_type ADD VALUE 'FIAT_OUT'       [0005_fiat_types_cex_order_id.sql]
         │
         │  drift guard
         ▼
db/enums.ts
└── TRANSACTION_TYPES = [..., 'FIAT_IN', 'FIAT_OUT'] as const
         │
         │  typeof TRANSACTION_TYPES[number]
         ▼
apps/backend/src/db/types.ts
└── TransactionType = 'BUY' | 'SELL' | ... | 'FIAT_IN' | 'FIAT_OUT'
         │
         ├──────────────────────────────────────────────────────────────┐
         │                                                              │
         ▼                                                              ▼
apps/backend/src/position-engine/decimal-utils.ts              apps/backend/src/schemas/sync.ts
└── isInbound(type): type is ... | 'FIAT_IN'                  └── SyncedTxSchema.type z.enum([..., 'FIAT_IN', 'FIAT_OUT'])
└── isOutbound(type): type is ... | 'FIAT_OUT'
         │
         ▼
apps/backend/src/position-engine/engine.ts   (SIN CAMBIOS)
└── processTransaction()
    ├── isInbound(tx.type) → appendToOpenPosition / openNewCycle
    ├── isOutbound(tx.type) → reduceOpenPosition
    └── assertNever(tx.type)  ← TypeScript garantiza never después de los guards
```

---

## Cambios en Archivos

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `db/migrations/0005_fiat_types_cex_order_id.sql` | CREAR | Migración up: ALTER TYPE ×2 + ADD COLUMN + CREATE INDEX. Migración down: DROP INDEX + DROP COLUMN. |
| `db/enums.ts` | MODIFICAR | Agregar `'FIAT_IN'` y `'FIAT_OUT'` al array `TRANSACTION_TYPES` |
| `db/enums.test.ts` | MODIFICAR | Leer todos los archivos `.sql` de `migrations/` en lugar de solo `0001` |
| `apps/backend/src/position-engine/decimal-utils.ts` | MODIFICAR | Extender `isInbound` e `isOutbound` con los nuevos tipos |
| `apps/backend/src/schemas/sync.ts` | MODIFICAR | Agregar `'FIAT_IN'`, `'FIAT_OUT'` al `z.enum` de `SyncedTxSchema.type` |
| `apps/backend/tests/position-engine-fiat.test.ts` | CREAR | Tests TDD para comportamiento de FIAT_IN/FIAT_OUT en el engine |
| `apps/backend/src/position-engine/engine.ts` | SIN CAMBIOS | TypeScript actualiza exhaustividad automáticamente |
| `apps/backend/src/db/types.ts` | SIN CAMBIOS | TransactionType se deriva automáticamente |

---

## Diseño Detallado por Archivo

### `db/migrations/0005_fiat_types_cex_order_id.sql`

```sql
-- Up Migration
-- REQ-001: Extend transaction_type enum with FIAT_IN and FIAT_OUT.
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
-- but will be unused (no rows with those values if the column cex_order_id
-- and all fiat rows are removed). Full enum reversion would require recreating
-- the type (destructive) — intentionally skipped.
DROP INDEX IF EXISTS transactions_cex_order_id_unique;
ALTER TABLE transactions DROP COLUMN IF EXISTS cex_order_id;
```

> **Limitación PostgreSQL documentada**: `DROP VALUE` no está soportado en ninguna versión de PostgreSQL al momento de escribir este diseño. La reversión completa del enum requeriría `DROP TYPE`/`CREATE TYPE`/`ALTER TABLE ALTER COLUMN` (destructivo). En la práctica, los valores huérfanos en el enum son inocuos.

---

### `db/enums.ts` — antes → después

```typescript
// ANTES
export const TRANSACTION_TYPES = [
  "BUY",
  "SELL",
  "SWAP_IN",
  "SWAP_OUT",
  "TRANSFER_IN",
  "TRANSFER_OUT",
] as const;

// DESPUÉS
export const TRANSACTION_TYPES = [
  "BUY",
  "SELL",
  "SWAP_IN",
  "SWAP_OUT",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "FIAT_IN",   // REQ-002: fiat purchase (comportamiento idéntico a BUY para WAC/balance)
  "FIAT_OUT",  // REQ-002: fiat sale (comportamiento idéntico a SELL para WAC/balance)
] as const;
```

---

### `db/enums.test.ts` — antes → después

```typescript
// ANTES
const migrationPath = resolve(here, "migrations/0001_initial_schema.sql");
// ...
describe("ENUM source-of-truth ↔ migration SQL drift guard", () => {
  const sql = readFileSync(migrationPath, "utf8");
  // ...
});

// DESPUÉS
import { readdirSync } from "node:fs";
// (migrationPath eliminado)

describe("ENUM source-of-truth ↔ migration SQL drift guard", () => {
  const migrationsDir = resolve(here, "migrations");
  // Concatenar todos los archivos SQL ordenados: cubre tanto CREATE TYPE (0001)
  // como ALTER TYPE en migraciones posteriores (0005+).
  const sql = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(resolve(migrationsDir, f), "utf8"))
    .join("\n");
  // El resto del describe es idéntico — sin cambios en los it() existentes.
  // ...
});
```

---

### `apps/backend/src/position-engine/decimal-utils.ts` — antes → después

```typescript
// ANTES
export function isInbound(
  type: TransactionType,
): type is 'BUY' | 'SWAP_IN' | 'TRANSFER_IN' {
  return type === 'BUY' || type === 'SWAP_IN' || type === 'TRANSFER_IN';
}

export function isOutbound(
  type: TransactionType,
): type is 'SELL' | 'SWAP_OUT' | 'TRANSFER_OUT' {
  return type === 'SELL' || type === 'SWAP_OUT' || type === 'TRANSFER_OUT';
}

// DESPUÉS
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

---

### `apps/backend/src/schemas/sync.ts` — antes → después

```typescript
// ANTES
const SyncedTxSchema = z.object({
  id: z.uuid(),
  type: z.enum(['BUY', 'SELL', 'SWAP_IN', 'SWAP_OUT', 'TRANSFER_IN', 'TRANSFER_OUT']),
  // ...
});

// DESPUÉS
const SyncedTxSchema = z.object({
  id: z.uuid(),
  type: z.enum([
    'BUY', 'SELL',
    'SWAP_IN', 'SWAP_OUT',
    'TRANSFER_IN', 'TRANSFER_OUT',
    'FIAT_IN', 'FIAT_OUT',   // REQ-004
  ]),
  // ...
});
```

---

## Interfaces / Contratos

### Constraint de base de datos

| Constraint | Definición | Propósito |
|------------|------------|-----------|
| `transactions_cex_order_id_unique` | `UNIQUE (cex_order_id) WHERE cex_order_id IS NOT NULL` | Deduplica filas fiat por orderId; NULLs (on-chain/MANUAL) excluidos del índice |

### Invariantes de dominio (sin cambios)

- `cex_trade_id` → usado por Binance trades y converts (campo numérico como text)
- `cex_order_id` → usado por Binance fiat orders (campo orderId como text)
- Una fila fiat tiene `cex_trade_id = NULL` y `cex_order_id NOT NULL`
- Una fila on-chain tiene ambos en NULL
- Una fila trade/convert tiene `cex_trade_id NOT NULL` y `cex_order_id = NULL`

### FIAT_IN en el position engine

`FIAT_IN` entra por `isInbound` → `openNewCycle` o `appendToOpenPosition`. Recalcula WAC usando el precio de la operación fiat. **Requiere `priceUsd NOT NULL`** (validación existente en `openNewCycle`/`appendToOpenPosition`).

### FIAT_OUT en el position engine

`FIAT_OUT` entra por `isOutbound` → `reduceOpenPosition`. Genera P&L = `(priceUsd - WAC) × amount`. **Requiere `priceUsd NOT NULL`**: no es `TRANSFER_OUT`, por lo que la rama especial sin-precio no aplica; si llega con `priceUsd = null`, `reduceOpenPosition` arroja `InvalidTransactionError('OUTBOUND_REQUIRES_PRICE')`.

---

## Estrategia de Testing (Strict TDD)

### Tests a escribir PRIMERO (antes de cualquier implementación)

**Archivo**: `apps/backend/tests/position-engine-fiat.test.ts`
**Proyecto Vitest**: `engine`

```
describe("position engine — FIAT_IN / FIAT_OUT")
  ├── isInbound / isOutbound classification
  │   ├── FIAT_IN → isInbound=true, isOutbound=false
  │   ├── FIAT_OUT → isOutbound=true, isInbound=false
  │   └── tipos existentes no cambian (BUY, SELL, SWAP_IN, SWAP_OUT, TRANSFER_IN, TRANSFER_OUT)
  │
  ├── FIAT_IN en posición nueva (openNewCycle)
  │   └── WAC y balance recalculados correctamente
  │
  ├── FIAT_IN en posición existente (appendToOpenPosition)
  │   └── WAC ponderado correcto tras acumular
  │
  ├── FIAT_OUT reduce balance y genera P&L
  │   └── realizedPnlDelta = (priceUsd - WAC) × amount
  │
  ├── FIAT_OUT cierra posición cuando balance llega a 0
  │   └── position.status = 'CLOSED'; positionWasClosed = true
  │
  └── NEGATIVE: FIAT_OUT con balance insuficiente lanza InsufficientBalanceError
```

**Archivo modificado**: `db/enums.test.ts`

Ejecutar el test ANTES de tocar `enums.ts`:
1. El test debe **fallar** (rojo) porque la migración 0005 no existe y el SQL concatenado no contiene `'FIAT_IN'`.
2. Implementar migración 0005 + agregar a `enums.ts`.
3. El test debe pasar (verde).

### Tests de regresión que deben pasar sin modificaciones

| Suite | Comando | Riesgo de regresión |
|-------|---------|---------------------|
| `db/enums.test.ts` | `npx vitest run db/enums.test.ts` | RISK-001 — resuelto con Decisión 2 |
| `apps/backend/tests/*.test.ts` (engine existente) | `npm run test:engine` | Bajo — los 6 tipos existentes no cambian |
| `apps/backend/tests/sync-*.test.ts` | `npm run test:sync` | Bajo — solo se extiende el z.enum |

### Orden de implementación TDD

```
1. ESCRIBIR tests en position-engine-fiat.test.ts   → todos en rojo
2. Modificar enums.test.ts (Decisión 2)              → test en rojo (0005 no existe aún)
3. Crear 0005_fiat_types_cex_order_id.sql            → enums.test.ts sigue rojo (TS no actualizado)
4. Modificar db/enums.ts                             → enums.test.ts verde
5. Modificar decimal-utils.ts                        → position-engine-fiat tests (clasificación) verde
6. Modificar schemas/sync.ts                         → tests de schema verde
7. Correr suite completa                             → todos verde
```

---

## Mitigación de Riesgos

### RISK-001 — drift guard rompe con ALTER TYPE en nueva migración

**Mitigación**: Decisión 2 — extender `enums.test.ts` para leer todos los archivos `.sql` de `migrations/` concatenados. El guard detecta `'FIAT_IN'` en el contexto `ALTER TYPE transaction_type ADD VALUE 'FIAT_IN'` del archivo 0005, y sigue detectando `CREATE TYPE transaction_type AS ENUM` en el archivo 0001.

**Estado tras mitigación**: ✅ Resuelto por diseño.

---

### RISK-002 — Zod schemas desincronizados

**Descripción**: Otros schemas Zod podrían tener el enum de 6 valores hardcodeado.

**Mitigación**: Búsqueda exhaustiva en `apps/backend/src/schemas/` confirma que `SyncedTxSchema` en `sync.ts` es el **único** schema con el enum hardcodeado. Los demás schemas no referencian `TransactionType` directamente en un `z.enum` — derivan el tipo vía `TransactionType` de `db/types.ts`.

**Estado tras mitigación**: ✅ Resuelto — solo un archivo a modificar.

---

### RISK-003 — Numeración de migración incorrecta (nueva, derivada del análisis)

**Descripción**: El proposal indica `0002_fiat_types_cex_order_id.sql` pero las migraciones 0002, 0003 y 0004 ya existen.

**Mitigación**: Decisión 1 — usar `0005_fiat_types_cex_order_id.sql`.

**Estado tras mitigación**: ✅ Resuelto por diseño.

---

### RISK-004 — FIAT_OUT con `priceUsd = null` en `reduceOpenPosition`

**Descripción**: La rama especial en `reduceOpenPosition` permite `priceUsd = null` solo para `TRANSFER_OUT`. `FIAT_OUT` no es `TRANSFER_OUT`, por lo que recibirá `InvalidTransactionError`. Esto es comportamiento correcto (las operaciones fiat siempre tienen precio), pero debe estar cubierto por un test negativo explícito si se quiere validar el mensaje de error.

**Mitigación**: Documentar como comportamiento esperado. No requiere cambios en `engine.ts`. Incluir un test en `position-engine-fiat.test.ts` que verifique que `FIAT_OUT` con `priceUsd = null` arroja `InvalidTransactionError`.

**Estado tras mitigación**: ✅ Cubierto por tests.
