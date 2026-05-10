# Delta Spec: US-018 — atomicidad por run con `sync_runs` + CASCADE rollback + escritura diferida de `positions`

> **Dominios afectados**: `database-schema`, `binance-sync`, `on-chain-sync`, `portfolio-service`

---

## ADDED Requirements

### Requirement: REQ-001 — Migración SQL para `sync_runs` y `transactions.sync_run_id`

El sistema MUST proveer una migración `0006_sync_runs.sql` que introduzca atomicidad por run con una tabla `sync_runs`, una FK opcional desde `transactions`, y los índices necesarios para rollback eficiente por CASCADE.

**Contrato exacto de la migración up:**

```sql
CREATE TABLE sync_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id      UUID        NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  type           VARCHAR(20) NOT NULL CHECK (type IN ('CEX', 'ON_CHAIN')),
  status         VARCHAR(20) NOT NULL CHECK (status IN ('running', 'completed')),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ NULL,
  txs_persisted  INTEGER     NOT NULL DEFAULT 0
);

CREATE INDEX sync_runs_wallet_status_idx
  ON sync_runs (wallet_id, status);

ALTER TABLE transactions
  ADD COLUMN sync_run_id UUID NULL REFERENCES sync_runs(id) ON DELETE CASCADE;

CREATE INDEX transactions_sync_run_id_idx
  ON transactions (sync_run_id)
  WHERE sync_run_id IS NOT NULL;
```

**Contrato exacto de la migración down:**

```sql
DROP INDEX IF EXISTS transactions_sync_run_id_idx;
ALTER TABLE transactions DROP COLUMN IF EXISTS sync_run_id;
DROP INDEX IF EXISTS sync_runs_wallet_status_idx;
DROP TABLE IF EXISTS sync_runs;
```

#### Scenario: Migración up crea la fundación de atomicidad por run

- GIVEN una base que ya tiene aplicadas `0001` a `0005`
- WHEN corrés `npm run db:migrate`
- THEN la tabla `sync_runs` MUST existir con las columnas `id`, `wallet_id`, `type`, `status`, `started_at`, `completed_at`, `txs_persisted`
- AND `wallet_id` MUST referenciar `wallets(id)` con `ON DELETE CASCADE`
- AND `type` MUST aceptar sólo `CEX` y `ON_CHAIN`
- AND `status` MUST aceptar sólo `running` y `completed`
- AND `transactions.sync_run_id` MUST existir como `UUID NULL REFERENCES sync_runs(id) ON DELETE CASCADE`
- AND el índice `sync_runs_wallet_status_idx` MUST existir sobre `(wallet_id, status)`
- AND el índice parcial `transactions_sync_run_id_idx` MUST existir con `WHERE sync_run_id IS NOT NULL`

#### Scenario: Migración down revierte en orden correcto

- GIVEN `0006_sync_runs.sql` ya aplicada
- WHEN corrés la migración down
- THEN el índice `transactions_sync_run_id_idx` MUST borrarse antes que la columna `transactions.sync_run_id`
- AND la columna `transactions.sync_run_id` MUST borrarse antes que la tabla `sync_runs`
- AND el índice `sync_runs_wallet_status_idx` MUST borrarse antes del `DROP TABLE sync_runs`
- AND el comando completo MUST terminar con exit code 0

#### Scenario: NEGATIVE — un `sync_run_id` inexistente viola FK

- GIVEN la migración `0006` aplicada
- WHEN se intenta insertar una fila en `transactions` con `sync_run_id` que no existe en `sync_runs`
- THEN PostgreSQL MUST rechazar el insert con violación de foreign key
- AND la fila MUST NOT persistirse

#### Scenario: NEGATIVE — los datos legacy con `sync_run_id = NULL` quedan inmunes

- GIVEN una transacción preexistente con `sync_run_id = NULL`
- WHEN se ejecuta `cleanupStaleRuns(pool)` o `rollback(runId)` sobre runs nuevos
- THEN esa transacción legacy MUST permanecer intacta
- AND el CASCADE MUST afectar sólo transacciones cuyo `sync_run_id` referencia el run borrado

