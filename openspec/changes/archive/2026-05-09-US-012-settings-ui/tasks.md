# Tasks — US-012 Settings UI

## Grupo A — Backend

### A1 — Fix BinanceSyncService.sync() — last_synced_at

- [ ] TEST A1: Tests unitarios para fix BinanceSyncService.sync() — last_synced_at
  - Archivo: `apps/backend/src/services/binance-sync.spec.ts` (extender spec existente)
  - Happy path: tras `sync(walletId)` exitoso, `SELECT last_synced_at FROM wallets WHERE id=$1` retorna timestamp con diferencia <= 5s respecto a `Date.now()` — verificar que era `null` antes del sync.
  - NEGATIVE: si la query `UPDATE wallets SET last_synced_at = now()` falla (mockear `pgc.query` para rechazar esa query específica), `sync()` retorna su `BinanceSyncResult` normal sin lanzar excepción.
  - Verificar que el error del UPDATE queda registrado en logs (spy sobre `logger.error` o `fastify.log.warn`).

- [ ] IMPL A1: Fix BinanceSyncService.sync() — actualizar wallets.last_synced_at al finalizar
  - Depende de: TEST A1
  - Archivo: `apps/backend/src/services/binance-sync.ts`
  - Al finalizar el sync exitosamente (después del bloque de deposits), dentro del `try` del `pool.connect()`, añadir:
    ```ts
    try {
      await pgc.query('UPDATE wallets SET last_synced_at = now() WHERE id = $1', [walletId]);
    } catch (err) {
      logger.error({ err }, 'Failed to update last_synced_at after Binance sync — best-effort');
    }
    ```
  - La query va fuera del `BEGIN/COMMIT` interno (cada sub-método ya commitea su propio batch). Reusar la conexión `pgc` ya abierta.

---

### A2 — GET /api/credentials

- [ ] TEST A2: Tests unitarios para GET /api/credentials
  - Archivo: `apps/backend/src/routes/credentials.spec.ts`
  - Happy path: `ETHERSCAN_API_KEY='abc123'` y `BINANCE_API_KEY='xyz789'` en env, `BSCTRACE_API_KEY` y `BINANCE_SECRET_KEY` ausentes → 200 `{ ETHERSCAN_API_KEY: true, BSCTRACE_API_KEY: false, BINANCE_API_KEY: true, BINANCE_SECRET_KEY: false }`.
  - `ETHERSCAN_API_KEY=''` (string vacío) → 200 `{ ETHERSCAN_API_KEY: false, ... }`.
  - `ETHERSCAN_API_KEY='   '` (solo espacios) → 200 `{ ETHERSCAN_API_KEY: false, ... }` — `Boolean(value?.trim())` devuelve false.
  - Body seguridad: el JSON de respuesta no debe contener ningún string que coincida con `/^[A-Z0-9]{20,}/` — verificar `JSON.stringify(body)` contra esa regex.
  - NEGATIVE: sin cookie JWT → 401.

- [ ] IMPL A2: GET /api/credentials — endpoint Fastify que lee presencia de env vars
  - Depende de: TEST A2
  - Archivos: `apps/backend/src/routes/credentials.ts`, `apps/backend/src/schemas/credentials.ts`
  - Plugin Fastify registrado con `prefix: '/api/credentials'`.
  - Handler `GET /`: leer `env.ETHERSCAN_API_KEY`, `env.BSCTRACE_API_KEY`, `env.BINANCE_API_KEY`, `env.BINANCE_SECRET_KEY`; convertir a `Boolean(value?.trim())`; retornar objeto validado por `CredentialsPresenceSchema`.
  - Zod schema en `schemas/credentials.ts` (shapes exactas según design.md).
  - Registrar plugin en `apps/backend/src/index.ts` después de `syncRoutes`.

---

### A3 — POST /api/credentials/test/etherscan

- [ ] TEST A3: Tests unitarios para POST /api/credentials/test/etherscan
  - Archivo: `apps/backend/src/routes/credentials.spec.ts` (mismo archivo que A2)
  - Happy path: mock `fetch` retornando `{ status: '1', message: 'OK', result: '...' }` → 200 `{ status: 'connected' }`.
  - Happy path con latency: el meta puede incluir `latencyMs` (verificar que es un número entero >= 0 si está presente).
  - NEGATIVE key inválida: mock `fetch` retornando `{ status: '0', message: 'Invalid API Key' }` → 200 `{ status: 'failed', reason: 'Invalid API key' }`.
  - NEGATIVE HTTP 401: mock `fetch` retornando HTTP 401 → 200 `{ status: 'failed', reason: 'Invalid API key' }`.
  - NEGATIVE key no configurada en env: `ETHERSCAN_API_KEY` ausente en env → 200 `{ status: 'failed', reason: 'API key not configured' }` y **no** se realiza llamada HTTP externa (spy sobre `fetch` debe no ser llamado).
  - NEGATIVE servicio inválido: `POST /api/credentials/test/invalid-service` → 400 con mensaje que incluya "etherscan, bsctrace, binance".
  - NEGATIVE timeout (8s): mock `fetch` que nunca resuelve + fake timers avanzando 9s → 200 `{ status: 'failed', reason: 'Connection timed out' }` y la función retorna en <= 9s.
  - NEGATIVE sin auth: sin cookie JWT → 401.

