# Delta Spec: US-015 — SyncOrchestrator + SSE + UI de Progreso para Sync Binance

> **Área:** Sincronización Binance — Concurrencia, Progreso en Tiempo Real, UI de Pasos  
> **Estado del sistema actual:** La sync de Binance es fire-and-forget. El frontend hace `POST /api/sync/:walletId`, espera un JSON final con el resultado, y no hay protección contra syncs concurrentes para la misma wallet.

---

## ADDED Requirements

---

### Requirement: Lock de Concurrencia por Wallet

El sistema MUST mantener un único lock in-memory por `walletId` que impida iniciar dos operaciones de sync simultáneas para la misma wallet, independientemente de si el disparador es el endpoint SSE o el endpoint POST.

El lock MUST ser representado internamente como un `Map<string, AbortController>` gestionado por el `SyncOrchestrator` singleton.

Intentar adquirir el lock MUST retornar el `AbortController` si la wallet no está siendo sincronizada, o `null` si ya hay una sync activa.

Liberar el lock MUST eliminar la entrada del `Map` y hacer `abort()` en el `AbortController` si la operación fue cancelada externamente.

#### Scenario: Lock disponible — adquisición exitosa

- GIVEN que no existe ninguna sync activa para `walletId = "wallet-123"`
- WHEN el sistema intenta adquirir el lock para `wallet-123`
- THEN el sistema MUST retornar un `AbortController` válido
- AND la wallet queda registrada como "en sync"

#### Scenario: Lock ocupado — adquisición fallida

- GIVEN que ya existe una sync activa para `walletId = "wallet-123"`
- WHEN el sistema intenta adquirir nuevamente el lock para `wallet-123`
- THEN el sistema MUST retornar `null`
- AND la sync en curso NO DEBE ser interrumpida

#### Scenario: Liberación de lock tras sync completada

- GIVEN que existe un lock activo para `walletId = "wallet-123"`
- WHEN la sync finaliza (con éxito o con error)
- THEN el sistema MUST liberar el lock eliminando la entrada del Map
- AND una nueva adquisición del lock para `wallet-123` DEBE ser posible inmediatamente

---

### Requirement: SyncOrchestrator como Decorator de Fastify

El `SyncOrchestrator` singleton MUST estar disponible en toda la aplicación Fastify a través de un decorator registrado en el setup del servidor (`buildServer()`).

El método `runForWallet(walletId, userId, emit, signal)` MUST:
- Resolver el tipo de wallet (CEX vs on-chain) y delegar al servicio de sync correspondiente
- Aceptar una función `emit` que recibe eventos de progreso tipados
- Aceptar un `AbortSignal` para permitir cancelación entre pasos

---

### Requirement: Endpoint SSE de Progreso de Sync

El sistema MUST exponer el endpoint `GET /api/sync/:walletId/stream` que transmite el progreso de una sync Binance en tiempo real usando Server-Sent Events (SSE).

El endpoint MUST:
- Estar protegido por el hook JWT global (cookie `token` enviada automáticamente con `withCredentials`)
- Validar que el `walletId` pertenece al usuario autenticado antes de iniciar la sync
- Configurar los headers HTTP correctos para SSE antes de escribir cualquier dato

Los headers MUST incluir:
- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `Connection: keep-alive`
- `X-Accel-Buffering: no`

#### Scenario: Inicio exitoso del stream SSE

- GIVEN que el usuario autenticado es dueño de `walletId = "wallet-123"`
- AND no existe ninguna sync activa para `wallet-123`
- WHEN el cliente hace `GET /api/sync/wallet-123/stream`
- THEN el servidor MUST responder con HTTP 200 y headers SSE
- AND comenzar a emitir eventos de progreso para cada paso de la sync

#### Scenario: Wallet sin autorización

- GIVEN que `walletId = "wallet-456"` pertenece a otro usuario
- WHEN el cliente autenticado hace `GET /api/sync/wallet-456/stream`
- THEN el servidor MUST responder con HTTP 403
- AND NO DEBE iniciar ninguna sync

