# Proposal — US-012 Settings UI

## Intent

Construir la página `/settings` que centraliza la administración operativa del portfolio: listar y sincronizar wallets on-chain, gestionar la cuenta Binance CEX, configurar tokens (visibilidad y `target_exit_price`), verificar la salud de las API keys de terceros, y resolver `TRANSFER_IN` con precio pendiente. Es el último gap de UI antes de habilitar US-013 (alertas Telegram), que depende del flag `is_hidden` y `target_exit_price` editables aquí.

Esta historia no introduce contabilidad nueva — todo el motor (WAC, ciclos, descomposición de swaps, herencia de costo) ya está cubierto por US-008-A/B. US-012 es la capa operativa que el usuario monousuario va a tocar día a día para mantener el sistema sincronizado y los tokens curados.

## Scope

### In scope

- Backend: nuevos endpoints `GET /api/credentials`, `POST /api/credentials/test/:service`, `GET /api/transactions/pending-price`.
- Backend: fix de `BinanceSyncService.sync()` para actualizar `wallets.last_synced_at` (incluido en esta historia, no spin-off).
- Frontend: ruta `/settings` registrada en `router.tsx`, accesible desde `AppLayout`.
- Frontend: `SettingsPage` compuesta por secciones independientes, cada una con su hook de datos: `OnChainWalletsSection`, `ExchangeAccountsSection`, `TokensSection`, `ApiKeysSection`, `BalanceValidationSection`, `PendingPriceBanner`.
- Frontend: inline editing de `is_hidden` (toggle) y `target_exit_price` (numeric input) sobre la lista de tokens.
- Frontend: botón Sync por wallet con resultado inline detallado (`X synced | Y skipped | Z swaps`) y `Last synced: Xs ago` reactivo via `useRelativeTime`.
- Frontend: botones Test individuales para Etherscan, BSCTrace, Binance API key + Secret key.
- Frontend: banner siempre visible si hay TRANSFER_IN sin precio, con CTA al detalle correspondiente.
- Tests: unit tests de los nuevos endpoints (Vitest backend) + tests de componentes Settings con mocks de `apiClient` (Vitest frontend `--project frontend`).

### Out of scope

- Edición/persistencia de API keys desde UI (ver D1) — quedan en `.env`.
- Creación de nuevas wallets desde Settings — sigue siendo via `POST /api/wallets` directo o pantallas dedicadas (no son parte del AC de US-012).
- Drag-and-drop o reordenado de tokens.
- Bulk actions sobre tokens (toggle masivo, eliminar varios).
- Resolver el TRANSFER_IN pendiente desde el banner — el banner sólo redirige; la edición de precio vive en el detalle de transacción (no cubierto en US-012).
- Conversión/tracking de dust (explícitamente non-goal del PRD).
- UI para rotar `ENCRYPTION_KEY` o re-cifrar credenciales.

## Decisions

### D1 — API Keys management: solo lectura desde env

**Decision**: Las API keys (`ETHERSCAN_API_KEY`, `BSCTRACE_API_KEY`, `BINANCE_API_KEY`, `BINANCE_SECRET_KEY`) **NO se persisten en `api_credentials` desde el frontend en V1**. El backend lee desde `process.env` (vía `env.ts`). El endpoint `GET /api/credentials` retorna únicamente presencia booleana — nunca el valor. Los inputs `type=password` en la UI muestran placeholder `"Configured in .env"` o `"Not configured"` y son **read-only** (sólo el botón Test está habilitado).

**Rationale**:
- Cryptofolio es monousuario, single-tenant, deploy personal en Render. Las keys ya viven en variables de entorno del servicio de Render (configuración estándar).
- Persistir keys en DB exige: endpoint PUT con cifrado AES-256, lógica de fallback `db ?? env`, invalidación de caches en clientes, tests de cifrado. Todo eso para resolver un caso (rotar key sin redeploy) que en este proyecto se resuelve con un click en el dashboard de Render.
- La tabla `api_credentials` y `ENCRYPTION_KEY` se preservan en el schema — quedan reservadas para una futura iteración multi-tenant o si el usuario pide rotación caliente.
- El AC del PRD pide "inputs type=password, botón Test individual" — no exige editar desde UI. Mostrar inputs deshabilitados con el estado real cumple el AC.

