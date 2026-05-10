# Design: US-016 — SSE streaming y persistencia por lotes para sync on-chain

## Enfoque Técnico

Refactorizar `OnChainSyncService.sync()` para integrar el ciclo de vida de `SyncRunHelper` (start → commitSuccess / rollback), emitir eventos SSE por step, persistir transacciones en batches de 500, y soportar `AbortSignal`. El cambio replica el patrón probado de `BinanceSyncService` sin modificar infraestructura compartida (`SyncRunHelper`, `PositionStateBuffer`, `SyncOrchestrator`, route SSE).

El refactor se limita a **4 archivos**: `on-chain-sync.ts` (backend), `sync.ts` (route), `settings.ts` (types frontend), `useSyncStream.ts` (hook frontend). Cero migraciones de DB.

---

## Decisiones de Arquitectura

### Decisión 1: Clasificación completa en memoria vs. streaming a DB durante classify

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Clasificar todo en memoria, persistir después | Mayor uso de RAM temporalmente (~1200 txs × ~500 bytes = ~600 KB max). Permite sort global antes de persist (CRÍTICO para WAC). | **ELEGIDA** |
| Stream persist durante classify (insertar cada tx tras clasificarla) | Menor pico de RAM. Pero requiere sort parcial o re-scan, y complica rollback de batches ya insertados. | Descartada |

**Rationale**: El sort global `(blockNumber, transactionIndex, txLogIndex)` es OBLIGATORIO antes de llamar al PositionEngine — el WAC es order-sensitive. Clasificar todo, luego sort, luego persist en batches es el mismo patrón que el servicio actual, solo que ahora el persist se hace en batches de 500 con SSE feedback en vez de row-by-row dentro de una transacción manual.

### Decisión 2: Batch persist DESPUÉS de todo classify vs. intercalar persist con classify

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| classify all → sort → batch persist (4 steps secuenciales) | Step `persist` agrupa toda la I/O de DB. Más simple. Emit `batchProgress` solo durante persist. | **ELEGIDA** |
| Intercalar classify y persist por bloques de txs | Más complejo: necesita partial sort, partial buffer apply, manejo de rollback parcial. | Descartada |

**Rationale**: El PositionEngine necesita las txs EN ORDEN global. Intercalar clasificación con persistencia rompería este invariante salvo que se haga sort parcial por ventana de bloques, lo cual agrega complejidad sin beneficio claro dado que el volumen máximo esperado es ~5000 txs por sync.

### Decisión 3: Reutilizar PositionStateBuffer.apply() vs. mantener inline position loading

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| `loadInitial()` + `apply()` del buffer (patrón Binance) | Positions en memoria → commitSuccess las persiste atómicamente. Elimina SELECT FOR UPDATE row-by-row. | **ELEGIDA** |
| Mantener SELECT FOR UPDATE inline por cada tx (patrón actual) | Funciona pero incompatible con batch inserts y con SyncRunHelper.commitSuccess que espera un buffer. | Descartada |

**Rationale**: `SyncRunHelper.commitSuccess()` recibe un `Map<string, PositionState>` y persiste todas las positions en un COMMIT atómico. Mantener el SELECT FOR UPDATE inline sería duplicar la responsabilidad de position persistence.

### Decisión 4: Forma de los eventos SSE — mantener shape existente vs. agregar `type` discriminator

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Mantener shape existente `{ step, status }` para step events, agregar `type: 'batchProgress'` solo para el nuevo evento | Backward-compatible con el hook actual. Mínimo cambio en frontend. | **ELEGIDA** |
| Agregar `type: 'step'` a todos los eventos (CEX + on-chain) | Más semántico pero breaking change en el hook existente y en BinanceSyncService. | Descartada |

**Rationale**: El hook `useSyncStream` ya parsea `data.step` y `data.status` directamente. Los eventos terminales usan `step: 'complete'` / `step: 'error'`. Agregar `type` a todo requiere modificar BinanceSyncService (fuera de scope). Solo el nuevo `batchProgress` necesita discriminador porque no encaja en el patrón step/status.

