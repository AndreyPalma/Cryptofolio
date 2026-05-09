# Apply Progress — US-012-settings-ui

## Batch A — Backend

- [x] TEST A1: `apps/backend/src/services/binance-sync.test.ts` — 3 tests
  - A1-01: sync() exitoso ejecuta UPDATE wallets SET last_synced_at
  - A1-02: UPDATE falla → sync() NO lanza excepción (best-effort)
  - A1-03: sync() retorna BinanceSyncResult completo incluso cuando UPDATE falla
- [x] IMPL A1: `apps/backend/src/services/binance-sync.ts` — añadido try/catch best-effort con `UPDATE wallets SET last_synced_at = now()` al final de sync(), antes del return, fuera del BEGIN/COMMIT interno

- [x] TEST A2: `apps/backend/src/routes/credentials.test.ts` — 5 tests para GET /api/credentials
  - A2-01: happy path — true para keys configuradas, false para ausentes
  - A2-02: string vacío → false
  - A2-03: whitespace-only → false (Boolean(value?.trim()))
  - A2-04: security — body no contiene strings que parezcan API keys (≥20 chars uppercase)
  - A2-05: NEGATIVE — sin JWT → 401

- [x] IMPL A2: `apps/backend/src/routes/credentials.ts`, `apps/backend/src/schemas/credentials.ts`
  - Plugin Fastify registrado en `prefix: '/api/credentials'`
  - GET / — lee presencia de env vars con Boolean(value?.trim())
  - Schema Zod: CredentialsPresenceSchema, CredentialServiceParamSchema, CredentialTestResultSchema

- [x] TEST A3: `apps/backend/src/routes/credentials.test.ts` — 6 tests para POST /api/credentials/test/etherscan
  - A3-01: fetch status=1 → { status: connected }
  - A3-02: fetch status=0 "Invalid API Key" → { status: failed, reason: 'Invalid API key' }
  - A3-03: HTTP 401 → { status: failed, reason: 'Invalid API key' }
  - A3-04: key no configurada → { status: failed, reason: 'API key not configured' }, fetch no llamado
  - A3-05: servicio inválido → 400 mencionando etherscan/bsctrace/binance
  - A3-06: network error (fetch throws) → { status: failed }

- [x] IMPL A3: `apps/backend/src/services/credential-test.ts` — CredentialTestService.testEtherscan()
  - Endpoint: `https://api.etherscan.io/api?module=stats&action=ethsupply&apikey=<key>`
  - AbortController timeout 8s, mapeo de errores, latencyMs en meta si connected

- [x] TEST A4: `apps/backend/src/routes/credentials.test.ts` — 3 tests para POST /api/credentials/test/bsctrace
  - A4-01: fetch status=1 → connected
  - A4-02: status=0 Invalid → failed reason: 'Invalid API key'
  - A4-03: key no configurada → failed sin HTTP call

- [x] IMPL A4: `apps/backend/src/services/credential-test.ts` — CredentialTestService.testBsctrace()
  - Endpoint: `https://api.bscscan.com/api?module=stats&action=bnbsupply&apikey=<key>`
  - Lógica de parsing idéntica a Etherscan

- [x] TEST A5: `apps/backend/src/routes/credentials.test.ts` — 9 tests para POST /api/credentials/test/binance
  - A5-01: 42 assets → { status: connected, meta: { assetCount: 42 } }
  - A5-02: 0 assets → { status: connected, meta: { assetCount: 0 } }
  - A5-03: Binance code -2014 → reason: 'Invalid API key'
  - A5-04: Binance code -2015 → reason: 'Invalid API key'
  - A5-05: Binance code -1002 → reason: 'API key requires read permissions'
  - A5-06: BINANCE_API_KEY no configurada → reason: 'API key not configured', sin fetch
  - A5-07: solo API key sin SECRET → reason: 'API key not configured'
  - A5-08: HTTP 429 → reason: 'Binance rate limit exceeded'
  - A5-09: security — response body no contiene API key ni secret

- [x] IMPL A5: `apps/backend/src/services/credential-test.ts` — CredentialTestService.testBinance()
  - Usa createBinanceApiClient (no fetch directo — reutiliza cliente existente)
  - Mapea ValidationError(BINANCE_INVALID_CREDENTIALS) → 'Invalid API key'
  - Mapea ExternalApiError status 429 → 'Binance rate limit exceeded'
  - Mapea ExternalApiError status 403 → 'API key requires read permissions'
  - NUNCA loguea ni retorna key/secret

