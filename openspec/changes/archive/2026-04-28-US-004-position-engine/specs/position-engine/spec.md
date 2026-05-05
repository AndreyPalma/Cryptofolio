# Spec: Position Engine — WAC puro y ciclos

## Capability

Habilita el núcleo contable del sistema: un motor puro, sin acceso a base de datos, capaz de procesar una transacción sobre el estado actual de una posición y devolver el nuevo estado con WAC recalculado, balance actualizado, P&L realizado y ciclo de vida correcto.

---

## Contexto y contratos de frontera

### Motor como función pura

`PositionEngine.processTransaction` MUST operar exclusivamente sobre datos recibidos en memoria. NO SHALL acceder a base de datos, red, ni efectos secundarios. Dado el mismo input, MUST retornar siempre el mismo output.

### Separación de responsabilidades

- `PositionEngine` (este spec) — lógica contable pura. Sin `pg.Pool`, sin queries.
- `PositionRepository` (US-006) — lee la posición OPEN del store, invoca el motor, persiste el resultado en una transacción SQL con `SELECT ... FOR UPDATE`.

El caller MUST pasar `position: PositionState | null` donde `PositionState` tiene `status: 'OPEN'` literal. Si la última posición conocida es `CLOSED`, el caller MUST pasar `null` y el `priorClosedCycles` correcto. El motor MUST rechazar cualquier `position` con `status !== 'OPEN'`.

### Invariantes WAC — copiados literalmente del PRD (no negociables)

> **WAC PURO:** El WAC se recalcula ÚNICAMENTE en BUY, SWAP_IN, TRANSFER_IN.
> SELL/SWAP_OUT/TRANSFER_OUT nunca modifican el WAC.
> Fórmula: `wac = SUM(amount_i × price_i) / SUM(amount_i)` para todos los eventos de entrada activos.

> **POSITION LIFECYCLE:**
> - BUY/SWAP_IN/TRANSFER_IN con balance=0 → crear position (cycle_number=max+1, status=OPEN)
> - Con posición OPEN → asociar y recalcular WAC
> - SELL/SWAP_OUT parcial → reducir balance, WAC sin cambio, acumular realized_pnl_partial=(price-wac)×amount
> - SELL/SWAP_OUT total (balance=0) → CLOSED, realized_pnl_usd=acumulado+P&L final
> - Nuevo ciclo empieza con WAC limpio (sin herencia del ciclo anterior)

> **BALANCE GUARD:** SELL con amount > balance_activo → Error { currentBalance, attempted }

---

## Requirements

### REQ-001: Apertura de posición nueva

**Descripción**: Cuando el motor recibe una transacción de entrada (`BUY`, `SWAP_IN`, o `TRANSFER_IN`) y no hay posición OPEN (`position === null`), MUST crear una nueva posición con `status='OPEN'`, `cycle_number = priorClosedCycles + 1`, `wac = priceUsd`, `balance = amount`, `cost_basis = amount × priceUsd`, `realized_pnl_usd = 0`.

**Escenarios**:

#### Scenario 1: BUY abre posición desde cero (sin ciclos previos)

**Given** que `position = null` y `priorClosedCycles = 0`
**When** se llama `processTransaction({ position: null, priorClosedCycles: 0, transaction: { type: 'BUY', amount: '10', priceUsd: '2', ... } })`
**Then** el resultado MUST contener `positionWasOpened = true`, `positionWasClosed = false`
**And** `result.position.status = 'OPEN'`
**And** `result.position.cycle_number = 1`
**And** `result.position.wac = '2'`
**And** `result.position.balance = '10'`
**And** `result.position.cost_basis = '20'`
**And** `result.position.realized_pnl_usd = '0'`
**And** `result.realizedPnlDelta = '0'`

#### Scenario 2: SWAP_IN abre posición desde cero

**Given** que `position = null` y `priorClosedCycles = 0`
**When** se llama con `transaction: { type: 'SWAP_IN', amount: '0.033', priceUsd: '3030', ... }`
**Then** `result.position.status = 'OPEN'`
**And** `result.position.wac = '3030'`
**And** `result.position.balance = '0.033'`

