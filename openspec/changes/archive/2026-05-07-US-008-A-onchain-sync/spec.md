# Spec — US-008-A · On-chain Sync (Etherscan + BSCTrace)

> **Change:** `US-008-A-onchain-sync`
> **Capability:** OnChainSyncService + EtherscanClient + BSCTraceClient + `POST /api/sync/:walletId`
> **Estado:** draft
> **Última revisión:** 2026-05-05
> **Depends on:** US-001..US-007 (scaffold, auth, wallets, tokens, transactions, position-engine, price-service)

---

## Índice

1. [Alcance](#1-alcance)
2. [Tipos de dominio](#2-tipos-de-dominio)
3. [Invariantes del dominio](#3-invariantes-del-dominio)
4. [DB Migration: 0003_wallet_last_synced_block.sql](#4-db-migration-0003_wallet_last_synced_blocksql)
5. [Constantes: SWAP_ROUTERS](#5-constantes-swap_routers)
6. [EtherscanClient](#6-etherscan-client)
7. [BSCTraceClient](#7-bsctrace-client)
8. [OnChainSyncService](#8-onchainsyncservice)
9. [Route: POST /api/sync/:walletId](#9-route-post-apisyncwalletid)
10. [SyncResultSchema (Zod 4)](#10-syncresultschema-zod-4)
11. [Errores de dominio nuevos](#11-errores-de-dominio-nuevos)
12. [Registro en index.ts](#12-registro-en-indexts)
13. [Escenarios de test](#13-escenarios-de-test)
14. [Escenarios NEGATIVOS](#14-escenarios-negativos)

---

## 1. Alcance

Esta spec cubre el pipeline completo de sync on-chain. El servicio consume Etherscan (ETH) o BSCTrace (BSC) desde el último bloque sincronizado, clasifica y descompone transacciones, resuelve WAC para `TRANSFER_IN`, y persiste todo idempotentemente. El motor de posiciones (`PositionEngine`) se invoca sin modificación.

Archivos afectados:

| Archivo | Acción |
|---------|--------|
| `db/migrations/0003_wallet_last_synced_block.sql` | NUEVO |
| `apps/backend/src/services/sync/on-chain-client.ts` | NUEVO — interfaz `OnChainApiClient` + tipo `RawTx` |
| `apps/backend/src/services/sync/etherscan-client.ts` | NUEVO — adapter REST Etherscan v2 |
| `apps/backend/src/services/sync/bsctrace-client.ts` | NUEVO — adapter JSON-RPC 2.0 BSCTrace |
| `apps/backend/src/services/sync/constants/routers.ts` | NUEVO — `SWAP_ROUTERS` |
| `apps/backend/src/services/sync/on-chain-sync.ts` | NUEVO — `OnChainSyncService` |
| `apps/backend/src/routes/sync.ts` | NUEVO — Fastify plugin `syncRoutes` |
| `apps/backend/src/services/errors.ts` | MODIFICADO — `ApiKeyMissingError`, `ExternalApiError` |
| `apps/backend/src/index.ts` | MODIFICADO — registrar `syncRoutes` |
| `apps/backend/src/services/sync/__tests__/pagination.test.ts` | NUEVO — proyecto engine |
| `apps/backend/src/services/sync/__tests__/classify-decompose.test.ts` | NUEVO — proyecto engine |
| `apps/backend/src/services/sync/__tests__/bsctrace-normalize.test.ts` | NUEVO — proyecto engine |
| `apps/backend/tests/sync-transfer-cost.test.ts` | NUEVO — proyecto sync (necesita DB) |
| `apps/backend/tests/e2e-sync.test.ts` | NUEVO — proyecto e2e |

**No incluye:** Binance sync (US-008-B), lookup de precios históricos, UI para `cost_source='MANUAL'`, locking de sync concurrente.

---

## 2. Tipos de dominio

```typescript
// apps/backend/src/services/sync/on-chain-client.ts

/** Forma normalizada común a Etherscan y BSCTrace */
interface RawTx {
  hash: string                // tx hash lowercase
  blockNumber: number
  transactionIndex: number
  from: string                // lowercase EIP-55
  to: string                  // lowercase EIP-55
  value: string               // en wei / token units (string)
  tokenAddress: string | null // null para native ETH/BNB
  tokenSymbol: string | null
  tokenDecimals: number | null
  isError: boolean
  source: 'ETHERSCAN' | 'BSCTRACE'
  timestamp: number           // unix segundos
}

/** Agrupación por tx_hash antes de clasificar */
type TxGroup = RawTx[]

/** Resultado de clasificación/descomposición */
interface ClassifiedTx {
  id: string                  // UUID pre-generado
  relatedId: string | null    // UUID del par en SWAP; null si no es SWAP
  txHash: string
  txLogIndex: 0 | 1
  blockNumber: number
  transactionIndex: number
  timestamp: number
  type: 'BUY' | 'SELL' | 'SWAP_IN' | 'SWAP_OUT' | 'TRANSFER_IN' | 'TRANSFER_OUT'
  tokenAddress: string
  tokenSymbol: string
  tokenDecimals: number
  amount: string              // decimal string normalizado
  from: string
  to: string
  source: 'ETHERSCAN' | 'BSCTRACE'
}

/** Resultado del pipeline completo de resolución de costo */
interface CostResolution {
  priceUsd: string | null     // null → cost_source='MANUAL'
  costSource: 'INHERITED' | 'MANUAL' | 'MARKET'
  inheritedFrom: 'ON_CHAIN' | 'CEX' | null
}

/** Resultado de sync() */
interface SyncResult {
  synced: number
  skipped: number
  swapsDecomposed: number
  transfersPendingCost: number       // cost_source='MANUAL'
  transfersInheritedFromCEX: number
  newTransactions: Transaction[]     // últimas 10 por block DESC
}
```

---

## 3. Invariantes del dominio

Las invariantes siguientes provienen del PRD (`prd.json → resolvedDecisions y rules`) y DEBEN preservarse sin excepción.

### INV-1 — WAC puro

> **WAC solo recalcula en eventos inbound: `BUY`, `SWAP_IN`, `TRANSFER_IN`. Outbound (`SELL`, `SWAP_OUT`, `TRANSFER_OUT`) reducen balance pero NUNCA modifican WAC.**

`OnChainSyncService` MUST delegar WAC a `PositionEngine.processTransaction()`. MUST NOT calcular WAC directamente.

### INV-2 — Ciclos de posición

> **Cuando balance llega a 0 → CLOSED + `realized_pnl_usd` congelado. Siguiente inbound → nueva posición `cycle_number = max+1`, WAC desde cero.**

El servicio MUST leer `priorClosedCycles` via COUNT de posiciones CLOSED para `(wallet_id, token_id)` antes de llamar al motor cuando no hay posición OPEN.

### INV-3 — Identidad de token por fuente

> **`(contract_address, network='ETH'/'BSC')` y `(symbol.toLowerCase(), 'CEX_BINANCE')` son tokens distintos con WAC independiente.**

El servicio MUST identificar tokens on-chain por `(contractAddress, network)`. MUST NOT unificar tokens de distinta fuente.

### INV-4 — Idempotencia por constraint de unicidad

Insert de transacciones MUST usar `ON CONFLICT (tx_hash, tx_log_index) DO NOTHING`. Si un SWAP se re-procesa, AMBAS filas deben disparar el conflicto — nunca medio SWAP persistido.

### INV-5 — Atomicidad por lote con cursor al final

Cada lote de paginación se inserta en su propia transacción DB antes de pedir el siguiente lote. `wallets.last_synced_block` se actualiza SOLO al final del sync completo (tras procesar todos los lotes). Si un lote parcial falla, `ON CONFLICT DO NOTHING` hace el reintento seguro.

### INV-6 — Ordering de PositionEngine

Las filas clasificadas MUST ordenarse por `(blockNumber, transactionIndex, txLogIndex) ASC` antes de alimentar al engine. Este orden es el contrato de `TransactionService.createTransaction()` y es la única forma segura de mantener WAC y ciclos consistentes.

### INV-7 — resolveTransferCost requiere OPEN position en paso 1

Paso 1 de resolución: la posición del wallet de origen MUST estar `status='OPEN'`. Una posición CLOSED en el wallet origen cae al paso 2, no hereda el WAC cerrado.

---

## 4. DB Migration: 0003_wallet_last_synced_block.sql

```sql
-- db/migrations/0003_wallet_last_synced_block.sql
ALTER TABLE wallets
  ADD COLUMN last_synced_block INTEGER NOT NULL DEFAULT 0;
```

**Razones del diseño:**
- `NOT NULL DEFAULT 0` mantiene filas existentes válidas; bloque 0 = inicio de cadena.
- `WHERE block_number > last_synced_block` sin `COALESCE`.
- Migración forward-only y aditiva — sin riesgo de rollback para cohort V1 (usuario único).

El valor se actualiza al final de cada `sync()` exitoso con:

```sql
UPDATE wallets SET last_synced_block = $1 WHERE id = $2
```

---

## 5. Constantes: SWAP_ROUTERS

```typescript
// apps/backend/src/services/sync/constants/routers.ts

export const SWAP_ROUTERS = {
  ETH: [
    // Uniswap v2
    '0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
    // Uniswap v3 SwapRouter
    '0xe592427a0aece92de3edee1f18e0157c05861564',
    // Uniswap v3 SwapRouter02
    '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45',
    // Uniswap UniversalRouter
    '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad',
  ],
  BSC: [
    // PancakeSwap v2 Router
    '0x10ed43c718714eb63d5aa57b78b54704e256024e',
    // PancakeSwap v3 SmartRouter
    '0x13f4ea83d0bd40e75c8222255bc855a974568dd4',
  ],
} as const satisfies Record<'ETH' | 'BSC', readonly string[]>

export type SupportedNetwork = keyof typeof SWAP_ROUTERS
```

Todas las comparaciones de dirección con routers MUST usar `.toLowerCase()` antes de comparar — las respuestas de API devuelven checksums mixtos.

---

## 6. EtherscanClient

```typescript
// apps/backend/src/services/sync/etherscan-client.ts

interface EtherscanTx {
  hash: string
  blockNumber: string   // string decimal en la API
  transactionIndex: string
  from: string
  to: string
  value: string
  isError: string       // '0' o '1'
  timeStamp: string
}

interface EtherscanTokenTx {
  hash: string
  blockNumber: string
  transactionIndex: string
  from: string
  to: string
  value: string
  contractAddress: string
  tokenName: string
  tokenSymbol: string
  tokenDecimal: string
  timeStamp: string
}
```

### 6.1 `fetchTxList`

**Firma:**
```typescript
fetchTxList(
  address: string,
  startBlock: number,
  endBlock: number
): Promise<EtherscanTx[]>
```

**Requisitos:**

- MUST llamar a `https://api.etherscan.io/v2/api` con parámetros:
  - `chainid=1`, `module=account`, `action=txlist`
  - `address`, `startblock`, `endblock`, `sort=asc`, `offset=1000`
  - `apikey=ETHERSCAN_API_KEY`
- MUST retornar `result` del JSON cuando `status='1'`.
- Si `status='0'` y `message='No transactions found'` → MUST retornar `[]`.
- Si `status='0'` con otro mensaje → MUST lanzar `ExternalApiError('etherscan', cause)`.
- En error de red o respuesta no-JSON → MUST lanzar `ExternalApiError('etherscan', cause)`.
- MUST NOT loguear el API key.

### 6.2 `fetchTokenTx`

**Firma:**
```typescript
fetchTokenTx(
  address: string,
  startBlock: number,
  endBlock: number
): Promise<EtherscanTokenTx[]>
```

**Requisitos:**

- MUST llamar al mismo endpoint con `action=tokentx`, mismo set de parámetros.
- Mismo manejo de errores que `fetchTxList`.

### 6.3 Normalización a `RawTx`

`EtherscanClient` MUST exponer un método interno (o función pura exportada) que convierta `EtherscanTx | EtherscanTokenTx` a `RawTx`:

- `blockNumber`: `parseInt(tx.blockNumber, 10)`
- `transactionIndex`: `parseInt(tx.transactionIndex, 10)`
- `from` / `to`: `.toLowerCase()`
- `tokenAddress`: `'contractAddress' in tx ? tx.contractAddress.toLowerCase() : null`
- `isError`: `tx.isError === '1'`
- `source`: `'ETHERSCAN'`
- `timestamp`: `parseInt(tx.timeStamp, 10)`

---

## 7. BSCTraceClient

```typescript
// apps/backend/src/services/sync/bsctrace-client.ts
```

BSCTrace expone una API JSON-RPC 2.0. El método relevante es `nr_getAssetTransfers`.

### 7.1 `fetchAssetTransfers`

**Firma:**
```typescript
fetchAssetTransfers(
  address: string,
  startBlock: number,
  endBlock: number
): Promise<NormalizedTx[]>
```

donde `NormalizedTx` es idéntico a `RawTx` con `source: 'BSCTRACE'`.

**Requisitos:**

- MUST llamar a `https://api.bsctrace.com/` (o endpoint configurado via `BSCTRACE_API_URL`) con body JSON-RPC 2.0:
  ```json
  {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "nr_getAssetTransfers",
    "params": [{
      "fromBlock": "0x<hex>",
      "toBlock": "0x<hex>",
      "address": "<address>",
      "category": ["external", "erc20"],
      "maxCount": "0x3e8",
      "withMetadata": true,
      "excludeZeroValue": true
    }]
  }
  ```
- MUST convertir `startBlock`/`endBlock` a hex con `'0x' + n.toString(16)`.
- MUST lanzar `ExternalApiError('bsctrace', cause)` en error de red, respuesta con campo `error`, o resultado no parseable.
- MUST retornar `[]` si `result.transfers` es vacío.
- MUST normalizar cada transfer a `RawTx` con la misma forma que `EtherscanClient` produce — modulo address checksum (todo lowercase). Esto garantiza que `classifyAndDecomposeTransaction` recibe un contrato único.

### 7.2 Forma normalizada de BSCTrace → RawTx

| Campo BSCTrace | Campo RawTx | Transformación |
|---|---|---|
| `hash` | `hash` | `.toLowerCase()` |
| `blockNum` (hex string) | `blockNumber` | `parseInt(hex, 16)` |
| `metadata.blockTimestamp` | `timestamp` | timestamp unix |
| `from` | `from` | `.toLowerCase()` |
| `to` | `to` | `.toLowerCase()` |
| `value` (decimal string) | `value` | as-is |
| `rawContract.address` | `tokenAddress` | `.toLowerCase()` o `null` si external ETH |
| `asset` | `tokenSymbol` | as-is |
| `rawContract.decimal` | `tokenDecimals` | `parseInt` o `null` |
| `'BSCTRACE'` | `source` | literal |

`isError` MUST ser `false` por defecto (BSCTrace no expone error flag en este endpoint; txs fallidas son excluidas con `excludeZeroValue` y validación upstream).

---

## 8. OnChainSyncService

```typescript
// apps/backend/src/services/sync/on-chain-sync.ts

new OnChainSyncService({
  pool: Pool,
  priceService: PriceService,
  etherscanClient: OnChainApiClient,
  bsctraceClient: OnChainApiClient,
})
```

### 8.1 `sync(walletId: string): Promise<SyncResult>`

**Responsabilidades:**

1. Cargar wallet por `walletId`. Si no existe → `NotFoundError`.
2. Verificar `wallet.wallet_type === 'ON_CHAIN'`. Si no → `ValidationError('Wallet is not an on-chain wallet')`.
3. Verificar env var según `wallet.network`:
   - `ETH` → `process.env.ETHERSCAN_API_KEY` presente → sino `ApiKeyMissingError('ETHERSCAN_API_KEY')`.
   - `BSC` → `process.env.BSCTRACE_API_KEY` presente → sino `ApiKeyMissingError('BSCTRACE_API_KEY')`.
4. Llamar a `fetchAllTransactions(wallet, wallet.last_synced_block + 1)`.
5. Agrupar `RawTx[]` por `hash` → `TxGroup[]`.
6. Para cada grupo: `classifyAndDecomposeTransaction(group)` → `ClassifiedTx[]`.
7. Ordenar todo por `(blockNumber, transactionIndex, txLogIndex) ASC`.
8. Para cada `ClassifiedTx`, dentro de un `BEGIN/COMMIT` por lote:
   a. `ensureToken(network, contractAddress, symbol, decimals)` → `tokenId`.
   b. Si `type === 'TRANSFER_IN'`: `resolveTransferCost(txHash, from, tokenId)` → `CostResolution`.
   c. `positionRepo.findOpen(walletId, tokenId)` → posición actual.
   d. `positionRepo.countClosed(walletId, tokenId)` → `priorClosedCycles`.
   e. `PositionEngine.processTransaction({ position, priorClosedCycles, transaction, positionIdentity })`.
   f. UPSERT posición; INSERT transacción con `ON CONFLICT (tx_hash, tx_log_index) DO NOTHING`.
   g. `rowCount === 1` → `synced++`; `rowCount === 0` → `skipped++`.
9. Actualizar `wallets.last_synced_block = maxBlockSeen`.
10. Retornar `SyncResult` con las últimas 10 transacciones del sync ordenadas por `block_timestamp DESC`.

### 8.2 `fetchAllTransactions(wallet: Wallet, fromBlock: number): Promise<RawTx[]>`

**Requisitos:**

- Selecciona el client según `wallet.network`: `etherscanClient` para `'ETH'`, `bsctraceClient` para `'BSC'`.
- Para Etherscan: llama `fetchTxList` + `fetchTokenTx` en paralelo para el mismo rango.
- Concatena ambas listas (o la lista única de BSCTrace).
- **Paginación**: si `result.length === 1000`, re-query con `startBlock = lastBlockInBatch - 1` hasta que `result.length < 1000`.
- MUST acumular todos los lotes en un array y retornar el conjunto completo.
- El set resultante puede contener duplicados de la frontera — son manejados por `ON CONFLICT DO NOTHING` en el insert.

### 8.3 `classifyAndDecomposeTransaction(txGroup: TxGroup): ClassifiedTx[]`

**Requisitos:**

- MUST inspeccionar todas las `RawTx` del grupo (mismo `hash`).
- **Detección de SWAP**: si cualquier tx en el grupo tiene `to.toLowerCase()` en `SWAP_ROUTERS[network]` (o viene de un router en el caso de token-to-token).
- **Descomposición de SWAP**:
  - Generar dos UUIDs: `uuidOut`, `uuidIn`.
  - Identificar leg outbound (`from === walletAddress`) y leg inbound (`to === walletAddress`).
  - Producir: `SWAP_OUT` con `{ id: uuidOut, txLogIndex: 0, relatedId: uuidIn }` y `SWAP_IN` con `{ id: uuidIn, txLogIndex: 1, relatedId: uuidOut }`.
  - Token-to-token swap: ambas legs aparecen en `tokentx` del mismo hash — misma lógica.
- **Clasificación no-SWAP**:
  - `from === walletAddress` y no hay token → `TRANSFER_OUT` o `SELL` (ver regla siguiente).
  - `to === walletAddress` y no hay token → `TRANSFER_IN` o `BUY`.
  - Heurística BUY/SELL vs TRANSFER: si `from` o `to` está en `SWAP_ROUTERS` → SWAP (ya cubierto). Si counterparty es dirección de contrato → BUY/SELL. Si counterparty es EOA externa → TRANSFER.
- **Filtro de errores**: `RawTx` con `isError=true` MUST ser descartadas, no clasificadas.
- MUST retornar `ClassifiedTx[]` (1 fila para no-SWAP, 2 filas para SWAP).

### 8.4 `resolveTransferCost(txHash: string, fromAddress: string, tokenId: string): Promise<CostResolution>`

Resolución de WAC en 3 pasos para `TRANSFER_IN` (per PRD `rules → TRANSFER_IN COST RESOLUTION`):

**Paso 1 — On-chain wallet con posición OPEN:**
```sql
SELECT p.wac
FROM positions p
JOIN wallets w ON w.id = p.wallet_id
WHERE w.address = $fromAddress
  AND w.wallet_type = 'ON_CHAIN'
  AND p.token_id = $tokenId
  AND p.status = 'OPEN'
LIMIT 1
```
Si retorna fila → `{ priceUsd: wac, costSource: 'INHERITED', inheritedFrom: 'ON_CHAIN' }`.

**Paso 2 — TRANSFER_OUT de Binance con mismo tx_hash:**
```sql
SELECT p.wac
FROM transactions t
JOIN positions p ON p.id = t.position_id
WHERE t.source = 'BINANCE'
  AND t.type = 'TRANSFER_OUT'
  AND t.tx_hash = $txHash
  AND t.token_id = $tokenId
LIMIT 1
```
Si retorna fila → `{ priceUsd: wac, costSource: 'INHERITED', inheritedFrom: 'CEX' }`.

**Paso 3 — Fallback manual:**
→ `{ priceUsd: null, costSource: 'MANUAL', inheritedFrom: null }`.

MUST ejecutar los pasos en orden secuencial. Si paso 1 resuelve, MUST NOT ejecutar paso 2. MUST NOT loguear WAC valores en producción.

---

## 9. Route: POST /api/sync/:walletId

```typescript
// apps/backend/src/routes/sync.ts

export const syncRoutes: FastifyPluginAsync = async (fastify) => { ... }
```

### 9.1 Request

```
POST /api/sync/:walletId
Authorization: Bearer <jwt>
Content-Type: application/json
```

**Path params:**
```typescript
const WalletIdParamSchema = z.object({
  walletId: z.uuid(),
})
```

No hay body ni query params.

### 9.2 Auth

El middleware JWT global (instalado con `prefix: '/api/*'`) protege esta ruta. El plugin MUST NOT agregar `preHandler` de auth redundante. Si el JWT está ausente o inválido → `401` del middleware global antes de llegar al handler.

El handler MUST extraer `userId` de `request.user.sub` y verificar que `wallet.user_id === userId`. Si no coincide → `NotFoundError` (no revelar existencia de wallets de otros usuarios).

### 9.3 Validación

```typescript
fastify.withTypeProvider<ZodTypeProvider>().post(
  '/:walletId',
  {
    schema: {
      params: WalletIdParamSchema,
      response: { 200: SyncResultSchema },
    },
  },
  async (req) => service.sync(req.params.walletId, req.user.sub)
)
```

`fastify-type-provider-zod` valida `walletId` como UUID antes de llegar al handler. Si el formato no es UUID → `400` automático.

### 9.4 Respuestas HTTP

| Condición | Status | Body |
|---|---|---|
| Sync exitoso | 200 | `SyncResult` |
| JWT ausente o inválido | 401 | middleware global |
| `walletId` no es UUID | 400 | Zod validation error |
| Wallet no encontrada o no pertenece al usuario | 404 | `{ statusCode: 404, error: 'Not Found', message: 'Wallet not found' }` |
| Wallet es CEX | 400 | `{ statusCode: 400, error: 'Bad Request', message: 'Wallet is not an on-chain wallet' }` |
| `ETHERSCAN_API_KEY` no configurada (wallet ETH) | 400 | `{ statusCode: 400, code: 'API_KEY_MISSING', message: 'ETHERSCAN_API_KEY is not configured' }` |
| `BSCTRACE_API_KEY` no configurada (wallet BSC) | 400 | `{ statusCode: 400, code: 'API_KEY_MISSING', message: 'BSCTRACE_API_KEY is not configured' }` |
| Falla HTTP de Etherscan / BSCTrace | 502 | `{ statusCode: 502, code: 'EXTERNAL_API_ERROR', message: 'External API error: etherscan' }` |
| Error Postgres no controlado | 500 | handler global de Fastify |

---

## 10. SyncResultSchema (Zod 4)

```typescript
// co-locado con el tipo en on-chain-sync.ts o types/sync.ts

import { z } from 'zod'
import { TransactionSchema } from '../types/transaction.js'

export const SyncResultSchema = z.object({
  synced: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  swapsDecomposed: z.number().int().nonnegative(),
  transfersPendingCost: z.number().int().nonnegative(),
  transfersInheritedFromCEX: z.number().int().nonnegative(),
  newTransactions: z.array(TransactionSchema).max(10),
})

export type SyncResult = z.infer<typeof SyncResultSchema>
```

`newTransactions` MUST contener solo las transacciones insertadas en el sync actual (no históricas), ordenadas por `block_timestamp DESC`, máximo 10.

---

## 11. Errores de dominio nuevos

Agregar a `apps/backend/src/services/errors.ts`:

```typescript
export class ApiKeyMissingError extends DomainError {
  readonly statusCode = 400
  readonly code = 'API_KEY_MISSING'

  constructor(envVarName: string) {
    super(`${envVarName} is not configured`)
    this.name = 'ApiKeyMissingError'
  }
}

export class ExternalApiError extends DomainError {
  readonly statusCode = 502
  readonly code = 'EXTERNAL_API_ERROR'

  constructor(
    serviceName: string,
    readonly cause?: unknown
  ) {
    super(`External API error: ${serviceName}`)
    this.name = 'ExternalApiError'
  }
}
```

`ExternalApiError` MUST NOT loguear el `cause` completo si contiene API keys. El log MUST incluir solo `serviceName` y un mensaje genérico.

---

## 12. Registro en index.ts

```typescript
// apps/backend/src/index.ts — agregar después de authPlugin y antes del arranque del servidor
import { syncRoutes } from './routes/sync.js'

await fastify.register(syncRoutes, { prefix: '/api/sync' })
```

El registro MUST ocurrir DESPUÉS de `authPlugin` para que el middleware JWT esté activo.

---

## 13. Escenarios de test

### SCENARIO pagination — `fetchAllTransactions` con 1000 + 50 resultados

**Proyecto:** `engine` (sin DB)  
**Archivo:** `__tests__/pagination.test.ts`

- GIVEN un `OnChainApiClient` mock que retorna 1000 filas en el primer call (bloque 1..5000) y 50 filas en el segundo call (bloque 4999..5050)
- WHEN `fetchAllTransactions(wallet, 1)` es llamado
- THEN el mock fue invocado exactamente 2 veces
- AND el segundo call tiene `startBlock = 4999` (lastBlock del primer batch - 1)
- AND el resultado acumulado tiene 1050 filas en total (duplicados de frontera sin deduplicar en memoria — deduplicación es responsabilidad de `ON CONFLICT`)
- AND no se realizaron más de 2 llamadas al mock

### SCENARIO bsctrace-normalize — respuesta JSON-RPC 2.0 normalizada igual a Etherscan

**Proyecto:** `engine`  
**Archivo:** `__tests__/bsctrace-normalize.test.ts`

- GIVEN un fixture fijo de respuesta `nr_getAssetTransfers` (2 transfers: 1 BNB nativo, 1 ERC20)
- AND un fixture fijo de respuesta `etherscan tokentx` equivalente (mismas 2 transacciones)
- WHEN ambos son normalizados a `RawTx[]`
- THEN los arrays resultantes son iguales modulo case de address (todos lowercase)
- AND campos como `source` difieren esperadamente (`'BSCTRACE'` vs `'ETHERSCAN'`)

### SCENARIO classify-decompose — BUY + SWAP + TRANSFER_IN

**Proyecto:** `engine`  
**Archivo:** `__tests__/classify-decompose.test.ts`

- GIVEN un array de 3 `TxGroup`:
  - Grupo 1: 1 raw tx con `to=walletAddress`, counterparty es EOA → `TRANSFER_IN`
  - Grupo 2: 1 raw tx con `from=walletAddress`, counterparty es contrato (exchange/CEX) → `BUY`
  - Grupo 3: 2 raw txs mismo hash con router presente → SWAP
- WHEN `classifyAndDecomposeTransaction()` es llamado por grupo
- THEN Grupo 1 → 1 `ClassifiedTx` con `type='TRANSFER_IN'`, `txLogIndex=0`
- AND Grupo 2 → 1 `ClassifiedTx` con `type='BUY'`, `txLogIndex=0`
- AND Grupo 3 → 2 `ClassifiedTx` con `type='SWAP_OUT'` (`txLogIndex=0`) y `type='SWAP_IN'` (`txLogIndex=1`)
- AND `SWAP_OUT.relatedId === SWAP_IN.id`
- AND `SWAP_IN.relatedId === SWAP_OUT.id`

**Caso adicional — token-to-token swap:**
- GIVEN Grupo 4: 2 raw txs en `tokentx` del mismo hash, counterparty es router en ambos
- WHEN `classifyAndDecomposeTransaction(grupo4)` es llamado
- THEN retorna 2 `ClassifiedTx` con la misma lógica SWAP_OUT/SWAP_IN

### SCENARIO cex-inheritance — `resolveTransferCost` hereda WAC de Binance

**Proyecto:** `sync` (requiere DB)  
**Archivo:** `tests/sync-transfer-cost.test.ts`

**Sub-escenario A — on-chain wallet con posición OPEN:**
- GIVEN existe wallet `WA` on-chain con posición OPEN de `tokenId=T1`, `wac='2000.00'`
- AND `fromAddress = WA.address`
- WHEN `resolveTransferCost(txHash, WA.address, T1)`
- THEN retorna `{ priceUsd: '2000.00', costSource: 'INHERITED', inheritedFrom: 'ON_CHAIN' }`

**Sub-escenario B — TRANSFER_OUT de Binance con mismo tx_hash:**
- GIVEN existe transacción con `source='BINANCE'`, `type='TRANSFER_OUT'`, `tx_hash=X`, `token_id=T1`, posición con `wac='1500.00'`
- AND NO existe wallet on-chain con `address=fromAddress`
- WHEN `resolveTransferCost(X, fromAddress, T1)`
- THEN retorna `{ priceUsd: '1500.00', costSource: 'INHERITED', inheritedFrom: 'CEX' }`

**Sub-escenario C — posición on-chain CLOSED cae al paso 2 y luego a MANUAL:**
- GIVEN existe wallet `WC` on-chain con posición `CLOSED` de `tokenId=T1`
- AND NO existe transacción Binance con `tx_hash=Y`
- WHEN `resolveTransferCost(Y, WC.address, T1)`
- THEN retorna `{ priceUsd: null, costSource: 'MANUAL', inheritedFrom: null }`

**Sub-escenario D — sin match en ningún paso:**
- GIVEN `fromAddress` no pertenece a ningún wallet registrado
- AND no existe ninguna tx Binance con ese `txHash`
- WHEN `resolveTransferCost(txHash, fromAddress, tokenId)`
- THEN retorna `{ priceUsd: null, costSource: 'MANUAL', inheritedFrom: null }`

### SCENARIO idempotency — sync 2 veces no produce duplicados

**Proyecto:** `e2e`  
**Archivo:** `tests/e2e-sync.test.ts`

- GIVEN wallet ETH on-chain con `last_synced_block=0`
- AND mock HTTP que retorna 5 transacciones en bloque 100..200
- WHEN `POST /api/sync/:walletId` es llamado 2 veces consecutivas
- THEN en el primer call: `synced=5, skipped=0`
- AND en el segundo call: `synced=0, skipped=5`
- AND la tabla `transactions` tiene exactamente 5 filas para ese wallet (sin duplicados)

---

## 14. Escenarios NEGATIVOS

Estos casos mapean a `acceptanceCriteria → NEGATIVE:` del PRD. Son **obligatorios** en los tests e2e.

### NEGATIVE-SYNC-01: wallet no encontrada o no pertenece al usuario → 404

**Proyecto:** `e2e`

- GIVEN wallet `W_other` pertenece a otro usuario
- AND usuario autenticado como `U1`
- WHEN `POST /api/sync/W_other`
- THEN `404 { statusCode: 404, error: 'Not Found', message: 'Wallet not found' }`
- AND no se realiza ningún call HTTP a Etherscan/BSCTrace

**Variante — wallet inexistente:**
- GIVEN `walletId` es UUID válido pero no existe en DB
- WHEN `POST /api/sync/:walletId`
- THEN `404`

### NEGATIVE-SYNC-02: wallet CEX → 400

**Proyecto:** `e2e`

- GIVEN existe wallet `W_cex` con `wallet_type='CEX'` perteneciente al usuario autenticado
- WHEN `POST /api/sync/W_cex`
- THEN `400 { statusCode: 400, error: 'Bad Request', message: 'Wallet is not an on-chain wallet' }`
- AND no se realiza ningún call HTTP a Etherscan/BSCTrace

### NEGATIVE-SYNC-03: ETHERSCAN_API_KEY ausente → 400

**Proyecto:** `e2e`

- GIVEN existe wallet ETH (`network='ETH'`) perteneciente al usuario
- AND `ETHERSCAN_API_KEY` no está presente en el entorno (`delete process.env.ETHERSCAN_API_KEY`)
- WHEN `POST /api/sync/:walletId`
- THEN `400 { statusCode: 400, code: 'API_KEY_MISSING', message: 'ETHERSCAN_API_KEY is not configured' }`
- AND el check ocurre ANTES de cualquier llamada HTTP (fail-fast)

### NEGATIVE-SYNC-04: BSCTRACE_API_KEY ausente → 400

**Proyecto:** `e2e`

- GIVEN existe wallet BSC (`network='BSC'`) perteneciente al usuario
- AND `BSCTRACE_API_KEY` no está presente en el entorno
- WHEN `POST /api/sync/:walletId`
- THEN `400 { statusCode: 400, code: 'API_KEY_MISSING', message: 'BSCTRACE_API_KEY is not configured' }`

### NEGATIVE-SYNC-05: falla HTTP de API externa → 502

**Proyecto:** `e2e`

- GIVEN wallet ETH válida con `ETHERSCAN_API_KEY` presente
- AND mock HTTP de Etherscan retorna status 500 o lanza `TypeError: fetch failed`
- WHEN `POST /api/sync/:walletId`
- THEN `502 { statusCode: 502, code: 'EXTERNAL_API_ERROR', message: 'External API error: etherscan' }`
- AND el API key NO aparece en el log ni en el body de respuesta

### NEGATIVE-SYNC-06: walletId con formato inválido (no UUID) → 400

**Proyecto:** `e2e`

- GIVEN `walletId = 'not-a-uuid'`
- WHEN `POST /api/sync/not-a-uuid`
- THEN `400` con error de validación Zod (antes de llegar al service)

### NEGATIVE-SYNC-07: JWT ausente → 401

**Proyecto:** `e2e`

- GIVEN request sin header `Authorization`
- WHEN `POST /api/sync/:walletId`
- THEN `401` del middleware JWT global (el handler no es alcanzado)

---

## Mapa de cobertura AC → Escenario

| AC | Escenario que lo satisface |
|---|---|
| 1 — 400 si wallet CEX | `NEGATIVE-SYNC-02` |
| 2 — Etherscan v2 chainid=1 txlist+tokentx | `EtherscanClient §6` + `SCENARIO bsctrace-normalize` |
| 3 — BSCTrace nr_getAssetTransfers JSON-RPC | `BSCTraceClient §7` + `SCENARIO bsctrace-normalize` |
| 4 — Paginación 1000+ con re-query | `SCENARIO pagination` |
| 5 — Router detection + SWAP decomposition | `SCENARIO classify-decompose` |
| 6 — 3-step resolveTransferCost | `SCENARIO cex-inheritance` sub-escenarios A..D |
| 7 — Idempotent ON CONFLICT | `SCENARIO idempotency` |
| 8 — Actualiza last_synced_block | `SCENARIO idempotency` (verifica `wallets.last_synced_block`) |
| 9 — Response shape SyncResult | `SyncResultSchema §10` + e2e happy path |
| 10 — Test unitario 1000+50 | `SCENARIO pagination` (engine) |
| 11 — BSCTrace mock = Etherscan shape | `SCENARIO bsctrace-normalize` (engine) |
| 12 — Test CEX inheritance | `SCENARIO cex-inheritance` (sync, DB) |
| 13 — 400 si ETHERSCAN_API_KEY ausente | `NEGATIVE-SYNC-03` |
| 14 — 400 si BSCTRACE_API_KEY ausente | `NEGATIVE-SYNC-04` |
