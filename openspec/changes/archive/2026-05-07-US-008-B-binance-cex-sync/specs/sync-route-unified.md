# Spec — Unified Sync Route

**Change**: US-008-B-binance-cex-sync
**Date**: 2026-05-07
**Status**: draft

---

## §1 Route

```
POST /api/sync/:walletId
```

Same path as the existing on-chain sync route. No new route is added. The handler is extended to dispatch based on `wallet_type`.

**File**: `apps/backend/src/routes/sync.ts`

---

## §2 Handler

```typescript
fastify.post<{ Params: { walletId: string } }>(
  '/:walletId',
  { schema: { params: SyncParamsSchema } },
  async (req, reply) => {
    // Step 1 — extract userId from JWT
    const userId = req.user.sub  // set by global JWT onRequest preHandler

    // Step 2 — validate walletId (Zod, already done by schema: SyncParamsSchema)
    // SyncParamsSchema: z.object({ walletId: z.uuid() })
    // Fastify returns 400 automatically on schema failure — no manual check needed

    // Step 3 — load wallet
    const result = await pool.query(
      'SELECT id, wallet_type, user_id FROM wallets WHERE id = $1 AND user_id = $2',
      [req.params.walletId, userId]
    )
    const wallet = result.rows[0]

    // Step 4 — not found
    if (!wallet) {
      throw new NotFoundError('Wallet not found', 'WALLET_NOT_FOUND')
    }

    // Step 5 — dispatch
    if (wallet.wallet_type === 'ON_CHAIN') {
      const syncResult = await onChainSyncService.sync(req.params.walletId, userId)
      return reply.send(syncResult)
    }

    // wallet_type === 'CEX'
    const binanceResult = await binanceSyncService.sync(req.params.walletId, userId)
    return reply.send(binanceResult)
  }
)
```

**Parameter validation**: `SyncParamsSchema = z.object({ walletId: z.uuid() })` — already defined in `apps/backend/src/schemas/sync.ts`. Fastify returns 400 with Zod error details automatically on invalid UUID.

---

## §3 Response schemas

The two services return incompatible shapes. They are kept as separate Zod schemas:

```typescript
// apps/backend/src/schemas/sync.ts

// Existing — ON_CHAIN branch (unchanged)
export const SyncResultSchema = z.object({
  synced: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  swapsDecomposed: z.number().int().nonnegative(),
  transfersPendingCost: z.number().int().nonnegative(),
  transfersInheritedFromCEX: z.number().int().nonnegative(),
  newTransactions: z.number().int().nonnegative(),
})

// New — CEX branch
export const BinanceSyncResultSchema = z.object({
  trades: z.object({
    synced: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    symbolsProcessed: z.number().int().nonnegative(),
  }),
  converts: z.object({
    synced: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
  withdrawals: z.object({
    synced: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
  deposits: z.object({
    synced: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    inherited: z.number().int().nonnegative(),
    manual: z.number().int().nonnegative(),
  }),
  tokensCreated: z.number().int().nonnegative(),
})
```

**Route response annotation**: use `z.unknown()` on the Fastify route schema (skip response validation). The union is enforced at the TypeScript level via the service return types, not at runtime serialization. This avoids a Fastify limitation where union type validation on replies can produce false negatives.

```typescript
// In route schema options:
schema: {
  params: SyncParamsSchema,
  response: { 200: z.unknown() }  // runtime validation skipped; TypeScript types are authoritative
}
```

Both `SyncResultSchema` and `BinanceSyncResultSchema` are exported and used directly by consumers (tests, OpenAPI generation) to validate responses per branch.

---

## §4 Changes to OnChainSyncService

**File**: `apps/backend/src/services/on-chain-sync.ts`

**Remove**: the current wallet-type guard at lines 73–75:
```typescript
// REMOVE THIS:
if (wallet.wallet_type === 'CEX') {
  throw new ValidationError('Wallet is not an on-chain wallet', 'WRONG_WALLET_TYPE')
}
```

**Replace with**: a programming-error assertion (not a user-facing error):
```typescript
// REPLACE WITH:
if (wallet.wallet_type !== 'ON_CHAIN') {
  throw new Error(
    `invariant violated: OnChainSyncService.sync called with wallet_type='${wallet.wallet_type}'`
  )
}
```

**Rationale**: the route dispatch now owns the `wallet_type` gate. A CEX wallet will never reach `OnChainSyncService.sync()` in normal operation. The assertion is defense-in-depth for programming errors (e.g. a test that bypasses the route), not a user-facing validation. It throws a generic `Error`, which Fastify maps to 500 — correct for programming errors.

The wallet load inside `OnChainSyncService.sync()` can remain as-is (it still needs to load the wallet for the `address` and `network` fields). The invariant assertion should fire immediately after the load, before any sync logic begins.

---

## §5 Authentication

The global JWT `onRequest` preHandler is already registered in `apps/backend/src/app.ts` and covers all `/api/*` routes. No per-route `preHandler` is needed for this route.

`req.user.sub` is the authenticated `userId` (UUID string) set by the preHandler. The handler reads it directly without re-validating the token.

---

## §6 Error responses

| Scenario | Status | Code |
|----------|--------|------|
| `walletId` not a valid UUID | 400 | Zod error (Fastify default) |
| Wallet not found or belongs to different user | 404 | `WALLET_NOT_FOUND` |
| Missing JWT / invalid token | 401 | handled by preHandler (unchanged) |
| `BINANCE_API_KEY` not configured | 400 | `API_KEY_MISSING` |
| Invalid Binance credentials | 400 | `BINANCE_INVALID_CREDENTIALS` |
| Binance API failure | 502 | `EXTERNAL_API_ERROR` |

---

## §7 Test scenarios for the route

These complement the `BinanceSyncService` unit tests. Tests use the Fastify test instance (inject) and a seeded test DB.

| Scenario | Type | Expected |
|----------|------|----------|
| `POST /api/sync/:cexWalletId` with valid CEX wallet and mocked Binance client returning empty responses | E2E | 200, body matches `BinanceSyncResultSchema` |
| `POST /api/sync/:onChainWalletId` with valid ON_CHAIN wallet | E2E | 200, body matches `SyncResultSchema` (existing test — verify still passes after route refactor) |
| `POST /api/sync/not-a-uuid` | E2E | 400, Zod validation error |
| `POST /api/sync/:nonExistentId` (valid UUID, no DB row) | E2E | 404, `WALLET_NOT_FOUND` |
| `POST /api/sync/:cexWalletId` with `BINANCE_API_KEY` unset | E2E | 400, `API_KEY_MISSING` |
| `POST /api/sync/:cexWalletId` where Binance returns `-2015` | E2E | 400, `BINANCE_INVALID_CREDENTIALS`, no key value in body |
