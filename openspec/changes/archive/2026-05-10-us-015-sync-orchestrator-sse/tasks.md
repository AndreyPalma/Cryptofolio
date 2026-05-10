# Tareas — US-015: SyncOrchestrator + SSE + UI de Progreso para Sync Binance

> Cambio: `us-015-sync-orchestrator-sse`
> Generado: 2026-05-10
> **Estado: APLICADO + VERIFICADO** (2026-05-10)
> 
> Todas las tareas T-001 a T-010 están implementadas.
> Verificación SDD pasó con correcciones:
> - C-001: summary prop agregado a SyncProgress + integración en ExchangeAccountsSection
> - W-001: useEffect cleanup en unmount para useSyncStream
> - W-002: stale closure fix en onerror (setStatus funcional)
> - W-003: fiat emit consistencia (skipped: 0 en done, reason en skipped)
> - Fix adicional: response schema 409 en POST sync route
> 
> Typecheck: PASS (backend + frontend)
> Frontend tests: PASS (todos)
> Backend tests: 8 pre-existentes fallidos (no relacionados con US-015)

---

## Work Unit 1: SyncOrchestrator — Clase y Decorator

> Fundación del lock in-memory. Todo lo demás depende de que este singleton exista y esté disponible como Fastify decorator. Se implementa en un solo bloque porque T-002 solo tiene sentido después de T-001.

### T-001 — Crear clase `SyncOrchestrator`

**Archivo:** `apps/backend/src/services/sync-orchestrator.ts` *(crear)*

**Qué implementar:**
- Clase con `private locks: Map<string, AbortController>`
- Constructor `(pool: Pool, log: FastifyBaseLogger)` — ambos pasados desde `index.ts`
- `tryAcquireLock(walletId: string): AbortController | null` — si existe key retorna `null`; si no, crea `new AbortController()`, lo guarda y lo retorna
- `releaseLock(walletId: string): void` — `delete` del Map, idempotente (no hace `abort()`, eso lo controla el caller)
- `isLocked(walletId: string): boolean` — `return this.locks.has(walletId)`
- Module augmentation al final del archivo:
  ```ts
  declare module 'fastify' {
    interface FastifyInstance {
      syncOrchestrator: SyncOrchestrator;
    }
  }
  ```

**Dependencias:** ninguna

**Estimado:** ~60 líneas

---

### T-002 — Registrar `SyncOrchestrator` como Fastify decorator en `index.ts`

**Archivo:** `apps/backend/src/index.ts` *(modificar)*

**Qué implementar:**
- Importar `SyncOrchestrator` desde `'./services/sync-orchestrator.js'`
- Instanciar después de que `pool` y `fastify` existen pero antes de registrar rutas:
  ```ts
  const syncOrchestrator = new SyncOrchestrator(pool, fastify.log);
  fastify.decorate('syncOrchestrator', syncOrchestrator);
  ```
- Nota: `cleanupStaleRuns` ya está implementado (líneas 120-121) — no tocar.

**Dependencias:** T-001

**Estimado:** ~8 líneas

---

## Work Unit 2: BinanceSyncService — Emit calls

> Cambio mecánico aislado: agregar las llamadas `emit` entre pasos del método `sync()`. No cambia la firma pública (ya acepta `opts?.emit`). Se hace antes del Work Unit 3 porque el SSE endpoint invoca `binanceService.sync()` y necesita que los eventos salgan.

### T-003 — Agregar llamadas `emit` entre pasos en `BinanceSyncService.sync()`

**Archivo:** `apps/backend/src/services/binance-sync.ts` *(modificar)*

**Qué implementar:**
- Antes y después de cada llamada a `syncFiat`, `syncDeposits`, `syncWithdrawals`, `syncConverts`/`syncTrades`, intercalar los pares `emit({ step, status: 'running' })` / `emit({ step, status: 'done', synced, skipped })`.
- Patrón por paso (replicar para los 5):
  ```ts
  opts?.emit?.({ step: 'fiat', status: 'running' });
  const fiatResult = await this.syncFiat(walletId, runId, buffer, deferCursor, onTokenCreated, opts);
  opts?.emit?.({ step: 'fiat', status: 'done', synced: fiatResult, skipped: 0 });
  this.checkAborted(opts?.signal); // ya existe — no duplicar
  ```
