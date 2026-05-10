# Delta Spec: US-013 — FIAT_IN/FIAT_OUT types + columna cex_order_id

> **Dominios afectados**: `database-schema`, `position-engine`, `binance-sync`

---

## ADDED Requirements

### Requirement: REQ-001 — Migración SQL para nuevos enum values

El sistema MUST proveer una migración `0002_fiat_types_cex_order_id.sql` que extienda el ENUM `transaction_type` con dos nuevos valores y agregue la columna `cex_order_id` a la tabla `transactions`.

**Contrato exacto de la migración up:**

```sql
-- Cada ALTER TYPE en sentencia separada (requerimiento de PostgreSQL)
ALTER TYPE transaction_type ADD VALUE 'FIAT_IN';
ALTER TYPE transaction_type ADD VALUE 'FIAT_OUT';

ALTER TABLE transactions ADD COLUMN cex_order_id TEXT NULL;

CREATE UNIQUE INDEX transactions_cex_order_id_unique
  ON transactions (cex_order_id)
  WHERE cex_order_id IS NOT NULL;
```

**Contrato exacto de la migración down:**

```sql
DROP INDEX IF EXISTS transactions_cex_order_id_unique;
ALTER TABLE transactions DROP COLUMN IF EXISTS cex_order_id;
-- NOTA: PostgreSQL no soporta DROP VALUE en un ENUM.
-- Los valores FIAT_IN y FIAT_OUT permanecen en el tipo pero no son usados
-- si no existen filas con esos valores. La reversión real del enum
-- requeriría recrear el tipo (destructivo). Se documenta como limitación conocida.
```

#### Scenario: Migración up sobre schema existente

- GIVEN la migración `0001_initial_schema.sql` ya aplicada en la base de datos de test
- WHEN se ejecuta `npm run db:migrate` (aplica `0002_fiat_types_cex_order_id.sql`)
- THEN el exit code MUST ser 0
- AND `FIAT_IN` y `FIAT_OUT` MUST estar disponibles como valores del tipo `transaction_type`
- AND la columna `transactions.cex_order_id` MUST existir con tipo `TEXT NULL`
- AND el índice `transactions_cex_order_id_unique` MUST existir como índice parcial único

#### Scenario: Ciclo up → down → up es idempotente

- GIVEN la migración `0002` aplicada
- WHEN se ejecuta `npm run db:migrate -- down` y luego `npm run db:migrate` de nuevo
- THEN ambos comandos MUST completar con exit code 0
- AND el schema final MUST contener la columna `cex_order_id` y el índice único
- AND los enum values `FIAT_IN`/`FIAT_OUT` MUST seguir disponibles (no se pueden eliminar en el down)

#### Scenario: El down no intenta remover enum values (limitación documentada)

- GIVEN la migración down ejecutada
- WHEN se consulta `pg_enum` por el tipo `transaction_type`
- THEN los valores `FIAT_IN` y `FIAT_OUT` MUST permanecer en el tipo
- AND el comentario en el archivo de migración MUST documentar explícitamente que PostgreSQL no soporta `DROP VALUE`

---

### Requirement: REQ-002 — Sincronización TS ↔ SQL del enum `transaction_type`

El array `TRANSACTION_TYPES` en `db/enums.ts` MUST incluir `'FIAT_IN'` y `'FIAT_OUT'`, y el test de drift guard `db/enums.test.ts` MUST pasar sin modificaciones adicionales.

> **Nota**: El test actual lee `0001_initial_schema.sql` para validar el drift. Dado que los nuevos valores se agregan vía `ALTER TYPE` en `0002`, se debe verificar que la estrategia de detección sea correcta. Si `enums.test.ts` sólo lee `0001`, MUST ser extendido para también leer `0002` — o la lógica de detección del drift MUST cubrir ambos archivos.

**Contrato de modificación en `db/enums.ts`:**

```typescript
export const TRANSACTION_TYPES = [
  "BUY",
  "SELL",
  "SWAP_IN",
  "SWAP_OUT",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "FIAT_IN",   // ADDED
  "FIAT_OUT",  // ADDED
] as const;
```

#### Scenario: Array TS incluye los nuevos valores

- GIVEN `db/enums.ts` modificado con `FIAT_IN` y `FIAT_OUT`
- WHEN se importa `TRANSACTION_TYPES`
- THEN `TRANSACTION_TYPES` MUST incluir exactamente 8 valores
- AND MUST incluir `'FIAT_IN'` en la posición 6 y `'FIAT_OUT'` en la posición 7

