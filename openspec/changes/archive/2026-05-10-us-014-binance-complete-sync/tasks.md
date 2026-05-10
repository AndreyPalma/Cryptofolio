# Tareas — US-014: Binance sync con historia completa, fiat y cobertura de pares ampliada

> Cambio: `us-014-binance-complete-sync`
> Generado: 2026-05-10
> Modo: Strict TDD (tests primero → implementación → quality gate)

---

## Work Unit 1: Tests TDD — fase RED

> Los tests tienen que existir y fallar (rojo) ANTES de tocar cualquier archivo de
> implementación. Si querés un cambio confiable, primero hacé visible la falla.

- [ ] **T01** — Tests de `syncFiat()` con mock de BinanceApiClient — `apps/backend/tests/sync-binance-fiat.test.ts`

  **Qué escribir** (proyecto Vitest `sync`):
  ```
  describe("syncFiat")
    ├── fiat orders type=0 → FIAT_IN con cex_order_id correcto          (REQ-008)
    ├── fiat orders type=1 → FIAT_OUT con cex_order_id correcto         (REQ-008)
    ├── fiat payments USD → price_usd = sourceAmount/obtainAmount       (REQ-008)
    ├── fiat payments non-USD → getFiatToUsdAt fallback a MANUAL        (REQ-008)
    ├── 403 en getFiatOrders → syncFiat retorna skipped                 (REQ-008, NEGATIVE-002)
    ├── 5xx en getFiatOrders → propaga error real, NO skipped           (NEGATIVE-002)
    ├── cursores fiat:orders y fiat:payments se acumulan                (REQ-008)
    └── todas las txs llevan sync_run_id = runId                        (REQ-010)
  ```

  **Estado esperado**: ROJO — `syncFiat()` no existe todavía, ni `getFiatOrders()` en el client.

  **Dependencias**: ninguna (fase RED)
  **Líneas estimadas**: ~250
  **Comando de verificación**: `npx vitest run apps/backend/tests/sync-binance-fiat.test.ts --project sync`
  **Aceptación**: el archivo existe y falla por `syncFiat is not a function` o `getFiatOrders is not a function`, NO por sintaxis

---

- [ ] **T02** — Tests de `BinanceApiClient` fiat methods + signal — `apps/backend/tests/binance-api-fiat.test.ts`

  **Qué escribir** (proyecto Vitest `sync`):
  ```
  describe("BinanceApiClient fiat methods")
    ├── getFiatOrders retorna array con shape correcto                  (REQ-002)
    ├── getFiatPayments retorna array con shape correcto                (REQ-002)
    ├── 401/403 en fiat → lanza FiatPermissionDeniedError               (REQ-002)
    ├── 500 en fiat → lanza ExternalApiError (no FiatPermissionDenied)  (REQ-002)
    └── signal propagado a fetch (mock)                                 (REQ-003)

  describe("getQuoteAsset")
    ├── ETHUSDC → USDC                                                  (REQ-004)
    ├── BTCFDUSD → FDUSD                                                (REQ-004)
    ├── ETHUSDT → USDT (regresión)                                      (REQ-004)
    └── ETHBNB → BNB (regresión)                                        (REQ-004)

  describe("self-pair filter")
    ├── USDTUSDC filtrado                                               (REQ-005)
    ├── USDCFDUSD filtrado                                              (REQ-005)
    └── ETHUSDT NO filtrado                                             (REQ-005)
  ```

  **Estado esperado**: ROJO — métodos fiat no existen, `getQuoteAsset` no reconoce FDUSD.

  **Dependencias**: ninguna (puede correrse en paralelo con T01)
  **Líneas estimadas**: ~180
  **Comando de verificación**: `npx vitest run apps/backend/tests/binance-api-fiat.test.ts --project sync`
  **Aceptación**: falla por razones correctas (método inexistente, resultado incorrecto), no por sintaxis

---

