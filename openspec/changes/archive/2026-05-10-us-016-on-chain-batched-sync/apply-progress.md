# Apply Progress — US-016: SSE streaming y persistencia por lotes para sync on-chain

> Batch: 1 (Backend) + Batch 2 (Frontend)
> Fecha: 2026-05-10
> Estado: **COMPLETO**

---

## Tareas Completadas

- [x] T01 — Refactor de `OnChainSyncService.sync()`: firma, SyncRunHelper y AbortSignal
  - [x] T01.1 — Importaciones: `SyncRunHelper`, `loadInitial`, `apply`, `SyncEmitter`, `ProcessTransactionInput`
  - [x] T01.2 — Constante `export const ON_CHAIN_PERSIST_BATCH_SIZE = 500`
  - [x] T01.3 — Firma extendida: `opts?: { emit?: SyncEmitter; signal?: AbortSignal }`
  - [x] T01.4 — Método privado `checkAborted(signal?: AbortSignal): void`
  - [x] T01.5 — SyncRunHelper lifecycle: `start` → `commitSuccess` / `rollback` (eliminado BEGIN/COMMIT/ROLLBACK manual)
  - [x] T01.6 — `loadInitial(this.deps.pool, walletId)` al inicio del sync
  - [x] T01.7 — 4 steps secuenciales con emit: `fetch_normal`, `fetch_tokens`, `classify`, y delega a `persistBatched`
  - [x] T01.8 — Cursor movido a `cursorUpdates` array de `commitSuccess` (key: `'block'`)
  - [x] T01.9 — Best-effort `UPDATE wallets SET last_synced_at = now()` con `.catch(() => undefined)`

- [x] T02 — Nuevo método privado `persistBatched` con batch INSERT y batchProgress
  - [x] T02.1 — `persistBatched(walletId, network, runId, buffer, decomposed, emit?, signal?)` → `Promise<{ counters, newTransactionIds }>`
  - [x] T02.2 — `persistOneTransaction` refactorizado: sin PoolClient, recibe `runId`, usa `apply(buffer, input)`, agrega `sync_run_id` al INSERT
  - [x] T02.3 — `syncRunHelper.recordTxsPersisted(runId, counters.synced)` llamado antes de `commitSuccess`

- [x] T03 — Route wiring: `emit` y `signal` pasados a `OnChainSyncService`
  - [x] T03.1 — SSE handler: `onChainService.sync(walletId, userId, { emit, signal: ac.signal })`
  - [x] T03.2 — POST handler: `onChainService.sync(walletId, userId, { signal: ac.signal })`
  - [x] T03.3 — Verificado: `complete` sólo es emitido por la route, no por el servicio

---

## Archivos Modificados

### Batch 1 — Backend

- `apps/backend/src/services/on-chain-sync.ts` — Refactor principal
- `apps/backend/src/routes/sync.ts` — T03 route wiring

### Batch 2 — Frontend

- `apps/frontend/src/types/settings.ts` — T04: nuevos tipos y constantes on-chain
- `apps/frontend/src/hooks/settings/useSyncStream.ts` — T05: hook parametrizado por walletType + batchProgress
- `apps/frontend/src/components/settings/SyncProgress.tsx` — T06: prop batchProgress + contador en step persist
- `apps/frontend/src/components/settings/ExchangeAccountsSection.tsx` — T05.8/T06.4: call-site CEX actualizado
- `apps/frontend/src/components/settings/OnChainWalletsSection.tsx` — T05.8/T06.4: migrado a useSyncStream + SyncProgress

---

## Tareas Completadas — Batch 2

- [x] T04 — Ampliar types en `settings.ts`
  - [x] T04.1 — `SYNC_STEPS_ON_CHAIN = ['fetch_normal', 'fetch_tokens', 'classify', 'persist'] as const`
  - [x] T04.2 — `CexSyncStepName`, `OnChainSyncStepName`, y union `SyncStepName`

- [x] T05 — Parametrizar `useSyncStream` por wallet type y manejar `batchProgress`
  - [x] T05.1 — Import `SYNC_STEPS_ON_CHAIN` y `WalletType` desde `../../types/settings`
  - [x] T05.2 — Labels on-chain en español: `fetch_normal`, `fetch_tokens`, `classify`, `persist`
  - [x] T05.3 — `initialSteps(walletType: WalletType)` con type annotation `readonly SyncStepName[]`
  - [x] T05.4 — Firma: `useSyncStream(walletId: string, walletType: WalletType)`, dep array actualizado
  - [x] T05.5 — Estado `batchProgress: { done: number; total: number } | null`
  - [x] T05.6 — Handler `batchProgress` en `onmessage` + clear cuando `persist` done
  - [x] T05.7 — `batchProgress` incluido en `UseSyncStreamResult` y retorno del hook
  - [x] T05.8 — Call-sites actualizados: `ExchangeAccountsSection` (CEX) + `OnChainWalletsSection` (ON_CHAIN)