#### Scenario: Test de drift guard pasa con los nuevos valores

- GIVEN `db/enums.ts` con `FIAT_IN` / `FIAT_OUT` y las migraciones aplicadas
- WHEN se ejecuta `npx vitest run db/enums.test.ts`
- THEN todos los tests MUST pasar (estado verde)

---

### Requirement: REQ-003 — `isInbound` incluye `FIAT_IN`; `isOutbound` incluye `FIAT_OUT`

Las funciones de clasificación en `decimal-utils.ts` MUST reconocer los nuevos tipos.

**Contrato de modificación en `decimal-utils.ts`:**

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

#### Scenario: `FIAT_IN` clasificado como inbound

- GIVEN `type = 'FIAT_IN'`
- WHEN se llama `isInbound(type)`
- THEN MUST retornar `true`
- AND `isOutbound(type)` MUST retornar `false`

#### Scenario: `FIAT_OUT` clasificado como outbound

- GIVEN `type = 'FIAT_OUT'`
- WHEN se llama `isOutbound(type)`
- THEN MUST retornar `true`
- AND `isInbound(type)` MUST retornar `false`

#### Scenario: Tipos existentes no cambian su clasificación

- GIVEN los tipos `['BUY', 'SWAP_IN', 'TRANSFER_IN']`
- WHEN se llama `isInbound` sobre cada uno
- THEN MUST retornar `true` para todos (comportamiento inalterado)
- AND los tipos `['SELL', 'SWAP_OUT', 'TRANSFER_OUT']` MUST retornar `true` en `isOutbound`

---

### Requirement: REQ-004 — El engine cubre exhaustivamente los 8 tipos sin cambios de lógica

`engine.ts` MUST compilar sin errores de TypeScript con los 8 tipos en `TransactionType`. El `assertNever` en `processTransaction` MUST seguir alcanzable sólo si se agrega un noveno tipo en el futuro.

> **Regla de dominio RD-001**: `FIAT_IN` se comporta idénticamente a `BUY` (recalcula WAC + balance). `FIAT_OUT` se comporta idénticamente a `SELL` (reduce balance, genera P&L). No se requieren cambios en la lógica interna de `engine.ts` porque el flujo `isInbound` → `appendToOpenPosition` / `isOutbound` → `reduceOpenPosition` ya lo cubre.

#### Scenario: `FIAT_IN` sobre posición vacía abre ciclo nuevo con WAC correcto

- GIVEN posición inexistente (null) para un token
- WHEN se procesa `FIAT_IN` con `amount='100'`, `priceUsd='1'`
- THEN `processTransaction` MUST retornar una posición con:
  - `balance = '100.000000000000000000'`
  - `wac = '1.000000000000000000'`
  - `realizedPnlUsd = '0.000000000000000000'`
  - `status = 'OPEN'`
  - `positionWasOpened = true`

#### Scenario: `FIAT_OUT` reduce balance y genera P&L correcto

- GIVEN posición OPEN con `balance='100'`, `wac='1'`, `realizedPnlUsd='0'`
- WHEN se procesa `FIAT_OUT` con `amount='30'`, `priceUsd='1'`
- THEN `processTransaction` MUST retornar una posición con:
  - `balance = '70.000000000000000000'`
  - `wac = '1.000000000000000000'` (inalterado — SELL no cambia WAC)
  - `realizedPnlDelta = '0.000000000000000000'` (priceUsd == wac, sin ganancia)
  - `positionWasClosed = false`

#### Scenario: Secuencia FIAT_IN → FIAT_OUT completa

- GIVEN posición inexistente
- WHEN se procesa `FIAT_IN` con `amount='100'`, `priceUsd='1'`
- AND luego se procesa `FIAT_OUT` con `amount='30'`, `priceUsd='1'`
- THEN la posición final MUST tener `balance='70.000000000000000000'`, `wac='1.000000000000000000'`, `realizedPnlUsd='0.000000000000000000'`

#### Scenario: `assertNever` sigue siendo alcanzable para tipos futuros

- GIVEN `engine.ts` con los 8 tipos cubiertos por `isInbound`/`isOutbound`
- WHEN TypeScript compila el proyecto con `strict: true`
- THEN el compilador MUST aceptar el código sin errores — `assertNever` MUST ser tipado correctamente como `(x: never) => never`

---

### Requirement: REQ-005 — Zod schema `SyncedTxSchema` actualizado

El `z.enum` del campo `type` en `SyncedTxSchema` dentro de `apps/backend/src/schemas/sync.ts` MUST incluir `'FIAT_IN'` y `'FIAT_OUT'`.

