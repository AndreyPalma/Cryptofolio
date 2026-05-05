# Tasks: API REST — CRUD Wallets y Tokens (US-005)

## Phase 1: Migración y dependencias

- [x] 1.1 Crear `db/migrations/0002_tokens_extra_fields.sql` con UP (`ALTER TABLE tokens ADD COLUMN is_hidden BOOLEAN NOT NULL DEFAULT FALSE; ADD COLUMN target_exit_price NUMERIC(18,8) NULL`) y DOWN (DROP COLUMN ambos)
- [x] 1.2 Instalar `viem` en workspace backend: `npm install viem -w @cryptoledger/backend` y verificar en `apps/backend/package.json`

## Phase 2: Tipos de dominio y errores tipados

- [x] 2.1 Crear `apps/backend/src/types/wallet.ts` con interfaces `Wallet`, `CreateWalletInput`, `UpdateWalletInput` según spec §2
- [x] 2.2 Crear `apps/backend/src/types/token.ts` con interfaces `Token`, `CreateTokenInput`, `UpdateTokenInput`, `FindAllTokensFilter` según spec §2
- [x] 2.3 Crear `apps/backend/src/services/errors.ts` con `DomainError extends Error` (campos `statusCode`, `code`) y subclases `ValidationError` (400), `ConflictError` (409), `NotFoundError` (404)

## Phase 3: WalletService — RED (tests unitarios)

- [x] 3.1 Crear `apps/backend/src/services/__tests__/wallet.test.ts` con mock de `pg.Pool` (objeto `{ query: vi.fn() }`) — tests RED para todos los escenarios: SC-WALLET-CREATE-01..04, SC-WALLET-LIST-01, SC-WALLET-FIND-01..02, SC-WALLET-UPDATE-01..02, SC-WALLET-DELETE-01..02, NEGATIVE-W-01..04

## Phase 4: WalletService — GREEN

- [x] 4.1 Crear `apps/backend/src/services/wallet.ts` — implementar `createWallet`: validación EIP-55 con `viem.getAddress`, lanzar `ValidationError` para NEGATIVE-W-01..04, `SELECT … FOR UPDATE` en transacción para unicidad CEX (SC-WALLET-CREATE-04), normalizar address antes de insertar (SC-WALLET-CREATE-02)
- [x] 4.2 Implementar `findAll`, `findById`, `updateWallet`, `deleteWallet` en el mismo archivo — lanzar `NotFoundError` con código `'WALLET_NOT_FOUND'` cuando `rowCount === 0`
- [x] 4.3 Verificar que todos los tests de 3.1 pasan: `npm run test:engine`

## Phase 5: TokenService — RED (tests unitarios)

- [x] 5.1 Crear `apps/backend/src/services/__tests__/token.test.ts` — tests RED para SC-TOKEN-CREATE-01..03, SC-TOKEN-LIST-01..03, SC-TOKEN-UPDATE-01..05, NEGATIVE-T-01..03

## Phase 6: TokenService — GREEN

- [x] 6.1 Crear `apps/backend/src/services/token.ts` — implementar `createToken`: auto-generar `contract_address = symbol.toLowerCase()` para CEX (SC-TOKEN-CREATE-01..02), lanzar `ValidationError` para NEGATIVE-T-01..02, propagar UNIQUE constraint como `ConflictError('TOKEN_ALREADY_EXISTS')` (NEGATIVE-T-03)
- [x] 6.2 Implementar `findAll` con filtros dinámicos (`WHERE is_hidden = false` por defecto, cláusula `AND network = $n` si presente) — cubrir SC-TOKEN-LIST-01..03
- [x] 6.3 Implementar `updateToken` con SET dinámico solo para campos presentes; lanzar `NotFoundError('TOKEN_NOT_FOUND')` si `rowCount === 0`
- [x] 6.4 Verificar que todos los tests de 5.1 pasan: `npm run test:engine`

## Phase 7: Route plugins — RED (tests e2e)

- [x] 7.1 Crear `tests/e2e/api/wallets.test.ts` — tests con `buildServer()` + DB real + login real para cookie; `resetDb()` en `beforeEach`; cubrir SC-WALLET-POST-01..02, SC-WALLET-GET-01, SC-WALLET-GET-ID-01..02, SC-WALLET-PUT-01, SC-WALLET-DELETE-01, NEGATIVE-R-01..03, SC-AUTH-01
- [x] 7.2 Crear `tests/e2e/api/tokens.test.ts` — cubrir SC-TOKEN-GET-01..03, SC-TOKEN-POST-01, SC-TOKEN-PUT-01, NEGATIVE POST CEX sin binance_symbol

## Phase 8: Route plugins — GREEN

- [x] 8.1 Crear `apps/backend/src/routes/wallets.ts` — plugin Fastify con schemas Zod; POST/GET/GET:id/PUT/DELETE delegando en WalletService; DomainError se propaga al setErrorHandler global
- [x] 8.2 Crear `apps/backend/src/routes/tokens.ts` — plugin Fastify con schemas Zod; GET/POST/PUT delegando en TokenService
- [x] 8.3 Modificar `apps/backend/src/index.ts` — agregar `walletRoutes` y `tokenRoutes` en `buildServer()` con prefixes `/api/wallets` y `/api/tokens`
- [x] 8.4 Verificar tests e2e — BLOCKED: local Postgres en puerto 5433 no está corriendo (pre-existing infrastructure issue). Engine tests: 158/158 ✓