**Implication**:
- No se crea `PUT /api/credentials`. Sólo `GET` (presencia) y `POST /api/credentials/test/:service`.
- `apps/backend/src/routes/credentials.ts` lee `env.ETHERSCAN_API_KEY` etc. — no toca la tabla `api_credentials`.
- Si el usuario quiere cambiar una key: edita `.env` o variables en Render, redeploy. Documentar en el README de la app.
- Los tests usan las keys actuales del entorno; si fallan dan feedback granular ("Etherscan: failed — Invalid API key") y el usuario sabe qué corregir.

### D2 — BinanceSyncService `last_synced_at` fix: incluido en US-012

**Decision**: El fix del bug en `BinanceSyncService.sync()` (no actualiza `wallets.last_synced_at`) se incluye **dentro de US-012**, no como issue separada. La línea `UPDATE wallets SET last_synced_at = now() WHERE id = $1` se añade al final de `sync()` después del bloque de deposits, dentro de la misma transacción si ya existe, o como query independiente si no.

**Rationale**:
- El AC del PRD dice literalmente "último sync timestamp" para la sección Exchange Accounts. Sin el fix, ese requisito **no se cumple** — la UI mostraría "Never" indefinidamente para Binance, lo que rompe el AC.
- Es una sola línea de código + un test en `binance-sync.spec.ts` (`expect(wallet.last_synced_at).toBeRecentDate()`). Aislarlo en una historia separada agrega overhead administrativo desproporcionado.
- Mantener el fix en US-012 deja la historia "funcionalmente completa" — verify puede ejecutar el AC end-to-end sin dependencias externas pendientes.

**Implication**:
- `tasks.md` incluye una tarea explícita: "Fix BinanceSyncService.sync to update wallets.last_synced_at" con su propio test.
- Riesgo de regresión sobre US-008-B mitigado por test en `test:sync` que valida el campo.

### D3 — Banner TRANSFER_IN: endpoint dedicado

**Decision**: Crear `GET /api/transactions/pending-price` que retorna `{ transactions: PendingTransfer[], count: number }` filtrando `type='TRANSFER_IN' AND cost_source='MANUAL' AND price_usd IS NULL`. El frontend consume este endpoint en mount de `SettingsPage` y muestra el banner si `count > 0`. **No** se usa el contador transitorio del último sync result ni localStorage.

**Rationale**:
- El estado correcto es la consulta a la DB. localStorage queda inconsistente si el usuario resuelve un transfer pendiente desde otra pantalla o desde otra sesión.
- El banner debe ser visible **siempre** que haya pendientes, no solo después de un sync — entrar a Settings tras una semana sin syncar y no ver el banner sería un bug de UX.
- El endpoint es trivial (`SELECT … FROM transactions WHERE …`), reusa los repos existentes y respeta el patrón del backend (Fastify plugin + Zod schema en respuesta).
- Habilita futuras pantallas de "resolver pendientes" sin endpoint nuevo.

**Implication**:
- Nueva ruta en `apps/backend/src/routes/transactions.ts` (o nuevo plugin si no existe el archivo).
- Hook `usePendingPriceTransfers` en frontend que se invalida tras cada Sync (re-fetch).
- Schema Zod 4: `z.object({ transactions: z.array(PendingTransferSchema), count: z.number().int().nonnegative() })`.

### D4 — Balance Validation: implementar en V1, lazy y aislada

**Decision**: Implementar Balance Validation en V1 dentro de US-012, pero como sección **colapsada por defecto** y deshabilitada si no hay wallet `CEX_BINANCE` configurada o las keys Binance no están en env. Sólo se invoca `GET /sapi/v1/accountSnapshot?type=SPOT` cuando el usuario hace click en "Validate vs Binance Snapshot" — nunca on-mount.

**Rationale**:
- El AC del PRD la lista (aunque marcada "opcional"). Implementarla ahora cierra la historia limpia.
- El endpoint Binance es pesado pero no caro de implementar — la lógica de comparación reusa el motor de balances existente.
- Gating por click + sección colapsada evita que la página tarde en cargar o consuma rate limit innecesariamente.
- Documentar dust como diferencia esperada (parte del AC) educa al usuario sobre por qué hay discrepancias.