#### Scenario 3: TRANSFER_IN con cost_source='INHERITED' abre posición

**Given** que `position = null` y `priorClosedCycles = 0`
**When** se llama con `transaction: { type: 'TRANSFER_IN', amount: '0.5', priceUsd: '3000', costSource: 'INHERITED', ... }`
**Then** `result.position.status = 'OPEN'`
**And** `result.position.wac = '3000'`
**And** `result.position.balance = '0.5'`

#### Scenario 4: Apertura después de un ciclo cerrado previo

**Given** que `position = null` y `priorClosedCycles = 1`
**When** se llama con `transaction: { type: 'BUY', amount: '5', priceUsd: '1', ... }`
**Then** `result.position.cycle_number = 2`
**And** `result.position.wac = '1'` (sin herencia del ciclo anterior)

---

### REQ-002: Recálculo de WAC sobre posición OPEN existente

**Descripción**: Cuando el motor recibe una transacción de entrada y ya existe una posición OPEN, MUST recalcular el WAC ponderado según `wac = (cost_basis_actual + amount × priceUsd) / (balance_actual + amount)`, sumar `amount` al `balance` y actualizar `cost_basis = wac_nuevo × balance_nuevo`.

**Escenarios**:

#### Scenario 1: DCA — tres BUYs a precios distintos

**Given** una posición `OPEN` tras procesar `BUY 10@$1` y luego `BUY 10@$2`
**When** se procesa `BUY 10@$3`
**Then** `result.position.wac = '2'` (exacto: `(10+20+30)/30 = 2.000...`)
**And** `result.position.balance = '30'`
**And** `result.position.cost_basis = '60'`
**And** ningún `realizedPnlDelta` acumula en los tres BUYs

#### Scenario 2: TRANSFER_IN herencia sobre posición con BUYs previos

**Given** una posición `OPEN` con `balance = 10`, `wac = 2000`, `cost_basis = 20000`
**When** se procesa `TRANSFER_IN 0.5 ETH @ $3000, cost_source='INHERITED'`
**Then** `result.position.wac = '2047.619047619047619047...'` (= `(10×2000 + 0.5×3000) / 10.5`)
**And** `result.position.balance = '10.5'`
**And** el motor NO discrimina por `costSource` — lo trata como cualquier transacción de entrada con `priceUsd` ya resuelto

---

### REQ-003: SELL parcial — reducción de balance sin cambio de WAC

**Descripción**: Cuando el motor recibe `SELL`, `SWAP_OUT` o `TRANSFER_OUT` y `amount < balance`, MUST reducir el balance, mantener el WAC intacto, recalcular `cost_basis = wac × balance_nuevo`, y acumular `realized_pnl_usd += (priceUsd - wac) × amount`.

**Escenarios**:

#### Scenario 1: SELL parcial con ganancia

**Given** una posición `OPEN` con `balance = 10`, `wac = 2`, `cost_basis = 20`
**When** se procesa `SELL 5 @ $3`
**Then** `result.position.status = 'OPEN'`
**And** `result.position.wac = '2'` (sin cambio)
**And** `result.position.balance = '5'`
**And** `result.position.cost_basis = '10'` (= wac × balance_nuevo)
**And** `result.realizedPnlDelta = '5'` (= (3-2) × 5)
**And** `result.positionWasClosed = false`

#### Scenario 2: SWAP_OUT parcial — mismas reglas que SELL

**Given** una posición `OPEN` con `balance = 100`, `wac = 1`
**When** se procesa `SWAP_OUT 100 USDT @ $1`
**Then** `result.position.balance = '0'` (este caso es SELL total — ver REQ-004)

#### Scenario 3: TRANSFER_OUT con price_usd = null — no genera P&L

**Given** una posición `OPEN` con `balance = 10`, `wac = 2`
**When** se procesa `TRANSFER_OUT 2 @ priceUsd=null`
**Then** `result.position.balance = '8'`
**And** `result.position.wac = '2'` (sin cambio)
**And** `result.realizedPnlDelta = '0'` (no hay precio de realización)
**And** `result.position.status = 'OPEN'`

---

### REQ-004: SELL total — cierre de posición (CLOSED)

