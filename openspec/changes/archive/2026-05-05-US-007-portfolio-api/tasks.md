# Tasks: US-007 — Portfolio API (PriceService + PortfolioService + routes)

## Phase 1: Foundation — tipos y schemas

- [x] 1.1 Crear `apps/backend/src/types/portfolio.ts` — schemas Zod 4: `WalletBreakdownEntrySchema`, `TokenPortfolioRowSchema`, `PortfolioSummarySchema`, `InboundPnlSchema`, `OutboundPnlSchema`, `PnlInfoSchema`, `TransactionWithPnlSchema`, `TokenDetailSchema`, `PositionHistoryEntrySchema`, `PositionHistoryResponseSchema`, `PriceResult` type. Todo `string` para valores monetarios.

## Phase 2: PriceService (TDD — RED → GREEN)

- [x] 2.1 **RED** Escribir `apps/backend/src/services/__tests__/price.test.ts` con todos los escenarios SC-PRICE-01..10: bulk DefiLlama (1 fetch, partial, 5xx, timeout, schema mismatch), Binance ticker (éxito, error), cache hit/miss/expiry, negative cache, case normalization. `vi.stubGlobal('fetch', vi.fn())` + `__resetCacheForTests()` en `beforeEach`.
- [x] 2.2 **GREEN** Crear `apps/backend/src/services/price.ts` — `createPriceService(log)` factory, cache module-level `Map<string, CacheEntry>`, `getOnChainPrice`, `getCexPrice`, `getOnChainPricesBulk`, `fetchDefiLlamaBulk`, `fetchBinanceTicker`, `readCache`, `markUnavailable`, `DefiLlamaResponseSchema`, `BinanceTickerSchema` (Zod `safeParse`), AbortController 5s. NEVER throws.
- [x] 2.3 Pasar SC-PRICE-01..10 al verde — `npm run test:sync`

## Phase 3: TokenService — extensión mínima (TDD)

- [x] 3.1 **RED** Agregar casos SC-TOKEN-LOOKUP-01..03 al test file existente de token service.
- [x] 3.2 **GREEN** Agregar `findByContractAddress(pool, contractAddress, network)` en `apps/backend/src/services/token.ts` — query `WHERE network=$1 AND lower(contract_address)=lower($2) LIMIT 1`. Retorna `Token | null`.
- [x] 3.3 Pasar SC-TOKEN-LOOKUP-01..03 al verde — `npm run test:sync`

## Phase 4: PortfolioService (TDD — RED → GREEN)

- [x] 4.1 **RED** Escribir `apps/backend/src/services/__tests__/portfolio.test.ts` — mock `Pool` (`vi.fn` en `pool.query`) + stub `PriceService`. Cubrir SC-PORT-SUMMARY-01..04, SC-PORT-DETAIL-01..07, SC-PORT-HISTORY-01..02, NEGATIVE-PORT-01..05. Incluir spy para verificar que `calculateWAC` del engine es llamado.
- [x] 4.2 **GREEN** Implementar `getPortfolioSummary` en `apps/backend/src/services/portfolio.ts` — query SQL §5.1 (design), agrupar por `(contract_address, network)`, `buildVirtualPosition` con `decimal.js`, `calculateWAC` virtual, `getOnChainPricesBulk` + `Promise.all` CEX, totales excluyendo `priceUnavailable`, sort por symbol+network ASC.
- [x] 4.3 **GREEN** Implementar `getTokenDetail` — `findByContractAddress` → 404 si null, query ON_CHAIN/CEX con wallet filter, enriquecer txs con `PnlInfo` discriminated union, per-lot P&L con `decimal.js` (guard `priceUsd='0.00'` → `lotPnlPct=null`).
- [x] 4.4 **GREEN** Implementar `getPositionHistory` — query §5.2 (design), `ORDER BY cycle_number ASC`, retornar `[]` si no hay CLOSED (no es error).
- [x] 4.5 Pasar todos los tests unitarios al verde — `npm run test:sync`

## Phase 5: Route plugin + registro

- [x] 5.1 Crear `apps/backend/src/routes/portfolio.ts` — Fastify plugin: `TokenParamsSchema` (contractAddress + network enum), `TokenDetailQuerySchema` (wallet_id UUID opcional), 3 handlers GET (`/`, `/token/:addr/:net`, `/token/:addr/:net/history`), mapear `NotFoundError` → 404 vía `setErrorHandler` global, `createPriceService(fastify.log)` en plugin scope.
- [x] 5.2 Registrar `portfolioRoutes` en `apps/backend/src/index.ts` con prefix `/api/portfolio` — DESPUÉS de `authPlugin`.
- [x] 5.3 `npm run typecheck` — cero errores TS.

## Phase 6: Tests E2E

- [x] 6.1 Crear `tests/e2e/api/portfolio.test.ts` — helper de setup: insertar 2 wallets ON_CHAIN + 1 CEX + 3 tokens (ETH/BSC ERC-20 + Binance ETH) + transacciones que abran 2 OPEN positions y 1 ciclo CLOSED. `vi.stubGlobal('fetch', vi.fn())` para APIs externas únicamente.
- [x] 6.2 Implementar E1..E12: summary happy (200), all-fetch-throws → 200+priceUnavailable, ETH on-chain≠ETH Binance (2 filas), detail happy, detail con ?wallet_id, CEX ignora wallet_id, 404 token inexistente, 404 sin posición OPEN, history ordenada, CEX sin binance_symbol→priceUnavailable (no 500), TRANSFER_IN priceUsd null→lotPnlUsd null, sin JWT→401.
- [x] 6.3 Pasar E1..E12 al verde — `npm run test:e2e`
