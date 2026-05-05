# Spec — US-007 · PriceService + PortfolioService

> **Change:** `US-007-portfolio-api`
> **Capability:** PriceService (TTL cache + proveedores externos) y PortfolioService (agregación WAC multi-wallet, P&L no realizado, historial de ciclos)
> **Estado:** finalizado
> **Última revisión:** 2026-05-05

---

## Índice

1. [Alcance](#1-alcance)
2. [Tipos de dominio](#2-tipos-de-dominio)
3. [Invariantes del dominio](#3-invariantes-del-dominio)
4. [PriceService](#4-priceservice)
5. [PortfolioService.getPortfolioSummary](#5-portfolioservicegetportfoliosummary)
6. [PortfolioService.getTokenDetail](#6-portfolioservicegettokendetail)
7. [PortfolioService.getTokenCycleHistory](#7-portfolioservicegettokencyclehistory)
8. [TokenService.findByContractAddress](#8-tokenservicefindbycontractaddress)
9. [Escenarios NEGATIVOS](#9-escenarios-negativos)

---

## 1. Alcance

Esta spec cubre la capa de servicios para la lectura y presentación del portafolio. Las validaciones HTTP y esquemas Zod de las rutas se especifican en `specs/portfolio-routes/spec.md`.

Archivos afectados:

| Archivo | Acción |
|---------|--------|
| `apps/backend/src/services/price.ts` | NUEVO |
| `apps/backend/src/services/portfolio.ts` | NUEVO |
| `apps/backend/src/services/token.ts` | MODIFICADO — agrega `findByContractAddress` |
| `apps/backend/src/types/portfolio.ts` | NUEVO |
| `apps/backend/src/services/__tests__/price.test.ts` | NUEVO |
| `apps/backend/src/services/__tests__/portfolio.test.ts` | NUEVO |

**No incluye:** sincronización automática de transacciones (Etherscan, BSCTrace, Binance privada), persistencia de snapshots históricos de precio, validación de balance vs Binance accountSnapshot, conversión de dust.

---

## 2. Tipos de dominio

```typescript
// apps/backend/src/types/portfolio.ts

import { z } from 'zod';
import type { TokenNetwork } from '../db/types.js'; // 'ETH' | 'BSC' | 'CEX_BINANCE'

// --- WalletBreakdown ---
export const WalletBreakdownSchema = z.object({
  walletId: z.string(),
  label: z.string().nullable(),
  balance: z.string(),    // DecimalString
  wac: z.string(),        // DecimalString
});
export type WalletBreakdown = z.infer<typeof WalletBreakdownSchema>;

// --- PortfolioTokenRow ---
export const PortfolioTokenRowSchema = z.object({
  symbol: z.string(),
  network: z.enum(['ETH', 'BSC', 'CEX_BINANCE']),
  sourceType: z.enum(['ON_CHAIN', 'CEX']),
  contractAddress: z.string(),
  totalBalance: z.string(),         // DecimalString — suma de balances de todas las wallets
  currentPrice: z.string().nullable(),   // null cuando priceUnavailable
  totalCurrentValue: z.string().nullable(), // null cuando priceUnavailable
  wacAggregated: z.string(),        // DecimalString — WAC ponderado entre wallets
  totalCostBasis: z.string(),       // DecimalString — suma directa de cost_basis
  pnlUsd: z.string().nullable(),    // null cuando priceUnavailable
  pnlPct: z.string().nullable(),    // null cuando priceUnavailable
  walletCount: z.number().int(),
  walletBreakdown: z.array(WalletBreakdownSchema),
  priceUnavailable: z.boolean().optional(), // presente y true cuando el precio no pudo obtenerse
});
export type PortfolioTokenRow = z.infer<typeof PortfolioTokenRowSchema>;

// --- PortfolioSummary ---
export const PortfolioSummarySchema = z.object({
  totalValueUsd: z.string(),        // DecimalString — suma de totalCurrentValue de tokens con precio
  totalCostBasis: z.string(),       // DecimalString — suma de totalCostBasis de todos los tokens
  totalPnlUsd: z.string(),          // DecimalString — suma de pnlUsd de tokens con precio
  totalPnlPct: z.string().nullable(), // null si totalCostBasis es 0
  tokens: z.array(PortfolioTokenRowSchema),
});
export type PortfolioSummary = z.infer<typeof PortfolioSummarySchema>;

// --- EnrichedTransaction (per-lot P&L) ---
export const LotPnlSchema = z.object({
  lotPnlUsd: z.string().nullable(),  // null si price_usd original es null o priceUnavailable
  lotPnlPct: z.string().nullable(),
});

export const EnrichedTransactionSchema = z.object({
  id: z.string(),
  type: z.enum(['BUY', 'SELL', 'SWAP_IN', 'SWAP_OUT', 'TRANSFER_IN', 'TRANSFER_OUT']),
  amount: z.string(),
  priceUsd: z.string().nullable(),
  blockTimestamp: z.string(),        // ISO-8601
  lotPnl: LotPnlSchema.nullable(),   // null para outbound (SELL/SWAP_OUT/TRANSFER_OUT)
  displayAs: z.enum(['Sold/Out']).optional(), // presente para outbound
});
export type EnrichedTransaction = z.infer<typeof EnrichedTransactionSchema>;

// --- TokenDetail ---
export const TokenDetailSchema = z.object({
  token: z.object({
    id: z.string(),
    symbol: z.string(),
    network: z.enum(['ETH', 'BSC', 'CEX_BINANCE']),
    contractAddress: z.string(),
  }),
  position: z.object({
    id: z.string(),
    cycleNumber: z.number().int(),
    status: z.enum(['OPEN', 'CLOSED']),
    wac: z.string(),
    balance: z.string(),
    costBasis: z.string(),
    currentPrice: z.string().nullable(),
    currentValue: z.string().nullable(),
    unrealizedPnlUsd: z.string().nullable(),
    unrealizedPnlPct: z.string().nullable(),
    openedAt: z.string(),
  }).nullable(),  // null si no hay posición OPEN
  transactions: z.array(EnrichedTransactionSchema),
  priceUnavailable: z.boolean().optional(),
});
export type TokenDetail = z.infer<typeof TokenDetailSchema>;

// --- CycleHistory ---
export const CycleHistorySchema = z.object({
  cycleNumber: z.number().int(),
  openedAt: z.string(),         // ISO-8601
  closedAt: z.string(),         // ISO-8601 — siempre presente en ciclos CLOSED
  realizedPnlUsd: z.string(),   // DecimalString
});
export type CycleHistory = z.infer<typeof CycleHistorySchema>;

export const CycleHistoryResponseSchema = z.object({
  cycles: z.array(CycleHistorySchema),
});
```

---

## 3. Invariantes del dominio

### INV-P-1 — Precio no disponible nunca lanza 500

> **Si cualquier llamada a un proveedor externo de precios falla (red, timeout, status no-2xx, body inesperado), el servicio MUST retornar `null` para ese token. El caller MUST incluir `priceUnavailable: true` en la fila correspondiente. La respuesta HTTP MUST ser 200 en todos los casos.**

### INV-P-2 — ETH on-chain ≠ ETH Binance

> **Tokens con `network ∈ {ETH, BSC}` y tokens con `network = 'CEX_BINANCE'` son identidades distintas. MUST NOT ser agregados entre sí bajo ninguna circunstancia, aunque tengan el mismo `symbol`.**

La separación se garantiza a nivel de agrupación en `PortfolioService`: el key de agrupación es `(contract_address, network)`. `CEX_BINANCE` ya separa naturalmente porque `network` difiere, pero la implementación MUST agregar solo posiciones con el mismo `(contract_address, network)` para ON_CHAIN y MUST NOT agregar CEX con ON_CHAIN aunque el `contract_address` coincida con el `symbol`.

### INV-P-3 — WAC agregado con decimal.js

> **El WAC ponderado entre wallets MUST calcularse usando `decimal.js` exclusivamente. MUST NOT usar operadores nativos de JS (`+`, `-`, `*`, `/`) sobre strings de balances o WAC. MUST usar `toDecimal()` y `roundToStorage()` de `position-engine/decimal-utils.ts`.**

Fórmula:
```
wacAggregated = Σ(balance_i × wac_i) / Σ(balance_i)
```
donde cada operación es una llamada a métodos de `Decimal`.

### INV-P-4 — WAC solo se recalcula en inbound

> **PortfolioService LEE el WAC almacenado en `positions.wac` tal como fue escrito por el PositionEngine. MUST NOT recalcular WAC desde las transacciones. El WAC persisted es la fuente de verdad.**

### INV-P-5 — Ciclos CLOSED quedan congelados

> **Los ciclos cerrados tienen `realized_pnl_usd` inmutable. PortfolioService MUST leerlos tal cual del DB sin modificarlos ni recomputarlos.**

### INV-P-6 — PriceService es singleton de proceso

> **El cache TTL vive en memoria a nivel módulo (no en clase instanciada). Múltiples llamadas dentro del TTL MUST retornar el valor cacheado sin nueva request HTTP.**

---

## 4. PriceService

### Contrato

```typescript
// apps/backend/src/services/price.ts

type CacheEntry = { priceUsd: string; expiresAt: number };

// Constantes
const TTL_DEFILLAMA_MS = 60_000;   // 60 segundos
const TTL_BINANCE_MS   = 10_000;   // 10 segundos
const FETCH_TIMEOUT_MS = 5_000;    // 5 segundos — AbortController

// API pública
export async function getPriceForToken(token: Token): Promise<string | null>;
export async function getPricesForTokens(tokens: Token[]): Promise<Map<string, string | null>>;

// Solo para tests (build dev/test)
export function __resetCacheForTests(): void;
```

**Cache keys:**
- ON_CHAIN: `onchain:${network.toLowerCase()}:${contractAddress.toLowerCase()}`
- CEX: `cex:${binanceSymbol.toUpperCase()}`

**Chain mapping (DefiLlama):**
- `ETH` → `ethereum`
- `BSC` → `bsc`

**URL de proveedores:**
- DefiLlama bulk: `GET https://coins.llama.fi/prices/current/{chain}:{address},{chain}:{address},...`
- Binance ticker: `GET https://api.binance.com/api/v3/ticker/price?symbol={binanceSymbol}USDT`

**Validación de respuestas con Zod:**

```typescript
const DefiLlamaResponseSchema = z.object({
  coins: z.record(z.object({
    price: z.number(),
    symbol: z.string().optional(),
    decimals: z.number().optional(),
    timestamp: z.number().optional(),
  }))
});

const BinanceTickerResponseSchema = z.object({
  symbol: z.string(),
  price: z.string(),
});
```

Si `safeParse` falla → `null` + `log.warn` con body crudo truncado a 500 caracteres.

**`getPricesForTokens` — estrategia bulk:**
1. Separar tokens en grupos: ON_CHAIN vs CEX.
2. Para ON_CHAIN con cache miss: construir una sola URL con todos los coins (`ethereum:0x...,bsc:0x...`). Una sola request HTTP al lote completo.
3. Para CEX con cache miss: `Promise.all(tokens.map(t => getCexPrice(t.binance_symbol)))`. Paralelo, no secuencial.
4. Para cada token con cache hit: retornar valor cacheado sin HTTP.
5. Retornar `Map<cacheKey, string | null>`.

#### SC-PRICE-01: DefiLlama bulk — éxito

**Given**: 2 tokens ON_CHAIN (`ETH:0xAAA`, `BSC:0xBBB`) sin entrada en cache  
**When**: se llama `getPricesForTokens([tokenA, tokenB])`  
**Then**: se dispara 1 sola request HTTP a DefiLlama con ambas coins en la URL  
AND retorna `Map` con ambas prices como DecimalString  
AND ambas entradas quedan en cache con TTL 60s

#### SC-PRICE-02: Binance ticker — éxito

**Given**: token CEX con `binance_symbol = 'ETH'`, sin cache  
**When**: se llama `getPriceForToken(cexToken)`  
**Then**: request a `https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT`  
AND retorna el campo `price` como string  
AND entrada en cache con TTL 10s

#### SC-PRICE-03: Cache hit — no segunda request

**Given**: token con entrada en cache cuyo `expiresAt > Date.now()`  
**When**: se llama `getPriceForToken(token)` dos veces dentro del TTL  
**Then**: solo se dispara 1 request HTTP en total  
AND la segunda llamada retorna el valor cacheado

#### SC-PRICE-04: Cache expirado — nueva request

**Given**: token con entrada en cache cuyo `expiresAt < Date.now()`  
**When**: se llama `getPriceForToken(token)`  
**Then**: se dispara nueva request HTTP  
AND la cache se actualiza con nuevo `expiresAt`

#### SC-PRICE-05: fetch rechaza (red caída)

**Given**: `fetch` lanza `TypeError: fetch failed`  
**When**: se llama `getPriceForToken(token)`  
**Then**: retorna `null`  
AND se emite `log.warn` con `{ source: 'DefiLlama'|'Binance', error: string }`  
AND NO lanza excepción al caller

#### SC-PRICE-06: Status 4xx/5xx

**Given**: DefiLlama responde con `status=429`  
**When**: se llama `getPriceForToken(onChainToken)`  
**Then**: retorna `null`  
AND se emite `log.warn` con `{ status: 429, source: 'DefiLlama' }`

#### SC-PRICE-07: Body inesperado — Zod parse falla

**Given**: DefiLlama responde `{ unexpected: true }` (schema inválido)  
**When**: se llama `getPriceForToken(token)`  
**Then**: `DefiLlamaResponseSchema.safeParse` retorna `success: false`  
AND retorna `null`  
AND se emite `log.warn` con body truncado

#### SC-PRICE-08: Timeout — AbortController dispara

**Given**: DefiLlama tarda más de 5s  
**When**: se llama `getPriceForToken(token)` con `AbortController` de 5s  
**Then**: fetch es abortado, retorna `null`  
AND se emite `log.warn` con `{ source: 'DefiLlama', error: 'timeout' }`

#### SC-PRICE-09: NEGATIVE — token CEX sin binance_symbol

**Given**: token con `network='CEX_BINANCE'` y `binance_symbol=null`  
**When**: se llama `getPriceForToken(cexToken)`  
**Then**: retorna `null` SIN llamar a fetch  
AND se emite `log.warn` con `{ reason: 'CEX_TOKEN_MISSING_BINANCE_SYMBOL', tokenId }`

---

## 5. PortfolioService.getPortfolioSummary

### Contrato

```typescript
export async function getPortfolioSummary(pool: Pool): Promise<PortfolioSummary>;
```

### Query DB

Una sola query JOIN (`positions ⨝ tokens ⨝ wallets`) para evitar N+1:

```sql
SELECT
  p.id          AS position_id,
  p.wallet_id,
  p.wac,
  p.balance,
  p.cost_basis,
  p.realized_pnl_usd,
  t.id          AS token_id,
  t.symbol,
  t.network,
  t.contract_address,
  t.binance_symbol,
  w.wallet_type,
  w.label       AS wallet_label
FROM positions p
JOIN tokens  t ON t.id = p.token_id
JOIN wallets w ON w.id = p.wallet_id
WHERE p.status = 'OPEN'
ORDER BY t.network, t.contract_address, t.symbol
```

### Agrupación ON_CHAIN

Clave de grupo: `${network}:${contract_address.toLowerCase()}` SOLO para filas donde `w.wallet_type = 'ON_CHAIN'`.

Para cada grupo:
```
totalBalance    = Σ toDecimal(p.balance)
wacAggregated   = Σ(toDecimal(p.balance) × toDecimal(p.wac)) / totalBalance
totalCostBasis  = Σ toDecimal(p.cost_basis)
walletBreakdown = [{ walletId, label, balance, wac }] por cada posición
walletCount     = breakown.length
```

Todas las operaciones MUST usar `decimal.js`. El resultado final MUST pasar por `roundToStorage()`.

### Filas CEX

Las filas con `w.wallet_type = 'CEX'` (o `t.network = 'CEX_BINANCE'`) NEVER se agregan. Cada posición OPEN CEX genera una fila independiente con `walletCount=1`.

**Guard:** Si `totalBalance === '0.000000000000000000'` (valor `ZERO` de `roundToStorage`) la fila MUST ser excluida del resultado. Esto no debería ocurrir con posiciones OPEN, pero MUST ser defendido.

### Fetch de precios

```typescript
const uniqueTokens = deduplicateByPriceKey(allOpenPositions);
const priceMap = await getPricesForTokens(uniqueTokens);
```

Para ON_CHAIN: key = `onchain:${network.toLowerCase()}:${contractAddress.toLowerCase()}`  
Para CEX: key = `cex:${binanceSymbol?.toUpperCase() ?? 'MISSING'}`

Si el token está en el mapa con `null` → `priceUnavailable: true` en esa fila.

### Cálculo de P&L por fila

Para cada fila con `currentPrice` disponible, MUST llamar a `calculateWAC()` del position-engine construyendo un `PositionState` virtual:

```typescript
const virtualPosition: PositionState = {
  id: 'virtual',
  walletId: 'virtual',
  tokenId: row.tokenId,
  cycleNumber: 1,
  status: 'OPEN',
  balance: row.totalBalance,
  wac: row.wacAggregated,
  costBasis: row.totalCostBasis,
  realizedPnlUsd: '0.000000000000000000',
  openedAt: new Date(),
  closedAt: null,
};
const wacResult = calculateWAC(virtualPosition, currentPrice);
// wacResult.unrealizedPnlUsd → pnlUsd
// wacResult.unrealizedPnlPct → pnlPct
```

### Totales del portafolio

```
totalValueUsd   = Σ totalCurrentValue  (solo filas con precio disponible)
totalCostBasis  = Σ totalCostBasis     (TODOS los tokens, con o sin precio)
totalPnlUsd     = Σ pnlUsd             (solo filas con precio disponible)
totalPnlPct     = totalPnlUsd / totalCostBasis × 100
                  (null si totalCostBasis === ZERO)
```

Todas las sumas con `decimal.js`.

#### SC-PORT-SUMMARY-01: 2 wallets ON_CHAIN con mismo token — WAC ponderado

**Given**: wallet W1 con posición OPEN de token T1 (`balance='1.0'`, `wac='2000.00'`, `cost_basis='2000.00'`)  
AND wallet W2 con posición OPEN de T1 (`balance='2.0'`, `wac='3000.00'`, `cost_basis='6000.00'`)  
AND precio disponible: `'2500.00'`  
**When**: se llama `getPortfolioSummary(pool)`  
**Then**: el summary contiene 1 fila para T1 con:
- `totalBalance = '3.000000000000000000'`
- `wacAggregated = '2666.666666666666666667'` (=(1×2000+2×3000)/3)
- `totalCostBasis = '8000.000000000000000000'`
- `walletCount = 2`
- `currentPrice = '2500.00'`
- `pnlUsd = calculateWAC(virtualPos, '2500.00').unrealizedPnlUsd`

#### SC-PORT-SUMMARY-02: ETH on-chain + ETH en CEX nunca se agregan

**Given**: wallet W1 ON_CHAIN con token T_onchain (`symbol='ETH'`, `network='ETH'`, `contract_address='0xeee...'`)  
AND wallet W2 CEX con token T_cex (`symbol='ETH'`, `network='CEX_BINANCE'`, `contract_address='eth'`)  
**When**: se llama `getPortfolioSummary(pool)`  
**Then**: el summary contiene exactamente 2 filas separadas  
AND una fila tiene `network='ETH'`, `sourceType='ON_CHAIN'`  
AND otra fila tiene `network='CEX_BINANCE'`, `sourceType='CEX'`  
AND NINGUNA fila tiene `walletCount > 1` en este escenario

#### SC-PORT-SUMMARY-03: token sin precio disponible

**Given**: existe posición OPEN de T1  
AND `getPricesForTokens` retorna `null` para T1  
**When**: se llama `getPortfolioSummary(pool)`  
**Then**: la fila de T1 incluye `priceUnavailable: true`  
AND `currentPrice = null`, `totalCurrentValue = null`, `pnlUsd = null`, `pnlPct = null`  
AND `totalValueUsd` del summary NO incluye el valor de T1  
AND la respuesta HTTP es 200 (INV-P-1)  
AND se emitió `log.warn` en PriceService

#### SC-PORT-SUMMARY-04: posición con balance cero — excluida

**Given**: existe una posición con `status='OPEN'` pero `balance='0.000000000000000000'` (escenario de bug de engine)  
**When**: se llama `getPortfolioSummary(pool)`  
**Then**: esa fila es excluida del resultado  
AND NO lanza ni produce `NaN`/división por cero

---

## 6. PortfolioService.getTokenDetail

### Contrato

```typescript
export async function getTokenDetail(
  pool: Pool,
  contractAddress: string,
  network: TokenNetwork,
  walletId?: string,
): Promise<TokenDetail>;
```

### Flujo

1. Llamar a `TokenService.findByContractAddress(pool, contractAddress, network)`.  
   Si retorna `null` → lanzar `NotFoundError('Token not found', 'TOKEN_NOT_FOUND')`.

2. Buscar posición OPEN:
   - ON_CHAIN con `walletId` provisto: `WHERE token_id=$1 AND wallet_id=$2 AND status='OPEN'`
   - ON_CHAIN sin `walletId`: `WHERE token_id=$1 AND status='OPEN'` (toma la primera — behavior clarificado en SC-PORT-DETAIL-03)
   - CEX: MUST ignorar `walletId`. `WHERE token_id=$1 AND status='OPEN'` (la única wallet Binance)

3. Obtener precio: `getPriceForToken(token)`. Puede retornar `null`.

4. Si hay posición OPEN → llamar a `calculateWAC(position, currentPrice)` para obtener `unrealizedPnlUsd`/`unrealizedPnlPct`.

5. Llamar a `listTransactions(pool, { wallet_id: effectiveWalletId, token_id: token.id, limit: 100, offset: 0 })`.

6. Enriquecer cada transacción con per-lot P&L:
   - `isInbound(tx.type)` AND `tx.price_usd != null` AND `currentPrice != null`:
     ```
     lotPnlUsd = (currentPrice - price_usd) × amount
     lotPnlPct = lotPnlUsd / (price_usd × amount) × 100
     ```
   - `isInbound(tx.type)` AND (`tx.price_usd == null` OR `currentPrice == null`):
     `lotPnl = { lotPnlUsd: null, lotPnlPct: null }`
   - `isOutbound(tx.type)`:
     `displayAs = 'Sold/Out'`, `lotPnl = null`

   Toda aritmética con `decimal.js`.

#### SC-PORT-DETAIL-01: token ON_CHAIN con wallet_id — filtra correctamente

**Given**: token T1 con posición OPEN en W1 (`balance='1.0'`, `wac='3000.00'`) y posición OPEN en W2 (`balance='2.0'`)  
AND `walletId='W1'`  
AND precio disponible: `'3500.00'`  
**When**: se llama `getTokenDetail(pool, T1.contract_address, 'ETH', 'W1')`  
**Then**: retorna posición de W1 únicamente (`balance='1.0'`)  
AND `unrealizedPnlUsd = calculateWAC(posW1, '3500.00').unrealizedPnlUsd`  
AND transacciones filtradas solo para `wallet_id=W1`

#### SC-PORT-DETAIL-02: token CEX — wallet_id ignorado

**Given**: token T_cex con `network='CEX_BINANCE'`, posición OPEN en wallet Binance WB  
AND se pasa `walletId='some-other-wallet-id'`  
**When**: se llama `getTokenDetail(pool, T_cex.contract_address, 'CEX_BINANCE', 'some-other-wallet-id')`  
**Then**: retorna la posición de WB (la única Binance)  
AND el `walletId` recibido es ignorado silenciosamente

#### SC-PORT-DETAIL-03: per-lot P&L — BUY inbound

**Given**: transacción `{ type: 'BUY', amount: '1.0', price_usd: '2000.00' }`  
AND precio actual disponible: `'3000.00'`  
**When**: se enriquece la transacción  
**Then**: `lotPnlUsd = (3000.00 - 2000.00) × 1.0 = 1000.000000000000000000`  
AND `lotPnlPct = 1000 / (2000 × 1) × 100 = 50.000000000000000000`

#### SC-PORT-DETAIL-04: per-lot P&L — SELL outbound

**Given**: transacción `{ type: 'SELL', amount: '0.5', price_usd: '4000.00' }`  
**When**: se enriquece la transacción  
**Then**: `displayAs = 'Sold/Out'`  
AND `lotPnl = null`

#### SC-PORT-DETAIL-05: per-lot P&L — TRANSFER_IN con price_usd null

**Given**: transacción `{ type: 'TRANSFER_IN', amount: '1.0', price_usd: null, cost_source: 'MANUAL' }`  
AND precio actual disponible: `'3000.00'`  
**When**: se enriquece la transacción  
**Then**: `lotPnl = { lotPnlUsd: null, lotPnlPct: null }`  
(no se puede calcular porque falta el costo de entrada)

#### SC-PORT-DETAIL-06: per-lot P&L — precio no disponible

**Given**: transacción BUY con `price_usd = '2000.00'`  
AND `getPriceForToken` retorna `null`  
**When**: se enriquece la transacción  
**Then**: `lotPnl = { lotPnlUsd: null, lotPnlPct: null }`  
AND la respuesta incluye `priceUnavailable: true`

---

## 7. PortfolioService.getTokenCycleHistory

### Contrato

```typescript
export async function getTokenCycleHistory(
  pool: Pool,
  contractAddress: string,
  network: TokenNetwork,
  walletId?: string,
): Promise<CycleHistory[]>;
```

### Query DB

```sql
SELECT
  p.cycle_number,
  p.opened_at,
  p.closed_at,
  p.realized_pnl_usd
FROM positions p
JOIN tokens t ON t.id = p.token_id
WHERE t.network = $1
  AND lower(t.contract_address) = lower($2)
  AND p.status = 'CLOSED'
  [AND p.wallet_id = $3]   -- solo si walletId está provisto y network != 'CEX_BINANCE'
ORDER BY p.cycle_number ASC
```

Si el token no existe → lanzar `NotFoundError('Token not found', 'TOKEN_NOT_FOUND')`.  
Si no hay ciclos CLOSED → retornar `[]` (no es error).

#### SC-PORT-HISTORY-01: solo ciclos CLOSED, ordenados

**Given**: token T1 con ciclos: `cycle_number=1` CLOSED, `cycle_number=2` CLOSED, `cycle_number=3` OPEN  
**When**: se llama `getTokenCycleHistory(pool, T1.contract_address, 'ETH')`  
**Then**: retorna `[{ cycleNumber: 1, ... }, { cycleNumber: 2, ... }]` ordenados ASC  
AND el ciclo 3 OPEN no aparece

#### SC-PORT-HISTORY-02: sin ciclos cerrados

**Given**: token T1 con solo 1 ciclo OPEN  
**When**: se llama `getTokenCycleHistory(pool, T1.contract_address, 'ETH')`  
**Then**: retorna `[]`

---

## 8. TokenService.findByContractAddress

### Contrato

```typescript
// Extensión de apps/backend/src/services/token.ts
export async function findByContractAddress(
  pool: Pool,
  contractAddress: string,
  network: string,
): Promise<Token | null>;
```

### Query DB

```sql
SELECT * FROM tokens
WHERE network = $1
  AND lower(contract_address) = lower($2)
LIMIT 1
```

Aprovecha el índice único existente: `UNIQUE INDEX (network, lower(contract_address)) WHERE contract_address IS NOT NULL`.

**Invariante:** Si retorna `null`, el caller (PortfolioService) MUST lanzar `NotFoundError`.

#### SC-TOKEN-LOOKUP-01: token existente

**Given**: existe token con `network='ETH'`, `contract_address='0xAaAa...'`  
**When**: se llama `findByContractAddress(pool, '0xaaaa...', 'ETH')` (case-insensitive)  
**Then**: retorna el token

#### SC-TOKEN-LOOKUP-02: token inexistente

**Given**: no existe token con esa combinación  
**When**: se llama `findByContractAddress(pool, '0xbbbb...', 'ETH')`  
**Then**: retorna `null`

---

## 9. Escenarios NEGATIVOS

### NEGATIVE-PORT-01: precio no disponible → priceUnavailable: true, nunca 500

**Given**: cualquier token con posición OPEN  
AND `fetch` hacia DefiLlama o Binance lanza error  
**When**: se llama `getPortfolioSummary(pool)`  
**Then**: response HTTP status = `200`  
AND la fila del token tiene `priceUnavailable: true`, `currentPrice: null`, `pnlUsd: null`  
AND se emitió exactamente 1 `log.warn` por token sin precio  
AND los totales del portafolio NO incluyen el valor de ese token

### NEGATIVE-PORT-02: token CEX sin binance_symbol

**Given**: token CEX con `binance_symbol=null`  
**When**: se llama `getPortfolioSummary(pool)` o `getTokenDetail(pool, ...)`  
**Then**: PriceService retorna `null` sin llamar a fetch (SC-PRICE-09)  
AND la fila tiene `priceUnavailable: true`  
AND respuesta HTTP = `200`

### NEGATIVE-PORT-03: token no encontrado en detalle

**Given**: no existe ningún token con `(contract_address='0xnone', network='ETH')`  
**When**: se llama `getTokenDetail(pool, '0xnone', 'ETH')`  
**Then**: lanza `NotFoundError` con `code='TOKEN_NOT_FOUND'`, `statusCode=404`  
AND el route handler retorna HTTP 404

### NEGATIVE-PORT-04: ON_CHAIN + CEX con mismo symbol nunca se agregan

**Given**: existe token T_onchain `(symbol='USDT', network='ETH', contract_address='0xdac...', wallet_type='ON_CHAIN')`  
AND existe token T_cex `(symbol='USDT', network='CEX_BINANCE', contract_address='usdt', wallet_type='CEX')`  
**When**: se llama `getPortfolioSummary(pool)`  
**Then**: el campo `tokens` contiene exactamente 2 entradas  
AND una tiene `sourceType='ON_CHAIN'`, `network='ETH'`  
AND la otra tiene `sourceType='CEX'`, `network='CEX_BINANCE'`  
AND NUNCA hay una sola fila con `walletCount=2` que mezcle ambas

### NEGATIVE-PORT-05: división por cero en WAC agregado con balance total cero

**Given**: existe algún mecanismo por el que llegan dos posiciones OPEN con balances opuestos (escenario de corrupción de datos)  
AND `Σbalance = 0` en el grupo  
**When**: `getPortfolioSummary` agrupa esas posiciones  
**Then**: la fila es excluida del resultado (guard de `totalBalance === ZERO`)  
AND NO lanza `Decimal.DivisionByZero`

### NEGATIVE-PORT-06: wallet_id ON_CHAIN pasado a token CEX → ignorado

**Given**: token T_cex CEX, wallet W_onchain de tipo ON_CHAIN  
AND se pasa `walletId = W_onchain.id` a `getTokenDetail` para T_cex  
**When**: se llama `getTokenDetail(pool, T_cex.contract_address, 'CEX_BINANCE', W_onchain.id)`  
**Then**: retorna la posición de la wallet Binance, no la de W_onchain  
AND NO retorna 404 ni error