**Implication**:
- Nuevo endpoint `GET /api/portfolio/validate-snapshot` en backend (con timeout de 30s, manejo explícito de errores Binance).
- Componente `BalanceValidationSection` con estado `idle | loading | success | error`, tabla de diferencias `{ symbol, engineBalance, snapshotBalance, diff }`, nota explicativa fija sobre dust.
- Si las keys Binance no están en env: sección visible pero botón deshabilitado con tooltip "Configure Binance API keys in .env to enable".

### D5 — Estructura de SettingsPage: secciones modulares con hooks propios

**Decision**: `SettingsPage` es un contenedor delgado que compone seis sub-componentes independientes, cada uno con su propio hook de datos:

```
SettingsPage
├── PendingPriceBanner          (usePendingPriceTransfers)
├── OnChainWalletsSection       (useWallets filtrado ON_CHAIN)
├── ExchangeAccountsSection     (useWallets filtrado CEX)
├── TokensSection               (useTokens)
├── ApiKeysSection              (useApiKeysStatus)
└── BalanceValidationSection    (useBalanceValidation, lazy)
```

Cada sección tiene su propio `loading/error/data` state. **No** se hace un fetch monolítico de todo. Las secciones renderizan en paralelo y muestran skeletons individuales mientras cargan.

**Rationale**:
- React 19 + sin react-query: aislar fetch por sección evita que un endpoint lento bloquee la página entera y reduce el blast radius de errores.
- Hooks colocados con su sección permiten testear cada uno de forma independiente con Vitest (`render(<TokensSection/>)` con `apiClient` mockeado, sin levantar la página completa).
- Anti-patrón evitado: `useEffect` gigante en `SettingsPage` que orquesta 5 fetches — eso fragiliza tests y hace difícil identificar qué falló.
- Coherente con el patrón ya establecido en `DashboardPage` (cada sección tiene su hook).

**Implication**:
- Archivos: `apps/frontend/src/pages/settings/SettingsPage.tsx` + un archivo por sección bajo `apps/frontend/src/components/settings/` y un hook por sección bajo `apps/frontend/src/hooks/settings/`.
- Cada sección expone su `refetch` para que `SettingsPage` pueda invalidar (por ejemplo, tras Sync de una wallet, refetch del banner de pendientes).
- Tests: un spec por sección, no un mega-spec de la página.

### D6 — Inline editing de `target_exit_price`: debounce + on-blur con Save explícito

**Decision**: El campo `target_exit_price` se edita inline con un input numérico controlado. **No** se hace PUT en cada keystroke ni en cada blur. El flujo es:
1. Usuario edita el valor (estado local).
2. Si el valor cambia respecto al original, aparece un botón **"Save"** inline a la derecha del input + un botón "Cancel".
3. Click en Save → `PUT /api/tokens/:id` con `{ target_exit_price }`.
4. Toast de éxito o error; en éxito, el valor original se actualiza (Save desaparece).
5. Blur sin Save no persiste — el botón sigue visible hasta confirmar o cancelar.

El toggle `is_hidden`, en cambio, sí se persiste **al toggle** (PUT inmediato), porque es booleano y el cambio es atómico.

**Rationale**:
- On-blur silencioso es peligroso para campos numéricos: el usuario podría perder el foco accidentalmente (cambio de tab, scroll en mobile) y guardar un valor parcial (ej. `12` cuando quería `120`).
- Un Save explícito comunica intención y permite Cancel sin resetear con `Esc` (que no todos los usuarios conocen).
- Evita race conditions: si el usuario edita varios tokens seguidos, cada uno se persiste cuando él decide, no en orden de pérdida de foco.
- El toggle `is_hidden` no tiene este riesgo: un click es inequívoco.

**Implication**:
- Componente `TokenRow` con `useState` local para `targetExitPriceDraft` y comparación con el valor server.
- Schema Zod en backend acepta `target_exit_price: z.number().positive().nullable()` (permitir limpiar el target).
- Test: editar el valor, sin Save, navegar y volver — debe mostrar el valor del server (no el draft).
- Optimistic update opcional: aplicar el cambio en UI antes de la respuesta, revertir en error. Decisión: **no** optimistic en V1 (más simple, una llamada por vez es rápida).

### D7 — Test de API keys: endpoints backend dedicados (proxy al servicio)

**Decision**: Los tests de API keys los ejecuta **siempre el backend** vía `POST /api/credentials/test/:service` (`service ∈ {etherscan, bsctrace, binance}`). El frontend nunca llama directamente a Etherscan/BSCTrace/Binance. La respuesta del backend es:

```ts
| { status: 'connected'; meta?: { assetCount?: number; latencyMs?: number } }
| { status: 'failed'; reason: string }
```

**Rationale**:
- **`BINANCE_SECRET_KEY` jamás puede salir del servidor.** El test de Binance requiere firmar la request con HMAC-SHA256 sobre la query string usando el secret — exponer eso al browser destruye la integridad del modelo de seguridad. El backend ya tiene la lógica de firma en `apps/backend/src/sync/clients/binance-api.ts`.
- Aunque Etherscan y BSCTrace usen sólo API key (no secret), llamarlos desde el browser introduce CORS issues, mezcla orígenes y obliga a duplicar la lógica de error parsing entre frontend y backend.
- Centralizar en el backend permite **mensajes de error consistentes** ("Invalid API key", "Rate limit exceeded", "Network unreachable") parseados desde la respuesta cruda de cada API.
- Consistencia: el resto de la app ya consume todo via `apiClient`. Romper ese patrón para tres botones es un costo que no se paga.

**Implication**:
- Tres rutas o una con discriminator: optar por **una sola ruta paramétrica** `POST /api/credentials/test/:service` con validación Zod del enum de service.
- Internamente, despacha a un servicio `CredentialTestService` con tres métodos privados: `testEtherscan()`, `testBsctrace()`, `testBinance()`. Reutiliza los clientes existentes (`apps/backend/src/sync/clients/`).
- Schema response uniforme — el frontend renderiza el mismo componente `<TestResult/>` para los tres.
- Tests backend: mockear `fetch` y validar parsing de respuestas reales documentadas (Etherscan `status:"0"`, Binance error code `-2014`, etc.).

## Architecture overview

### Backend (`apps/backend`)

**Archivos nuevos:**
- `src/routes/credentials.ts` — plugin Fastify con `GET /api/credentials` y `POST /api/credentials/test/:service`.
- `src/routes/transactions.ts` — plugin Fastify con `GET /api/transactions/pending-price` (si el archivo no existe; si existe, sólo se añade la ruta).
- `src/services/credential-test.ts` — `CredentialTestService` con métodos por servicio, reusa clientes existentes.
- `src/schemas/credentials.ts` — Zod schemas para presencia + resultado de test.
- `src/schemas/pending-price.ts` — Zod schema `PendingTransferSchema`.
- Si la sección Balance Validation se confirma: `src/routes/portfolio.ts` (o extender el existente) con `GET /api/portfolio/validate-snapshot` + `src/services/balance-validator.ts`.

**Archivos modificados:**
- `src/services/binance-sync.ts` — añadir `UPDATE wallets SET last_synced_at = now() WHERE id = $1` al final de `sync()` (D2).
- `src/app.ts` (o donde se registren plugins) — registrar los nuevos plugins `credentialsRoutes`, `transactionsRoutes`, eventualmente `portfolioRoutes`.
- `src/env.ts` — sin cambios (las vars ya existen).

**Tests nuevos** (Vitest, ejecutados con `npm run test:engine` y `npm run test:sync` según corresponda):
- `src/routes/credentials.spec.ts` — `GET` retorna presencia; `POST test/binance` con mock de `getAccountAssets`.
- `src/services/credential-test.spec.ts` — parsing de errores específicos por proveedor.
- `src/routes/transactions.pending-price.spec.ts` — filtros correctos, count consistente.
- `src/services/binance-sync.spec.ts` — extender el spec existente para validar `last_synced_at`.

### Frontend (`apps/frontend`)

**Archivos nuevos:**
- `src/pages/settings/SettingsPage.tsx` — contenedor.
- `src/components/settings/PendingPriceBanner.tsx`
- `src/components/settings/OnChainWalletsSection.tsx`
- `src/components/settings/ExchangeAccountsSection.tsx`
- `src/components/settings/TokensSection.tsx` + `TokenRow.tsx`
- `src/components/settings/ApiKeysSection.tsx`
- `src/components/settings/BalanceValidationSection.tsx`
- `src/components/settings/SyncResultInline.tsx` — render del resultado detallado tras sync (compartido ON_CHAIN / CEX con discriminated union).
- `src/hooks/settings/useWallets.ts` — `{ wallets, loading, error, refetch }` con filtros opcionales.
- `src/hooks/settings/useTokens.ts` — incluye `updateToken(id, patch)` para is_hidden y target_exit_price.
- `src/hooks/settings/useApiKeysStatus.ts`
- `src/hooks/settings/useTestApiKey.ts` — invoca `POST /api/credentials/test/:service`.
- `src/hooks/settings/usePendingPriceTransfers.ts`
- `src/hooks/settings/useBalanceValidation.ts` — lazy, sólo dispara con trigger explícito.
- `src/hooks/settings/useSyncWallet.ts` — wrap de `POST /api/sync/:walletId` con estado per-wallet (`Record<walletId, SyncState>`).

