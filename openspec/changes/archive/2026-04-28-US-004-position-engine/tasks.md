# Tasks: US-004 — PositionEngine

> **Modo:** Strict TDD — los tests se escriben ANTES que el código (RED → GREEN → REFACTOR).
> **Test runner:** `npm run test:engine` (vitest project `engine`, unit puro, sin DB).
> **Cobertura objetivo:** 100% líneas y branches en `engine.ts`.

---

## Fase 1: Dependencias y tooling

1.1 [ ] Instalar `decimal.js` como dependencia de producción en `apps/backend`: `npm install decimal.js -w apps/backend`. Verificar que queda en `dependencies` (no `devDependencies`) — el motor lo usa en runtime.

1.2 [ ] Agregar el script `test:engine` en `apps/backend/package.json`: `"test:engine": "vitest run --project engine"`. Verificar que el script no existía antes (el `package.json` actual no lo tiene).

1.3 [ ] Agregar el script `test` (alias general) en `apps/backend/package.json`: `"test": "vitest run"`. Necesario para que el CI y los quality gates del PRD puedan correr todos los proyectos vitest juntos.

1.4 [ ] Crear `apps/backend/vitest.config.ts` declarando el project `engine` con `include: ['src/position-engine/__tests__/**/*.test.ts']` y `environment: 'node'`. Sin imports de DB ni setup global — el proyecto `engine` es 100% unit puro. Confirmar que `vitest` ya está en `devDependencies` (está como `"vitest": "*"`).

---

## Fase 2: Types y utils (tipos antes que implementación)

2.1 [ ] Crear `apps/backend/src/position-engine/decimal-utils.ts` con: configuración global `Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN })` al cargar el módulo, `ZERO`, `toDecimal(value: string): Decimal`, `roundToStorage(value: Decimal): string` (usa `toFixed(18, Decimal.ROUND_HALF_EVEN)` — notación decimal plana, no científica), `isInbound(type: TransactionType): boolean`, `isOutbound(type: TransactionType): boolean`. Named exports only.

2.2 [ ] Crear `apps/backend/src/position-engine/types.ts` con los tipos del dominio: `DecimalString`, `TransactionInput`, `PositionState` (con `status: PositionStatus` — acepta OPEN y CLOSED para poder representar el output de cierre), `ProcessTransactionInput` (con `positionIdentity` opcional pero requerido en runtime cuando `position === null`), `PositionEngineResult`, `WACResult`. Importar `TransactionType`, `TransactionSource`, `CostSource`, `PositionStatus` desde `../db/types.js`. Usar `as const` + `typeof` extraction, no `enum` nativo de TS. Sin `any` — `unknown` + narrowing en boundaries.

2.3 [ ] Agregar las tres clases de error tipadas al final de `types.ts` (co-locadas con los tipos según D6 del design): `InsufficientBalanceError` con `name: "InsufficientBalanceError" as const`, `currentBalance: DecimalString`, `attempted: DecimalString`; `InvalidTransactionError` con `name: "InvalidTransactionError" as const`, `reason: string`, `context: Readonly<Record<string, unknown>>`; `InvalidPositionStateError` con `name: "InvalidPositionStateError" as const`, `reason: string`. Clases extienden `Error` y setean el mensaje en `super(...)`. Nunca lanzar strings ni `Error` genérico.

2.4 [ ] Crear `apps/backend/src/position-engine/engine.ts` con el esqueleto vacío: las firmas públicas `processTransaction` y `calculateWAC` exportadas pero sin implementación (lanzar `new Error("not implemented")` como placeholder). Esto permite que los tests importen las funciones antes de que estén implementadas — punto de partida Strict TDD.

2.5 [ ] Crear `apps/backend/src/position-engine/__tests__/` (directorio) y el archivo vacío `engine.test.ts` con el boilerplate de vitest (`import { describe, it, expect } from 'vitest'`). Verificar que `npm run test:engine` encuentra el archivo (puede fallar por tests vacíos — eso está bien en este punto).

---

## Fase 3: Tests RED (escribir tests ANTES del motor)

> Cada test debe fallar con "not implemented" o un error de tipo, nunca pasar, antes de que exista la implementación correspondiente. Eso confirma que el test es válido.

3.1 [ ] Escribir test `'DCA: tres BUYs a $1/$2/$3 × 10 tokens → wac exacto "2.000000000000000000"'` (cubre REQ-002 Sc.1 + REQ-006 Sc.1): encadenar tres llamadas a `processTransaction`, cada una con el `position` resultado de la anterior. Verificar `result.position.wac === "2.000000000000000000"`, `balance === "30.000000000000000000"`, `cost_basis === "60.000000000000000000"`, y que `realizedPnlDelta === "0.000000000000000000"` en los tres.

