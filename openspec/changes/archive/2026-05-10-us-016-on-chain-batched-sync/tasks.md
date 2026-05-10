# Tareas — US-016: SSE streaming y persistencia por lotes para sync on-chain

> Cambio: `us-016-on-chain-batched-sync`
> Generado: 2026-05-10

---

## BATCH 1 — Backend

> Prerequisito de todas las tareas de Batch 2. Implementar en orden T01 → T02 → T03.

---

## T01 — Refactor de `OnChainSyncService.sync()`: firma, SyncRunHelper y AbortSignal

> Base del cambio. Sin esta pieza, T02 (persistBatched) y T03 (route wiring) no tienen dónde conectar.

**Archivo principal:** `apps/backend/src/services/on-chain-sync.ts`

### Subtareas

- [x] T01.1 — Agregar importaciones: `SyncRunHelper` desde `./sync-run-helper.js`, `loadInitial` / `apply` desde `./position-state-buffer.js`, y re-exportar `SyncEmitter` type desde `./binance-sync.js`
  — `apps/backend/src/services/on-chain-sync.ts`

- [x] T01.2 — Declarar constante `export const ON_CHAIN_PERSIST_BATCH_SIZE = 500` al top del módulo
  — `apps/backend/src/services/on-chain-sync.ts`

- [x] T01.3 — Extender la firma pública de `sync()` con tercer parámetro opcional: `opts?: { emit?: SyncEmitter; signal?: AbortSignal }`. La llamada sin `opts` debe continuar funcionando (backward-compat)
  — `apps/backend/src/services/on-chain-sync.ts`

- [x] T01.4 — Agregar método privado `checkAborted(signal?: AbortSignal): void` que lanza `new Error('ABORTED')` cuando `signal?.aborted` es `true`
  — `apps/backend/src/services/on-chain-sync.ts`

- [x] T01.5 — Reemplazar el bloque `try/catch` con transacción manual (`BEGIN/COMMIT/ROLLBACK`, `pool.connect()`, `pgc.release()`) por el ciclo `SyncRunHelper`: `start(walletId, 'ON_CHAIN')` → procesamiento → `commitSuccess(runId, { positions: buffer, cursorUpdates })` en happy path → `rollback(runId)` en catch
  — `apps/backend/src/services/on-chain-sync.ts`

- [x] T01.6 — Inicializar `PositionStateBuffer` al inicio del sync con `loadInitial(this.deps.pool, walletId)` y pasar el buffer como parámetro a cada función de procesamiento que actualmente upserta positions inline
  — `apps/backend/src/services/on-chain-sync.ts`

- [x] T01.7 — Reestructurar el cuerpo de `sync()` en 4 steps secuenciales con `emit?.()` al inicio/fin de cada uno, y `checkAborted(signal)` entre cada par de steps:
  1. `fetch_normal` — paginateNormal → emit running/done con `synced: normalTxs.length`
  2. `fetch_tokens` — paginateToken → emit running/done con `synced: tokenTxs.length`
  3. `classify` — groupByTxHash + classifyAndDecompose + sort `(blockNumber, transactionIndex, txLogIndex)` → emit running/done con `synced: decomposed.length`
  4. Delegar a `persistBatched(...)` (implementado en T02)
  — `apps/backend/src/services/on-chain-sync.ts`

- [x] T01.8 — Eliminar el UPDATE inline de `wallets.last_synced_block` y el UPSERT inline de positions; mover actualización de cursor a `cursorUpdates` del `commitSuccess` (key: `'block'`, value: último `blockNumber` del array `decomposed`, o el cursor existente si no hay txs)
  — `apps/backend/src/services/on-chain-sync.ts`

- [x] T01.9 — Agregar best-effort `UPDATE wallets SET last_synced_at = now()` después del `commitSuccess`, envuelto en `.catch(() => {})` para no romper el happy path si falla
  — `apps/backend/src/services/on-chain-sync.ts`

**Criterio de aceptación:** `sync(walletId, userId)` sin `opts` sigue funcionando. Con `opts`, emite los 8 eventos de step (running/done × 4) y llama `rollback` ante cualquier error.