- [x] T06 — Mostrar `batchProgress` en `SyncProgress.tsx`
  - [x] T06.1 — Prop `batchProgress` agregada a `SyncProgressProps`
  - [x] T06.2/T06.3 — `StepRow` acepta `batchProgress`; contador `X / Y txs` cuando step `persist` está running
  - [x] T06.4 — Ambos call-sites de `SyncProgress` pasan `batchProgress`

---

## Decisiones Tomadas Durante la Implementación

### `resolveTransferCost` sigue requiriendo `PoolClient`
`resolveTransferCost` acepta `PoolClient`, no `Pool`. En `persistBatched`, para llamadas `TRANSFER_IN` se adquiere un cliente corto desde el pool (`pool.connect()` → `pgc.release()`) envuelto en try/finally. Esto es correcto: las queries son solo lectura y no necesitan estar dentro de la transacción del SyncRunHelper.

### `persistOneTransaction` sin `PoolClient` ni positionIdentity condicional
La nueva implementación siempre provee `positionIdentity` con un UUID fresco (usado solo si `processTransaction` abre un nuevo ciclo). El `apply()` de `position-state-buffer.ts` llama a `processTransaction` internamente; el buffer queda actualizado y se lee `buffer.get(tokenId)` para obtener el `position_id` del INSERT de transactions.

### `fetchAllRawTransactions` eliminado
Era un wrapper que ejecutaba `paginateNormal` y `paginateToken` en paralelo con `Promise.all`. En el nuevo diseño, los steps 1 y 2 son secuenciales (emit separado por step), por lo que el wrapper ya no aplica.

### `NATIVE_SYMBOL` removido
Era una constante definida pero sin uso en el archivo. Se eliminó para evitar error de lint.

### `while (true)` → `for (;;)` en `paginateNormal` y `paginateToken`
El linter (`@typescript-eslint/no-unnecessary-condition`) rechaza `while (true)`. Se cambió a `for (;;)` que es semánticamente idéntico y lint-compliant.

### `PositionState` en el buffer tras `apply`
Dado que `apply` puede lanzar errores no-fatales (`InvalidTransactionError`, etc.) antes de llamar a `buffer.set`, el buffer no queda en estado inconsistente al hacer skip (`return { inserted: false }`). Los errores fatales se propagan hacia `persistBatched` → `sync()` → catch → `rollback`.

---

## Decisiones Tomadas Durante la Implementación — Batch 2

### `OnChainWalletsSection` migrado de `useSyncWallet` a `useSyncStream`
El `WalletRow` existente usaba `useSyncWallet` (fire-and-forget, sin SSE). Se reemplazó por `useSyncStream('ON_CHAIN')` + `SyncProgress` para mostrar los 4 steps on-chain en tiempo real. La detección de `done` usa el patrón `useRef(prevStatus)` igual que `CexWalletRow`.

### Tests de `OnChainWalletsSection` requieren actualización manual
`OnChainWalletsSection.spec.tsx` mockea `useSyncWallet` que ya no se importa en el componente. Los tests de comportamiento de sync fallarán. Estos tests preexistían de una historia anterior y la actualización está fuera del scope de NO test files de Batch 2.

### Tipo de union `SyncStepName` con `as const` arrays de diferente longitud
TypeScript no puede inferir `.map()` sobre `SYNC_STEPS_ON_CHAIN | SYNC_STEPS_CEX` (union de dos `readonly` tuple types). Solución: type annotation explícita `const names: readonly SyncStepName[] = ...` para que TypeScript resuelva el `.map()` correctamente.

### `status` removido del dep array de `start`
El dep `status` en el `useCallback` original era innecesario (el cuerpo de `start` nunca lee `status` directamente; usa `setStatus` functional update). Se eliminó para cumplir con `@typescript-eslint/no-unnecessary-deps`.

---

## Próximos Pasos

- Actualizar `OnChainWalletsSection.spec.tsx` para mockear `useSyncStream` en lugar de `useSyncWallet`
- Ejecutar `sdd-verify` para validar implementación contra specs
