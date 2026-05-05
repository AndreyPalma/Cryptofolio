# Design: API REST — CRUD Wallets y Tokens

## Technical Approach

Dos route plugins de Fastify (`walletRoutes`, `tokenRoutes`) montados bajo `/api/wallets` y `/api/tokens`. La auth ya queda cubierta por el `onRequest` hook global de `authPlugin` (`apps/backend/src/plugins/auth.ts`), que protege todo `/api/*` excepto `/api/auth/*` — no hay que repetir `preHandler` en cada ruta. Validación de entrada con Zod 4 vía `fastify-type-provider-zod` (mismo patrón que `authRoutes`). Las reglas de negocio (unicidad CEX, EIP-55, auto-generación de `contract_address`) viven en una capa de servicios pura (`services/wallet.ts`, `services/token.ts`) que recibe el `pool` de pg por parámetro para que sean testeables sin Fastify.

## Architecture Decisions

### Decision: Librería de checksum EIP-55 — `viem`
**Choice**: `viem` (`getAddress`, `isAddress`).
**Alternatives**: `ethers` (~300 KB con BN.js, dependency tree pesado), `@noble/hashes` + keccak manual (DIY, riesgoso).
**Rationale**: `viem` es tree-shakeable, ~30 KB para `getAddress`, ya es estándar en el ecosistema 2025, y `isAddress(addr, { strict: true })` da exactamente la semántica EIP-55 que pide la AC. `ethers` aporta features que no usamos (Wallet, Provider, Contract). El motor de posiciones todavía no depende de `ethers`, así que no hay razón histórica para arrastrarlo.

### Decision: CEX uniqueness — `SELECT … FOR UPDATE` dentro de transacción
**Choice**: `BEGIN; SELECT 1 FROM wallets WHERE network='CEX_BINANCE' FOR UPDATE; INSERT …; COMMIT;`
**Alternatives**: SELECT plano (race condition), unique index parcial en DB (el PRD lo prohíbe explícitamente — service layer).
**Rationale**: V1 es single-user, pero `FOR UPDATE` es trivial y elimina la race entre dos POST simultáneos sin mover la regla a la DB. El PRD nos pide service layer; lo respetamos pero blindamos.

### Decision: Servicios separados (wallet vs token)
**Choice**: `services/wallet.ts` y `services/token.ts` como módulos con funciones (no clases).
**Alternatives**: Un solo `services/portfolio.ts`.
**Rationale**: El proyecto ya usa funciones puras (`services/password.ts`, `services/auth-bootstrap.ts`) y no clases. Mantenemos cohesión por agregado de dominio.

### Decision: Errores tipados de dominio
**Choice**: Clases `DomainError extends Error` con `statusCode` y `code`. El `setErrorHandler` en `index.ts` ya lee `error.statusCode` — funciona out of the box.
**Alternatives**: Throw raw + check con `instanceof` en cada ruta.
**Rationale**: El handler global ya tiene la rama `'statusCode' in error`. Reusamos la infraestructura existente.

## Data Flow

```
HTTP request
  → onRequest hook (authPlugin) — verifica JWT cookie
  → Zod validator (body/query/params)
  → route handler (apps/backend/src/routes/wallets.ts | tokens.ts)
  → service function (services/wallet.ts | token.ts)
       ├─ valida invariantes de dominio (EIP-55, unicidad CEX, coherencia)
       ├─ pool.query() con parámetros
       └─ devuelve row tipada o lanza DomainError
  → reply.send(row)  |  setErrorHandler → JSON estándar
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/backend/src/routes/wallets.ts` | NEW | Plugin Fastify con POST/GET/GET:id/PUT/DELETE |
| `apps/backend/src/routes/tokens.ts` | NEW | Plugin Fastify con GET/POST/PUT (sin DELETE) |
| `apps/backend/src/services/wallet.ts` | NEW | `createWallet`, `listWallets`, `getWallet`, `updateWallet`, `deleteWallet` |
| `apps/backend/src/services/token.ts` | NEW | `listTokens`, `createToken`, `updateToken` |
| `apps/backend/src/services/errors.ts` | NEW | `DomainError`, `ValidationError`, `ConflictError`, `NotFoundError` |
| `apps/backend/src/types/domain.ts` | NEW | Tipos `Wallet`, `Token` (rows tipadas) |
| `apps/backend/src/index.ts` | MODIFY | `await fastify.register(walletRoutes, { prefix: "/api/wallets" })` y tokens |
| `apps/backend/package.json` | MODIFY | `+ "viem": "^2.x"` en dependencies |
| `apps/backend/src/services/__tests__/wallet.test.ts` | NEW | Unit tests (mock pool) |
| `apps/backend/src/services/__tests__/token.test.ts` | NEW | Unit tests (mock pool) |
| `apps/backend/src/routes/__tests__/wallets.e2e.test.ts` | NEW | E2E con `buildServer()` + DB real |
| `apps/backend/src/routes/__tests__/tokens.e2e.test.ts` | NEW | E2E con `buildServer()` + DB real |