### Decisión 5: checkAborted entre batches de persist

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| checkAborted ENTRE batches de 500 durante persist | Permite cancelación granular. Rollback vía CASCADE limpia batches ya insertados. | **ELEGIDA** |
| checkAborted solo entre steps (no entre batches) | Si persist tiene 5000 txs = 10 batches, el usuario espera sin poder cancelar. | Descartada |

**Rationale**: Un batch de 500 INSERTs puede tomar ~1-3 segundos. Con miles de txs acumuladas, el step persist puede durar 10-30s. Verificar abort entre batches da responsive cancellation.

---

## Diagrama de Secuencia

```mermaid
sequenceDiagram
    participant Client as Frontend (SSE)
    participant Route as sync.ts (GET /:walletId/stream)
    participant Orch as SyncOrchestrator
    participant Service as OnChainSyncService
    participant Helper as SyncRunHelper
    participant Buffer as PositionStateBuffer
    participant API as Etherscan/BSCTrace
    participant DB as PostgreSQL

    Client->>Route: GET /api/sync/:walletId/stream
    Route->>Orch: tryAcquireLock(walletId)
    alt Lock already held
        Route-->>Client: 409 Conflict
    end
    Orch-->>Route: AbortController

    Route->>Route: reply.hijack(), setup SSE headers
    Route->>Service: sync(walletId, userId, { emit, signal })

    %% Initialization
    Service->>DB: loadWallet(walletId, userId)
    Service->>Helper: start(walletId, 'ON_CHAIN')
    Helper->>DB: INSERT sync_runs → runId
    Service->>Buffer: loadInitial(pool, walletId)
    Buffer->>DB: SELECT positions WHERE wallet_id

    %% Step 1: fetch_normal
    Service-->>Client: { step: 'fetch_normal', status: 'running' }
    Service->>API: paginateNormal(address, fromBlock)
    API-->>Service: NormalizedTx[]
    Service-->>Client: { step: 'fetch_normal', status: 'done', synced: N }
    Service->>Service: checkAborted(signal)

    %% Step 2: fetch_tokens
    Service-->>Client: { step: 'fetch_tokens', status: 'running' }
    Service->>API: paginateToken(address, fromBlock)
    API-->>Service: NormalizedTokenTx[]
    Service-->>Client: { step: 'fetch_tokens', status: 'done', synced: M }
    Service->>Service: checkAborted(signal)

    %% Step 3: classify
    Service-->>Client: { step: 'classify', status: 'running' }
    Service->>Service: groupByTxHash + classifyAndDecompose + sort
    Service-->>Client: { step: 'classify', status: 'done', synced: K }
    Service->>Service: checkAborted(signal)

    %% Step 4: persist (batched)
    Service-->>Client: { step: 'persist', status: 'running' }
    loop Cada batch de 500 txs
        Service->>Service: ensureToken + resolvePrice + costResolve
        Service->>DB: INSERT transactions (batch) con sync_run_id
        Service->>Buffer: apply(buffer, tx) por cada tx del batch
        Service->>Helper: recordTxsPersisted(runId, batchCount)
        Service-->>Client: { type: 'batchProgress', done: X, total: K }
        Service->>Service: checkAborted(signal)
    end
    Service-->>Client: { step: 'persist', status: 'done', synced: K }

    %% Commit
    Service->>Helper: commitSuccess(runId, { positions: buffer, cursorUpdates })
    Helper->>DB: BEGIN → UPSERT positions → UPSERT cursors → UPDATE sync_runs → COMMIT
    Service-->>Client: { step: 'complete', status: 'done', summary }

    Route->>Orch: releaseLock(walletId)
    Route->>Client: raw.end()
```

---

## Diseño Detallado por Componente

### 1. `on-chain-sync.ts` — Refactor del servicio

#### Nueva firma pública

```typescript
import type { SyncEmitter } from './binance-sync.js'; // reutilizar el type existente
import { SyncRunHelper } from './sync-run-helper.js';
import { loadInitial, apply } from './position-state-buffer.js';

export const ON_CHAIN_PERSIST_BATCH_SIZE = 500;

// Firma extendida — opts es opcional para backward-compat con POST handler
async sync(
  walletId: string,
  userId: string,
  opts?: { emit?: SyncEmitter; signal?: AbortSignal },
): Promise<SyncResult>
```