- [x] TEST A6: `apps/backend/src/routes/transactions.pending-price.test.ts` — 4 tests
  - A6-01: 3 pending items → { transactions: [...], count: 3 }
  - A6-02: sin pending → { transactions: [], count: 0 }
  - A6-03: 150 pending → { transactions: [100 items], count: 150 }
  - A6-04: NEGATIVE sin auth → 401

- [x] IMPL A6: `apps/backend/src/routes/transactions.ts` (extendido), `apps/backend/src/schemas/pending-price.ts`
  - GET /pending-price con query CTE: LIMIT 100 + COUNT total
  - Multi-tenant seguro: filtra por user_id via JOIN wallets

- [x] TEST A7: `apps/backend/src/services/balance-validator.test.ts` — 7 tests
  - A7-01: diferencias calculadas correctamente (ETH diff 0.0001, BTC diff 0.0001)
  - A7-02: filtrado de ruido — diff < 0.00000001 no aparece
  - A7-03: NEGATIVE sin wallet CEX_BINANCE → throws NotFoundError
  - A7-04: cache 60s — segunda llamada no llama getAccountAssets de nuevo
  - A7-05: GET /api/portfolio/validate-snapshot sin API keys → 400
  - A7-06: sin wallet CEX_BINANCE → 400
  - A7-07: NEGATIVE sin auth → 401

- [x] IMPL A7: `apps/backend/src/services/balance-validator.ts`, `apps/backend/src/schemas/balance-validation.ts`, `apps/backend/src/routes/portfolio.ts` (extendido)
  - BalanceValidatorService: wallet check → cache Binance snapshot 60s → engine balances → outer-join → filter |diff| < 0.00000001
  - dustNote: "Small differences are expected due to Binance dust conversion (non-goal in V1)."
  - GET /api/portfolio/validate-snapshot registrado en portfolioRoutes

## Archivos creados/modificados

### Nuevos archivos
- `apps/backend/src/schemas/credentials.ts`
- `apps/backend/src/schemas/pending-price.ts`
- `apps/backend/src/schemas/balance-validation.ts`
- `apps/backend/src/routes/credentials.ts`
- `apps/backend/src/services/credential-test.ts`
- `apps/backend/src/services/balance-validator.ts`
- `apps/backend/src/services/binance-sync.test.ts`
- `apps/backend/src/routes/credentials.test.ts`
- `apps/backend/src/routes/transactions.pending-price.test.ts`
- `apps/backend/src/services/balance-validator.test.ts`

### Archivos modificados
- `apps/backend/src/services/binance-sync.ts` — fix last_synced_at UPDATE best-effort
- `apps/backend/src/routes/transactions.ts` — añadido GET /pending-price + SQL CTE
- `apps/backend/src/routes/portfolio.ts` — añadido GET /validate-snapshot
- `apps/backend/src/index.ts` — registrado credentialRoutes con prefix '/api/credentials'

## Tests corridos (Batch A)

`npm run test:engine` — resultado final:

**Test Files: 1 failed (pre-existing) | 25 passed (26 total)**
**Tests: 273 passed**

La falla pre-existente es `apps/backend/src/services/__tests__/transaction.test.ts` que intenta importar `../../../../tests/e2e/db/factories.js` — archivo que existe solo en el contexto e2e. Esta falla existía antes de nuestra implementación (confirmado con git stash).

Todos los 34 tests nuevos de US-012 Batch A pasan:
- 3 tests A1 (binance-sync.test.ts)
- 23 tests A2-A5 (credentials.test.ts)
- 4 tests A6 (transactions.pending-price.test.ts)
- 7 tests A7 (balance-validator.test.ts)

---

## Batch B — Frontend: types + router + hooks

- [x] IMPL B1: `apps/frontend/src/types/settings.ts`
  - TOKEN_NETWORKS, WalletType, WALLET_TYPES, API_SERVICES, ApiService as const arrays
  - SettingsWallet, SettingsToken interfaces
  - OnChainSyncResult, CexSyncResult, SyncResultUnion discriminated union
  - SyncState per-wallet discriminated union (idle | syncing | success | error)
  - ApiKeysPresence interface
  - ApiKeyTestState discriminated union (idle | testing | connected | failed)
  - PendingTransfer interface (camelCase, blockTimestamp: Date)
  - BalanceDifference, BalanceValidationData interfaces