**Archivos modificados:**
- `src/routes/router.tsx` — añadir ruta `/settings` protegida.
- `src/components/layout/AppLayout.tsx` (o equivalente) — link de navegación a Settings.

**Tests nuevos** (Vitest frontend, `npx vitest run --project frontend`):
- Un spec por sección (`*.spec.tsx`) con mocks de `apiClient`.
- Spec de `TokenRow` cubriendo el flujo Save/Cancel del `target_exit_price` (D6).
- Spec de `SettingsPage` que valida que las secciones son independientes (un error en API keys no rompe el render de tokens).

### Flujo de datos clave

1. Mount de `SettingsPage` → cada hook fetcha en paralelo.
2. Click "Sync" en una wallet → `useSyncWallet.sync(walletId)` → `POST /api/sync/:walletId` → al success, refetch de `useWallets` (para `last_synced_at`) y `usePendingPriceTransfers` (para banner).
3. Click "Test" en una API key → `useTestApiKey.test('etherscan')` → `POST /api/credentials/test/etherscan` → render local del resultado por service (no afecta otras secciones).
4. Toggle `is_hidden` en token → optimistic `useTokens.updateLocal(id, { is_hidden })` → `PUT /api/tokens/:id` → en error, revert + toast.
5. Edit `target_exit_price` → estado draft local → click Save → `PUT /api/tokens/:id` → success: actualiza original; error: mantiene draft + toast.

## Risks

| Risk | Mitigation |
|------|------------|
| Regresión en `BinanceSyncService` al añadir el UPDATE de `last_synced_at`: si la query falla silenciosamente, el sync entero podría romperse. | Wrapping en `try/catch` que loguea pero no propaga si el resto del sync ya commiteó. Test específico en `test:sync`. |
| Race condition en inline edit de tokens (usuario edita varios, Save rápido en sucesión). | Estado de loading per-row deshabilita el botón Save mientras la request está en vuelo. `updateLocal` reemplaza por `id`, no por orden. |
| `GET /api/credentials` podría filtrar accidentalmente el valor de la key si alguien cambia el shape de la respuesta. | Schema Zod estricto con `z.object({ ETHERSCAN_API_KEY: z.boolean(), ... })` — `parse` rechaza shape extendido. Test que verifica que el body **no** contiene strings que parezcan keys (regex `^[A-Z0-9]{20,}`). |
| Test de Binance puede tardar y bloquear UI si el endpoint está lento. | `AbortController` con timeout 10s en el frontend; backend con timeout 8s sobre `getAccountAssets`. UI muestra spinner por botón, no bloquea otras secciones. |
| Balance Validation puede consumir rate limit Binance si se invoca repetidamente. | Botón con cooldown de 60s tras un click exitoso. Cache en backend de la última respuesta por 60s. |
| `GET /api/transactions/pending-price` puede ser caro si hay miles de transferencias. | El filtro está sobre índices existentes (`type`, `cost_source`, `price_usd`); LIMIT 100 en la query y `count` total separado para el banner. |
| Si las keys del entorno cambian sin redeploy, `GET /api/credentials` puede mostrar info stale. | Las env vars de Node sólo se leen en arranque — comportamiento esperado. Documentar en README. |
| React 19 deprecación de `useMemo`: si alguien añade memoización manual, breakea el lint. | Lint config ya activa esta regla. Code review checklist incluye "no manual memo". |

## Dependencies

- US-005 (wallets/tokens CRUD) — completa: `apps/backend/src/routes/wallets.ts`, `tokens.ts`.
- US-008-A (on-chain sync) — completa: `POST /api/sync/:walletId` retorna `SyncResult`.
- US-008-B (Binance CEX sync) — completa: misma ruta unificada retorna `BinanceSyncResult`. **Bug conocido**: no actualiza `last_synced_at`; se corrige en D2 dentro de esta historia.
