# Proposal: US-018 — Atomicidad por run con sync_runs + CASCADE rollback + escritura diferida de positions

## Intent

Actualmente una sync fallida (CEX o on-chain) deja la DB con transacciones parciales que el position engine incluye en sus cálculos de WAC, balance y P&L hasta el siguiente retry exitoso. Esto es inaceptable para una app financiera: el dashboard muestra valores incorrectos entre la falla y el retry.

US-018 introduce atomicidad por run: cada sync se ejecuta como operación "todo o nada". Si falla en cualquier paso, la DB queda exactamente como antes de empezar. El mecanismo: una tabla `sync_runs` con un FK CASCADE en `transactions.sync_run_id` que permite rollback completo con un solo `DELETE`. Las positions y cursores se escriben sólo al final exitoso (escritura diferida).

Adicionalmente, se corrige el hallazgo de US-013: `portfolio.ts#computePnl` no cubre `FIAT_IN`/`FIAT_OUT` en las branches inbound/outbound, causando que transacciones fiat caigan al branch outbound por default.

## Scope

### In scope

| Acción | Archivo |
|--------|---------|
| Crear | `db/migrations/0006_sync_runs.sql` — tabla sync_runs + columna transactions.sync_run_id + índices |
| Crear | `apps/backend/src/services/sync-run-helper.ts` — clase SyncRunHelper (start, commitSuccess, rollback) |
| Crear | `apps/backend/src/services/position-state-buffer.ts` — buffer de PositionState en memoria + apply |
| Crear | `apps/backend/tests/sync-run-helper.test.ts` — tests unitarios del helper |
| Crear | `apps/backend/tests/portfolio-computepnl-fiat.test.ts` — test del fix de computePnl |
| Modificar | `apps/backend/src/index.ts` — cleanupStaleRuns en buildServer() |
| Modificar | `apps/backend/src/services/portfolio.ts` — computePnl incluye FIAT_IN/FIAT_OUT |
| Verificar | `db/enums.ts`, `db/enums.test.ts` — no necesitan cambios (FIAT ya incluido por US-013) |

### Out of scope

- Integración de SyncRunHelper con BinanceSyncService (eso es US-014)
- Integración de SyncRunHelper con OnChainSyncService (eso es US-016)
- SyncOrchestrator, SSE, lock concurrente (eso es US-015)
- Endpoints de posiciones cerradas (eso es US-017)
- Frontend — sin cambios de UI

## Approach

1. **Migración SQL** (`0006_sync_runs.sql`):
   - `CREATE TABLE sync_runs (id UUID PK, wallet_id FK CASCADE, type CHECK, status CHECK, started_at, completed_at, txs_persisted)`.
   - Índice `sync_runs_wallet_status_idx ON sync_runs (wallet_id, status)`.
   - `ALTER TABLE transactions ADD COLUMN sync_run_id UUID NULL REFERENCES sync_runs(id) ON DELETE CASCADE`.
   - Índice parcial `transactions_sync_run_id_idx ON transactions (sync_run_id) WHERE sync_run_id IS NOT NULL`.
   - Down: drop índices, columna, tabla en orden correcto.

2. **SyncRunHelper** (`sync-run-helper.ts`):
   - `start(pool, walletId, type)` → INSERT sync_runs status='running', retorna runId.
   - `recordTxsPersisted(count)` → acumulador in-memory.
   - `commitSuccess(pool, runId, { positions, cursorUpdates })` → una transacción DB: UPSERT positions batch + UPDATE cursors + UPDATE sync_runs status='completed'.
   - `rollback(pool, runId)` → DELETE FROM sync_runs WHERE id=$1 (CASCADE borra txs).
   - Si commitSuccess falla → rollback automático + re-throw.

3. **PositionStateBuffer** (`position-state-buffer.ts`):
   - `loadInitial(pool, walletId)` → lee positions actuales → Map<tokenId, PositionState>.
   - `apply(buffer, processTransactionInput)` → delega a `processTransaction` del engine, muta buffer.
   - NO modifica el position engine — usa su API funcional.

4. **cleanupStaleRuns** (en `buildServer()`):
   - `DELETE FROM sync_runs WHERE status = 'running' RETURNING id` + log count.
   - Se ejecuta después de conectar pool, ANTES de registrar rutas.

5. **Fix computePnl** (en `portfolio.ts`):
   - Branch inbound: agregar `|| type === 'FIAT_IN'`.
   - Branch outbound comment: agregar `FIAT_OUT` a la documentación (ya cae ahí por default, pero hacerlo explícito).

## Risks

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| CASCADE DELETE de miles de txs es lento | Rollback tarda segundos | Índice en `sync_run_id` garantiza scan eficiente; wallets típicas <10k txs por run |
| Crash entre INSERT txs y commitSuccess | Runs quedan en 'running' con txs huérfanas | cleanupStaleRuns en buildServer() limpia al reiniciar |
| Position engine no es thread-safe para buffer | Buffer se corrompe en uso concurrente | No aplica: single-instance, lock por walletId (US-015 lo garantiza) |
| Data legacy con sync_run_id=NULL | Confusión en queries | NULL es inmune al CASCADE; documentado en código |

## Non-goals

- NO se integra SyncRunHelper con los services de sync existentes (será US-014/US-016).
- NO se modifica la API pública del position engine.
- NO se agregan endpoints nuevos.
- NO se toca el frontend.

## Dependencies

- **Depende de**: US-013 (FIAT_IN/FIAT_OUT en el enum, ya completada).
- **Bloquea a**: US-014 (Binance sync completo), US-016 (on-chain batched sync) — ambos integran con SyncRunHelper.

## Rollback plan

1. Correr migración down: elimina índice, columna `sync_run_id`, tabla `sync_runs`.
2. Revertir `index.ts` (quitar cleanupStaleRuns).
3. Revertir `portfolio.ts` (computePnl vuelve a no cubrir FIAT_IN explícitamente — impacto: FIAT_IN transactions muestran P&L incorrecto en UI, aceptable como rollback temporal).
4. Borrar `sync-run-helper.ts`, `position-state-buffer.ts` y sus tests.