#### Scenario: Sync ya en curso para la wallet

- GIVEN que ya existe una sync activa para `walletId = "wallet-123"`
- WHEN un segundo cliente hace `GET /api/sync/wallet-123/stream`
- THEN el servidor MUST responder con HTTP 409
- AND el body DEBE contener `{ "error": "SYNC_IN_PROGRESS" }`
- AND la sync activa NO DEBE ser interrumpida

#### Scenario: Desconexión del cliente durante la sync

- GIVEN que el cliente está recibiendo eventos SSE de una sync en curso
- WHEN el cliente cierra la conexión (navega, cancela, cierra tab)
- THEN el servidor MUST detectar la desconexión
- AND abortar la sync usando el `AbortSignal`
- AND liberar el lock de la wallet

---

### Requirement: Contrato de Eventos SSE

El sistema MUST emitir eventos SSE usando el formato `data: <JSON>\n\n`.

El contrato de tipos de eventos es:

| Tipo de evento | Cuándo se emite |
|---|---|
| `{ step, status: "running" }` | Al comenzar cada paso |
| `{ step, status: "done", synced, skipped }` | Al completar un paso exitosamente |
| `{ step, status: "skipped", reason }` | Cuando un paso se omite (ej: no hay API key) |
| `{ step: "error", failedStep, code, message }` | Cuando un paso falla irrecuperablemente |
| `{ step: "complete", status: "done", summary }` | Al finalizar todos los pasos con éxito |

Los valores de `step` para una wallet CEX Binance MUST ser: `"fiat"`, `"deposits"`, `"withdrawals"`, `"converts"`, `"trades"`.

El campo `summary` del evento `complete` MUST contener el mismo `BinanceSyncResult` que retorna actualmente el endpoint POST.

#### Scenario: Secuencia de eventos para sync exitosa

- GIVEN que el cliente está conectado al stream SSE de `wallet-123`
- WHEN la sync se ejecuta sin errores
- THEN el servidor MUST emitir eventos en este orden:
  1. `{ step: "fiat", status: "running" }`
  2. `{ step: "fiat", status: "done", synced: N, skipped: M }`
  3. `{ step: "deposits", status: "running" }`
  4. `{ step: "deposits", status: "done", synced: N, skipped: M }`
  5. *(idem para "withdrawals", "converts", "trades")*
  6. `{ step: "complete", status: "done", summary: { ... } }`
- AND el servidor MUST cerrar la conexión SSE después del evento `complete`

#### Scenario: Error en un paso intermedio

- GIVEN que el cliente está conectado al stream SSE de `wallet-123`
- WHEN el paso `"converts"` falla con un error
- THEN el servidor MUST emitir `{ step: "error", failedStep: "converts", code: "...", message: "..." }`
- AND el servidor MUST cerrar la conexión SSE
- AND el lock de la wallet DEBE ser liberado
- AND NO DEBE emitirse el evento `complete`

#### Scenario: Paso omitido por configuración faltante

- GIVEN que la wallet no tiene `api_key` configurada para un tipo de operación
- WHEN el `SyncOrchestrator` procesa ese paso
- THEN el servidor MUST emitir `{ step: "fiat", status: "skipped", reason: "..." }`
- AND continuar con el siguiente paso

---

### Requirement: Hook `useSyncStream` en el Frontend

El sistema MUST proveer un hook React `useSyncStream(walletId)` que gestione el ciclo de vida completo de una conexión SSE hacia `/api/sync/:walletId/stream`.

El hook MUST exponer:
- `steps: StepState[]` — array con el estado actual de cada paso conocido
- `status: "idle" | "syncing" | "done" | "error"` — estado general del proceso
- `error: { code, message } | null` — detalle del error si `status === "error"`
- `summary: BinanceSyncResult | null` — resultado final cuando `status === "done"`
- `cancel()` — cierra el `EventSource` (lo que dispara el abort server-side)
- `retry()` — crea una nueva conexión SSE (solo disponible cuando `status === "error"`)