- Los 5 pasos en orden: `fiat`, `deposits`, `withdrawals`, `converts`, `trades`
- El `checkAborted` ya existe entre pasos — los `emit` van ANTES del `checkAborted` (emit `done`, luego check, luego siguiente `running`)
- Si algún paso es omitido por configuración faltante, emitir `{ step, status: 'skipped', reason: '...' }` en lugar del par running/done

**Dependencias:** T-001 (para conocer el shape de eventos, aunque `SyncEmitter` ya es `Record<string, unknown>`)

**Estimado:** ~20 líneas intercaladas

---

## Work Unit 3: Backend — SSE Endpoint + Refactor POST

> El cambio más grande del backend. Requiere T-001 (decorator disponible) y T-003 (emit calls funcionando). Se hace todo en `sync.ts` siguiendo la Decisión 4 del design (GET y POST en el mismo plugin para compartir `validateWalletOwnership`).

### T-004 — Extraer `validateWalletOwnership` y agregar SSE types helpers en `sync.ts`

**Archivo:** `apps/backend/src/routes/sync.ts` *(modificar)*

**Qué implementar:**
- Extraer la query de ownership del POST actual a una función privada dentro del plugin scope:
  ```ts
  async function validateWalletOwnership(walletId: string, userId: string): Promise<{ wallet_type: 'ON_CHAIN' | 'CEX' }> { ... }
  ```
- Agregar el helper inline `writeSse`:
  ```ts
  function writeSse(raw: import('node:http').ServerResponse, data: Record<string, unknown>): void {
    raw.write(`data: ${JSON.stringify(data)}\n\n`);
  }
  ```
- Agregar tipos SSE locales (inline en el archivo, no exportados) para documentar el contrato:
  ```ts
  type SyncStepName = 'fiat' | 'deposits' | 'withdrawals' | 'converts' | 'trades';
  type SseEvent = { step: SyncStepName; status: 'running' } | { step: SyncStepName; status: 'done'; synced: number; skipped: number } | ...
  ```

**Dependencias:** T-001, T-002

**Estimado:** ~35 líneas

---

### T-005 — Implementar `GET /:walletId/stream` (endpoint SSE)

**Archivo:** `apps/backend/src/routes/sync.ts` *(modificar — continúa T-004)*

**Qué implementar:**
- Handler `GET /:walletId/stream` con `{ schema: { params: SyncParamsSchema } }` (reusar schema existente)
- Flujo completo:
  1. Extraer `userId` del JWT (`req.user`)
  2. `validateWalletOwnership(req.params.walletId, userId)` — throw 403 si no encontrado
  3. `req.server.syncOrchestrator.tryAcquireLock(walletId)` — return 409 `{ error: 'SYNC_IN_PROGRESS' }` si null
  4. `reply.hijack()` — tomar control del socket
  5. `raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' })`
  6. Listener en `req.raw.on('close', () => { ac.abort(); orchestrator.releaseLock(walletId); })`
  7. `emit` callback que llama `writeSse` si `!clientDisconnected`
  8. Instanciar `BinanceSyncService` igual que en el POST existente
  9. `try { const result = await binanceService.sync(walletId, userId, { emit, signal: ac.signal }); writeSse(raw, { step: 'complete', ... }); raw.end(); } catch(err) { ... } finally { orchestrator.releaseLock(walletId); }`
  10. En el `catch`: si `err.message !== 'ABORTED'` → emitir evento `error`; cerrar con `raw.end()`

**Dependencias:** T-004

**Estimado:** ~75 líneas

---

### T-006 — Refactorizar POST `/:walletId` para usar lock del orchestrator

**Archivo:** `apps/backend/src/routes/sync.ts` *(modificar — continúa T-005)*