- [ ] TEST A3b: Tests unitarios para CredentialTestService — parsing de errores Etherscan
  - Archivo: `apps/backend/src/services/credential-test.spec.ts`
  - `{ status: '0', message: 'Invalid API Key' }` → `reason: 'Invalid API key'`.
  - `{ status: '0', message: 'Max rate limit reached' }` → `reason: 'Rate limit exceeded'`.
  - `{ status: '0', message: 'NOTOK - some other msg' }` → `reason` refleja el mensaje original.
  - HTTP 5xx → `reason: 'Etherscan unreachable'`.
  - `fetch` rechaza (network error) → `reason: 'Etherscan unreachable'`.

- [ ] IMPL A3: POST /api/credentials/test/etherscan — handler en CredentialTestService
  - Depende de: TEST A3, TEST A3b
  - Archivos: `apps/backend/src/services/credential-test.ts`, `apps/backend/src/routes/credentials.ts`
  - Handler `POST /test/:service` con validación Zod del param (enum `etherscan | bsctrace | binance`).
  - `CredentialTestService.testEtherscan()`: llamar `GET https://api.etherscan.io/v2/api?chainid=1&module=stats&action=ethsupply&apikey=<key>` con `AbortController` timeout 8s. Mapear según spec.md REQ-1.2. Usar `fetch` directo (no el cliente existente).
  - Si key ausente en env → retornar `{ status: 'failed', reason: 'API key not configured' }` sin llamar a la red.

---

### A4 — POST /api/credentials/test/bsctrace

- [ ] TEST A4: Tests unitarios para CredentialTestService.testBsctrace()
  - Archivo: `apps/backend/src/services/credential-test.spec.ts` (mismo archivo que A3b)
  - Happy path: mock `fetch` retornando `{ status: '1', message: 'OK', result: '...' }` → `{ status: 'connected' }`.
  - NEGATIVE key inválida: `{ status: '0', message: 'Invalid API Key' }` → `{ status: 'failed', reason: 'Invalid API key' }`.
  - NEGATIVE key no configurada → `{ status: 'failed', reason: 'API key not configured' }` sin llamada HTTP.
  - NEGATIVE timeout 8s → `{ status: 'failed', reason: 'Connection timed out' }`.
  - Lógica de parsing idéntica a Etherscan — verificar que ambos servicios pasan los mismos casos.

- [ ] IMPL A4: CredentialTestService.testBsctrace()
  - Depende de: TEST A4
  - Archivo: `apps/backend/src/services/credential-test.ts`
  - `testBsctrace()`: llamar `GET https://api.bscscan.com/api?module=stats&action=bnbsupply&apikey=<key>` con `AbortController` timeout 8s. Misma lógica de parsing que `testEtherscan()`. Si la URL de BSCScan no expone `bnbsupply`, usar `module=account&action=balance&address=0x0000000000000000000000000000000000000000` como fallback (verificar en `apps/backend/src/sync/clients/bsctrace.ts` cuál es el endpoint base real).

---

### A5 — POST /api/credentials/test/binance

- [ ] TEST A5a: Tests unitarios para CredentialTestService.testBinance() — happy path
  - Archivo: `apps/backend/src/services/credential-test.spec.ts`
  - Happy path: mock `BinanceApiClient.getAccountAssets()` retornando array de 42 assets → `{ status: 'connected', meta: { assetCount: 42 } }`.
  - `getAccountAssets()` retorna array vacío (0 balances) → `{ status: 'connected', meta: { assetCount: 0 } }` — cuenta activa sin balance es válida.

- [ ] TEST A5b: Tests unitarios para CredentialTestService.testBinance() — NEGATIVE cases
  - Archivo: `apps/backend/src/services/credential-test.spec.ts`
  - NEGATIVE key inválida (Binance code -2014): client throws error con code `-2014` → `{ status: 'failed', reason: 'Invalid API key' }`.
    - Este es el mensaje exacto del AC: `"Failed: Invalid API key"` — verificar que `reason === 'Invalid API key'`.
  - NEGATIVE key inválida (Binance code -2015, invalid signature): client throws error con code `-2015` → `{ status: 'failed', reason: 'Invalid API key' }`.
  - NEGATIVE sin permiso read (Binance code -1002): client throws error con code `-1002` → `{ status: 'failed', reason: 'API key requires read permissions' }`.
    - Este es el mensaje exacto del AC: `"Failed: API key requires read permissions"` — verificar que `reason === 'API key requires read permissions'`.
  - NEGATIVE BINANCE_API_KEY no configurada → `{ status: 'failed', reason: 'API key not configured' }` sin llamada HTTP.
  - NEGATIVE BINANCE_SECRET_KEY no configurada (solo la key, sin secret) → `{ status: 'failed', reason: 'API key not configured' }` sin llamada HTTP.
  - NEGATIVE timeout 8s → `{ status: 'failed', reason: 'Connection timed out' }`.
  - NEGATIVE rate limit (HTTP 429) → `{ status: 'failed', reason: 'Binance rate limit exceeded' }`.
  - NEGATIVE otro error HTTP → `{ status: 'failed', reason: 'Binance unreachable' }`.
  - Verificar que BINANCE_SECRET_KEY nunca aparece en el response JSON (spy sobre el valor retornado).