El hook MUST:
- Deshabilitar el retry automático del `EventSource` nativo tras recibir un evento de error para evitar bucles infinitos
- Cerrar el `EventSource` cuando el componente se desmonta

#### Scenario: Inicio del hook y apertura del stream

- GIVEN que el componente que usa `useSyncStream("wallet-123")` se monta
- WHEN el hook se inicializa
- THEN DEBE abrir una conexión `EventSource` con `withCredentials: true` hacia `/api/sync/wallet-123/stream`
- AND el estado inicial DEBE ser `{ status: "syncing", steps: [] }`

#### Scenario: Actualización de pasos al recibir eventos

- GIVEN que el hook está conectado al stream SSE
- WHEN llega el evento `{ step: "deposits", status: "running" }`
- THEN el hook MUST actualizar el array `steps` para que el paso `"deposits"` figure con estado `"running"`
- AND el resto de los pasos NO DEBEN cambiar de estado

#### Scenario: Transición a estado "done" al recibir "complete"

- GIVEN que el hook está recibiendo eventos SSE
- WHEN llega el evento `{ step: "complete", status: "done", summary: { ... } }`
- THEN el hook MUST:
  - Actualizar `status` a `"done"`
  - Poblar `summary` con el resultado
  - Cerrar la conexión `EventSource`

#### Scenario: Cancelación por el usuario

- GIVEN que `status === "syncing"`
- WHEN el usuario invoca `cancel()`
- THEN el hook MUST cerrar el `EventSource`
- AND actualizar `status` a `"idle"`

#### Scenario: Retry tras error

- GIVEN que `status === "error"`
- WHEN el usuario invoca `retry()`
- THEN el hook MUST abrir una nueva conexión `EventSource`
- AND reiniciar `steps` al estado inicial
- AND actualizar `status` a `"syncing"`

---

### Requirement: Componente `SyncProgress`

El sistema MUST proveer un componente React `SyncProgress` que renderice visualmente el progreso de una sync CEX usando los datos del hook `useSyncStream`.

El componente MUST mostrar una lista vertical de pasos, donde cada paso tiene un estado visual diferenciado:

| Estado del paso | Representación visual |
|---|---|
| `pending` | Icono gris neutro |
| `running` | Spinner animado |
| `done` | Check verde con contadores `synced` y `skipped` |
| `skipped` | Icono gris con label descriptivo de razón |
| `error` | X roja con mensaje de error |

El componente MUST mostrar un botón **"Cancelar"** cuando `status === "syncing"`.

El componente MUST mostrar un botón **"Reintentar"** cuando `status === "error"`.

El componente MUST mostrar un resumen de la sync cuando `status === "done"`.

#### Scenario: Render durante sync en curso

- GIVEN que `status === "syncing"` y el paso `"deposits"` está en `"running"`
- WHEN se renderiza `SyncProgress`
- THEN el paso `"deposits"` DEBE mostrar un spinner animado
- AND los pasos previos completados DEBEN mostrar check verde
- AND los pasos aún no iniciados DEBEN mostrarse en estado `pending` (gris)
- AND el botón "Cancelar" DEBE estar visible y habilitado

#### Scenario: Render tras error

- GIVEN que `status === "error"` con `failedStep = "converts"`
- WHEN se renderiza `SyncProgress`
- THEN el paso `"converts"` DEBE mostrar X roja con el mensaje de error
- AND el botón "Reintentar" DEBE estar visible
- AND el botón "Cancelar" NO DEBE estar visible

#### Scenario: Render tras sync completada

- GIVEN que `status === "done"` con `summary` disponible
- WHEN se renderiza `SyncProgress`
- THEN todos los pasos ejecutados DEBEN mostrar check verde
- AND el resumen de la sync DEBE estar visible
- AND los botones "Cancelar" y "Reintentar" NO DEBEN estar visibles