**Contrato de modificación en `schemas/sync.ts`:**

```typescript
const SyncedTxSchema = z.object({
  // ...otros campos
  type: z.enum([
    'BUY', 'SELL',
    'SWAP_IN', 'SWAP_OUT',
    'TRANSFER_IN', 'TRANSFER_OUT',
    'FIAT_IN', 'FIAT_OUT',   // ADDED
  ]),
  // ...
});
```

#### Scenario: Schema valida `FIAT_IN` y `FIAT_OUT`

- GIVEN `SyncedTxSchema`
- WHEN se parsea un objeto con `type: 'FIAT_IN'`
- THEN `SyncedTxSchema.parse(...)` MUST retornar sin lanzar excepciones
- AND el mismo test MUST pasar con `type: 'FIAT_OUT'`

#### Scenario: Los 6 tipos existentes siguen siendo válidos

- GIVEN `SyncedTxSchema`
- WHEN se parsea cada uno de los tipos `['BUY', 'SELL', 'SWAP_IN', 'SWAP_OUT', 'TRANSFER_IN', 'TRANSFER_OUT']`
- THEN todos MUST parsear exitosamente (no regresiones)

---

### Requirement: REQ-006 — Columna `cex_order_id` con unicidad parcial

La tabla `transactions` MUST soportar un `cex_order_id TEXT NULL` con constraint `UNIQUE WHERE NOT NULL`. Las filas fiat MUST tener `cex_trade_id = NULL` y `cex_order_id NOT NULL`. Las filas de trades/converts existentes MUST mantener `cex_order_id = NULL`.

> **Regla de dominio RD-006**: `cex_trade_id` (usado por Binance trades y converts) y `cex_order_id` (usado por Binance fiat) son columnas separadas. Ambas pueden ser NULL en filas on-chain o MANUAL.

#### Scenario: Dos filas fiat con `cex_order_id` distintos coexisten

- GIVEN la migración `0002` aplicada
- WHEN se insertan dos transacciones con `cex_order_id='order-001'` y `cex_order_id='order-002'`
- THEN ambos INSERTs MUST tener éxito

#### Scenario: Filas con `cex_order_id = NULL` múltiples coexisten (índice parcial)

- GIVEN la migración `0002` aplicada
- WHEN se insertan múltiples transacciones on-chain con `cex_order_id = NULL`
- THEN todos los INSERTs MUST tener éxito — el índice parcial MUST ignorar NULLs

#### Scenario: Filas existentes de trades/converts no se ven afectadas

- GIVEN filas pre-existentes con `cex_trade_id NOT NULL` y `cex_order_id = NULL`
- WHEN se ejecuta la migración `0002`
- THEN las filas existentes MUST mantener su `cex_order_id = NULL` sin error

---

## MODIFIED Requirements

### Requirement: REQ-M01 — `transaction_type` ENUM extiende de 6 a 8 valores

El tipo `transaction_type` en PostgreSQL, previamente definido con 6 valores en `0001_initial_schema.sql`, MUST extenderse a 8 valores mediante la migración `0002`.
(Previously: `CREATE TYPE transaction_type AS ENUM ('BUY', 'SELL', 'SWAP_IN', 'SWAP_OUT', 'TRANSFER_IN', 'TRANSFER_OUT')`)

#### Scenario: Enum extendido acepta inserciones con nuevos valores

- GIVEN schema actualizado con `0002` aplicado
- WHEN se inserta una transacción con `type = 'FIAT_IN'`
- THEN el INSERT MUST tener éxito
- AND lo mismo MUST aplicar para `type = 'FIAT_OUT'`

### Requirement: REQ-M02 — `isInbound` / `isOutbound` cubren 4 tipos cada una

Las type guards previamente cubrían 3 tipos cada una. Tras el cambio MUST cubrir 4 tipos cada una sin alterar el comportamiento de los tipos existentes.
(Previously: `isInbound` → `'BUY' | 'SWAP_IN' | 'TRANSFER_IN'`; `isOutbound` → `'SELL' | 'SWAP_OUT' | 'TRANSFER_OUT'`)

---

## REMOVED Requirements

_(Ningún requisito existente se elimina en este cambio.)_

---

## Negative Scenarios

### NEGATIVE-001: Tipo `FIAT_DEPOSIT` no es válido

- GIVEN `SyncedTxSchema`
- WHEN se parsea un objeto con `type: 'FIAT_DEPOSIT'`
- THEN `SyncedTxSchema.safeParse(...)` MUST retornar `success: false`
- AND el error MUST indicar que `'FIAT_DEPOSIT'` no es un valor válido del enum