**Qué implementar:**
- Reemplazar la query de ownership inline por `validateWalletOwnership()`
- Agregar lock antes de ejecutar sync:
  ```ts
  const orchestrator = req.server.syncOrchestrator;
  const ac = orchestrator.tryAcquireLock(req.params.walletId);
  if (!ac) return reply.status(409).send({ error: 'SYNC_IN_PROGRESS' });
  ```
- Pasar `emit: () => {}` (no-op) y `signal: ac.signal` a `binanceService.sync()`
- Wrap en `try/finally` con `orchestrator.releaseLock(req.params.walletId)` en finally
- El comportamiento de respuesta 200 con `BinanceSyncResult` no cambia

**Dependencias:** T-005

**Estimado:** ~25 líneas cambiadas

---

## Work Unit 4: Frontend — Tipos SSE

> Base de tipos compartidos para hook y componente. Sin esto, TypeScript rechaza el código del hook y componente. Intencionalmente pequeño y aislado.

### T-007 — Agregar tipos SSE a `types/settings.ts`

**Archivo:** `apps/frontend/src/types/settings.ts` *(modificar)*

**Qué implementar:**
- Al final del archivo, bajo una sección `// ── SSE sync stream types`:
  ```ts
  export const SYNC_STEPS = ['fiat', 'deposits', 'withdrawals', 'converts', 'trades'] as const;
  export type SyncStepName = (typeof SYNC_STEPS)[number];
  export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error';
  export type StepState = {
    name: SyncStepName;
    status: StepStatus;
    synced?: number;
    skipped?: number;
    reason?: string;
    errorMessage?: string;
  };
  export type SyncStreamStatus = 'idle' | 'syncing' | 'done' | 'error';
  export type SyncStreamState = {
    status: SyncStreamStatus;
    steps: StepState[];
    error: { code: string; message: string } | null;
    summary: unknown | null; // BinanceSyncResult — usar unknown para no acoplar
  };
  ```

**Dependencias:** ninguna (frontend independiente de backend en tipos — se alinean por contrato SSE)

**Estimado:** ~35 líneas

---

## Work Unit 5: Frontend — Hook `useSyncStream`

> Gestión del ciclo de vida del `EventSource`. El componente `SyncProgress` consume la interfaz que este hook expone.

### T-008 — Crear hook `useSyncStream`

**Archivo:** `apps/frontend/src/hooks/settings/useSyncStream.ts` *(crear)*

**Qué implementar:**
- Función `useSyncStream(walletId: string)` con:
  - `useRef<EventSource | null>` para la instancia del EventSource
  - `useState<SyncStreamState>` inicializado con `{ status: 'syncing', steps: [], error: null, summary: null }`
  - `useEffect` que abre `new EventSource('/api/sync/${walletId}/stream', { withCredentials: true })` al montar
  - Handler `eventSource.onmessage`: parsear `JSON.parse(e.data)`, actualizar `steps` según el `step` y `status` del evento:
    - Si `step === 'complete'` → `status: 'done'`, guardar `summary`, cerrar EventSource
    - Si `step === 'error'` → `status: 'error'`, guardar `error`, cerrar EventSource
    - Si `status === 'running'` → upsert en `steps[]` con ese step en running
    - Si `status === 'done' | 'skipped'` → actualizar entry de steps[]
  - Handler `eventSource.onerror`: cerrar EventSource (`es.close()`), setear `status: 'error'` si todavía `syncing`
  - Cleanup del `useEffect`: cerrar EventSource al desmontar
  - `cancel()`: `eventSource.current?.close()`, setear `status: 'idle'`
  - `retry()`: cerrar EventSource existente, resetear state, abrir nueva conexión (reusar lógica del `useEffect`)
- Retornar `{ steps, status, error, summary, cancel, retry }`

**Dependencias:** T-007

**Estimado:** ~90 líneas

---

## Work Unit 6: Frontend — Componente `SyncProgress`

> Componente presentacional puro. Recibe props del hook y renderiza la lista de pasos. Sin lógica de negocio propia.