- [x] TEST B2 + IMPL B2: ruta /settings en router.tsx
  - `apps/frontend/src/routes/router.tsx` — added `/settings` route wrapped in ProtectedRoute importing SettingsPage
  - `apps/frontend/src/pages/settings/SettingsPage.tsx` — scaffold component (Batch C will fill sections)
  - `apps/frontend/src/pages/settings/__tests__/SettingsPage.spec.tsx` — 4 tests:
    - Renders Settings heading at /settings
    - Renders "Back to Portfolio" link
    - Router handles /settings without crashing
    - router.tsx includes /settings in route config (import-based check)

- [x] TEST B3 + IMPL B3: useSettingsWallets
  - `apps/frontend/src/hooks/settings/useSettingsWallets.ts`
  - `apps/frontend/src/hooks/settings/__tests__/useSettingsWallets.spec.tsx` — 6 tests:
    - fetches and maps last_synced_at to Date
    - maps snake_case to camelCase
    - loading true during fetch, false after
    - refetch() calls apiClient.get again
    - error state when fetch rejects
    - null last_synced_at handled correctly

- [x] TEST B4 + IMPL B4: useSyncWallet
  - `apps/frontend/src/hooks/settings/useSyncWallet.ts`
  - `apps/frontend/src/hooks/settings/__tests__/useSyncWallet.spec.tsx` — 5 tests:
    - sync('on-chain') → syncing → success with OnChainSyncResult
    - sync('cex') → success with CexSyncResult (kind, trades, converts, withdrawals, deposits)
    - two concurrent wallets have independent states
    - backend error → status 'error' with message
    - does NOT call apiClient.get (no internal refetch)

- [x] TEST B5 + IMPL B5: useSettingsTokens
  - `apps/frontend/src/hooks/settings/useSettingsTokens.ts`
  - `apps/frontend/src/hooks/settings/__tests__/useSettingsTokens.spec.tsx` — 6 tests:
    - fetches and maps snake_case to camelCase (isHidden, targetExitPrice)
    - updateToken({ isHidden: true }) → PUT with { is_hidden: true }; data updated on success
    - updateToken({ targetExitPrice: "5000" }) → PUT with { target_exit_price: "5000" }
    - updateToken({ targetExitPrice: null }) → PUT with { target_exit_price: null }
    - updateToken throws when PUT rejects; data unchanged
    - error state on initial fetch reject

- [x] TEST B6 + IMPL B6: useApiKeysStatus + useTestApiKey
  - `apps/frontend/src/hooks/settings/useApiKeysStatus.ts` — fetch-only, no refetch
  - `apps/frontend/src/hooks/settings/__tests__/useApiKeysStatus.spec.tsx` — 4 tests:
    - fetches /api/credentials and returns ApiKeysPresence
    - calls GET exactly once, no refetch
    - does not expose refetch function
    - error state when fetch fails
  - `apps/frontend/src/hooks/settings/useTestApiKey.ts` — per-service state, AbortController 10s
  - `apps/frontend/src/hooks/settings/__tests__/useTestApiKey.spec.tsx` — 8 tests:
    - all services start idle
    - test('etherscan') → connected with latencyMs
    - test('binance') → connected with assetCount
    - failed state with reason: 'Invalid API key'
    - failed state with reason: 'API key requires read permissions'
    - AbortError after 10s → reason: 'Request timed out' (fake timers)
    - etherscan test does not affect binance state (independence)
    - posts to correct endpoint per service

- [x] TEST B7a + TEST B7b + IMPL B7: usePendingPriceTransfers + useBalanceValidation
  - `apps/frontend/src/hooks/settings/usePendingPriceTransfers.ts`
  - `apps/frontend/src/hooks/settings/__tests__/usePendingPriceTransfers.spec.tsx` — 5 tests:
    - fetches and maps data (count, transactions array)
    - maps block_timestamp to Date
    - maps snake_case to camelCase
    - refetch() calls apiClient.get again
    - error → data null, error not-null
  - `apps/frontend/src/hooks/settings/useBalanceValidation.ts` — lazy, cooldown 60s
  - `apps/frontend/src/hooks/settings/__tests__/useBalanceValidation.spec.tsx` — 8 tests:
    - does NOT fetch on mount (state = idle)
    - validate() → loading → success
    - cooldownSecondsRemaining = 60 after success
    - cooldown decreases with fake timers (30s → 30, 60s → 0)
    - error state when fetch rejects
    - takenAt mapped to Date
    - GET called only after validate(), not on mount
    - cooldown reaches 0 and stays there

## Archivos creados (Batch B)

