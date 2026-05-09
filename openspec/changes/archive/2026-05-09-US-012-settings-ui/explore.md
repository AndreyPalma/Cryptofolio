# Explore — US-012 Settings UI

## Resumen ejecutivo

El backend ya expone CRUD completo para wallets y tokens y el endpoint de sync unificado `POST /api/sync/:walletId`. Sin embargo, no existe ningún endpoint para gestionar o testear API keys desde el frontend — actualmente las claves se leen directamente de variables de entorno. La tabla `api_credentials` existe en el schema con cifrado AES-256 pero no hay rutas que la lean o escriban. El frontend no tiene página Settings ni ningún hook/componente relacionado; todo debe construirse desde cero con excepción de componentes reutilizables ya presentes.

---

## Endpoints backend existentes (relevantes para US-012)

| Método | Path | Descripción | Response shape |
|--------|------|-------------|----------------|
| GET | `/api/wallets` | Lista todas las wallets | `Wallet[]` con `id, user_id, wallet_type, address, network, label, last_synced_at, created_at` |
| GET | `/api/wallets/:id` | Obtiene wallet por id | `Wallet` |
| POST | `/api/wallets` | Crea wallet (ON_CHAIN o CEX) | `Wallet` |
| PUT | `/api/wallets/:id` | Actualiza label | `Wallet` |
| DELETE | `/api/wallets/:id` | Elimina wallet | 204 |
| GET | `/api/tokens` | Lista tokens, query: `network`, `includeHidden` | `Token[]` con `id, symbol, name, network, contract_address, decimals, binance_symbol, is_hidden, target_exit_price, created_at` |
| POST | `/api/tokens` | Crea token | `Token` |
| PUT | `/api/tokens/:id` | Actualiza `is_hidden`, `target_exit_price`, `binance_symbol` | `Token` |
| POST | `/api/sync/:walletId` | Sincroniza wallet | ON_CHAIN: `SyncResult{synced, skipped, swapsDecomposed, transfersPendingCost, ...}` / CEX: `BinanceSyncResult{trades{synced,skipped}, converts{synced,skipped}, withdrawals{synced,skipped}, deposits{synced,skipped}}` |

**Notas:**
- `SyncResult.transfersPendingCost` = conteo de TRANSFER_IN con `cost_source='MANUAL', price_usd=null` — candidatos para el banner.
- `BinanceSyncResult` tiene exactamente los 4 campos "X trades | Y converts | Z withdrawals | W deposits".
- `BinanceSyncService.sync()` NO actualiza `wallets.last_synced_at` — bug que debe corregirse.

---

## Endpoints FALTANTES que US-012 necesita crear

| Método | Path | Descripción | Propuesta |
|--------|------|-------------|-----------|
| GET | `/api/credentials` | Retorna qué keys están configuradas (presencia, no valor) | `{ETHERSCAN_API_KEY: boolean, BSCTRACE_API_KEY: boolean, BINANCE_API_KEY: boolean, BINANCE_SECRET_KEY: boolean}` |
| PUT | `/api/credentials` | Guarda/actualiza keys en `api_credentials` con cifrado | `{service, value}` |
| POST | `/api/credentials/test/etherscan` | Testea key Etherscan con llamada real | `{status: 'connected'} \| {status: 'failed', reason: string}` |
| POST | `/api/credentials/test/bsctrace` | Testea key BSCTrace con llamada real | `{status: 'connected'} \| {status: 'failed', reason: string}` |
| POST | `/api/credentials/test/binance` | Testea keys Binance con `GET /api/v3/account` | `{status: 'connected', assetCount: number} \| {status: 'failed', reason: string}` |
| GET | `/api/transactions/pending-price` | Lista TRANSFER_IN con `price_usd IS NULL` | `{transactions: [...], count: number}` |
| GET | `/api/portfolio/validate-snapshot` (opcional) | Compara balances motor vs snapshot Binance | `{differences: [...], dustNote: string}` |

---

## Frontend — patrones encontrados

### Routing
- `react-router-dom` v6 con `createBrowserRouter`.
- Rutas protegidas via `<ProtectedRoute>`.
- Rutas actuales: `/login`, `/`, `/token/:contractAddress/:network`, `/token/:contractAddress/:network/history`, `/transactions/new`.
- NO existe `/settings` — debe añadirse en `apps/frontend/src/routes/router.tsx`.

### API calls
- `apiClient` en `apps/frontend/src/lib/api-client.ts` — wrapper sobre `fetch` con `credentials: 'include'`.
- Métodos: `apiClient.get<T>`, `apiClient.post<T>`, `apiClient.put<T>`, `apiClient.delete<T>`.
- Sin react-query ni SWR — todo `useState + useEffect` manual.

### Componentes reutilizables existentes

| Componente | Path | Uso en Settings |
|-----------|------|-----------------|
| `NetworkBadge` | `components/dashboard/NetworkBadge.tsx` | Badge network/storage_type en On-Chain Wallets |
| `SourceBadge` | `components/token-detail/SourceBadge.tsx` | Badge de fuente (ETH/BSC/Binance) en tokens |
| `RefreshIndicator` | `components/dashboard/RefreshIndicator.tsx` | Estado visual para "Last synced: Xs ago" |
| `useRelativeTime` | `hooks/useRelativeTime.ts` | Hook tiempo relativo — reutilizar para "Last synced" |
| `useToast` | `hooks/useToast.ts` | Toast success/error — usar para resultados de sync |
| `cn` | `lib/cn.ts` | clsx + tailwind-merge |