**Descripción**: Cuando `amount` de la transacción de salida iguala exactamente el `balance` activo, MUST cerrar la posición: `status = 'CLOSED'`, `realized_pnl_usd` final acumulado, `closed_at = transaction.blockTimestamp`.

**Escenarios**:

#### Scenario 1: SELL total cierra posición

**Given** una posición `OPEN` con `balance = 10`, `wac = 2`, `realized_pnl_usd = 5` (de SELLs previos)
**When** se procesa `SELL 10 @ $3`
**Then** `result.position.status = 'CLOSED'`
**And** `result.position.balance = '0'`
**And** `result.realizedPnlDelta = '10'` (= (3-2) × 10)
**And** `result.position.realized_pnl_usd = '15'` (= 5 + 10, acumulado total)
**And** `result.position.closed_at` MUST ser igual a `transaction.blockTimestamp`
**And** `result.positionWasClosed = true`

#### Scenario 2: Ciclo completo BUY → SELL total → BUY nuevo sin herencia

**Given** que se procesaron `BUY 10@$2` y luego `SELL 10@$3` (posición CLOSED)
**When** el caller llama nuevamente con `position = null`, `priorClosedCycles = 1`, y `BUY 5@$1`
**Then** `result.position.cycle_number = 2`
**And** `result.position.wac = '1'` (sin herencia del ciclo anterior)
**And** `result.position.realized_pnl_usd = '0'` (nuevo ciclo empieza limpio)
**And** `result.position.status = 'OPEN'`

---

### REQ-005: Source-agnosticism

**Descripción**: El motor MUST producir resultados idénticos independientemente del valor de `transaction.source`. Las reglas WAC y de ciclos son uniformes para `ETHERSCAN`, `BSCTRACE`, `BINANCE`, y `MANUAL`.

**Escenarios**:

#### Scenario 1: DCA con source=ETHERSCAN vs source=BINANCE produce resultados idénticos

**Given** la misma secuencia de tres BUYs a `$1`, `$2`, `$3` con `amount=10` cada uno
**When** se ejecuta la secuencia con `source='ETHERSCAN'`
**And** se ejecuta la misma secuencia con `source='BINANCE'`
**Then** ambos resultados finales MUST tener `wac`, `balance`, `cost_basis`, y `realized_pnl_usd` estructuralmente idénticos

#### Scenario 2: Convert Binance — SWAP_OUT + SWAP_IN procesados secuencialmente

**Given** una posición OPEN de USDT con `balance=100`, `wac=1`
**When** se procesa `SWAP_OUT 100 USDT @ $1, source='BINANCE'` (cierra posición USDT)
**And** se procesa `SWAP_IN 0.033 ETH @ $3030, source='BINANCE', position=null, priorClosedCycles=0` para la posición ETH
**Then** la posición ETH resultante tiene `wac = '3030'`, `balance = '0.033'`, `status = 'OPEN'`
**And** el motor procesó cada transacción de forma independiente — una a la vez

---

### REQ-006: Precisión decimal con decimal.js

**Descripción**: Toda aritmética interna MUST realizarse con `decimal.js` configurado con `precision=40, rounding=ROUND_HALF_EVEN`. Los campos numéricos del resultado (`wac`, `balance`, `cost_basis`, `realized_pnl_usd`, `realizedPnlDelta`) MUST retornarse como `string` en formato decimal exacto, truncados a 18 posiciones decimales al salir del motor (compatible con `NUMERIC(38,18)` de Postgres). El motor MUST NOT exponer el tipo `Decimal` en su API pública.

**Escenarios**:

#### Scenario 1: WAC exacto en DCA sin error floating point

**Given** tres BUYs de `10 tokens @ $1`, `10 tokens @ $2`, `10 tokens @ $3`
**When** se compara `result.position.wac` contra `'2'`
**Then** la comparación MUST ser exacta (sin residuos de punto flotante IEEE-754)

#### Scenario 2: Round-trip string → Decimal → string

**Given** un valor de WAC recibido como `string` desde la DB (`'2047.619047619047619'`, 18 decimales)
**When** ese string se usa como input de `priceUsd` o `wac` en el motor
**Then** el output retornado como `string` MUST tener a lo sumo 18 posiciones decimales
**And** el valor MUST coincidir con el resultado matemáticamente correcto redondeado con banker's rounding

