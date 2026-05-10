# Design: US-015 — SyncOrchestrator + SSE + UI de Progreso para Sync Binance

## Enfoque Técnico

Se introduce un `SyncOrchestrator` singleton registrado como Fastify decorator que centraliza el control de concurrencia y ejecución de syncs. Un nuevo endpoint SSE (`GET /api/sync/:walletId/stream`) usa `reply.raw` para hacer streaming de eventos de progreso hacia el frontend. El POST existente se refactoriza mínimamente para pasar por el orchestrator compartiendo el lock. En el frontend, un hook `useSyncStream` gestiona el ciclo de vida del `EventSource`, y un componente `SyncProgress` renderiza los pasos con estados visuales.

---

## Decisiones de Arquitectura

### Decisión 1: Ubicación del SyncOrchestrator

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Clase en `services/sync-orchestrator.ts`, registrada como Fastify decorator | Accesible desde cualquier ruta via `fastify.syncOrchestrator`. Lifecycle atado al servidor | **ELEGIDA** |
| Módulo singleton exportado directamente | Más simple, pero no participa del lifecycle de Fastify. Difícil de mockear en tests | Descartada |
| Plugin Fastify con encapsulación | Over-engineering: no necesitamos encapsulación, es un singleton global | Descartada |

**Rationale**: El decorator es el patrón Fastify estándar para singletons (como `pool`, `jwt`). Queda disponible en `request.server.syncOrchestrator` sin imports circulares. El constructor recibe `Pool` y `log` — no deps adicionales.

### Decisión 2: SSE — reply.raw vs reply.sse plugin

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| `reply.raw.write()` manual con `reply.hijack()` | Control total del streaming. Requiere gestionar headers y cierre manualmente. No depende de plugins externos | **ELEGIDA** |
| `@fastify/sse` plugin | Abstrae el formato SSE. Agrega dependencia, y aún necesita raw handling para el close. Poco mantenido | Descartada |
| WebSocket | Bidireccional innecesario. Más complejo (upgrade, ping/pong). EventSource es más simple para server→client | Descartada |

**Rationale**: `reply.hijack()` es la API Fastify oficial para "tomo control del socket, no llames send()". Con solo ~15 líneas helper para formatear SSE, no se justifica un plugin externo.

### Decisión 3: Cleanup de sync_runs al startup — DELETE vs UPDATE

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| `DELETE FROM sync_runs WHERE status = 'running'` (actual) | Ya implementado y testeado en `cleanupStaleRuns`. Consistente con `rollback()` que también hace DELETE. No deja "fantasmas" en historial | **ELEGIDA — mantener** |
| `UPDATE sync_runs SET status = 'failed' WHERE status = 'running'` | Preserva historial, pero runs huérfanos nunca completaron su trabajo — el registro no aporta valor real. Además rompe el invariante actual donde solo `completed` sobrevive | Descartada |

**Rationale**: El sistema ya opera con el invariante de que `rollback()` DELETE-a el run y solo runs exitosos persisten (`status='completed'`). Cambiar a UPDATE introduciría un tercer estado (`failed`) sin beneficio real para un proyecto single-user. El `cleanupStaleRuns` existente ya funciona y tiene test — no se toca.

### Decisión 4: SSE endpoint — nueva ruta separada vs mismo archivo sync.ts

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Agregar GET handler en el mismo `sync.ts` | Un solo archivo con POST y GET para `/api/sync/:walletId`. Mantiene la cohesión por recurso. El archivo no crece demasiado (~50 líneas extra) | **ELEGIDA** |
| Archivo separado `sync-stream.ts` | Más separación. Pero requiere registrar otro plugin, y duplica el import de schemas/validación de ownership | Descartada |

**Rationale**: El GET y el POST operan sobre el mismo recurso (`/api/sync/:walletId`). Colocarlos en el mismo plugin evita duplicar la validación de ownership y acceso al orchestrator.

### Decisión 5: Gestión de reconexión del EventSource

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Cerrar el EventSource al recibir `error` o `complete`, impidiendo auto-reconnect | Sin retry automático. El usuario controla con botón "Reintentar". Predecible | **ELEGIDA** |
| Permitir auto-reconnect nativo del EventSource | Podría relanzar la sync involuntariamente si el server respondió 200 pero la conexión se cortó entre eventos | Descartada |

