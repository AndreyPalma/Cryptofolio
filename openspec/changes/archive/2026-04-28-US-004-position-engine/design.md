# Design — US-004: PositionEngine

> **Change:** `US-004-position-engine`
> **Estado:** design (post-proposal)
> **Stack:** TypeScript strict (Node 22), `decimal.js`, vitest 2 (project `engine`)
> **Modo:** **Strict TDD** — cada caso del acceptance criteria nace como test rojo.

Este documento traduce la `proposal.md` y el acceptance criteria de US-004 a una arquitectura concreta de módulos, tipos, y algoritmos. **No re-discute** decisiones ya tomadas en la proposal (función pura, `decimal.js`, separación engine/repository, `calculateWAC` derivado del estado). Las consolida y baja a nivel de implementación.

---

## 1. Estructura de módulos

```
apps/backend/src/position-engine/
├── engine.ts           # API pública: processTransaction + calculateWAC
├── types.ts            # Tipos del dominio: TransactionInput, PositionState, results, errors
├── decimal-utils.ts    # Wrapper decimal.js: toDecimal, roundToStorage, ZERO, config global
├── index.ts            # Re-exports named (única superficie pública del módulo)
└── __tests__/
    └── engine.test.ts  # 7 tests del acceptance (DCA, sell parcial, ciclo, Convert, herencia, NEGATIVE, source-agnostic)
```

### Convenciones del módulo

- **Named exports only.** `index.ts` re-exporta las superficies públicas (`processTransaction`, `calculateWAC`, tipos, errores). No hay `default export`.
- **Sin side effects en import.** `decimal-utils.ts` configura `Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN })` al cargarse, pero el resto de archivos NO ejecuta lógica al importarse.
- **Cero dependencias de runtime backend.** El módulo no importa `pg`, `fastify`, ni nada de `src/db/`. Solo `decimal.js` + tipos enum (`src/db/types.ts`). Esto garantiza que `npm run test:engine` (vitest project `engine`) pueda correr en ms sin DB ni mocks.
- **Testing co-localizado.** Tests viven en `__tests__/` adyacente a la fuente. El `vitest.config.ts` declarará el project `engine` con `include: ['src/position-engine/__tests__/**/*.test.ts']`.

### Por qué `__tests__/` y no `tests/` al nivel de `apps/backend/`

Co-locación reduce fricción: el test de un módulo vive al lado del módulo. La proposal mencionaba `apps/backend/tests/position-engine/...`; lo movemos a `src/position-engine/__tests__/` por consistencia con la convención más extendida de Vitest/Jest y porque mantiene el motor como una unidad cerrada (un solo directorio para mover, archivar o citar). El `tsconfig.build.json` ya excluye `**/__tests__/**` y `**/*.test.ts` del build de producción.

---

## 2. Interfaces TypeScript clave

> Identificadores en inglés. Strict mode (`noUncheckedIndexedAccess: true`). Sin `enum` nativo de TS — usamos `as const` + `typeof` extraction (estándar del repo).

### 2.1. `TransactionInput` — entrada al motor

Lo que el motor necesita de una transacción para aplicarla. **Subset** del row real de `transactions` en DB (el motor no necesita `tx_hash`, `block_number`, `cex_trade_id`, etc.; el caller los persiste pero el motor los ignora).

