# Spec — US-012 Settings UI

## Requirements

### REQ-1: Backend — Nuevos endpoints y fixes

#### REQ-1.1: GET /api/credentials — presencia de API keys

Endpoint que retorna si cada API key está configurada en `process.env`. Nunca retorna el valor de la key.

- Ruta: `GET /api/credentials`
- Auth: requerida (cookie JWT)
- Response 200:
  ```ts
  {
    ETHERSCAN_API_KEY: boolean,
    BSCTRACE_API_KEY: boolean,
    BINANCE_API_KEY: boolean,
    BINANCE_SECRET_KEY: boolean
  }
  ```
- Implementación: leer `env.ETHERSCAN_API_KEY` etc. desde `env.ts`; convertir a booleano con `Boolean(value?.trim())`.
- El body NO puede contener strings que parezcan API keys (regex `^[A-Z0-9]{20,}`). Validado por test.
- Schema Zod 4:
  ```ts
  z.object({
    ETHERSCAN_API_KEY: z.boolean(),
    BSCTRACE_API_KEY: z.boolean(),
    BINANCE_API_KEY: z.boolean(),
    BINANCE_SECRET_KEY: z.boolean(),
  })
  ```

#### REQ-1.2: POST /api/credentials/test/:service — test de conectividad

Endpoint que verifica conectividad real con el servicio externo usando las keys del entorno.

- Ruta: `POST /api/credentials/test/:service`
- Param `:service` ∈ `{ etherscan | bsctrace | binance }` — validado con Zod enum; 400 si inválido.
- Auth: requerida (cookie JWT)
- Response shape uniforme:
  ```ts
  | { status: 'connected'; meta?: { assetCount?: number; latencyMs?: number } }
  | { status: 'failed'; reason: string }
  ```
- Timeout backend: 8s sobre cada llamada a servicio externo.
- Implementación via `CredentialTestService` con métodos `testEtherscan()`, `testBsctrace()`, `testBinance()`.
- Si la key no está en env: responder `{ status: 'failed', reason: 'API key not configured' }` sin hacer llamada externa.

**testEtherscan():**
- Llamar `GET https://api.etherscan.io/api?module=stats&action=ethsupply&apikey={ETHERSCAN_API_KEY}`
- Si `result.status === '1'` → `{ status: 'connected' }`
- Si `result.status === '0'` y message contiene "Invalid" → `{ status: 'failed', reason: 'Invalid API key' }`
- Si `result.status === '0'` y otro motivo → `{ status: 'failed', reason: result.message }`

**testBsctrace():**
- Llamar `GET https://api.bscscan.com/api?module=stats&action=bnbsupply&apikey={BSCTRACE_API_KEY}`
- Misma lógica de parsing que Etherscan.

**testBinance():**
- Llamar `GET /api/v3/account` firmado con HMAC-SHA256 usando `BINANCE_API_KEY` + `BINANCE_SECRET_KEY`.
- Si HTTP 200 → `{ status: 'connected', meta: { assetCount: account.balances.length } }`
- Si Binance code `-2014` (invalid key format) → `{ status: 'failed', reason: 'Invalid API key' }`
- Si Binance code `-2015` (invalid signature) → `{ status: 'failed', reason: 'Invalid API key' }`
- Si Binance code `-1002` o sin permiso read → `{ status: 'failed', reason: 'API key requires read permissions' }`
- Cualquier otro error → `{ status: 'failed', reason: 'Connection failed: [http status]' }`

#### REQ-1.3: GET /api/transactions/pending-price — TRANSFER_IN sin precio

Endpoint que lista transacciones `TRANSFER_IN` con `cost_source = 'MANUAL'` y `price_usd IS NULL`.

- Ruta: `GET /api/transactions/pending-price`
- Auth: requerida (cookie JWT)
- Response 200:
  ```ts
  {
    transactions: PendingTransfer[],
    count: number
  }
  ```
- `PendingTransfer`:
  ```ts
  {
    id: string,
    wallet_id: string,
    token_id: string,
    tx_hash: string | null,
    amount: string,
    type: 'TRANSFER_IN',
    created_at: string
  }
  ```
- Query: `SELECT ... FROM transactions WHERE type = 'TRANSFER_IN' AND cost_source = 'MANUAL' AND price_usd IS NULL LIMIT 100`
- `count`: total de filas que cumplen el filtro (sin el LIMIT) — query separada `SELECT COUNT(*)`.
- Schema Zod 4:
  ```ts
  const PendingTransferSchema = z.object({
    id: z.string().min(1),
    wallet_id: z.string().min(1),
    token_id: z.string().min(1),
    tx_hash: z.string().nullable(),
    amount: z.string().min(1),
    type: z.literal('TRANSFER_IN'),
    created_at: z.string().min(1),
  });
  z.object({ transactions: z.array(PendingTransferSchema), count: z.number().int().nonnegative() })
  ```