### Nuevos archivos
- `apps/frontend/src/types/settings.ts`
- `apps/frontend/src/pages/settings/SettingsPage.tsx`
- `apps/frontend/src/hooks/settings/useSettingsWallets.ts`
- `apps/frontend/src/hooks/settings/useSyncWallet.ts`
- `apps/frontend/src/hooks/settings/useSettingsTokens.ts`
- `apps/frontend/src/hooks/settings/useApiKeysStatus.ts`
- `apps/frontend/src/hooks/settings/useTestApiKey.ts`
- `apps/frontend/src/hooks/settings/usePendingPriceTransfers.ts`
- `apps/frontend/src/hooks/settings/useBalanceValidation.ts`
- `apps/frontend/src/pages/settings/__tests__/SettingsPage.spec.tsx`
- `apps/frontend/src/hooks/settings/__tests__/useSettingsWallets.spec.tsx`
- `apps/frontend/src/hooks/settings/__tests__/useSyncWallet.spec.tsx`
- `apps/frontend/src/hooks/settings/__tests__/useSettingsTokens.spec.tsx`
- `apps/frontend/src/hooks/settings/__tests__/useApiKeysStatus.spec.tsx`
- `apps/frontend/src/hooks/settings/__tests__/useTestApiKey.spec.tsx`
- `apps/frontend/src/hooks/settings/__tests__/usePendingPriceTransfers.spec.tsx`
- `apps/frontend/src/hooks/settings/__tests__/useBalanceValidation.spec.tsx`

### Archivos modificados
- `apps/frontend/src/routes/router.tsx` — added /settings route with ProtectedRoute + SettingsPage import

## Tests corridos (Batch B)

`npx vitest run --project frontend` — resultado final:

**Test Files: 61 passed (61 total)**
**Tests: 396 passed**

Tests nuevos de Batch B:
- 4 tests B2 (SettingsPage.spec.tsx)
- 6 tests B3 (useSettingsWallets.spec.tsx)
- 5 tests B4 (useSyncWallet.spec.tsx)
- 6 tests B5 (useSettingsTokens.spec.tsx)
- 4 tests B6a (useApiKeysStatus.spec.tsx)
- 8 tests B6b (useTestApiKey.spec.tsx)
- 5 tests B7a (usePendingPriceTransfers.spec.tsx)
- 8 tests B7b (useBalanceValidation.spec.tsx)
Total: 46 nuevos tests. Todos pasan.

---

## Batch C — Frontend: componentes

- [x] IMPL C1a: `apps/frontend/src/components/settings/SyncResultInline.tsx`
  - Discriminated union on `result.kind`: on-chain muestra synced/skipped/swaps; cex muestra 4 sub-categorías (trades/converts/withdrawals/deposits)

- [x] TEST C1 + IMPL C1: `apps/frontend/src/components/settings/PendingPriceBanner.tsx`
  - count=0 → null; data=null → null; error → null; count>0 → banner con texto "{count} TRANSFER_IN" + CTA
  - Link para tokens on-chain con contractAddress; botón disabled para CEX

- [x] TEST C2 + IMPL C2: `apps/frontend/src/components/settings/OnChainWalletsSection.tsx`
  - Address truncada: `addr.slice(0,6) + "…" + addr.slice(-4)`
  - Copy button con `navigator.clipboard.writeText` + feedback "Copied!" 2s (data-testid='copy-btn')
  - Botón Sync → `useSyncWallet.sync(id, 'on-chain')` → disabled+Syncing... durante in-flight
  - SyncResultInline tras éxito; error inline en rojo
  - Empty state "No on-chain wallets"; error state con Retry

- [x] TEST C3 + IMPL C3: `apps/frontend/src/components/settings/ExchangeAccountsSection.tsx`
  - Filtra walletType=CEX; badge "Connected" (verde) vs "Not configured" (gris)
  - Sync → `useSyncWallet.sync(id, 'cex')` → SyncResultInline con 4 sub-categorías
  - Llama pendingRefetch() y walletsRefetch() tras sync exitoso

- [x] TEST C4b + IMPL C4b: `apps/frontend/src/components/settings/TokenRow.tsx`
  - Toggle hidden: checkbox onChange → `onUpdate({ isHidden })` → disabled durante in-flight
  - Edit target price: input text → Save/Cancel visibles cuando isDirty
  - Save → `onUpdate({ targetExitPrice: val || null })`; Cancel → revierte draft
  - Validación: `/^\d+(\.\d+)?$/` o vacío; Save disabled si inválido o savingTarget
  - useEffect re-sincroniza draft cuando `token.targetExitPrice` cambia
  - SourceBadge: ETH→Etherscan, BSC→BSCScan, CEX_BINANCE→Binance