---

### Requirement: REQ-002 — Módulo `SyncRunHelper` con `start` / `commitSuccess` / `rollback`

El backend MUST exponer un módulo `apps/backend/src/services/sync-run-helper.ts` con una clase `SyncRunHelper` que encapsule el ciclo de vida del run y un acumulador in-memory de `txs_persisted`.

**API requerida:**

```typescript
export class SyncRunHelper {
  start(walletId: string, type: 'CEX' | 'ON_CHAIN'): Promise<{ runId: string }>;
  recordTxsPersisted(runId: string, count: number): void;
  commitSuccess(
    runId: string,
    opts: {
      positions: Map<string, PositionState>;
      cursorUpdates: Array<{ operation: string; value: string }>;
    },
  ): Promise<void>;
  rollback(runId: string): Promise<void>;
}
```

#### Scenario: `start()` crea el run en estado `running`

- GIVEN un `walletId` válido y `type = 'CEX'`
- WHEN se llama `await helper.start(walletId, 'CEX')`
- THEN el método MUST insertar una fila en `sync_runs`
- AND la fila MUST persistirse con `status = 'running'`
- AND `started_at` MUST quedar seteado
- AND el método MUST devolver `{ runId }` con el UUID generado

#### Scenario: `recordTxsPersisted()` acumula en memoria hasta el commit final

- GIVEN un `runId` creado por `start()`
- WHEN se llama `recordTxsPersisted(runId, 2)` y luego `recordTxsPersisted(runId, 3)`
- THEN el helper MUST acumular `5` en memoria para ese run
- AND MUST NOT escribir `txs_persisted` en DB todavía
- AND el valor acumulado MUST persistirse recién durante `commitSuccess()`

#### Scenario: `commitSuccess()` hace un único commit atómico de posiciones + cursores + run

- GIVEN un `runId` en `status = 'running'`
- AND un `Map<tokenId, PositionState>` con el estado final calculado en memoria
- AND un batch `cursorUpdates` con operaciones y valores finales
- WHEN se llama `await helper.commitSuccess(runId, { positions, cursorUpdates })`
- THEN el helper MUST abrir exactamente UNA transacción SQL
- AND dentro de esa transacción MUST hacer UPSERT batch de `positions`
- AND MUST hacer UPSERT batch de `wallet_sync_cursors`
- AND MUST actualizar `sync_runs` a `status = 'completed'`
- AND MUST setear `completed_at = now()`
- AND MUST persistir `txs_persisted` con el acumulado in-memory del run
- AND si todo sale bien, MUST confirmar el commit una sola vez

#### Scenario: `rollback()` confía en CASCADE y no toca `positions` ni `wallet_sync_cursors`

- GIVEN un `runId` con transacciones hijas asociadas por `transactions.sync_run_id`
- WHEN se llama `await helper.rollback(runId)`
- THEN el helper MUST ejecutar `DELETE FROM sync_runs WHERE id = $1`
- AND PostgreSQL MUST borrar por CASCADE las transacciones hijas
- AND el helper MUST NOT borrar ni recalcular `positions`
- AND el helper MUST NOT modificar `wallet_sync_cursors`

#### Scenario: NEGATIVE — falla el commit final y se dispara auto-rollback

- GIVEN un `runId` en `status = 'running'`
- AND una de las operaciones internas de `commitSuccess()` falla (por ejemplo, un UPSERT inválido de cursor)
- WHEN `commitSuccess()` captura ese error
- THEN el helper MUST abortar la transacción abierta
- AND MUST llamar automáticamente a `rollback(runId)`
- AND MUST re-throw el error original
- AND al terminar, la fila en `sync_runs` MUST NOT existir
- AND las transacciones del run MUST NOT existir por efecto del CASCADE

---

### Requirement: REQ-003 — Módulo `PositionStateBuffer` con `loadInitial` / `apply`

