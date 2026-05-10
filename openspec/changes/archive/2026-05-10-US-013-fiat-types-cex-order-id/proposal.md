# Proposal: US-013 — FIAT_IN/FIAT_OUT types + columna cex_order_id

## Intent

El position engine y el esquema de base de datos actualmente sólo reconocen seis tipos de transacción (`BUY`, `SELL`, `SWAP_IN`, `SWAP_OUT`, `TRANSFER_IN`, `TRANSFER_OUT`). Para soportar movimientos fiat (compra/venta de crypto con moneda fiat vía Binance), necesitamos dos nuevos tipos — `FIAT_IN` y `FIAT_OUT` — que se comporten como `BUY` y `SELL` respectivamente a nivel de WAC y balance.

Además, los endpoints fiat de Binance devuelven un `orderId` (texto) en lugar de un `tradeId` numérico. La tabla `transactions` necesita una columna `cex_order_id TEXT NULL` con un índice parcial `UNIQUE WHERE NOT NULL` para deduplicar filas fiat sin colisionar con `cex_trade_id` (usado por trades/converts).

El cambio es puramente aditivo: no modifica el comportamiento de los seis tipos existentes ni rompe la exhaustividad del switch/`assertNever` en el engine — sólo la extiende.

## Scope

### In scope

| Acción | Archivo |
|--------|---------|
| Crear | `db/migrations/0002_fiat_types_cex_order_id.sql` — migración up/down |
| Modificar | `db/enums.ts` — agregar `FIAT_IN`, `FIAT_OUT` al array `TRANSACTION_TYPES` |
| Modificar | `apps/backend/src/position-engine/decimal-utils.ts` — `isInbound` incluye `FIAT_IN`, `isOutbound` incluye `FIAT_OUT` |
| Modificar | `apps/backend/src/position-engine/engine.ts` — sin cambios de lógica (el switch ya cubre vía `isInbound`/`isOutbound` → `assertNever` sigue exhaustivo) |
| Modificar | `apps/backend/src/schemas/sync.ts` — agregar `FIAT_IN`, `FIAT_OUT` al `z.enum` de `SyncedTxSchema.type` |
| Crear | `apps/backend/tests/position-engine-fiat.test.ts` — tests del engine con `FIAT_IN`/`FIAT_OUT` |
| Verificar | `db/enums.test.ts` — pasa sin cambios (valida que TS ↔ SQL estén sincronizados) |

### Out of scope

- Sync service de fiat (US futura): este US no crea el `BinanceFiatSyncService`.
- Frontend: no se agrega UI para transacciones fiat.
- Clasificación (`classify.ts`): no se modifica el clasificador de transacciones.
- Esquema de `wallets` o `tokens`: sin cambios.

## Approach

1. **Migración SQL** (`0002_fiat_types_cex_order_id.sql`):
   - `ALTER TYPE transaction_type ADD VALUE 'FIAT_IN'` y `ADD VALUE 'FIAT_OUT'` (cada uno en su propio `ALTER TYPE`; PostgreSQL requiere sentencias separadas).
   - `ALTER TABLE transactions ADD COLUMN cex_order_id TEXT NULL`.
   - `CREATE UNIQUE INDEX transactions_cex_order_id_unique ON transactions (cex_order_id) WHERE cex_order_id IS NOT NULL`.
   - Down: `DROP INDEX`, `ALTER TABLE DROP COLUMN`. NO se intenta `DROP VALUE` del enum (PostgreSQL no lo soporta — documentar con comentario en la migración).

2. **Enum TS** (`db/enums.ts`):
   - Agregar `'FIAT_IN'` y `'FIAT_OUT'` al final del array `TRANSACTION_TYPES`.

3. **Position engine** (`decimal-utils.ts`):
   - `isInbound`: agregar `|| type === 'FIAT_IN'` y ajustar el type guard.
   - `isOutbound`: agregar `|| type === 'FIAT_OUT'` y ajustar el type guard.
   - `engine.ts`: no necesita cambios — el flujo `isInbound → appendToOpenPosition` / `isOutbound → reduceOpenPosition` ya cubre los nuevos tipos. `assertNever` se mantiene exhaustivo porque TypeScript estrecha el tipo correctamente.

4. **Zod schemas** (`schemas/sync.ts`):
   - Agregar `'FIAT_IN'`, `'FIAT_OUT'` al `z.enum` en `SyncedTxSchema`.

5. **Tests**:
   - `position-engine-fiat.test.ts`: verificar que `FIAT_IN` recalcula WAC + balance, que `FIAT_OUT` reduce balance, que `FIAT_OUT` con balance insuficiente lanza `InsufficientBalanceError`.
   - Verificar que `db/enums.test.ts` sigue verde (drift guard TS ↔ SQL).
   - Tests negativos: `FIAT_DEPOSIT` no es un tipo válido; `cex_order_id` duplicado falla por constraint.

## Risks

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| `ALTER TYPE ADD VALUE` no se puede hacer dentro de una transacción en PostgreSQL < 12 | Migración falla en entornos antiguos | Documentar requisito de PostgreSQL ≥ 12; en pg ≥ 12 `ADD VALUE` dentro de transacción está permitido |
| Migración down no puede revertir enum values | El down queda incompleto para el enum | Documentar con comentario; la reversión real requiere recrear el tipo (destructivo, no vale la pena para un enum aditivo) |
| Otros Zod schemas hardcodeados con el enum de 6 valores | Quedan desincronizados | Búsqueda exhaustiva confirmó que sólo `schemas/sync.ts` tiene el enum hardcodeado; los demás derivan de `db/enums.ts` vía `TransactionType` |
| `engine.ts` switch/assertNever compila pero no testea fiat | Bug silencioso en runtime | Tests explícitos para `FIAT_IN` y `FIAT_OUT` en el nuevo archivo de tests |

## Non-goals

- NO se implementa el servicio de sincronización fiat (será una US posterior).
- NO se modifica la UI ni el dashboard.
- NO se agrega lógica de swap decomposition para fiat (fiat es siempre una sola fila, no par).
- NO se modifica la lógica WAC de los seis tipos existentes.
- NO se crea un nuevo `transaction_source` para fiat (se reutiliza `'BINANCE'`).

## Dependencies

- **Depende de**: US-001 (schema base), US-005 (wallets/CEX), US-008 (sync infra).
- **Bloquea a**: US futura de fiat sync service (que usará estos tipos y la columna `cex_order_id`).

## Rollback plan

1. Correr migración down: elimina índice + columna `cex_order_id`.
2. Revertir `db/enums.ts` y `decimal-utils.ts`.
3. Los enum values `FIAT_IN`/`FIAT_OUT` quedarán en PostgreSQL (inocuos, no se usan si no hay filas con esos tipos).