**Rationale**: El EventSource nativo re-intenta indefinidamente en caso de error de red. Para un flujo que tiene efectos secundarios (escribe en DB), no queremos reconexiones implícitas. El hook cierra el EventSource manualmente (`eventSource.close()`) en `onerror` y en `complete`.

---

## Flujo de Datos

### Diagrama de secuencia: SSE sync flow

```
┌──────────┐         ┌──────────────┐      ┌─────────────────┐     ┌───────────────────┐
│ Browser  │         │ Fastify      │      │ SyncOrchestrator│     │ BinanceSyncService│
│(EventSrc)│         │ GET handler  │      │   (decorator)   │     │                   │
└────┬─────┘         └──────┬───────┘      └────────┬────────┘     └─────────┬─────────┘
     │  GET /stream          │                       │                       │
     │──────────────────────>│                       │                       │
     │                       │  tryAcquireLock()     │                       │
     │                       │──────────────────────>│                       │
     │                       │  AbortController | null                       │
     │                       │<──────────────────────│                       │
     │                       │                       │                       │
     │   200 + SSE headers   │                       │                       │
     │<──────────────────────│                       │                       │
     │                       │                       │                       │
     │                       │  sync(walletId, userId, { emit, signal })     │
     │                       │──────────────────────────────────────────────>│
     │                       │                       │                       │
     │  data: {step:"fiat",  │                       │    emit({step,status})│
     │   status:"running"}   │<──────────────────────────────────────────────│
     │<──────────────────────│                       │                       │
     │                       │                       │                       │
     │  data: {step:"fiat",  │                       │  emit({step,status,   │
     │   status:"done",...}  │<─────────────────────────── synced, skipped})│
     │<──────────────────────│                       │                       │
     │                       │                       │                       │
     │        ...            │     (repeat per step) │                       │
     │                       │                       │                       │
     │  data: {step:         │                       │                       │
     │   "complete",...}     │  ←── return result ───────────────────────────│
     │<──────────────────────│                       │                       │
     │                       │  releaseLock()        │                       │
     │  (connection closed)  │──────────────────────>│                       │
     │                       │                       │                       │

     ── Cancel flow (client disconnects) ──

     │  (close connection)   │                       │                       │
     │──────────X            │                       │                       │
     │                       │  req.raw 'close'      │                       │
     │                       │──┐ abort()            │                       │
     │                       │  │────────────────────>│ signal.aborted=true  │
     │                       │  │                    │                       │
     │                       │  │  releaseLock()     │  checkAborted() throws│
     │                       │  │───────────────────>│                       │
```

### Flujo POST refactorizado

```
Browser ──POST /api/sync/:walletId──> Fastify POST handler
  │                                        │
  │                         tryAcquireLock()│──> SyncOrchestrator
  │                                        │      │
  │                         (null → 409)   │<─────│ (lock ocupado)
  │                         (AC   → sync)  │<─────│ (lock libre)
  │                                        │
  │                     BinanceSyncService.sync(emit: noop, signal)
  │                                        │
  │                     releaseLock()       │──> SyncOrchestrator
  │   <───── 200 JSON (BinanceSyncResult)──│
```

---

## Cambios en Archivos

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `apps/backend/src/services/sync-orchestrator.ts` | **CREAR** | Clase SyncOrchestrator con lock Map, tryAcquireLock, releaseLock |
| `apps/backend/src/routes/sync.ts` | **MODIFICAR** | Agregar GET `/:walletId/stream` (SSE). Refactorizar POST para usar orchestrator + lock |
| `apps/backend/src/index.ts` | **MODIFICAR** | Instanciar SyncOrchestrator, registrar como decorator |
| `apps/frontend/src/hooks/settings/useSyncStream.ts` | **CREAR** | Hook React para EventSource lifecycle |
| `apps/frontend/src/components/settings/SyncProgress.tsx` | **CREAR** | Componente presentacional de pasos |
| `apps/frontend/src/components/settings/ExchangeAccountsSection.tsx` | **MODIFICAR** | Integrar useSyncStream + SyncProgress en CexWalletRow |
| `apps/frontend/src/types/settings.ts` | **MODIFICAR** | Agregar tipos SSE (StepName, StepStatus, StepState, SyncStreamState) |