```ts
// types.ts
import type { TransactionType, TransactionSource, CostSource } from "../db/types.js";

export type DecimalString = string; // formato decimal exacto, p.ej. "0.0000033", "3030.42"

export type TransactionInput = {
  /** Identificador externo opcional — el motor no lo usa, pero permite trazabilidad en logs/errors. */
  readonly externalRef?: string;
  readonly type: TransactionType;
  /** Cantidad de tokens, siempre positiva (>0). El motor rechaza 0 o negativo. */
  readonly amount: DecimalString;
  /**
   * Precio unitario en USD al momento de la transacción.
   * - Requerido para BUY, SELL, SWAP_IN, SWAP_OUT.
   * - Requerido para TRANSFER_IN cuando costSource ∈ {INHERITED, MARKET, MANUAL} con valor.
   * - Opcional (null) para TRANSFER_OUT sin valuación (ver §3, regla T_OUT_NULL).
   */
  readonly priceUsd: DecimalString | null;
  /** Origen del precio. El motor NO ejecuta resolución; el caller ya la resolvió (ver proposal §2 fuera de scope). */
  readonly costSource: CostSource;
  /** Source de la transacción (para trazabilidad). El motor es agnóstico — misma lógica para todos. */
  readonly source: TransactionSource;
  /** Timestamp de la transacción on-chain o CEX. Se usa para `closed_at` cuando la posición cierra. */
  readonly blockTimestamp: Date;
};
```

**Por qué `DecimalString` y no `Decimal`:**
- La frontera input/output del motor usa `string` para no acoplar al consumidor a `decimal.js` (decisión Q4 de la proposal).
- `pg` deserializa `NUMERIC(38,18)` como `string` por default — el contrato encaja directo.
- Los tests pueden comparar con `toEqual("2")` o `toMatch(/^2(\.0+)?$/)` sin instanciar `Decimal`.

### 2.2. `PositionState` — estado de una posición OPEN

```ts
// types.ts
export type PositionState = {
  /** ID lógico de la posición. El motor no lo genera ni lo lee — lo pasa el caller (DB autoincrement o UUID). */
  readonly id: string;
  readonly walletId: string;
  readonly tokenId: string;
  /** Cycle number ≥ 1. Inmutable durante la vida del cycle. */
  readonly cycleNumber: number;
  /** Status del cycle. El motor SOLO acepta 'OPEN' como input; 'CLOSED' aparece en el output cuando cierra. */
  readonly status: PositionStatus;
  /** Balance actual de tokens. Siempre ≥ 0. */
  readonly balance: DecimalString;
  /** Weighted Average Cost — costo unitario ponderado de los tokens en balance. */
  readonly wac: DecimalString;
  /** Cost basis = balance × wac. Mantenido por el motor para evitar recomputación. */
  readonly costBasis: DecimalString;
  /** P&L realizado acumulado a lo largo del cycle. Frozen al pasar a CLOSED. */
  readonly realizedPnlUsd: DecimalString;
  /** Timestamp de apertura del cycle. */
  readonly openedAt: Date;
  /** Timestamp de cierre del cycle. null mientras OPEN; se setea cuando balance llega a 0. */
  readonly closedAt: Date | null;
};

import type { PositionStatus } from "../db/types.js";
```

**Invariantes del tipo:**
- `status === 'OPEN'` ⇒ `closedAt === null` y `balance > 0` (excepto el instante mismo del cierre, manejado dentro del motor).
- `status === 'CLOSED'` ⇒ `closedAt !== null` y `balance === "0"`.
- `costBasis === wac × balance` (siempre, modulo redondeo a 18 decimales).

El motor garantiza estas invariantes en cada output. Si el caller las viola en el input, el motor lanza `InvalidPositionStateError` (ver §2.5).

### 2.3. `PositionEngineResult` — salida de `processTransaction`

```ts
// types.ts
export type PositionEngineResult = {
  /** Estado nuevo de la posición. Si la tx la cerró, status='CLOSED'. Si abrió un cycle nuevo, contiene cycleNumber recién creado. */
  readonly position: PositionState;
  /** P&L realizado generado por ESTA transacción (delta, no acumulado). 0 para inbound. */
  readonly realizedPnlDelta: DecimalString;
  /** true si esta tx abrió un cycle (position era null o estaba CLOSED). */
  readonly positionWasOpened: boolean;
  /** true si esta tx llevó balance a 0 (status pasó OPEN → CLOSED). */
  readonly positionWasClosed: boolean;
};
```

