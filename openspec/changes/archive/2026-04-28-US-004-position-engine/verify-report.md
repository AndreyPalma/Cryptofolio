# Verify Report — US-004 PositionEngine

## Verdict: PASS WITH WARNINGS

## Summary

La implementación cubre los 11 REQs del spec y todos los acceptance criteria del PRD. Las 125 pruebas pasan, el motor es puro (sin imports de DB/red), y los invariantes WAC se respetan en el código. Existen dos desvíos menores documentados: `decimal-utils.ts` re-exporta `Decimal` (no debería ser parte de la superficie interna-exportada), y la spec normativa usa snake_case en `PositionState` mientras la implementación y el design usan camelCase.

---

## Spec Coverage

| REQ | Descripción | Cubierto | Notas |
|-----|-------------|----------|-------|
| REQ-001 | Apertura de posición nueva (BUY/SWAP_IN/TRANSFER_IN con position=null) | ✅ | `openNewCycle` en `engine.ts`. Cubre los 4 scenarios del spec. |
| REQ-002 | Recálculo WAC ponderado sobre posición OPEN | ✅ | `appendToOpenPosition` implementa `wac = (costBasis + inCost) / newBalance` con Decimal precision 40. |
| REQ-003 | SELL parcial — reducción de balance sin cambio de WAC | ✅ | `reduceOpenPosition` preserva `pos.wac` via spread (`...pos`). TRANSFER_OUT null price soportado. |
| REQ-004 | SELL total — cierre de posición (CLOSED) | ✅ | `closes = newBalance.isZero()`, sets `status:'CLOSED'`, `closedAt = tx.blockTimestamp`. |
| REQ-005 | Source-agnosticism | ✅ | El motor no ramifica por `source` en ningún path. Test 7 valida ETHERSCAN === BINANCE. |
| REQ-006 | Precisión decimal con `decimal.js` (precision=40, ROUND_HALF_EVEN) | ✅ | Configurado en `decimal-utils.ts` al cargar. `roundToStorage` usa `toFixed(18, ROUND_HALF_EVEN)`. Tests verifican exactitud DCA y TRANSFER_IN herencia. |
| REQ-007 | Balance Guard — rechazo SELL con amount > balance | ✅ | `InsufficientBalanceError` lanzado antes de mutar. Test 6 verifica shape exacto. |
| REQ-008 | Rechazo de posición con status !== 'OPEN' | ⚠️ | Implementado con `InvalidPositionStateError` en vez de `InvalidTransactionError`. Ver nota. |
| REQ-009 | SELL sobre posición inexistente (position=null) | ✅ | Guard en `processTransaction`: `isOutbound && position === null` → `InvalidTransactionError`. |
| REQ-010 | SELL con price_usd=null — rechazo explícito | ✅ | `reduceOpenPosition` lanza `InvalidTransactionError({ reason: 'OUTBOUND_REQUIRES_PRICE' })` para SELL/SWAP_OUT con priceUsd=null. TRANSFER_OUT null es permitido. |
| REQ-011 | Resultado con flags de ciclo de vida | ✅ | `PositionEngineResult` incluye `positionWasOpened` y `positionWasClosed`. Tests 12 y 15 validan. |

**Nota REQ-008**: La spec normativa dice "lanzar `InvalidTransactionError`" pero el design (§2.5, §3.1) define una clase separada `InvalidPositionStateError` para distinguir errores de estado inválido de errores de transacción inválida. La task 4.6 documenta explícitamente esta decisión: "el spec es la fuente normativa" sobre rutear CLOSED → openNewCycle, y el test 8 verifica `InvalidPositionStateError`. El error se lanza correctamente — solo el tipo difiere del nombre en el spec prose. Clasificado como WARNING, no CRITICAL, porque la separación de tipos es una mejora defensiva y está totalmente documentada en el design.

---

## Acceptance Criteria Coverage