#### REQ-1.4: GET /api/portfolio/validate-snapshot — validación vs Binance

Endpoint que compara los balances calculados por el motor contra el snapshot diario de Binance.

- Ruta: `GET /api/portfolio/validate-snapshot`
- Auth: requerida (cookie JWT)
- Llamada a Binance: `GET /sapi/v1/accountSnapshot?type=SPOT` firmado con HMAC-SHA256.
- Timeout: 30s (endpoint Binance es lento).
- Si `BINANCE_API_KEY` o `BINANCE_SECRET_KEY` no están en env → 400 `{ error: 'Binance API keys not configured' }`.
- Si no existe wallet `CEX_BINANCE` → 400 `{ error: 'No Binance wallet configured' }`.
- Response 200:
  ```ts
  {
    differences: DifferenceRow[],
    snapshotDate: string,
    dustNote: string
  }
  ```
- `DifferenceRow`:
  ```ts
  {
    symbol: string,
    engineBalance: string,
    snapshotBalance: string,
    diff: string
  }
  ```
- `dustNote` fijo: `"Small differences are expected due to Binance dust conversion (non-goal in V1)."`
- Cache backend: 60s por wallet CEX — no volver a llamar a Binance si la respuesta es fresca.
- Solo incluir en `differences` las filas donde `Math.abs(diff) > 0.00001` (evitar ruido de punto flotante).

#### REQ-1.5: Fix BinanceSyncService.sync() — actualizar wallets.last_synced_at

Bug fix: `BinanceSyncService.sync()` actualmente no actualiza `wallets.last_synced_at` al terminar.

- Archivo: `apps/backend/src/services/binance-sync.ts`
- Al finalizar el sync exitosamente (después del bloque de deposits), ejecutar:
  ```sql
  UPDATE wallets SET last_synced_at = now() WHERE id = $1
  ```
- Si esta query falla: capturar con `try/catch`, loguear el error con `logger.error(...)`, pero **no propagar** (el sync ya commiteó; perder `last_synced_at` no revierte el trabajo).
- El sync existente de ON_CHAIN (`OnChainSyncService`) ya actualiza `last_synced_at` correctamente — este fix hace paridad.

---

### REQ-2: Frontend — SettingsPage y secciones

#### REQ-2.1: Ruta /settings en el router

- Archivo: `apps/frontend/src/routes/router.tsx`
- Añadir ruta `/settings` protegida con `<ProtectedRoute>` que carga `<SettingsPage>`.
- `AppLayout` debe incluir un link de navegación a `/settings` en el menú principal.

#### REQ-2.2: PendingPriceBanner — banner global arriba

- Componente: `apps/frontend/src/components/settings/PendingPriceBanner.tsx`
- Hook: `apps/frontend/src/hooks/settings/usePendingPriceTransfers.ts`
- Solo visible si `count > 0`.
- Muestra: `"⚠ {count} TRANSFER_IN pending manual price — Review transactions"` con CTA que navega a la transacción (o lista de pendientes).
- El banner siempre aparece en la parte superior de `SettingsPage`, antes de cualquier sección.
- Tras un Sync exitoso de cualquier wallet, se invalida este hook (re-fetch).
- Loading del hook: no mostrar banner (no placeholder) — el banner aparece solo cuando hay datos positivos.

#### REQ-2.3: OnChainWalletsSection

- Componente: `apps/frontend/src/components/settings/OnChainWalletsSection.tsx`
- Hook: `apps/frontend/src/hooks/settings/useWallets.ts` con filtro `wallet_type = 'ON_CHAIN'`.
- Por cada wallet mostrar:
  - Address truncada: primeros 6 chars + "…" + últimos 4 chars. Ej: `0x1234…abcd`.
  - Botón copy que copia la address completa al clipboard. Estado visual: "Copied!" por 2s.
  - Alias (`label`).
  - Badge `network` (ETH / BSC) usando `NetworkBadge`.
  - Badge `storage_type` — si aplica (campo `wallet_type` = `ON_CHAIN`).
  - Botón "Sync".
- Hook: `apps/frontend/src/hooks/settings/useSyncWallet.ts` — estado per-wallet `Record<walletId, SyncState>`.
  - `SyncState`: `{ status: 'idle' | 'syncing' | 'success' | 'error'; result?: SyncResult; error?: string; syncedAt?: Date }`
- Mientras sync: botón muestra "Syncing…" y está deshabilitado.
- Al éxito: resultado inline debajo de la wallet: `"Synced {synced} txs | {skipped} skipped | {swapsDecomposed} swaps"`.
- `last_synced_at` reactivo usando `useRelativeTime(wallet.last_synced_at)` → "Last synced: Xs ago" / "Last synced: just now" / "Never synced".
- Tras sync exitoso: refetch de `useWallets` + refetch de `usePendingPriceTransfers`.
- Error de sync: mostrar mensaje inline en rojo, no toast.