---

## Interfaces / Contratos

### Backend: SyncOrchestrator (`services/sync-orchestrator.ts`)

```typescript
import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';

export class SyncOrchestrator {
  // In-memory lock: walletId → AbortController
  private locks: Map<string, AbortController>;

  constructor(private pool: Pool, private log: FastifyBaseLogger);

  /**
   * Intenta adquirir un lock exclusivo para la wallet.
   * Retorna un AbortController si exitoso, null si ya hay sync activa.
   */
  tryAcquireLock(walletId: string): AbortController | null;

  /**
   * Libera el lock de la wallet. Idempotente.
   */
  releaseLock(walletId: string): void;

  /**
   * Retorna true si la wallet tiene un lock activo.
   */
  isLocked(walletId: string): boolean;
}
```

**Notas de implementación:**
- `tryAcquireLock` crea un `new AbortController()`, lo guarda en el Map, y lo retorna. Si la key ya existe retorna `null`.
- `releaseLock` hace `delete` del Map. NO hace `abort()` — el abort lo controla el caller (el handler SSE en `req.raw.on('close')`).
- La clase NO ejecuta la sync — solo gestiona locks. El handler de ruta llama a `BinanceSyncService.sync()` directamente pasando el `signal` del `AbortController`.

### Backend: Fastify decorator type augmentation

```typescript
// En sync-orchestrator.ts (al final del archivo)
declare module 'fastify' {
  interface FastifyInstance {
    syncOrchestrator: SyncOrchestrator;
  }
}
```

### Backend: SSE event format

Cada evento es una línea `data: <JSON>\n\n` (formato SSE estándar). No se usa el campo `event:` ni `id:` — todo va en `data`.

```typescript
// Tipos de evento emitidos por el emit callback
type SseStepRunning = {
  step: 'fiat' | 'deposits' | 'withdrawals' | 'converts' | 'trades';
  status: 'running';
};

type SseStepDone = {
  step: 'fiat' | 'deposits' | 'withdrawals' | 'converts' | 'trades';
  status: 'done';
  synced: number;
  skipped: number;
};

type SseStepSkipped = {
  step: 'fiat' | 'deposits' | 'withdrawals' | 'converts' | 'trades';
  status: 'skipped';
  reason: string;
};

type SseError = {
  step: 'error';
  failedStep: string;
  code: string;
  message: string;
};

type SseComplete = {
  step: 'complete';
  status: 'done';
  summary: BinanceSyncResult;
};

type SseEvent = SseStepRunning | SseStepDone | SseStepSkipped | SseError | SseComplete;
```

### Backend: SSE helper (inline en sync.ts)

```typescript
function writeSse(raw: import('node:http').ServerResponse, data: Record<string, unknown>): void {
  raw.write(`data: ${JSON.stringify(data)}\n\n`);
}
```

### Backend: GET handler — estructura clave

```typescript
// GET /:walletId/stream
fastify.get('/:walletId/stream', { schema: { params: SyncParamsSchema } }, async (req, reply) => {
  const userId = (req.user as { sub?: string }).sub ?? '';

  // 1. Validar ownership (misma query que POST)
  const wallet = await validateWalletOwnership(req.params.walletId, userId);

  // 2. Intentar adquirir lock
  const orchestrator = req.server.syncOrchestrator;
  const ac = orchestrator.tryAcquireLock(req.params.walletId);
  if (!ac) {
    return reply.status(409).send({ error: 'SYNC_IN_PROGRESS' });
  }

  // 3. Hijack — Fastify no gestionará más esta respuesta
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // 4. Cleanup al desconectarse el cliente
  let clientDisconnected = false;
  req.raw.on('close', () => {
    clientDisconnected = true;
    ac.abort();
    orchestrator.releaseLock(req.params.walletId);
  });

  // 5. Crear emit callback
  const emit: SyncEmitter = (event) => {
    if (!clientDisconnected) writeSse(raw, event);
  };

  // 6. Ejecutar sync
  try {
    // (crear BinanceSyncService igual que en POST)
    const result = await binanceService.sync(walletId, userId, { emit, signal: ac.signal });
    if (!clientDisconnected) {
      writeSse(raw, { step: 'complete', status: 'done', summary: result });
      raw.end();
    }
  } catch (err) {
    if (!clientDisconnected) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message !== 'ABORTED') {
        writeSse(raw, { step: 'error', failedStep: 'unknown', code: 'SYNC_ERROR', message });
      }
      raw.end();
    }
  } finally {
    orchestrator.releaseLock(req.params.walletId);
  }
});
```