`realizedPnlDelta` se devuelve **además** del `realizedPnlUsd` acumulado dentro de `position`, para que el caller pueda persistirlo de forma incremental (algunos esquemas de auditoría guardan el delta por transacción además del acumulado). Es derivado, no estado nuevo: `position.realizedPnlUsd_post - position.realizedPnlUsd_pre`. Lo exponemos para conveniencia y testing — los tests del acceptance lo usan directo.

### 2.4. `WACResult` — salida de `calculateWAC`

```ts
// types.ts
export type WACResult = {
  readonly wac: DecimalString;
  readonly costBasis: DecimalString;
  readonly balance: DecimalString;
  /** (currentPriceUsd - wac) × balance. null si currentPriceUsd no se proveyó. */
  readonly unrealizedPnlUsd: DecimalString | null;
  /** ((currentPriceUsd - wac) / wac) × 100. null si currentPriceUsd no se proveyó o wac es 0. */
  readonly unrealizedPnlPct: DecimalString | null;
};
```

### 2.5. Errores de dominio

```ts
// types.ts (mismo archivo — los errores son parte del contrato del motor)

export class InsufficientBalanceError extends Error {
  readonly name = "InsufficientBalanceError" as const;
  readonly currentBalance: DecimalString;
  readonly attempted: DecimalString;
  constructor(params: { currentBalance: DecimalString; attempted: DecimalString }) {
    super(
      `Insufficient balance: attempted ${params.attempted}, current ${params.currentBalance}`,
    );
    this.currentBalance = params.currentBalance;
    this.attempted = params.attempted;
  }
}

export class InvalidTransactionError extends Error {
  readonly name = "InvalidTransactionError" as const;
  readonly reason: string;
  readonly context: Readonly<Record<string, unknown>>;
  constructor(params: { reason: string; context?: Readonly<Record<string, unknown>> }) {
    super(`Invalid transaction: ${params.reason}`);
    this.reason = params.reason;
    this.context = params.context ?? {};
  }
}

export class InvalidPositionStateError extends Error {
  readonly name = "InvalidPositionStateError" as const;
  readonly reason: string;
  constructor(reason: string) {
    super(`Invalid position state: ${reason}`);
    this.reason = reason;
  }
}
```

**Decisión de error handling** (typed classes, NO retorno `Result<T, E>`): seguimos la convención del repo (`nodejs-backend-patterns`) de errores tipados como clases. Las clases tienen `name` literal-typed (`as const`) para que el caller pueda hacer `if (err instanceof InsufficientBalanceError)` o `if (err.name === "InsufficientBalanceError")` con narrowing exacto. Sin `any`, sin strings.

### 2.6. `ProcessTransactionInput` — input completo

```ts
// engine.ts (importa de types.ts)
export type ProcessTransactionInput = {
  /** Posición OPEN actual para (walletId, tokenId), o null si no hay ninguna OPEN. */
  readonly position: PositionState | null;
  /** max(cycleNumber) de posiciones CLOSED previas para (walletId, tokenId). 0 si no hay ninguna. */
  readonly priorClosedCycles: number;
  /** La transacción a aplicar. */
  readonly transaction: TransactionInput;
  /**
   * Identidad de la posición para casos donde el motor abre un cycle nuevo.
   * Si position !== null, el motor reusa position.{id, walletId, tokenId} y este campo se ignora.
   * Si position === null, este campo es REQUERIDO — el motor lo usa para construir el PositionState nuevo.
   */
  readonly positionIdentity?: {
    readonly id: string;
    readonly walletId: string;
    readonly tokenId: string;
  };
};
```

**Por qué `positionIdentity` opcional condicional:** cuando la tx abre un cycle nuevo, el motor necesita `walletId`, `tokenId` y un `id` para construir el `PositionState` retornado. El caller los conoce (los tiene en el contexto del request o sync). El motor NO los puede inventar. Marcamos opcional + validamos en runtime: si `position === null` y no viene `positionIdentity`, `InvalidTransactionError`. Test cubre el caso.

---

## 3. Lógica del motor — pseudocódigo detallado

### 3.1. Entry point: `processTransaction`

