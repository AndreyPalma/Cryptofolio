# Tareas — US-018: atomicidad por run con `sync_runs` + CASCADE rollback + escritura diferida de `positions`

> Cambio: `us-018-sync-run-atomicity`
> Generado: 2026-05-10
> Modo: Strict TDD (tests primero → implementación → quality gate)

---

## Work Unit 1: Tests TDD — fase RED (escribir tests antes de implementar)

> Los tests tienen que existir y fallar (rojo) ANTES de tocar cualquier archivo de
> implementación. Si querés un cambio confiable, primero hacé visible la falla.

- [ ] **T01** — Crear tests de `SyncRunHelper` + `cleanupStaleRuns` con DB real — `apps/backend/src/services/__tests__/sync-run-helper.test.ts`

  **Qué escribir** (proyecto Vitest `engine`, con PostgreSQL real y `skipIf(!DATABASE_URL_TEST)`):
  ```
  describe.skipIf(!hasDb)("SyncRunHelper (integration)")
    ├── start() crea fila en sync_runs con status='running'                      (REQ-002)
    ├── recordTxsPersisted() acumula y commitSuccess() persiste txs_persisted    (REQ-002)
    ├── commitSuccess() upsertea positions + cursores y completa el run          (REQ-002, REQ-003)
    ├── rollback() borra run + txs hijas por CASCADE                             (REQ-001, REQ-002)
    ├── cleanupStaleRuns() elimina sólo status='running' y devuelve count        (REQ-004)
    ├── NEGATIVE: commitSuccess() falla y dispara auto-rollback                  (NEGATIVE-001)
    ├── NEGATIVE: FK violation al insertar transaction.sync_run_id inexistente   (NEGATIVE-002)
    └── NEGATIVE: legacy tx con sync_run_id=NULL queda inmune                    (NEGATIVE-003)
  ```

  **Estado esperado al crearlo**: ROJO — el módulo `sync-run-helper.ts` todavía no existe y la migración `0006_sync_runs.sql` todavía no creó la tabla/columna requeridas.

  **Dependencias**: ninguna (es la fase RED fundacional)
  **Líneas estimadas**: ~220
  **Comando de verificación**: `npx vitest run apps/backend/src/services/__tests__/sync-run-helper.test.ts --project engine`
  **Aceptación**: el archivo existe y falla por la razón correcta (`module not found`, `relation sync_runs does not exist` o ausencia de `sync_run_id`), NO por error de sintaxis

---

- [ ] **T02** — Extender los tests de `portfolio` para cubrir `FIAT_IN` / `FIAT_OUT` — `apps/backend/src/services/__tests__/portfolio.test.ts`

  **Qué escribir** (proyecto Vitest `engine`, reutilizando `getTokenDetail()` que llama `computePnl()`):
  ```
  describe("US-018 computePnl fiat coverage")
    ├── FIAT_IN con ambos precios => pnl.kind='INBOUND', lotPnlUsd/lotPnlPct    (REQ-005)
    ├── FIAT_OUT con ambos precios => pnl.kind='OUTBOUND', realizedPnlUsd        (REQ-005)
    └── SELL existente no regresa                                                 (REQ-005)
  ```

  **Estado esperado al modificarlo**: ROJO — `FIAT_IN` hoy cae al branch outbound por default y el test tiene que capturarlo explícitamente.

  **Dependencias**: ninguna; puede hacerse en paralelo con T01 porque ambos son fase RED
  **Líneas estimadas**: ~70
  **Comando de verificación**: `npx vitest run apps/backend/src/services/__tests__/portfolio.test.ts -t "US-018 computePnl fiat coverage" --project engine`
  **Aceptación**: la suite falla específicamente porque `FIAT_IN` no devuelve `kind='INBOUND'`, NO por mocks rotos ni por un schema mal armado

---

## Work Unit 2: Migración SQL (fundación del schema)

> Una vez que la fase RED ya te mostró la falla, recién ahí conviene tocar el schema.
> Esta migración crea el mecanismo relacional que hace posible el rollback por run.

- [ ] **T03** — Crear migración `0006_sync_runs.sql` — `db/migrations/0006_sync_runs.sql`

  **Contenido exacto** (REQ-001, design §Decisión 1):
  ```sql
  -- Up Migration
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


  -- Down Migration
  DROP INDEX IF EXISTS transactions_sync_run_id_idx;
  ALTER TABLE transactions DROP COLUMN IF EXISTS sync_run_id;
  DROP INDEX IF EXISTS sync_runs_wallet_status_idx;
  DROP TABLE IF EXISTS sync_runs;
  ```

  **Dependencias**: T01 (la fase RED ya tiene que haber fallado primero)
  **Líneas estimadas**: ~28
  **Comando de verificación**: `npm run db:migrate`
  **Aceptación**: la migración aplica sin error; existen `sync_runs`, `sync_runs_wallet_status_idx`, `transactions.sync_run_id` y `transactions_sync_run_id_idx`; el down elimina todo en el orden correcto