#### Flujo interno refactorizado

El método `sync()` se reestructura en 4 fases secuenciales con un wrapper `try/catch` que llama `rollback()` en error:

```typescript
async sync(walletId, userId, opts?) {
  const emit = opts?.emit;
  const signal = opts?.signal;
  const wallet = await this.loadWallet(walletId, userId);
  // ... validations (wallet_type, address, apiClient.assertConfigured) ...

  const syncRunHelper = new SyncRunHelper(this.deps.pool);
  const { runId } = await syncRunHelper.start(walletId, 'ON_CHAIN');
  const buffer = await loadInitial(this.deps.pool, walletId);

  try {
    // ── Step 1: fetch_normal ──
    emit?.({ step: 'fetch_normal', status: 'running' });
    const normalTxs = await this.paginateNormal(apiClient, walletAddress, wallet.last_synced_block);
    emit?.({ step: 'fetch_normal', status: 'done', synced: normalTxs.length, skipped: 0 });
    this.checkAborted(signal);

    // ── Step 2: fetch_tokens ──
    emit?.({ step: 'fetch_tokens', status: 'running' });
    const tokenTxs = await this.paginateToken(apiClient, walletAddress, wallet.last_synced_block);
    emit?.({ step: 'fetch_tokens', status: 'done', synced: tokenTxs.length, skipped: 0 });
    this.checkAborted(signal);

    // ── Step 3: classify ──
    emit?.({ step: 'classify', status: 'running' });
    const groups = groupByTxHash(normalTxs, tokenTxs);
    const decomposed = groups.flatMap(g =>
      classifyAndDecomposeTransaction(g, walletAddress, network),
    );
    decomposed.sort((a, b) =>
      a.blockNumber - b.blockNumber ||
      a.transactionIndex - b.transactionIndex ||
      a.txLogIndex - b.txLogIndex,
    );
    emit?.({ step: 'classify', status: 'done', synced: decomposed.length, skipped: 0 });
    this.checkAborted(signal);

    // ── Step 4: persist (batched) ──
    const { synced, skipped } = await this.persistBatched(
      walletId, network, runId, buffer, decomposed, emit, signal,
    );

    // ── Cursor + commit ──
    const lastBlock = decomposed.length > 0
      ? decomposed[decomposed.length - 1]!.blockNumber
      : wallet.last_synced_block;

    syncRunHelper.recordTxsPersisted(runId, synced);
    await syncRunHelper.commitSuccess(runId, {
      positions: buffer,
      cursorUpdates: [{ operation: 'block', value: String(lastBlock) }],
    });

    // Best-effort last_synced_at
    await this.deps.pool.query(
      'UPDATE wallets SET last_synced_at = now() WHERE id = $1', [walletId]
    ).catch(() => {});

    emit?.({ step: 'complete', status: 'done', summary: { synced, skipped } });
    return this.buildResult(counters, newTransactionIds);

  } catch (err) {
    await syncRunHelper.rollback(runId).catch(() => {});
    throw err;
  }
}
```

#### Nuevo método privado: `persistBatched`

Reemplaza el loop actual que hacía `persistOneTransaction` row-by-row dentro de un `BEGIN/COMMIT`. Ahora:

```typescript
private async persistBatched(
  walletId: string,
  network: 'ETH' | 'BSC',
  runId: string,
  buffer: Map<string, PositionState>,
  decomposed: DecomposedTransaction[],
  emit?: SyncEmitter,
  signal?: AbortSignal,
): Promise<{ synced: number; skipped: number; counters: SyncCounters; newTxIds: string[] }>
```

**Lógica interna:**

1. `emit?.({ step: 'persist', status: 'running' })`
2. Iterar `decomposed` en chunks de `ON_CHAIN_PERSIST_BATCH_SIZE`:
   ```typescript
   for (let i = 0; i < decomposed.length; i += ON_CHAIN_PERSIST_BATCH_SIZE) {
     const batch = decomposed.slice(i, i + ON_CHAIN_PERSIST_BATCH_SIZE);
     for (const tx of batch) {
       // ensureToken, resolvePrice, persistOneTx (ahora con sync_run_id), apply(buffer, ...)
     }
     emit?.({ type: 'batchProgress', done: Math.min(i + batch.length, decomposed.length), total: decomposed.length });
     this.checkAborted(signal);
   }
   ```