```text
function processTransaction(input: ProcessTransactionInput): PositionEngineResult {
  // 1. Validaciones de entrada (fail fast)
  validatePositionStateInvariants(input.position)         // si está OPEN, balance > 0; si no, error
  validateTransactionInput(input.transaction)             // amount > 0, priceUsd según type, etc.

  // 2. Routing por type
  if (isInbound(transaction.type)) {  // BUY | SWAP_IN | TRANSFER_IN
    if (input.position === null || input.position.status === 'CLOSED') {
      return openNewCycle(input)
    }
    return appendToOpenPosition(input)
  }

  if (isOutbound(transaction.type)) { // SELL | SWAP_OUT | TRANSFER_OUT
    if (input.position === null) {
      throw InvalidTransactionError({ reason: 'OUTBOUND_WITHOUT_POSITION', context: { type, walletId, tokenId } })
    }
    return reduceOpenPosition(input)
  }

  // unreachable bajo el discriminated union completo, pero el compilador exige exhaustive check
  assertNever(transaction.type)
}
```

`isInbound`/`isOutbound` son helpers triviales sobre el discriminated `TransactionType`.

### 3.2. `openNewCycle` — abrir posición nueva

```text
function openNewCycle(input): PositionEngineResult {
  const tx = input.transaction

  // Validar identidad
  const identity = input.position?.status === 'CLOSED'
    ? { id: <nuevo>, walletId: input.position.walletId, tokenId: input.position.tokenId }
    : input.positionIdentity ?? throw InvalidTransactionError({ reason: 'MISSING_POSITION_IDENTITY' })

  // Validar precio: inbound siempre requiere priceUsd para inicializar WAC
  if (tx.priceUsd === null) {
    throw InvalidTransactionError({ reason: 'INBOUND_REQUIRES_PRICE', context: { type: tx.type } })
  }

  const amount = toDecimal(tx.amount)
  const price = toDecimal(tx.priceUsd)

  const newPosition: PositionState = {
    id: identity.id,
    walletId: identity.walletId,
    tokenId: identity.tokenId,
    cycleNumber: input.priorClosedCycles + 1,    // ← nuevo cycle
    status: 'OPEN',
    balance: roundToStorage(amount),
    wac: roundToStorage(price),                  // WAC inicial = precio del primer inbound
    costBasis: roundToStorage(amount.times(price)),
    realizedPnlUsd: '0',
    openedAt: tx.blockTimestamp,
    closedAt: null,
  }

  return {
    position: newPosition,
    realizedPnlDelta: '0',
    positionWasOpened: true,
    positionWasClosed: false,
  }
}
```

**Sin herencia entre cycles:** el WAC del nuevo cycle se inicializa con el precio del primer inbound, ignorando completamente el WAC del cycle anterior. Esto cumple la regla del PRD ("Nuevo BUY post-CLOSED: WAC = precio del BUY"). Test 3 del acceptance lo cubre.

### 3.3. `appendToOpenPosition` — recalcular WAC ponderado

```text
function appendToOpenPosition(input): PositionEngineResult {
  const pos = input.position!  // garantizado OPEN por el caller
  const tx = input.transaction

  if (tx.priceUsd === null) {
    throw InvalidTransactionError({ reason: 'INBOUND_REQUIRES_PRICE', context: { type: tx.type } })
  }

  const oldBalance = toDecimal(pos.balance)
  const oldCostBasis = toDecimal(pos.costBasis)
  const inAmount = toDecimal(tx.amount)
  const inPrice = toDecimal(tx.priceUsd)

  const inCost = inAmount.times(inPrice)             // costo de la nueva entrada
  const newBalance = oldBalance.plus(inAmount)
  const newCostBasis = oldCostBasis.plus(inCost)

  // FÓRMULA WAC PONDERADO:
  // wac = (oldBalance × oldWac + inAmount × inPrice) / (oldBalance + inAmount)
  //     = (oldCostBasis + inCost) / newBalance
  const newWac = newCostBasis.div(newBalance)

  const updated: PositionState = {
    ...pos,
    balance: roundToStorage(newBalance),
    wac: roundToStorage(newWac),
    costBasis: roundToStorage(newCostBasis),
  }

  return {
    position: updated,
    realizedPnlDelta: '0',                          // inbound no genera realized P&L
    positionWasOpened: false,
    positionWasClosed: false,
  }
}
```

