# Delta Spec: US-017 — Closed Positions + Position Cycles UI

> **Área:** Portfolio — Posiciones Cerradas, Dashboard Visibility, Token Cycle Timeline  
> **Estado del sistema actual:** Las posiciones cerradas ya existen en la base de datos como cycles con `status='CLOSED'`, `balance=0` y `realized_pnl_usd` congelado. Sin embargo, el backend no expone un endpoint dedicado para consultarlas y la UI no muestra cuánto ganó o perdió el usuario en tokens que ya cerró completamente.

---

## ADDED Requirements

---

### REQ-001: Closed positions endpoint separado

El sistema MUST exponer `GET /api/portfolio/closed` como un endpoint independiente de `GET /api/portfolio` para retornar únicamente posiciones con `status='CLOSED'`.

El endpoint MUST ser additive-only: NO DEBE alterar la semántica ni el shape del endpoint activo existente.

#### Scenario: Consulta exitosa de posiciones cerradas

- GIVEN que el usuario autenticado tiene cycles con `status='CLOSED'`
- WHEN el cliente hace `GET /api/portfolio/closed`
- THEN el servidor MUST responder HTTP 200
- AND el payload MUST incluir solo cycles cerrados
- AND `GET /api/portfolio` MUST permanecer sin cambios

#### Scenario: Usuario sin posiciones cerradas

- GIVEN que el usuario autenticado no tiene cycles con `status='CLOSED'`
- WHEN el cliente hace `GET /api/portfolio/closed`
- THEN el servidor MUST responder HTTP 200
- AND el payload MUST contener `tokens: []`
- AND los totales agregados MUST ser `0` en formato string consistente con storage

---

### REQ-002: Agrupación por token con cycles embebidos

La respuesta de closed positions MUST agrupar los resultados por token y cada grupo MUST incluir la lista de cycles cerrados pertenecientes a ese token.

Cada cycle cerrado MUST conservar su contexto de wallet (`walletId`, `walletLabel`) aunque la agrupación principal sea por token.

#### Scenario: Token con múltiples cycles cerrados

- GIVEN que un token tiene dos o más cycles cerrados en distintas fechas
- WHEN el backend construye la respuesta
- THEN ambos cycles MUST aparecer bajo el mismo grupo de token
- AND cada cycle MUST exponer su `cycleNumber`
- AND cada cycle MUST preservar su wallet de origen

#### Scenario: Token con cycles cerrados en múltiples wallets

- GIVEN que el usuario cerró el mismo token en más de una wallet
- WHEN consulta `GET /api/portfolio/closed`
- THEN el endpoint MUST retornar un único grupo por token
- AND cada cycle MUST indicar la wallet correspondiente
- AND el frontend NO DEBE necesitar fusionar wallets manualmente

---

### REQ-003: Métricas derivadas para cycles cerrados

Para cada cycle cerrado, el sistema MUST derivar `totalProceedsUsd` como `cost_basis + realized_pnl_usd`.

Los agregados por token y globales MUST calcularse con precisión decimal consistente con el resto del codebase. La implementación NO DEBE usar `number` nativo para contabilidad.

#### Scenario: Cycle cerrado con ganancia

- GIVEN un cycle cerrado con `cost_basis = 1000` y `realized_pnl_usd = 250`
- WHEN el backend serializa el cycle
- THEN `totalProceedsUsd` MUST ser `1250`
- AND el valor MUST representarse como string decimal con precisión de storage

#### Scenario: Cycle cerrado con pérdida

- GIVEN un cycle cerrado con `cost_basis = 1000` y `realized_pnl_usd = -125`
- WHEN el backend serializa el cycle
- THEN `totalProceedsUsd` MUST ser `875`
- AND el P&L cerrado MUST conservar el signo negativo

---

### REQ-004: Dashboard visibility para activos, cerrados y todos

El dashboard MUST permitir alternar la visibilidad entre `Activos`, `Cerrados` y `Todos` mediante un pill-toggle explícito.

La vista de cerrados MUST presentarse en una sección propia (`ClosedPositionsSection`) con KPIs y lista agrupada por token. La sección SHOULD poder colapsarse para reducir ruido visual.

#### Scenario: Vista solo activos

- GIVEN que el usuario tiene tokens activos y cerrados
- WHEN selecciona el pill `Activos`
- THEN el dashboard MUST mostrar solo el portafolio activo
- AND la sección de cerrados NO DEBE contaminar los KPIs activos

