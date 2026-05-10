# Delta Spec: US-014 — Binance sync con historia completa, fiat y cobertura de pares ampliada

> **Dominios afectados**: `binance-sync`, `database-schema` (solo cursores nuevos, sin migraciones)

---

## ADDED Requirements

### Requirement: REQ-001 — Reemplazo de `SYNC_START_MS` por `BINANCE_HISTORY_FLOOR_MS`

El sistema MUST reemplazar la constante `SYNC_START_MS = new Date('2025-12-01T00:00:00.000Z').getTime()` por `export const BINANCE_HISTORY_FLOOR_MS = new Date('2017-01-01T00:00:00.000Z').getTime()` en `apps/backend/src/services/binance-sync.ts`.

Cualquier referencia a `SYNC_START_MS` en el codebase MUST migrar a `BINANCE_HISTORY_FLOOR_MS`.

#### Scenario: Primera sync parte desde 2017-01-01

- GIVEN una wallet CEX sin cursores previos en `wallet_sync_cursors`
- WHEN `BinanceSyncService.sync()` arranca cualquier paso (fiat, deposits, etc.)
- THEN el timestamp de inicio MUST ser `BINANCE_HISTORY_FLOOR_MS` (2017-01-01T00:00:00Z)
- AND la constante MUST estar exportada para uso en tests

#### Scenario: Sync incremental respeta cursores existentes

- GIVEN una wallet CEX con cursor `trades:ETHUSDT` apuntando a 2024-06-15
- WHEN `syncTrades()` arranca para el par ETHUSDT
- THEN el fetch MUST empezar desde el cursor guardado (2024-06-15), no desde `BINANCE_HISTORY_FLOOR_MS`

---

### Requirement: REQ-002 — Nuevos métodos en `BinanceApiClient` para fiat

`apps/backend/src/sync/clients/binance-api.ts` MUST exponer dos métodos nuevos:

```typescript
getFiatOrders(opts: {
  beginTime: number;
  endTime: number;
  transactionType: 0 | 1;
  signal?: AbortSignal;
}): Promise<FiatOrderResponse[]>;

getFiatPayments(opts: {
  beginTime: number;
  endTime: number;
  transactionType: 0 | 1;
  signal?: AbortSignal;
}): Promise<FiatPaymentResponse[]>;
```

- `getFiatOrders()` MUST consumir `GET /sapi/v1/fiat/orders`
- `getFiatPayments()` MUST consumir `GET /sapi/v1/fiat/payments`
- Ambos MUST aceptar `signal?: AbortSignal` y propagarlo al `fetch()`

#### Scenario: getFiatOrders retorna órdenes de compra con tarjeta

- GIVEN API key con permisos fiat configurada
- AND Binance tiene órdenes fiat en el rango solicitado
- WHEN se llama `getFiatOrders({ beginTime, endTime, transactionType: 0 })`
- THEN MUST retornar array de `FiatOrderResponse[]` con campos `orderNo`, `sourceAmount`, `obtainAmount`, `fiatCurrency`, `cryptoCurrency`, `price`, `status`, `createTime`

#### Scenario: getFiatPayments retorna pagos bancarios

- GIVEN API key con permisos fiat configurada
- WHEN se llama `getFiatPayments({ beginTime, endTime, transactionType: 0 })`
- THEN MUST retornar array de `FiatPaymentResponse[]` con campos `orderNo`, `sourceAmount`, `obtainAmount`, `fiatCurrency`, `cryptoCurrency`, `status`, `createTime`

#### Scenario: NEGATIVE — 401/403 o código de permisos en fiat

- GIVEN API key sin permisos fiat
- WHEN se llama `getFiatOrders()` o `getFiatPayments()`
- AND Binance responde HTTP 401, 403, o body con `code` en `{-1022, -2008, -2014, -2015, -1109}`
- THEN el método MUST lanzar un error identificable como `PERMISSION_DENIED`
- AND el error MUST ser distinguible de errores 5xx (server error / rate limit)

#### Scenario: NEGATIVE — 5xx de Binance NO se trata como PERMISSION_DENIED

- GIVEN un error HTTP 500 o 429 de Binance en `/sapi/v1/fiat/orders`
- WHEN `getFiatOrders()` recibe la respuesta
- THEN MUST propagar el error como error real (no como permission denied)

---

### Requirement: REQ-003 — Propagación de `AbortSignal` a todos los fetch de `BinanceApiClient`

