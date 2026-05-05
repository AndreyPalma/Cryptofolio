# Proposal: US-007 — API REST métricas de portafolio y P&L

## Intent

Exponer la primera capa de **lectura agregada** del portafolio: tres endpoints REST que materializan, sobre las posiciones y transacciones que ya escribe el position-engine (US-004) y los CRUDs de wallets/tokens/transactions (US-005, US-006), las métricas que el dashboard y la pantalla de detalle de token van a consumir desde el frontend.

Es la pieza que cierra el bucle "datos crudos → métricas". Hasta ahora teníamos posiciones bien calculadas a nivel `(wallet, token, ciclo)` pero ningún consumidor podía pedirle al backend "dame todo lo que tengo, agregado por token, con P&L no realizado". Esta story habilita esa consulta y, además, introduce el primer servicio que toca **fuentes externas de precios** (DefiLlama y Binance public ticker), con la disciplina de cache + degradación graceful que va a heredar el resto del producto cuando entre la sincronización on-chain (US-008) y CEX (US-009).

Dentro del roadmap, US-007 desbloquea:
- Frontend dashboard y detalle de token (próxima story de UI).
- Reuso de `PriceService` por cualquier feature que necesite "precio actual" sin volver a pegarle a la API externa.
- Patrón de manejo de fallos de proveedores externos (`priceUnavailable` flag, nunca 500) que se aplicará también a los syncs.

## Scope

### In scope

- `GET /api/portfolio` — resumen agregado, con totales y filas por token.
  - Agregación multi-wallet por `(contract_address, network)` para tokens ON_CHAIN.
  - CEX_BINANCE como filas independientes (nunca se mezclan con on-chain).
  - WAC ponderado: `Σ(balance_i × wac_i) / Σ(balance_i)` con `decimal.js`.
  - P&L no realizado por token y totales del portafolio.
- `GET /api/portfolio/token/:contractAddress/:network` — detalle de un token:
  - Posición OPEN activa (filtrable por `?wallet_id=` cuando es ON_CHAIN; CEX siempre apunta a la única wallet Binance).
  - Lista de transacciones de la posición con per-lot P&L enriquecido.
- `GET /api/portfolio/token/:contractAddress/:network/history` — ciclos cerrados del token: `cycleNumber`, `openedAt`, `closedAt`, `realizedPnlUsd`.
- `PriceService` nuevo, con cache TTL en memoria (DefiLlama 60s, Binance ticker 10s) y bulk fetch para DefiLlama.
- `PortfolioService` nuevo, que reusa `calculateWAC` del position-engine.
- Extensión mínima de `TokenService`: `findByContractAddress(pool, address, network)`.
- Tests: unit (price, portfolio) + e2e (rutas + DB real con fetch mockeado).

### Out of scope

- Sincronización real de transacciones (Etherscan, BSCTrace, Binance — eso es US-008/009).
- Autenticación de Binance privada (no se usa en este endpoint, solo el ticker público).
- Frontend / pantallas (otra story).
- Persistir snapshots históricos de precio (lo único histórico viene de `transactions.price_usd`).
- Validación de balance vs `/sapi/v1/accountSnapshot` (esa es feature de balance-validation posterior).
- Conversión de dust (no-goal explícito de V1 según PRD).

## Approach

### PriceService

Módulo nuevo en `apps/backend/src/services/price.ts`. Singleton implícito vía closure a nivel módulo (cache en `Map` exportado solo como API funcional).

**Diseño**:

```ts
type CacheEntry = { priceUsd: string; expiresAt: number };
const cache = new Map<string, CacheEntry>();

const TTL_DEFILLAMA_MS = 60_000;
const TTL_BINANCE_MS   = 10_000;

export async function getPriceForToken(token: Token): Promise<string | null>;
export async function getPricesForTokens(tokens: Token[]): Promise<Map<string, string | null>>;
```

**Decisiones**:

1. **Singleton de proceso, sin clase.** Cache vive en el módulo. Es simple, testeable (se exporta `__resetCacheForTests` solo en build dev/test) y suficiente para una sola instancia Render.
2. **Bulk fetch DefiLlama**. La doc soporta `coins/prices/current/ethereum:0xAAA,bsc:0xBBB` separado por coma. `getPricesForTokens` agrupa los ON_CHAIN, dispara una sola request por lote (un solo lote total — no por chain, DefiLlama acepta multichain en el mismo path). Reduce el riesgo R1 (N+1 fetches) a 1 + N_cex requests donde N_cex es típicamente 1 wallet × ~10 tokens.
3. **Binance ticker** sigue siendo per-symbol (no hay endpoint batch público que respete `binance_symbol` arbitrario sin riesgo). Se hacen en paralelo con `Promise.all`.
4. **Cache key**:
   - ON_CHAIN: `onchain:${network.toLowerCase()}:${contractAddress.toLowerCase()}`
   - CEX:      `cex:${binanceSymbol.toUpperCase()}`
