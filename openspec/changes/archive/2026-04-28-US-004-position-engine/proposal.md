# Propuesta — US-004: PositionEngine (motor WAC y ciclos)

> **Estado:** propuesta inicial
> **Change name:** `US-004-position-engine`
> **Depende de:** `US-002-db-schema`
> **Stack target:** Fastify 5 + TypeScript strict + Zod 4 (Node 22), PostgreSQL via `pg`
> **Test runner:** vitest 2 — comando `npm run test:engine` (project `engine`, unit puro, sin DB real)
> **Referencia PRD:** `US-004` en `prd.json` (v5)

---

## 1. Intent

Implementar el **núcleo contable** del producto: una clase `PositionEngine` que, dada una transacción y el estado actual de una posición, calcula el nuevo estado (`wac`, `balance`, `cost_basis`, `realized_pnl_usd`, `status`) aplicando las reglas de WAC puro y ciclos de posición definidas por el PRD. Es la pieza que toda story posterior (`US-005` wallets, `US-006` ingreso manual, `US-007` portfolio API, `US-008/009` syncs) va a invocar para materializar transacciones.

---

## 2. Scope

### Entra en scope

**Backend (`apps/backend/src/position-engine/`):**

- `position-engine.ts` — clase/factoría `PositionEngine` con la API pública:
  - `processTransaction(input) → PositionState` — aplica una transacción al estado actual y devuelve el nuevo estado.
  - `calculateMetrics(position, currentPriceUsd) → { wac, costBasis, balance, unrealizedPnlUsd, unrealizedPnlPct }` — métricas derivadas para una posición OPEN dada un precio de mercado.
- `types.ts` — tipos del dominio del motor (`PositionState`, `TransactionInput`, `EngineResult`, `EngineError`, etc.) basados en los enums ya existentes en `db/enums.ts`.
- `errors.ts` — errores tipados del motor (`InsufficientBalanceError`, `InvalidTransactionError`).
- `decimal.ts` — wrapper de precisión decimal (ver §3.4).
- `tests/position-engine.test.ts` (vitest project `engine`) — cubre los 6 escenarios obligatorios del acceptance criteria + el caso NEGATIVE.

**Tooling:**

- `apps/backend/package.json` — agregar `decimal.js` (o equivalente, ver §3.4) y registrar el script `test:engine` (hoy no existe el script, solo el directorio).
- `apps/backend/vitest.config.ts` — declarar el project `engine` apuntando a `src/position-engine/**/*.test.ts` con env Node puro (sin DB).

### Fuera de scope

- **Persistencia.** El motor NO toca DB. Recibe `PositionState` y `TransactionInput` en memoria y devuelve `PositionState` nuevo. Quien lo invoque (futuro `PositionRepository` en US-005/US-006) se encarga de leer la posición OPEN actual, llamar al motor, y persistir el resultado en una transacción SQL.
- **HTTP routes.** No hay endpoint Fastify en esta story. La integración HTTP es US-006.
- **Sync services.** No hay llamadas a Etherscan/BscTrace/Binance. Eso es US-008/US-009.
- **Resolución de `cost_source` (TRANSFER_IN herencia).** El algoritmo de búsqueda cross-source (`OnChainSyncService.resolveTransferCost`, ver `prd.json → rules → "TRANSFER_IN COST RESOLUTION"`) es US-008. El motor en US-004 **acepta** transacciones `TRANSFER_IN` con `price_usd` ya resuelto y `cost_source ∈ {INHERITED, MANUAL, MARKET}` ya marcado por el caller. El motor solo aplica la fórmula WAC sobre el price recibido.
- **Multi-wallet aggregation.** La agregación de varias wallets ON_CHAIN sobre el mismo `(contract_address, network)` es responsabilidad del endpoint de portfolio (US-007), no del motor. Acá una posición pertenece a UN par `(wallet_id, token_id, cycle_number)`.
- **Decisión de qué `cycle_number` corre el caller vs. el motor.** Ver Open Question Q1.

---

## 3. Approach

### 3.1. Función pura sobre estado vs. acceso directo a DB

**Decisión:** **función pura** sobre estado en memoria. El motor NO recibe `pg.Pool` ni hace queries.

Firma propuesta:

```ts
type ProcessTransactionInput = {
  position: PositionState | null;       // null si no hay posición OPEN para (wallet, token)
  priorClosedCycles: number;             // max(cycle_number) de posiciones CLOSED previas (para abrir cycle_number=max+1)
  transaction: TransactionInput;         // { type, amount, priceUsd, costSource, blockTimestamp, source, ... }
};

type EngineResult = {
  position: PositionState;               // estado nuevo (OPEN o CLOSED)
  realizedPnlDelta: Decimal;             // P&L realizado generado por ESTA transacción (0 para BUY/IN)
  positionWasOpened: boolean;            // true si esta tx abrió un cycle nuevo
  positionWasClosed: boolean;            // true si esta tx llevó balance a 0
};

processTransaction(input: ProcessTransactionInput): EngineResult
```

**Justificación:**

1. **Strict TDD lo exige.** El comando `test:engine` corre unit puro, sin DB. Si el motor accede a `pg.Pool`, los tests necesitan mocks o testcontainers — contradictorio con "engine = unit puro" del PRD (`scripts.test:engine` es el separado de `test:sync` y `test:e2e` justamente para esto).
2. **Determinismo.** Una función pura sobre `(estado_actual, transacción) → estado_nuevo` es trivial de testear y razonar. Cualquier bug se reproduce con un objeto literal.
3. **Idempotencia natural.** Re-ejecutar el motor sobre el mismo input devuelve el mismo output. Combinado con el `ON CONFLICT DO NOTHING` de la capa de persistencia, el sistema completo es idempotente.
4. **Separación de concerns con el repository.** La story US-006 introducirá `PositionRepository` con métodos como `findOpenPosition(walletId, tokenId)`, `getMaxClosedCycle(walletId, tokenId)`, `persistTransactionAndPositionUpdate(...)` envueltos en `BEGIN; ...; COMMIT;`. Esa capa sí depende de DB; el motor no.

**Alternativa descartada — motor con DI de repository:** dar al motor un puerto `PositionRepository` inyectable. Suena limpio (hexagonal) pero introduce un nivel de indirección que solo justifica si el motor necesitara *queries adicionales* mid-cálculo (no las necesita: con `position` actual + `priorClosedCycles` ya tiene todo). Se descarta por sobreingeniería.

### 3.2. Separación `PositionEngine` (puro) vs. `PositionRepository` (DB)

```
┌────────────────────────────┐    ┌──────────────────────────────┐
│  PositionEngine (US-004)   │    │  PositionRepository (US-006) │
│  ─ pure functions          │    │  ─ pg queries                │
│  ─ no DB                   │    │  ─ tx transactions (BEGIN..) │
│  ─ test:engine (unit)      │    │  ─ test:sync (with DB)       │
└─────────────┬──────────────┘    └──────────────┬───────────────┘
              │                                   │
              └───────► invocado por ◄────────────┘
                       Service layer
                  (manual tx ingress, sync)
```

US-004 entrega solo la columna izquierda. La derecha viene en stories posteriores.

### 3.3. Reglas WAC y ciclos — algoritmo

Para cada `transaction.type`:

| Type | Acción del motor |
|------|------------------|
| `BUY`, `SWAP_IN`, `TRANSFER_IN` | Si `position == null` → abrir cycle (`cycle_number = priorClosedCycles + 1`, `status=OPEN`, `wac = price_usd`, `balance = amount`, `cost_basis = amount × price_usd`). Si `position != null` y `OPEN` → recalcular `wac = (cost_basis_actual + amount × price_usd) / (balance_actual + amount)`, sumar `balance` y `cost_basis`. |
| `SELL`, `SWAP_OUT`, `TRANSFER_OUT` | Validar `amount ≤ balance` (else `InsufficientBalanceError`). Reducir `balance`. **WAC NO cambia**. `cost_basis` se reduce proporcionalmente (`cost_basis_new = wac × balance_new`). Acumular `realized_pnl_usd += (price_usd - wac) × amount`. Si `balance == 0` → `status = CLOSED`, `closed_at = transaction.blockTimestamp`. |

**Casos borde explícitos:**

- `BUY` sobre posición `CLOSED` → tratado igual que `position == null` (caller no debe pasar la CLOSED como input; ver Q2). El motor asume que el caller pasa la **OPEN actual** o `null`.
- `TRANSFER_OUT` con `price_usd = null` → permitido (no genera realized P&L; o lo trata como 0). Confirmar con Q3.
- `SELL` con `price_usd = null` → rechazo: `InvalidTransactionError`. P&L realizado requiere precio.
- Swap (`SWAP_OUT` + `SWAP_IN` linkeados por `related_tx_id`) → el motor procesa **una transacción a la vez**. El caller invoca `processTransaction` dos veces, una por cada lado del swap, en orden. La unit test "Convert: USDT → ETH" cubre exactamente esto.

