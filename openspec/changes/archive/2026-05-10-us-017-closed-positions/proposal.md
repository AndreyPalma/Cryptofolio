# Proposal: US-017 — Closed Positions + Position Cycles UI

## Intent

Hoy las posiciones cerradas (cycles con `balance = 0` y `realized_pnl_usd` congelado) existen en la DB pero no se exponen en la UI. El usuario no puede ver cuánto ganó o perdió con tokens que ya vendió completamente. Además, si estos valores se mezclaran con el portafolio activo, confundirían capital en juego con resultados consolidados.

US-017 resuelve ese gap con una exposición explícita y aislada de los ciclos cerrados:

1. **Backend dedicado**: un nuevo endpoint `GET /api/portfolio/closed` expone únicamente posiciones con `status='CLOSED'`.
2. **Dashboard visibility**: una sección colapsable + pill-toggle permiten alternar entre activos, cerrados o todos sin contaminar el portfolio activo.
3. **Cycle timeline**: token detail y position history muestran el ciclo actual (`En curso`) y los ciclos cerrados con sus métricas consolidadas.

## Scope

### In scope

| Acción | Archivo | Descripción |
|--------|---------|-------------|
| Modificar | `apps/backend/src/types/portfolio.ts` | Agregar Zod schemas: ClosedCycleSchema, ClosedTokenGroupSchema, ClosedPositionsResponseSchema |
| Modificar | `apps/backend/src/services/portfolio.ts` | Agregar `getClosedPositions(pool, filters?)` con SQL query y agrupación por token |
| Modificar | `apps/backend/src/routes/portfolio.ts` | Agregar `GET /api/portfolio/closed` con Zod query validation |
| Crear | `apps/frontend/src/hooks/useClosedPositions.ts` | Hook fetch-on-demand para `/api/portfolio/closed` |
| Crear | `apps/frontend/src/components/dashboard/ClosedPositionsSection.tsx` | Sección colapsable con KPI P&L + lista tokens cerrados |
| Crear | `apps/frontend/src/components/token-detail/PositionCyclesSection.tsx` | Timeline de ciclos (activo `En curso` + cerrados con métricas) |
| Modificar | `apps/frontend/src/pages/DashboardPage.tsx` | Integrar ClosedPositionsSection + pill-toggle `Activos | Cerrados | Todos` |
| Modificar | `apps/frontend/src/pages/TokenDetailPage.tsx` | Integrar PositionCyclesSection |
| Modificar | `apps/frontend/src/pages/PositionHistoryPage.tsx` | Actualizar con PositionCyclesSection |

### Out of scope

- Cambios a `GET /api/portfolio` (portafolio activo)
- Migraciones DB
- Tests / TDD (por decisión explícita del usuario)
- Cambios al position engine o reglas de WAC/cycles

## Approach

1. **Backend additive-only** — Nuevo endpoint `GET /api/portfolio/closed` que consulta `positions` con `status='CLOSED'`, hace join con `tokens` + `wallets`, agrupa por `token_id`, calcula `totalProceedsUsd = cost_basis + realized_pnl_usd` y retorna `ClosedPositionsResponse`.

2. **Frontend fetch-on-demand** — Hook con el patrón de `usePortfolio`, pero sin polling. La data de cerrados se carga al montar o al cambiar filtros. El dashboard agrega una sección colapsable con KPI de P&L y un pill-toggle para filtrar `Activos | Cerrados | Todos`.

3. **Cycle visibility** — `PositionCyclesSection` se reutiliza en token detail y position history para mostrar el ciclo activo (`En curso`) y los cerrados con métricas por ciclo.

4. **Aislamiento estricto** — El P&L cerrado NUNCA se suma al portfolio activo. La vista cerrada es informativa/histórica; la vista activa sigue representando solo capital en juego.

## Risks

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Query de posiciones cerradas lenta en wallets con muchos cycles | Respuesta lenta en `/api/portfolio/closed` | Query simple con índice existente en `(token_id, status)`. Filtros server-side reducen el dataset |
| Token con cycles mixtos (cerrados + activo) | Confusión sobre dónde aparece cada dato | Regla estricta: endpoint cerrado retorna SOLO cycles cerrados, endpoint activo retorna SOLO el cycle abierto. Sin overlap |
| CEX tokens con `contractAddress = null` en navegación | Links rotos en la UI | `token-path.ts` usa `symbol.toLowerCase()` como fallback para CEX tokens |

## Non-goals

- Aggregate P&L across active and closed positions
- Pagination para closed positions
- Export / CSV
- Charts / graphs
- Cambios a sync, ingestión o cálculo contable base