3. `emit?.({ step: 'persist', status: 'done', synced, skipped: 0 })`

#### Cambio en `persistOneTransaction`

La firma actual usa `PoolClient` (conexión dentro de transacción manual). El refactor cambia a usar `pool` directamente ya que la atomicidad la maneja `SyncRunHelper`:

```typescript
private async persistOneTransaction(
  walletId: string,
  tokenId: string,
  tx: DecomposedTransaction,
  priceUsd: string | null,
  costSource: 'MARKET' | 'INHERITED' | 'MANUAL' | null,
  runId: string,  // NUEVO: FK a sync_runs
): Promise<{ inserted: boolean }>
```

Cambios clave:
- Ya NO recibe `PoolClient` — usa `this.deps.pool` directamente
- Ya NO hace UPSERT de positions (eso lo hace `commitSuccess`)
- INSERT de transaction DEBE incluir `sync_run_id = $N` para que CASCADE funcione
- Sigue usando `ON CONFLICT DO NOTHING` para idempotencia
- Llama `apply(buffer, ...)` para actualizar el PositionStateBuffer en memoria

**NOTA**: Al eliminar el UPSERT de positions inline, la FK `transactions.position_id → positions.id` se resuelve distinto. La transaction se inserta con `position_id` del buffer state actual. Las positions se persisten en `commitSuccess`. Esto requiere que el INSERT de transactions NO tenga FK constraint a positions activa, O que se use deferred constraints, O que `position_id` en el INSERT sea nullable/omitido y se actualice en commitSuccess. **Decisión**: insertar la transaction SIN `position_id` (NULL), y que `commitSuccess` actualice el `position_id` tras persistir positions. Alternativamente, dado que `commitSuccess` corre en una sola transacción BEGIN/COMMIT donde primero hace UPSERT positions y luego podríamos update txs, es más limpio **no insertar position_id durante persist y dejarlo NULL**.

**Revisión**: Mirando el schema actual y `BinanceSyncService`, este último usa `persistBinanceTx` que inserta `position_id` directamente porque el buffer ya tiene el position state con su `id`. El `id` es un UUID generado al crear el PositionState (en `processTransaction` o `positionIdentity`). Como `commitSuccess` hace UPSERT de positions ANTES de que el sync termine, y las transactions ya están en DB con ese `position_id`, la FK se satisface CUANDO `commitSuccess` inserta la position row. Pero entre el INSERT de la transaction y el `commitSuccess`, la FK estaría violada... SALVO que `position_id` sea nullable en el schema.

Verificando el patrón de Binance: `BinanceSyncService` inserta transactions con `position_id` apuntando al buffer state, y `commitSuccess` upserta positions. Las transactions se insertan ANTES de que la position row exista (solo existe en el buffer). Esto SOLO funciona si `position_id` es nullable o si no hay FK. Dado que el patrón Binance ya funciona así, el on-chain service puede hacer lo mismo: insertar transaction con `position_id` del buffer, y `commitSuccess` upserta la position row.

#### Método `checkAborted` (nuevo)

```typescript
private checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('ABORTED');
}
```

Patrón idéntico al de `BinanceSyncService`.

#### Eliminaciones

- Eliminar `await pgc.query('BEGIN')` / `COMMIT` / `ROLLBACK` — todo el bloque try/catch con PoolClient manual
- Eliminar `pgc = await this.deps.pool.connect()` / `pgc.release()` — ya no se necesita una conexión dedicada para transacción manual
- Eliminar el UPDATE inline de `wallets.last_synced_block` y `wallet_sync_cursors` — ahora va en `cursorUpdates` de `commitSuccess`
- Eliminar el UPSERT inline de positions — ahora va en `commitSuccess`

---

### 2. `sync.ts` (route) — Wiring de emit y signal

Cambio mínimo en el handler SSE (línea ~114):