---

## MODIFIED Requirements

---

### Requirement: Endpoint POST de Sync Binance usa SyncOrchestrator

El endpoint existente `POST /api/sync/:walletId` MUST ser refactorizado para delegar la ejecución al `SyncOrchestrator`, usando una función `emit` vacía (no-op).

El comportamiento observable desde el cliente MUST permanecer idéntico:
- Responde con el mismo formato JSON `BinanceSyncResult`
- Devuelve 409 si hay una sync SSE activa para la misma wallet (lock compartido)

El POST y el SSE MUST compartir el mismo lock. Si hay un SSE activo para `wallet-123`, el POST para la misma wallet DEBE recibir HTTP 409.

(Anteriormente: el POST ejecutaba la sync directamente sin verificar concurrencia.)

#### Scenario: POST bloqueado por SSE activo

- GIVEN que existe una sync SSE activa para `walletId = "wallet-123"`
- WHEN el mismo (o cualquier) cliente hace `POST /api/sync/wallet-123`
- THEN el servidor MUST responder con HTTP 409
- AND el body DEBE contener `{ "error": "SYNC_IN_PROGRESS" }`
- AND la sync SSE activa NO DEBE ser interrumpida

#### Scenario: POST sin SSE activo — comportamiento sin cambios

- GIVEN que no hay ninguna sync activa para `walletId = "wallet-123"`
- WHEN el cliente hace `POST /api/sync/wallet-123`
- THEN el servidor MUST ejecutar la sync y responder con HTTP 200 y el `BinanceSyncResult`
- AND el formato de respuesta DEBE ser idéntico al comportamiento pre-US-015

---

### Requirement: SettingsPage usa `useSyncStream` para wallets CEX

La sección de cuentas de exchange en `ExchangeAccountsSection` MUST reemplazar la UI de sync genérica por el componente `SyncProgress` cuando la wallet es de tipo `CEX_BINANCE`.

La integración SHOULD mantener `useSyncWallet` como fallback para wallets on-chain donde el SSE no está disponible aún.

(Anteriormente: toda sync mostraba un spinner genérico sin feedback de pasos.)

#### Scenario: Trigger de sync CEX desde Settings

- GIVEN que el usuario está en la página de Settings con una wallet CEX Binance configurada
- WHEN el usuario presiona el botón "Sincronizar"
- THEN el componente MUST renderizar `SyncProgress` con los pasos de la sync CEX
- AND los pasos DEBEN actualizarse en tiempo real a medida que el servidor emite eventos SSE

---

## MODIFIED: Comportamiento al Startup del Servidor

### Requirement: Limpieza de sync_runs huérfanos al iniciar

Al iniciar el servidor, el sistema MUST ejecutar una limpieza de registros `sync_runs` con `status = 'running'` que hayan quedado en ese estado por un crash previo.

(Anteriormente: los registros huérfanos permanecían en `status = 'running'` indefinidamente, generando inconsistencias en el historial de syncs.)

#### Scenario: Startup con runs huérfanos

- GIVEN que la base de datos contiene 2 registros en `sync_runs` con `status = 'running'` de una sesión anterior
- WHEN el servidor inicia (`buildServer()`)
- THEN el sistema MUST actualizar esos registros a `status = 'failed'` (o eliminarlos, según la implementación de `cleanupStaleRuns`)
- AND el Map de locks DEBE arrancar vacío
- AND el servidor DEBE continuar su inicio normal sin error

---

## REMOVED Requirements

*(No se eliminan requisitos existentes en este cambio.)*

---

## Non-Goals (Documentados para evitar scope creep)

- SSE para on-chain wallets (queda fuera de US-015)
- Retry automático de pasos individuales fallidos (la sync falla como unidad)
- Persistencia del estado de progreso si el usuario recarga la página durante la sync
- Multi-wallet sync paralelo desde la UI
- Autenticación SSE vía query param (se usa cookie JWT existente)
