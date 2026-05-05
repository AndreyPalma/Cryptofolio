# Spec — US-007 · PriceService + PortfolioService

> **Change:** `US-007-portfolio-api`
> **Capability:** PriceService (TTL cache + proveedores externos) y PortfolioService (agregación WAC multi-wallet, P&L no realizado, historial de ciclos)
> **Estado:** activo
> **Última revisión:** 2026-05-05

---

## 1. Alcance

Capa de servicios para lectura del portafolio. Las rutas HTTP están en `specs/portfolio-routes/spec.md`.

| Archivo | Acción |
|---------|--------|
| `apps/backend/src/services/price.ts` | NUEVO |
| `apps/backend/src/services/portfolio.ts` | NUEVO |
| `apps/backend/src/types/portfolio.ts` | NUEVO |
| `apps/backend/src/services/__tests__/price.test.ts` | NUEVO |
| `apps/backend/src/services/__tests__/portfolio.test.ts` | NUEVO |

**Fuera de scope:** sincronización automática (US-008/009), snapshots históricos de precio, validación de balance vs accountSnapshot, conversión de dust.

---

## 2. Invariantes del dominio

| ID | Invariante |
|----|-----------|
| INV-P-1 | PriceService MUST NOT lanzar. Todo fallo → `null` + `log.warn`. Caller emite `priceUnavailable: true`. HTTP siempre 200. |
| INV-P-2 | Tokens ON_CHAIN y CEX con mismo symbol MUST NOT agregarse. Key de agrupación: `(contract_address, network)`. |
| INV-P-3 | WAC agregado MUST calcularse con `decimal.js` exclusivamente. MUST NOT usar aritmética JS nativa sobre strings de balance/WAC. |
| INV-P-4 | PortfolioService LEE `positions.wac` tal como lo escribió el engine. MUST NOT recalcular WAC desde transacciones. |
| INV-P-5 | `realized_pnl_usd` de ciclos CLOSED es inmutable. Se lee del DB sin recomputar. |
| INV-P-6 | Cache TTL vive en memoria a nivel módulo. Llamadas dentro del TTL MUST retornar valor cacheado sin HTTP. |

---

## 3. PriceService

### Requirement: Obtención de precios con cache y degradación graceful

El servicio MUST proveer precios de tokens ON_CHAIN vía DefiLlama (bulk fetch, TTL 60s) y tokens CEX vía Binance public ticker (per-symbol, TTL 10s). MUST cachear resultados. MUST aplicar timeout de 5s via AbortController. MUST implementar negative cache: fallo dentro de TTL retorna `priceUnavailable` sin re-fetch.

Cache keys: ON_CHAIN = `onchain:{network.toLowerCase()}:{address.toLowerCase()}`, CEX = `cex:{symbol.toUpperCase()}`.

#### SC-PRICE-01: DefiLlama bulk — 1 request para N tokens ON_CHAIN

- GIVEN 2 tokens ON_CHAIN sin entrada en cache
- WHEN se llama `getOnChainPricesBulk([tokenA, tokenB])`
- THEN se dispara exactamente 1 request HTTP con ambas coins en la URL
- AND retorna Map con ambas prices como DecimalString
- AND ambas entradas quedan en cache con TTL 60s

#### SC-PRICE-02: Binance ticker — éxito

- GIVEN token CEX con `binance_symbol='ETH'`, sin cache
- WHEN se llama `getCexPrice('ETH')`
- THEN request a `…/ticker/price?symbol=ETHUSDT`
- AND retorna `{ priceUsd: '...' }`
- AND entrada en cache con TTL 10s

#### SC-PRICE-03: Cache hit — no segunda request

- GIVEN entrada en cache con `expiresAt > Date.now()`
- WHEN se llama el método dos veces dentro del TTL
- THEN fetch llamado exactamente 1 vez

#### SC-PRICE-04: Cache expirado — nueva request