#### REQ-2.4: ExchangeAccountsSection

- Componente: `apps/frontend/src/components/settings/ExchangeAccountsSection.tsx`
- Hook: `apps/frontend/src/hooks/settings/useWallets.ts` con filtro `wallet_type = 'CEX'`.
- Estado de la cuenta Binance:
  - Si existe wallet CEX_BINANCE → mostrar "Connected" badge en verde.
  - Si no existe → mostrar "Not configured" badge en gris con instrucción para crear.
- Mostrar `last_synced_at` con `useRelativeTime` → "Last synced: Xs ago" / "Never synced".
- Botón "Sync" (deshabilitado si no hay wallet CEX_BINANCE o BINANCE_API_KEY/SECRET no configuradas).
- Resultado detallado tras sync: `"{trades.synced} trades | {converts.synced} converts | {withdrawals.synced} withdrawals | {deposits.synced} deposits"`.
- Tras sync exitoso: refetch de `useWallets` + refetch de `usePendingPriceTransfers`.

#### REQ-2.5: TokensSection

- Componente: `apps/frontend/src/components/settings/TokensSection.tsx`
- Sub-componente: `apps/frontend/src/components/settings/TokenRow.tsx`
- Hook: `apps/frontend/src/hooks/settings/useTokens.ts` — incluye `updateToken(id, patch)`.
- Lista todos los tokens (incluidos `is_hidden = true`, es la página de administración).
- Por cada token (`TokenRow`):
  - Nombre + symbol.
  - Badge de fuente (`SourceBadge`): `ETH` → `ETHERSCAN`, `BSC` → `BSCTRACE`, `CEX_BINANCE` → `BINANCE`.
  - Toggle `is_hidden`: PUT inmediato al toggle. Optimistic: aplicar localmente, revertir + toast de error si falla.
  - `target_exit_price`: input numérico inline. Flujo (D6):
    1. Usuario edita → estado draft local.
    2. Si draft ≠ valor server → aparecen botones "Save" y "Cancel" inline.
    3. Click "Save" → `PUT /api/tokens/:id { target_exit_price }` → éxito: actualizar valor original, ocultar botones; error: mantener draft + toast.
    4. Click "Cancel" → descartar draft, volver al valor server.
    5. Blur sin Save: botones permanecen visibles (no se guarda automáticamente).
  - `target_exit_price` acepta `null` (limpiar el target) — enviar `null` si el campo queda vacío.
  - Estado de loading per-row para el botón Save: deshabilitado mientras la request está en vuelo.

#### REQ-2.6: ApiKeysSection

- Componente: `apps/frontend/src/components/settings/ApiKeysSection.tsx`
- Hook: `apps/frontend/src/hooks/settings/useApiKeysStatus.ts` — consume `GET /api/credentials`.
- Hook: `apps/frontend/src/hooks/settings/useTestApiKey.ts` — consume `POST /api/credentials/test/:service`.
- Por cada key (`ETHERSCAN_API_KEY`, `BSCTRACE_API_KEY`, `BINANCE_API_KEY`, `BINANCE_SECRET_KEY`):
  - Label: el nombre exacto de la variable de entorno.
  - Input `type=password` **read-only**.
  - Placeholder: `"Configured in .env"` si `boolean === true`, `"Not configured"` si `boolean === false`.
  - Botón "Test" habilitado solo si la key está configurada (`boolean === true`). Para `BINANCE_SECRET_KEY` el botón aparece agrupado con `BINANCE_API_KEY` bajo la misma acción "Test Binance".
  - Mientras test: botón muestra "Testing…" y está deshabilitado.
  - Resultado del test (inline, bajo el input):
    - Etherscan/BSCTrace: `"Connected"` (verde) o `"Failed: {reason}"` (rojo).
    - Binance: `"Connected: {assetCount} assets"` (verde) o `"Failed: {reason}"` (rojo).
- Timeout frontend: `AbortController` con 10s — si el backend tarda más, mostrar `"Failed: Request timed out"`.
- Los resultados de test son por-service y no afectan otras secciones.

#### REQ-2.7: BalanceValidationSection — colapsada, lazy

- Componente: `apps/frontend/src/components/settings/BalanceValidationSection.tsx`
- Hook: `apps/frontend/src/hooks/settings/useBalanceValidation.ts` — lazy (sólo se dispara con trigger explícito).
- Sección **colapsada por defecto** (estado inicial `collapsed: true`). El usuario expande para ver el botón.
- Botón "Validate vs Binance Snapshot":
  - Deshabilitado si no hay wallet `CEX_BINANCE` → tooltip: `"Configure a Binance wallet to enable"`.
  - Deshabilitado si `BINANCE_API_KEY` o `BINANCE_SECRET_KEY` son `false` → tooltip: `"Configure Binance API keys in .env to enable"`.
  - Cooldown de 60s tras click exitoso — botón deshabilitado con contador regresivo visible.