- [ ] IMPL A5: CredentialTestService.testBinance()
  - Depende de: TEST A5a, TEST A5b
  - Archivo: `apps/backend/src/services/credential-test.ts`
  - `testBinance()`: verificar primero que ambas keys (`BINANCE_API_KEY`, `BINANCE_SECRET_KEY`) están en env; si alguna falta → `{ status: 'failed', reason: 'API key not configured' }`. Usar `createBinanceApiClient` o `BinanceApiClient` existente en `apps/backend/src/sync/clients/binance-api.ts`. Llamar `getAccountAssets()` con `AbortController` timeout 8s. Mapear error codes de Binance (-2014, -2015 → `'Invalid API key'`; -1002 → `'API key requires read permissions'`). El `reason` nunca debe contener el valor de la key o el secret.

---

### A6 — GET /api/transactions/pending-price

- [ ] TEST A6: Tests unitarios para GET /api/transactions/pending-price
  - Archivo: `apps/backend/src/routes/transactions.pending-price.spec.ts`
  - Happy path: 3 transacciones con `type='TRANSFER_IN'`, `cost_source='MANUAL'`, `price_usd=null` + 5 TRANSFER_IN con `price_usd != null` + 2 transacciones `BUY` → 200 `{ transactions: [3 items], count: 3 }`. Cada item tiene `type: 'TRANSFER_IN'` y el body NO incluye `price_usd`.
  - Vacío: sin transacciones pendientes → 200 `{ transactions: [], count: 0 }`.
  - LIMIT 100: insertar 150 transacciones TRANSFER_IN pendientes → 200 `{ transactions: [100 items], count: 150 }`. Verificar `transactions.length === 100` y `count === 150`.
  - Multi-tenant safety: transacciones de otro `user_id` no aparecen en el resultado del usuario actual.
  - NEGATIVE: sin cookie JWT → 401.

- [ ] IMPL A6: GET /api/transactions/pending-price — endpoint Fastify con query SQL
  - Depende de: TEST A6
  - Archivos: `apps/backend/src/routes/transactions.ts` (o crear si no existe), `apps/backend/src/schemas/pending-price.ts`
  - Query SQL usando el CTE del design.md (con `w.user_id = $1` para seguridad multi-tenant, `ORDER BY t.block_timestamp DESC`, `LIMIT 100`). Count separado en la misma query.
  - Response validado por `PendingPriceResponseSchema`.
  - Registrar la ruta en `apps/backend/src/index.ts`.

---

### A7 — GET /api/portfolio/validate-snapshot

- [ ] TEST A7: Tests unitarios para GET /api/portfolio/validate-snapshot
  - Archivo: `apps/backend/src/services/balance-validator.spec.ts`
  - Happy path: mock `binanceClient.getAccountAssets()` retornando `[{asset:'ETH', free:'1.4999', locked:'0'}, {asset:'BTC', free:'0.0099', locked:'0'}]` + posiciones motor `ETH=1.5, BTC=0.01` → differences con 2 filas, `diff='0.0001'` para cada una.
  - Filtrado de ruido: diferencia de `0.000000001` no aparece en `differences` (threshold `|diff| < 0.00000001`).
  - Cache 60s: segunda llamada en < 60s no llama a Binance de nuevo (spy sobre `binanceClient.getAccountAssets` llamado solo 1 vez).
  - NEGATIVE sin wallet CEX_BINANCE → throws `NotFoundError` o equivalente (el handler retorna 400 `{ error: 'No Binance wallet configured' }`).
  - NEGATIVE keys no configuradas → handler retorna 400 `{ error: 'Binance API keys not configured' }`.
  - NEGATIVE Binance falla → handler retorna 502 `{ error: 'BINANCE_UNAVAILABLE' }`.

- [ ] IMPL A7: GET /api/portfolio/validate-snapshot + BalanceValidatorService
  - Depende de: TEST A7
  - Archivos: `apps/backend/src/routes/portfolio.ts` (extender o crear), `apps/backend/src/services/balance-validator.ts`, `apps/backend/src/schemas/balance-validation.ts`
  - `BalanceValidatorService`: pasos según design.md (verificar wallet CEX_BINANCE → getAccountAssets con timeout 30s → query balances motor → outer-join → filtrar `|diff| < 0.00000001` → calcular totals USD → retornar). Cache en memoria 60s por userId.
  - `dustNote` fijo: `"Small differences are expected due to Binance dust conversion (non-goal in V1)."`.
  - Registrar ruta en `apps/backend/src/index.ts`.

---

## Grupo B — Frontend: types + router + hooks

### B1 — types/settings.ts

- [ ] TEST B1: Verificación de tipos TypeScript en types/settings.ts
  - No hay test en runtime para tipos puros. La verificación es via `npm run typecheck` en el proyecto frontend.
  - Crear al menos un test de integración básico: importar los tipos en `SettingsPage.spec.tsx` y verificar que la asignación de objetos conformes compila sin error (esto ocurre implícitamente al escribir los tests de los componentes).

- [ ] IMPL B1: types/settings.ts — tipos del dominio Settings
  - Archivo: `apps/frontend/src/types/settings.ts`
  - Crear todos los tipos según design.md: `TOKEN_NETWORKS`, `TokenNetwork`, `WALLET_TYPES`, `WalletType`, `API_SERVICES`, `ApiService`, `SettingsWallet`, `SettingsToken`, `OnChainSyncResult`, `CexSyncResult`, `SyncResultUnion`, `SyncState`, `ApiKeysPresence`, `ApiKeyTestState`, `PendingTransfer`, `BalanceDifference`, `BalanceValidationData`.
  - Usar `as const + typeof` para enums, `type` para uniones, `interface` para shapes. Sin `any`.

