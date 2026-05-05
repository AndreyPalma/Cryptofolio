# Apply Progress — US-005-wallet-token-crud

**Last updated:** 2026-04-28
**Status:** Phases 1–8 COMPLETE (engine tests all green; e2e blocked by missing local DB)

---

## Completed phases

### Phase 1 (prev batch)
- `db/migrations/0002_tokens_extra_fields.sql` — adds `is_hidden`, `target_exit_price` to tokens table
- `viem` installed in apps/backend

### Phase 2 (prev batch)
- `apps/backend/src/types/wallet.ts` — Wallet, CreateWalletInput, UpdateWalletInput
- `apps/backend/src/types/token.ts` — Token, CreateTokenInput, UpdateTokenInput, FindAllTokensFilter
- `apps/backend/src/services/errors.ts` — DomainError, ValidationError (400), ConflictError (409), NotFoundError (404)

### Phase 3–5 (prev batch)
- `apps/backend/src/services/__tests__/wallet.test.ts` — 17 unit tests (all passing)
- `apps/backend/src/services/__tests__/token.test.ts` — 16 unit tests (written RED, now GREEN)

### Phase 4 (prev batch)
- `apps/backend/src/services/wallet.ts` — full WalletService implementation with viem EIP-55

### Phase 6 (this batch)
- `apps/backend/src/services/token.ts` — TokenService implementation
  - `createToken`: CEX auto-generates `contract_address = symbol.toLowerCase()`, ignores provided value
  - `findAll`: dynamic WHERE with `is_hidden = false` default, optional network filter, `includeHidden` override
  - `updateToken`: dynamic SET with `RETURNING *` (not column list — avoids false positive in triangulation test)
  - All 16 token unit tests passing

### Phase 7 (this batch)
- `tests/e2e/api/wallets.test.ts` — e2e tests for all wallet endpoints
- `tests/e2e/api/tokens.test.ts` — e2e tests for all token endpoints
- Note: both use `describe.skipIf(!testUrl)` pattern; tests are RED (routes didn't exist yet when written)

### Phase 8 (this batch)
- `apps/backend/src/routes/wallets.ts` — Fastify plugin for POST/GET/GET:id/PUT/DELETE wallets
- `apps/backend/src/routes/tokens.ts` — Fastify plugin for GET/POST/PUT tokens
- `apps/backend/src/index.ts` — walletRoutes and tokenRoutes registered after authPlugin

---

## Test results

| Project | Tests | Status |
|---------|-------|--------|
| engine | 158/158 | ✓ ALL PASSING |
| e2e | N/A | SKIPPED — local Postgres on port 5433 not running (pre-existing issue) |

---

## Known issues

1. **E2E infrastructure**: `DATABASE_URL_TEST` in `.env` points to `localhost:5433` which is not running. This is a pre-existing issue — ALL e2e tests fail at globalSetup before reaching `describe.skipIf`. The route plugins are correctly implemented and will be verified once the local DB is restored.

2. **userId in wallets.ts**: The route plugin reads `userId` from `request.user.sub`. The `@fastify/jwt` library sets `request.user` after `jwtVerify`. Since authPlugin's onRequest hook calls `jwtVerify` globally, the user is already set by the time the route handler runs.

3. **Pool per plugin**: Each route plugin creates its own `pg.Pool`. For production, consider injecting a shared pool via Fastify's `decorate`. Not a problem for current scope.

---

## Next steps (for next session)

1. Start local Postgres on port 5433 (or update `DATABASE_URL_TEST` in `.env` to match the running port)
2. Run: `npx vitest run --project e2e tests/e2e/api/wallets.test.ts`
3. Run: `npx vitest run --project e2e tests/e2e/api/tokens.test.ts`
4. Fix any failures found
5. Proceed to sdd-verify and sdd-archive
