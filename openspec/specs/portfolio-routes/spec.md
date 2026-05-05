# Spec — US-007 · portfolio-routes

> **Change:** `US-007-portfolio-api`
> **Capability:** Plugin Fastify — 3 endpoints GET de portafolio
> **Estado:** finalizado
> **Última revisión:** 2026-05-05

---

## Índice

1. [Alcance](#1-alcance)
2. [Requisitos globales del plugin](#2-requisitos-globales-del-plugin)
3. [GET /api/portfolio](#3-get-apiportfolio)
4. [GET /api/portfolio/token/:contractAddress/:network](#4-get-apiportfoliotokencontractaddressnetwork)
5. [GET /api/portfolio/token/:contractAddress/:network/history](#5-get-apiportfoliotokencontractaddressnetworkhistory)
6. [Registro en index.ts](#6-registro-en-indexts)
7. [Escenarios NEGATIVOS](#7-escenarios-negativos)

---

## 1. Alcance

Esta spec cubre el plugin HTTP de portfolio. La lógica de negocio (agregación, P&L, precios) está especificada en `specs/portfolio-service/spec.md`.

Archivos afectados:

| Archivo | Acción |
|---------|--------|
| `apps/backend/src/routes/portfolio.ts` | NUEVO |
| `apps/backend/src/types/portfolio.ts` | NUEVO (compartido con portfolio-service) |
| `apps/backend/src/index.ts` | MODIFICADO — registrar plugin |

**No incluye:** lógica de negocio, queries a DB, fetch de precios. El route handler MUST ser delgado: parsea params, llama al service, retorna la respuesta.

---

## 2. Requisitos globales del plugin

### AUTH-ROUTE-1 — JWT obligatorio

Todas las rutas del plugin viven bajo `/api/portfolio`. El middleware JWT instalado en US-003 protege todas las rutas `/api/*` con `onRequest` hook global. Las rutas de este plugin MUST NOT agregar `preHandler` de auth redundante — la protección ya está activa.

Si el token JWT está ausente o es inválido → el middleware global responde `401` antes de llegar al handler. No hay manejo especial en este plugin.

### AUTH-ROUTE-2 — Principio del scope de usuario

El `userId` puede extraerse de `(request.user as { sub?: string }).sub` para filtrar wallets del usuario actual. En esta story, la query DB no filtra por `user_id` (US-007 scope: portafolio global del usuario autenticado). El filtering por userId queda registrado como deuda técnica para US-010+.

### ROUTE-PATTERN-1 — Handler delgado

Cada handler MUST:
1. Parsear y validar params/query con `safeParse`.
2. Llamar a la función de servicio correspondiente.
3. Retornar la respuesta o convertir errores de dominio a códigos HTTP.

MUST NOT contener lógica de negocio, queries directas a DB, ni llamadas a APIs externas.

### ROUTE-PATTERN-2 — Error mapping

| Error de dominio | HTTP Status |
|------------------|-------------|
| `NotFoundError` (`statusCode=404`) | 404 |
| `ValidationError` (`statusCode=400`) | 400 |
| Cualquier otro error no controlado | 500 (handled por `setErrorHandler` global) |

El plugin no necesita su propio `setErrorHandler`. Los errores `DomainError` tienen `statusCode` en la instancia — el handler global los lee. El handler de portfolio solo captura `NotFoundError` explícitamente para el caso de token no encontrado.

---

## 3. GET /api/portfolio

### Request

```
GET /api/portfolio
Authorization: Bearer <jwt>
```

No tiene query params ni path params.

### Response — 200 OK

```typescript
// Zod schema
const PortfolioSummaryResponseSchema = z.object({
  totalValueUsd: z.string(),
  totalCostBasis: z.string(),
  totalPnlUsd: z.string(),
  totalPnlPct: z.string().nullable(),
  tokens: z.array(z.object({
    symbol: z.string(),
    network: z.enum(['ETH', 'BSC', 'CEX_BINANCE']),
    sourceType: z.enum(['ON_CHAIN', 'CEX']),
    contractAddress: z.string(),
    totalBalance: z.string(),
    currentPrice: z.string().nullable(),
    totalCurrentValue: z.string().nullable(),
    wacAggregated: z.string(),
    totalCostBasis: z.string(),
    pnlUsd: z.string().nullable(),
    pnlPct: z.string().nullable(),
    walletCount: z.number().int().min(1),
    walletBreakdown: z.array(z.object({
      walletId: z.string(),
      label: z.string().nullable(),
      balance: z.string(),
      wac: z.string(),
    })),
    priceUnavailable: z.boolean().optional(),
  })),
});
```

Todos los valores numéricos son **strings** (DecimalString). NEVER `number` para valores de dinero o cripto.

### Response — Precio no disponible (sigue siendo 200)

```json
{
  "totalValueUsd": "0.000000000000000000",
  "totalCostBasis": "3000.000000000000000000",
  "totalPnlUsd": "0.000000000000000000",
  "totalPnlPct": null,
  "tokens": [
    {
      "symbol": "ETH",
      "network": "ETH",
      "sourceType": "ON_CHAIN",
      "contractAddress": "0xeee...",
      "totalBalance": "1.000000000000000000",
      "currentPrice": null,
      "totalCurrentValue": null,
      "wacAggregated": "3000.000000000000000000",
      "totalCostBasis": "3000.000000000000000000",
      "pnlUsd": null,
      "pnlPct": null,
      "walletCount": 1,
      "walletBreakdown": [{ "walletId": "...", "label": "My Wallet", "balance": "1.0...", "wac": "3000.0..." }],
      "priceUnavailable": true
    }
  ]
}
```

### HTTP status codes

| Condición | Status |
|-----------|--------|
| Éxito (con o sin posiciones) | 200 |
| Precio de algún token no disponible | 200 (no 500) |
| JWT ausente o inválido | 401 (middleware global) |
| Error interno no controlado | 500 |

#### SC-ROUTE-SUMMARY-01: portafolio vacío

**Given**: usuario autenticado sin ninguna posición OPEN  
**When**: `GET /api/portfolio`  
**Then**: `200 { totalValueUsd: '0...', totalCostBasis: '0...', totalPnlUsd: '0...', totalPnlPct: null, tokens: [] }`

#### SC-ROUTE-SUMMARY-02: portafolio con tokens y precios

**Given**: usuario con posiciones OPEN y precios disponibles  
**When**: `GET /api/portfolio`  
**Then**: `200` con `tokens` array poblado, todos los valores numéricos como strings, `walletBreakdown` presente por fila

#### SC-ROUTE-SUMMARY-03: JWT ausente

**Given**: request sin header `Authorization`  
**When**: `GET /api/portfolio`  
**Then**: `401` (middleware global — el handler no es alcanzado)

---

## 4. GET /api/portfolio/token/:contractAddress/:network

### Request

```
GET /api/portfolio/token/:contractAddress/:network[?wallet_id=<uuid>]
Authorization: Bearer <jwt>
```

**Path params:**

```typescript
const TokenDetailParamsSchema = z.object({
  contractAddress: z.string().min(1),
  network: z.enum(['ETH', 'BSC', 'CEX_BINANCE']),
});
```

**Query params:**

```typescript
const TokenDetailQuerySchema = z.object({
  wallet_id: z.string().optional(),
});
```

### Response — 200 OK

```typescript
const TokenDetailResponseSchema = z.object({
  token: z.object({
    id: z.string(),
    symbol: z.string(),
    network: z.enum(['ETH', 'BSC', 'CEX_BINANCE']),
    contractAddress: z.string(),
  }),
  position: z.object({
    id: z.string(),
    cycleNumber: z.number().int(),
    status: z.literal('OPEN'),
    wac: z.string(),
    balance: z.string(),
    costBasis: z.string(),
    currentPrice: z.string().nullable(),
    currentValue: z.string().nullable(),
    unrealizedPnlUsd: z.string().nullable(),
    unrealizedPnlPct: z.string().nullable(),
    openedAt: z.string(),
  }).nullable(),
  transactions: z.array(z.object({
    id: z.string(),
    type: z.enum(['BUY', 'SELL', 'SWAP_IN', 'SWAP_OUT', 'TRANSFER_IN', 'TRANSFER_OUT']),
    amount: z.string(),
    priceUsd: z.string().nullable(),
    blockTimestamp: z.string(),
    lotPnl: z.object({
      lotPnlUsd: z.string().nullable(),
      lotPnlPct: z.string().nullable(),
    }).nullable(),
    displayAs: z.enum(['Sold/Out']).optional(),
  })),
  priceUnavailable: z.boolean().optional(),
});
```

### HTTP status codes

| Condición | Status |
|-----------|--------|
| Token encontrado con o sin posición OPEN | 200 |
| Token encontrado, precio no disponible | 200 con `priceUnavailable: true` |
| Token no encontrado en DB | 404 |
| `network` no es uno de los valores válidos | 400 |
| JWT ausente o inválido | 401 |

#### SC-ROUTE-DETAIL-01: token existente con posición OPEN

**Given**: token en DB con `contract_address='0xaaa'`, `network='ETH'`, posición OPEN  
AND precio disponible  
**When**: `GET /api/portfolio/token/0xaaa/ETH`  
**Then**: `200` con `position.status='OPEN'`, `transactions` array, per-lot P&L calculado

#### SC-ROUTE-DETAIL-02: token existente sin posición OPEN

**Given**: token en DB, ninguna posición OPEN (solo CLOSED o ninguna)  
**When**: `GET /api/portfolio/token/0xaaa/ETH`  
**Then**: `200` con `position: null`, `transactions: []`

#### SC-ROUTE-DETAIL-03: token no encontrado

**Given**: no existe token con `contract_address='0xnone'`, `network='ETH'`  
**When**: `GET /api/portfolio/token/0xnone/ETH`  
**Then**: `404 { statusCode: 404, error: 'Not Found', message: 'Token not found' }`

#### SC-ROUTE-DETAIL-04: network inválido en path

**Given**: request con `network='INVALID'`  
**When**: `GET /api/portfolio/token/0xaaa/INVALID`  
**Then**: `400 { statusCode: 400, error: 'Bad Request', message: 'Validation failed' }`

#### SC-ROUTE-DETAIL-05: ON_CHAIN con ?wallet_id=

**Given**: token T1 con posiciones OPEN en W1 y W2  
**When**: `GET /api/portfolio/token/0xaaa/ETH?wallet_id=W1`  
**Then**: `200` con posición de W1 únicamente  
AND transacciones solo de W1

#### SC-ROUTE-DETAIL-06: CEX con ?wallet_id ignorado

**Given**: token CEX con posición en wallet Binance WB  
AND request con `?wallet_id=W_onchain`  
**When**: `GET /api/portfolio/token/eth/CEX_BINANCE?wallet_id=W_onchain`  
**Then**: `200` con posición de WB (no 404, no error)

---

## 5. GET /api/portfolio/token/:contractAddress/:network/history

### Request

```
GET /api/portfolio/token/:contractAddress/:network/history[?wallet_id=<uuid>]
Authorization: Bearer <jwt>
```

**Path params:**

```typescript
const HistoryParamsSchema = z.object({
  contractAddress: z.string().min(1),
  network: z.enum(['ETH', 'BSC', 'CEX_BINANCE']),
});
```

**Query params:**

```typescript
const HistoryQuerySchema = z.object({
  wallet_id: z.string().optional(),
});
```

### Response — 200 OK

```typescript
const CycleHistoryResponseSchema = z.object({
  cycles: z.array(z.object({
    cycleNumber: z.number().int(),
    openedAt: z.string(),     // ISO-8601
    closedAt: z.string(),     // ISO-8601
    realizedPnlUsd: z.string(), // DecimalString
  })),
});
```

### HTTP status codes

| Condición | Status |
|-----------|--------|
| Token encontrado (con o sin ciclos CLOSED) | 200 |
| Token no encontrado en DB | 404 |
| `network` inválido | 400 |
| JWT ausente o inválido | 401 |

#### SC-ROUTE-HISTORY-01: ciclos CLOSED presentes

**Given**: token T1 con 2 ciclos CLOSED  
**When**: `GET /api/portfolio/token/0xaaa/ETH/history`  
**Then**: `200 { cycles: [{ cycleNumber: 1, ... }, { cycleNumber: 2, ... }] }` ordenados por `cycleNumber ASC`

#### SC-ROUTE-HISTORY-02: sin ciclos CLOSED

**Given**: token T1 con solo posición OPEN, ningún ciclo cerrado  
**When**: `GET /api/portfolio/token/0xaaa/ETH/history`  
**Then**: `200 { cycles: [] }`

#### SC-ROUTE-HISTORY-03: token no encontrado

**Given**: token inexistente  
**When**: `GET /api/portfolio/token/0xnone/ETH/history`  
**Then**: `404 { statusCode: 404, error: 'Not Found', message: 'Token not found' }`

#### SC-ROUTE-HISTORY-04: con ?wallet_id= para ON_CHAIN

**Given**: token T1 con ciclos cerrados en W1 y W2  
**When**: `GET /api/portfolio/token/0xaaa/ETH/history?wallet_id=W1`  
**Then**: `200 { cycles: [...] }` solo con ciclos de W1

---

## 6. Registro en index.ts

```typescript
// apps/backend/src/index.ts — agregar junto a los otros plugins
import { portfolioRoutes } from './routes/portfolio.js';

await fastify.register(portfolioRoutes, { prefix: '/api/portfolio' });
```

El registro MUST hacerse DESPUÉS de registrar el plugin de auth (`authPlugin`), para que el middleware JWT ya esté activo cuando se registran las rutas de portfolio.

---

## 7. Escenarios NEGATIVOS

Estos casos son requeridos explícitamente por el PRD (`acceptanceCriteria → NEGATIVE:`). Son **obligatorios** en los tests e2e.

### NEGATIVE-ROUTE-01: token sin precio disponible → priceUnavailable: true, nunca 500

**Given**: usuario autenticado con posición OPEN de T1  
AND fetch hacia DefiLlama lanza `TypeError: fetch failed`  
**When**: `GET /api/portfolio`  
**Then**: response `200` (NEVER `500`)  
AND `tokens[0].priceUnavailable === true`  
AND `tokens[0].currentPrice === null`  
AND `tokens[0].pnlUsd === null`  
AND log de warning emitido por PriceService  
AND los totales del portafolio no incluyen el valor de ese token

### NEGATIVE-ROUTE-02: network inválido en path params

**Given**: request con `network` que no es `'ETH' | 'BSC' | 'CEX_BINANCE'`  
**When**: `GET /api/portfolio/token/0xaaa/POLYGON` o `GET /api/portfolio/token/0xaaa/POLYGON/history`  
**Then**: `400 { statusCode: 400, error: 'Bad Request', message: 'Validation failed', issues: [...] }`

### NEGATIVE-ROUTE-03: token CEX sin binance_symbol → priceUnavailable, nunca 500

**Given**: token CEX con `binance_symbol=null`, posición OPEN  
**When**: `GET /api/portfolio`  
**Then**: `200` con `priceUnavailable: true` para ese token  
AND NO se realizó ningún fetch HTTP a Binance para ese token  
AND log de warning con `reason: 'CEX_TOKEN_MISSING_BINANCE_SYMBOL'`

### NEGATIVE-ROUTE-04: JWT ausente en todas las rutas

**Given**: request sin `Authorization` header  
**When**: cualquier `GET /api/portfolio*`  
**Then**: `401` antes de llegar al handler (middleware global)  
AND body de error del middleware JWT (no del handler)

### NEGATIVE-ROUTE-05: ETH on-chain + ETH CEX nunca mezclados en respuesta

**Given**: usuario con posición OPEN de ETH on-chain (network='ETH') y ETH en Binance (network='CEX_BINANCE')  
**When**: `GET /api/portfolio`  
**Then**: `tokens.length >= 2`  
AND exactamente 1 entrada con `network='ETH'`, `sourceType='ON_CHAIN'`  
AND exactamente 1 entrada con `network='CEX_BINANCE'`, `sourceType='CEX'`  
AND NUNCA una única entrada que mezcle ambas  
AND cada entrada tiene `walletCount=1` en este escenario (no hay crossover)