---

## Work Unit 3: Core implementation — helper + buffer (fase GREEN)

> Acá convertís el rojo de T01 en verde. La regla es: las transacciones del run se
> pueden persistir durante el proceso, pero `positions` y `wallet_sync_cursors`
> quedan diferidos hasta `commitSuccess()`.

- [ ] **T04** — Implementar `SyncRunHelper` + `PositionStateBuffer` — `apps/backend/src/services/sync-run-helper.ts`, `apps/backend/src/services/position-state-buffer.ts`

  **Qué crear** (REQ-002, REQ-003, REQ-004):
  ```typescript
  // sync-run-helper.ts
  export class SyncRunHelper {
    private readonly txsPersistedByRun = new Map<string, number>();

    constructor(private readonly pool: Pool) {}

    async start(walletId: string, type: 'CEX' | 'ON_CHAIN'): Promise<{ runId: string }>;
    recordTxsPersisted(runId: string, count: number): void;
    async commitSuccess(
      runId: string,
      opts: {
        positions: Map<string, PositionState>;
        cursorUpdates: Array<{ operation: string; value: string }>;
      },
    ): Promise<void>;
    async rollback(runId: string): Promise<void>;
  }

  export async function cleanupStaleRuns(pool: Pool): Promise<{ deleted: number }>;

  // position-state-buffer.ts
  export async function loadInitial(pool: Pool, walletId: string): Promise<Map<string, PositionState>>;
  export function apply(buffer: Map<string, PositionState>, tx: ProcessTransactionInput): void;
  ```

  **Reglas de implementación**:
  1. `start()` inserta en `sync_runs` con `status='running'` y devuelve `runId`.
  2. `recordTxsPersisted()` sólo acumula en memoria.
  3. `commitSuccess()` hace UNA transacción DB: batch UPSERT `positions` → batch UPSERT `wallet_sync_cursors` → `UPDATE sync_runs SET status='completed', completed_at=now(), txs_persisted=$n`.
  4. Si `commitSuccess()` falla: rollback SQL interno → `await rollback(runId)` → re-throw del error original.
  5. `rollback()` hace sólo `DELETE FROM sync_runs WHERE id=$1`.
  6. `cleanupStaleRuns(pool)` hace `DELETE FROM sync_runs WHERE status='running' RETURNING id` y devuelve el count.
  7. `loadInitial()` carga la última posición persistida por token (OPEN si existe; si no, la CLOSED más reciente para preservar `cycleNumber`).
  8. `apply()` traduce ese estado al contrato del engine (`OPEN` → `position` real; `CLOSED` → `position=null` y `priorClosedCycles=cycleNumber`).
  9. `PositionStateBuffer` usa el engine actual; NO modifica `apps/backend/src/position-engine/*`.

  **Dependencias**: T03
  **Líneas estimadas**: ~220
  **Comando de verificación**: `npx vitest run apps/backend/src/services/__tests__/sync-run-helper.test.ts --project engine`
  **Aceptación**: T01 queda verde; `rollback()` borra txs por CASCADE; `commitSuccess()` persiste `txs_persisted`; la data legacy con `sync_run_id=NULL` sigue inmune

---

## Work Unit 4: Portfolio fix — `computePnl` (fase GREEN)

> Este cambio es chico, pero visible: `FIAT_IN` tiene que mostrarse como inbound.
> `FIAT_OUT` ya se comporta como outbound por caída natural, pero ahora queda
> explícito y documentado.

- [ ] **T05** — Corregir `computePnl()` para `FIAT_IN` / `FIAT_OUT` — `apps/backend/src/services/portfolio.ts`

  **Qué modificar** (REQ-005):
  ```typescript
  function computePnl(type: string, priceUsd: string | null, currentPrice: string | null, amount: string): PnlInfo {
    if (type === 'BUY' || type === 'SWAP_IN' || type === 'TRANSFER_IN' || type === 'FIAT_IN') {
      // inbound
      ...
    }
    // OUTBOUND: SELL, SWAP_OUT, TRANSFER_OUT, FIAT_OUT
    ...
  }
  ```

  **Dependencias**: T02 (el test rojo tiene que existir primero)
  **Líneas estimadas**: ~4
  **Comando de verificación**: `npx vitest run apps/backend/src/services/__tests__/portfolio.test.ts -t "US-018 computePnl fiat coverage" --project engine`
  **Aceptación**: T02 queda verde; `FIAT_IN` devuelve `kind='INBOUND'`; `FIAT_OUT` queda cubierto explícitamente en tests y comentario

