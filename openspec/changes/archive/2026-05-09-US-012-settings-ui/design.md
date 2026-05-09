# Design — US-012 Settings UI

## Overview

US-012 entrega la página `/settings` que centraliza la administración operativa del portfolio. La arquitectura sigue el patrón ya consolidado en el proyecto: **backend Fastify con plugin-per-feature + Zod schemas co-locados; frontend React 19 con secciones modulares, cada una con su hook propio que envuelve `apiClient`**. No se introduce librería de fetching nueva (ni react-query ni SWR) — se mantiene `useState + useEffect` con el patrón establecido en `usePortfolio` / `useTokenDetail`.

El backend gana tres plugins nuevos (`credentials`, `transactions-pending` extiende el plugin `transactions` existente, y opcionalmente `portfolio-validate` extiende `portfolio`) más un servicio `CredentialTestService` que reutiliza los clientes ya implementados en `apps/backend/src/sync/clients/`. El fix de `wallets.last_synced_at` en `BinanceSyncService.sync()` es una sola query SQL al final del método, dentro del mismo `pgc` que ya está conectado. La decisión D1 (API keys solo desde env) elimina cualquier necesidad de tocar la tabla `api_credentials` o el cifrado AES-256 — `GET /api/credentials` simplemente lee `process.env` y devuelve booleans.

El frontend introduce una `SettingsPage` que es un contenedor delgado: ensambla seis secciones (`PendingPriceBanner`, `OnChainWalletsSection`, `ExchangeAccountsSection`, `TokensSection`, `ApiKeysSection`, `BalanceValidationSection`), cada una con su hook de datos en `apps/frontend/src/hooks/settings/`. Las secciones son independientes: un fallo en API keys no rompe el render de tokens, y los skeletons aparecen por sección. Esto permite testear cada componente con Vitest en aislamiento (un spec por sección, mockeando `apiClient`). La ruta `/settings` se añade en `router.tsx` envuelta en `<ProtectedRoute>`. Convenciones de tipado siguen las reglas del proyecto: `as const + typeof` para enums (no `enum` nativo), `type` para uniones/intersecciones, `interface` para shapes de props, sin `any`.

## Backend

### Nuevos archivos

- `apps/backend/src/routes/credentials.ts` — Plugin Fastify con `GET /api/credentials` y `POST /api/credentials/test/:service`.
- `apps/backend/src/services/credential-test.ts` — `CredentialTestService` que dispatcha a `testEtherscan()`, `testBsctrace()`, `testBinance()`. Reusa los clientes existentes (`createEtherscanClient`, `createBSCTraceClient`, `createBinanceApiClient`).
- `apps/backend/src/schemas/credentials.ts` — Schemas Zod para presencia y test results.
- `apps/backend/src/schemas/pending-price.ts` — Schema `PendingTransferSchema` y `PendingPriceResponseSchema`.
- `apps/backend/src/schemas/balance-validation.ts` — Schema `BalanceValidationResponseSchema` (sólo si se confirma sección Balance Validation, ver D4).
- `apps/backend/src/services/balance-validator.ts` — `BalanceValidatorService` que compara motor vs snapshot Binance.

### Tipos Zod (shapes exactas)

`apps/backend/src/schemas/credentials.ts`:

```ts
import { z } from 'zod';

// GET /api/credentials response
export const CredentialsPresenceSchema = z.object({
  ETHERSCAN_API_KEY: z.boolean(),
  BSCTRACE_API_KEY: z.boolean(),
  BINANCE_API_KEY: z.boolean(),
  BINANCE_SECRET_KEY: z.boolean(),
});
export type CredentialsPresence = z.infer<typeof CredentialsPresenceSchema>;

// POST /api/credentials/test/:service params
export const CredentialServiceParamSchema = z.object({
  service: z.enum(['etherscan', 'bsctrace', 'binance']),
});
export type CredentialServiceParam = z.infer<typeof CredentialServiceParamSchema>;

// POST /api/credentials/test/:service response (discriminated union)
export const CredentialTestSuccessSchema = z.object({
  status: z.literal('connected'),
  meta: z
    .object({
      assetCount: z.number().int().nonnegative().optional(),
      latencyMs: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export const CredentialTestFailureSchema = z.object({
  status: z.literal('failed'),
  reason: z.string().min(1),
});

export const CredentialTestResultSchema = z.discriminatedUnion('status', [
  CredentialTestSuccessSchema,
  CredentialTestFailureSchema,
]);
export type CredentialTestResult = z.infer<typeof CredentialTestResultSchema>;
```

`apps/backend/src/schemas/pending-price.ts`:

```ts
import { z } from 'zod';

export const PendingTransferSchema = z.object({
  id: z.uuid(),
  wallet_id: z.uuid(),
  token_id: z.uuid(),
  token_symbol: z.string(),
  token_network: z.enum(['ETH', 'BSC', 'CEX_BINANCE']),
  amount: z.string(),
  block_timestamp: z.string(), // ISO
  tx_hash: z.string().nullable(),
  from_address: z.string().nullable(),
});
export type PendingTransfer = z.infer<typeof PendingTransferSchema>;

export const PendingPriceResponseSchema = z.object({
  transactions: z.array(PendingTransferSchema).max(100),
  count: z.number().int().nonnegative(),
});
export type PendingPriceResponse = z.infer<typeof PendingPriceResponseSchema>;
```

`apps/backend/src/schemas/balance-validation.ts`:

```ts
import { z } from 'zod';

export const BalanceDifferenceSchema = z.object({
  asset: z.string(),
  engineBalance: z.string(),     // string decimal
  snapshotBalance: z.string(),   // string decimal
  diff: z.string(),              // engineBalance - snapshotBalance, string decimal
});
export type BalanceDifference = z.infer<typeof BalanceDifferenceSchema>;

export const BalanceValidationResponseSchema = z.object({
  differences: z.array(BalanceDifferenceSchema),
  totalEngineUsd: z.string(),
  totalSnapshotUsd: z.string(),
  takenAt: z.string(),           // ISO
  dustNote: z.string(),          // educational static text
});
export type BalanceValidationResponse = z.infer<typeof BalanceValidationResponseSchema>;
```

### Modificaciones a archivos existentes

- `apps/backend/src/services/binance-sync.ts` — Al final de `sync()`, **antes** del `return`, añadir:
  ```ts
  await pgc.query(
    'UPDATE wallets SET last_synced_at = now() WHERE id = $1',
    [walletId],
  );
  ```
  La query va dentro del `try` del `pool.connect()` para reusar la conexión, fuera del `BEGIN/COMMIT` interno (cada sub-método ya commitea su propio batch). Si la query falla, se loguea via `fastify.log.warn` (inyectado por el cliente Binance) pero NO se propaga — el sync ya commiteó las transacciones, perder el touch de `last_synced_at` no debe romper la respuesta. Patrón:
  ```ts
  try {
    await pgc.query('UPDATE wallets SET last_synced_at = now() WHERE id = $1', [walletId]);
  } catch (err) {
    // best-effort — sync data is already persisted
  }
  ```

- `apps/backend/src/routes/transactions.ts` — Añadir handler `GET /pending-price` (ver query SQL más abajo).

- `apps/backend/src/routes/portfolio.ts` — Añadir handler `GET /validate-snapshot` que delega a `BalanceValidatorService`.

- `apps/backend/src/index.ts` — Registrar el nuevo plugin:
  ```ts
  const { credentialRoutes } = await import('./routes/credentials.js');
  await fastify.register(credentialRoutes, { prefix: '/api/credentials' });
  ```
  Se ubica después de `syncRoutes` y antes de `healthPlugin` para mantener la convención (rutas `/api/*` antes de health).

### Lógica de `POST /api/credentials/test/etherscan`

Llama a `https://api.etherscan.io/v2/api?chainid=1&module=stats&action=ethsupply&apikey=<key>` (endpoint barato, no devuelve datos sensibles). Mapea respuestas:

- HTTP 2xx + `data.status === '1'` → `{ status: 'connected', meta: { latencyMs } }`.
- HTTP 2xx + `data.status === '0'` con mensaje `Invalid API Key` → `{ status: 'failed', reason: 'Invalid API key' }`.
- HTTP 2xx + `data.status === '0'` con mensaje rate-limit → `{ status: 'failed', reason: 'Rate limit exceeded' }`.
- HTTP 401/403 → `{ status: 'failed', reason: 'Invalid API key' }`.
- HTTP 5xx o timeout → `{ status: 'failed', reason: 'Etherscan unreachable' }`.
- Si `env.ETHERSCAN_API_KEY` no está seteada → `{ status: 'failed', reason: 'Not configured' }` sin llamar a la red.

Implementación: el método `testEtherscan(apiKey: string)` en `CredentialTestService` usa `fetch` directo con `AbortController` timeout 8s. **No** se reusa `createEtherscanClient` para esto porque sus métodos esperan `address/blocks` y normalizar — el test es una llamada trivial.

### Lógica de `POST /api/credentials/test/bsctrace`

Análogo a Etherscan pero contra `https://api.bsctrace.com/api?module=stats&action=bnbsupply&apikey=<key>` (verificar la URL real en `apps/backend/src/sync/clients/bsctrace.ts`; si BSCTrace no expone `bnbsupply`, usar el endpoint más barato que requiera auth válida — típicamente `module=account&action=balance` con una address dummy bien formada). Mapeo de errores idéntico al de Etherscan.