Cada llamada `fetch(...)` dentro de `BinanceApiClient` MUST aceptar y propagar `signal: AbortSignal` via el parámetro `{ signal }` de fetch.

Los métodos existentes (`getMyTrades`, `getConvertHistory`, `getWithdrawHistory`, `getDepositHistory`, `getAccountAssets`, `getValidTradingSymbols`) MUST agregar `signal?: AbortSignal` a su firma y propagarlo.

#### Scenario: signal.aborted cancela fetch en curso

- GIVEN un `AbortController` con su `signal`
- WHEN se llama `getMyTrades(symbol, startTime, endTime, signal)` y se aborta el controller mid-flight
- THEN el `fetch()` subyacente MUST lanzar `AbortError`
- AND el error MUST propagarse al caller

---

### Requirement: REQ-004 — `QUOTE_ASSETS` ampliado y `getQuoteAsset()` actualizado

```typescript
export const QUOTE_ASSETS = ['USDT', 'USDC', 'BTC', 'ETH', 'BNB', 'FDUSD'] as const;
```

`getQuoteAsset(symbol)` MUST reconocer `USDC` y `FDUSD` como sufijos válidos **antes** del fallback de 3 caracteres.

#### Scenario: getQuoteAsset reconoce USDC como sufijo

- GIVEN `symbol = 'ETHUSDC'`
- WHEN se llama `getQuoteAsset('ETHUSDC')`
- THEN MUST retornar `'USDC'`

#### Scenario: getQuoteAsset reconoce FDUSD como sufijo

- GIVEN `symbol = 'BTCFDUSD'`
- WHEN se llama `getQuoteAsset('BTCFDUSD')`
- THEN MUST retornar `'FDUSD'`

#### Scenario: getQuoteAsset mantiene compatibilidad con sufijos existentes

- GIVEN `symbol = 'ETHUSDT'`
- WHEN se llama `getQuoteAsset('ETHUSDT')`
- THEN MUST retornar `'USDT'` (sin regresión)

---

### Requirement: REQ-005 — Filtro de self-pairs y stables cruzados

`syncTrades()` MUST filtrar pares `(base, quote)` donde:
- `base === quote`, o
- ambos son stablecoins del mismo grupo (ej: USDTUSDC, USDCFDUSD, BUSDUSDT)

El filtro MUST aplicarse **antes** de llamar a `myTrades` — no se hace fetch para pares filtrados.

#### Scenario: USDTUSDC se filtra antes del fetch

- GIVEN `discoverAssets()` incluye `USDT` y `USDC` en assets
- AND `QUOTE_ASSETS` incluye `USDC` y `USDT`
- WHEN `syncTrades()` genera pares candidatos
- THEN el par `USDTUSDC` MUST NOT aparecer en la lista de pares a sincronizar
- AND `myTrades` MUST NOT llamarse para ese par

#### Scenario: par normal se mantiene

- GIVEN `discoverAssets()` incluye `ETH`
- WHEN `syncTrades()` genera pares candidatos con `QUOTE_ASSETS`
- THEN `ETHUSDT`, `ETHUSDC`, `ETHBTC`, `ETHBNB`, `ETHFDUSD` MUST ser candidatos válidos (sujeto a validación contra trading symbols)

---

### Requirement: REQ-006 — `discoverAssets()` basado en tokens insertados

`discoverAssets()` MUST ejecutar:

```sql
SELECT DISTINCT symbol FROM tokens WHERE wallet_id = $1 AND network = 'CEX_BINANCE'
```

sobre los rows insertados por los pasos previos del **mismo run** (fiat, deposits, withdrawals, converts), **no** desde el balance actual de Binance via `getAccountAssets()`.

#### Scenario: Asset descubierto desde fiat insert del mismo run

- GIVEN el usuario compró DOGE con tarjeta → `syncFiat()` insertó un token DOGE
- WHEN `syncTrades()` llama a `discoverAssets()`
- THEN DOGE MUST aparecer en la lista de assets
- AND `syncTrades()` MUST intentar pares como `DOGEUSDT`, `DOGEUSDC`, etc.

#### Scenario: Asset con balance 0 en Binance pero con historial