El backend MUST exponer `apps/backend/src/services/position-state-buffer.ts` para mantener el estado de `positions` en memoria durante una sync, evitando escrituras parciales antes del commit final.

**API requerida:**

```typescript
export async function loadInitial(
  pool: Pool,
  walletId: string,
): Promise<Map<string, PositionState>>;

export function apply(
  buffer: Map<string, PositionState>,
  tx: ProcessTransactionInput,
): void;
```

#### Scenario: `loadInitial()` carga el último estado persistido por token del wallet

- GIVEN un wallet con posiciones persistidas en DB
- WHEN se llama `await loadInitial(pool, walletId)`
- THEN la función MUST devolver un `Map<tokenId, PositionState>`
- AND si existe una posición OPEN para un token, el `Map` MUST guardar esa posición
- AND si no existe OPEN pero sí un ciclo CLOSED más reciente, el `Map` MUST guardar esa posición CLOSED para preservar `cycleNumber`
- AND la carga MUST alcanzar para derivar `priorClosedCycles` sin round-trip extra por transacción

#### Scenario: `apply()` delega al position engine sin modificar su API

- GIVEN un buffer cargado con `loadInitial()`
- AND una transacción compatible con `processTransaction(state, tx)`
- WHEN se llama `apply(buffer, tx)`
- THEN la función MUST invocar el position engine existente
- AND si el estado cacheado está `OPEN`, MUST pasar ese estado como `position`
- AND si el estado cacheado está `CLOSED`, MUST pasar `position = null` y `priorClosedCycles = cycleNumber`
- AND MUST reemplazar en el `Map` el `PositionState` resultante para ese `tokenId`
- AND si la transacción cierra un ciclo y luego abre otro, MUST conservar el nuevo estado resultante en memoria
- AND el módulo MUST NOT cambiar el contrato del position engine

#### Scenario: El engine queda intacto y el buffer sólo lo orquesta

- GIVEN el archivo `apps/backend/src/position-engine/*`
- WHEN se implementa US-018
- THEN la API funcional del engine MUST permanecer sin cambios
- AND `PositionStateBuffer` MUST actuar sólo como adaptador/orquestador en memoria

---

### Requirement: REQ-004 — `cleanupStaleRuns(pool)` + integración en `buildServer()`

El backend MUST exponer una función `cleanupStaleRuns(pool): Promise<{ deleted: number }>` y MUST ejecutarla al arrancar el servidor, después de tener acceso al pool y antes de registrar rutas.

#### Scenario: `cleanupStaleRuns()` elimina sólo runs stale en `running`

- GIVEN filas en `sync_runs` con estados mezclados (`running`, `completed`)
- WHEN se llama `await cleanupStaleRuns(pool)`
- THEN la función MUST ejecutar `DELETE FROM sync_runs WHERE status = 'running' RETURNING id`
- AND MUST devolver `{ deleted: number }` con la cantidad de filas borradas
- AND los runs `completed` MUST permanecer

#### Scenario: `buildServer()` corre cleanup antes de registrar rutas

- GIVEN el backend arrancando con `buildServer()`
- WHEN el servidor inicializa sus dependencias
- THEN `cleanupStaleRuns(pool)` MUST ejecutarse antes de registrar las rutas `/api/*`
- AND `buildServer()` MUST loguear `Cleaned up N stale sync runs` con el valor real de `deleted`
- AND la limpieza MUST ocurrir una vez por arranque

#### Scenario: NEGATIVE — el cleanup no borra data fuera de su scope

- GIVEN transacciones legacy con `sync_run_id = NULL`
- AND runs `completed` válidos
- WHEN corre `cleanupStaleRuns(pool)`
- THEN las transacciones legacy MUST NOT borrarse
- AND los runs `completed` MUST NOT borrarse
- AND sólo la data colgando de runs `running` MUST desaparecer

---

### Requirement: REQ-005 — `computePnl()` cubre explícitamente `FIAT_IN` y `FIAT_OUT`