5. **Failure mode (CRÍTICO — invariante PRD)**:
   - `fetch` lanza, status no-200, body inesperado → `request.log.warn(...)` con context `{ tokenId, source, error }` y `return null`.
   - El servicio NUNCA lanza. El caller (PortfolioService) decide si emite `priceUnavailable: true` para esa fila.
6. **Sin librerías HTTP nuevas** — `fetch` global de Node 22. AbortController con timeout de 5s para ambas APIs. Si el timeout dispara, también se trata como `null`.
7. **Validación de respuesta con Zod**: cada respuesta externa pasa por un schema (`DefiLlamaResponse`, `BinanceTickerResponse`). Zod 4 (`z.object`, `z.string()`, `z.number()`). Si el parse falla → `null` + warning. Esto evita que un cambio de shape upstream rompa toda la API.

### PortfolioService

Módulo nuevo en `apps/backend/src/services/portfolio.ts`. Funciones puras que reciben `Pool` (mismo patrón que `wallet.ts`, `token.ts`).

**API**:

```ts
export async function getPortfolioSummary(pool: Pool): Promise<PortfolioSummary>;
export async function getTokenDetail(
  pool: Pool,
  contractAddress: string,
  network: TokenNetwork,
  walletId?: string
): Promise<TokenDetail>;
export async function getTokenCycleHistory(
  pool: Pool,
  contractAddress: string,
  network: TokenNetwork,
  walletId?: string
): Promise<CycleHistory[]>;
```

**Decisiones clave**:

1. **Una sola query para el summary**. JOIN `positions ⨝ tokens ⨝ wallets WHERE positions.status = 'OPEN'`. Trae todo lo necesario para agrupar en aplicación. Evita N+1.
2. **Agrupación en el dominio, no en SQL**. Postgres podría hacer `GROUP BY (contract_address, network)` con WAC ponderado, pero los cálculos en SQL con `numeric` y los redondeos no nos dan garantía bit-exacta con `decimal.js` (el motor confía en `roundToStorage`). Por consistencia con el position-engine se hace en TS con `decimal.js`.
3. **Reusar `calculateWAC` del position-engine**. Para cada grupo agregado se construye un `PositionState` virtual (WAC ponderado, balance suma, costBasis suma, realizedPnl suma) y se llama a `calculateWAC(virtualPosition, currentPrice)`. Eso retorna `unrealizedPnlUsd`/`unrealizedPnlPct` con la misma fórmula del engine — fuente única de verdad de la matemática de P&L.
4. **WAC agregado**:
   - `totalBalance = Σ balance_i`
   - `wacAggregated = Σ(balance_i × wac_i) / totalBalance` (con `Decimal`).
   - `totalCostBasis = Σ cost_basis_i` (suma directa, no recomputado, mantiene consistencia con lo que escribió el engine).
   - Si `totalBalance === 0` → no se incluye en el summary (no debería pasar porque solo OPEN, pero guard).
5. **CEX nunca se agrupa**. Una fila por posición CEX. La key efectiva es `(contract_address, network)` y `network='CEX_BINANCE'` ya las separa naturalmente del on-chain, pero además se desduplica solo dentro de ON_CHAIN para reforzar la invariante "ETH on-chain ≠ ETH Binance".
6. **Per-lot P&L** (detalle): se hace en aplicación post-`listTransactions`. Para cada tx:
   - `BUY | SWAP_IN | TRANSFER_IN` con `price_usd` no nulo y `currentPrice` disponible →
     `lotPnlUsd = (currentPrice - price_usd) × amount`,
     `lotPnlPct = lotPnlUsd / (price_usd × amount) × 100`.
   - `SELL | SWAP_OUT | TRANSFER_OUT` → `{ displayAs: 'Sold/Out' }`.
   - Si `price_usd` es null (TRANSFER_IN con `cost_source='MANUAL'` aún no resuelto) → `lotPnlUsd: null`.
   - Si `priceUnavailable: true` → no se computan lotPnl, se devuelven los txs sin esos campos.
7. **Cycle history**: `SELECT cycle_number, opened_at, closed_at, realized_pnl_usd FROM positions WHERE token_id = $1 AND status = 'CLOSED' [AND wallet_id = $2] ORDER BY cycle_number ASC`. Trivial.
8. **Token lookup**: nuevo `TokenService.findByContractAddress(pool, address, network)`. `WHERE network = $1 AND lower(contract_address) = lower($2)` aprovechando el índice único existente. 404 si no existe.

### HTTP Endpoints

Plugin nuevo `apps/backend/src/routes/portfolio.ts`, registrado en `index.ts` con prefix `/api/portfolio`. Sigue el patrón de `wallets.ts`/`tokens.ts`/`transactions.ts`: `fastify-type-provider-zod`, schema en route, handler delgado que llama al service.

