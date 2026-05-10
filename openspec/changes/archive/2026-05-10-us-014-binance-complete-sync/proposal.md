# Proposal: US-014 — Backend: Binance sync con historia completa, fiat y cobertura de pares ampliada

## Intent

Hoy `BinanceSyncService` sigue en un estado intermedio: usa `SYNC_START_MS = 2025-12-01`, sólo reconoce `QUOTE_ASSETS = ['USDT','BTC','ETH','BNB']`, no incorpora endpoints fiat, corre en orden `convert→deposits→withdrawals→trades`, descubre assets mezclando balance+tokens y todavía no expone `(emit?: SyncEmitter, signal?: AbortSignal)`. En paralelo, `BinanceApiClient` ya cubre trades, converts, depósitos y retiros, pero no propaga `AbortSignal` ni ofrece `getFiatOrders()` / `getFiatPayments()`.

US-014 completa esa deuda técnica sin tocar schema: reemplaza `SYNC_START_MS` por `BINANCE_HISTORY_FLOOR_MS = new Date('2017-01-01')`, agrega `syncFiat()` antes de depósitos, amplía la cobertura de pares, y monta todo sobre `SyncRunHelper` + `PositionStateBuffer` de US-018. El objetivo es tener una sync CEX históricamente completa, atómica por run y consistente con la semántica contable definida en `RD-001`, `RD-002`, `RD-005`, `RD-006`, `RD-007`, `RD-008`, `RD-009`, `RD-010` y `RD-011`.

## Scope

### In scope

| Acción | Archivo / componente | Detalle |
|--------|----------------------|---------|
| Modificar | `apps/backend/src/services/binance-sync.ts` | Reemplazar `SYNC_START_MS` por `BINANCE_HISTORY_FLOOR_MS = new Date('2017-01-01')` y usar ese piso para historia completa. |
| Modificar | `apps/backend/src/services/binance-sync.ts` | Agregar `syncFiat()` antes de depósitos, usando `getFiatOrders()` (`/sapi/v1/fiat/orders`) y `getFiatPayments()` (`/sapi/v1/fiat/payments`). |
| Modificar | `apps/backend/src/services/binance-sync.ts` | Persistir eventos fiat como `FIAT_IN` / `FIAT_OUT` con `cex_order_id`, usando el `price` del payload y `priceService.getFiatToUsdAt()` para fiat no-USD. |
| Modificar | `apps/backend/src/services/binance-sync.ts` | Agregar cursores `fiat:orders` y `fiat:payments`; tratar `401/403` o permission codes como `skipped/PERMISSION_DENIED` y continuar. |
| Modificar | `apps/backend/src/services/binance-sync.ts` | Reordenar el pipeline a `fiat→deposits→withdrawals→converts→trades`. |
| Modificar | `apps/backend/src/services/binance-sync.ts` | Hacer que todos los métodos acepten `(emit?: SyncEmitter, signal?: AbortSignal)` y chequeen `signal.aborted` antes de cada batch. |
| Modificar | `apps/backend/src/services/binance-sync.ts` | Abrir `sync_run` al inicio, persistir `transactions.sync_run_id` y diferir positions+cursors hasta `commitSuccess()` vía `SyncRunHelper` / `PositionStateBuffer` de US-018. |
| Modificar | `apps/backend/src/services/binance-sync.ts` | Cambiar `discoverAssets()` a `SELECT DISTINCT symbol FROM tokens WHERE wallet_id=$1 AND network='CEX_BINANCE'`. |
| Modificar | `apps/backend/src/sync/clients/binance-api.ts` | Exponer `getFiatOrders()` y `getFiatPayments()`, y propagar `AbortSignal` a llamadas HTTP existentes y nuevas. |
| Modificar | `apps/backend/src/services/binance-sync.ts` | Expandir `QUOTE_ASSETS` a `['USDT','USDC','BTC','ETH','BNB','FDUSD']`, ajustar `getQuoteAsset()` para reconocer `USDC` y `FDUSD` antes del fallback de 3 caracteres, memoizar `getValidTradingSymbols()` una vez por run y filtrar self-pairs (`base===quote` o stable/stable). |