- Estados: `idle | loading | success | error`.
- En `loading`: spinner prominente (no bloquea el resto de la página).
- En `success`: tabla de diferencias con columnas `Symbol | Engine Balance | Snapshot Balance | Diff`. Nota fija abajo: `"Small differences are expected due to Binance dust conversion (non-goal in V1)."`.
- En `error`: mensaje de error inline con botón "Retry".

---

## Scenarios

### Backend — REQ-1.1: GET /api/credentials

**SCENARIO: Retorna presencia correcta cuando keys están configuradas**

```
Given ETHERSCAN_API_KEY='abc123' y BINANCE_API_KEY='xyz789' están en process.env
And BSCTRACE_API_KEY y BINANCE_SECRET_KEY NO están en process.env (undefined o vacío)
When GET /api/credentials con JWT válido
Then 200 { ETHERSCAN_API_KEY: true, BSCTRACE_API_KEY: false, BINANCE_API_KEY: true, BINANCE_SECRET_KEY: false }
```

**SCENARIO: Retorna false para keys vacías (string vacío)**

```
Given ETHERSCAN_API_KEY='' (string vacío) en process.env
When GET /api/credentials con JWT válido
Then 200 { ETHERSCAN_API_KEY: false, ... }
```

**SCENARIO: El body no contiene valores de las keys**

```
Given cualquier combinación de keys en process.env
When GET /api/credentials con JWT válido
Then el body 200 no contiene ningún string que coincida con /^[A-Z0-9]{20,}/
And el body solo contiene valores booleanos
```

**SCENARIO NEGATIVE: Sin autenticación**

```
Given no hay cookie JWT
When GET /api/credentials
Then 401
```

---

### Backend — REQ-1.2: POST /api/credentials/test/:service

**SCENARIO: Test Etherscan — key válida**

```
Given ETHERSCAN_API_KEY está configurada y es válida
And Etherscan retorna { status: '1', message: 'OK', result: '...' }
When POST /api/credentials/test/etherscan con JWT válido
Then 200 { status: 'connected' }
```

**SCENARIO: Test Etherscan — key inválida**

```
Given ETHERSCAN_API_KEY está configurada pero es inválida
And Etherscan retorna { status: '0', message: 'Invalid API Key' }
When POST /api/credentials/test/etherscan con JWT válido
Then 200 { status: 'failed', reason: 'Invalid API key' }
```

**SCENARIO: Test BSCTrace — key válida**

```
Given BSCTRACE_API_KEY está configurada y es válida
And BSCScan retorna { status: '1', message: 'OK', result: '...' }
When POST /api/credentials/test/bsctrace con JWT válido
Then 200 { status: 'connected' }
```

**SCENARIO: Test Binance — keys válidas con permiso read**

```
Given BINANCE_API_KEY y BINANCE_SECRET_KEY están configuradas y son válidas
And Binance /api/v3/account retorna HTTP 200 con balances[].length = 42
When POST /api/credentials/test/binance con JWT válido
Then 200 { status: 'connected', meta: { assetCount: 42 } }
```

**SCENARIO NEGATIVE: Test Binance — key inválida (error -2014)**

```
Given BINANCE_API_KEY tiene formato inválido
And Binance retorna HTTP 401 con { code: -2014, msg: 'API-key format invalid.' }
When POST /api/credentials/test/binance con JWT válido
Then 200 { status: 'failed', reason: 'Invalid API key' }
```

**SCENARIO NEGATIVE: Test Binance — key sin permiso read (error -1002)**

```
Given BINANCE_API_KEY existe pero fue creada sin permiso de lectura
And Binance retorna HTTP 403 con { code: -1002, msg: 'You are not authorized...' }
When POST /api/credentials/test/binance con JWT válido
Then 200 { status: 'failed', reason: 'API key requires read permissions' }
```

**SCENARIO NEGATIVE: Key no configurada en env**

```
Given ETHERSCAN_API_KEY no está en process.env
When POST /api/credentials/test/etherscan con JWT válido
Then 200 { status: 'failed', reason: 'API key not configured' }
And NO se realiza ninguna llamada HTTP a Etherscan
```

**SCENARIO NEGATIVE: Servicio inválido**

```
When POST /api/credentials/test/invalid-service con JWT válido
Then 400 { error: 'Invalid service. Must be one of: etherscan, bsctrace, binance' }
```

**SCENARIO NEGATIVE: Timeout del servicio externo**