### Lógica de `POST /api/credentials/test/binance`

Llama internamente a `client.assertConfigured()` para validar presencia de api key + secret. Si falta alguna → `{ status: 'failed', reason: 'Not configured: BINANCE_API_KEY' }` (o el que falte). Luego llama a `client.getAccountAssets()`. Mapea:

- `assets.length >= 0` (success) → `{ status: 'connected', meta: { assetCount: assets.length, latencyMs } }`.
- `ValidationError` con code `BINANCE_INVALID_CREDENTIALS` (Binance code -2014/-2015 ya parseado en `binance-api.ts`) → `{ status: 'failed', reason: 'Invalid Binance API credentials or insufficient permissions' }`.
- `ApiKeyMissingError` → `{ status: 'failed', reason: 'Not configured: <key name>' }`.
- `ExternalApiError` con `status === 429` → `{ status: 'failed', reason: 'Binance rate limit exceeded' }`.
- Otros `ExternalApiError` → `{ status: 'failed', reason: 'Binance unreachable' }`.
- Timeout (AbortController 8s) → `{ status: 'failed', reason: 'Binance test timed out' }`.

El servicio **nunca** loguea ni devuelve la API key ni el secret en ningún campo de la respuesta.

### `GET /api/transactions/pending-price`

Query SQL:

```sql
WITH pending AS (
  SELECT
    t.id,
    t.wallet_id,
    t.token_id,
    tk.symbol AS token_symbol,
    tk.network AS token_network,
    t.amount,
    t.block_timestamp,
    t.tx_hash,
    t.from_address
  FROM transactions t
  JOIN tokens tk ON tk.id = t.token_id
  JOIN wallets w ON w.id = t.wallet_id
  WHERE w.user_id = $1
    AND t.type = 'TRANSFER_IN'
    AND t.cost_source = 'MANUAL'
    AND t.price_usd IS NULL
  ORDER BY t.block_timestamp DESC
  LIMIT 100
)
SELECT
  (SELECT COUNT(*) FROM transactions t
    JOIN wallets w ON w.id = t.wallet_id
    WHERE w.user_id = $1
      AND t.type = 'TRANSFER_IN'
      AND t.cost_source = 'MANUAL'
      AND t.price_usd IS NULL) AS total_count,
  (SELECT json_agg(p) FROM pending p) AS items;
```

Handler retorna `{ transactions: items ?? [], count: total_count }` validado por `PendingPriceResponseSchema`. Si el COUNT > 100, el array está truncado pero el banner muestra el total real. El frontend usa `count` para el badge y `transactions` para el listado opcional.

### `GET /api/portfolio/validate-snapshot`

Flujo:

1. Verificar que existe wallet `CEX_BINANCE` para el usuario; si no → 404 `{ statusCode: 404, error: 'NOT_FOUND', message: 'No Binance wallet configured' }`.
2. Llamar a `binanceClient.getAccountAssets()` con timeout 30s. Filtrar a `free + locked > 0`. Cachear el resultado en memoria 60s (key = userId).
3. Cargar balances del motor: `SELECT t.symbol AS asset, SUM(p.balance) AS balance FROM positions p JOIN tokens t ON t.id=p.token_id JOIN wallets w ON w.id=p.wallet_id WHERE w.wallet_type='CEX' AND w.user_id=$1 AND p.status='OPEN' GROUP BY t.symbol`.
4. Outer-join por `asset` (uppercase). Para cada par calcular `diff = engineBalance - snapshotBalance` con `Decimal`. Filtrar `|diff| < 0.00000001` (truncamiento de precisión Binance).
5. Calcular `totalEngineUsd` y `totalSnapshotUsd` consultando `priceService.getCexPrice(asset)` por cada asset distinto (cacheado 10s ya).
6. Devolver `BalanceValidationResponseSchema` con `dustNote = "Small differences are expected due to dust conversions, which Cryptofolio does not track in V1."`.

Errores:
- Si Binance falla: 502 `{ statusCode: 502, error: 'BINANCE_UNAVAILABLE', message }`.
- Si no hay keys configuradas: 400 `{ statusCode: 400, error: 'BINANCE_NOT_CONFIGURED', message }`.

## Frontend

### Árbol de archivos nuevos

```
apps/frontend/src/
├── pages/
│   └── SettingsPage.tsx
├── components/settings/
│   ├── PendingPriceBanner.tsx
│   ├── OnChainWalletsSection.tsx
│   ├── ExchangeAccountsSection.tsx
│   ├── TokensSection.tsx
│   ├── TokenRow.tsx
│   ├── ApiKeysSection.tsx
│   ├── BalanceValidationSection.tsx
│   └── SyncResultInline.tsx
├── hooks/settings/
│   ├── useSettingsWallets.ts
│   ├── useSyncWallet.ts
│   ├── useSettingsTokens.ts
│   ├── useApiKeysStatus.ts
│   ├── useTestApiKey.ts
│   ├── usePendingPriceTransfers.ts
│   └── useBalanceValidation.ts
└── types/
    └── settings.ts
```