---

## Work Unit 5: Integración de startup cleanup

> Una vez que el helper ya existe, lo integrás al arranque del backend. La limpieza
> tiene que correr antes de registrar rutas, así el usuario nunca ve transacciones
> colgadas de un run `running` viejo.

- [ ] **T06** — Integrar `cleanupStaleRuns(pool)` en `buildServer()` — `apps/backend/src/index.ts`

  **Qué modificar** (REQ-004, design §Decisión 3):
  ```typescript
  export async function buildServer(opts: BuildServerOptions = {}): Promise<FastifyInstance> {
    ...

    const { pool } = await import('./db/pool.js');
    const { cleanupStaleRuns } = await import('./services/sync-run-helper.js');
    const { deleted } = await cleanupStaleRuns(pool);
    fastify.log.info(`Cleaned up ${deleted} stale sync runs`);

    // recién después registrar walletRoutes / tokenRoutes / transactionRoutes / ...
  }
  ```

  **Dependencias**: T04
  **Líneas estimadas**: ~8
  **Comando de verificación**: `npm run typecheck`
  **Aceptación**: `buildServer()` compila; el cleanup queda ubicado antes del bloque de registro de rutas; el log info usa exactamente `Cleaned up N stale sync runs`

---

## Work Unit 6: Quality Gate

> Verificación final: schema, helper, buffer, cleanup e integración de portfolio.
> Si esto queda verde, ya tenés una base segura para US-014 y US-016.

- [ ] **T07** — Ejecutar quality gate completo — (no crea ni modifica archivos)

  **Comandos en orden**:
  1. `npm run typecheck` — verifica firmas, imports y orden de integración en `buildServer()`
  2. `npm run lint` — sin warnings en los archivos modificados
  3. `npm run test:engine` — incluye `sync-run-helper.test.ts`, `portfolio.test.ts` y suites existentes del engine/services

  **Dependencias**: T01–T06 completadas
  **Líneas estimadas**: 0 (solo ejecución)
  **Aceptación**: los 3 comandos retornan exit code 0; no hay regresiones en tests preexistentes; las coberturas nuevas de `SyncRunHelper` y `computePnl` quedan verdes

---

## Resumen de Archivos

| ID | Archivo | Acción | REQs cubiertos |
|----|---------|--------|----------------|
| T01 | `apps/backend/src/services/__tests__/sync-run-helper.test.ts` | CREAR | REQ-001, REQ-002, REQ-003, REQ-004, NEGATIVE-001, NEGATIVE-002, NEGATIVE-003 |
| T02 | `apps/backend/src/services/__tests__/portfolio.test.ts` | MODIFICAR | REQ-005 |
| T03 | `db/migrations/0006_sync_runs.sql` | CREAR | REQ-001 |
| T04 | `apps/backend/src/services/sync-run-helper.ts` | CREAR | REQ-002, REQ-004 |
| T04 | `apps/backend/src/services/position-state-buffer.ts` | CREAR | REQ-003 |
| T05 | `apps/backend/src/services/portfolio.ts` | MODIFICAR | REQ-005 |
| T06 | `apps/backend/src/index.ts` | MODIFICAR | REQ-004 |
| T07 | — (quality gate) | EJECUTAR | REQ-001, REQ-002, REQ-003, REQ-004, REQ-005 |

**Sin cambios** (por diseño):
- `apps/backend/src/position-engine/*` — el engine ya es compatible; no se toca
- `db/enums.ts` / `db/enums.test.ts` — `FIAT_IN` / `FIAT_OUT` ya vienen de US-013
- frontend — fuera de scope

---

## Review Workload Forecast

| Métrica | Estimado |
|---------|----------|
| Total estimado líneas cambiadas | ~530 |
| Archivos tocados | 6 (más 1 migración nueva, 1 test nuevo) |
| Chained PRs recommended | No |
| 400-line budget risk | Medium |
| Decision needed before apply | No |

> **Desglose de líneas**: `sync-run-helper.test.ts` ~220 · `portfolio.test.ts` ~70 · `0006_sync_runs.sql` ~28 · `sync-run-helper.ts` ~120 · `position-state-buffer.ts` ~100 · `portfolio.ts` ~4 · `index.ts` ~8
>
> El riesgo principal está concentrado en T04 porque junta helper + buffer + auto-rollback. El resto es acotado y fácil de revisar si mantenés el diff quirúrgico.