```typescript
// ANTES (actual):
const onChainService = createOnChainService();
const result = await onChainService.sync(walletId, userId);
emit({ step: 'complete', status: 'done', summary: result });

// DESPUÉS:
const onChainService = createOnChainService();
const result = await onChainService.sync(walletId, userId, { emit, signal: ac.signal });
emit({ step: 'complete', status: 'done', summary: result });
```

También actualizar el POST handler para pasar `signal` (sin `emit`):

```typescript
// ANTES:
const result = await onChainService.sync(walletId, userId);

// DESPUÉS:
const result = await onChainService.sync(walletId, userId, { signal: ac.signal });
```

**NOTA**: El `emit({ step: 'complete', ... })` en la route se puede eliminar si el servicio ya lo emite internamente. Pero para consistencia con Binance (donde la route emite el `complete`), se mantiene en la route. El servicio NO emite `complete` — la route lo hace.

**Corrección al flujo**: El servicio emite steps 1-4 internamente. La route emite `complete` y `error` como wrappers terminales. Esto es consistente con cómo funciona `BinanceSyncService` — el servicio emite steps, la route emite complete/error.

---

### 3. `settings.ts` (types frontend)

```typescript
// ANTES:
export const SYNC_STEPS_CEX = ['fiat', 'deposits', 'withdrawals', 'converts', 'trades'] as const;
export type SyncStepName = (typeof SYNC_STEPS_CEX)[number];

// DESPUÉS:
export const SYNC_STEPS_CEX = ['fiat', 'deposits', 'withdrawals', 'converts', 'trades'] as const;
export const SYNC_STEPS_ON_CHAIN = ['fetch_normal', 'fetch_tokens', 'classify', 'persist'] as const;

export type CexSyncStepName = (typeof SYNC_STEPS_CEX)[number];
export type OnChainSyncStepName = (typeof SYNC_STEPS_ON_CHAIN)[number];
export type SyncStepName = CexSyncStepName | OnChainSyncStepName;
```

El `StepState` se mantiene igual — ya usa `SyncStepName` genérico.

---

### 4. `useSyncStream.ts` (hook frontend)

#### Parametrización por wallet type

```typescript
import { SYNC_STEPS_CEX, SYNC_STEPS_ON_CHAIN } from '../../types/settings';
import type { SyncStepName, WalletType } from '../../types/settings';

const STEP_LABELS: Record<SyncStepName, string> = {
  // CEX
  fiat: 'Fiat Orders',
  deposits: 'Deposits',
  withdrawals: 'Withdrawals',
  converts: 'Converts',
  trades: 'Trades',
  // On-chain
  fetch_normal: 'Fetching normal txs',
  fetch_tokens: 'Fetching token txs',
  classify: 'Classifying',
  persist: 'Persisting',
};

function initialSteps(walletType: WalletType): StepState[] {
  const names = walletType === 'ON_CHAIN' ? SYNC_STEPS_ON_CHAIN : SYNC_STEPS_CEX;
  return names.map((name) => ({
    name,
    label: STEP_LABELS[name],
    status: 'pending' as const,
  }));
}
```

La firma del hook cambia para recibir `walletType`:

```typescript
export function useSyncStream(walletId: string, walletType: WalletType): UseSyncStreamResult {
  // ...
  const start = useCallback(() => {
    setSteps(initialSteps(walletType));
    // ... rest
  }, [walletId, walletType, close]);
}
```

#### Manejo de `batchProgress`

En el `onmessage` handler, agregar detección del evento `batchProgress`:

```typescript
es.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data) as Record<string, unknown>;

    // Nuevo: batchProgress event
    if (data.type === 'batchProgress') {
      setBatchProgress({ done: data.done as number, total: data.total as number });
      return;
    }

    const step = data.step as string;
    const stepStatus = data.status as string;

    if (step === 'complete') { /* ... existing ... */ }
    if (step === 'error') { /* ... existing ... */ }

    // Limpiar batchProgress cuando el step persist termina
    if (step === 'persist' && stepStatus === 'done') {
      setBatchProgress(null);
    }

    // ... existing step update logic ...
  } catch { /* ignore */ }
};
```

Agregar state y export:

```typescript
const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);

// En el return:
return { steps, status, error, summary, batchProgress, start, cancel, retry };
```

---

### 5. `SyncProgress.tsx` (componente frontend)