---

### B2 — /settings route en router.tsx + link de navegación

- [ ] TEST B2: Test de ruta /settings en router
  - Archivo: `apps/frontend/src/pages/settings/__tests__/SettingsPage.spec.tsx` (el smoke test de B7 ya cubre esto indirectamente)
  - Verificar que la ruta `/settings` existe en el router y renderiza `<SettingsPage>` cuando el usuario está autenticado.
  - NEGATIVE: sin autenticación, redirige a login (comportamiento de `<ProtectedRoute>`).

- [ ] IMPL B2: Añadir ruta /settings en router.tsx + link en navegación
  - Depende de: IMPL B1
  - Archivos: `apps/frontend/src/routes/router.tsx`, `apps/frontend/src/components/layout/AppLayout.tsx` (o el header de `DashboardPage` si no hay layout compartido)
  - Importar `SettingsPage` y registrar ruta `/settings` envuelta en `<ProtectedRoute>` según el diff del design.md.
  - Añadir `<Link to="/settings">Settings</Link>` en el header de `DashboardPage`. Dado que no existe `AppLayout` compartido en V1, también añadir el link en el header de `SettingsPage` (bidireccional: Settings tiene "← Back to Portfolio").

---

### B3 — useSettingsWallets

- [ ] TEST B3: Tests unitarios para useSettingsWallets
  - Archivo: `apps/frontend/src/hooks/settings/__tests__/useSettingsWallets.spec.tsx`
  - Happy path: mock `apiClient.get('/api/wallets')` retornando array de wallets con `last_synced_at` como string ISO → hook expone `data` con `lastSyncedAt` como `Date` (verificar `instanceof Date`).
  - `loading` es `true` durante fetch y `false` al completar.
  - `refetch()` llama `apiClient.get` de nuevo y actualiza `data`.
  - NEGATIVE: `apiClient.get` rechaza → `error` es no-null, `data` es null.

- [ ] IMPL B3: useSettingsWallets — hook de wallets con shape rico
  - Depende de: IMPL B1, TEST B3
  - Archivo: `apps/frontend/src/hooks/settings/useSettingsWallets.ts`
  - Fetch `GET /api/wallets`, mapear `last_synced_at: string | null` a `Date | null`. Exponer `{ data: SettingsWallet[] | null, loading, error, refetch }`. Sin filtros internos — el caller filtra por `walletType`.
  - **No** sobreescribir `apps/frontend/src/hooks/useWallets.ts` existente.

---

### B4 — useSyncWallet

- [ ] TEST B4: Tests unitarios para useSyncWallet
  - Archivo: `apps/frontend/src/hooks/settings/__tests__/useSyncWallet.spec.tsx`
  - `sync(id, 'on-chain')` → `states[id]` pasa por `idle → syncing → success`. En success, `state.result.kind === 'on-chain'` y `result.synced`, `result.skipped`, `result.swapsDecomposed` están presentes.
  - `sync(id, 'cex')` → `state.result.kind === 'cex'` con sub-objetos `trades`, `converts`, `withdrawals`, `deposits`.
  - Dos wallets concurrentes: sync simultáneo de `idA` y `idB` → cada uno tiene su propio `SyncState` independiente.
  - NEGATIVE: backend rechaza → `states[id].status === 'error'`, `states[id].message` contiene el error.
  - NEGATIVE: `sync` no hace refetch interno — verificar que `apiClient.get` no es llamado dentro del hook.

- [ ] IMPL B4: useSyncWallet — estado per-wallet para sync
  - Depende de: IMPL B1, TEST B4
  - Archivo: `apps/frontend/src/hooks/settings/useSyncWallet.ts`
  - `sync(walletId, kind)`: setea `states[walletId] = { status: 'syncing' }` → `POST /api/sync/:walletId` → parsea respuesta según `kind` al union `OnChainSyncResult | CexSyncResult` → setea `{ status: 'success', result, finishedAt: new Date() }`. En error → `{ status: 'error', message }`. NO hace refetch de wallets internamente.

---

### B5 — useSettingsTokens

- [ ] TEST B5: Tests unitarios para useSettingsTokens
  - Archivo: `apps/frontend/src/hooks/settings/__tests__/useSettingsTokens.spec.tsx`
  - Happy path: mock `apiClient.get('/api/tokens')` → `data` contiene tokens con `isHidden` y `targetExitPrice` correctamente mapeados desde snake_case.
  - `updateToken(id, { isHidden: true })`: verifica que `apiClient.put('/api/tokens/:id', { is_hidden: true })` es llamado. En éxito: `data` local no cambia optimisticamente (no optimistic en V1), el caller hace refetch si quiere el estado actualizado — o `updateToken` actualiza el item en `data` local tras éxito (verificar según la decisión del design: "actualiza local solo en éxito").
  - `updateToken(id, { targetExitPrice: null })`: verifica que se envía `{ target_exit_price: null }`.
  - NEGATIVE: `apiClient.put` rechaza → `updateToken` lanza el error, `data` no cambia.