3.2 [ ] Escribir test `'SELL parcial: BUY 10@$2 → SELL 5@$3 → WAC sin cambio, balance 5'` (cubre REQ-003 Sc.1): verificar `result.position.wac === "2.000000000000000000"`, `result.position.balance === "5.000000000000000000"`, `result.position.cost_basis === "10.000000000000000000"`, `result.realizedPnlDelta === "5.000000000000000000"`, `result.positionWasClosed === false`.

3.3 [ ] Escribir test `'Ciclo completo: BUY→SELL total→CLOSED→BUY nuevo cycle sin herencia de WAC'` (cubre REQ-004 Sc.1 + REQ-004 Sc.2): verificar que después del SELL total `result.position.status === "CLOSED"`, `result.positionWasClosed === true`, `result.position.closed_at` igual al `blockTimestamp` del SELL. Luego llamar con `position: null`, `priorClosedCycles: 1` y `BUY 5@$1` → `result.position.cycle_number === 2`, `result.position.wac === "1.000000000000000000"`, `result.position.realized_pnl_usd === "0.000000000000000000"`.

3.4 [ ] Escribir test `'Convert Binance: SWAP_OUT 100 USDT@$1 cierra posición USDT + SWAP_IN 0.033 ETH@$3030 abre posición ETH'` (cubre REQ-005 Sc.2): procesar las dos transacciones por separado (una llamada por tx). Verificar cierre de USDT: `positionWasClosed === true`. Verificar apertura de ETH: `result.position.wac === "3030.000000000000000000"`, `balance === "0.033000000000000000"`, `status === "OPEN"`. El motor NO sabe que son un swap linkeado — las procesa de forma independiente.