Nota: NO se sobreescribe `apps/frontend/src/hooks/useWallets.ts` (lo usa `AddTransactionPage`); se crea `useSettingsWallets.ts` con un shape más rico (`last_synced_at`, `address`).

### Tipos TypeScript (`apps/frontend/src/types/settings.ts`)

```ts
// ── Network/source enums (as const, no native enum) ───────────────────────────
export const TOKEN_NETWORKS = ['ETH', 'BSC', 'CEX_BINANCE'] as const;
export type TokenNetwork = typeof TOKEN_NETWORKS[number];

export const WALLET_TYPES = ['ON_CHAIN', 'CEX'] as const;
export type WalletType = typeof WALLET_TYPES[number];

export const API_SERVICES = ['etherscan', 'bsctrace', 'binance'] as const;
export type ApiService = typeof API_SERVICES[number];

// ── Wallet ────────────────────────────────────────────────────────────────────
export interface SettingsWallet {
  id: string;
  walletType: WalletType;
  address: string | null;
  network: string;
  label: string | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
}

// ── Token (settings view) ─────────────────────────────────────────────────────
export interface SettingsToken {
  id: string;
  symbol: string;
  name: string | null;
  network: TokenNetwork;
  contractAddress: string | null;
  binanceSymbol: string | null;
  isHidden: boolean;
  targetExitPrice: string | null; // string decimal
}

// ── Sync results (discriminated union) ────────────────────────────────────────
export interface OnChainSyncResult {
  kind: 'on-chain';
  synced: number;
  skipped: number;
  swapsDecomposed: number;
  transfersPendingCost: number;
  transfersInheritedFromCEX: number;
}

export interface CexSyncResult {
  kind: 'cex';
  trades: { synced: number; skipped: number; symbolsProcessed: number };
  converts: { synced: number; skipped: number };
  withdrawals: { synced: number; skipped: number };
  deposits: { synced: number; skipped: number; inherited: number; manual: number };
  tokensCreated: number;
}

export type SyncResultUnion = OnChainSyncResult | CexSyncResult;

// ── Per-wallet sync state ─────────────────────────────────────────────────────
export type SyncState =
  | { status: 'idle' }
  | { status: 'syncing' }
  | { status: 'success'; result: SyncResultUnion; finishedAt: Date }
  | { status: 'error'; message: string };

// ── API keys ──────────────────────────────────────────────────────────────────
export interface ApiKeysPresence {
  ETHERSCAN_API_KEY: boolean;
  BSCTRACE_API_KEY: boolean;
  BINANCE_API_KEY: boolean;
  BINANCE_SECRET_KEY: boolean;
}

export type ApiKeyTestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'connected'; meta?: { assetCount?: number; latencyMs?: number } }
  | { status: 'failed'; reason: string };

// ── Pending TRANSFER_IN ───────────────────────────────────────────────────────
export interface PendingTransfer {
  id: string;
  walletId: string;
  tokenId: string;
  tokenSymbol: string;
  tokenNetwork: TokenNetwork;
  amount: string;
  blockTimestamp: Date;
  txHash: string | null;
  fromAddress: string | null;
}

// ── Balance validation ────────────────────────────────────────────────────────
export interface BalanceDifference {
  asset: string;
  engineBalance: string;
  snapshotBalance: string;
  diff: string;
}

export interface BalanceValidationData {
  differences: BalanceDifference[];
  totalEngineUsd: string;
  totalSnapshotUsd: string;
  takenAt: Date;
  dustNote: string;
}
```

### Contrato de cada hook

Todos los hooks siguen el patrón establecido (`{ data, loading, error, refetch }`) salvo los que ejecutan acciones puntuales (test, sync) que exponen `{ state, run }`.

**`useSettingsWallets`**
```ts
function useSettingsWallets(): {
  data: SettingsWallet[] | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
};
```
Fetch de `GET /api/wallets`, mapea `last_synced_at: string | null` a `Date | null`. Sin filtros — el caller filtra por `walletType`.

**`useSyncWallet`**
```ts
function useSyncWallet(): {
  states: Record<string, SyncState>;          // walletId → state
  sync: (walletId: string, kind: 'on-chain' | 'cex') => Promise<void>;
};
```
`sync` setea `{ status: 'syncing' }` por walletId, llama `POST /api/sync/:walletId`, parsea el response según `kind` al union correspondiente, actualiza el record. NO hace refetch de wallets internamente; el caller orquesta `refetch` en el callback `onSuccess`.