#### Mostrar batch progress

Agregar prop `batchProgress` y mostrarlo en el `StepRow` del step `persist`:

```typescript
interface SyncProgressProps {
  steps: StepState[];
  status: SyncStreamStatus;
  error: { code: string; message: string } | null;
  summary: Record<string, unknown> | null;
  batchProgress: { done: number; total: number } | null;  // NUEVO
  onCancel: () => void;
  onRetry: () => void;
}
```

En `StepRow`, si el step es `persist` y está `running`, mostrar el sub-contador:

```tsx
function StepRow({ step, batchProgress }: { step: StepState; batchProgress?: { done: number; total: number } | null }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <StepIcon status={step.status} />
      <span className={cn(/* ... existing ... */)}>
        {step.label}
      </span>
      {/* Existing counters for done/skipped ... */}

      {/* NUEVO: batch progress durante persist */}
      {step.name === 'persist' && step.status === 'running' && batchProgress && (
        <span className="text-xs text-indigo-300">
          {batchProgress.done} / {batchProgress.total} txs
        </span>
      )}
    </div>
  );
}
```

---

## Flujo de Errores

```
┌──────────────────────────────────────────────────────────────────┐
│                    Error Handling Flow                            │
├─────────────────┬────────────────────────────────────────────────┤
│ Punto de fallo  │ Comportamiento                                │
├─────────────────┼────────────────────────────────────────────────┤
│ loadWallet      │ Throws NotFoundError → route catch → emit     │
│ fails           │ error event → 404 (POST) o SSE error          │
├─────────────────┼────────────────────────────────────────────────┤
│ API key missing │ apiClient.assertConfigured() throws →          │
│                 │ pre-SyncRunHelper, no runId → throw directo   │
├─────────────────┼────────────────────────────────────────────────┤
│ syncRunHelper   │ INSERT sync_runs fails → throw antes de       │
│ .start() fails  │ cualquier fetch → no cleanup needed           │
├─────────────────┼────────────────────────────────────────────────┤
│ fetch_normal    │ Etherscan API error → catch → rollback(runId) │
│ fails           │ → CASCADE borra sync_run (sin txs aún)        │
│                 │ → emit error event                             │
├─────────────────┼────────────────────────────────────────────────┤
│ fetch_tokens    │ Igual que fetch_normal                         │
│ fails           │                                                │
├─────────────────┼────────────────────────────────────────────────┤
│ classify fails  │ Error en groupByTxHash/classify → catch →     │
│                 │ rollback(runId) → sin txs en DB aún           │
├─────────────────┼────────────────────────────────────────────────┤
│ persist batch N │ INSERT falla en batch 2 de 3 → catch →        │
│ fails           │ rollback(runId) → CASCADE DELETE borra las     │
│                 │ txs del batch 1 (vinculadas por sync_run_id)  │
│                 │ → cursor NO avanza → re-sync seguro           │
├─────────────────┼────────────────────────────────────────────────┤
│ commitSuccess   │ Error en UPSERT positions o cursors →         │
│ fails           │ commitSuccess internamente hace ROLLBACK +     │
│                 │ rollback(runId) → CASCADE limpia todo          │
├─────────────────┼────────────────────────────────────────────────┤
│ AbortSignal     │ checkAborted() lanza Error('ABORTED') →       │
│ (cancel)        │ catch → rollback(runId) → CASCADE limpia      │
│                 │ → route detecta 'ABORTED' y NO emite error    │
│                 │ → cursor NO avanza                             │
├─────────────────┼────────────────────────────────────────────────┤
│ Client          │ req.raw 'close' → ac.abort() → signal fires   │
│ disconnect      │ → checkAborted en siguiente punto de check    │
│                 │ → rollback → releaseLock                       │
└─────────────────┴────────────────────────────────────────────────┘
```

**Invariante clave**: En TODOS los casos de error/abort, `rollback(runId)` borra el `sync_runs` row, y `ON DELETE CASCADE` elimina todas las transactions vinculadas. El cursor NO avanza (solo avanza en `commitSuccess`). El siguiente sync re-fetcha desde el mismo punto — idempotencia garantizada por `ON CONFLICT DO NOTHING`.