### 3.4. Precisión decimal — `decimal.js`

**Problema real:** WAC con `(0.1 + 0.2) / 0.3` en floating point IEEE-754 da `0.9999...`, no `1`. Multiplicar precios crypto (e.g. `0.000033` ETH × `$3030.42`) introduce error en las últimas cifras. Postgres almacena `NUMERIC(38, 18)` precisamente para esto; si el motor calcula con `number` nativo y serializa de vuelta, **rompemos la promesa de precisión del schema**.

**Decisión:** usar **`decimal.js`** (no `Number`, no `BigInt`) en TODA la aritmética del motor. Convertimos `string`/`number` → `Decimal` al entrar, operamos, y devolvemos `string` (formato decimal) al salir. La capa de persistencia maneja la serialización a `NUMERIC` de Postgres (que `pg` ya entrega como string para `NUMERIC` por defecto — preservamos la cadena).

**Por qué `decimal.js` y no alternativas:**

- ❌ `Number` nativo — IEEE-754, falla los tests exactos del acceptance ("WAC=$2.00 exacto").
- ❌ `BigInt` — entero solo, requiere mantener `scale` aparte (frágil para WAC con decimales arbitrarios).
- ❌ `bignumber.js` — equivalente a `decimal.js`; preferimos `decimal.js` por su precisión decimal nativa configurable y por ser el más usado en accounting JS.
- ❌ `dinero.js` — pensado para currency con scale fijo; el WAC de un memecoin shitter con 18 decimales no encaja bien.
- ✅ `decimal.js` — ~32KB minified, precisión configurable (default 20 dígitos significativos, ampliable), sin dependencias.