**WAC formula explícita** (la del PRD, escrita una vez para que no haya duda):

```
wac_new = (balance_old × wac_old + amount_in × price_in) / (balance_old + amount_in)
```

Equivalente y preferido en código (porque mantenemos `costBasis` como estado):

```
wac_new = (costBasis_old + amount_in × price_in) / balance_new
```

Las dos son idénticas matemáticamente; la segunda evita una multiplicación. Test DCA del acceptance valida que `1@$1 + 1@$2 + 1@$3 (× 10 c/u) = WAC $2.00 exacto`.

### 3.4. `reduceOpenPosition` — SELL / SWAP_OUT / TRANSFER_OUT

```text
function reduceOpenPosition(input): PositionEngineResult {
  const pos = input.position!
  const tx = input.transaction

  const oldBalance = toDecimal(pos.balance)
  const sellAmount = toDecimal(tx.amount)

  // BALANCE GUARD
  if (sellAmount.gt(oldBalance)) {
    throw new InsufficientBalanceError({
      currentBalance: pos.balance,
      attempted: tx.amount,
    })
  }

  const wac = toDecimal(pos.wac)
  const newBalance = oldBalance.minus(sellAmount)

  // Cost basis se reduce proporcionalmente — WAC NO cambia.
  // costBasis_new = wac × balance_new (equivalente a cost_basis_old - sellAmount × wac)
  const newCostBasis = wac.times(newBalance)

  // Realized P&L delta: solo si la tx tiene precio y el type lo amerita.
  let realizedDelta: Decimal
  if (tx.type === 'TRANSFER_OUT' && tx.priceUsd === null) {
    // Regla T_OUT_NULL: TRANSFER_OUT sin precio → no realiza P&L (transferencia entre wallets propias).
    realizedDelta = ZERO
  } else {
    if (tx.priceUsd === null) {
      throw InvalidTransactionError({
        reason: 'OUTBOUND_REQUIRES_PRICE',
        context: { type: tx.type },
      })
    }
    const exitPrice = toDecimal(tx.priceUsd)
    // delta = (exitPrice - wac) × sellAmount
    realizedDelta = exitPrice.minus(wac).times(sellAmount)
  }

  const newRealizedPnl = toDecimal(pos.realizedPnlUsd).plus(realizedDelta)

  // ¿Cierra el cycle?
  const closes = newBalance.isZero()

  const updated: PositionState = {
    ...pos,
    balance: roundToStorage(newBalance),
    // wac NO cambia (regla WAC PURO)
    costBasis: roundToStorage(newCostBasis),
    realizedPnlUsd: roundToStorage(newRealizedPnl),
    status: closes ? 'CLOSED' : 'OPEN',
    closedAt: closes ? tx.blockTimestamp : null,
  }

  return {
    position: updated,
    realizedPnlDelta: roundToStorage(realizedDelta),
    positionWasOpened: false,
    positionWasClosed: closes,
  }
}
```

**Reglas críticas validadas en tests:**

- **WAC PURO:** `pos.wac` nunca aparece a la izquierda de un asignamiento dentro de `reduceOpenPosition`. El campo `wac` en el `updated` es literalmente `...pos` y no se sobreescribe. Test "SELL parcial" valida `wac === "2"` después de un SELL de 5 sobre BUY 10@$2.
- **Realized P&L acumulado vs. delta:** `pos.realizedPnlUsd` (acumulado del cycle) se actualiza; `realizedPnlDelta` (esta tx) se devuelve aparte.
- **Frozen on close:** una vez `status === 'CLOSED'`, ningún `processTransaction` posterior puede mutar esta posición — el caller debe pasar `null` (o `undefined`) en `position` para abrir cycle nuevo. Si pasa la CLOSED, el branching de `processTransaction` la detecta y rutea a `openNewCycle`.