- GIVEN el usuario vendió todo su ETH en 2022 (balance actual = 0)
- AND existen rows de tipo `TRANSFER_IN` para ETH insertados por `syncDeposits()`
- WHEN `discoverAssets()` ejecuta la query
- THEN ETH MUST aparecer como asset descubierto
- AND sus trades MUST sincronizarse

#### Scenario: NEGATIVE — getAccountAssets() ya no determina discovery

- GIVEN un asset `XYZ` con balance en Binance pero sin ninguna transacción en la DB
- WHEN `discoverAssets()` se ejecuta
- THEN `XYZ` MUST NOT aparecer en la lista (solo se descubren assets con txs persistidas)

---

### Requirement: REQ-007 — `getValidTradingSymbols()` memoizado por run

`getValidTradingSymbols()` MUST llamarse UNA sola vez al inicio de `syncTrades()`. El resultado MUST memoizarse en una variable local del método por la duración del run. No hay cache global cross-sync (RD-011).

#### Scenario: Una sola llamada por run

- GIVEN un wallet con 20 assets descubiertos
- WHEN `syncTrades()` ejecuta
- THEN `getValidTradingSymbols()` MUST haberse llamado exactamente 1 vez
- AND todos los assets MUST validarse contra el resultado memoizado

---

### Requirement: REQ-008 — Nuevo paso `syncFiat()` con persistencia

`BinanceSyncService` MUST implementar `syncFiat(runId, emit?, signal?)` que:

1. Recorre `getFiatOrders()` en ventanas de 90 días desde cursor `fiat:orders` (o `BINANCE_HISTORY_FLOOR_MS`)
2. Recorre `getFiatPayments()` en ventanas de 90 días desde cursor `fiat:payments` (o `BINANCE_HISTORY_FLOOR_MS`)
3. Persiste `transactionType=0` como `FIAT_IN` y `transactionType=1` como `FIAT_OUT`
4. Usa `cex_order_id = payload.orderNo`, `cex_trade_id = NULL`, `tx_log_index = 0`
5. Setea `cost_source = 'MARKET'` siempre
6. Toda tx persistida incluye `sync_run_id = runId`

**Resolución de precio (RD-007):**
- Para `/sapi/v1/fiat/orders`: `priceUsd = payload.price` (ya en USD/asset)
- Para `/sapi/v1/fiat/payments` con `fiatCurrency === 'USD'`: `priceUsd = sourceAmount / obtainAmount`
- Para `/sapi/v1/fiat/payments` con otra fiat: `priceUsd = priceService.getFiatToUsdAt(fiatCurrency, timestamp)`. Si falla: `cost_source = 'MANUAL'`, `price_usd = null`

**Manejo de permisos (RD-002):**
- Si `getFiatOrders()` o `getFiatPayments()` lanza error de permisos, `syncFiat()` MUST retornar `{ status: 'skipped', code: 'PERMISSION_DENIED', message: 'Tu API key no tiene permisos para historial fiat...' }`
- La sync MUST continuar con el siguiente paso (deposits)

#### Scenario: Fiat orders se persisten correctamente como FIAT_IN

- GIVEN una orden fiat de Binance: `{ orderNo: 'abc-123', transactionType: '0', sourceAmount: '500', obtainAmount: '500', fiatCurrency: 'USD', cryptoCurrency: 'USDT', price: '1.0', status: 'Completed', createTime: 1687000000000 }`
- WHEN `syncFiat()` la procesa
- THEN MUST insertar un row en `transactions` con:
  - `type = 'FIAT_IN'`
  - `cex_order_id = 'abc-123'`
  - `cex_trade_id = NULL`
  - `tx_log_index = 0`
  - `price_usd = '1.0'`
  - `cost_source = 'MARKET'`
  - `amount = '500'`
  - `sync_run_id = runId`

#### Scenario: Fiat sell se persiste como FIAT_OUT

- GIVEN una orden fiat con `transactionType: '1'`
- WHEN `syncFiat()` la procesa
- THEN MUST insertar con `type = 'FIAT_OUT'`

#### Scenario: 403 en fiat → skipped, sync continúa

- GIVEN `getFiatOrders()` lanza error PERMISSION_DENIED
- WHEN `syncFiat()` captura el error
- THEN MUST retornar `{ status: 'skipped', code: 'PERMISSION_DENIED' }`
- AND MUST emitir `{ step: 'fiat', status: 'skipped', code: 'PERMISSION_DENIED', message: '...' }` si `emit` está definido
- AND `syncDeposits()` MUST ejecutarse normalmente a continuación