```
Given el servicio externo tarda más de 8s en responder
When POST /api/credentials/test/etherscan con JWT válido
Then 200 { status: 'failed', reason: 'Connection timed out' }
And la request se completa en ≤ 9s (no cuelga)
```

---

### Backend — REQ-1.3: GET /api/transactions/pending-price

**SCENARIO: Retorna TRANSFER_IN sin precio**

```
Given existen 3 transacciones con type='TRANSFER_IN', cost_source='MANUAL', price_usd=null
And existen 5 transacciones TRANSFER_IN con price_usd != null (resueltas)
And existen 2 transacciones BUY (tipo distinto)
When GET /api/transactions/pending-price con JWT válido
Then 200 { transactions: [3 items], count: 3 }
And cada item tiene type: 'TRANSFER_IN'
And ningún item tiene price_usd en el body
```

**SCENARIO: Retorna vacío si no hay pendientes**

```
Given no existen transacciones con type='TRANSFER_IN' y price_usd IS NULL
When GET /api/transactions/pending-price con JWT válido
Then 200 { transactions: [], count: 0 }
```

**SCENARIO: LIMIT 100 con count total correcto**

```
Given existen 150 transacciones TRANSFER_IN pendientes
When GET /api/transactions/pending-price con JWT válido
Then 200 { transactions: [100 items], count: 150 }
And transactions.length === 100
And count === 150
```

**SCENARIO NEGATIVE: Sin autenticación**

```
Given no hay cookie JWT
When GET /api/transactions/pending-price
Then 401
```

---

### Backend — REQ-1.4: GET /api/portfolio/validate-snapshot

**SCENARIO: Retorna diferencias entre motor y snapshot**

```
Given wallet CEX_BINANCE configurada
And BINANCE_API_KEY y BINANCE_SECRET_KEY en env
And motor tiene ETH=1.5, BTC=0.01
And Binance snapshot tiene ETH=1.4999, BTC=0.0099
When GET /api/portfolio/validate-snapshot con JWT válido
Then 200 {
  differences: [
    { symbol: 'ETH', engineBalance: '1.5', snapshotBalance: '1.4999', diff: '0.0001' },
    { symbol: 'BTC', engineBalance: '0.01', snapshotBalance: '0.0099', diff: '0.0001' }
  ],
  snapshotDate: '<fecha>',
  dustNote: 'Small differences are expected due to Binance dust conversion (non-goal in V1).'
}
```

**SCENARIO: Diferencias menores a threshold de ruido son excluidas**

```
Given la diferencia para un token es 0.000000001 (ruido de floating point)
When GET /api/portfolio/validate-snapshot con JWT válido
Then ese token NO aparece en differences
```

**SCENARIO NEGATIVE: Sin wallet CEX_BINANCE**

```
Given no existe ninguna wallet con network='CEX_BINANCE'
When GET /api/portfolio/validate-snapshot con JWT válido
Then 400 { error: 'No Binance wallet configured' }
```

**SCENARIO NEGATIVE: Keys Binance no configuradas**

```
Given BINANCE_API_KEY no está en env
When GET /api/portfolio/validate-snapshot con JWT válido
Then 400 { error: 'Binance API keys not configured' }
```

---

### Backend — REQ-1.5: Fix BinanceSyncService.sync()

**SCENARIO: last_synced_at se actualiza tras sync exitoso**

```
Given wallet CEX_BINANCE con last_synced_at = null (nunca sincronizada)
When BinanceSyncService.sync(walletId) completa sin error
Then wallets.last_synced_at para esa wallet es un timestamp reciente (≤ 5s desde now())
```

**SCENARIO: Error en UPDATE no propaga ni revierte el sync**

```
Given el sync de trades/converts/withdrawals/deposits completó exitosamente
And la query UPDATE wallets SET last_synced_at = now() falla (ej. timeout)
When BinanceSyncService.sync(walletId) termina
Then el resultado del sync es exitoso (trades/converts sincronizados no se revierten)
And el error del UPDATE queda registrado en los logs
And la función no lanza excepción
```

---

### Frontend — REQ-2.2: PendingPriceBanner

**SCENARIO: Banner visible si hay pendientes**

```
Given GET /api/transactions/pending-price retorna { count: 3, transactions: [...] }
When SettingsPage monta
Then PendingPriceBanner es visible con texto "3 TRANSFER_IN pending manual price"
And hay un enlace/botón CTA clickeable
```

**SCENARIO: Banner no visible si no hay pendientes**

```
Given GET /api/transactions/pending-price retorna { count: 0, transactions: [] }
When SettingsPage monta
Then PendingPriceBanner no está en el DOM
```

**SCENARIO: Banner se actualiza tras sync exitoso**