### 3.5. `calculateWAC` — métricas derivadas

```text
function calculateWAC(position: PositionState, currentPriceUsd?: DecimalString | null): WACResult {
  const wac = position.wac
  const balance = position.balance
  const costBasis = position.costBasis

  if (currentPriceUsd === undefined || currentPriceUsd === null) {
    return { wac, costBasis, balance, unrealizedPnlUsd: null, unrealizedPnlPct: null }
  }

  const wacD = toDecimal(wac)
  const balD = toDecimal(balance)
  const priceD = toDecimal(currentPriceUsd)

  // unrealized P&L USD = (currentPrice - wac) × balance
  const unrealizedUsd = priceD.minus(wacD).times(balD)

  // unrealized P&L % = ((currentPrice - wac) / wac) × 100, salvo wac == 0
  const unrealizedPct = wacD.isZero()
    ? null
    : priceD.minus(wacD).div(wacD).times(100)

  return {
    wac,
    costBasis,
    balance,
    unrealizedPnlUsd: roundToStorage(unrealizedUsd),
    unrealizedPnlPct: unrealizedPct === null ? null : roundToStorage(unrealizedPct),
  }
}
```

**Decisión: `calculateWAC` recibe el `PositionState` directo, no un `positionId`.** El motor es puro y no consulta DB; el caller le pasa el estado actual (que ya tenía cargado para llamar a `processTransaction`, o que lee con `findOpenPosition` en US-006). Esto cumple el acceptance criteria literal (`PositionEngine.calculateWAC(positionId)` en el PRD es prosa, no API exacta — la API real recibe el estado directamente para mantener pureza). En US-006, el `PositionRepository` expondrá un helper `getPositionMetrics(positionId, currentPrice)` que carga la row + invoca `calculateWAC`.

### 3.6. Helpers de `decimal-utils.ts`

```ts
// decimal-utils.ts
import Decimal from "decimal.js";

// Configuración global — se ejecuta UNA vez al cargar el módulo.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export const ZERO = new Decimal(0);

export function toDecimal(value: string): Decimal {
  return new Decimal(value);
}

/**
 * Trunca/redondea a 18 decimales (el scale de NUMERIC(38,18) en DB).
 * Garantiza round-trip exacto: lo que el motor escribe es lo que la DB persiste.
 */
export function roundToStorage(value: Decimal): string {
  return value.toFixed(18, Decimal.ROUND_HALF_EVEN);
}

export function isInbound(type: TransactionType): boolean {
  return type === "BUY" || type === "SWAP_IN" || type === "TRANSFER_IN";
}

export function isOutbound(type: TransactionType): boolean {
  return type === "SELL" || type === "SWAP_OUT" || type === "TRANSFER_OUT";
}
```

**Por qué `toFixed(18)` y no `toString()`:** `toString()` puede emitir notación científica para números muy chicos o muy grandes. `toFixed(18)` garantiza notación decimal plana, exactamente como `pg` la entrega para `NUMERIC`. Mitiga R2 de la proposal.

**Tests** comparan strings con normalización: `expect(stripTrailingZeros(result.wac)).toBe("2")` o directamente `expect(result.wac).toBe("2.000000000000000000")` cuando el formato fijo importa. Vamos a usar el formato fijo en los tests para detectar regresiones de redondeo.

---

## 4. Decisiones de arquitectura

### D1 — Función pura módulo vs. clase con DI

| Aspecto | Función pura módulo (elegido) | Clase con DI |
|---|---|---|
| Forma | `export function processTransaction(input): result` | `class PositionEngine { constructor(deps) {} processTransaction(input) {} }` |
| Test | Import directo, sin setup | `new PositionEngine({ ... })` por test |
| Estado interno | Cero | Puede haber (anti-patrón si el motor es puro) |
| Mocking | No aplica (sin deps) | Innecesario porque no hay deps |