#### Scenario: Cursores fiat se mantienen por endpoint

- GIVEN sync exitosa de fiat orders hasta 2026-04-30
- WHEN la sync completa via `commitSuccess()`
- THEN `wallet_sync_cursors` MUST tener un row con `operation = 'fiat:orders'` y `last_value` correspondiente
- AND `wallet_sync_cursors` MUST tener un row con `operation = 'fiat:payments'`

#### Scenario: Precio fiat non-USD con fallback a MANUAL

- GIVEN un pago fiat con `fiatCurrency = 'EUR'`
- AND `priceService.getFiatToUsdAt('EUR', timestamp)` falla
- WHEN `syncFiat()` persiste la transacción
- THEN MUST guardar `cost_source = 'MANUAL'`, `price_usd = null`
- AND la transacción MUST persistirse (no se descarta)

---

### Requirement: REQ-009 — Orden de ejecución y firma con emit/signal

`BinanceSyncService.sync()` MUST ejecutar los pasos en este orden exacto:

```
1. syncFiat()
2. syncDeposits()
3. syncWithdrawals()
4. syncConvert()
5. syncTrades()
```

Todos los métodos (`syncFiat`, `syncDeposits`, `syncWithdrawals`, `syncConvert`, `syncTrades`) MUST aceptar parámetros opcionales `(emit?: SyncEmitter, signal?: AbortSignal)`:
- Cuando `emit` es `undefined`, no emiten nada (compatibilidad con POST actual)
- Cuando `signal` es definido, MUST chequear `signal.aborted` antes de cada batch HTTP
- Si `signal.aborted === true`, MUST interrumpir la ejecución limpiamente

#### Scenario: Sync con emit undefined (POST legacy)

- GIVEN `emit = undefined` y `signal = undefined`
- WHEN `sync()` ejecuta todos los pasos
- THEN el comportamiento MUST ser funcionalmente idéntico al actual (sin SSE)
- AND no MUST haber errores por emit/signal no definidos

#### Scenario: signal.aborted interrumpe entre pasos

- GIVEN `signal` abortado después de syncFiat completo
- WHEN `syncDeposits()` chequea `signal.aborted` al inicio
- THEN MUST interrumpir la ejecución
- AND SyncRunHelper MUST llamar `rollback(runId)` (vía el caller)

---

### Requirement: REQ-010 — Integración con `SyncRunHelper` (atomicidad por run)

`BinanceSyncService.sync()` MUST integrar con `SyncRunHelper` de US-018:

1. Al iniciar: `SyncRunHelper.start(walletId, 'CEX')` → obtiene `runId`
2. Cargar buffer: `PositionStateBuffer.loadInitial(pool, walletId)` → `buffer`
3. Cada tx persistida durante cualquier paso MUST incluir `sync_run_id = runId`
4. `positions` y `wallet_sync_cursors` MUST mantenerse en memoria durante el run
5. Al finalizar exitosamente: `SyncRunHelper.commitSuccess(runId, { positions: buffer, cursorUpdates })`
6. En cualquier fallo: `SyncRunHelper.rollback(runId)` → CASCADE borra txs del run

#### Scenario: Sync exitosa completa → commit atómico

- GIVEN una wallet CEX con historial fiat + trades
- WHEN `sync()` completa los 5 pasos sin error
- THEN MUST existir exactamente 1 row en `sync_runs` con `status = 'completed'`
- AND todas las txs del run MUST referenciar ese `sync_run_id`
- AND `positions` MUST estar actualizadas (UPSERT)
- AND `wallet_sync_cursors` MUST estar avanzados
- AND todo MUST haberse hecho en una sola transacción DB final

#### Scenario: Fallo en syncWithdrawals → rollback completo

- GIVEN `syncFiat()` persistió 50 txs con `sync_run_id = runId`
- AND `syncDeposits()` persistió 20 txs con `sync_run_id = runId`
- WHEN `syncWithdrawals()` falla con HTTP 500
- THEN `SyncRunHelper.rollback(runId)` MUST ejecutarse
- AND `DELETE FROM sync_runs WHERE id = runId` MUST disparar CASCADE
- AND las 70 txs previas MUST haber desaparecido de `transactions`
- AND `positions` MUST estar idénticas a antes del run
- AND `wallet_sync_cursors` MUST no haber avanzado