```
Given PendingPriceBanner muestra count: 2
When usuario hace Sync de una wallet (POST /api/sync/:walletId retorna éxito)
Then usePendingPriceTransfers hace re-fetch
And si el nuevo count es 0, el banner desaparece
```

---

### Frontend — REQ-2.3: OnChainWalletsSection

**SCENARIO: On-Chain Wallet — address truncada y copy**

```
Given wallet con address '0x1234567890abcdef1234567890abcdef12345678'
When OnChainWalletsSection renderiza
Then muestra '0x1234…5678'
When usuario hace click en botón "Copy"
Then clipboard contiene '0x1234567890abcdef1234567890abcdef12345678'
And el botón muestra "Copied!" por 2 segundos
And después de 2s vuelve al texto original
```

**SCENARIO: On-Chain Wallet — sync exitoso**

```
Given POST /api/sync/:walletId retorna { synced: 5, skipped: 2, swapsDecomposed: 1, ... }
When usuario hace click en "Sync"
Then botón cambia a "Syncing…" y se deshabilita
When la respuesta llega
Then resultado inline muestra "Synced 5 txs | 2 skipped | 1 swaps"
And "Last synced: just now" aparece
And el botón vuelve a "Sync"
```

**SCENARIO: On-Chain Wallet — last_synced_at reactivo**

```
Given wallet.last_synced_at = '2026-05-08T10:00:00Z' (hace 30 minutos)
When OnChainWalletsSection renderiza
Then muestra "Last synced: 30 minutes ago"
```

**SCENARIO: On-Chain Wallet — sin sincronizar**

```
Given wallet.last_synced_at = null
When OnChainWalletsSection renderiza
Then muestra "Never synced"
```

**SCENARIO NEGATIVE: On-Chain Wallet — error de sync**

```
Given POST /api/sync/:walletId retorna HTTP 500
When usuario hace click en "Sync"
Then después de la respuesta de error, botón vuelve a "Sync"
And mensaje de error inline en rojo aparece debajo de la wallet
And NO se muestra toast (el error es inline)
```

---

### Frontend — REQ-2.4: ExchangeAccountsSection

**SCENARIO: Binance conectada — estado y last sync**

```
Given existe wallet con network='CEX_BINANCE' y last_synced_at='2026-05-08T09:00:00Z'
When ExchangeAccountsSection renderiza
Then muestra badge "Connected" en verde
And muestra "Last synced: X hours ago"
And botón "Sync" está habilitado
```

**SCENARIO: Binance no configurada**

```
Given no existe ninguna wallet con network='CEX_BINANCE'
When ExchangeAccountsSection renderiza
Then muestra badge "Not configured" en gris
And botón "Sync" está deshabilitado
```

**SCENARIO: Binance sync exitoso — resultado detallado**

```
Given POST /api/sync/:walletId retorna {
  trades: { synced: 10, skipped: 2 },
  converts: { synced: 1, skipped: 0 },
  withdrawals: { synced: 0, skipped: 0 },
  deposits: { synced: 3, skipped: 1 }
}
When usuario hace click en "Sync"
Then resultado inline muestra "10 trades | 1 converts | 0 withdrawals | 3 deposits"
```

---

### Frontend — REQ-2.5: TokensSection

**SCENARIO: Toggle is_hidden — PUT inmediato con optimistic update**

```
Given token con is_hidden = false
When usuario hace click en el toggle
Then el toggle cambia visualmente de inmediato a true (optimistic)
And PUT /api/tokens/:id se llama con { is_hidden: true }
When PUT retorna 200
Then el cambio se confirma (no hay rollback)
```

**SCENARIO NEGATIVE: Toggle is_hidden — error de red revierte el cambio**

```
Given token con is_hidden = false
When usuario hace click en el toggle
Then el toggle cambia a true (optimistic)
When PUT /api/tokens/:id retorna HTTP 500
Then el toggle vuelve a false (rollback)
And se muestra toast de error
```

**SCENARIO: target_exit_price — flujo Save/Cancel**

```
Given token con target_exit_price = 150.00
When usuario edita el input a 200.00
Then aparecen botones "Save" y "Cancel"
When usuario hace click en "Save"
Then PUT /api/tokens/:id se llama con { target_exit_price: 200.00 }
When PUT retorna 200
Then los botones Save/Cancel desaparecen
And el valor original del server se actualiza a 200.00
```

**SCENARIO: target_exit_price — Cancel descarta el draft**

```
Given token con target_exit_price = 150.00
When usuario edita el input a 200.00
And hace click en "Cancel"
Then el input vuelve a mostrar 150.00
And los botones Save/Cancel desaparecen
And NO se hace ninguna llamada PUT
```

**SCENARIO: target_exit_price — blur sin Save no persiste**

