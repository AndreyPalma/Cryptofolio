# Delta Spec: US-016 — SSE streaming y persistencia por lotes para sync on-chain (ETH/BSC)

## Contexto

`OnChainSyncService` recibe soporte de SSE streaming, persistencia atómica vía `SyncRunHelper` con
rollback CASCADE, y `AbortSignal` para cancelación limpia. El cambio alinea el servicio con el
patrón ya operativo en `BinanceSyncService` (US-015 / US-018), reutilizando la misma infraestructura
de SSE, orquestación y buffer de posiciones.

---

## ADDED Requirements

### Requirement: R-001 — Firma extendida de OnChainSyncService.sync()

`OnChainSyncService.sync()` MUST aceptar un tercer parámetro opcional
`opts?: { emit?: SyncEmitter; signal?: AbortSignal }` sin romper los call-sites existentes que
omiten `opts`.

#### Scenario: Llamada sin opts (backward-compat)
- GIVEN un call-site que invoca `sync(walletId, userId)` sin tercer argumento
- WHEN el servicio procesa la solicitud
- THEN el sync corre sin emitir SSE y sin soporte de abort, completando normalmente

#### Scenario: Llamada con emit y signal
- GIVEN el route handler SSE que pasa `{ emit, signal: ac.signal }`
- WHEN el servicio recibe `opts`
- THEN emite eventos SSE durante cada step y respeta el `AbortSignal`

---

### Requirement: R-002 — Steps on-chain con eventos SSE

El sistema MUST emitir eventos SSE para cada uno de los cuatro steps:
`fetch_normal`, `fetch_tokens`, `classify`, `persist`.

Cada step MUST emitir `{ type: 'step', step, status: 'running' }` al iniciar y
`{ type: 'step', step, status: 'done', synced, skipped }` al finalizar exitosamente.

#### Scenario: Happy path — sync completo con token transfers
- GIVEN una wallet ON_CHAIN con transacciones normales y de tokens pendientes
- WHEN se lanza el sync con `emit` activo
- THEN el sistema emite, en orden:
  1. `step fetch_normal running`
  2. `step fetch_normal done { synced: N, skipped: 0 }`
  3. `step fetch_tokens running`
  4. `step fetch_tokens done { synced: M, skipped: 0 }`
  5. `step classify running`
  6. `step classify done { synced: K, skipped: 0 }`
  7. `step persist running`
  8. Uno o más eventos `batchProgress { done: X, total: K }`
  9. `step persist done { synced: K, skipped: 0 }`
  10. `{ type: 'complete' }`
- AND el cursor de la wallet avanza al último bloque procesado

#### Scenario: Wallet solo-nativa (sin token transfers)
- GIVEN una wallet ON_CHAIN que solo tiene transacciones nativas (ETH/BNB), sin token transfers
- WHEN se ejecuta el sync
- THEN `fetch_tokens` emite `done { synced: 0, skipped: 0 }`
- AND el resto de los steps continúan normalmente
- AND el sync termina con `{ type: 'complete' }` sin error

#### Scenario: Wallet vacía (sin transacciones)
- GIVEN una wallet ON_CHAIN recién registrada sin ninguna transacción en Etherscan/BSCTrace
- WHEN se ejecuta el sync
- THEN todos los steps emiten `done { synced: 0, skipped: 0 }`
- AND el sync termina con `{ type: 'complete' }` sin error
- AND el cursor permanece en su valor inicial (no avanza)

---

### Requirement: R-003 — Persistencia por lotes con ON_CHAIN_PERSIST_BATCH_SIZE = 500

El step `persist` MUST insertar transacciones en batches de exactamente 500 filas por inserción
SQL. La constante MUST llamarse `ON_CHAIN_PERSIST_BATCH_SIZE` y valer `500`.

Durante `persist`, el sistema MUST emitir un evento `batchProgress` después de cada batch
insertado exitosamente con el formato `{ type: 'batchProgress', done: N, total: M }`.

#### Scenario: Persist con múltiples batches
- GIVEN una wallet con 1200 transacciones clasificadas pendientes de persistir
- WHEN el step persist se ejecuta
- THEN se emiten tres eventos `batchProgress`: `{ done: 500, total: 1200 }`,
  `{ done: 1000, total: 1200 }`, `{ done: 1200, total: 1200 }`
- AND todas las 1200 filas están en la DB al finalizar el step

#### Scenario: Persist con menos de un batch
- GIVEN una wallet con 37 transacciones clasificadas
- WHEN el step persist se ejecuta
- THEN se emite un único evento `batchProgress { done: 37, total: 37 }`
- AND el step finaliza con `done { synced: 37, skipped: 0 }`

---

