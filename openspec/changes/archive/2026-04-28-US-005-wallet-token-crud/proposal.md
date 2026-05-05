# Proposal: API REST — CRUD Wallets y Tokens (ON_CHAIN + CEX)

## Intent

Exponer endpoints REST autenticados para que el usuario gestione sus wallets (on-chain ETH/BSC y cuenta CEX Binance) y tokens (on-chain y CEX), respetando los invariantes de identidad del dominio y la restricción de una única cuenta CEX por plataforma.

## Scope

**In Scope**
- `POST/GET/PUT/DELETE /api/wallets` y `GET/POST/PUT /api/tokens` con `authMiddleware`
- Validación EIP-55 de address on-chain (vía `ethers.getAddress` o `viem getAddress`)
- Regla de unicidad CEX en service layer (no en DB constraint)
- Filtros: `?network=CEX_BINANCE`, `?includeHidden=true`
- Auto-generación de `contract_address = symbol.toLowerCase()` para tokens CEX

**Out of Scope**
- Sincronización de transacciones (US-006/007/008)
- Gestión de `api_credentials` (Binance API keys)
- DELETE de tokens (no está en la AC)
- Frontend / UI

## Capabilities

### New Capabilities
- `WalletService` — crea, lee, actualiza y elimina wallets; valida tipo, network y address; enforza unicidad CEX
- `TokenService` — crea y actualiza tokens; auto-genera `contract_address` para CEX; soporta filtros
- Route plugin `walletRoutes` — monta `/api/wallets` con `preHandler: [fastify.authenticate]`
- Route plugin `tokenRoutes` — monta `/api/tokens` con `preHandler: [fastify.authenticate]`
- Zod schemas para body/query de los 7 endpoints

### Modified Capabilities
- `apps/backend/src/index.ts` — registra los dos nuevos route plugins

## Approach

1. **Validación en service layer**: `WalletService.create()` lanza error tipado si faltan campos obligatorios por tipo o si ya existe una wallet CEX_BINANCE.
2. **EIP-55**: usar `ethers` (ya en `package.json` vía dependencias del motor o agregar) — `ethers.getAddress(raw)` lanza si el checksum falla; capturar y devolver 400.
3. **Zod 4 + fastify-type-provider-zod**: mismo patrón que `authRoutes` pero con schemas explícitos para type safety de request/response.
4. **Errores homogéneos**: `{ statusCode, error, message }` consistente con el formato actual de auth.

## Affected Areas

| Area | Cambio |
|------|--------|
| `apps/backend/src/routes/wallets.ts` | nuevo plugin Fastify |
| `apps/backend/src/routes/tokens.ts` | nuevo plugin Fastify |
| `apps/backend/src/services/wallet.ts` | nuevo WalletService |
| `apps/backend/src/services/token.ts` | nuevo TokenService |
| `apps/backend/src/index.ts` | registro de plugins |
| `apps/backend/package.json` | agregar `ethers` si no está |
| `apps/backend/src/types/` | tipos de dominio Wallet/Token |

## Risks

| Riesgo | Mitigación |
|--------|------------|
| `ethers` no disponible — agregar dependencia pesada | Evaluar `viem` (más liviano, tree-shakeable) como alternativa; decidir en design |
| CEX uniqueness race condition (dos requests simultáneos) | Aceptado en V1 — no hay concurrencia real con un solo usuario |
| `contract_address = symbol.toLowerCase()` puede colisionar si dos tokens CEX tienen igual symbol | El UNIQUE de tokens ya protege; la colisión es un error 409 esperado |

## Rollback Plan

- Los nuevos archivos son aditivos; eliminar los 4 archivos nuevos y revertir `index.ts` deja el sistema en estado previo sin migraciones.

## Dependencies

- **US-002** (DB schema): tablas `wallets` y `tokens` ya existentes
- **US-003** (auth): `fastify.authenticate` ya disponible
- `ethers` o `viem` como nueva dependencia de runtime

## Success Criteria

- `POST /api/wallets` ON_CHAIN con address EIP-55 válida → 201
- `POST /api/wallets` CEX con `network='CEX_BINANCE'` y sin address → 201
- Segundo `POST /api/wallets` CEX → 400 `'Binance account already configured'`
- `POST /api/wallets` ON_CHAIN sin address → 400 `'Address required for on-chain wallet'`
- `POST /api/wallets` ON_CHAIN con address sin checksum válido → 400 `'Invalid Ethereum address'`
- `GET /api/tokens?network=CEX_BINANCE` devuelve solo tokens CEX
- `PUT /api/tokens/:id` actualiza `is_hidden`, `target_exit_price`, `binance_symbol`
- `POST /api/tokens` CEX genera `contract_address = symbol.toLowerCase()` automáticamente
- Todos los endpoints requieren JWT válido — sin token → 401