**Estimado:** ~120 líneas modificadas / eliminadas + ~40 líneas nuevas (neto: +40)

---

## T02 — Nuevo método privado `persistBatched` con batch INSERT y batchProgress

> Depende de T01 (necesita `runId`, `buffer`, `decomposed`, `emit`, `signal` que T01 provee).

**Archivo principal:** `apps/backend/src/services/on-chain-sync.ts`

### Subtareas

- [x] T02.1 — Crear método privado `persistBatched(walletId, network, runId, buffer, decomposed, emit?, signal?)` con return type `Promise<{ synced: number; skipped: number }>`:
  - Emite `{ step: 'persist', status: 'running' }` al inicio
  - Itera `decomposed` en chunks de `ON_CHAIN_PERSIST_BATCH_SIZE` (500)
  - Por cada tx en el batch: llama `ensureToken`, `resolvePrice`, y la versión refactorizada de `persistOneTransaction` (T02.2)
  - Después de cada batch: emite `{ type: 'batchProgress', done: Math.min(i + batch.length, decomposed.length), total: decomposed.length }`
  - Llama `checkAborted(signal)` entre batches (después del emit de batchProgress)
  - Al finalizar todos los batches: emite `{ step: 'persist', status: 'done', synced, skipped: 0 }`
  — `apps/backend/src/services/on-chain-sync.ts`

- [x] T02.2 — Refactorizar `persistOneTransaction` para:
  - Eliminar el parámetro `PoolClient` (reemplazar por `this.deps.pool` directamente)
  - Agregar parámetro `runId: string` (FK a `sync_runs`) e incluirlo en el INSERT SQL como `sync_run_id = $N`
  - Eliminar el UPSERT inline de positions (ahora lo hace `commitSuccess`)
  - Llamar `apply(buffer, ...)` para actualizar el PositionStateBuffer en memoria tras cada INSERT exitoso
  - Mantener `ON CONFLICT DO NOTHING` para idempotencia
  — `apps/backend/src/services/on-chain-sync.ts`

- [x] T02.3 — Después de `persistBatched`, llamar `syncRunHelper.recordTxsPersisted(runId, synced)` antes de `commitSuccess`
  — `apps/backend/src/services/on-chain-sync.ts`

**Criterio de aceptación:** Con 1200 txs clasificadas, el step persist emite exactamente 3 eventos `batchProgress` (`done: 500`, `done: 1000`, `done: 1200`) antes del evento `done`. Con < 500 txs, emite un único `batchProgress`. Un abort entre batches detiene el loop y el catch externo invoca `rollback`.

**Estimado:** ~90 líneas nuevas (persistBatched) + ~30 líneas modificadas (persistOneTransaction)

---

## T03 — Route wiring: pasar `emit` y `signal` a `OnChainSyncService`

> Depende de T01 (la firma nueva de `sync()` debe existir para compilar).

**Archivo principal:** `apps/backend/src/routes/sync.ts`

### Subtareas

- [x] T03.1 — En el handler SSE (`GET /:walletId/stream`), actualizar la llamada a `onChainService.sync()` para pasar `{ emit, signal: ac.signal }` como tercer argumento:
  ```typescript
  // ANTES:
  const result = await onChainService.sync(walletId, userId);
  // DESPUÉS:
  const result = await onChainService.sync(walletId, userId, { emit, signal: ac.signal });
  ```
  — `apps/backend/src/routes/sync.ts`

- [x] T03.2 — En el POST handler (sync manual sin SSE), actualizar la llamada para pasar `{ signal: ac.signal }` (sin `emit`) para soportar cancelación limpia también en el path no-SSE:
  ```typescript
  // ANTES:
  const result = await onChainService.sync(walletId, userId);
  // DESPUÉS:
  const result = await onChainService.sync(walletId, userId, { signal: ac.signal });
  ```
  — `apps/backend/src/routes/sync.ts`