| Method | Path                                                          | Query        | Response                |
| ------ | ------------------------------------------------------------- | ------------ | ----------------------- |
| GET    | `/api/portfolio`                                              | —            | `PortfolioSummary`      |
| GET    | `/api/portfolio/token/:contractAddress/:network`              | `wallet_id?` | `TokenDetail`           |
| GET    | `/api/portfolio/token/:contractAddress/:network/history`      | `wallet_id?` | `{ cycles: CycleHistory[] }` |

**Schemas Zod 4** co-locados en `apps/backend/src/types/portfolio.ts`:

```ts
const PortfolioTokenRow = z.object({
  symbol: z.string(),
  network: TokenNetworkSchema,
  sourceType: z.enum(['ON_CHAIN', 'CEX']),
  contractAddress: z.string(),
  totalBalance: z.string(),
  currentPrice: z.string().nullable(),
  totalCurrentValue: z.string().nullable(),
  wacAggregated: z.string(),
  totalCostBasis: z.string(),
  pnlUsd: z.string().nullable(),
  pnlPct: z.string().nullable(),
  walletCount: z.number().int(),
  walletBreakdown: z.array(z.object({ walletId: z.uuid(), label: z.string(), balance: z.string(), wac: z.string() })),
  priceUnavailable: z.boolean().optional()
});
```

Todos los `Decimal` se serializan como `string` (nunca `number`) para no perder precisión, mismo criterio que ya aplica el resto del backend.

**Auth**: las rutas viven bajo `/api/*`, así que el middleware JWT instalado en US-003 las cubre automáticamente — no hay que tocar el plugin de auth.

**Error handling**: errores no controlados pasan por el `setErrorHandler` global. Errores de dominio (token no encontrado, wallet_id inválido para token CEX, etc.) usan los typed errors de `services/errors.ts` (`NotFoundError`, `ValidationError`).

### Test Strategy

Strict TDD activo — todo va con test rojo primero.

**Unit — `apps/backend/src/services/__tests__/price.test.ts`** (mock global `fetch` con `vi.stubGlobal`):
- DefiLlama bulk: una sola request, parsea respuesta, devuelve Map con price por token.
- Binance ticker: per-symbol, paraleliza, devuelve string.
- Cache hit dentro del TTL → no se vuelve a llamar `fetch`.
- Cache expira → nueva request.
- `fetch` rejects → `null` + warning loggeado.
- Status 4xx/5xx → `null` + warning.
- Schema parse falla (shape inesperado) → `null` + warning.
- Timeout (AbortController) → `null` + warning.

**Unit — `apps/backend/src/services/__tests__/portfolio.test.ts`** (mock `Pool` + mock `PriceService`):
- 2 wallets ON_CHAIN con mismo token → WAC agregado correcto, walletCount=2, walletBreakdown con ambas.
- ETH on-chain + token llamado "ETH" en CEX_BINANCE → 2 filas separadas, jamás agregadas.
- Token sin posición OPEN → no aparece.
- Precio retorna null → fila incluida con `priceUnavailable: true`, totales del portafolio omiten ese token.
- Cálculo de totales: `totalValueUsd`, `totalCostBasis`, `totalPnlUsd`, `totalPnlPct` con `decimal.js` (no float drift).
- `getTokenDetail` con `wallet_id` ON_CHAIN → solo posición de esa wallet.
- `getTokenDetail` CEX → ignora `wallet_id` (siempre la única Binance).
- Per-lot P&L: BUY con `currentPrice` → cómputo correcto; SELL → `displayAs: 'Sold/Out'`; `price_usd` null → `lotPnlUsd: null`.
- `getTokenCycleHistory` → solo CLOSED, ordenados por cycle_number.

**E2E — `tests/e2e/api/portfolio.test.ts`** (DB real Supabase de test + `buildServer()` + `vi.stubGlobal('fetch', ...)`):
- Setup: crea 2 wallets ON_CHAIN + 1 CEX_BINANCE, inserta transacciones que abren posiciones, deja al menos un ciclo cerrado.
- `GET /api/portfolio` con fetch mockeado a precios válidos → shape completo correcto.
- `GET /api/portfolio` con fetch lanzando error → `priceUnavailable: true` por token, status 200, no 500. Asserta warning en logs.
- `GET /api/portfolio/token/:address/:network` con `?wallet_id=` válido → filtra correctamente.
- `GET /api/portfolio/token/:address/:network` token inexistente → 404.
- `GET /api/portfolio/token/:address/:network/history` → solo ciclos CLOSED, ordenados.
- NEGATIVE: token CEX sin `binance_symbol` → `priceUnavailable: true`, no 500.
- NEGATIVE: ETH on-chain + ETH en Binance no se agregan (asserta dos filas distintas en el response).