---

### REQ-007: Balance Guard — rechazo de SELL con amount > balance

**Descripción**: Si `transaction.amount > position.balance`, el motor MUST lanzar un error tipado `InsufficientBalanceError` con el shape `{ currentBalance: string, attempted: string }`. NEVER SHALL reducir el balance a negativo ni continuar el cálculo.

**Escenarios**:

#### NEGATIVE Scenario 1: SELL amount supera balance disponible

**Given** una posición `OPEN` con `balance = '10'`
**When** se procesa `SELL 15 @ $3`
**Then** el motor MUST lanzar `InsufficientBalanceError`
**And** el error MUST tener shape `{ currentBalance: '10', attempted: '15' }`
**And** el estado de la posición MUST permanecer sin cambios (el error se lanza antes de mutar)

#### NEGATIVE Scenario 2: SELL exactamente igual al balance — es SELL total, no error

**Given** una posición `OPEN` con `balance = '10'`
**When** se procesa `SELL 10 @ $3`
**Then** NO MUST lanzar error
**And** `result.position.status = 'CLOSED'` (ver REQ-004 Scenario 1)

---

### REQ-008: Rechazo de posición con status !== 'OPEN'

**Descripción**: Si el caller pasa un objeto `position` con `status !== 'OPEN'` (e.g. una posición CLOSED), el motor MUST lanzar `InvalidTransactionError` inmediatamente, sin procesar la transacción.

**Escenarios**:

#### NEGATIVE Scenario 1: Caller pasa posición CLOSED en lugar de null

**Given** un objeto `position` con `status = 'CLOSED'`
**When** se llama `processTransaction({ position, priorClosedCycles: 1, transaction: anyBuyTx })`
**Then** el motor MUST lanzar `InvalidTransactionError`
**And** el mensaje MUST indicar que el caller debe pasar `null` cuando no hay posición OPEN

---

### REQ-009: SELL sobre posición inexistente

**Descripción**: Si el caller pasa `position = null` y la transacción es de tipo `SELL`, `SWAP_OUT` o `TRANSFER_OUT`, el motor MUST lanzar `InvalidTransactionError` ya que no hay balance sobre el cual operar.

**Escenarios**:

#### NEGATIVE Scenario 1: SELL sin posición OPEN activa

**Given** que `position = null`
**When** se procesa `SELL 5 @ $3`
**Then** el motor MUST lanzar `InvalidTransactionError`
**And** el error MUST indicar que no existe posición OPEN para procesar la salida

---

### REQ-010: SELL con price_usd = null — rechazo explícito

**Descripción**: `SELL` y `SWAP_OUT` requieren `priceUsd` para calcular P&L realizado. Si `priceUsd = null` en una transacción de salida (excepto `TRANSFER_OUT`, que es permitido — ver REQ-003 Scenario 3), el motor MUST lanzar `InvalidTransactionError`.

**Escenarios**:

#### NEGATIVE Scenario 1: SELL sin precio

**Given** una posición `OPEN` con `balance = 10`
**When** se procesa `SELL 5 @ priceUsd=null`
**Then** el motor MUST lanzar `InvalidTransactionError`
**And** el mensaje MUST indicar que SELL/SWAP_OUT requieren priceUsd

---

### REQ-011: Resultado con flags de ciclo de vida

**Descripción**: `processTransaction` MUST retornar el tipo `EngineResult` completo, incluyendo los flags `positionWasOpened` y `positionWasClosed` para que el caller (e.g. `PositionRepository`) pueda determinar qué queries ejecutar en la DB sin inspeccionar el estado interno de la posición.

**Escenarios**:

#### Scenario 1: Transacción que no abre ni cierra devuelve ambos flags en false

**Given** una posición `OPEN` con `balance = 10`
**When** se procesa `BUY 5 @ $2` (suma a posición existente)
**Then** `result.positionWasOpened = false`
**And** `result.positionWasClosed = false`

#### Scenario 2: Transacción de apertura devuelve positionWasOpened=true