- [x] T03.3 — Verificar que el `emit({ step: 'complete', ... })` al final del handler SSE no duplique el evento `complete` si el servicio lo emite internamente. Según el patrón Binance: el servicio emite steps 1–4, la route emite el `complete` terminal. Eliminar cualquier `emit('complete')` del servicio que pueda haberse introducido en T01.
  — `apps/backend/src/routes/sync.ts` + `apps/backend/src/services/on-chain-sync.ts`

**Criterio de aceptación:** Un request SSE a `GET /api/sync/:walletId/stream` para wallet `ON_CHAIN` recibe los eventos SSE en tiempo real. El POST handler sigue funcionando sin SSE.

**Estimado:** ~8 líneas modificadas

---

## BATCH 2 — Frontend

> Requiere Batch 1 completo para que los eventos SSE lleguen. Las tareas T04/T05/T06 son independientes entre sí dentro del batch.

---

## T04 — Ampliar types en `settings.ts`: `SYNC_STEPS_ON_CHAIN` y union `SyncStepName`

> Prerequisito de T05 y T06 (ambos importan los tipos nuevos).

**Archivo:** `apps/frontend/src/types/settings.ts`

### Subtareas

- [x] T04.1 — Agregar la constante `SYNC_STEPS_ON_CHAIN`:
  ```typescript
  export const SYNC_STEPS_ON_CHAIN = ['fetch_normal', 'fetch_tokens', 'classify', 'persist'] as const;
  ```
  — `apps/frontend/src/types/settings.ts`

- [x] T04.2 — Derivar los tipos discriminados:
  ```typescript
  export type CexSyncStepName = (typeof SYNC_STEPS_CEX)[number];
  export type OnChainSyncStepName = (typeof SYNC_STEPS_ON_CHAIN)[number];
  export type SyncStepName = CexSyncStepName | OnChainSyncStepName;
  ```
  Mantener el nombre `SyncStepName` para evitar breaking changes en los consumers existentes.
  — `apps/frontend/src/types/settings.ts`

**Criterio de aceptación:** El tipo `SyncStepName` acepta tanto `'trades'` como `'fetch_normal'` sin error de TypeScript. Los consumers existentes que usan `SyncStepName` no requieren cambios.

**Estimado:** ~10 líneas nuevas

---

## T05 — Parametrizar `useSyncStream` por wallet type y manejar `batchProgress`

> Depende de T04 (importa `SYNC_STEPS_ON_CHAIN` y `OnChainSyncStepName`).

**Archivo:** `apps/frontend/src/hooks/settings/useSyncStream.ts`

### Subtareas

- [x] T05.1 — Importar `SYNC_STEPS_CEX`, `SYNC_STEPS_ON_CHAIN` y el tipo `WalletType` desde `../../types/settings`
  — `apps/frontend/src/hooks/settings/useSyncStream.ts`

- [x] T05.2 — Agregar labels para los steps on-chain al record `STEP_LABELS`:
  ```typescript
  fetch_normal: 'Obteniendo txs normales',
  fetch_tokens: 'Obteniendo token txs',
  classify: 'Clasificando',
  persist: 'Persistiendo',
  ```
  — `apps/frontend/src/hooks/settings/useSyncStream.ts`

- [x] T05.3 — Refactorizar `initialSteps()` para recibir `walletType: WalletType` y seleccionar el array correcto:
  ```typescript
  function initialSteps(walletType: WalletType): StepState[] {
    const names = walletType === 'ON_CHAIN' ? SYNC_STEPS_ON_CHAIN : SYNC_STEPS_CEX;
    return names.map((name) => ({ name, label: STEP_LABELS[name], status: 'pending' as const }));
  }
  ```
  — `apps/frontend/src/hooks/settings/useSyncStream.ts`

- [x] T05.4 — Actualizar la firma del hook: `useSyncStream(walletId: string, walletType: WalletType)` y actualizar el `useCallback` de `start` para incluir `walletType` en el dependency array
  — `apps/frontend/src/hooks/settings/useSyncStream.ts`

- [x] T05.5 — Agregar estado `batchProgress`:
  ```typescript
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  ```
  — `apps/frontend/src/hooks/settings/useSyncStream.ts`