- [ ] **T03** — Tests de integración: flujo completo con atomicidad — `apps/backend/tests/sync-binance-complete.test.ts`

  **Qué escribir** (proyecto Vitest `sync`, con DB mock o real si `DATABASE_URL_TEST`):
  ```
  describe("BinanceSyncService complete flow with atomicity")
    ├── sync exitosa → commitSuccess con positions+cursors              (REQ-010)
    ├── fallo en syncWithdrawals → rollback borra txs de fiat+deposits  (REQ-010)
    ├── sync con emit → eventos emitidos en orden correcto              (REQ-009)
    ├── sync con signal.aborted → interrumpe entre pasos                (REQ-009)
    ├── BINANCE_HISTORY_FLOOR_MS usado en primera sync (no SYNC_START_MS) (REQ-001)
    ├── discoverAssets devuelve assets de txs previas, no de balance     (REQ-006)
    ├── getValidTradingSymbols llamado exactamente 1 vez                 (REQ-007)
    ├── BinanceSyncResult incluye campo fiat                             (REQ-009)
    └── sync con emit undefined → sin errores (POST legacy)             (REQ-009)
  ```

  **Estado esperado**: ROJO — flujo de sync no integra con SyncRunHelper todavía.

  **Dependencias**: ninguna (fase RED)
  **Líneas estimadas**: ~300
  **Comando de verificación**: `npx vitest run apps/backend/tests/sync-binance-complete.test.ts --project sync`
  **Aceptación**: falla porque el flujo actual no acepta emit/signal ni usa SyncRunHelper

---

## Work Unit 2: BinanceApiClient — métodos fiat + signal (fase GREEN parcial)

- [ ] **T04** — Implementar métodos fiat + signal en `binance-api.ts` — `apps/backend/src/sync/clients/binance-api.ts`

  **Qué modificar** (REQ-002, REQ-003):

  1. **`signed()` helper**: agregar `signal?: AbortSignal` como 4to parámetro, propagarlo a `fetch()`:
     ```typescript
     async function signed<T>(
       endpoint: string,
       params: Record<string, string | number> = {},
       silentCodes: number[] = [],
       signal?: AbortSignal,
     ): Promise<T> {
       // ... existing ...
       res = await fetch(`${BINANCE_BASE}${endpoint}?${qs.toString()}`, {
         headers: { 'X-MBX-APIKEY': apiKey },
         signal,
       });
     ```

  2. **`getValidTradingSymbols()`**: propagar signal a su `fetch()`.

  3. **Todos los métodos existentes**: agregar `signal?: AbortSignal` al final de su firma y pasarlo a `signed()`.

  4. **Nuevos tipos exportados**: `BinanceFiatOrder`, `BinanceFiatPayment`

  5. **Nuevo error**: `export class FiatPermissionDeniedError extends Error`
     - Lanzado cuando res.status ∈ {401, 403} o body.code ∈ {-1022, -2008, -2014, -2015, -1109}

  6. **Nuevos métodos**: `getFiatOrders()` y `getFiatPayments()` — llaman a `signed()` con detección de permisos

  7. **Interfaz `BinanceApiClient`**: agregar signal a métodos existentes + agregar los 2 nuevos

  **Dependencias**: T01-T02 (fase RED primero)
  **Líneas estimadas**: ~120
  **Comando de verificación**: `npx vitest run apps/backend/tests/binance-api-fiat.test.ts --project sync`
  **Aceptación**: T02 queda verde para los tests de client; T01 aún rojo (falta service)

---

## Work Unit 3: BinanceSyncService — refactorización core (fase GREEN)

- [ ] **T05** — Refactorizar constantes + helpers en `binance-sync.ts` — `apps/backend/src/services/binance-sync.ts`

  **Qué modificar** (REQ-001, REQ-004, REQ-005):

  1. Reemplazar `SYNC_START_MS` por `export const BINANCE_HISTORY_FLOOR_MS = new Date('2017-01-01T00:00:00.000Z').getTime()`
  2. Reemplazar `QUOTE_ASSETS = ['USDT', 'BTC', 'ETH', 'BNB']` por `export const QUOTE_ASSETS = ['USDT', 'USDC', 'BTC', 'ETH', 'BNB', 'FDUSD'] as const`
  3. Actualizar `STABLE_ASSETS` para incluir `FDUSD`, `TUSD`, `DAI`
  4. Agregar `isStablePair(base, quote)` helper
  5. Actualizar `getQuoteAsset()` — sufijo `FDUSD` primero (5 chars), luego los de 4 y 3
  6. Exportar `getQuoteAsset` y `isStablePair` para testing

  **Dependencias**: T04
  **Líneas estimadas**: ~30
  **Comando de verificación**: `npx vitest run apps/backend/tests/binance-api-fiat.test.ts -t "getQuoteAsset" --project sync`
  **Aceptación**: tests de getQuoteAsset y self-pair filter verdes

---