| Criterio PRD | Test | Estado |
|---|---|---|
| DCA: 3 BUYs → WAC=$2.00 exacto | Test 1: verifica `wac === '2.000000000000000000'` | ✅ |
| SELL parcial: BUY 10@$2 → SELL 5@$3 → wac='2', balance='5' | Test 2 | ✅ |
| SELL parcial: realizedPnlDelta='5' | Test 2 | ✅ |
| Ciclo completo: BUY→SELL total→CLOSED→BUY nuevo wac='1' sin herencia | Test 3 | ✅ |
| closed_at = transaction.blockTimestamp en SELL total | Test 3 (verifica `status=CLOSED`) + engine.ts line 137 | ✅ |
| Convert Binance: SWAP_OUT cierra USDT + SWAP_IN abre ETH independientemente | Test 4 | ✅ |
| TRANSFER_IN herencia: WAC ponderado correcto (`'2047.619047619047619048'`) | Test 5 | ✅ |
| NEGATIVE: SELL 15 con balance 10 → InsufficientBalanceError shape exacto | Test 6: verifica `currentBalance`, `attempted`, `name` | ✅ |
| Source-agnosticism: ETHERSCAN === BINANCE outputs | Test 7 | ✅ |
| NEGATIVE: posición CLOSED como input → error | Test 8 | ✅ (con InvalidPositionStateError, ver nota REQ-008) |
| NEGATIVE: SELL sin posición → InvalidTransactionError | Test 9 | ✅ |
| NEGATIVE: SELL priceUsd=null → InvalidTransactionError | Test 10 | ✅ |
| TRANSFER_OUT priceUsd=null → realizedPnlDelta=0, sin error | Test 11 | ✅ |
| Flags lifecycle: BUY sobre OPEN → positionWasOpened=false, positionWasClosed=false | Test 12 | ✅ |
| calculateWAC sin precio → unrealizedPnlUsd=null, unrealizedPnlPct=null | Test 13 | ✅ |
| calculateWAC con precio → P&L no realizado correcto | Test 14: `unrealizedPnlUsd='10'`, `pct='50'` | ✅ |
| Primera apertura → positionWasOpened=true | Test 15 | ✅ |

---

## Design Decisions Verification

| Decisión | Implementado | Notas |
|---|---|---|
| D1: función pura módulo (no clase con DI) | ✅ | `processTransaction` y `calculateWAC` como named exports directos, sin clase ni constructor. |
| D2: `decimal.js` precision=40 ROUND_HALF_EVEN | ✅ | `Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN })` en `decimal-utils.ts` línea 5. |
| D3: `calculateWAC(position, currentPriceUsd?)` — no recibe positionId | ✅ | Firma exacta, motor puro sin DB access. |
| D4: Errores tipados con `override readonly name as const` | ✅ | Los tres errores tienen `override readonly name`. `instanceof` + `name` narrowing funcional. |
| D5: `roundToStorage` en cada campo string al construir PositionState | ✅ | Aplicado en `openNewCycle`, `appendToOpenPosition`, `reduceOpenPosition`. |
| D6: errores co-locados en `types.ts` | ✅ | Las tres clases están al final de `types.ts`. |
| D7: tests co-localizados en `__tests__/` | ✅ | `src/position-engine/__tests__/engine.test.ts` |
| No re-exportar `decimal-utils.ts` en `index.ts` | ✅ | `index.ts` no re-exporta nada de `decimal-utils.ts`. |
| Motor sin imports de `pg`, `fastify`, `src/db/pool` | ✅ | `engine.ts` solo importa de `./types.js` y `./decimal-utils.js`. |
| Named exports only, no default exports | ✅ | Verificado en `engine.ts`, `types.ts`, `decimal-utils.ts`, `index.ts`. |
| `isInbound`/`isOutbound` con type predicates | ✅ | `type is 'BUY' | 'SWAP_IN' | 'TRANSFER_IN'` y `type is 'SELL' | 'SWAP_OUT' | 'TRANSFER_OUT'`. |
| `assertNever` para exhaustive check | ✅ | Línea 14 de `engine.ts`, usado en el return final de `processTransaction`. |
| Tensión design §3.1 vs spec REQ-008: spec gana | ✅ | CLOSED como input siempre lanza, incluso para inbound. Documentado en task 4.6. |

---

## WAC Invariants Verification (PRD — no negociables)

| Invariante | Verificado en código | Estado |
|---|---|---|
| 1. WAC NO se modifica en `reduceOpenPosition` | `reduceOpenPosition` hace `...pos` spread y nunca sobreescribe `wac`. El campo `wac` no aparece a la izquierda de ninguna asignación en esa función. | ✅ |
| 2. `costBasis` en `reduceOpenPosition` = `wac × newBalance` | Línea 114: `const newCostBasis = wac.times(newBalance)` | ✅ |
| 3. `realizedDelta` = `(exitPrice - wac) × sellAmount` | Línea 125: `toDecimal(tx.priceUsd).minus(wac).times(sellAmount)` | ✅ |
| 4. TRANSFER_OUT con priceUsd=null → realizedDelta = 0 (no error) | Líneas 117-118: branch especial `tx.type === 'TRANSFER_OUT' && tx.priceUsd === null` → `realizedDelta` permanece `ZERO` | ✅ |
| 5. Nuevo ciclo: `cycleNumber = priorClosedCycles + 1`, WAC = precio del primer inbound | Línea 43: `cycleNumber: input.priorClosedCycles + 1`; línea 46: `wac: roundToStorage(price)` | ✅ |
| 6. `position.status === 'CLOSED'` como input → throw | Líneas 149-153: guard explícito lanza `InvalidPositionStateError` | ✅ |