Configuración: `Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN })` (banker's rounding, estándar contable). 40 dígitos cubre con margen los 38 del schema.

**Escape hatch:** `types.ts` exporta tipos donde los campos numéricos son `string` (formato decimal). Internamente el motor opera con `Decimal`. La frontera input/output usa `string` para evitar exponer el tipo de la lib.

### 3.5. Source-agnosticismo

El motor recibe `transaction.source ∈ {ETHERSCAN, BSCTRACE, BINANCE, MANUAL}` pero NO ramifica lógica por source. Las reglas WAC son idénticas. El campo viaja con la transacción solo para que el caller lo persista; el motor podría ignorarlo y los resultados serían iguales. Test unit dedicado: misma secuencia de tx con `source=ETHERSCAN` vs. `source=BINANCE` produce idénticos `PositionState`.

### 3.6. Testing strategy (Strict TDD activo)

Cada caso del acceptance criteria se traduce en **un test rojo primero**, después implementación, después refactor. Tests planeados (`tests/position-engine.test.ts`):

1. **DCA.** 3 BUYs `1@$1`, `1@$2`, `1@$3` × 10 tokens c/u → `wac === "2.00..."` exacto (string equality contra `"2"` o `"2.000000000000000000"`).
2. **SELL parcial.** `BUY 10@$2` → `SELL 5@$3` → `wac === "2"`, `balance === "5"`, `realized_pnl_delta === "5"` (= `(3-2) × 5`).
3. **Ciclo completo.** `BUY 10@$2` → `SELL 10@$3` → `position.status === "CLOSED"`, `realized_pnl_usd === "10"`, `closed_at` definido. Luego `BUY 5@$1` con `priorClosedCycles=1` → nueva position `cycle_number=2`, `wac === "1"` (sin herencia).
4. **Convert (swap).** Tx1: `SWAP_OUT 100 USDT @ $1` (cierra USDT). Tx2: `SWAP_IN 0.033 ETH @ $3030`. Posición ETH abierta con `wac === "3030"`. Validar que las dos llamadas al motor producen estados consistentes.
5. **TRANSFER_IN herencia.** `BUY 10 ETH @ $2000` → `TRANSFER_IN 0.5 ETH @ $3000 (cost_source=INHERITED)` → `wac === "2047.6190..."` (= `(10×2000 + 0.5×3000) / 10.5`). Demuestra que el motor trata `INHERITED` como cualquier otro IN — es el caller el que se preocupa por *resolver* el price, no el motor.
6. **NEGATIVE — overflow SELL.** `BUY 10@$2` → `SELL 15@$3` → `InsufficientBalanceError({ currentBalance: "10", attempted: "15" })`. Test contra el shape exacto del error.
7. **Source-agnosticism.** Mismo escenario DCA con `source=ETHERSCAN` vs. `source=BINANCE` → outputs estructuralmente idénticos.

Coverage objetivo: **100% de líneas y branches** en `position-engine.ts`. Es código contable y todos los caminos están cubiertos por los 7 tests.

---

## 4. Affected modules / packages

| Path | Cambio | Notas |
|------|--------|-------|
| `apps/backend/src/position-engine/position-engine.ts` | NUEVO | API pública del motor. |
| `apps/backend/src/position-engine/types.ts` | NUEVO | `PositionState`, `TransactionInput`, `EngineResult`, derivados de `db/enums.ts`. |
| `apps/backend/src/position-engine/errors.ts` | NUEVO | `InsufficientBalanceError`, `InvalidTransactionError`. |
| `apps/backend/src/position-engine/decimal.ts` | NUEVO | Wrapper sobre `decimal.js`: `toDecimal(x)`, `fromDecimal(d)`, config global. |
| `apps/backend/src/position-engine/index.ts` | NUEVO | Re-exports públicos (named exports only). |
| `apps/backend/tests/position-engine/position-engine.test.ts` | NUEVO | 7 tests (Strict TDD: cada test rojo antes de su impl). |
| `apps/backend/package.json` | MODIFICADO | + `decimal.js`. + scripts `test:engine`, `test` (alias). |
| `apps/backend/vitest.config.ts` | NUEVO o MODIFICADO | Project `engine` con `include: ['src/position-engine/**/*.test.ts', 'tests/position-engine/**/*.test.ts']`, env Node puro. |

**No se toca:**

- `db/migrations/` — schema ya existe en US-002.
- `db/enums.ts` — los enums actuales ya son la fuente de verdad para los tipos del motor.
- `apps/backend/src/index.ts` — no hay registro Fastify nuevo.
- `apps/backend/src/routes/` — sin endpoints HTTP.
- Frontend — sin cambios.

---

## 5. Dependencies

- **US-002-db-schema (archivado 2026-04-26):** dependencia formal por el grafo del PRD. El motor importa los tipos derivados de `db/enums.ts`. No requiere DB en runtime de US-004 (puro), pero sí los enums congelados.
- **US-001-scaffold (archivado 2026-04-22):** transitiva. Provee la estructura del workspace, vitest, tsconfig strict, `as const`-only enum convention.
- **US-003-jwt-auth (archivado 2026-04-27):** sin dependencia. El motor no expone HTTP.

---

## 6. Rollback plan

Change **puramente aditivo y sin DB**. Para revertir:

1. `git revert` de los commits del change → `position-engine/` vuelve a estar vacío (con su `.gitkeep`).
2. `npm uninstall decimal.js -w apps/backend` para limpiar la dep.
3. `package.json` y `vitest.config.ts` vuelven a su estado pre-US-004 con el revert.

**Sin migración inversa** — no se tocó schema. El estado de la DB es invariante respecto a este change.

**Riesgo de rollback con stories dependientes mergeadas:** US-006 (POST manual) y US-008/US-009 (sync services) van a importar de `position-engine/`. Revertir US-004 después de mergear cualquiera de esas rompe el build de backend. Por eso el rollback solo es seguro **antes** de mergear stories que consuman el motor.

---

## 7. Risks

### R1 — `decimal.js` afecta tamaño del bundle backend (baja probabilidad, bajo impacto)

`decimal.js` pesa ~32KB. En backend Node es irrelevante (no hay bundle al cliente). El impacto real es en `npm install` cold start de Render — despreciable.

**Mitigación:** ninguna. Aceptado.

### R2 — Diferencias de redondeo entre `decimal.js` y `NUMERIC(38,18)` de Postgres (media probabilidad, alto impacto)

Si el motor calcula un WAC con 22 cifras decimales y la DB lo almacena con 18, hay redondeo. La próxima vez que se lea, comparar con un input recién calculado puede dar mismatch.

**Mitigación:**
1. Configurar `Decimal.set({ precision: 40 })` para tener margen de cabeza sobre los 18 de Postgres.
2. Antes de devolver del motor, **truncar/redondear a 18 decimales explícitamente** (`d.toFixed(18, Decimal.ROUND_HALF_EVEN)`). Esto garantiza que el valor que el motor escribe es el que la DB persiste sin transformación adicional.
3. Test unit: leer un valor de la DB (mockeado como string), pasarlo al motor, devolverlo, comparar con el original — round-trip exacto.

### R3 — El caller pasa la posición CLOSED en vez de `null` cuando debería abrir cycle nuevo (media probabilidad, alto impacto)

Si el caller (US-006) lee `positions WHERE wallet_id=X AND token_id=Y` sin filtrar `status=OPEN`, podría pasar al motor una posición CLOSED. El motor entonces "reabriría" un ciclo cerrado, contaminando el historial.

**Mitigación:**
1. **Contrato explícito en el tipo:** `position: PositionState | null` donde `PositionState` lleva `status: 'OPEN'` literal (no la unión). Si hay CLOSED, el caller MUST pasar `null` + el `priorClosedCycles` correcto.
2. **Guard runtime:** el motor valida `if (input.position && input.position.status !== 'OPEN') throw InvalidTransactionError(...)`. Test NEGATIVE adicional.

### R4 — Concurrent processing del mismo `(wallet, token)` desde dos requests (baja probabilidad, alto impacto)

Si dos peticiones manuales POST llegan simultaneas, ambas leen la misma OPEN, ambas calculan, ambas escriben — pierden una.

**Mitigación:** **NO es responsabilidad del motor.** El `PositionRepository` (US-006) debe envolver `read → engine → write` en una transacción Postgres con `SELECT ... FOR UPDATE` sobre la posición. El motor solo se preocupa de la lógica pura. Documentar este contrato en la spec para que US-006 lo herede.

---

## 8. Open questions

### Q1 — ¿Quién resuelve `priorClosedCycles`: motor o caller?

**Default sugerido:** caller. El motor recibe `priorClosedCycles: number` como input y lo usa solo cuando va a abrir un cycle nuevo (`cycle_number = priorClosedCycles + 1`). El motor no consulta DB, así que no podría calcularlo aunque quisiera. La justificación queda explícita en el contrato del tipo `ProcessTransactionInput`.

Confirmar antes de spec.

### Q2 — Si el caller pasa la última posición (sea OPEN o CLOSED) en vez de "OPEN actual o null", ¿el motor lo desambigua o rechaza?

**Default sugerido:** **rechaza** con `InvalidTransactionError` (ver R3). Mantener invariantes simples. El caller carga la responsabilidad de filtrar `WHERE status = 'OPEN'`.

### Q3 — `TRANSFER_OUT` con `price_usd = null` (cost_source=`MANUAL` sin resolver) — ¿error o tratarlo como P&L=0?

Caso real: usuario envía tokens a un cold wallet no registrado y no quiere asignar un precio. El balance se reduce, pero no hay realized P&L significativo (no hubo "venta" económica).

**Default sugerido:** **permitido**. El motor reduce balance, NO acumula realized P&L (delta=0), NO modifica WAC. Un comentario en la transacción persistida lo documenta. Confirmar con el PRD ("transferencias entre wallets propias no realizan P&L" — ver `prd.json → resolvedDecisions`).

### Q4 — Formato de salida: `Decimal`, `string`, o `number`?

**Default sugerido:** `string` con formato decimal exacto (`"2.000000000000000000"` o `"2"`, ambos válidos). Razón: encaja directo con cómo `pg` deserializa `NUMERIC` (también string), evita exponer `decimal.js` como tipo público, y los tests pueden comparar con `toEqual("2")` después de un `.replace(/\.?0+$/, '')` opcional. `number` queda descartado (precisión). `Decimal` queda descartado (acopla a la lib).

### Q5 — ¿`processTransaction` o `processTransactions(batch[])`?

**Default sugerido:** **una a la vez**. La API `processTransaction(input) → result` es más simple y ya cubre swap (dos llamadas). Si en el futuro un sync trae 200 trades de Binance, el caller hace un `for` loop pasando el `position` actualizado de la iteración anterior. Mantener API mínima ahora; ampliar si se justifica.

### Q6 — ¿Tipos compartidos con frontend?

El frontend (US-007 portfolio API consumer) eventualmente va a leer `wac`, `balance`, etc. ¿Conviene exportar `PositionState` desde un package compartido `@cryptoledger/types`?

**Default sugerido:** **no en US-004.** El motor expone tipos backend-only. Cuando US-007 implemente el endpoint REST, definirá su propio DTO con Zod (los tipos del motor pueden divergir del DTO HTTP — ej. el DTO no expone `cost_basis` interno). Postergar el package compartido hasta que haya 2+ consumers reales.