```
Given token con target_exit_price = 150.00
When usuario edita el input a 200.00
And el input pierde el foco (blur)
Then los botones Save/Cancel siguen visibles
And el valor server sigue siendo 150.00
And NO se hace ninguna llamada PUT
```

**SCENARIO: target_exit_price — limpiar el valor (null)**

```
Given token con target_exit_price = 150.00
When usuario borra el contenido del input (campo vacío)
And hace click en "Save"
Then PUT /api/tokens/:id se llama con { target_exit_price: null }
When PUT retorna 200
Then el input muestra vacío (sin valor)
```

**SCENARIO: target_exit_price — loading per-row deshabilita Save**

```
Given token con target_exit_price = 150.00
When usuario edita a 200.00 y hace click en "Save"
Then el botón "Save" está deshabilitado mientras la request está en vuelo
And no se puede hacer doble click que dispare PUT dos veces
```

**SCENARIO: Badge de fuente en tokens**

```
Given tokens con network: 'ETH', 'BSC', 'CEX_BINANCE'
When TokensSection renderiza
Then token ETH muestra badge "ETHERSCAN"
And token BSC muestra badge "BSCTRACE"
And token CEX_BINANCE muestra badge "BINANCE"
```

---

### Frontend — REQ-2.6: ApiKeysSection

**SCENARIO: Keys configuradas — inputs y botones**

```
Given GET /api/credentials retorna { ETHERSCAN_API_KEY: true, BSCTRACE_API_KEY: false, ... }
When ApiKeysSection renderiza
Then input ETHERSCAN_API_KEY tiene placeholder "Configured in .env" y está deshabilitado
And input BSCTRACE_API_KEY tiene placeholder "Not configured" y está deshabilitado
And botón "Test" de Etherscan está habilitado
And botón "Test" de BSCTrace está deshabilitado (key no configurada)
```

**SCENARIO: Test Etherscan — resultado Connected**

```
Given POST /api/credentials/test/etherscan retorna { status: 'connected' }
When usuario hace click en "Test" de Etherscan
Then botón muestra "Testing…" y está deshabilitado
When la respuesta llega
Then muestra "Connected" en verde bajo el input
And botón vuelve a "Test"
```

**SCENARIO: Test Binance — resultado Connected con asset count**

```
Given POST /api/credentials/test/binance retorna { status: 'connected', meta: { assetCount: 42 } }
When usuario hace click en "Test Binance"
Then muestra "Connected: 42 assets" en verde
```

**SCENARIO NEGATIVE: Test Binance — key inválida**

```
Given POST /api/credentials/test/binance retorna { status: 'failed', reason: 'Invalid API key' }
When usuario hace click en "Test Binance"
Then muestra "Failed: Invalid API key" en rojo
```

**SCENARIO NEGATIVE: Test Binance — sin permiso read**

```
Given POST /api/credentials/test/binance retorna { status: 'failed', reason: 'API key requires read permissions' }
When usuario hace click en "Test Binance"
Then muestra "Failed: API key requires read permissions" en rojo
```

**SCENARIO NEGATIVE: Timeout frontend (10s)**

```
Given el endpoint backend no responde en 10s
When usuario hace click en "Test" de cualquier servicio
Then AbortController cancela la request a los 10s
And muestra "Failed: Request timed out" en rojo
And botón vuelve a "Test"
```

**SCENARIO: Tests de distintas keys son independientes**

```
Given el test de Etherscan está en curso (botón "Testing…")
When usuario hace click en "Test BSCTrace" (si estuviera habilitado)
Then los estados de testing son por-servicio e independientes
And un resultado de Etherscan no afecta el área de resultado de BSCTrace
```

---

### Frontend — REQ-2.7: BalanceValidationSection

**SCENARIO: Sección colapsada por defecto**

```
When SettingsPage monta
Then BalanceValidationSection está colapsada
And el botón "Validate vs Binance Snapshot" NO es visible (o está hidden)
When usuario expande la sección
Then el botón se vuelve visible
```

**SCENARIO: Validación exitosa — tabla de diferencias**

```
Given wallet CEX_BINANCE configurada
And BINANCE_API_KEY y BINANCE_SECRET_KEY están configuradas (boolean: true)
And GET /api/portfolio/validate-snapshot retorna differences con 2 filas y dustNote
When usuario expande la sección y hace click en "Validate vs Binance Snapshot"
Then botón muestra spinner de loading
When la respuesta llega
Then tabla muestra 2 filas con columnas Symbol | Engine Balance | Snapshot Balance | Diff
And nota fija aparece: "Small differences are expected due to Binance dust conversion (non-goal in V1)."
```

**SCENARIO: Cooldown de 60s tras validación exitosa**

```
Given la validación completó exitosamente
When pasan menos de 60s
Then el botón está deshabilitado con contador regresivo visible (ej. "Validate (45s)")
When pasan 60s
Then el botón vuelve a estar habilitado
```