- [ ] IMPL B5: useSettingsTokens — hook de tokens con updateToken
  - Depende de: IMPL B1, TEST B5
  - Archivo: `apps/frontend/src/hooks/settings/useSettingsTokens.ts`
  - Fetch `GET /api/tokens` (incluye tokens con `is_hidden=true`). `updateToken(id, patch)`: traduce el patch de camelCase a snake_case y llama `PUT /api/tokens/:id`. Actualiza el item en `data` local solo en éxito. Exponer `{ data, loading, error, refetch, updateToken }`.

---

### B6 — useApiKeysStatus y useTestApiKey

- [ ] TEST B6: Tests unitarios para useApiKeysStatus y useTestApiKey
  - Archivo: `apps/frontend/src/hooks/settings/__tests__/useApiKeysStatus.spec.tsx`
  - `useApiKeysStatus`: mock `apiClient.get('/api/credentials')` → `data` typed como `ApiKeysPresence`.
  - `loading/error` correctos. No expone `refetch` (sin cambio sin redeploy).
  - Archivo: `apps/frontend/src/hooks/settings/__tests__/useTestApiKey.spec.tsx`
  - `useTestApiKey.test('etherscan')`: `states['etherscan']` pasa por `idle → testing → connected | failed`.
  - Estado `connected` con `meta.assetCount` para Binance.
  - NEGATIVE `failed`: `states['binance'].status === 'failed'`, `states['binance'].reason === 'Invalid API key'`.
  - NEGATIVE `failed` con permiso: `reason === 'API key requires read permissions'`.
  - NEGATIVE timeout 10s: `AbortController` cancela → `reason === 'Request timed out'`. Usar fake timers.
  - Estados por servicio son independientes: test de Etherscan no afecta `states['binance']`.

- [ ] IMPL B6: useApiKeysStatus + useTestApiKey
  - Depende de: IMPL B1, TEST B6
  - Archivos: `apps/frontend/src/hooks/settings/useApiKeysStatus.ts`, `apps/frontend/src/hooks/settings/useTestApiKey.ts`
  - `useApiKeysStatus`: fetch único `GET /api/credentials`. Exponer `{ data, loading, error }` (sin `refetch`).
  - `useTestApiKey`: `test(service: ApiService)` → setea `states[service] = { status: 'testing' }` → `POST /api/credentials/test/:service` con `AbortController` timeout 10s → en éxito setea `{ status: 'connected', meta? }` → en error o timeout setea `{ status: 'failed', reason }`. Si `AbortError` → `reason = 'Request timed out'`.

---

### B7 — usePendingPriceTransfers y useBalanceValidation

- [ ] TEST B7a: Tests unitarios para usePendingPriceTransfers
  - Archivo: `apps/frontend/src/hooks/settings/__tests__/usePendingPriceTransfers.spec.tsx`
  - Happy path: mock `apiClient.get('/api/transactions/pending-price')` → `data.count === 3`, `data.transactions.length === 3`.
  - `refetch()` llama `apiClient.get` de nuevo.
  - NEGATIVE: fetch falla → `error` no-null, `data` null.

- [ ] TEST B7b: Tests unitarios para useBalanceValidation
  - Archivo: `apps/frontend/src/hooks/settings/__tests__/useBalanceValidation.spec.tsx`
  - No fetcha en mount: verificar que `apiClient.get` NO es llamado al renderizar el hook.
  - `validate()` → `state` pasa por `idle → loading → success`. En success, `cooldownSecondsRemaining === 60`.
  - Fake timers: avanzar 30s → `cooldownSecondsRemaining === 30`. Avanzar 30s más → `cooldownSecondsRemaining === 0`, botón volvería a habilitarse.
  - NEGATIVE: `apiClient.get` rechaza → `state === 'error'`, `error` no-null.

- [ ] IMPL B7: usePendingPriceTransfers + useBalanceValidation
  - Depende de: IMPL B1, TEST B7a, TEST B7b
  - Archivos: `apps/frontend/src/hooks/settings/usePendingPriceTransfers.ts`, `apps/frontend/src/hooks/settings/useBalanceValidation.ts`
  - `usePendingPriceTransfers`: fetch `GET /api/transactions/pending-price`. Mapear `block_timestamp` a `Date`. Exponer `{ data, loading, error, refetch }`.
  - `useBalanceValidation`: lazy — no fetcha en mount. `validate()` setea `state='loading'` → `GET /api/portfolio/validate-snapshot` → en éxito: `state='success'`, `data`, arranca cooldown 60s con `setInterval` que decrementa `cooldownSecondsRemaining`. En error: `state='error'`. Exponer `{ state, data, error, validate, cooldownSecondsRemaining }`.

---

## Grupo C — Frontend: componentes

### C1 — PendingPriceBanner

- [ ] TEST C1: Tests para PendingPriceBanner
  - Archivo: `apps/frontend/src/components/settings/__tests__/PendingPriceBanner.spec.tsx`
  - `count === 0`: el componente no renderiza nada (`container.firstChild === null`).
  - `count === 5`: renderiza texto que incluye "5 TRANSFER_IN" y "need a price".
  - CTA: existe un elemento `<a>` o `<button>` clickeable que es accesible.
  - Loading (`data === null`): no renderiza nada (no skeleton, no placeholder).
  - NEGATIVE: error de fetch (`error !== null`) → no renderiza nada (banner silencioso, no rompe la página).