## Interfaces / Contracts

```ts
// types/domain.ts
export interface Wallet {
  id: string; user_id: string; wallet_type: WalletType;
  address: string | null; network: Network; label: string | null;
  last_synced_at: Date | null; created_at: Date;
}
export interface Token {
  id: string; symbol: string; name: string | null; network: Network;
  contract_address: string | null; decimals: number;
  binance_symbol: string | null; created_at: Date;
}

// routes/wallets.ts — Zod schemas
const CreateWalletBody = z.discriminatedUnion("wallet_type", [
  z.object({
    wallet_type: z.literal("ON_CHAIN"),
    address: z.string().min(1),           // EIP-55 validado en service
    network: z.enum(["ETH", "BSC"]),
    label: z.string().nullish(),
  }),
  z.object({
    wallet_type: z.literal("CEX"),
    network: z.literal("CEX_BINANCE"),
    label: z.string().nullish(),
  }),
]);
const UpdateWalletBody = z.object({ label: z.string().nullish() });

// routes/tokens.ts
const ListTokensQuery = z.object({
  network: z.enum(["ETH", "BSC", "CEX_BINANCE"]).optional(),
  includeHidden: z.coerce.boolean().optional(),
});
const CreateTokenBody = z.discriminatedUnion("network", [
  z.object({ network: z.enum(["ETH", "BSC"]), symbol: z.string(), name: z.string().nullish(),
             contract_address: z.string(), decimals: z.number().int().min(0).max(38).default(18),
             binance_symbol: z.string().nullish() }),
  z.object({ network: z.literal("CEX_BINANCE"), symbol: z.string(), name: z.string(),
             binance_symbol: z.string() /* requerido */ }),
]);
const UpdateTokenBody = z.object({
  is_hidden: z.boolean().optional(),
  target_exit_price: z.number().nullish(),
  binance_symbol: z.string().nullish(),
});

// services/wallet.ts
export async function createWallet(pool: Pool, userId: string, input: CreateWalletInput): Promise<Wallet>;
```

> **Nota**: `is_hidden` y `target_exit_price` no existen en `0001_initial_schema.sql`. La AC los pide. Se asume migración previa (US-002 extension) o se agregan en una migración auxiliar de US-005 — **decidir en `tasks` phase**, marcado en Open Questions.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|--------------|----------|
| Unit (`test:engine`) | Service functions: validación EIP-55, regla CEX, auto-gen `contract_address`, errores tipados | Vitest + mock de `pg.Pool` (objeto con `.query`) |
| E2E (`test:e2e`) | Routes: 401 sin cookie, 201 happy path, 400 negativos, 409 duplicados | `buildServer()` + DB real, login real para obtener cookie, BEGIN/ROLLBACK por test |

Casos negativos obligatorios (de la AC):
- POST `/api/wallets` ON_CHAIN sin address → 400
- POST `/api/wallets` CEX cuando ya existe una → 400 con mensaje `'Binance account already configured'`
- POST `/api/wallets` ON_CHAIN con `0xabc…` minúscula sin checksum → 400 `'Invalid Ethereum address'`
- POST `/api/tokens` CEX sin `binance_symbol` → 400
- Sin cookie JWT → 401

## Migration / Rollout

Aditivo. Los nuevos archivos no rompen nada; basta con registrar los plugins en `index.ts`. La nueva dependencia `viem` se instala con `npm install viem -w @cryptoledger/backend`. Rollback = revertir los archivos nuevos y la línea de `register`.

## Open Questions

1. **`tokens.is_hidden` y `tokens.target_exit_price` no están en la migración 0001.** ¿Se agrega una migración 0002 dentro de US-005 o se asume que US-002 las incluye? Recomendación: migración 0002 mínima en la fase `tasks` para no bloquear US-005.
2. **Formato del payload de listado** — ¿`{ wallets: [...] }` o array plano? `authRoutes` devuelve objetos planos (`{ ok: true }`); recomendamos array plano para colecciones.
