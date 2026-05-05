# Archive Report — US-007 Portfolio API

**Archived:** 2026-05-05  
**Verdict:** PASS WITH WARNINGS  
**Tests:** 50 unit + 8 E2E = 58 passed, 0 failed

## What was built

- **PriceService**: DefiLlama (bulk ON_CHAIN, TTL 60s) + Binance ticker (CEX, TTL 10s), module-level cache, NEVER throws
- **PortfolioService**: getPortfolioSummary, getTokenDetail, getPositionHistory
- **TokenService**: added findByContractAddress (case-insensitive)
- **Routes**: GET /api/portfolio, GET /api/portfolio/token/:addr/:net, GET /api/portfolio/token/:addr/:net/history

## Files created / modified

- `apps/backend/src/types/portfolio.ts` (NEW)
- `apps/backend/src/services/price.ts` (NEW)
- `apps/backend/src/services/portfolio.ts` (NEW)
- `apps/backend/src/services/token.ts` (MODIFIED — findByContractAddress added)
- `apps/backend/src/routes/portfolio.ts` (NEW)
- `apps/backend/src/index.ts` (MODIFIED — portfolioRoutes registered)
- `apps/backend/src/services/__tests__/price.test.ts` (NEW — 14 tests)
- `apps/backend/src/services/__tests__/portfolio.test.ts` (NEW — 17 tests)
- `apps/backend/src/services/__tests__/token.test.ts` (MODIFIED — 3 SC-TOKEN-LOOKUP tests added)
- `tests/e2e/api/portfolio.test.ts` (NEW — 8 E2E tests)

## Warnings at archive

- **NEGATIVE-PORT-02**: no dedicated assertion that `log.warn` is emitted when `binance_symbol=null`. The priceUnavailable behavior is covered implicitly; the warn emission is not verified via explicit log spy.
- **Route-level E2E coverage gaps** (10 partial scenarios covered at service unit layer only): SC-ROUTE-DETAIL-04/05/06, SC-ROUTE-HISTORY-03/04, NEGATIVE-ROUTE-02/03/05, SC-ROUTE-SUMMARY-01. All are covered at the service unit layer; no dedicated HTTP-level E2E test for these paths.

## Specs synced to main openspec/specs

- `openspec/specs/portfolio-service/spec.md` — updated with final version (estado: finalizado, última revisión: 2026-05-05)
- `openspec/specs/portfolio-routes/spec.md` — updated with final version (estado: finalizado, última revisión: 2026-05-05)
- `openspec/specs/token-service/spec.md` — added section 7 (TokenService.findByContractAddress) with SC-TOKEN-LOOKUP-01/02/03 scenarios

## Next steps

- If route-level E2E coverage is a priority, add dedicated E2E tests for the 10 partial scenarios before the next frontend release.
- NEGATIVE-PORT-02 can be verified implicitly through existing unit tests; explicit log spy is optional for V1.