---

## Issues

### CRITICAL

Ninguno.

---

### WARNING

**W-001: `decimal-utils.ts` exporta `Decimal` de `decimal.js`**

`decimal-utils.ts` línea 7: `export { Decimal }`. La spec (REQ-006) dice "El motor MUST NOT exponer el tipo `Decimal` en su API pública". La API pública es `index.ts`, y `index.ts` correctamente NO re-exporta `Decimal` — por eso el invariante del spec se cumple. Sin embargo, el hecho de que `decimal-utils.ts` exporte `Decimal` significa que cualquier código dentro de `apps/backend/src/` que importe directamente desde `position-engine/decimal-utils.ts` puede acceder a la clase `Decimal`. El design §3.6 no establece explícitamente que `decimal-utils.ts` deba ocultar `Decimal`, pero el espíritu de "implementación interna" implica que no debería. Bajo el principio de mínima exposición, `Decimal` debería eliminarse del export de `decimal-utils.ts` — los consumidores del módulo solo deben pasar strings.

**W-002: Nombre del tipo de resultado diverge entre spec y diseño**

La spec normativa llama al resultado `EngineResult` (§ "Tipos públicos") mientras la implementación lo llama `PositionEngineResult`. El design usa `PositionEngineResult`. Esta divergencia no afecta la lógica pero puede generar confusión si se cita la spec. El design toma precedencia para la implementación y la decisión está correctamente aplicada.

**W-003: `costSource` en `TransactionInput` es `required` en la implementación vs `optional` en la spec**

La spec normativa (§ "Tipos públicos") define `costSource?: CostSource` (opcional). La implementación tiene `costSource: CostSource` (requerido). El design §2.1 también lo define como requerido. Tests pasan porque `makeTx` siempre incluye `costSource`. Cuando US-006 construya `TransactionInput` desde datos reales, los callers deberán proveeer siempre `costSource` — lo que es correcto en el dominio (toda transacción tiene un cost source). Pero representa un endurecimiento del contrato respecto al spec.

**W-004: `relatedTxId` ausente en `TransactionInput`**

La spec normativa incluye `relatedTxId?: string` en `TransactionInput`. La implementación y el design no lo incluyen. El motor no usa `relatedTxId` para ningún cálculo (la spec lo marca como "para swap pairs", que es información de persistencia). Su ausencia no afecta la correctitud del motor, pero US-006/US-008 deberán tenerlo en cuenta al construir el `TransactionInput` pasado al motor.

---

### SUGGESTION

**S-001: Eliminar `export { Decimal }` de `decimal-utils.ts`**

Si se elimina esa línea, `Decimal` queda como detalle de implementación del módulo. Los consumers del módulo solo ven `ZERO`, `toDecimal`, `roundToStorage`, `isInbound`, `isOutbound` — todos operan sobre strings. Cambio de una línea, sin impacto en tests.

**S-002: Agregar `relatedTxId?: string` a `TransactionInput`**

Para alinear con la spec y facilitar la trazabilidad en US-006/US-008. El motor lo ignoraría (igual que ignora `source`), pero estaría disponible para logging/auditoría.

**S-003: Documentar en `types.ts` la decisión de naming camelCase vs snake_case del PRD**

El PRD y la spec normativa usan `cycle_number`, `cost_basis`, etc. La implementación usa camelCase (`cycleNumber`, `costBasis`). Una nota breve en el header de `types.ts` evitaría confusión cuando se lea la spec junto al código.

**S-004: Test 3 no verifica `closed_at` explícitamente**

El acceptance criteria del spec requiere `result.position.closed_at === transaction.blockTimestamp`. Test 3 verifica `status === 'CLOSED'` pero no hace `expect(sell.position.closedAt).toBe(now)`. El código es correcto (línea 137), pero la cobertura del criterio a nivel de assertion de test es incompleta.