La función `computePnl()` en `apps/backend/src/services/portfolio.ts` MUST tratar `FIAT_IN` como inbound y `FIAT_OUT` como outbound de manera explícita, sin depender de caída implícita al branch por defecto.

#### Scenario: `FIAT_IN` entra en el branch inbound

- GIVEN `type = 'FIAT_IN'`, `priceUsd != null`, `currentPrice != null`, `amount = '1'`
- WHEN `computePnl()` calcula el P&L mostrado en detalle de token
- THEN MUST devolver `kind = 'INBOUND'`
- AND MUST calcular `lotPnlUsd = (currentPrice - priceUsd) × amount`
- AND MUST calcular `lotPnlPct` igual que `BUY` / `SWAP_IN` / `TRANSFER_IN`

#### Scenario: `FIAT_OUT` entra en el branch outbound

- GIVEN `type = 'FIAT_OUT'`, `priceUsd != null`, `currentPrice != null`, `amount = '1'`
- WHEN `computePnl()` calcula el P&L mostrado
- THEN MUST devolver `kind = 'OUTBOUND'`
- AND MUST calcular `realizedPnlUsd = (currentPrice - priceUsd) × amount`
- AND el comentario del branch outbound SHOULD documentar explícitamente `FIAT_OUT`

#### Scenario: No hay regresión en tipos existentes

- GIVEN los tipos `BUY`, `SELL`, `SWAP_IN`, `SWAP_OUT`, `TRANSFER_IN`, `TRANSFER_OUT`
- WHEN se recalcula `computePnl()` para cada caso cubierto hoy por `portfolio.test.ts`
- THEN el comportamiento MUST permanecer sin cambios
- AND `FIAT_IN` MUST dejar de caer al branch outbound por default

---

## Negative Scenarios

### NEGATIVE-001: `commitSuccess()` falla después de haber persistido transacciones del run

- GIVEN transacciones ya insertadas con `sync_run_id = runId`
- WHEN el commit diferido de `positions` / `wallet_sync_cursors` falla
- THEN `rollback(runId)` MUST ejecutarse automáticamente
- AND `DELETE FROM sync_runs` MUST limpiar las transacciones hijas por CASCADE
- AND `positions` / `wallet_sync_cursors` MUST quedar como estaban antes del intento

### NEGATIVE-002: `transactions.sync_run_id` inválido rompe por FK

- GIVEN `sync_runs` no contiene el UUID referenciado
- WHEN se intenta insertar una transacción con ese `sync_run_id`
- THEN la base MUST devolver error de FK
- AND el helper MUST NOT maquillar ese error como éxito

### NEGATIVE-003: Data legacy con `sync_run_id = NULL` no participa del rollback

- GIVEN transacciones históricas creadas antes de US-018
- WHEN se borra un run vía `rollback()` o startup cleanup
- THEN esas filas legacy MUST seguir existiendo
- AND el comportamiento MUST demostrar compatibilidad hacia atrás

---

## Contracts

### `sync_runs`

```sql
sync_runs(
  id UUID PK,
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  type CHECK ('CEX','ON_CHAIN'),
  status CHECK ('running','completed'),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NULL,
  txs_persisted INTEGER NOT NULL DEFAULT 0
)
```

### `SyncRunHelper.commitSuccess()`

```typescript
await helper.commitSuccess(runId, {
  positions: new Map<string, PositionState>(),
  cursorUpdates: [{ operation: 'trades:ETHUSDT', value: '2026-05-10T12:00:00.000Z' }],
});
```

**Efecto observable**:
1. UPSERT de `positions`
2. UPSERT de `wallet_sync_cursors`
3. `UPDATE sync_runs SET status='completed', completed_at=now(), txs_persisted=<acumulado>`
4. Si algo falla, `rollback(runId)`

### `PositionStateBuffer`

```typescript
const buffer = await loadInitial(pool, walletId);
apply(buffer, processTransactionInput);
```

El buffer MUST existir sólo en memoria durante la sync. MUST NOT persistir nada hasta `commitSuccess()`.