- [ ] IMPL C1: PendingPriceBanner
  - Depende de: IMPL B7 (usePendingPriceTransfers), TEST C1
  - Archivo: `apps/frontend/src/components/settings/PendingPriceBanner.tsx`
  - Si `data === null` o `data.count === 0`: return null.
  - Si `data.count > 0`: card amarilla `rounded-xl bg-yellow-900/30 border border-yellow-700 p-4 mb-6` con texto `"⚠ {count} TRANSFER_IN transactions need a price."` y CTA según design.md (link a `/token/${first.contractAddress}/${first.tokenNetwork}` o disabled con tooltip si es CEX sin contract_address).

---

### C2 — OnChainWalletsSection

- [ ] TEST C2: Tests para OnChainWalletsSection
  - Archivo: `apps/frontend/src/components/settings/__tests__/OnChainWalletsSection.spec.tsx`
  - Render con 1 wallet ON_CHAIN: muestra label, address truncada `0x1234…abcd` (primeros 6 + "…" + últimos 4), badge de network.
  - Copy address: click en botón "Copy" → `navigator.clipboard.writeText` llamado con la address completa. El botón muestra "Copied!" tras el click.
  - Después de 2s (fake timers): el botón vuelve al texto original "Copy".
  - Click Sync: `apiClient.post` llamado con `/api/sync/${walletId}`; durante in-flight, el botón está `disabled` y muestra "Syncing…".
  - Sync success: `<SyncResultInline>` renderiza con texto que incluye el count de synced txs.
  - `last_synced_at` null → muestra "Never synced".
  - `last_synced_at` reciente → muestra "Last synced: just now" o tiempo relativo.
  - NEGATIVE error de sync: `apiClient.post` rechaza → mensaje de error inline en rojo debajo de la wallet. Sin toast (error es inline, no toast).
  - NEGATIVE lista vacía: renderiza `<EmptyState>` o equivalente con "No on-chain wallets".
  - NEGATIVE error de carga: `useSettingsWallets` retorna error → renderiza `<SectionError>` con botón Retry.

- [ ] IMPL C2: OnChainWalletsSection
  - Depende de: IMPL B3 (useSettingsWallets), IMPL B4 (useSyncWallet), IMPL B7 (usePendingPriceTransfers), TEST C2
  - Archivo: `apps/frontend/src/components/settings/OnChainWalletsSection.tsx`
  - Filtrar `data` por `walletType === 'ON_CHAIN'`. Mostrar tabla con columnas: Label · Address truncada · Network badge · Last synced (`useRelativeTime`) · Sync button.
  - Truncado de address: `addr.slice(0, 6) + '…' + addr.slice(-4)`.
  - Copy button con estado "Copied!" por 2s (`setTimeout`).
  - Click Sync → `useSyncWallet.sync(wallet.id, 'on-chain')`. En success → `walletsRefetch()` + `pendingRefetch()`.
  - `<SyncResultInline result={state.result}/>` con fade-out a los 10s. Error → inline en rojo.

---

### C3 — ExchangeAccountsSection

- [ ] TEST C3: Tests para ExchangeAccountsSection
  - Archivo: `apps/frontend/src/components/settings/__tests__/ExchangeAccountsSection.spec.tsx`
  - Render con wallet CEX_BINANCE: muestra badge "Connected" en verde y `last_synced_at` relativo. Botón "Sync" habilitado.
  - Sin wallet CEX_BINANCE: muestra badge "Not configured" en gris. Botón "Sync" deshabilitado.
  - Sync exitoso con resultado CEX: renderiza texto que incluye "trades", "converts", "withdrawals", "deposits" con los números correctos.
  - NEGATIVE error de sync: error inline en rojo, botón vuelve a "Sync".
  - Tras sync exitoso: se dispara `walletsRefetch()` y `pendingRefetch()` (verificar que son llamados).

- [ ] IMPL C3: ExchangeAccountsSection
  - Depende de: IMPL B3, IMPL B4, IMPL B7, TEST C3
  - Archivo: `apps/frontend/src/components/settings/ExchangeAccountsSection.tsx`
  - Filtrar `data` por `walletType === 'CEX'`. Si `wallet?.network === 'CEX_BINANCE'` → badge "Connected" verde, else "Not configured" gris.
  - `<SyncResultInline>` para CEX muestra las 4 sub-categorías con sus counts.
  - `last_synced_at` via `useRelativeTime`.

---

### C4 — SyncResultInline + TokensSection + TokenRow

- [ ] TEST C4a: Tests para SyncResultInline
  - Archivo: puede estar en `apps/frontend/src/components/settings/__tests__/` como parte de otro spec o su propio spec
  - `result.kind === 'on-chain'`: renderiza "Synced X txs | Y skipped | Z swaps".
  - `result.kind === 'cex'`: renderiza las 4 líneas de sub-resultados (trades, converts, withdrawals, deposits).

- [ ] IMPL C4a: SyncResultInline
  - Depende de: IMPL B1, TEST C4a
  - Archivo: `apps/frontend/src/components/settings/SyncResultInline.tsx`
  - Discriminated union sobre `result.kind`. Props: `interface SyncResultInlineProps { result: SyncResultUnion }`.