**SCENARIO NEGATIVE: Botón deshabilitado sin wallet Binance**

```
Given no existe wallet con network='CEX_BINANCE'
When BalanceValidationSection renderiza (expandida)
Then botón "Validate vs Binance Snapshot" está deshabilitado
And tiene tooltip "Configure a Binance wallet to enable"
```

**SCENARIO NEGATIVE: Botón deshabilitado sin keys Binance**

```
Given existe wallet CEX_BINANCE
And GET /api/credentials retorna { BINANCE_API_KEY: false, BINANCE_SECRET_KEY: false }
When BalanceValidationSection renderiza (expandida)
Then botón está deshabilitado con tooltip "Configure Binance API keys in .env to enable"
```

---

### Frontend — REQ-2 transversal: SettingsPage independencia de secciones

**SCENARIO: Error en una sección no rompe el resto**

```
Given GET /api/credentials falla con HTTP 500
And GET /api/wallets retorna OK
And GET /api/tokens retorna OK
When SettingsPage monta
Then ApiKeysSection muestra su propio estado de error
And OnChainWalletsSection renderiza correctamente con los datos de wallets
And TokensSection renderiza correctamente con los datos de tokens
```

**SCENARIO: Secciones cargan en paralelo**

```
When SettingsPage monta
Then los 5 hooks de fetch (wallets ON_CHAIN, wallets CEX, tokens, credentials, pending-price) se disparan simultáneamente
And cada sección muestra su propio skeleton mientras carga
And no existe un estado de loading global que bloquee la página entera
```

---

## Archivos a crear/modificar

### Backend
- `apps/backend/src/routes/credentials.ts` — nuevos endpoints REQ-1.1, REQ-1.2
- `apps/backend/src/routes/transactions.ts` — añadir ruta REQ-1.3 (o crear si no existe)
- `apps/backend/src/routes/portfolio.ts` — REQ-1.4 (o extender si ya existe)
- `apps/backend/src/services/credential-test.ts` — `CredentialTestService`
- `apps/backend/src/services/balance-validator.ts` — lógica de comparación snapshot
- `apps/backend/src/schemas/credentials.ts` — Zod schemas
- `apps/backend/src/schemas/pending-price.ts` — `PendingTransferSchema`
- `apps/backend/src/services/binance-sync.ts` — fix REQ-1.5
- `apps/backend/src/app.ts` — registrar plugins nuevos

### Backend tests
- `apps/backend/src/routes/credentials.spec.ts`
- `apps/backend/src/services/credential-test.spec.ts`
- `apps/backend/src/routes/transactions.pending-price.spec.ts`
- `apps/backend/src/services/binance-sync.spec.ts` — extender con last_synced_at

### Frontend
- `apps/frontend/src/pages/settings/SettingsPage.tsx`
- `apps/frontend/src/components/settings/PendingPriceBanner.tsx`
- `apps/frontend/src/components/settings/OnChainWalletsSection.tsx`
- `apps/frontend/src/components/settings/ExchangeAccountsSection.tsx`
- `apps/frontend/src/components/settings/TokensSection.tsx`
- `apps/frontend/src/components/settings/TokenRow.tsx`
- `apps/frontend/src/components/settings/ApiKeysSection.tsx`
- `apps/frontend/src/components/settings/BalanceValidationSection.tsx`
- `apps/frontend/src/components/settings/SyncResultInline.tsx`
- `apps/frontend/src/hooks/settings/useWallets.ts`
- `apps/frontend/src/hooks/settings/useTokens.ts`
- `apps/frontend/src/hooks/settings/useApiKeysStatus.ts`
- `apps/frontend/src/hooks/settings/useTestApiKey.ts`
- `apps/frontend/src/hooks/settings/usePendingPriceTransfers.ts`
- `apps/frontend/src/hooks/settings/useBalanceValidation.ts`
- `apps/frontend/src/hooks/settings/useSyncWallet.ts`
- `apps/frontend/src/routes/router.tsx` — añadir `/settings`
- `apps/frontend/src/components/layout/AppLayout.tsx` — link a Settings

### Frontend tests
- `apps/frontend/src/components/settings/PendingPriceBanner.spec.tsx`
- `apps/frontend/src/components/settings/OnChainWalletsSection.spec.tsx`
- `apps/frontend/src/components/settings/ExchangeAccountsSection.spec.tsx`
- `apps/frontend/src/components/settings/TokenRow.spec.tsx`
- `apps/frontend/src/components/settings/ApiKeysSection.spec.tsx`
- `apps/frontend/src/components/settings/BalanceValidationSection.spec.tsx`
- `apps/frontend/src/pages/settings/SettingsPage.spec.tsx`
