# Design: US-017 — Closed Positions + Position Cycles UI

## Enfoque Técnico

Se agrega un endpoint backend independiente (`GET /api/portfolio/closed`) que expone solo ciclos cerrados (`status='CLOSED'`) agrupados por token. El servicio de portfolio calcula métricas derivadas con `Decimal.js` usando los helpers compartidos del codebase, y el frontend consume la data mediante un hook fetch-on-demand sin polling. En UI, el dashboard presenta una sección colapsable con KPIs y visibilidad `Activos | Cerrados | Todos`, mientras que token detail y position history reutilizan un único componente `PositionCyclesSection` para mostrar el ciclo en curso y el historial cerrado.

---

## Decisiones de Arquitectura

### D-001: Endpoint separado, no extensión de `/api/portfolio`

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Crear `GET /api/portfolio/closed` | Aisla completamente la data histórica de la activa. Permite optimizar y cachear cada endpoint por separado | **ELEGIDA** |
| Extender `GET /api/portfolio` con flags | Menos endpoints, pero mezcla dos conceptos con reglas contables distintas | Descartada |
| Reusar `GET /api/tokens/:id` para todo | Forzaría al frontend a reconstruir agregados cross-token desde detalle granular | Descartada |

**Rationale**: El PRD exige aislamiento estricto entre capital activo y resultados cerrados (RD-012). Si mezcláramos la data en un solo endpoint, cualquier bug en cálculo histórico podría alterar la vista activa. Endpoints separados también simplifican ownership de performance y evolución futura.

### D-002: Agrupación por token, no por wallet

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Agrupar por `token_id` y embebar wallet en cada cycle | Responde a la pregunta real del usuario: "¿cuánto gané con BTC?". Mantiene trazabilidad por cycle | **ELEGIDA** |
| Agrupar por wallet | Facilita una vista operativa por cuenta, pero fragmenta el resultado económico por token | Descartada |
| No agrupar y retornar lista plana de cycles | Backend más simple, frontend más complejo y menos consistente | Descartada |

**Rationale**: El usuario piensa en desempeño por token, no por contenedor. Cada ciclo cerrado sigue incluyendo `walletId` + `walletLabel`, por lo que el contexto de wallet se conserva sin volverlo la dimensión primaria.

### D-003: `totalProceedsUsd` derivado, no almacenado

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Derivar `totalProceedsUsd = cost_basis + realized_pnl_usd` en runtime | Cero migraciones. Reusa invariantes ya existentes de posiciones cerradas | **ELEGIDA** |
| Agregar columna persistida en DB | Lee más rápido, pero duplica una métrica derivable y abre riesgo de drift | Descartada |
| Calcular desde `transactions` en cada request | Máxima trazabilidad, pero costo de query innecesario y mayor complejidad | Descartada |

**Rationale**: Para posiciones cerradas (`balance = 0`), `cost_basis` y `realized_pnl_usd` ya contienen toda la información necesaria. No se requiere una nueva columna ni escanear transacciones históricas.

### D-004: `Decimal.js` en vez de `SQL SUM()` directo

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Convertir strings SQL a `Decimal` y usar `toDecimal()` + `roundToStorage()` | Consistencia total con el resto del codebase y control explícito de precisión | **ELEGIDA** |
| `SUM()::TEXT` en SQL para todos los cálculos | Menos lógica TS, pero reparte reglas de precisión entre SQL y app | Descartada |
| Usar `number` nativo en TS | Más simple, pero introduce errores de floating point | Descartada |

**Rationale**: Aunque el PRD puede expresar agregados como `SUM()::TEXT`, la implementación actual del proyecto usa `decimal-utils.ts` para conservar precisión y formato homogéneo. Mantener el mismo patrón reduce drift contable.

### D-005: Hook sin polling

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| `useClosedPositions()` fetch-on-demand | Menor tráfico y estado más predecible para data histórica | **ELEGIDA** |
| Polling cada 60s como `usePortfolio()` | Simetría visual, pero costo innecesario para data que rara vez cambia | Descartada |
| Cargar cerrados dentro de `usePortfolio()` | Menos hooks, pero rompe el aislamiento del endpoint | Descartada |

**Rationale**: Las posiciones cerradas no son un ticker en tiempo real. Cambian solo después de una sync o de una edición que cierre/reabra ciclos, así que fetch-on-demand al montar o cambiar filtros es suficiente.

### D-006: Pill-toggle en dashboard, no `TokensPage` separado

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Integrar toggle en `DashboardPage` | Reusa la vista principal ya existente y evita navegación extra | **ELEGIDA** |
| Crear una página nueva solo para cerrados | Más separación, pero añade fricción y dispersa la experiencia | Descartada |
| Dejar cerrados solo en token detail | Oculta el agregado global que motivó la historia | Descartada |