**`useSettingsTokens`**
```ts
function useSettingsTokens(): {
  data: SettingsToken[] | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  updateToken: (id: string, patch: Partial<Pick<SettingsToken, 'isHidden' | 'targetExitPrice'>>) => Promise<void>;
};
```
`updateToken` hace `PUT /api/tokens/:id` con el patch en snake_case. Optimistic NO en V1 — actualiza local sólo en éxito (D6 implication).

**`useApiKeysStatus`**
```ts
function useApiKeysStatus(): {
  data: ApiKeysPresence | null;
  loading: boolean;
  error: Error | null;
};
```
Fetch único de `GET /api/credentials`. No expone `refetch` (el estado del env no cambia sin redeploy).

**`useTestApiKey`**
```ts
function useTestApiKey(): {
  states: Record<ApiService, ApiKeyTestState>;
  test: (service: ApiService) => Promise<void>;
};
```
`test('binance')` → `POST /api/credentials/test/binance`, valida response contra discriminated union, actualiza `states['binance']`. Cooldown UI manejado por el componente, no por el hook.

**`usePendingPriceTransfers`**
```ts
function usePendingPriceTransfers(): {
  data: { transactions: PendingTransfer[]; count: number } | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
};
```

**`useBalanceValidation`** (lazy)
```ts
function useBalanceValidation(): {
  state: 'idle' | 'loading' | 'success' | 'error';
  data: BalanceValidationData | null;
  error: Error | null;
  validate: () => Promise<void>;
  cooldownSecondsRemaining: number;
};
```
NO fetcha en mount. `validate` setea `loading`, llama `GET /api/portfolio/validate-snapshot`, en éxito guarda `data` y arranca cooldown 60s. Mientras `cooldownSecondsRemaining > 0`, el componente deshabilita el botón.

### Router — añadir `/settings`

Diff en `apps/frontend/src/routes/router.tsx`:

```diff
 import { AddTransactionPage } from "../pages/AddTransactionPage";
+import { SettingsPage } from "../pages/SettingsPage";

 export function ProtectedRoute({ children }: { children: React.ReactNode }) {
   ...
 }

 export const router = createBrowserRouter([
   ...
   {
     path: "/transactions/new",
     element: (
       <ProtectedRoute>
         <AddTransactionPage />
       </ProtectedRoute>
     ),
   },
+  {
+    path: "/settings",
+    element: (
+      <ProtectedRoute>
+        <SettingsPage />
+      </ProtectedRoute>
+    ),
+  },
 ]);
```

Link de navegación: el header actual de `DashboardPage` tiene un grupo flex con "Add Transaction" + `RefreshIndicator`. Añadir un `<Link to="/settings">` con icono ⚙️ (texto "Settings" en mobile, icono en desktop) en ese grupo. Como no existe un `AppLayout` compartido en V1, se duplica el link en `DashboardPage` y en `SettingsPage` (ambas tienen header propio). Aceptable porque son dos puntos de entrada — extraer a un layout es out of scope.

### Componente `SettingsPage` — estructura

```tsx
export function SettingsPage() {
  return (
    <main className="min-h-screen bg-gray-950 p-6 text-white">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <Link to="/" className="text-sm text-indigo-400 hover:text-indigo-300">← Back to Portfolio</Link>
      </header>

      <PendingPriceBanner />

      <div className="space-y-6">
        <OnChainWalletsSection />
        <ExchangeAccountsSection />
        <TokensSection />
        <ApiKeysSection />
        <BalanceValidationSection />
      </div>
    </main>
  );
}
```

`SettingsPage` NO tiene loading/error global. Cada sección renderiza su propio skeleton/error (`<SectionCard>` shared wrapper con `rounded-xl bg-gray-900 p-6`).

### Componente `OnChainWalletsSection`

Props: ninguna. Hooks internos: `useSettingsWallets`, `useSyncWallet`, `useToast`, `usePendingPriceTransfers` (para invalidar tras sync).

Estado:
- Usa `data.filter(w => w.walletType === 'ON_CHAIN')`.
- Tabla con columnas: Label · Address (truncated `0x123…abcd`) · Network (`<NetworkBadge/>`) · Last synced (relative via `useRelativeTime` per-row sub-componente `LastSyncedCell`) · Sync button.
- Click "Sync" → `useSyncWallet.sync(wallet.id, 'on-chain')`.
  - Mientras `state.status === 'syncing'`: botón disabled, spinner inline.
  - En `success`: el botón vuelve a habilitarse, abajo del row se renderiza `<SyncResultInline result={state.result}/>` (fade-out automático tras 10s o al siguiente sync).
  - En `error`: toast con `state.message` + botón vuelve a habilitarse.
- Al success: `walletsRefetch()` + `pendingRefetch()`.