### Patrón de páginas
```tsx
export function XxxPage() {
  const { data, loading, error } = useXxx();
  if (loading && data === null) return <XxxSkeleton />;
  if (error !== null && data === null) return <XxxErrorState onRetry={retry} />;
  return (
    <main className="min-h-screen bg-gray-950 p-6 text-white">
      ...
    </main>
  );
}
```
- Cards: `rounded-xl bg-gray-900 p-6`
- Botones primarios: `rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500`

---

## Análisis de criterios de aceptación vs lo existente

| Criterio | Backend listo | Frontend listo | Trabajo necesario |
|----------|:---:|:---:|---|
| On-Chain Wallets list | ✅ | ❌ | Hook + componentes UI |
| Sync button con resultado | ✅ (endpoint existe) | ❌ | Estado local syncing+result |
| "Last synced: Xs ago" | ⚠️ ON_CHAIN ok, CEX bug | ❌ | Fix BinanceSyncService + useRelativeTime |
| Exchange Accounts (Binance) | ⚠️ sync result ok, test falta | ❌ | Nuevo endpoint test + UI |
| Tokens is_hidden toggle | ✅ | ❌ | Inline toggle + PUT |
| Tokens target_exit_price inline | ✅ | ❌ | Inline input + PUT on-blur |
| Tokens source badge | ✅ (campo `network`) | ❌ | SourceBadge con network→source mapping |
| API Keys inputs + Test | ❌ nuevos endpoints | ❌ | Endpoints nuevos + UI completa |
| Banner TRANSFER_IN pendientes | ❌ endpoint falta | ❌ | Nuevo endpoint + banner UI |
| Balance Validation (opcional) | ❌ endpoint falta | ❌ | Nuevo endpoint + tabla UI |

---

## Preguntas abiertas con recomendaciones

1. **API keys: ¿env vars (solo lectura) o DB persistida?**
   → **Recomendación: solo-env para V1**. Mostrar si la variable existe (boolean desde servidor), botón Test individual. No editable desde UI. Simplifica enormemente el backend (no necesita `/api/credentials PUT`, no cifrado en flight). Las keys se configuran en el servidor vía `.env`. Esto es coherente con un proyecto personal monousuario.

2. **`wallets.last_synced_at` no se actualiza en BinanceSyncService**
   → Fix obligatorio: añadir `UPDATE wallets SET last_synced_at = now() WHERE id = $1` al final de `BinanceSyncService.sync()`.

3. **Banner TRANSFER_IN: ¿contador en sync result o endpoint propio?**
   → **Endpoint propio** `GET /api/transactions/pending-price`. El contador en sync result es transitorio. El banner debe mostrarse siempre en Settings, no solo después de hacer sync.

4. **Badge de fuente en tokens**
   → Derivar de `token.network`: `ETH` → `ETHERSCAN`, `BSC` → `BSCTRACE`, `CEX_BINANCE` → `BINANCE`. El componente `SourceBadge` ya acepta estos valores.

5. **Balance Validation: ¿V1 o skip?**
   → El AC la marca como "(opcional)". Implementarla como sección colapsada, deshabilitada si no hay wallet Binance con keys válidas.

---

## Riesgos

- **`wallets.last_synced_at` nunca se actualiza para Binance CEX**: "Last synced" siempre mostrará "Never" para la cuenta CEX. Fix en `BinanceSyncService` — una línea, baja complejidad.
- **Sin react-query**: cada sección necesita `useState+useEffect` propio. Race conditions posibles en PUT inline de tokens.
- **API key tests usan env actual**: si las keys están mal configuradas en env, los tests siempre fallarán — no hay feedback sobre qué key específica está mal (Etherscan vs BSCTrace vs Binance). El endpoint de test permite aislar esto.
- **Balance Validation puede ser lenta**: Binance `/sapi/v1/accountSnapshot` es un endpoint pesado — implementar con timeout y estado de loading prominente.

---

## Archivos clave

- `apps/backend/src/routes/wallets.ts` — CRUD wallets
- `apps/backend/src/routes/tokens.ts` — CRUD tokens con `is_hidden`/`target_exit_price`
- `apps/backend/src/routes/sync.ts` — POST `/api/sync/:walletId`
- `apps/backend/src/schemas/sync.ts` — shapes de `SyncResult` y `BinanceSyncResult`
- `apps/backend/src/services/binance-sync.ts` — falta `UPDATE wallets SET last_synced_at`
- `apps/backend/src/sync/clients/binance-api.ts` — `assertConfigured()`, `getAccountAssets()`
- `apps/backend/src/env.ts` — validación de API keys + ENCRYPTION_KEY
- `db/migrations/0001_initial_schema.sql` — tabla `api_credentials`
- `apps/frontend/src/routes/router.tsx` — añadir `/settings`
- `apps/frontend/src/lib/api-client.ts` — patrón llamadas API
- `apps/frontend/src/hooks/useRelativeTime.ts` — reutilizar para "Last synced"
- `apps/frontend/src/components/dashboard/NetworkBadge.tsx`
- `apps/frontend/src/components/token-detail/SourceBadge.tsx`