### Backend: POST handler refactorizado — cambios mínimos

```typescript
// En el POST existente, agregar:
// 1. Adquirir lock (409 si ocupado)
// 2. Pasar emit no-op + signal al BinanceSyncService
// 3. Liberar lock en finally
```

La query `validateWalletOwnership` se extrae como función privada reutilizable dentro del plugin scope.

### Backend: Integración en index.ts

```typescript
// Después de registrar auth plugins, antes de registrar rutas:
import { SyncOrchestrator } from './services/sync-orchestrator.js';

const syncOrchestrator = new SyncOrchestrator(pool, fastify.log);
fastify.decorate('syncOrchestrator', syncOrchestrator);
```

**Problema**: `buildServer()` actualmente no recibe `pool` — usa el singleton importado. El decorator se registra usando el mismo singleton `pool` importado desde `db/pool.ts`. No se necesita cambiar la firma de `buildServer()`.

### Backend: Emit en BinanceSyncService — uso actual

El `BinanceSyncService.sync()` ya acepta `opts?.emit` como `SyncEmitter` y `opts?.signal` como `AbortSignal`. Lo que falta es que el servicio LLAME a `emit` con los eventos de progreso en cada paso. Actualmente solo tiene logs.

**Cambio requerido en `binance-sync.ts`**: Agregar llamadas `emit` antes y después de cada paso:

```typescript
// Antes de cada paso:
opts?.emit?.({ step: 'fiat', status: 'running' });
const fiatResult = await this.syncFiat(...);
opts?.emit?.({ step: 'fiat', status: 'done', synced: fiatResult, skipped: 0 });
this.checkAborted(opts?.signal);
```

Este es un cambio mecánico — 10 líneas intercaladas entre los pasos existentes.

**Archivo adicional afectado**: `apps/backend/src/services/binance-sync.ts` (MODIFICAR — agregar emit calls).

### Frontend: Tipos SSE (`types/settings.ts`)

```typescript
// ── SSE sync stream types ─────────────────────────────────────────────────────
export const SYNC_STEPS = ['fiat', 'deposits', 'withdrawals', 'converts', 'trades'] as const;
export type SyncStepName = (typeof SYNC_STEPS)[number];

export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error';

export interface StepState {
  name: SyncStepName;
  status: StepStatus;
  synced?: number;
  skipped?: number;
  reason?: string;    // para 'skipped'
  error?: string;     // para 'error'
}

export type SyncStreamStatus = 'idle' | 'connecting' | 'syncing' | 'done' | 'error';

export interface SyncStreamState {
  status: SyncStreamStatus;
  steps: StepState[];
  error: { code: string; message: string } | null;
  summary: CexSyncResult | null;
}
```

### Frontend: Hook `useSyncStream` (`hooks/settings/useSyncStream.ts`)

```typescript
export interface UseSyncStreamResult {
  state: SyncStreamState;
  start: () => void;       // Abre la conexión SSE
  cancel: () => void;      // Cierra EventSource (dispara abort server-side)
  retry: () => void;       // Equivale a cancel + start
}

export function useSyncStream(walletId: string): UseSyncStreamResult;
```

**Lógica interna clave:**
- `start()` crea `new EventSource(url, { withCredentials: true })` y guarda en ref.
- `onmessage` parsea `event.data` como JSON, actualiza `steps[]` y `status` según el tipo de evento.
- `onerror` cierra el EventSource inmediatamente (para evitar auto-reconnect), y si no fue un cancel deliberado, pone status en `error`.
- `cancel()` llama `eventSource.close()` y pone status en `idle`.
- Cleanup en `useEffect` return cierra el EventSource al desmontar.
- El hook NO abre conexión automáticamente al montar. Se dispara con `start()`.