Comportamiento NEGATIVE:
- Si `data === null && error !== null`: render `<SectionError onRetry={refetch}/>`.
- Si lista vacía: `<EmptyState>No on-chain wallets registered</EmptyState>`.

### Componente `ExchangeAccountsSection`

Props: ninguna. Hooks: `useSettingsWallets`, `useSyncWallet`, `useToast`, `usePendingPriceTransfers`.

Filtrado a `walletType === 'CEX'`. Visualmente similar a `OnChainWalletsSection` pero el `<SyncResultInline>` para CEX expande las 4 sub-categorías:
```
Trades: 12 synced | 3 skipped | 2 symbols
Converts: 1 synced | 0 skipped
Withdrawals: 0 synced | 0 skipped
Deposits: 5 synced | 0 skipped (3 inherited, 2 manual)
Tokens created: 2
```

Si no hay wallet CEX: render `<EmptyState>No exchange accounts</EmptyState>` con CTA "Add Binance via API" → link a documentación o `/transactions/new` (out-of-scope la creación inline).

### Componente `TokensSection`

Props: ninguna. Hooks: `useSettingsTokens`, `useToast`.

Tabla con filas de `TokenRow` (componente separado). Columnas:
- Symbol + Name
- Source badge (`<SourceBadge>` derivado del network: `ETH→ETHERSCAN`, `BSC→BSCTRACE`, `CEX_BINANCE→BINANCE`)
- Hidden (toggle switch) — toggle inmediato, llama `updateToken(id, { isHidden: !current })`. Optimistic NO; mientras está in-flight, el switch se deshabilita.
- Target Exit Price (input + Save/Cancel inline)

Filtros UI: input de search por symbol; toggle "Show hidden tokens" (default off, oculta tokens con `isHidden=true`).

### Componente `TokenRow`

Props:
```ts
interface TokenRowProps {
  token: SettingsToken;
  onUpdate: (patch: Partial<Pick<SettingsToken, 'isHidden' | 'targetExitPrice'>>) => Promise<void>;
}
```

Estado local:
```ts
const [draftTargetPrice, setDraftTargetPrice] = useState<string>(token.targetExitPrice ?? '');
const [savingHidden, setSavingHidden] = useState(false);
const [savingTarget, setSavingTarget] = useState(false);
```

Behaviour:
- Toggle hidden: `onChange` → setSavingHidden(true) → await `onUpdate({ isHidden })` → setSavingHidden(false). Toast en error, sin optimistic.
- Edit target price:
  - `draftTargetPrice !== (token.targetExitPrice ?? '')` → mostrar Save + Cancel.
  - Save: validación cliente (`/^\d+(\.\d+)?$/` o vacío para limpiar) → `onUpdate({ targetExitPrice: draftTargetPrice === '' ? null : draftTargetPrice })`. En éxito el server actualiza `token.targetExitPrice`, el effect que re-sincroniza el draft hace que Save desaparezca. En error: toast, draft permanece.
  - Cancel: `setDraftTargetPrice(token.targetExitPrice ?? '')`.
  - Botón Save deshabilitado mientras `savingTarget === true`.

Sin `useMemo`/`useCallback` (regla react-19).

### Componente `ApiKeysSection`

Props: ninguna. Hooks: `useApiKeysStatus`, `useTestApiKey`.

Layout: 4 filas, una por key (Etherscan, BSCTrace, Binance API Key, Binance Secret Key).
Cada fila:
- Label + estado: `Configured` (✓ verde si `presence[key] === true`) o `Not configured` (⚠ amarillo si `false`).
- Input `type="password"` deshabilitado con placeholder según el estado.
- Botón "Test" (sólo para los servicios `etherscan`, `bsctrace`, `binance` — el de `BINANCE_SECRET_KEY` reusa el mismo botón Test que `BINANCE_API_KEY` porque el test los valida juntos; visualmente se agrupan bajo "Binance" con un único botón).
- Resultado del test inline a la derecha del botón:
  - `idle`: nada.
  - `testing`: spinner + "Testing…".
  - `connected`: ✓ "Connected" + meta opcional ("12 assets, 340ms").
  - `failed`: ✗ "Failed: <reason>".

`use<TestApiKey>.test(service)` se invoca en click. El estado se mantiene per-service hasta el próximo click (no se auto-resetea).

### Componente `BalanceValidationSection`

Props: ninguna. Hooks: `useBalanceValidation`, `useApiKeysStatus`, `useSettingsWallets`.

Estado UI:
- Sección **colapsada por defecto** (caret + click para expandir).
- Mientras `state === 'idle'`:
  - Si no hay wallet `CEX_BINANCE` o `presence.BINANCE_API_KEY === false`: botón disabled con tooltip "Configure Binance API keys and add a Binance wallet to enable".
  - Si todo configurado: botón "Validate vs Binance Snapshot" habilitado.