**Rationale**: El proyecto no tiene una `TokensPage` separada; el dashboard ya es la vista de tokens. El toggle vive ahí para que el cambio sea visible y consistente con la navegación actual.

### D-007: `PositionCyclesSection` reutilizable

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Un solo componente reutilizable para ciclo activo + cerrados | Misma semántica y render en TokenDetailPage y PositionHistoryPage | **ELEGIDA** |
| Un componente por página | Más libertad local, pero duplica lógica y riesgo de drift visual | Descartada |
| Render inline en cada página | Menos archivos nuevos, pero peor mantenibilidad y reviewability | Descartada |

**Rationale**: La historia necesita mostrar el mismo modelo mental en dos superficies distintas. Centralizar el timeline en `PositionCyclesSection` reduce divergencias y facilita cambios futuros sobre métricas, labels o layout.

---

## Flujo de Datos

### Diagrama de arquitectura

```text
Frontend                              Backend
─────────────────────────────────     ─────────────────────────────
DashboardPage                         routes/portfolio.ts
  usePortfolio() ─────────────────→     GET /api/portfolio (UNCHANGED)
  useClosedPositions() ────────────→    GET /api/portfolio/closed (NEW)
    ├ ClosedPositionsSection              └→ getClosedPositions(pool, filters)
    └ PortfolioVisibilityToggle               └→ SQL: positions + tokens + wallets
                                                   WHERE status='CLOSED'
TokenDetailPage
  useClosedPositions({network}) ───→    GET /api/portfolio/closed?network=X
    └ PositionCyclesSection               └→ same service, filtered
```

### Flujo resumido

1. El frontend llama `useClosedPositions(filters?)`.
2. El hook hace `GET /api/portfolio/closed` con query params opcionales (`network`, `walletId`, `tokenId`, etc. según el alcance implementado).
3. La ruta valida query params con Zod y delega a `getClosedPositions(pool, filters)`.
4. El servicio consulta `positions` + `tokens` + `wallets` filtrando `status='CLOSED'`.
5. El servicio agrupa filas por token, deriva KPIs por token/cycle usando `Decimal.js` y retorna `ClosedPositionsResponseSchema`.
6. El dashboard/timeline renderiza la data sin mezclarla con métricas del portafolio activo.

---

## Shape del Response

### `GET /api/portfolio/closed`

```json
{
  "totalClosedPnlUsd": "845.23000000",
  "totalClosedCostBasisUsd": "4100.00000000",
  "totalClosedProceedsUsd": "4945.23000000",
  "tokens": [
    {
      "tokenId": "token-btc-binance",
      "symbol": "BTC",
      "name": "Bitcoin",
      "network": "CEX_BINANCE",
      "contractAddress": null,
      "binanceSymbol": "BTC",
      "closedCyclesCount": 2,
      "totalClosedPnlUsd": "620.00000000",
      "totalClosedCostBasisUsd": "3000.00000000",
      "totalClosedProceedsUsd": "3620.00000000",
      "cycles": [
        {
          "positionId": "pos-btc-2",
          "cycleNumber": 2,
          "walletId": "wallet-binance",
          "walletLabel": "Binance",
          "openedAt": "2026-04-01T10:00:00.000Z",
          "closedAt": "2026-04-10T18:30:00.000Z",
          "costBasisUsd": "1800.00000000",
          "realizedPnlUsd": "420.00000000",
          "totalProceedsUsd": "2220.00000000"
        },
        {
          "positionId": "pos-btc-1",
          "cycleNumber": 1,
          "walletId": "wallet-binance",
          "walletLabel": "Binance",
          "openedAt": "2026-03-10T09:00:00.000Z",
          "closedAt": "2026-03-18T15:45:00.000Z",
          "costBasisUsd": "1200.00000000",
          "realizedPnlUsd": "200.00000000",
          "totalProceedsUsd": "1400.00000000"
        }
      ]
    }
  ]
}
```

### Campos clave

| Campo | Significado |
|-------|-------------|
| `totalClosedPnlUsd` | Suma del P&L realizado de todos los cycles cerrados retornados |
| `totalClosedCostBasisUsd` | Suma del capital histórico invertido en cycles cerrados |
| `totalClosedProceedsUsd` | Suma derivada de `costBasis + realizedPnl` |
| `tokens[].cycles[]` | Lista de cycles cerrados por token, ordenados del más reciente al más antiguo |
| `walletLabel` | Contexto visible de dónde ocurrió cada cycle |

---

## Impacto en UI

| Superficie | Cambio |
|------------|--------|
| Dashboard | Sección colapsable `ClosedPositionsSection` + pill-toggle `Activos | Cerrados | Todos` |
| Token detail | Timeline de cycles con el activo como `En curso` y los cerrados debajo |
| Position history | Reutiliza `PositionCyclesSection` para evitar dos representaciones distintas del mismo historial |
| Portfolio activo | **Sin cambios semánticos**; no absorbe P&L cerrado |
