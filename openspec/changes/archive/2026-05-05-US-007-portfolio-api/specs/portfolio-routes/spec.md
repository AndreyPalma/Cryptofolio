# Spec — US-007 · portfolio-routes

> **Change:** `US-007-portfolio-api`
> **Capability:** Plugin Fastify — 3 endpoints GET de portafolio
> **Estado:** activo
> **Última revisión:** 2026-05-05

---

## 1. Alcance

Plugin HTTP de portfolio. La lógica de negocio está en `specs/portfolio-service/spec.md`.

| Archivo | Acción |
|---------|--------|
| `apps/backend/src/routes/portfolio.ts` | NUEVO |
| `apps/backend/src/index.ts` | MODIFICADO — registrar plugin en `/api/portfolio` |

**No incluye:** lógica de negocio, queries DB, fetch de precios. Handlers delgados: parsear → llamar service → responder.

---

## 2. Requisitos globales del plugin

### Requirement: Auth JWT heredada y handler delgado

Las rutas viven bajo `/api/portfolio`. El middleware JWT global de US-003 protege todas las rutas `/api/*`. MUST NOT agregar preHandler de auth redundante.

Cada handler MUST: (1) parsear params/query con Zod `safeParse`, (2) llamar la función de servicio, (3) mapear errores de dominio a HTTP. MUST NOT contener lógica de negocio ni queries directas.

Error mapping: `NotFoundError` → 404, `ValidationError` → 400, otros → 500 via `setErrorHandler` global.

Registro MUST hacerse después del `authPlugin` en `index.ts`.

---

## 3. GET /api/portfolio

### Requirement: Resumen de portafolio

MUST retornar 200 con `PortfolioSummary` siempre, incluso cuando algún precio no está disponible. MUST NOT retornar 500 por fallos de precio.

Todos los valores numéricos MUST ser strings (DecimalString). NEVER `number` para dinero o cripto.

#### SC-ROUTE-SUMMARY-01: portafolio vacío

- GIVEN usuario autenticado sin posiciones OPEN
- WHEN `GET /api/portfolio`
- THEN `200 { totalValueUsd:'0…', totalCostBasis:'0…', totalPnlUsd:'0…', totalPnlPct:null, tokens:[] }`

#### SC-ROUTE-SUMMARY-02: portafolio con tokens y precios disponibles

- GIVEN posiciones OPEN con precios disponibles
- WHEN `GET /api/portfolio`
- THEN `200` con `tokens` array; todos los valores numéricos como strings; `walletBreakdown` presente

#### SC-ROUTE-SUMMARY-03: JWT ausente

- GIVEN request sin Authorization header
- WHEN `GET /api/portfolio`
- THEN `401` (middleware global — handler no alcanzado)

---

## 4. GET /api/portfolio/token/:contractAddress/:network

### Requirement: Detalle de token con transacciones enriquecidas

Path params: `contractAddress` (string, min 1) y `network` (enum `ETH|BSC|CEX_BINANCE`). Query param opcional: `wallet_id` (UUID).

MUST retornar 200 cuando token existe (con o sin posición OPEN). MUST retornar 404 si token no existe en DB. `network` inválido → 400.

#### SC-ROUTE-DETAIL-01: token con posición OPEN

- GIVEN token en DB con posición OPEN, precio disponible
- WHEN `GET /api/portfolio/token/0xaaa/ETH`
- THEN `200` con `position.status='OPEN'`, `transactions` array con per-lot P&L

#### SC-ROUTE-DETAIL-02: token sin posición OPEN

- GIVEN token en DB, ninguna posición OPEN
- WHEN `GET /api/portfolio/token/0xaaa/ETH`
- THEN `200` con `position: null`, `transactions: []`

#### SC-ROUTE-DETAIL-03: token no encontrado

- GIVEN token inexistente
- WHEN `GET /api/portfolio/token/0xnone/ETH`
- THEN `404 { statusCode:404, error:'Not Found', message:'Token not found' }`

#### SC-ROUTE-DETAIL-04: network inválido en path

- GIVEN `network='POLYGON'`
- WHEN `GET /api/portfolio/token/0xaaa/POLYGON`
- THEN `400 { statusCode:400, error:'Bad Request' }`

#### SC-ROUTE-DETAIL-05: ON_CHAIN con ?wallet_id=

- GIVEN token T1 con posiciones en W1 y W2
- WHEN `GET /api/portfolio/token/0xaaa/ETH?wallet_id=W1`
- THEN `200` con posición y transacciones solo de W1

#### SC-ROUTE-DETAIL-06: CEX con ?wallet_id ignorado

- GIVEN token CEX, `?wallet_id=W_onchain`
- WHEN `GET /api/portfolio/token/eth/CEX_BINANCE?wallet_id=W_onchain`
- THEN `200` con posición Binance — no 404

---

## 5. GET /api/portfolio/token/:contractAddress/:network/history

### Requirement: Historial de ciclos cerrados

Mismos path params que §4 + query param `wallet_id` opcional. MUST retornar 200 con `{ cycles: [] }` si no hay ciclos (no es error). `cycles` ordenados por `cycleNumber ASC`.

#### SC-ROUTE-HISTORY-01: ciclos CLOSED presentes

- GIVEN token T1 con 2 ciclos CLOSED
- WHEN `GET /api/portfolio/token/0xaaa/ETH/history`
- THEN `200 { cycles:[{cycleNumber:1,…},{cycleNumber:2,…}] }` ordenados ASC

#### SC-ROUTE-HISTORY-02: sin ciclos CLOSED

- GIVEN token con solo posición OPEN
- THEN `200 { cycles: [] }`

#### SC-ROUTE-HISTORY-03: token no encontrado

- THEN `404`

#### SC-ROUTE-HISTORY-04: ON_CHAIN con ?wallet_id=

- GIVEN token con ciclos en W1 y W2
- WHEN `…/history?wallet_id=W1`
- THEN solo ciclos de W1

---

## 6. Escenarios NEGATIVOS

### NEGATIVE-ROUTE-01: precio no disponible → priceUnavailable: true, nunca 500

- GIVEN fetch falla para algún token
- WHEN `GET /api/portfolio`
- THEN `200`; `tokens[n].priceUnavailable===true`; `currentPrice:null`; `pnlUsd:null`; `log.warn` emitido; totales excluyen ese token

### NEGATIVE-ROUTE-02: network inválido en path params

- GIVEN `network='MATIC'`
- WHEN `GET /api/portfolio/token/0xaaa/MATIC` o `.../history`
- THEN `400` con `issues` array en body

### NEGATIVE-ROUTE-03: token CEX sin binance_symbol → priceUnavailable, nunca 500

- GIVEN token CEX con `binance_symbol=null`
- WHEN `GET /api/portfolio`
- THEN `200`; fila con `priceUnavailable:true`; ningún fetch HTTP a Binance; `log.warn` emitido

### NEGATIVE-ROUTE-04: JWT ausente en todas las rutas

- GIVEN request sin Authorization
- WHEN cualquier `GET /api/portfolio*`
- THEN `401` — middleware global, handler no alcanzado

### NEGATIVE-ROUTE-05: ETH on-chain + ETH CEX nunca mezclados

- GIVEN posición OPEN ETH `network='ETH'` y ETH `network='CEX_BINANCE'`
- WHEN `GET /api/portfolio`
- THEN `tokens.length >= 2`; exactamente 1 entrada `sourceType='ON_CHAIN'` y 1 `sourceType='CEX'`; nunca 1 entrada que mezcle ambas