- `loading`: botón disabled + spinner + texto "Fetching snapshot…".
- `success`: render tabla con columnas Asset · Engine · Snapshot · Diff (color rojo si `|diff| > 1`, gris si menor — dust). Header con `Last validated: <relative time via useRelativeTime>`. Footer fijo: el `dustNote`. Botón "Validate again" deshabilitado durante cooldown (`cooldownSecondsRemaining > 0` → texto "Available in Xs").
- `error`: mensaje `<ErrorBlock>` con `error.message` + botón Retry.

### Componente `PendingPriceBanner`

Props: ninguna. Hook: `usePendingPriceTransfers`.

Render:
- Si `data === null` (loading): nada (no skeleton — banner es secundario).
- Si `data.count === 0`: nada.
- Si `data.count > 0`: card amarilla `rounded-xl bg-yellow-900/30 border border-yellow-700 p-4 mb-6`:
  ```
  ⚠️ {count} TRANSFER_IN transactions need a price.
  [Review pending →]
  ```
  El CTA es un link a `/transactions/pending` (out-of-scope crear esa página en US-012; el botón puede ser un placeholder que abra un toast informativo "Coming soon" o redirija al detalle del primer token afectado: `/token/<contract>/<network>` filtrando por la transacción pendiente). **Decisión final**: en V1 el botón hace `Link` a `/token/${first.tokenId.contractAddress}/${first.tokenNetwork}` cuando hay datos disponibles; si la transferencia es CEX (sin contract_address), el link queda como `disabled` mostrando tooltip "Open the token detail to set the price".

### Componente `SyncResultInline`

Props:
```ts
interface SyncResultInlineProps {
  result: SyncResultUnion;
}
```

Render con discriminated union:
```tsx
if (result.kind === 'on-chain') { ... }
else { ... }  // result.kind === 'cex'
```

## Test strategy

### Backend tests (Vitest, `npm run test:engine` / `npm run test:sync`)

`apps/backend/src/routes/credentials.spec.ts`:
- Happy path GET: stub `process.env.ETHERSCAN_API_KEY`, body should equal `{ ETHERSCAN_API_KEY: true, ... }`.
- NEGATIVE: response body must NOT contain any string matching `/^[A-Z0-9]{20,}$/` (defensive test against accidental leak — D1 risk).
- POST `test/etherscan`: mock `fetch` returning `{ status: '1', result: '...' }` → expect `{ status: 'connected' }`.
- NEGATIVE POST `test/etherscan`: mock `fetch` 401 → expect `{ status: 'failed', reason: 'Invalid API key' }`.
- NEGATIVE POST `test/etherscan`: mock `fetch` rejection → `{ status: 'failed', reason: 'Etherscan unreachable' }`.
- POST `test/binance`: mock `BinanceApiClient.getAccountAssets()` → `[{asset:'BTC',...}]` → expect `{ status: 'connected', meta: { assetCount: 1 } }`.
- NEGATIVE POST `test/binance`: client throws `ValidationError('BINANCE_INVALID_CREDENTIALS')` → `{ status: 'failed', reason: 'Invalid Binance API credentials or insufficient permissions' }`.
- NEGATIVE POST `test/:service` con `service='unknown'` → 400 ZodError.

`apps/backend/src/services/credential-test.spec.ts`:
- Parsing de errores Etherscan: `status:'0', message:'NOTOK'` con texto que contiene "Invalid API Key" → reason adecuado.
- Timeout (AbortController) → `{ status: 'failed', reason: '<service> test timed out' }`.

`apps/backend/src/routes/transactions.pending-price.spec.ts`:
- Seed 3 TRANSFER_IN con `cost_source='MANUAL'` y `price_usd IS NULL`, 1 TRANSFER_IN con `cost_source='INHERITED'`, 1 TRANSFER_OUT → expect `count = 3`, `transactions.length = 3`.
- NEGATIVE: usuario distinto no ve los pendientes de otro user (multi-tenant safety, aunque el sistema es monousuario el filter está en la query).
- LIMIT 100: insertar 105 → `transactions.length = 100`, `count = 105`.

`apps/backend/src/services/binance-sync.spec.ts` (extender el spec existente):
- Tras `sync()` exitoso, `SELECT last_synced_at FROM wallets WHERE id=$1` debe retornar timestamp `> beforeSync`.
- NEGATIVE: si la query del UPDATE falla (mock pgc.query a rechazar para esa query), `sync()` retorna su `BinanceSyncResult` normal sin lanzar excepción.

`apps/backend/src/services/balance-validator.spec.ts`:
- Mock `binanceClient.getAccountAssets()` y query de positions → calcular differences correctamente.
- Filtrado de dust (`|diff| < 0.00000001`).
- NEGATIVE: si no hay wallet CEX → throws `NotFoundError`.