- GIVEN entrada en cache con `expiresAt < Date.now()`
- WHEN se llama el método
- THEN se dispara nueva request; cache se actualiza

#### SC-PRICE-05: Negative cache — fallo cacheado

- GIVEN primera llamada falla (red caída)
- WHEN se vuelve a llamar dentro del TTL
- THEN retorna `{ priceUnavailable: true }` SIN re-fetch

#### SC-PRICE-06: fetch rechaza (red caída)

- GIVEN `fetch` lanza TypeError
- WHEN se llama cualquier método de precio
- THEN retorna `{ priceUnavailable: true }`
- AND se emite `log.warn`; NO lanza al caller

#### SC-PRICE-07: Status 4xx/5xx

- GIVEN DefiLlama responde con status 429
- THEN retorna `{ priceUnavailable: true }` + `log.warn`

#### SC-PRICE-08: Schema mismatch (Zod parse fail)

- GIVEN respuesta con shape inesperado
- THEN retorna `{ priceUnavailable: true }` + `log.warn` con body truncado

#### SC-PRICE-09: Timeout AbortController

- GIVEN provider tarda > 5s
- THEN fetch abortado; retorna `{ priceUnavailable: true }` + `log.warn`

#### SC-PRICE-10: Cache key case-insensitive

- GIVEN primera llamada con address en minúsculas
- WHEN segunda llamada con address en mayúsculas
- THEN cache hit — solo 1 fetch en total

---

## 4. PortfolioService.getPortfolioSummary

### Requirement: Resumen agregado de posiciones OPEN

El servicio MUST cargar todas las posiciones OPEN con 1 query JOIN (positions ⨝ tokens ⨝ wallets). MUST agrupar por `(contract_address, network)` para ON_CHAIN. CEX MUST generar fila independiente por posición. MUST excluir filas con balance cero. MUST reusar `calculateWAC` del position-engine para P&L (construyendo PositionState virtual). MUST usar `getPricesForTokens` para un fetch de precios bulk + parallel. Totales (`totalValueUsd`, `totalPnlUsd`, `totalPnlPct`) MUST excluir tokens con `priceUnavailable`. `totalCostBasis` MUST sumar TODOS los tokens.

#### SC-PORT-SUMMARY-01: 2 wallets ON_CHAIN mismo token — WAC ponderado

- GIVEN W1: `balance='1.0'`, `wac='2000.00'`; W2: `balance='2.0'`, `wac='3000.00'` (mismo token)
- WHEN `getPortfolioSummary(pool, priceService)`
- THEN 1 fila con `totalBalance='3.0…'`, `wacAggregated='2666.666…'`, `walletCount=2`

#### SC-PORT-SUMMARY-02: ETH on-chain + ETH CEX — nunca agregados

- GIVEN posición ON_CHAIN `network='ETH'` + posición CEX `network='CEX_BINANCE'`, mismo symbol
- THEN `tokens.length === 2`; una `sourceType='ON_CHAIN'`, otra `sourceType='CEX'`

#### SC-PORT-SUMMARY-03: precio no disponible — fila incluida, totales excluyen

- GIVEN priceService retorna `priceUnavailable` para T1
- THEN fila T1 tiene `priceUnavailable: true`, `currentPrice: null`, `pnlUsd: null`
- AND `totalValueUsd` NO incluye valor de T1; respuesta HTTP = 200

#### SC-PORT-SUMMARY-04: balance cero — excluida (guard division by zero)

- GIVEN posición OPEN con `balance='0.000…'`
- THEN esa fila NO aparece en resultado; no lanza ni produce NaN

---

## 5. PortfolioService.getTokenDetail

### Requirement: Detalle de token con P&L por lote

El servicio MUST buscar token por `findByContractAddress` → 404 si null. MUST respetar filtro `walletId` para ON_CHAIN. MUST ignorar `walletId` para CEX. MUST enriquecer transacciones con per-lot P&L: inbound con `price_usd + currentPrice` → calcular; `price_usd null` → null; outbound → `{ kind:'OUTBOUND', displayAs:'Sold/Out' }`.