## Files Affected

### New
- `apps/backend/src/services/price.ts` — PriceService con cache TTL.
- `apps/backend/src/services/portfolio.ts` — PortfolioService (summary, detail, history).
- `apps/backend/src/routes/portfolio.ts` — plugin Fastify con las 3 rutas.
- `apps/backend/src/types/portfolio.ts` — schemas Zod + tipos inferidos (`PortfolioSummary`, `PortfolioTokenRow`, `TokenDetail`, `CycleHistory`, `EnrichedTransaction`).
- `apps/backend/src/services/__tests__/price.test.ts`
- `apps/backend/src/services/__tests__/portfolio.test.ts`
- `tests/e2e/api/portfolio.test.ts`

### Modified
- `apps/backend/src/services/token.ts` — agregar `findByContractAddress(pool, address, network)`.
- `apps/backend/src/index.ts` — registrar `portfolioRoutes` con prefix `/api/portfolio`.
- `apps/backend/src/types/token.ts` — exportar tipo si hace falta para el lookup (probablemente ya está).

### Untouched (referenciados, no modificados)
- `apps/backend/src/position-engine/engine.ts` — `calculateWAC` se reusa tal cual.
- `apps/backend/src/position-engine/decimal-utils.ts` — `toDecimal`, `roundToStorage` se reusan.
- `apps/backend/src/services/transaction.ts` — `listTransactions` se reusa para alimentar el detalle.

## Non-Goals

- No se implementa sincronización de transacciones con proveedores externos (Etherscan, BSCTrace, Binance privada). Eso es US-008/009.
- No se persisten precios históricos en DB. El único histórico vive en `transactions.price_usd`.
- No se autentica con Binance API privada — solo se usa el endpoint público de ticker.
- No se valida balance contra `/sapi/v1/accountSnapshot`. Feature posterior.
- No se implementa pantalla de UI. Es sólo backend.
- No se hace conversión de dust (no-goal V1 explícito).
- No se implementa rate limiter del lado del backend hacia DefiLlama/Binance. La cache TTL es la única defensa por ahora; si en producción se ve presión, se agrega en una story dedicada.

## Risks

### R1 — Latencia de fetch externo en path crítico (HIGH → MEDIO con bulk)
- **Mitigación**: bulk fetch DefiLlama (1 request para todos los ON_CHAIN), paralelización con `Promise.all` para CEX, cache TTL agresivo, timeout 5s. Si todo cae, `priceUnavailable: true` y respuesta inmediata. Worst case medible: 1 round-trip DefiLlama + N_cex roundtrips Binance, en paralelo.

### R2 — Precisión decimal en agregación cross-wallet (HIGH si se descuida)
- **Mitigación**: NUNCA `Number()` ni operadores `+ - * /` sobre balances/WAC. Todo pasa por `toDecimal()` y `roundToStorage()` de `position-engine/decimal-utils.ts`. Tests unit explícitos verifican que sumar dos balances con muchos decimales no pierde precisión.

### R3 — DefiLlama o Binance cambian shape de respuesta (MEDIUM)
- **Mitigación**: `safeParse` con Zod en cada respuesta externa. Si parse falla → `null` + log con el body crudo (truncado) para diagnóstico. La API sigue respondiendo 200 con `priceUnavailable: true`.

### R4 — Token CEX sin `binance_symbol` (LOW)
- **Mitigación**: el lookup de precio CEX guard-clause: si `binance_symbol` es null → retorna null sin llamar a fetch. Test unit cubre el caso. El frontend muestra `priceUnavailable`.

### R5 — Carrera de cache en cold start (LOW)
- Múltiples requests simultáneos al primer hit de un token podrían disparar varias requests externas en paralelo (cache miss + miss).
- **Mitigación**: aceptable en V1 (cache TTL pequeño, single-instance Render). Si se vuelve un problema, se agrega request de-duplication por key (in-flight Map). Out of scope para esta story; se documenta en design.

### R6 — Múltiples OPEN positions por (wallet, token) (LOW pero a verificar)
- No hay UNIQUE en DB sobre `(wallet_id, token_id) WHERE status='OPEN'`. Es invariante de aplicación.
- **Mitigación**: el `PortfolioService` no asume unicidad — agrupa por `(contract_address, network)` y suma todo. Si por bug alguna vez aparecen 2 OPEN para misma wallet/token, el resultado igual es coherente (las balances se suman). No falla, no oculta data.

### R7 — `wallet_id` query param para token CEX (LOW)
- AC: "CEX: siempre la cuenta Binance". Si llega `?wallet_id=` con un id de wallet ON_CHAIN consultando un token CEX, se ignora silenciosamente (el filtro solo aplica al lookup ON_CHAIN). Test e2e cubre el caso.