---

## Puntos de Integración — API exacta

### SyncRunHelper

```typescript
// 1. Crear run al inicio
const syncRunHelper = new SyncRunHelper(this.deps.pool);
const { runId } = await syncRunHelper.start(walletId, 'ON_CHAIN');

// 2. Registrar txs persisted (para métricas en sync_runs.txs_persisted)
syncRunHelper.recordTxsPersisted(runId, batchCount);

// 3a. Commit exitoso — persiste positions, cursors, cierra run
await syncRunHelper.commitSuccess(runId, {
  positions: buffer,                    // Map<string, PositionState>
  cursorUpdates: [
    { operation: 'block', value: String(lastBlock) },
  ],
});

// 3b. Rollback en error — DELETE sync_runs row → CASCADE DELETE txs
await syncRunHelper.rollback(runId).catch(() => {});
```

### PositionStateBuffer

```typescript
// 1. Cargar positions existentes al inicio
const buffer = await loadInitial(this.deps.pool, walletId);
// Returns: Map<string, PositionState> — keyed by tokenId, latest cycle per token

// 2. Apply cada tx al buffer durante persist
import { apply } from './position-state-buffer.js';
apply(buffer, {
  position: buffer.get(tokenId) ?? null,
  priorClosedCycles: 0,   // buffer.loadInitial ya resuelve el cycle correcto
  transaction: {
    type: tx.type,
    amount: tx.amount,
    priceUsd,
    costSource: costSource ?? undefined,
    source: tx.source,
    blockTimestamp: tx.blockTimestamp,
  },
  positionIdentity: buffer.has(tokenId)
    ? undefined
    : { id: crypto.randomUUID(), walletId, tokenId },
});
```

**Nota sobre `priorClosedCycles: 0`**: `loadInitial` carga la latest position per token. Si está CLOSED, `buildEngineInput()` internamente usa `cached.cycleNumber` como priorClosedCycles. Por eso el caller pasa `0` — el buffer lo corrige internamente.

### SyncEmitter (reuse del type de binance-sync.ts)

```typescript
// Importar el type existente
import type { SyncEmitter } from './binance-sync.js';
// SyncEmitter = (event: Record<string, unknown>) => void
```

---

## Cambios en Archivos

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `apps/backend/src/services/on-chain-sync.ts` | Modificar | Refactor principal: firma extendida, SyncRunHelper lifecycle, batch persist, SSE emit, AbortSignal, eliminar BEGIN/COMMIT/ROLLBACK manual |
| `apps/backend/src/routes/sync.ts` | Modificar | Pasar `{ emit, signal }` a `onChainService.sync()` en SSE handler (L~114) y `{ signal }` en POST handler (L~148) |
| `apps/frontend/src/types/settings.ts` | Modificar | Agregar `SYNC_STEPS_ON_CHAIN`, `OnChainSyncStepName`, ampliar `SyncStepName` union |
| `apps/frontend/src/hooks/settings/useSyncStream.ts` | Modificar | Parametrizar `initialSteps(walletType)`, manejar `batchProgress` event, nuevo state `batchProgress` |
| `apps/frontend/src/components/settings/SyncProgress.tsx` | Modificar | Prop `batchProgress`, mostrar `X / Y txs` durante step persist running |

---

## Estrategia de Idempotencia

Sin cambios respecto al comportamiento actual:

1. **Transactions**: `ON CONFLICT DO NOTHING` en el INSERT (constraint `UNIQUE(tx_hash, tx_log_index) WHERE source IN ('ETHERSCAN','BSCTRACE')`)
2. **Tokens**: `ON CONFLICT DO NOTHING` en el INSERT + re-SELECT (patrón `ensureToken` existente)
3. **Positions**: UPSERT `ON CONFLICT (wallet_id, token_id, cycle_number) DO UPDATE` (en `commitSuccess`)
4. **Cursors**: UPSERT `ON CONFLICT (wallet_id, operation) DO UPDATE` (en `commitSuccess`)
5. **Re-run safety**: Si el sync falla y se re-ejecuta, el cursor no avanzó, fetch re-trae las mismas txs, ON CONFLICT las ignora. Positions se recalculan desde el buffer.