#### SC-PORT-DETAIL-01: ON_CHAIN con walletId — filtra 1 posición

- GIVEN token con posiciones en W1 y W2; `walletId='W1'`
- THEN retorna solo posición de W1; transacciones solo de W1

#### SC-PORT-DETAIL-02: CEX ignora walletId

- GIVEN token CEX; `walletId` de wallet ON_CHAIN
- THEN retorna posición CEX; no 404

#### SC-PORT-DETAIL-03: BUY inbound con precio conocido

- GIVEN tx `{ type:'BUY', amount:'1.0', price_usd:'2000.00' }`, currentPrice='3000.00'
- THEN `kind:'INBOUND'`, `lotPnlUsd='1000.0…'`, `lotPnlPct='50.0…'`

#### SC-PORT-DETAIL-04: SELL outbound

- GIVEN tx `{ type:'SELL' }`
- THEN `kind:'OUTBOUND'`, `displayAs:'Sold/Out'`

#### SC-PORT-DETAIL-05: TRANSFER_IN con price_usd null

- GIVEN tx `{ type:'TRANSFER_IN', price_usd: null }`
- THEN `kind:'INBOUND'`, `lotPnlUsd: null`, `lotPnlPct: null`

#### SC-PORT-DETAIL-06: price_usd cero — no división por cero

- GIVEN tx `{ price_usd: '0.00' }`
- THEN `lotPnlPct: null`; no lanza

#### SC-PORT-DETAIL-07: token no encontrado → 404

- GIVEN no existe token con esa combinación
- THEN lanza `NotFoundError` con `code='TOKEN_NOT_FOUND'`

---

## 6. PortfolioService.getPositionHistory

### Requirement: Historial de ciclos CLOSED

El servicio MUST retornar solo posiciones CLOSED ordenadas por `cycle_number ASC`. MUST retornar `[]` si no hay ciclos (no es error). MUST aceptar filtro opcional `walletId` para ON_CHAIN; CEX ignora el filtro.

#### SC-PORT-HISTORY-01: ciclos CLOSED ordenados ASC

- GIVEN token con ciclos 1 CLOSED, 2 CLOSED, 3 OPEN
- THEN retorna `[cycle 1, cycle 2]`; ciclo 3 OPEN no aparece

#### SC-PORT-HISTORY-02: sin ciclos cerrados → array vacío

- GIVEN token con solo 1 ciclo OPEN
- THEN retorna `[]`

---

## 7. Escenarios NEGATIVOS

### NEGATIVE-PORT-01: precio no disponible → priceUnavailable, nunca 500

- GIVEN fetch hacia DefiLlama o Binance lanza error
- WHEN `getPortfolioSummary`
- THEN HTTP 200; fila con `priceUnavailable: true`; `log.warn` emitido; totales excluyen ese token

### NEGATIVE-PORT-02: token CEX sin binance_symbol

- GIVEN token CEX con `binance_symbol=null`
- THEN PriceService retorna `priceUnavailable` SIN llamar a fetch; fila incluida; 200

### NEGATIVE-PORT-03: ON_CHAIN + CEX mismo symbol — nunca mezclados

- GIVEN 2 tokens con mismo symbol, uno ETH otro CEX_BINANCE
- THEN `tokens.length === 2`; nunca 1 fila con ambos

### NEGATIVE-PORT-04: wallet_id ON_CHAIN pasado para token CEX

- GIVEN token CEX; `walletId` = id de wallet ON_CHAIN
- THEN retorna posición CEX correcta; no 404; no error

### NEGATIVE-PORT-05: totalCostBasis=0 → totalPnlPct null, no NaN

- GIVEN todos los tokens sin cost basis (escenario inicial)
- THEN `totalPnlPct: null`; no NaN ni división por cero