**Given** `position = null`
**When** se procesa cualquier transacción de entrada
**Then** `result.positionWasOpened = true`
**And** `result.positionWasClosed = false`

#### Scenario 3: SELL total devuelve positionWasClosed=true

**Given** una posición `OPEN` con `balance = 5`
**When** se procesa `SELL 5 @ $3`
**Then** `result.positionWasOpened = false`
**And** `result.positionWasClosed = true`

---

## Tipos públicos (referencia normativa)

Los tipos exportados desde `position-engine/types.ts` MUST seguir estas firmas. Los campos numéricos MUST ser `string` (formato decimal exacto). NO MUST exponerse el tipo `Decimal` de `decimal.js`.

```ts
// Tipos de transacción — derivados de db/enums.ts
type TransactionType =
  | 'BUY' | 'SELL'
  | 'SWAP_IN' | 'SWAP_OUT'
  | 'TRANSFER_IN' | 'TRANSFER_OUT';

type TransactionSource = 'ETHERSCAN' | 'BSCTRACE' | 'BINANCE' | 'MANUAL';

type CostSource = 'INHERITED' | 'MANUAL' | 'MARKET';

interface TransactionInput {
  type: TransactionType;
  amount: string;           // decimal string, > 0
  priceUsd: string | null;  // null solo permitido en TRANSFER_OUT
  costSource?: CostSource;
  blockTimestamp: Date;
  source: TransactionSource;
  relatedTxId?: string;     // para swap pairs
}

interface PositionState {
  id?: string;
  status: 'OPEN';           // literal — el motor solo acepta OPEN
  cycle_number: number;
  balance: string;
  wac: string;
  cost_basis: string;
  realized_pnl_usd: string;
  opened_at: Date;
  closed_at?: Date;
}

interface ProcessTransactionInput {
  position: PositionState | null;
  priorClosedCycles: number;
  transaction: TransactionInput;
}

interface EngineResult {
  position: PositionState | ClosedPositionState;
  realizedPnlDelta: string;
  positionWasOpened: boolean;
  positionWasClosed: boolean;
}
```

---

## Errores tipados (referencia normativa)

Los errores MUST ser clases tipadas exportadas desde `position-engine/errors.ts`. MUST NOT lanzarse strings ni errores genéricos `Error`.

```ts
class InsufficientBalanceError extends Error {
  readonly currentBalance: string;
  readonly attempted: string;
}

class InvalidTransactionError extends Error {
  readonly reason: string;
}
```

---

## Contrato de concurrencia (para US-006)

El motor es stateless y puro. La protección contra concurrencia NO es responsabilidad del motor. El `PositionRepository` (US-006) MUST envolver el ciclo `read → processTransaction → write` en una transacción Postgres con `SELECT ... FOR UPDATE` sobre la fila de posición, garantizando que dos requests simultáneos sobre el mismo `(wallet_id, token_id)` no se pisen.

---

## Cobertura de tests requerida

El vitest project `engine` (`npm run test:engine`) MUST alcanzar **100% de líneas y branches** en `position-engine.ts`. Los siguientes casos MUST existir como tests independientes:

| Test | REQ cubierto |
|------|-------------|
| DCA: 3 BUYs $1/$2/$3 × 10 tokens → wac='2' exacto | REQ-002 Sc.1, REQ-006 Sc.1 |
| SELL parcial: BUY 10@$2 → SELL 5@$3 → wac='2', balance='5' | REQ-003 Sc.1 |
| Ciclo completo: BUY→SELL total→CLOSED→BUY nuevo wac='1' | REQ-004 Sc.2 |
| Convert: SWAP_OUT 100 USDT + SWAP_IN 0.033 ETH@$3030 | REQ-005 Sc.2 |
| TRANSFER_IN herencia: BUY 10@$2000 + TRANSFER_IN 0.5@$3000 → wac correcto | REQ-002 Sc.2 |
| NEGATIVE: SELL 15 con balance 10 → InsufficientBalanceError shape | REQ-007 Sc.1 |
| Source-agnosticism: ETHERSCAN vs BINANCE → outputs idénticos | REQ-005 Sc.1 |