- [ ] TEST C4b: Tests para TokenRow
  - Archivo: `apps/frontend/src/components/settings/__tests__/TokenRow.spec.tsx`
  - Toggle `is_hidden` false→true: click → `onUpdate({ isHidden: true })` llamado exactamente 1 vez. Mientras in-flight, el switch está `disabled`.
  - NEGATIVE toggle: `onUpdate` rechaza → el switch vuelve al valor anterior (no optimistic, el prop `token.isHidden` no cambió → re-render lo revierte automáticamente).
  - `target_exit_price` edit: cambiar input a "200.00" → aparecen botones Save y Cancel. Click Save → `onUpdate({ targetExitPrice: '200.00' })` llamado. En éxito, Save desaparece (re-render con prop actualizado sincroniza el draft).
  - Click Cancel → input vuelve a `token.targetExitPrice`. Save y Cancel desaparecen. `onUpdate` no es llamado.
  - Blur sin Save → botones Save/Cancel permanecen visibles. `onUpdate` no es llamado.
  - Input vacío + Save → `onUpdate({ targetExitPrice: null })` llamado.
  - Input inválido (`'abc'`) → botón Save permanece deshabilitado (validación cliente: `/^\d+(\.\d+)?$/` o vacío).
  - `savingTarget === true` durante request → botón Save `disabled` (no double submit).
  - Re-render con `props.token.targetExitPrice` actualizado → draft se re-sincroniza, Save desaparece.
  - Badge de fuente: `network='ETH'` → badge muestra "ETHERSCAN"; `network='BSC'` → "BSCTRACE"; `network='CEX_BINANCE'` → "BINANCE".

- [ ] IMPL C4b: TokenRow
  - Depende de: IMPL B1, TEST C4b
  - Archivo: `apps/frontend/src/components/settings/TokenRow.tsx`
  - Props: `{ token: SettingsToken; onUpdate: (patch) => Promise<void> }`.
  - Estado local: `draftTargetPrice`, `savingHidden`, `savingTarget`.
  - Toggle hidden: `onChange` → `setSavingHidden(true)` → `onUpdate({ isHidden })` → `setSavingHidden(false)`. Toast en error.
  - Edit target: `useEffect` re-sincroniza `draftTargetPrice` cuando `token.targetExitPrice` cambia (para que Save desaparezca tras éxito de server).
  - Sin `useMemo`/`useCallback` (regla React 19).

- [ ] TEST C4c: Tests para TokensSection
  - Archivo: `apps/frontend/src/components/settings/__tests__/TokensSection.spec.tsx`
  - Render lista de tokens con `<TokenRow>` por cada uno (verificar que el mock de `useSettingsTokens` produce las filas).
  - Filtro de búsqueda: escribir en el input de search → solo tokens cuyo symbol coincide son visibles.
  - Toggle "Show hidden tokens" (default off): tokens con `isHidden=true` no aparecen por default; con toggle on, aparecen.
  - NEGATIVE: `useSettingsTokens` retorna error → `<SectionError>` visible.

- [ ] IMPL C4c: TokensSection
  - Depende de: IMPL B5 (useSettingsTokens), IMPL C4b (TokenRow), TEST C4c
  - Archivo: `apps/frontend/src/components/settings/TokensSection.tsx`
  - Filtros UI: input de search por symbol + toggle "Show hidden tokens" (default off).
  - `updateToken` de `useSettingsTokens` se pasa a cada `<TokenRow>` como `onUpdate`.

---

### C5 — ApiKeysSection

- [ ] TEST C5: Tests para ApiKeysSection
  - Archivo: `apps/frontend/src/components/settings/__tests__/ApiKeysSection.spec.tsx`
  - Render con presencia `{ ETHERSCAN_API_KEY: true, BSCTRACE_API_KEY: false, BINANCE_API_KEY: true, BINANCE_SECRET_KEY: true }`:
    - Input ETHERSCAN tiene placeholder "Configured in .env".
    - Input BSCTRACE tiene placeholder "Not configured".
    - Botón "Test" Etherscan habilitado.
    - Botón "Test" BSCTrace deshabilitado.
  - Click "Test" Etherscan: `apiClient.post('/api/credentials/test/etherscan')` llamado. Botón muestra "Testing…" y está disabled.
  - Response `{ status: 'connected', meta: { latencyMs: 340 } }` → texto "Connected (340ms)".
  - Response `{ status: 'failed', reason: 'Invalid API key' }` → texto "Failed: Invalid API key" en rojo.
  - Response `{ status: 'failed', reason: 'API key requires read permissions' }` → texto "Failed: API key requires read permissions" en rojo.
  - Timeout 10s: AbortController cancela → "Failed: Request timed out" en rojo.
  - Binance: un solo botón "Test Binance" agrupa API key + Secret key. Response `{ status: 'connected', meta: { assetCount: 42 } }` → "Connected: 42 assets".
  - Tests independientes: state de Etherscan no afecta área de resultado de BSCTrace.
  - Seguridad: `container.innerHTML` no debe contener ningún string que coincida con `/^[A-Z0-9]{20,}/`.

- [ ] IMPL C5: ApiKeysSection
  - Depende de: IMPL B6 (useApiKeysStatus, useTestApiKey), TEST C5
  - Archivo: `apps/frontend/src/components/settings/ApiKeysSection.tsx`
  - 4 filas: Etherscan, BSCTrace, Binance API Key, Binance Secret Key. Binance API Key y Secret Key agrupadas con un único botón "Test Binance".
  - Inputs `type="password"` read-only. Placeholder según presencia booleana.
  - Resultado inline por servicio (idle → nada; testing → spinner; connected → verde; failed → rojo).
  - Botones Test habilitados solo si la key está configurada.