### Out of scope

| Exclusión | Motivo |
|-----------|--------|
| Cambios de schema o migraciones nuevas | US-013 ya incorporó `FIAT_IN` / `FIAT_OUT` + `cex_order_id`, y US-018 ya dejó listo `sync_runs`; esta historia es migration-free. |
| Cambios al position engine | El engine ya soporta `FIAT_IN` / `FIAT_OUT`; acá sólo se integra mejor la ingestión Binance. |
| Cambios de frontend o UX | La historia cubre backend/sync; cualquier visualización nueva queda fuera de Phase 1. |
| Cambios en sync on-chain | Este trabajo no toca `OnChainSyncService`; sólo preserva compatibilidad con el bridge CEX↔on-chain ya definido. |

## Approach

1. Reemplazar `SYNC_START_MS` por `BINANCE_HISTORY_FLOOR_MS = new Date('2017-01-01')` para que la primera sync pueda reconstruir historia completa desde un piso estable y explícito.
2. Extender `BinanceApiClient` con `getFiatOrders()` y `getFiatPayments()`, manteniendo propagación de `AbortSignal` en endpoints existentes (`myTrades`, `convertHistory`, `withdrawHistory`, `depositHistory`) y nuevos.
3. Incorporar `syncFiat()` en `BinanceSyncService` y ejecutarlo antes de depósitos, persistiendo `FIAT_IN` / `FIAT_OUT` con `cex_order_id`; si el fiat viene en moneda no-USD, resolver `priceUsd` con `priceService.getFiatToUsdAt()` sin pasar por `cost-resolver.ts`.
4. Crear/actualizar cursores `fiat:orders` y `fiat:payments`; cuando Binance responda `401/403` o permission codes equivalentes, devolver `skipped/PERMISSION_DENIED`, dejar trazabilidad y seguir con el resto del run.
5. Reordenar el pipeline a `fiat→deposits→withdrawals→converts→trades` para que el ledger capture primero fondos fiat y bridges CEX, y después operaciones que dependen de ese contexto.
6. Integrar `SyncRunHelper`: abrir `sync_run` al inicio, grabar `sync_run_id` en cada tx, mantener positions+cursors en `PositionStateBuffer` y recién materializarlos en `commitSuccess()`; si algo falla, el rollback queda delegado a `CASCADE` de US-018.
7. Cambiar `discoverAssets()` a `SELECT DISTINCT symbol FROM tokens WHERE wallet_id=$1 AND network='CEX_BINANCE'`, memoizar `getValidTradingSymbols()` una vez por run y ampliar `QUOTE_ASSETS` a `['USDT','USDC','BTC','ETH','BNB','FDUSD']`.
8. Ajustar `getQuoteAsset()` para reconocer `USDC` y `FDUSD` antes del fallback de 3 caracteres, y filtrar self-pairs donde `base===quote` o ambos lados sean stables.
9. Hacer que todos los métodos de sync acepten `(emit?: SyncEmitter, signal?: AbortSignal)` y chequeen `signal.aborted` antes de cada batch para soportar cancelación cooperativa y progreso incremental.

## Architecture decisions