### Requirement: R-004 — Atomicidad con SyncRunHelper y rollback CASCADE

El sistema MUST usar `SyncRunHelper.start()` al inicio del sync y `commitSuccess()` al finalizar
exitosamente. Ante cualquier error, MUST invocar `rollback()`, lo que MUST disparar el CASCADE
DELETE en la tabla `sync_runs` eliminando todas las transacciones insertadas en ese run.

El `BEGIN/COMMIT/ROLLBACK` manual existente en `on-chain-sync.ts` MUST ser eliminado y
reemplazado por este mecanismo.

#### Scenario: Error durante persist → rollback CASCADE
- GIVEN un sync que insertó 500 txs en el primer batch y falla al insertar el segundo batch
- WHEN el error es capturado en el catch del servicio
- THEN `SyncRunHelper.rollback(runId)` es invocado
- AND el CASCADE DELETE elimina las 500 txs del primer batch de la DB
- AND se emite `{ type: 'error', message: '...' }` al cliente SSE
- AND el cursor de la wallet NO avanza

---

### Requirement: R-005 — AbortSignal con cancelación limpia entre steps

El sistema MUST verificar `signal.aborted` entre cada step mediante `checkAborted(signal)`.
Si la señal está activa, el sync MUST detenerse sin emitir `{ type: 'error' }` y sin avanzar
el cursor.

#### Scenario: Abort durante fetch_tokens
- GIVEN un sync en progreso que completó `fetch_normal`
- WHEN el `AbortSignal` se activa antes de iniciar `fetch_tokens`
- THEN el sync se detiene inmediatamente al detectar `signal.aborted`
- AND NO se emite ningún evento de error
- AND el cursor permanece en su valor pre-sync
- AND `rollback()` es invocado para limpiar cualquier estado intermedio

#### Scenario: Abort durante persist (entre batches)
- GIVEN un sync que insertó el primer batch de 500 txs y detecta abort antes del siguiente
- WHEN se verifica `signal.aborted` entre batches
- THEN el persist se detiene
- AND `rollback()` elimina el batch ya insertado vía CASCADE
- AND el cursor NO avanza

---

### Requirement: R-006 — Route wiring: pasar emit y signal al service

El route handler SSE en `sync.ts` MUST pasar `{ emit, signal: ac.signal }` a
`onChainService.sync(walletId, userId, { emit, signal })`.

#### Scenario: Request SSE a GET /:walletId/stream para wallet ON_CHAIN
- GIVEN una wallet de tipo `ON_CHAIN` con sync no activo
- WHEN el cliente abre la conexión SSE al endpoint de stream
- THEN el handler extrae `emit` de la respuesta SSE y `signal` del `AbortController`
- AND los pasa como `opts` a `OnChainSyncService.sync()`
- AND el cliente recibe los eventos SSE en tiempo real

---

### Requirement: R-007 — 409 Conflict para sync concurrente de la misma wallet

Si hay un sync en curso para una wallet, el sistema MUST responder `409 Conflict` a cualquier
request posterior de sync para esa misma wallet. Este comportamiento MUST ser gestionado por
el `SyncOrchestrator` existente, sin cambios adicionales en el servicio.

#### Scenario: Segundo request de sync mientras hay uno activo
- GIVEN un sync ON_CHAIN activo para `walletId = 42`
- WHEN llega un segundo request de sync para `walletId = 42`
- THEN el sistema responde `HTTP 409` con body `{ error: 'Sync already in progress' }`
- AND el primer sync continúa sin interrupción

---

### Requirement: R-008 — Frontend: SyncStepName incluye steps on-chain

`SyncStepName` en `settings.ts` MUST ser un union type que incluya tanto los steps CEX
(`trades`, `converts`, `withdrawals`, `deposits`) como los steps on-chain
(`fetch_normal`, `fetch_tokens`, `classify`, `persist`).

La constante `SYNC_STEPS_ON_CHAIN` MUST definir el orden y labels de los cuatro steps on-chain.

#### Scenario: Wallet ON_CHAIN inicia sync desde el frontend
- GIVEN un usuario en la pantalla de Settings con una wallet ON_CHAIN seleccionada
- WHEN inicia el sync
- THEN `useSyncStream` inicializa los steps con `SYNC_STEPS_ON_CHAIN`
- AND `SyncProgress` muestra los cuatro steps: "Obteniendo txs normales", "Obteniendo token txs",
  "Clasificando", "Persistiendo"
- AND cada step cambia de estado a `running` / `done` a medida que llegan los eventos SSE

#### Scenario: Wallet CEX inicia sync desde el frontend
- GIVEN un usuario con una wallet de tipo `CEX_BINANCE`
- WHEN inicia el sync
- THEN `useSyncStream` inicializa con los steps CEX existentes
- AND el comportamiento es idéntico al pre-US-016 (sin regresión)