- [x] T05.6 — En el handler `onmessage`, agregar detección del evento `batchProgress` ANTES de la lógica de step existente:
  ```typescript
  if (data.type === 'batchProgress') {
    setBatchProgress({ done: data.done as number, total: data.total as number });
    return;
  }
  ```
  Y limpiar `batchProgress` cuando el step `persist` termina:
  ```typescript
  if (step === 'persist' && stepStatus === 'done') {
    setBatchProgress(null);
  }
  ```
  — `apps/frontend/src/hooks/settings/useSyncStream.ts`

- [x] T05.7 — Incluir `batchProgress` en el objeto de retorno del hook
  — `apps/frontend/src/hooks/settings/useSyncStream.ts`

- [x] T05.8 — Actualizar todos los call-sites de `useSyncStream` que no pasen `walletType` para pasarlo (buscar en `apps/frontend/src/`) — probablemente en `SyncProgress.tsx` o en la page de Settings
  — `apps/frontend/src/**`

**Criterio de aceptación:** Para wallet `CEX_BINANCE`, el hook inicializa con los 5 steps CEX (sin regresión). Para wallet `ON_CHAIN`, inicializa con los 4 steps on-chain. El state `batchProgress` se actualiza con cada evento `batchProgress` recibido y se limpia al terminar el step `persist`.

**Estimado:** ~55 líneas modificadas/nuevas

---

## T06 — Mostrar contador `batchProgress` en `SyncProgress.tsx`

> Depende de T05 (el hook expone `batchProgress`). Independiente de T04 como prerrequisito directo (T05 actúa como puente).

**Archivo:** `apps/frontend/src/components/settings/SyncProgress.tsx`

### Subtareas

- [x] T06.1 — Agregar `batchProgress: { done: number; total: number } | null` a la interface `SyncProgressProps`
  — `apps/frontend/src/components/settings/SyncProgress.tsx`

- [x] T06.2 — Pasar `batchProgress` como prop al componente hijo `StepRow` (o inline donde se renderice el step `persist`)
  — `apps/frontend/src/components/settings/SyncProgress.tsx`

- [x] T06.3 — En el render del step `persist`, agregar el sub-contador condicional:
  ```tsx
  {step.name === 'persist' && step.status === 'running' && batchProgress && (
    <span className="text-xs text-indigo-300">
      {batchProgress.done} / {batchProgress.total} txs
    </span>
  )}
  ```
  — `apps/frontend/src/components/settings/SyncProgress.tsx`

- [x] T06.4 — Actualizar el call-site de `<SyncProgress>` (en la página/componente padre) para pasar la nueva prop `batchProgress` extraída del hook `useSyncStream`
  — `apps/frontend/src/**` (buscar el consumer de `SyncProgress`)

**Criterio de aceptación:** Durante el step `persist` con estado `running`, el componente muestra `X / Y txs` (ej: `500 / 1200 txs`). Al llegar `step persist done`, el contador desaparece. Para wallets CEX, el componente no muestra el contador (batchProgress siempre `null`).

**Estimado:** ~25 líneas modificadas/nuevas

---

## Review Workload Forecast

| Métrica | Estimado |
|---------|----------|
| Archivos modificados | 4 (`on-chain-sync.ts`, `sync.ts`, `settings.ts`, `useSyncStream.ts`, `SyncProgress.tsx`) |
| Total estimado líneas cambiadas | ~380 (neto: +290 nuevas, ~90 eliminadas) |
| Archivo con mayor impacto | `on-chain-sync.ts` (~240 líneas entre T01 + T02) |
| Chained PRs recommended | No |
| 400-line budget risk | Low–Medium (el grueso está en un solo archivo de servicio bien delimitado) |
| Decision needed before apply | No — scope cerrado, sin migraciones, sin ambigüedades de diseño |

### Sugerencia de orden de apply

1. **Batch 1 completo primero** (T01 → T02 → T03): el backend debe compilar y los eventos SSE deben llegar antes de que el frontend tenga sentido cambiarlos.
2. **Batch 2** (T04 → T05 → T06): en ese orden porque T04 provee los tipos que T05 importa, y T06 consume el estado que T05 expone.