#### Scenario: Vista solo cerrados

- GIVEN que el usuario tiene tokens activos y cerrados
- WHEN selecciona el pill `Cerrados`
- THEN el dashboard MUST mostrar la sección de posiciones cerradas
- AND el usuario MUST poder ver el P&L consolidado por token cerrado

#### Scenario: Vista todos

- GIVEN que el usuario tiene ambos tipos de datos
- WHEN selecciona el pill `Todos`
- THEN el dashboard MUST mostrar activos y cerrados en la misma pantalla
- BUT cada bloque MUST mantener métricas separadas

---

### REQ-005: Token detail MUST mostrar timeline de cycles

`TokenDetailPage` MUST integrar una sección reutilizable (`PositionCyclesSection`) que muestre el ciclo activo como `En curso` y los cycles cerrados debajo en orden cronológico inverso.

Si un token no tiene ciclo activo, la sección MUST seguir mostrando el historial cerrado si existe.

#### Scenario: Token con cycle activo y cycles cerrados

- GIVEN que un token tiene un cycle abierto y dos cerrados
- WHEN el usuario abre el token detail
- THEN la sección MUST mostrar primero el ciclo `En curso`
- AND debajo MUST listar los cycles cerrados más recientes primero

#### Scenario: Token completamente cerrado

- GIVEN que un token no tiene balance activo pero sí cycles cerrados
- WHEN el usuario abre el token detail
- THEN la sección MUST seguir mostrando el historial de cycles cerrados
- AND la ausencia de cycle activo NO DEBE ocultar el historial

---

### REQ-006: Position history MUST reutilizar el mismo modelo visual

`PositionHistoryPage` MUST reutilizar `PositionCyclesSection` o una representación semánticamente equivalente para evitar dos versiones distintas del historial de cycles.

#### Scenario: Consistencia entre páginas

- GIVEN que el usuario ve un token en `TokenDetailPage` y en `PositionHistoryPage`
- WHEN compara ambas vistas
- THEN los cycles cerrados MUST conservar los mismos labels y métricas base
- AND el concepto de ciclo activo/cerrado MUST mantenerse consistente

---

### REQ-007: Aislamiento estricto entre portfolio activo y resultados cerrados

El P&L de posiciones cerradas MUST NO sumarse al summary del portafolio activo. El endpoint cerrado y la UI cerrada existen para reporting histórico, no para redefinir capital en juego.

#### Scenario: Token con cycle activo y uno cerrado

- GIVEN que un token tiene un cycle cerrado histórico y un cycle activo nuevo
- WHEN el usuario consulta el dashboard activo
- THEN los KPIs activos MUST reflejar solo el cycle abierto
- AND el cycle cerrado MUST aparecer únicamente en la vista cerrada / timeline

#### Scenario: Navegación de token CEX sin contract address

- GIVEN un token CEX con `contractAddress = null`
- WHEN la UI construye links desde la sección de cerrados
- THEN la navegación MUST usar un fallback estable basado en `symbol.toLowerCase()`
- AND el link NO DEBE romperse por ausencia de contract address

---

## Key Invariants

| Invariante | Regla |
|-----------|-------|
| Closed-only endpoint | `GET /api/portfolio/closed` retorna SOLO `positions.status = 'CLOSED'` |
| Active endpoint unchanged | `GET /api/portfolio` mantiene su contrato actual |
| No overlap | Un cycle cerrado NO aparece como posición activa en el agregado principal |
| Derived proceeds | `totalProceedsUsd = cost_basis + realized_pnl_usd` para balance 0 |
| Decimal safety | Los agregados usan precisión decimal consistente con `decimal-utils.ts` |
| Token-first grouping | La agrupación principal es por token; wallet vive a nivel cycle |
| Mixed-cycle tokens | Un token puede tener cycles cerrados y uno activo, pero cada vista muestra solo lo que le corresponde |

---

## UNCHANGED

- Sin cambios a `GET /api/portfolio` ni al summary del portafolio activo
- Sin migraciones DB ni columnas nuevas
- Sin cambios al position engine, WAC o reglas de apertura/cierre de cycles
- Sin cambios a sync, ingestión Binance/on-chain o pricing sources
- Sin tests/TDD en este cambio (decisión explícita del usuario)