---

### Requirement: R-009 — Frontend: batchProgress muestra contador X / Y en step persist

Durante el step `persist`, `SyncProgress` MUST mostrar un sub-contador en formato
`X / Y txs` que se actualice con cada evento `batchProgress` recibido.

#### Scenario: Step persist con progreso granular
- GIVEN un sync ON_CHAIN en el step `persist` con 1200 txs totales
- WHEN llegan los eventos `batchProgress { done: 500, total: 1200 }` y luego `{ done: 1000, total: 1200 }`
- THEN el componente `SyncProgress` muestra "500 / 1200 txs" y luego "1000 / 1200 txs"
- AND al recibir `step persist done`, el contador desaparece o queda fijo en "1200 / 1200 txs"

---

## MODIFIED Requirements

### Requirement: OnChainSyncService — manejo de transacciones
La transacción manual `BEGIN/COMMIT/ROLLBACK` MUST ser reemplazada por el ciclo
`SyncRunHelper.start() → commitSuccess() | rollback()`.
(Previously: el servicio gestionaba la transacción directamente con sentencias SQL explícitas.)

### Requirement: SyncStepName — tipo union
`SyncStepName` MUST ser una union que incluya CEX y on-chain steps.
(Previously: `SyncStepName` solo referenciaba steps CEX.)

### Requirement: useSyncStream — parametrización por wallet type
`useSyncStream` MUST seleccionar `initialSteps()` basándose en el tipo de wallet (`CEX` vs `ON_CHAIN`).
(Previously: siempre inicializaba con steps CEX.)

---

## REMOVED Requirements

_(Ningún requisito eliminado en este cambio.)_

---

## API Contract — SSE Event Shapes

Todos los eventos se envían como `data: <JSON>\n\n` sobre la conexión SSE existente.

### Step event

```typescript
// Al iniciar un step
{ type: 'step'; step: OnChainSyncStep; status: 'running' }

// Al completar un step
{ type: 'step'; step: OnChainSyncStep; status: 'done'; synced: number; skipped: number }

type OnChainSyncStep = 'fetch_normal' | 'fetch_tokens' | 'classify' | 'persist'
```

### batchProgress event

```typescript
{ type: 'batchProgress'; done: number; total: number }
```

### Terminal events

```typescript
{ type: 'complete' }
{ type: 'error'; message: string }
```

### Ejemplo de secuencia completa (wallet con 1200 txs)

```
data: {"type":"step","step":"fetch_normal","status":"running"}
data: {"type":"step","step":"fetch_normal","status":"done","synced":1200,"skipped":0}
data: {"type":"step","step":"fetch_tokens","status":"running"}
data: {"type":"step","step":"fetch_tokens","status":"done","synced":450,"skipped":0}
data: {"type":"step","step":"classify","status":"running"}
data: {"type":"step","step":"classify","status":"done","synced":1200,"skipped":0}
data: {"type":"step","step":"persist","status":"running"}
data: {"type":"batchProgress","done":500,"total":1200}
data: {"type":"batchProgress","done":1000,"total":1200}
data: {"type":"batchProgress","done":1200,"total":1200}
data: {"type":"step","step":"persist","status":"done","synced":1200,"skipped":0}
data: {"type":"complete"}
```

---

## Constants

| Constante | Valor | Ubicación | Descripción |
|-----------|-------|-----------|-------------|
| `ON_CHAIN_PERSIST_BATCH_SIZE` | `500` | `on-chain-sync.ts` | Tamaño máximo de filas por INSERT durante el step persist |
| `SYNC_STEPS_ON_CHAIN` | `['fetch_normal', 'fetch_tokens', 'classify', 'persist']` | `settings.ts` | Orden canónico de steps para wallets ON_CHAIN |

---

## Invariantes del Dominio Preservadas

Los siguientes invariantes del PRD NO se modifican en este cambio:

- **WAC es puro** — `wac` solo recalcula en `BUY`, `SWAP_IN`, `TRANSFER_IN`. US-016 no toca `PositionEngine`.
- **Identidad de token por source** — on-chain y CEX siguen siendo tokens distintos con WAC independiente.
- **Idempotencia del sync** — `ON CONFLICT … DO NOTHING` en los inserts se mantiene. Re-ejecutar es seguro.
- **UNIQUE constraints** — `(tx_hash, tx_log_index) WHERE source IN ('ETHERSCAN','BSCTRACE')` sin cambios.
- **Cursor avanza SOLO en commitSuccess** — si el sync aborta o falla, el cursor no avanza y el siguiente sync re-fetcha desde el mismo punto.