**Decisión:** **función pura módulo.** El motor no tiene dependencias inyectables (`decimal.js` se importa estáticamente, no es una dep que cambie en tests). Una clase añadiría ceremonia (`new PositionEngine()` en cada test) sin beneficio. La proposal habla de "clase/factoría" como término genérico — bajamos a función exportada.

**Alternativa descartada — clase:** solo justificada si hubiera estado interno (cache, contadores) o dependencias externas (logger, repo). El motor es 100% puro: misma input → misma output. La clase sería sobreingeniería.

**Alternativa descartada — service con DI completa:** introduce un container de DI que el resto del backend Fastify no usa (Fastify resuelve deps via plugins, no DI containers). Inconsistente con el stack.

### D2 — `decimal.js` vs. alternativas

Ya tratado en proposal §3.4. Re-confirmado:

| Opción | Veredicto |
|---|---|
| `Number` nativo | RECHAZADO — falla los tests exactos del acceptance ("WAC=$2.00 exacto"). |
| `BigInt` | RECHAZADO — entero solo, requiere mantener `scale` aparte (frágil). |
| `bignumber.js` | RECHAZADO — equivalente; `decimal.js` es más adoptado en accounting JS. |
| `dinero.js` | RECHAZADO — para currency con scale fijo, no para tokens con 18 decimales arbitrarios. |
| **`decimal.js`** | **ELEGIDO** — precisión configurable, sin deps, ROUND_HALF_EVEN nativo. |

Configuración: `Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN })`. 40 dígitos cubre con margen los 38 del schema NUMERIC(38,18). Banker's rounding (ROUND_HALF_EVEN) es estándar contable, evita el sesgo del "redondeo común" en muestras grandes.

### D3 — `calculateWAC` recibe `PositionState` directo (no `positionId`)

| Opción | Pros | Contras |
|---|---|---|
| `calculateWAC(positionId)` | Match literal con el acceptance ("PositionEngine.calculateWAC(positionId)"). | Forzaría al motor a tener acceso a DB. ROMPE pureza. ROMPE test:engine sin mocks. |
| **`calculateWAC(position, currentPriceUsd?)`** | **Pureza preservada. Test sin DB. Caller carga el state una vez y lo reusa.** | Diverge textualmente del PRD (pero el espíritu se cumple — métrica derivada). |

**Decisión:** firma `calculateWAC(position: PositionState, currentPriceUsd?: DecimalString | null): WACResult`. La función `getPositionMetricsByID(id, price)` existirá en `PositionRepository` (US-006) y será la que matchee el texto del PRD. Doc en spec.

### D4 — Errores tipados (clases) vs. `Result<T, E>`

| Opción | Pros | Contras |
|---|---|---|
| **Clases tipadas (elegido)** | Match con `nodejs-backend-patterns` skill. Stack traces nativos. `instanceof`/`name` narrowing. | Try/catch en el caller. |
| `Result<T, E>` (Rust-style) | Sin try/catch, errores en el tipo. | El resto del backend (Fastify, plugins) usa throw. Inconsistente. Más verbose. |

**Decisión:** **clases tipadas con `name` literal-typed (`as const`)**. Permite `if (err instanceof InsufficientBalanceError)` con narrowing exacto del compiler, o `if (err.name === "InsufficientBalanceError")` para casos donde no se quiere acoplar al constructor. Test del acceptance valida el shape exacto del error: `expect(err).toBeInstanceOf(InsufficientBalanceError)` + `expect(err.currentBalance).toBe("10")` + `expect(err.attempted).toBe("15")`.

### D5 — `roundToStorage` siempre vs. solo en boundary

| Opción | Pros | Contras |
|---|---|---|
| Solo redondear al output final (1 vez por `processTransaction`) | Menos overhead. | Drift acumulativo si guardamos `Decimal` interno entre ops. |
| **Redondear cada campo `string` que devolvemos** | Garantiza que cada campo del `PositionState` retornado tiene exactamente 18 decimales. Round-trip exacto con DB. | Nominal overhead (~20µs por tx). |

