# Proposal: US-015 — SyncOrchestrator + SSE + UI de progreso para sync Binance

## Intent

Hoy la sync de Binance es fire-and-forget: el frontend hace `POST /api/sync/:walletId`, espera un JSON final y no tiene visibilidad de qué paso se está ejecutando. En syncs largas (primer sync con historial extenso) el usuario ve un spinner genérico durante minutos sin feedback. Peor aún, no hay protección contra lanzar dos syncs simultáneas para la misma wallet — lo cual puede causar duplicados o conflictos en `sync_runs`.

US-015 resuelve tres problemas de una vez:

1. **Concurrencia**: un `SyncOrchestrator` singleton con lock in-memory por wallet impide syncs simultáneas.
2. **Progreso en tiempo real**: un endpoint SSE (`GET /api/sync/:walletId/stream`) emite eventos paso a paso (fiat → deposits → withdrawals → converts → trades) con contadores de items sincronizados.
3. **UI de progreso**: un componente `SyncProgress` reemplaza el spinner genérico con una lista de pasos con estados visuales y soporte para cancel/retry.

## Scope

### In scope

| Acción | Archivo | Descripción |
|--------|---------|-------------|
| Crear | `apps/backend/src/services/sync-orchestrator.ts` | Singleton: Map de locks, `tryAcquireLock`, `releaseLock`, `runForWallet` |
| Crear | `apps/backend/src/routes/sync-stream.ts` | `GET /api/sync/:walletId/stream` — SSE endpoint |
| Modificar | `apps/backend/src/routes/sync.ts` | Refactor POST para usar SyncOrchestrator con emit no-op |
| Modificar | `apps/backend/src/index.ts` | Registrar SyncOrchestrator como decorator + registrar ruta SSE + startup cleanup |
| Crear | `apps/frontend/src/hooks/settings/useSyncStream.ts` | Hook EventSource: steps, status, cancel(), retry() |
| Crear | `apps/frontend/src/components/settings/SyncProgress.tsx` | Componente visual de pasos con estados |
| Modificar | `apps/frontend/src/components/settings/ExchangeAccountsSection.tsx` | Integrar `useSyncStream` para CEX wallets |

### Out of scope

- Cambios a la tabla `sync_runs` o migraciones DB — ya existe todo lo necesario de US-018
- SSE para on-chain sync — se puede agregar después con la misma infra
- Autenticación SSE vía query param/token — se usa la cookie JWT existente via `withCredentials`
- Tests — el usuario optó explícitamente por no incluir TDD/tests en este cambio

## Approach

1. **SyncOrchestrator** — Clase singleton con `Map<string, AbortController>`. `tryAcquireLock(walletId)` retorna un `AbortController` si no hay lock activo, o `null` si la wallet ya está sincronizando. `runForWallet` delega a `BinanceSyncService.sync()` o `OnChainSyncService.sync()` pasando un `SyncEmitter` y el `AbortSignal` del controller. Se registra como Fastify decorator para acceso desde cualquier ruta.

2. **SSE Endpoint** (`GET /api/sync/:walletId/stream`) — Protegido por el hook JWT global (la cookie se envía automáticamente con EventSource). Valida ownership de la wallet, intenta adquirir lock (409 si ya locked), configura headers SSE (`text/event-stream`, `no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`). Llama `runForWallet` con un `emit` que escribe `reply.raw.write(data: JSON\n\n)`. Al desconectarse el cliente, el `AbortSignal` cancela la sync y se libera el lock. Al completar, envía evento `complete` con el summary y cierra la conexión.

3. **Refactor POST** — El POST existente pasa por el mismo `SyncOrchestrator.runForWallet` con un `emit = () => {}` no-op. Comparte el lock: si hay un SSE activo, el POST recibe 409. Esto elimina la posibilidad de conflictos.

4. **Startup cleanup** — Al arrancar el servidor, `DELETE FROM sync_runs WHERE status = 'running'` limpia runs huérfanos de crashes anteriores. Ya existe `cleanupStaleRuns` en `sync-run-helper.ts` — solo falta invocarlo en `buildServer()`.

5. **Frontend hook** (`useSyncStream`) — Abre `EventSource` con `withCredentials: true` hacia `/api/sync/:walletId/stream`. Parsea los eventos SSE y mantiene un array de `StepState[]` con transiciones `pending → running → done/skipped/error`. Expone `cancel()` (cierra EventSource, lo que dispara el abort server-side) y `retry()` (crea nueva conexión). Gestiona reconexión automática del EventSource deshabilitándola tras error (para evitar retry infinito).

6. **SyncProgress component** — Recibe la config de steps y los estados del hook. Renderiza una lista vertical con iconos por estado: gris (pending), spinner (running), check verde (done), skip gris (skipped), X roja (error). Botón "Cancelar" durante sync, botón "Reintentar" tras error.

## Risks

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| EventSource + cookies httpOnly | Si el browser no envía la cookie, el SSE falla con 401 | EventSource respeta `withCredentials: true` — funciona con SameSite=Strict en same-origin. Fallback: POST legacy sigue funcionando |
| Fastify raw response (`reply.raw.write`) | Mezclar `reply.send()` y `reply.raw.write()` rompe Fastify | Después de cambiar a raw, NUNCA usar `reply.send()`. Marcar `reply.hijack()` o simplemente no retornar. Documentar en el código |
| Map de locks se pierde en restart | Si el server muere durante una sync, el lock in-memory desaparece | `cleanupStaleRuns()` al startup limpia `sync_runs` con `status='running'`. El Map arranca vacío → no hay locks fantasma |
| SSE buffering por proxy/nginx | Un reverse proxy puede bufferear los chunks SSE | Headers `X-Accel-Buffering: no` + `Cache-Control: no-cache`. En dev no hay proxy |
| Abort signal no cancela queries pg | Las queries SQL en curso no se abortan con el signal | Aceptable: cada paso de sync es relativamente rápido. El signal se chequea entre pasos, no intra-paso |

## Non-goals

- **Multi-wallet sync paralelo**: US-015 sincroniza una wallet a la vez. Orquestar sync de todas las wallets simultáneamente es un feature aparte.
- **Persistencia del progreso SSE**: si el usuario recarga la página durante una sync, pierde la vista de progreso (la sync sigue server-side y commitea normalmente).
- **SSE para on-chain wallets**: la infra lo soporta, pero la integración específica con `OnChainSyncService` queda fuera.
- **WebSocket**: SSE es suficiente para un flujo unidireccional server→client. No hay necesidad de bidireccionalidad.
- **Retry automático de pasos fallidos**: si un paso falla, la sync entera falla (atomicidad por run). El usuario puede reintentar manualmente.
