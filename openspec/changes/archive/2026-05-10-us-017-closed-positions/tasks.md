# Tareas — US-017: Closed Positions + Position Cycles UI

> Cambio: `us-017-closed-positions`
> Generado: 2026-05-10
> **Estado: ALL APPLIED** (2026-05-10)
>
> Todas las tareas T-001 a T-009 están aplicadas para US-017.
> Este cambio fue documentado sin TDD/tests por decisión explícita del usuario.

---

## Work Unit 1: Backend — Schemas + Service

> Fundación del contrato backend. Primero se agregan los schemas Zod y luego el servicio que consulta, agrupa y deriva métricas de posiciones cerradas.

### T-001 — Add closed positions schemas

**Archivo:** `apps/backend/src/types/portfolio.ts` *(modificar)*

**Qué implementar:**
- Agregar `ClosedCycleSchema`
- Agregar `ClosedTokenGroupSchema`
- Agregar `ClosedPositionsResponseSchema`
- Exportar tipos inferidos necesarios para route + frontend contract

**Dependencias:** ninguna

**Estimado:** ~35 líneas

---

### T-002 — Add `getClosedPositions(pool, filters?)`

**Archivo:** `apps/backend/src/services/portfolio.ts` *(modificar)*

**Qué implementar:**
- SQL query sobre `positions` con `status='CLOSED'`
- Join con `tokens` + `wallets`
- Filtros opcionales server-side
- Agrupación por token
- Derivación de `totalProceedsUsd = cost_basis + realized_pnl_usd`
- Agregados usando `toDecimal()` + `roundToStorage()`

**Dependencias:** T-001

**Estimado:** ~110 líneas

---

## Work Unit 2: Backend — Route

> Una vez definido el contrato y el servicio, se expone el endpoint HTTP con validación Zod de query params.

### T-003 — Add `GET /api/portfolio/closed`

**Archivo:** `apps/backend/src/routes/portfolio.ts` *(modificar)*

**Qué implementar:**
- Nueva ruta `GET /api/portfolio/closed`
- Validación Zod para query params
- Llamada a `getClosedPositions(pool, filters)`
- Response tipado con `ClosedPositionsResponseSchema`

**Dependencias:** T-001, T-002

**Estimado:** ~15 líneas

---

## Work Unit 3: Frontend — Hook

> Capa de acceso a datos dedicada para ciclos cerrados. Mantiene el patrón del frontend actual, pero sin polling.

### T-004 — Create `useClosedPositions.ts`

**Archivo:** `apps/frontend/src/hooks/useClosedPositions.ts` *(crear)*

**Qué implementar:**
- Hook fetch-on-demand para `/api/portfolio/closed`
- Estados `data`, `isLoading`, `error`
- Soporte de filtros opcionales
- Refetch manual cuando la UI lo necesite
- Sin polling automático

**Dependencias:** T-003

**Estimado:** ~136 líneas

---

## Work Unit 4: Frontend — Dashboard Components

> La visibilidad de cerrados entra por el dashboard porque es la vista principal de tokens. Se implementa una sección colapsable y un toggle de visibilidad.

### T-005 — Create `ClosedPositionsSection.tsx`

**Archivo:** `apps/frontend/src/components/dashboard/ClosedPositionsSection.tsx` *(crear)*

**Qué implementar:**
- Sección colapsable
- KPI de P&L cerrado
- Lista agrupada por token
- Navegación al token detail usando fallback CEX cuando `contractAddress` sea `null`

**Dependencias:** T-004

**Estimado:** ~244 líneas

---

### T-006 — Integrate pill-toggle + closed section in dashboard

**Archivo:** `apps/frontend/src/pages/DashboardPage.tsx` *(modificar)*

**Qué implementar:**
- Pill-toggle `Activos | Cerrados | Todos`
- Integración de `ClosedPositionsSection`
- Reglas de visibilidad para no mezclar resultados cerrados con el resumen activo

**Dependencias:** T-004, T-005

**Estimado:** ~80 líneas changed

---

## Work Unit 5: Frontend — Token Detail + History

> El mismo modelo mental de cycles debe aparecer en detalle y en historial. Se crea un componente reutilizable y luego se integra en ambas páginas.

### T-007 — Create `PositionCyclesSection.tsx`

**Archivo:** `apps/frontend/src/components/token-detail/PositionCyclesSection.tsx` *(crear)*

**Qué implementar:**
- Timeline de ciclos
- Estado destacado para ciclo activo (`En curso`)
- Tarjetas para ciclos cerrados con métricas consolidadas
- Layout reutilizable entre páginas

**Dependencias:** T-004

**Estimado:** ~207 líneas

---

### T-008 — Integrate `PositionCyclesSection` in `TokenDetailPage.tsx`

**Archivo:** `apps/frontend/src/pages/TokenDetailPage.tsx` *(modificar)*

**Qué implementar:**
- Cargar closed positions filtradas al contexto del token
- Renderizar `PositionCyclesSection` junto al detalle existente

**Dependencias:** T-004, T-007

**Estimado:** ~40 líneas changed

---

### T-009 — Reuse `PositionCyclesSection` in `PositionHistoryPage.tsx`

**Archivo:** `apps/frontend/src/pages/PositionHistoryPage.tsx` *(modificar)*

**Qué implementar:**
- Sustituir/renderizar historial usando `PositionCyclesSection`
- Mantener consistencia visual y semántica con token detail

**Dependencias:** T-007, T-008

**Estimado:** ~30 líneas changed

---

## Review Workload

| Work Unit | Tareas | Superficie | Carga estimada de review |
|-----------|--------|------------|---------------------------|
| 1 | T-001, T-002 | Backend contract + service | Media — revisar shape, query y agregados Decimal |
| 2 | T-003 | Backend route | Baja — wiring HTTP + validación |
| 3 | T-004 | Frontend hook | Media — fetch lifecycle sin polling |
| 4 | T-005, T-006 | Dashboard UI | Alta — nueva sección, toggle y reglas de visibilidad |
| 5 | T-007, T-008, T-009 | Token detail + history UI | Media — componente reutilizable y consistencia cross-page |