- [ ] **T06** — Refactorizar `persistBinanceTx` para no escribir positions inline — `apps/backend/src/services/binance-sync.ts`

  **Qué modificar** (REQ-010, D1, D2):

  1. Renombrar `persistBinanceTx` → `persistBinanceTxAtomic`
  2. Eliminar toda la lógica de SELECT position + processTransaction + UPSERT position
  3. Dejar solo: INSERT INTO transactions (..., sync_run_id) ON CONFLICT DO NOTHING
  4. Agregar `syncRunId: string` al tipo `PersistBinanceTxOpts`
  5. Agregar `cexOrderId?: string | null` al tipo `PersistBinanceTxOpts`
  6. Retornar `{ inserted: boolean; id: string }` (no más `id: string | null`)

  **Dependencias**: T05
  **Líneas estimadas**: ~80 (reducción neta — elimina ~100 líneas de position logic, agrega ~20)
  **Comando de verificación**: `npm run typecheck`
  **Aceptación**: compila sin errores; callers actualizados para pasar `syncRunId`

---

- [ ] **T07** — Implementar `syncFiat()` + integrar SyncRunHelper en `sync()` — `apps/backend/src/services/binance-sync.ts`

  **Qué modificar** (REQ-008, REQ-009, REQ-010):

  1. Agregar `SyncEmitter` type export
  2. Cambiar firma de `sync()` a `sync(walletId, userId, opts?: { emit?, signal? })`
  3. Implementar `syncFiat()` con ventanas de 90d, cursores, detección de FiatPermissionDeniedError
  4. Implementar `syncFiatEndpoint()` helper compartido para orders y payments
  5. Agregar `checkAborted(signal)` helper privado
  6. Integrar `SyncRunHelper` en `sync()`: start → try/catch → commitSuccess/rollback
  7. Integrar `PositionStateBuffer`: loadInitial, apply después de cada persist
  8. Refactorizar `discoverAssets()` para usar JOIN tokens ↔ transactions (sin getAccountAssets)
  9. Memoizar `getValidTradingSymbols()` en local var de `syncTrades()`
  10. Agregar filtro `isStablePair()` en generación de candidatos de trades
  11. Cambiar firmas de syncDeposits/syncWithdrawals/syncConvert/syncTrades para recibir `(walletId, runId, buffer, deferCursor, { emit, signal })`
  12. Reemplazar todas las refs a `SYNC_START_MS` por `BINANCE_HISTORY_FLOOR_MS`
  13. Cada paso emite eventos `{ step, status: 'running'/'done'/'skipped' }` cuando emit está definido
  14. Agregar `fiat: number` al return type de `sync()`

  **Dependencias**: T05, T06
  **Líneas estimadas**: ~350 (incluye syncFiat completo + refactorización de sync principal)
  **Comando de verificación**: `npx vitest run apps/backend/tests/sync-binance-fiat.test.ts --project sync && npx vitest run apps/backend/tests/sync-binance-complete.test.ts --project sync`
  **Aceptación**: T01 y T03 quedan verdes; sync funciona con y sin emit/signal

---

- [ ] **T08** — Agregar `getFiatToUsdAt()` en PriceService — `apps/backend/src/services/price.ts`

  **Qué modificar** (REQ-008):

  1. Agregar método `getFiatToUsdAt(fiatCurrency: string, timestampMs: number): Promise<string | null>`
  2. USD → return '1'
  3. Otra fiat → intentar Binance public ticker, fallback null
  4. Retorno null = caller persiste con `cost_source='MANUAL'`

  **Dependencias**: ninguna (puede correrse en paralelo)
  **Líneas estimadas**: ~25
  **Comando de verificación**: `npm run typecheck`
  **Aceptación**: compila; `syncFiat()` puede llamarlo

---

- [ ] **T09** — Actualizar `BinanceSyncResultSchema` — `apps/backend/src/schemas/sync.ts`

  **Qué modificar** (REQ-009):

  1. Agregar `fiat: z.number()` al `BinanceSyncResultSchema`

  **Dependencias**: T07
  **Líneas estimadas**: ~3
  **Comando de verificación**: `npm run typecheck`
  **Aceptación**: Zod schema incluye fiat; type inference actualizada

---

## Work Unit 4: Actualización de tests existentes

- [ ] **T10** — Adaptar tests existentes de BinanceSyncService — `apps/backend/src/services/binance-sync.test.ts`

  **Qué modificar**:

  1. Adaptar mocks de `BinanceApiClient` para incluir nuevos métodos fiat (stubs)
  2. Adaptar la firma de `sync()` para pasar opts vacío o undefined
  3. Adaptar asserts que dependían de `persistBinanceTx` escribiendo positions inline
  4. Verificar que tests existentes siguen pasando con el nuevo flujo

  **Dependencias**: T07
  **Líneas estimadas**: ~80
  **Comando de verificación**: `npx vitest run apps/backend/src/services/binance-sync.test.ts --project sync`
  **Aceptación**: tests existentes pasan sin regresiones funcionales