**URL del EventSource:**
```typescript
const url = `${BASE_URL}/api/sync/${walletId}/stream`;
```

Se importa `BASE_URL` de la constante en `api-client.ts` — o se duplica inline como `import.meta.env.VITE_API_URL ?? ''`. Dado que `api-client.ts` no exporta `BASE_URL`, se calcula inline.

### Frontend: Componente `SyncProgress` (`components/settings/SyncProgress.tsx`)

```typescript
interface SyncProgressProps {
  state: SyncStreamState;
  onCancel: () => void;
  onRetry: () => void;
}
```

**Estructura visual:**
- Lista vertical de pasos con label humano (`"Fiat Orders"`, `"Deposits"`, etc.)
- Cada paso muestra icono según `StepStatus`:
  - `pending` → círculo gris
  - `running` → spinner animado (Tailwind `animate-spin`)
  - `done` → check verde + `"N synced, M skipped"`
  - `skipped` → dash gris + razón
  - `error` → X roja + mensaje
- Botón "Cancel" visible cuando `status === 'syncing'`
- Botón "Retry" visible cuando `status === 'error'`
- Resumen inline (reutilizar `SyncResultInline`) cuando `status === 'done'`

**Mapa de labels:**
```typescript
const STEP_LABELS: Record<SyncStepName, string> = {
  fiat: 'Fiat Orders',
  deposits: 'Deposits',
  withdrawals: 'Withdrawals',
  converts: 'Converts',
  trades: 'Trades',
};
```

### Frontend: Integración en ExchangeAccountsSection

El cambio en `CexWalletRow`:

1. Agregar `useSyncStream(wallet.id)` dentro del componente.
2. El botón "Sync" llama `start()` del hook SSE en vez de `sync(wallet.id, 'cex')`.
3. Mientras `state.status` es `'syncing'` o `'done'` o `'error'`, renderizar `<SyncProgress>` en lugar del spinner/resultado actual.
4. Mantener la lógica de `onAfterSync` para refrescar wallets al completar.
5. `useSyncWallet` se mantiene como import — sigue usándose para on-chain wallets en `OnChainWalletsSection`.

---

## Tabla resumen de archivos actualizados

| Archivo | Cambios clave |
|---------|---------------|
| `services/sync-orchestrator.ts` | Clase con `Map<string, AbortController>`, tryAcquireLock, releaseLock, isLocked. Type augmentation de FastifyInstance. ~40 líneas |
| `routes/sync.ts` | Extraer `validateWalletOwnership()`. GET handler SSE (~50 líneas). POST: lock → run → release (~15 líneas delta) |
| `services/binance-sync.ts` | Intercalar `emit()` calls en los 5 pasos + wrap fiat con try/catch para `FiatPermissionDeniedError` → skipped event. ~20 líneas delta |
| `index.ts` | Import SyncOrchestrator, instanciar, `decorate()`. 4 líneas |
| `types/settings.ts` | Agregar SYNC_STEPS, StepState, SyncStreamState. ~25 líneas |
| `hooks/settings/useSyncStream.ts` | Hook con EventSource lifecycle. ~80 líneas |
| `components/settings/SyncProgress.tsx` | Componente presentacional. ~70 líneas |
| `components/settings/ExchangeAccountsSection.tsx` | Reemplazar sync handler en CexWalletRow + condicional SyncProgress. ~20 líneas delta |

---

## Estrategia de Validación

Sin tests formales (per user request), la validación se hace manualmente:

1. **SSE happy path**: Abrir DevTools → Network → EventSource. Verificar que los 5 pasos emiten running→done y termina con `complete`.
2. **Concurrencia**: Abrir dos tabs, disparar sync en ambas → segunda debe recibir 409.
3. **Cancel**: Disparar sync, presionar Cancel → verificar que el EventSource se cierra y el lock se libera (se puede sincronizar de nuevo).
4. **POST fallback**: Hacer `curl POST /api/sync/:walletId` → debe retornar JSON igual que antes. Si hay SSE activo → 409.
5. **Startup cleanup**: Insertar manualmente un `sync_runs` con status `running`, reiniciar server, verificar que se eliminó.
6. **Disconnect mid-sync**: Cerrar tab durante sync activa → verificar en logs que se detecta el abort.