3.5 [ ] Escribir test `'TRANSFER_IN herencia: BUY 10 ETH@$2000 + TRANSFER_IN 0.5@$3000 → WAC ponderado correcto'` (cubre REQ-002 Sc.2): resultado esperado `wac === "2047.619047619047619047..."` redondeado a 18 decimales → `"2047.619047619047619048"` (banker's rounding). Verificar `balance === "10.500000000000000000"`. El motor es agnóstico a `costSource: 'INHERITED'` — no hay rama especial.

3.6 [ ] Escribir test `'NEGATIVE: SELL 15 con balance 10 → InsufficientBalanceError con shape exacto'` (cubre REQ-007 Sc.1): usar `expect(() => processTransaction(...)).toThrow(InsufficientBalanceError)`. Capturar el error y verificar `err.currentBalance === "10.000000000000000000"`, `err.attempted === "15.000000000000000000"`, `err.name === "InsufficientBalanceError"`. Verificar que el estado de la posición no muta (re-inspeccionar el objeto original).

3.7 [ ] Escribir test `'Source-agnosticism: misma secuencia DCA con ETHERSCAN vs BINANCE → outputs estructuralmente idénticos'` (cubre REQ-005 Sc.1): ejecutar la secuencia `BUY 10@$1, BUY 10@$2, BUY 10@$3` dos veces, una con `source: 'ETHERSCAN'` y otra con `source: 'BINANCE'`. Comparar `wac`, `balance`, `cost_basis`, `realized_pnl_usd` con `toEqual` entre ambas corridas.

3.8 [ ] Escribir test `'NEGATIVE: posición CLOSED pasada como input → InvalidPositionStateError'` (cubre REQ-008 Sc.1): construir un objeto `position` con `status: 'CLOSED'` y pasarlo a `processTransaction`. Verificar `expect(() => ...).toThrow(InvalidPositionStateError)` con mensaje que indique que el caller debe pasar `null`.

3.9 [ ] Escribir test `'NEGATIVE: SELL sin posición OPEN activa → InvalidTransactionError'` (cubre REQ-009 Sc.1): llamar `processTransaction({ position: null, priorClosedCycles: 0, transaction: { type: 'SELL', ... } })`. Verificar `toThrow(InvalidTransactionError)` con `reason` indicando ausencia de posición OPEN.

3.10 [ ] Escribir test `'NEGATIVE: SELL con priceUsd=null → InvalidTransactionError'` (cubre REQ-010 Sc.1): posición OPEN con balance 10, llamar SELL con `priceUsd: null`. Verificar error con `reason` indicando que SELL/SWAP_OUT requieren priceUsd.

3.11 [ ] Escribir test `'TRANSFER_OUT con priceUsd=null → no genera P&L, balance se reduce'` (cubre REQ-003 Sc.3): posición con `balance=10`, `wac=2`. TRANSFER_OUT 2 con `priceUsd: null`. Verificar `balance === "8.000000000000000000"`, `wac === "2.000000000000000000"`, `realizedPnlDelta === "0.000000000000000000"`, `status === "OPEN"`.

3.12 [ ] Escribir test `'Lifecycle flags: BUY sobre posición existente → positionWasOpened=false, positionWasClosed=false'` (cubre REQ-011 Sc.1): posición OPEN existente, BUY nuevo. Verificar ambos flags `false`.

3.13 [ ] Escribir test `'calculateWAC: sin precio actual → unrealizedPnlUsd y unrealizedPnlPct null'`: llamar `calculateWAC(position)` sin segundo argumento. Verificar que el resultado tiene `wac`, `costBasis`, `balance` correctos, y `unrealizedPnlUsd === null`, `unrealizedPnlPct === null`.

3.14 [ ] Escribir test `'calculateWAC: con precio actual → P&L no realizado correcto'`: posición con `wac="2"`, `balance="10"`. Llamar `calculateWAC(position, "3")`. Verificar `unrealizedPnlUsd === "10.000000000000000000"` (= (3-2)×10), `unrealizedPnlPct === "50.000000000000000000"` (= (3-2)/2×100).

3.15 [ ] Verificar que **todos** los tests recién escritos fallan con `npm run test:engine` (salida RED). Si alguno pasa, revisar — significa que el placeholder "not implemented" no se lanza o el test tiene un error lógico.

---

## Fase 4: Motor GREEN (implementar hasta que pasen los tests)

> Implementar en el mismo orden que los tests. Correr `npm run test:engine` después de cada subtarea para confirmar que el test correspondiente pasa (GREEN) sin romper los anteriores.

4.1 [ ] Implementar `openNewCycle` en `engine.ts`: validar `positionIdentity` requerido cuando `position === null`, lanzar `InvalidTransactionError({ reason: 'MISSING_POSITION_IDENTITY' })` si falta. Validar que `priceUsd !== null` para inbound (lanzar `InvalidTransactionError({ reason: 'INBOUND_REQUIRES_PRICE' })`). Construir `PositionState` nuevo con `cycleNumber = priorClosedCycles + 1`, `balance = roundToStorage(amount)`, `wac = roundToStorage(price)`, `costBasis = roundToStorage(amount × price)`, `realizedPnlUsd = '0.000000000000000000'`. Retornar `PositionEngineResult` con `positionWasOpened: true`. **Test target:** 3.1 (primer BUY del DCA).

4.2 [ ] Implementar `appendToOpenPosition` en `engine.ts`: validar `priceUsd !== null`. Calcular `newBalance = oldBalance + inAmount`, `newCostBasis = oldCostBasis + inAmount × inPrice`, `newWac = newCostBasis / newBalance` con `Decimal`. Aplicar `roundToStorage` en todos los campos del `PositionState` actualizado. Retornar con `realizedPnlDelta: '0.000000000000000000'`, `positionWasOpened: false`, `positionWasClosed: false`. **Test target:** 3.1 (segundo y tercer BUY del DCA).

4.3 [ ] Implementar `reduceOpenPosition` básico en `engine.ts`: balance guard con `InsufficientBalanceError` (shape exacto con `currentBalance` y `attempted` como `DecimalString` del state y input sin modificar), reducir balance, mantener WAC, recalcular `costBasis = wac × newBalance`, calcular `realizedDelta = (exitPrice - wac) × sellAmount`. **Test target:** 3.2 (SELL parcial) y 3.6 (NEGATIVE overflow).

4.4 [ ] Agregar detección de cierre en `reduceOpenPosition`: si `newBalance.isZero()` → `status = 'CLOSED'`, `closedAt = tx.blockTimestamp`, `positionWasClosed = true`. **Test target:** 3.3 (ciclo completo, parte SELL total).

4.5 [ ] Implementar soporte para ciclo post-CLOSED en `processTransaction`: cuando `input.position` tiene `status === 'CLOSED'`, rutear a `openNewCycle` (no lanzar error). Verificar que `priorClosedCycles` se usa para `cycleNumber = priorClosedCycles + 1` y que el WAC empieza limpio. **Test target:** 3.3 (parte BUY nuevo tras CLOSED).

4.6 [ ] Implementar guard de posición CLOSED pasada explícitamente: si `input.position !== null && input.position.status === 'CLOSED'` Y la transacción no es inbound → lanzar `InvalidPositionStateError`. Si es inbound → rutear a `openNewCycle` (ver 4.5 — un CLOSED como input en inbound es aceptado para abrir nuevo cycle, según pseudocódigo del design §3.1). Ajustar según el contrato final del design: el spec REQ-008 dice rechazar siempre una posición CLOSED. **Test target:** 3.8. **Nota:** si hay tensión entre design §3.1 y spec REQ-008, el spec es la fuente normativa — lanzar `InvalidPositionStateError` siempre que llegue una posición CLOSED, independientemente del tipo de transacción. El caller debe pasar `null` + `priorClosedCycles`.

4.7 [ ] Implementar guard SELL sin posición: si `isOutbound(tx.type) && input.position === null` → lanzar `InvalidTransactionError({ reason: 'OUTBOUND_WITHOUT_POSITION' })`. **Test target:** 3.9.

4.8 [ ] Implementar regla `T_OUT_NULL` en `reduceOpenPosition`: si `tx.type === 'TRANSFER_OUT' && tx.priceUsd === null` → `realizedDelta = ZERO` (no error). Si otro outbound con `priceUsd === null` → lanzar `InvalidTransactionError({ reason: 'OUTBOUND_REQUIRES_PRICE' })`. **Test target:** 3.10 y 3.11.

4.9 [ ] Implementar `calculateWAC` en `engine.ts`: extraer `wac`, `balance`, `costBasis` del `PositionState`. Si `currentPriceUsd` es `undefined` o `null`, retornar con `unrealizedPnlUsd: null`, `unrealizedPnlPct: null`. Si `currentPriceUsd` tiene valor, calcular `unrealizedUsd = (price - wac) × balance` y `unrealizedPct = (price - wac) / wac × 100` (null si `wac === 0`). **Test target:** 3.13 y 3.14.

4.10 [ ] Confirmar que los tests de source-agnosticism (3.7) y TRANSFER_IN herencia (3.5) ya pasan con la implementación actual — no requieren código nuevo (el motor es agnóstico a `source` y `costSource` por construcción). Si no pasan, identificar la causa y corregir.

4.11 [ ] Correr `npm run test:engine` y confirmar que los **15 tests** pasan (GREEN completo). Si alguno falla, corregir antes de pasar a la Fase 5.

---

## Fase 5: Refactor y quality gates

5.1 [ ] Crear `apps/backend/src/position-engine/index.ts` con re-exports named de las superficies públicas del módulo: `processTransaction`, `calculateWAC` (desde `./engine.js`), todos los tipos (`TransactionInput`, `PositionState`, `ProcessTransactionInput`, `PositionEngineResult`, `WACResult`, `DecimalString`) y los tres errores (`InsufficientBalanceError`, `InvalidTransactionError`, `InvalidPositionStateError`) desde `./types.js`. Sin default exports. Sin re-exportar `decimal-utils.ts` — es implementación interna.

5.2 [ ] Revisar `engine.ts` para extraer helpers inline repetidos (si los hay) a funciones privadas nombradas. Verificar que no hay lógica duplicada entre `openNewCycle` y `appendToOpenPosition`. No cambiar comportamiento — solo estructura. Correr `npm run test:engine` al finalizar para confirmar que sigue en GREEN.

5.3 [ ] Agregar el helper `assertNever` al final de `engine.ts` (o en `decimal-utils.ts`) para el exhaustive check del discriminated union `TransactionType`. Usarlo al final del routing en `processTransaction` para que TypeScript detecte en compile-time si se agrega un nuevo `TransactionType` sin cubrir el branch correspondiente.

5.4 [ ] Verificar que `decimal-utils.ts` NO exporta el tipo `Decimal` de `decimal.js` en su surface pública — la API del motor usa `string` en todos los boundaries. Si algún tipo `Decimal` de la lib se escapó a `types.ts` o `engine.ts`, corregirlo.

5.5 [ ] Correr `npm run typecheck` desde `apps/backend/` y confirmar cero errores de TypeScript. Resolver cualquier error antes de continuar.

5.6 [ ] Correr `npm run test:engine` final y confirmar **100% de líneas y branches** en `engine.ts`. Si la cobertura es menor al 100%, identificar el branch no cubierto y agregar el test faltante siguiendo el proceso TDD (test RED → implementación GREEN).

5.7 [ ] Verificar manualmente que el módulo cumple las convenciones del proyecto: solo named exports, sin `enum` nativo de TS (usar `as const` + `typeof`), sin `any`, strict mode activo (`strict: true`, `noUncheckedIndexedAccess: true`), errores tipados como clases (no strings).