- **Historia completa con piso fijo**: `BINANCE_HISTORY_FLOOR_MS = new Date('2017-01-01')` reemplaza una ventana artificial y deja claro desde dónde arranca la reconstrucción histórica.
- **Fiat primero en el pipeline**: correr `syncFiat()` antes de depósitos y retiros mejora coherencia contable y deja alineado el ledger con la trazabilidad esperada por `RD-001`, `RD-002` y `RD-005`.
- **Precio fiat fuera de `cost-resolver.ts`**: órdenes/pagos fiat ya traen el precio base; sólo hace falta convertir a USD cuando la moneda no es USD. Eso evita mezclar lógica de transfer-cost con un flujo que ya nace valuado.
- **Atomicidad por run obligatoria**: US-018 ya resolvió `sync_runs`, rollback por `CASCADE` y escritura diferida de positions/cursors; US-014 se monta arriba de eso en vez de reintroducir persistencia parcial.
- **Discovery de símbolos desde `tokens`**: `discoverAssets()` debe depender de `tokens` CEX persistidos, no de balances efímeros, para que la reconstrucción histórica sea reproducible y no quede sesgada por el snapshot actual.
- **Cobertura de pares ampliada pero defensiva**: agregar `USDC` y `FDUSD` amplía cobertura real; reconocerlos antes del fallback de 3 caracteres evita parseos incorrectos, y filtrar stable/stable o `base===quote` reduce ruido operativo.
- **Memoización por run**: `getValidTradingSymbols()` se calcula una sola vez por run para bajar presión sobre rate limits en el barrido inicial de 8+ años.
- **Identidad fiat por `cex_order_id`**: órdenes y payments fiat deben persistirse con `cex_order_id` y no con `cex_trade_id`, para respetar el formato UUID/externo definido por `RD-006`.
- **Permisos parciales no rompen completitud**: si Binance no habilita endpoints fiat, el resultado debe ser `skipped/PERMISSION_DENIED` y no un abort global; eso sigue `RD-002` y convive con cursores huérfanos aceptables según `RD-008`.
- **Cancelación cooperativa y progreso uniforme**: `(emit?: SyncEmitter, signal?: AbortSignal)` en todos los métodos sigue el callback pattern de `RD-009`, evita APIs partidas entre pasos viejos y nuevos, y deja lista la integración con POST+SSE/shared lock descrita en `RD-010`.
- **Compatibilidad con identidad CEX y bridges**: la sync sigue respetando que `CEX_BINANCE` es una fuente separada y que retiros Binance pueden puentear costo hacia on-chain, coherente con `RD-007` y con la memoización por run exigida por `RD-011`. 

## Dependencies

- **US-013 (done)**: dejó listos `FIAT_IN` / `FIAT_OUT` y `cex_order_id`, que son prerequisito directo para persistir historia fiat sin workarounds.
- **US-018 (done)**: ya incorporó `sync_runs`, rollback por `CASCADE` y `PositionStateBuffer`, necesarios para que la sync Binance sea atómica por run.

## Risks

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Rate limits al escanear 8+ años de historia | Primera sync lenta, retries o throttling | Piso fijo + cursores por operación + memoización de `getValidTradingSymbols()` para no rediscover symbols en cada batch |
| Gaps de permisos en APIs fiat | Run parcial sin `FIAT_IN` / `FIAT_OUT` | Tratar `401/403` y permission codes como `skipped/PERMISSION_DENIED`, dejando trazabilidad sin abortar el resto |
| Delistings o soporte irregular de `FDUSD` | Pairs inválidos o discovery incompleto | Reconocimiento explícito en `getQuoteAsset()`, filtro stable/stable y tolerancia a símbolos no disponibles |
| Fallas al convertir fiat no-USD a USD | Eventos fiat con `priceUsd` nulo | Usar `price` del payload, consultar `priceService.getFiatToUsdAt()` y marcar fallback/error cuando no exista tasa histórica |

## Rollback plan

El rollback es **migration-free**. Si la implementación sale mal, alcanza con revertir `apps/backend/src/services/binance-sync.ts` y `apps/backend/src/sync/clients/binance-api.ts`, removiendo `BINANCE_HISTORY_FLOOR_MS`, `syncFiat()`, los cursores fiat, la expansión de `QUOTE_ASSETS`, la propagación de `AbortSignal`, el nuevo orden de pasos y la integración con `SyncRunHelper`. No hay schema changes para deshacer.