---

### C6 — BalanceValidationSection

- [ ] TEST C6: Tests para BalanceValidationSection
  - Archivo: `apps/frontend/src/components/settings/__tests__/BalanceValidationSection.spec.tsx`
  - Render: sección colapsada por defecto (el botón "Validate" no es visible o está hidden).
  - Click para expandir: el botón "Validate vs Binance Snapshot" se vuelve visible.
  - Botón disabled si `presence.BINANCE_API_KEY === false` → tiene atributo `disabled`.
  - Botón disabled si no hay wallet CEX_BINANCE → tiene atributo `disabled`.
  - Click "Validate": `apiClient.get('/api/portfolio/validate-snapshot')` llamado. Spinner visible durante loading.
  - Response success con 2 diferencias: tabla renderiza 2 filas. `dustNote` visible.
  - Cooldown: tras success, botón muestra "Available in Xs" y está `disabled`. Con fake timers a 60s, botón vuelve a habilitarse.
  - NEGATIVE: response error → mensaje de error inline + botón "Retry" visible.
  - Click "Retry": `validate()` se vuelve a llamar.

- [ ] IMPL C6: BalanceValidationSection
  - Depende de: IMPL B6 (useApiKeysStatus), IMPL B3 (useSettingsWallets), IMPL B7 (useBalanceValidation), TEST C6
  - Archivo: `apps/frontend/src/components/settings/BalanceValidationSection.tsx`
  - Estado collapsible local (`useState(false)`). Caret + click para expandir.
  - Tabla con columnas: Asset · Engine · Snapshot · Diff. Diff en rojo si `|diff| > 1` (dust visual), gris si menor.
  - Cooldown: `cooldownSecondsRemaining > 0` → texto "Available in {n}s". Botón deshabilitado.
  - Tooltip en botón disabled: implementar via `title` attr o un elemento tooltip.

---

### C7 — SettingsPage (composición)

- [ ] TEST C7: Tests para SettingsPage — smoke test + aislamiento de secciones
  - Archivo: `apps/frontend/src/pages/settings/__tests__/SettingsPage.spec.tsx`
  - Smoke test: renderizar `<SettingsPage>` con todos los hooks mockeados → las 6 secciones están presentes en el DOM (verificar por heading o `data-testid`).
  - Aislamiento D5: mock `useApiKeysStatus` para que retorne `error` → `ApiKeysSection` muestra su error, pero `OnChainWalletsSection` y `TokensSection` siguen renderizando correctamente con sus datos.
  - Carga en paralelo: verificar que al mount, los mocks de todos los hooks son llamados (los fetches se disparan simultáneamente, no en cadena).
  - NEGATIVE: sin auth (mock `useAuth` retornando unauthenticated) → `<ProtectedRoute>` redirige (este test puede vivir en `router.spec.tsx` del B2).

- [ ] IMPL C7: SettingsPage
  - Depende de: IMPL C1 (PendingPriceBanner), IMPL C2 (OnChainWalletsSection), IMPL C3 (ExchangeAccountsSection), IMPL C4c (TokensSection), IMPL C5 (ApiKeysSection), IMPL C6 (BalanceValidationSection), TEST C7
  - Archivo: `apps/frontend/src/pages/settings/SettingsPage.tsx`
  - Contenedor delgado: compone las 6 secciones según el template del design.md. Sin loading/error global. Header con "← Back to Portfolio". Sin `useMemo`/`useCallback`.

---

## Orden de implementación sugerido

```
A1 (TEST A1 → IMPL A1)
A2 (TEST A2 → IMPL A2)
A3 (TEST A3 → TEST A3b → IMPL A3)
A4 (TEST A4 → IMPL A4)
A5 (TEST A5a → TEST A5b → IMPL A5)
A6 (TEST A6 → IMPL A6)
A7 (TEST A7 → IMPL A7)
B1 (IMPL B1)
B2 (TEST B2 → IMPL B2)
B3 (TEST B3 → IMPL B3)
B4 (TEST B4 → IMPL B4)
B5 (TEST B5 → IMPL B5)
B6 (TEST B6 → IMPL B6)
B7 (TEST B7a → TEST B7b → IMPL B7)
C1 (TEST C1 → IMPL C1)
C2 (TEST C2 → IMPL C2)
C3 (TEST C3 → IMPL C3)
C4 (TEST C4a → IMPL C4a → TEST C4b → IMPL C4b → TEST C4c → IMPL C4c)
C5 (TEST C5 → IMPL C5)
C6 (TEST C6 → IMPL C6)
C7 (TEST C7 → IMPL C7)
```

**Dependencias críticas:**
- Todo el Grupo C depende de sus hooks correspondientes del Grupo B.
- B1 (tipos) es prerequisito de todos los demás del Grupo B y C.
- A5 (test/binance) tiene dos conjuntos de tests separados (happy + NEGATIVE) por la cantidad de casos críticos de los AC.
- C4 tiene tres sub-componentes con su propia cadena TEST→IMPL: `SyncResultInline` primero (C4a), luego `TokenRow` (C4b), luego `TokensSection` (C4c) que los compone.
```