**Decisión:** redondear cada campo `string` al construir el `PositionState` retornado. Las operaciones intermedias usan `Decimal` con precision 40 (sin redondeo). Solo el cruce a `string` aplica `toFixed(18)`. Esto cubre R2 de la proposal directamente.

### D6 — Co-locación de errores en `types.ts` vs. `errors.ts` separado

La proposal mencionaba `errors.ts`. Bajamos a co-locar errores en `types.ts` porque (a) son parte del contrato de tipos del motor, (b) el archivo tiene <200 líneas — separarlos añade un import más sin beneficio. El `index.ts` los re-exporta junto con los demás tipos. Si en el futuro la lista de errores crece, se separa entonces.

### D7 — Tests co-localizados (`__tests__/`) vs. directorio paralelo (`apps/backend/tests/`)

La proposal mencionaba `apps/backend/tests/position-engine/`. Bajamos a `apps/backend/src/position-engine/__tests__/` por consistencia con la convención más extendida del ecosistema Vitest/Jest y porque mantiene el motor como una unidad cerrada. Refleja decisión D7.

---

## 5. Out of scope (recordatorio)

Reafirmado del proposal §2 — esto NO va en US-004:

- **Sync workflow** — el motor no orquesta llamadas a Etherscan/BscTrace/Binance. Eso es US-008/US-009.
- **HTTP routes** — sin endpoints Fastify. Sin Zod schemas en el boundary HTTP. Eso es US-005/US-006.
- **DB access patterns** — `PositionRepository` con `pg.Pool`, transacciones SQL `BEGIN ... COMMIT`, `SELECT ... FOR UPDATE`, idempotencia con `ON CONFLICT`. Eso es US-006.
- **Resolución de `cost_source` en TRANSFER_IN** — el algoritmo cross-source (`from_address` → on-chain wallet → CEX withdraw) lo hace `OnChainSyncService.resolveTransferCost` en US-008. El motor recibe `priceUsd` y `costSource` ya resueltos.
- **Multi-wallet aggregation** — agregar varias wallets ON_CHAIN sobre el mismo `(contract_address, network)` es responsabilidad del endpoint de portfolio en US-007.
- **Concurrency control** — `SELECT ... FOR UPDATE` y locking es US-006. El motor asume input consistente.

---

## 6. Resumen para `sdd-tasks`

La siguiente phase (`sdd-tasks`) debe romper esto en una checklist de implementación TDD que cubra, en orden:

1. Setup: instalar `decimal.js`, agregar script `test:engine`, crear `vitest.config.ts` con project `engine`.
2. `decimal-utils.ts` — config global + helpers (`toDecimal`, `roundToStorage`, `ZERO`, `isInbound`, `isOutbound`).
3. `types.ts` — `TransactionInput`, `PositionState`, `PositionEngineResult`, `WACResult`, `ProcessTransactionInput`, errors.
4. `engine.ts` — `processTransaction` esqueleto + branches por type, **uno a la vez bajo Strict TDD**:
   - Test 1 (DCA) → implementar `openNewCycle` + `appendToOpenPosition` (BUY).
   - Test 2 (SELL parcial) → implementar `reduceOpenPosition`.
   - Test 3 (ciclo completo) → soporte para CLOSED detection + nuevo cycle post-CLOSED.
   - Test 4 (Convert) → soporte para SWAP_OUT + SWAP_IN.
   - Test 5 (TRANSFER_IN herencia) → `TRANSFER_IN` se trata igual que BUY.
   - Test 6 (NEGATIVE) → `InsufficientBalanceError` con shape exacto.
   - Test 7 (source-agnostic) → assertion de igualdad estructural entre runs ETHERSCAN vs. BINANCE.
5. `engine.ts` — `calculateWAC` con tests adicionales: con/sin `currentPriceUsd`, wac=0 edge case.
6. `index.ts` — re-exports named.
7. Coverage gate: 100% líneas y branches en `engine.ts`.
