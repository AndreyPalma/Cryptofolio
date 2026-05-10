# Proposal: US-016 — SSE streaming y persistencia por lotes para sync on-chain (ETH/BSC)

## Intent

El `OnChainSyncService` actual funciona pero carece de tres capacidades que ya existen en `BinanceSyncService`: streaming SSE de progreso en tiempo real, persistencia atómica vía `SyncRunHelper` con rollback CASCADE, y soporte de `AbortSignal` para cancelación limpia. Sin estas piezas, el usuario no tiene visibilidad del progreso de sincronización on-chain (solo ve un spinner genérico), y un error a mitad de sync deja datos parcialmente persistidos que pueden corromper el WAC.

US-016 alinea `OnChainSyncService` con el patrón ya probado de `BinanceSyncService`, reutilizando la infraestructura de US-015 (SSE route, `SyncOrchestrator`, `useSyncStream`) y US-018 (`SyncRunHelper`, `PositionStateBuffer`, tabla `sync_runs` con CASCADE).

## Scope

### In scope

**Backend — modificar:**
- `apps/backend/src/services/on-chain-sync.ts` — refactor principal: integrar `SyncRunHelper.start/commitSuccess/rollback`, `PositionStateBuffer.loadInitial/apply`, aceptar `opts?: { emit?, signal? }`, eliminar transacción manual `BEGIN/COMMIT/ROLLBACK`, emitir eventos SSE por step, batch persist con `ON_CHAIN_PERSIST_BATCH_SIZE = 500`, cursor updates via `commitSuccess`
- `apps/backend/src/routes/sync.ts` — pasar `{ emit, signal }` al `onChainService.sync()` en el handler SSE (actualmente no los pasa)

**Frontend — modificar:**
- `apps/frontend/src/types/settings.ts` — agregar constante `SYNC_STEPS_ON_CHAIN` (`fetch_normal`, `fetch_tokens`, `classify`, `persist`) y ampliar `SyncStepName` para ser union de CEX + on-chain steps
- `apps/frontend/src/hooks/settings/useSyncStream.ts` — parametrizar `initialSteps()` según wallet type (CEX vs ON_CHAIN), agregar labels para steps on-chain
- `apps/frontend/src/components/settings/SyncProgress.tsx` — (si existe) soportar `batchProgress` para mostrar `X / Y txs persisted` durante el step persist

### Out of scope

- Modificaciones al `PositionEngine` o al clasificador (`classify.ts`)
- Cambios en la lógica de cost resolution (`cost-resolver.ts`)
- Paginación de Etherscan/BSCTrace (ya funciona correctamente)
- Tests (skip explícito del usuario)
- Nuevas migraciones de DB (la tabla `sync_runs` con CASCADE ya existe vía US-018)

## Approach

Seguir el patrón exacto de `BinanceSyncService`:

1. **Signature change**: `sync(walletId, userId)` → `sync(walletId, userId, opts?: { emit?: SyncEmitter; signal?: AbortSignal })`

2. **SyncRunHelper lifecycle**:
   - `start(walletId, 'ON_CHAIN')` al inicio → obtener `runId`
   - `loadInitial(pool, walletId)` → cargar `PositionStateBuffer`
   - Procesar cada step emitiendo SSE (`emit({ step, status: 'running' })` / `emit({ step, status: 'done', synced, skipped })`)
   - `commitSuccess(runId, { positions: buffer, cursorUpdates })` al final
   - `rollback(runId)` en catch — CASCADE borra txs asociadas al `sync_run`

3. **Steps on-chain** (4 steps con SSE events):
   - `fetch_normal` — fetch paginated de normalTxs desde Etherscan/BSCTrace, emit count
   - `fetch_tokens` — fetch paginated de tokenTxs, emit count (0 si wallet es solo nativa)
   - `classify` — groupByTxHash + classifyAndDecompose + sort, emit count de decomposed
   - `persist` — batch insert de 500 txs, emit `batchProgress` progresivo (`{ persisted: X, total: Y }`)

4. **AbortSignal**: `checkAborted(signal)` entre steps (mismo patrón que Binance)

5. **Eliminar transacción manual**: Reemplazar el `BEGIN/COMMIT/ROLLBACK` explícito con el patron `SyncRunHelper` que maneja atomicidad vía `sync_runs` CASCADE

6. **Route wiring**: En `sync.ts`, pasar `{ emit, signal: ac.signal }` al `onChainService.sync()` (línea ~119 actual que solo pasa `walletId, userId`)

7. **Frontend**: Hacer `SyncStepName` genérico (union type), parametrizar `useSyncStream` con wallet type para seleccionar steps CEX vs on-chain

## Risks

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Batch persist de 500 txs puede ser lento si hay miles de txs acumuladas en primera sync | UX: step persist aparece estancado | Emit `batchProgress` cada batch para dar feedback granular |
| `PositionStateBuffer.apply()` puede fallar si el orden de txs no es correcto | WAC corrupto, positions incorrectas | Mantener el sort existente `(blockNumber, transactionIndex, txLogIndex)` ANTES de persist |
| Refactor de `on-chain-sync.ts` rompe el POST legacy | Sync on-chain deja de funcionar | El POST handler delega a `.sync()` — la firma se amplía con `opts?` opcional, no breaking |
| AbortSignal entre steps deja fetch incompleto sin persistir | Datos perdidos parcialmente | Es el comportamiento deseado: abort = no persist, no cursor advance. User puede re-sync |

## Non-goals

- **No se migra el PositionEngine** — sigue siendo puro, sin I/O
- **No se cambia la paginación de Etherscan/BSCTrace** — funciona correctamente con batches de 1000
- **No se agregan tests** — skip explícito
- **No se modifica `SyncRunHelper` ni `PositionStateBuffer`** — se consumen tal cual están
- **No se toca el cost-resolver** — la lógica de TRANSFER_IN inheritance se mantiene intacta
- **No se modifica el SyncOrchestrator** — el lock + abort ya funciona genéricamente para ambos wallet types

## Rollback Plan

Dado que no hay migraciones de DB, el rollback es simplemente revertir los archivos modificados:

1. `git revert` del commit de US-016
2. Los archivos afectados son solo 4: `on-chain-sync.ts`, `sync.ts` (route), `settings.ts` (types), `useSyncStream.ts`
3. No hay cambios de schema — `sync_runs` CASCADE ya existía pre-US-016
4. Cualquier `sync_run` creado durante el período de US-016 ya fue committeado o rolledback, no deja estado inconsistente

## Reference

- **US-015**: `SyncOrchestrator` (lock + abort), SSE route handler (`GET /:walletId/stream`), `useSyncStream` hook, `SyncProgress` component
- **US-018**: `SyncRunHelper` (start/commitSuccess/rollback), `PositionStateBuffer` (loadInitial/apply), tabla `sync_runs` con `ON DELETE CASCADE`
- **BinanceSyncService** (`binance-sync.ts`): Patrón de referencia completo — emit per step, AbortSignal, SyncRunHelper lifecycle