---

## Work Unit 5: Actualización de sync route

- [ ] **T11** — Actualizar route handler para nuevo return shape — `apps/backend/src/routes/sync.ts`

  **Qué modificar**:

  1. Si el handler usa `BinanceSyncResult`, ya refleja `fiat` por type inference
  2. Verificar que el POST handler sigue funcionando con la nueva firma de `sync()`
  3. No agregar SSE (eso es US-015)

  **Dependencias**: T07, T09
  **Líneas estimadas**: ~5
  **Comando de verificación**: `npm run typecheck`
  **Aceptación**: route compila y POST handler sigue funcionando

---

## Work Unit 6: Quality Gate

- [ ] **T12** — Quality gate final — (no crea ni modifica archivos)

  **Comandos en orden**:
  1. `npm run typecheck` — firmas, imports, tipos actualizados
  2. `npm run lint` — sin warnings en archivos modificados
  3. `npm run test:sync` — todos los tests de sync (nuevos + existentes)
  4. `npm run test:engine` — sin regresiones en position engine

  **Dependencias**: T01–T11 completadas
  **Líneas estimadas**: 0 (solo ejecución)
  **Aceptación**: los 4 comandos retornan exit 0; sin regresiones

---

## Resumen de Archivos

| ID | Archivo | Acción | REQs cubiertos |
|----|---------|--------|----------------|
| T01 | `apps/backend/tests/sync-binance-fiat.test.ts` | CREAR | REQ-008, REQ-010 |
| T02 | `apps/backend/tests/binance-api-fiat.test.ts` | CREAR | REQ-002, REQ-003, REQ-004, REQ-005 |
| T03 | `apps/backend/tests/sync-binance-complete.test.ts` | CREAR | REQ-001, REQ-006, REQ-007, REQ-009, REQ-010 |
| T04 | `apps/backend/src/sync/clients/binance-api.ts` | MODIFICAR | REQ-002, REQ-003 |
| T05 | `apps/backend/src/services/binance-sync.ts` | MODIFICAR | REQ-001, REQ-004, REQ-005 |
| T06 | `apps/backend/src/services/binance-sync.ts` | MODIFICAR | REQ-010 |
| T07 | `apps/backend/src/services/binance-sync.ts` | MODIFICAR | REQ-006, REQ-007, REQ-008, REQ-009, REQ-010 |
| T08 | `apps/backend/src/services/price.ts` | MODIFICAR | REQ-008 |
| T09 | `apps/backend/src/schemas/sync.ts` | MODIFICAR | REQ-009 |
| T10 | `apps/backend/src/services/binance-sync.test.ts` | MODIFICAR | (regresión) |
| T11 | `apps/backend/src/routes/sync.ts` | MODIFICAR | REQ-009 |
| T12 | — (quality gate) | EJECUTAR | ALL |

**Sin cambios** (por diseño):
- `apps/backend/src/position-engine/*` — ya soporta FIAT_IN/FIAT_OUT (US-013)
- `apps/backend/src/services/sync-run-helper.ts` — se usa as-is (US-018)
- `apps/backend/src/services/position-state-buffer.ts` — se usa as-is (US-018)
- `db/migrations/*` — sin migraciones
- `db/enums.ts` / `db/enums.test.ts` — ya tiene FIAT_IN/FIAT_OUT
- Frontend — fuera de scope

---

## Review Workload Forecast

| Métrica | Estimado |
|---------|----------|
| Total estimado líneas cambiadas | ~1420 |
| Archivos tocados | 6 + 3 tests nuevos |
| Chained PRs recommended | No (un solo PR, pero T01-T03 pueden ser un commit RED separado) |
| 400-line budget risk | High — el core está en T07 (~350 líneas) |
| Decision needed before apply | Verificar que `tokens` JOIN `transactions` para discoverAssets es correcto (confirmado: tokens no tiene wallet_id) |

> **Desglose de líneas**: T01 ~250 · T02 ~180 · T03 ~300 · T04 ~120 · T05 ~30 · T06 ~80 · T07 ~350 · T08 ~25 · T09 ~3 · T10 ~80 · T11 ~5
>
> El riesgo principal está en T06+T07 que refactorizan `persistBinanceTx` y el flujo principal de `sync()`.
> La eliminación de la lógica inline de positions es el delta más impactante porque cambia
> la semántica de persistencia de "write-through" a "write-back" (deferred via buffer).
> Mitigación: T03 valida el flujo completo end-to-end; T10 valida regresiones.