- [x] TEST C4c + IMPL C4c: `apps/frontend/src/components/settings/TokensSection.tsx`
  - Tabla con TokenRow por token; search input filtra por symbol
  - Toggle "Show hidden" (data-testid='show-hidden-toggle') — default off, oculta isHidden=true
  - Error state con Retry

- [x] TEST C5 + IMPL C5: `apps/frontend/src/components/settings/ApiKeysSection.tsx`
  - 4 filas: ETHERSCAN_API_KEY, BSCTRACE_API_KEY, BINANCE_API_KEY, BINANCE_SECRET_KEY
  - Inputs password read-only; `<span class="sr-only">` para presencia visible en textContent
  - Test buttons: habilitados solo si key configurada; Binance API+Secret comparten un botón
  - Estados inline: idle→nada, testing→"Testing…", connected→verde+meta, failed→rojo
  - Container HTML no contiene strings de 20+ chars uppercase

- [x] TEST C6 + IMPL C6: `apps/frontend/src/components/settings/BalanceValidationSection.tsx`
  - Colapsada por defecto (data-testid='bv-toggle')
  - Botón validate disabled si BINANCE_API_KEY=false o sin wallet CEX_BINANCE
  - Loading → spinner; Success → tabla (Asset/Engine/Snapshot/Diff) + dustNote
  - Cooldown: estado success+cooldown → botón "Available in Xs" disabled
  - Error → mensaje + Retry

- [x] TEST C7 + IMPL C7: `apps/frontend/src/pages/settings/SettingsPage.tsx` (composición completa)
  - Compone: PendingPriceBanner → OnChainWalletsSection → ExchangeAccountsSection → TokensSection → ApiKeysSection → BalanceValidationSection
  - Header con h1 "Settings" + link "← Back to Portfolio"
  - Aislamiento: error en ApiKeysStatus no rompe OnChain/Exchange/Tokens
  - Todos los hooks llamados en mount (carga paralela)

## Archivos creados (Batch C)

### Nuevos archivos
- `apps/frontend/src/components/settings/PendingPriceBanner.tsx`
- `apps/frontend/src/components/settings/SyncResultInline.tsx`
- `apps/frontend/src/components/settings/OnChainWalletsSection.tsx`
- `apps/frontend/src/components/settings/ExchangeAccountsSection.tsx`
- `apps/frontend/src/components/settings/TokenRow.tsx`
- `apps/frontend/src/components/settings/TokensSection.tsx`
- `apps/frontend/src/components/settings/ApiKeysSection.tsx`
- `apps/frontend/src/components/settings/BalanceValidationSection.tsx`
- `apps/frontend/src/components/settings/__tests__/PendingPriceBanner.spec.tsx`
- `apps/frontend/src/components/settings/__tests__/SyncResultInline.spec.tsx`
- `apps/frontend/src/components/settings/__tests__/OnChainWalletsSection.spec.tsx`
- `apps/frontend/src/components/settings/__tests__/ExchangeAccountsSection.spec.tsx`
- `apps/frontend/src/components/settings/__tests__/TokenRow.spec.tsx`
- `apps/frontend/src/components/settings/__tests__/TokensSection.spec.tsx`
- `apps/frontend/src/components/settings/__tests__/ApiKeysSection.spec.tsx`
- `apps/frontend/src/components/settings/__tests__/BalanceValidationSection.spec.tsx`
- `apps/frontend/src/pages/settings/__tests__/SettingsPageC7.spec.tsx`

### Archivos modificados
- `apps/frontend/src/pages/settings/SettingsPage.tsx` — composición completa con todas las secciones

## Tests corridos (Batch C)

`npx vitest run --project frontend` — resultado final:

**Test Files: 70 passed (70 total)**
**Tests: 464 passed**

Tests nuevos de Batch C:
- 5 tests C1 (PendingPriceBanner.spec.tsx)
- 2 tests SyncResultInline (SyncResultInline.spec.tsx)
- 11 tests C2 (OnChainWalletsSection.spec.tsx)
- 6 tests C3 (ExchangeAccountsSection.spec.tsx)
- 11 tests C4b (TokenRow.spec.tsx)
- 5 tests C4c (TokensSection.spec.tsx)
- 11 tests C5 (ApiKeysSection.spec.tsx)
- 8 tests C6 (BalanceValidationSection.spec.tsx)
- 9 tests C7 (SettingsPageC7.spec.tsx)
Total: 68 nuevos tests. Todos pasan.