### T-009 — Crear componente `SyncProgress`

**Archivo:** `apps/frontend/src/components/settings/SyncProgress.tsx` *(crear)*

**Qué implementar:**
- Props: `{ steps: StepState[], status: SyncStreamStatus, error: ..., summary: ..., onCancel: () => void, onRetry: () => void }`
- Si `steps` está vacío y `status === 'syncing'`: mostrar lista de los 5 steps con estado `pending` (todos grises)
- Lista de pasos con icono según estado:
  - `pending` → círculo gris neutro
  - `running` → spinner animado (`animate-spin` de Tailwind)
  - `done` → check verde + `synced` items sincronizados
  - `skipped` → icono gris + `reason`
  - `error` → X roja + `errorMessage`
- Botón "Cancelar" — visible solo cuando `status === 'syncing'` → llama `onCancel`
- Botón "Reintentar" — visible solo cuando `status === 'error'` → llama `onRetry`
- Bloque de resumen — visible cuando `status === 'done'` con los totales de `summary`
- Usar `cn()` de `lib/cn` para condicionales de clase. No usar `var()` directamente en className.

**Dependencias:** T-007

**Estimado:** ~85 líneas

---

## Work Unit 7: Frontend — Integración en Settings

> Conecta todo el frontend. Requiere que el hook y el componente existan. Es el único punto donde se toca código existente en el frontend.

### T-010 — Integrar `useSyncStream` + `SyncProgress` en `ExchangeAccountsSection`

**Archivo:** `apps/frontend/src/components/settings/ExchangeAccountsSection.tsx` *(modificar)*

**Qué implementar:**
- Importar `useSyncStream` y `SyncProgress`
- En la sección/componente del row de wallet CEX (`CexWalletRow` o inline según la estructura actual):
  - Invocar `useSyncStream(wallet.id)` condicionalmente para wallets `CEX_BINANCE`
  - Cuando `status !== 'idle'`, renderizar `<SyncProgress ... />` en lugar del spinner genérico
  - Pasar `onCancel={cancel}` y `onRetry={retry}` al componente
  - El botón "Sincronizar" existente debe deshabilitar si `status === 'syncing'` (evitar double-click)
- Para wallets `ON_CHAIN`: mantener el comportamiento actual con `useSyncWallet` (sin cambios)
- El trigger inicial de la sync sigue siendo el botón "Sincronizar" — al hacer click, el hook abre el EventSource (que lanza la sync server-side al conectarse)

**Dependencias:** T-008, T-009

**Estimado:** ~35 líneas modificadas

---

## Review Workload Forecast

| Métrica | Estimado |
|---------|----------|
| T-001 — SyncOrchestrator class | ~60 líneas nuevas |
| T-002 — Decorator en index.ts | ~8 líneas |
| T-003 — Emit calls en binance-sync.ts | ~20 líneas |
| T-004 — validateWalletOwnership + SSE helpers en sync.ts | ~35 líneas |
| T-005 — GET SSE handler | ~75 líneas |
| T-006 — POST refactor | ~25 líneas |
| T-007 — Tipos SSE en settings.ts | ~35 líneas |
| T-008 — useSyncStream hook | ~90 líneas nuevas |
| T-009 — SyncProgress component | ~85 líneas nuevas |
| T-010 — ExchangeAccountsSection integration | ~35 líneas |
| **Total estimado líneas** | **~468 líneas** |
| Chained PRs recommended | Sí (backend / frontend) |
| 400-line budget risk | High |
| Decision needed before apply | Sí — elegir si PR único o PR backend + PR frontend |

### Recomendación de entrega

Dividir en dos PRs encadenados:

**PR 1 — Backend (T-001 a T-006):** ~223 líneas. Incluye `SyncOrchestrator`, decorator, emit calls, SSE endpoint y POST refactor. El backend queda funcional y testeable con `curl`.

**PR 2 — Frontend (T-007 a T-010):** ~245 líneas. Todos los cambios de frontend. Depende de PR 1 para poder probar end-to-end.