### Frontend tests (Vitest `--project frontend`, jsdom + @testing-library/react)

**Convenciones**:
- Sin `@testing-library/jest-dom`. Usar assertions DOM nativas: `expect(el.textContent).toBe('...')`, `expect(el.getAttribute('disabled')).not.toBeNull()`, `expect(container.querySelector('[data-testid=...]')).toBeTruthy()`.
- Mockear `apiClient` con `vi.mock('../../lib/api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }))`.

`apps/frontend/src/components/settings/__tests__/OnChainWalletsSection.spec.tsx`:
- Render con 1 wallet ON_CHAIN → fila con label, address truncada, badge.
- Click Sync → `apiClient.post` llamado con `/api/sync/<id>`; durante in-flight, botón `disabled`.
- En success → `<SyncResultInline>` muestra `synced/skipped/swapsDecomposed`.
- NEGATIVE: `apiClient.post` rejects → toast spy llamado con error.
- NEGATIVE: `useSettingsWallets` retorna error → render `<SectionError>` con botón Retry.

`apps/frontend/src/components/settings/__tests__/ExchangeAccountsSection.spec.tsx`:
- Render CEX wallet, click Sync, validar render de las 4 sub-líneas (trades/converts/withdrawals/deposits).

`apps/frontend/src/components/settings/__tests__/TokenRow.spec.tsx`:
- Toggle `is_hidden`: click → `onUpdate({ isHidden: true })` llamado una vez.
- NEGATIVE toggle: si `onUpdate` rejects, switch vuelve al valor anterior (no optimistic — el render depende de `props.token`, así que el revert es automático tras el rejection).
- Edit target_exit_price: cambiar input → aparecen Save/Cancel; click Save → `onUpdate({ targetExitPrice: '1.5' })`.
- Click Cancel → input vuelve al valor original; Save desaparece.
- NEGATIVE edit: input vacío → click Save llama `onUpdate({ targetExitPrice: null })`.
- NEGATIVE edit: input inválido (`'abc'`) → Save deshabilitado.
- Re-render con `props.token.targetExitPrice` actualizado → Save desaparece (effect re-sincroniza draft).

`apps/frontend/src/components/settings/__tests__/ApiKeysSection.spec.tsx`:
- Render con `presence={ETHERSCAN_API_KEY: true, ...false...}` → texto "Configured" para Etherscan, "Not configured" para los demás.
- Click "Test" en Etherscan → `apiClient.post('/api/credentials/test/etherscan')` llamado.
- En success `{status:'connected', meta:{latencyMs:340}}` → texto "Connected (340ms)".
- En failed → texto "Failed: <reason>".
- NEGATIVE: el render no debe contener strings que parezcan keys (regex check sobre `container.innerHTML`).

`apps/frontend/src/components/settings/__tests__/BalanceValidationSection.spec.tsx`:
- Sección colapsada por defecto.
- Botón disabled si `presence.BINANCE_API_KEY === false`.
- Click expand + Validate → llama `apiClient.get('/api/portfolio/validate-snapshot')`.
- En success: tabla render, `dustNote` visible.
- NEGATIVE: error → mensaje + botón Retry.
- Cooldown: tras success, botón "Validate again" muestra "Available in Xs" y está disabled.

`apps/frontend/src/components/settings/__tests__/PendingPriceBanner.spec.tsx`:
- `count === 0` → no render.
- `count === 5` → texto "5 TRANSFER_IN transactions need a price."
- NEGATIVE: error de fetch → no render (banner silencioso, no debe romper la página).

`apps/frontend/src/pages/__tests__/SettingsPage.spec.tsx`:
- Render compone las 6 secciones (smoke test con todos los hooks mockeados).
- NEGATIVE: si `useApiKeysStatus` falla, las otras secciones siguen renderizando (aislamiento por sección — D5).

**Hooks unit tests** (donde la lógica no es trivial):

`apps/frontend/src/hooks/settings/__tests__/useSyncWallet.spec.tsx`:
- `sync(id, 'on-chain')` → states[id] pasa por `idle → syncing → success`.
- `sync(id, 'cex')` → result se parsea como `CexSyncResult`.
- NEGATIVE: backend rechaza → `states[id].status === 'error'`.

`apps/frontend/src/hooks/settings/__tests__/useBalanceValidation.spec.tsx`:
- No fetcha en mount.
- `validate()` → `loading → success`. Tras success, `cooldownSecondsRemaining = 60` y decrece via fake timers.
- Llamar `validate()` durante cooldown → no-op (o mantener cooldown). Decisión: el componente garantiza no llamar; el hook NO valida cooldown internamente, sólo lo expone.