### NEGATIVE-002: `cex_order_id` duplicado falla por constraint

- GIVEN la migración `0002` aplicada y una fila con `cex_order_id = 'order-dup-123'` ya insertada
- WHEN se intenta insertar otra fila con `cex_order_id = 'order-dup-123'`
- THEN el INSERT MUST fallar con violación del índice único `transactions_cex_order_id_unique`

### NEGATIVE-003: `FIAT_OUT` con balance insuficiente lanza `InsufficientBalanceError`

- GIVEN posición OPEN con `balance='50'`
- WHEN se procesa `FIAT_OUT` con `amount='100'` (mayor que el balance)
- THEN `processTransaction` MUST lanzar `InsufficientBalanceError`
- AND el error MUST exponer `currentBalance='50...'` y `attempted='100'`

### NEGATIVE-004: Tests de engine existentes no presentan regresiones

- GIVEN el suite `test:engine` completo (incluyendo tests previos de BUY, SELL, SWAP, TRANSFER)
- WHEN se ejecuta `npm run test:engine`
- THEN todos los tests pre-existentes MUST seguir pasando (estado verde)
- AND los nuevos tests de `FIAT_IN`/`FIAT_OUT` MUST pasar también

### NEGATIVE-005: `FIAT_IN` sin `priceUsd` lanza `InvalidTransactionError`

- GIVEN posición inexistente
- WHEN se procesa `FIAT_IN` con `priceUsd = null`
- THEN `processTransaction` MUST lanzar `InvalidTransactionError` con `reason: 'INBOUND_REQUIRES_PRICE'`

---

## Contracts

### TransactionType (post-US-013)

```typescript
// db/enums.ts
export const TRANSACTION_TYPES = [
  "BUY", "SELL",
  "SWAP_IN", "SWAP_OUT",
  "TRANSFER_IN", "TRANSFER_OUT",
  "FIAT_IN",   // NEW
  "FIAT_OUT",  // NEW
] as const;

// Derivado (no cambia el patrón, sólo se extiende):
export type TransactionType = typeof TRANSACTION_TYPES[number];
// → 'BUY' | 'SELL' | 'SWAP_IN' | 'SWAP_OUT' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'FIAT_IN' | 'FIAT_OUT'
```

### Archivos de test nuevos

```
apps/backend/tests/position-engine-fiat.test.ts
```

Debe cubrir al menos:
1. `FIAT_IN` sobre posición vacía → balance=100, wac=1, pnl=0
2. `FIAT_IN` sobre posición existente → WAC ponderado recalculado
3. `FIAT_OUT` reduce balance, no cambia WAC
4. Secuencia `FIAT_IN → FIAT_OUT` → balance final correcto
5. `FIAT_OUT` con balance insuficiente → `InsufficientBalanceError`
6. `FIAT_IN` sin `priceUsd` → `InvalidTransactionError`

### Archivos modificados (resumen)

| Archivo | Tipo de cambio |
|---------|---------------|
| `db/migrations/0002_fiat_types_cex_order_id.sql` | CREATED — up/down |
| `db/enums.ts` | MODIFIED — 2 valores nuevos en `TRANSACTION_TYPES` |
| `apps/backend/src/position-engine/decimal-utils.ts` | MODIFIED — `isInbound` + `isOutbound` type guards |
| `apps/backend/src/schemas/sync.ts` | MODIFIED — `SyncedTxSchema.type` z.enum |
| `apps/backend/tests/position-engine-fiat.test.ts` | CREATED — tests de engine para fiat |

> `apps/backend/src/position-engine/engine.ts` MUST compilar sin cambios de lógica. Si TypeScript reporta error de exhaustividad en `assertNever`, el error MUST reproducirse en test y resolverse en el mismo commit.

---

## Notas de implementación (no son specs, son contexto para design)

- `ALTER TYPE ... ADD VALUE` MUST ejecutarse fuera de un bloque de transacción en PostgreSQL < 12. En PostgreSQL ≥ 12 (requerido por este proyecto) está permitido dentro de transacción. Documentar el requisito en el encabezado de la migración.
- La migración down es intencionalmente incompleta para el enum. Esta limitación es conocida de PostgreSQL y MUST quedar documentada con comentario `-- NOTE` en el archivo SQL.
- El índice `transactions_cex_order_id_unique` es parcial (`WHERE cex_order_id IS NOT NULL`), lo que permite múltiples NULLs — comportamiento estándar de PostgreSQL para índices únicos parciales.