#### Scenario: Sync exitosa → un solo row completed en sync_runs

- GIVEN sync completa sin errores
- WHEN se consulta `sync_runs` para esa wallet
- THEN MUST existir un row con `status = 'completed'`, `completed_at IS NOT NULL`
- AND `txs_persisted` MUST reflejar el total de txs insertadas en el run

---

### Requirement: REQ-011 — Position engine procesa FIAT_IN como BUY y FIAT_OUT como SELL

El position engine (ya actualizado en US-013) MUST tratar:
- `FIAT_IN` idéntico a `BUY`: actualiza WAC + balance
- `FIAT_OUT` idéntico a `SELL`: actualiza balance, NO toca WAC (RD-001)

#### Scenario: FIAT_IN actualiza WAC y balance

- GIVEN posición vacía para USDT
- WHEN se procesa `FIAT_IN` con `amount=500`, `priceUsd=1.0`
- THEN `balance = 500`, `wac = 1.0`, `realized_pnl = 0`

#### Scenario: FIAT_OUT reduce balance sin tocar WAC

- GIVEN posición USDT con `balance=500`, `wac=1.0`
- WHEN se procesa `FIAT_OUT` con `amount=200`
- THEN `balance = 300`, `wac = 1.0` (sin cambio), `realized_pnl = 0`

---

## Negative Scenarios

### NEGATIVE-001: Par USDTUSDC no se intenta

- GIVEN `QUOTE_ASSETS` incluye tanto USDT como USDC
- WHEN `syncTrades()` genera pares candidatos
- THEN `USDTUSDC` MUST NOT estar en la lista
- AND `myTrades` MUST NOT llamarse para ese par

### NEGATIVE-002: 5xx en fiat NO es PERMISSION_DENIED

- GIVEN `getFiatOrders()` falla con HTTP 500
- WHEN `syncFiat()` evalúa el error
- THEN MUST propagarlo como error real
- AND la sync MUST detenerse (no skipped)
- AND `SyncRunHelper.rollback()` MUST ejecutarse

### NEGATIVE-003: Sync de wallet ON_CHAIN no es afectada

- GIVEN una wallet `ON_CHAIN` (ETH o BSC)
- WHEN se ejecuta su sync
- THEN `OnChainSyncService` MUST funcionar exactamente igual que antes
- AND ningún cambio de US-014 MUST impactar el flujo on-chain

### NEGATIVE-004: FIAT_OUT con balance insuficiente

- GIVEN posición con `balance = 10`
- WHEN se procesa `FIAT_OUT` con `amount = 50`
- THEN MUST lanzar `InsufficientBalanceError` igual que SELL

### NEGATIVE-005: Dos INSERT con mismo cex_order_id

- GIVEN un row existente con `cex_order_id = 'abc-123'`
- WHEN se intenta INSERT de otra tx con `cex_order_id = 'abc-123'`
- THEN MUST fallar con violación de UNIQUE constraint
- AND `ON CONFLICT DO NOTHING` MUST aplicar para idempotencia

---

## Contracts

### Constantes exportadas

```typescript
export const BINANCE_HISTORY_FLOOR_MS = new Date('2017-01-01T00:00:00.000Z').getTime();
export const QUOTE_ASSETS = ['USDT', 'USDC', 'BTC', 'ETH', 'BNB', 'FDUSD'] as const;
```

### `BinanceSyncService.sync()` — firma actualizada

```typescript
async sync(
  walletId: string,
  userId: string,
  opts?: { emit?: SyncEmitter; signal?: AbortSignal }
): Promise<BinanceSyncResult>
```

### `BinanceSyncResult` — shape ampliado

```typescript
interface BinanceSyncResult {
  trades: number;
  converts: number;
  withdrawals: number;
  deposits: number;
  fiat: number;
  tokensCreated: number;
}
```

### Fila fiat en `transactions`

```
type:            FIAT_IN | FIAT_OUT
cex_order_id:    payload.orderNo (TEXT, UUID format)
cex_trade_id:    NULL
tx_log_index:    0
cost_source:     'MARKET' (o 'MANUAL' si precio fiat→USD falla)
price_usd:       decimal | NULL
sync_run_id:     runId (UUID)
```

### Cursores nuevos en `wallet_sync_cursors`

```
operation = 'fiat:orders'    → ms timestamp of last processed order
operation = 'fiat:payments'  → ms timestamp of last processed payment
```
