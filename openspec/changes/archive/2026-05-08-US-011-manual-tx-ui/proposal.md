# US-011 Proposal — Formulario de ingreso manual de transacciones (UI)

## Intent

Build a frontend-only manual transaction entry form (`/transactions/new`) with real-time WAC and balance preview, TRANSFER_IN inheritance suggestions, and inline validation against existing balances — leveraging the already-shipped `POST /api/transactions` endpoint without backend changes.

## Scope

### IN scope
- New route `/transactions/new` (protected) and a new `AddTransactionPage` component.
- New presentational components: `WalletSourceSelect`, `TokenSelect`, `TransactionTypeSelect`, `AmountInput`, `PriceUsdInput`, `DateTimeInput`, `WacPreview`, `InheritWacSuggestion`.
- New hooks: `useTokensByWallet(wallet)`, `useWacPreview(walletId, token, type, amount, price)`, `useTransferInSuggestion(token, destinationWalletId)`, `useCreateTransaction()`.
- Form flow built with React 19 `useActionState` (no `react-hook-form`).
- Inline toast (no external library) — `useToast()` hook with a `<Toast />` root mounted in `AppLayout`.
- Entry points: button on `DashboardPage` header AND button on `TokenDetailPage` (the latter pre-fills wallet+token via query params).
- Frontend-only fix for the `WalletEntry` snake_case → camelCase mismatch (transform inside `useWallets`).
- Tests (TDD, written before implementation): one test file per hook, one per component, one integration test for the page that mocks `apiClient`.

### OUT of scope
- Backend changes — `POST /api/transactions`, `GET /api/wallets`, `GET /api/tokens`, `GET /api/portfolio/token/:address/:network` are all consumed as-is.
- Backend WAC preview endpoint — preview is computed client-side.
- Editing or deleting transactions (separate story).
- Bulk import / CSV (separate story).
- Backend-side wallet response shape change (snake_case → camelCase). Fixing this at the backend would touch every other hook; the cheapest, safest fix for US-011 is a transform in `useWallets`.
- Dust conversion handling — explicitly a non-goal per PRD v5.

## Decisions

### D1 — Toast: inline state, no library
**Decision**: implement a tiny inline toast (`{ message: string, variant: 'success' | 'error' } | null` state in a `ToastContext`) with a 3-second auto-dismiss. Mount the `<Toast />` root in `AppLayout`. Expose `useToast()` returning `{ show(msg, variant) }`.

**Rationale**: the project has zero third-party UI libs and follows a Tailwind-first pattern. Adding `sonner` for one toast type ("Transaction added. Cycle #N updated.") inflates the bundle and breaks consistency. A 30-line `Toast` component is trivial to test and matches the LoginPage `<p role="alert">` philosophy.

**Tradeoff accepted**: no toast queue (only one toast at a time). Acceptable — US-011 only ever shows one success toast at a time.

### D2 — Entry points: dashboard header button + token detail page button
**Decision**: two entry points.
1. `DashboardPage` header — a primary button labeled "Add Transaction" → navigates to `/transactions/new` (no query params; user picks wallet + token).
2. `TokenDetailPage` action area — button "Add Transaction" → navigates to `/transactions/new?wallet_id={firstWalletInBreakdown}&token_id={tokenId}` (pre-fills the form).

**Rationale**: AC-6 requires redirect to `/token/:address/:network` after success — implying users start either context-free (dashboard) or already on a token page. Both are real workflows. No FAB pattern: there is no `position: fixed` FAB component in the codebase yet, and a header button is consistent with existing UI.

**Tradeoff accepted**: more code than a single entry point, but the duplication is just two `<Link to="/transactions/new">` buttons.

### D3 — Token filtering: all tokens on the wallet's network
**Decision**: when a wallet is selected, fetch `GET /api/tokens?network={wallet.network}` and show all non-hidden tokens. Do NOT restrict to tokens with existing positions.

**Rationale**: the form must support buying a brand-new token (first BUY on a token with no prior position). Restricting to existing positions would break the "buy something new" flow, which is the most common manual-entry use case.

**Tradeoff accepted**: long token lists for ETH. Mitigation: the `<select>` uses native browser search; if the list grows beyond ~50 tokens we can add a typeahead input later (out of scope).

### D4 — SWAP_IN / SWAP_OUT: include in dropdown with a warning
**Decision**: include all six types in the `type` select. When the user selects `SWAP_IN` or `SWAP_OUT`, show a non-blocking note below the field: "Swaps usually come in pairs (OUT + IN). To record a full swap, submit both sides separately."

**Rationale**: the backend `POST /api/transactions` accepts a standalone SWAP_IN/SWAP_OUT (no `related_tx_id` enforcement). Excluding them from the UI would make the form less capable than the API. The note nudges users toward correct accounting without blocking edge cases (e.g., recovering from a half-synced swap).

**Tradeoff accepted**: users can create unbalanced swap pairs. This matches backend behavior — the form mirrors API semantics rather than introducing a stricter policy.

### D5 — Price field: always visible, optional only for TRANSFER_OUT
**Decision**: the price input is always rendered (no DOM toggling).
- `BUY`, `SWAP_IN`, `TRANSFER_IN`: required, positive number.
- `SELL`, `SWAP_OUT`: required, positive number (used to compute realized P&L on the lot).
- `TRANSFER_OUT`: optional. Empty input → submit `price_usd_at_time: null`. Non-empty → must parse to a positive number.

**Rationale**: keeping the field always visible avoids layout jumps and is consistent with the LoginPage "always show all fields" pattern. Required/optional state is communicated via the label suffix (`Price USD *` vs `Price USD (optional)`) and validated in `useActionState`.

**Note**: AC-7 ("Price = 0 → error") applies whenever the field has a value — even when it's optional, `0` is invalid (only blank is acceptable for TRANSFER_OUT).

### D6 — WAC preview: client-side `parseFloat` is acceptable
**Decision**: compute the preview with native JS `parseFloat` and `Number` arithmetic. Do NOT pull in `decimal.js` or `big.js` for the frontend.

**Rationale**: the preview is informational, not binding — the backend recomputes WAC with `Decimal.js` in the position engine and returns the authoritative `wac` field in the response. JS float precision (≈15 significant digits) is more than enough for a "New WAC: $1234.56" display. Adding `decimal.js` to the frontend bundle for a preview is overkill.

**Display rule**: format with `formatUsd` (existing helper). If either `amount` or `price` parses to NaN or non-positive, hide the preview.

**Tradeoff accepted**: preview may differ from committed value at the 8th+ decimal. Documented in the UI as "Estimated — final value computed on submit."

### D7 — TRANSFER_IN inheritance UX
**Decision**: when `type === 'TRANSFER_IN'` AND a token is selected AND the destination wallet is `ON_CHAIN`, fire `GET /api/portfolio/token/{contractAddress}/{network}` (no `wallet_id` filter — we want all wallets that hold this token).

Filter the response's `position.walletBreakdown[]`:
- exclude the destination wallet itself
- keep only entries with `parseFloat(balance) > 0`
- keep only entries where the wallet is `ON_CHAIN` (cross-reference with `useWallets` data — CEX-side WAC inheritance is handled by the backend on real syncs, not by manual entries per PRD)

If at least one match remains, render an inline panel above the price field:
```
Inherit WAC $1234.56 from "Cold Wallet ETH"?
[Use this]
```

Clicking "Use this" sets `price_usd_at_time` to the matched `wac` AND sets the hidden form field `cost_source` to `'INHERITED'`. The user can edit the price afterwards (which reverts `cost_source` to `'MANUAL'` automatically).

**Caching**: the suggestion hook is keyed by `(contractAddress, network, destinationWalletId, type)`. It only fires when all four are set; toggling away from TRANSFER_IN cancels in-flight requests via the existing `cancelled` flag pattern.

**Rationale**: this matches the backend's `resolveTransferCost` step 1 (find `from_address` matching a registered ON_CHAIN wallet with an OPEN position) but as a UX hint. The backend's own resolver does NOT run for `MANUAL` source; the user must explicitly opt in.

### D8 — `walletType` mismatch fix: transform in `useWallets`
**Decision**: fix the bug in `useWallets`. The hook will fetch the raw backend rows, then map each row to `WalletEntry` (`wallet_type` → `walletType`, all other fields kept as-is from the raw response).

**Rationale**: changing the backend response shape would break every other consumer in subtle ways and reopen US-005. The hook is the only consumer of `WalletEntry` today; transforming there is one ~5-line change with full test coverage. Add a regression test asserting `walletType` is defined for both wallet kinds.

**Type strategy**: introduce `WalletApiRow` (snake_case, mirrors backend) inside `useWallets.ts`, keep `WalletEntry` (camelCase) in `types/token-detail.ts` as the consumer-facing type, and transform between them.

## API Contract — POST /api/transactions

### Request
```http
POST /api/transactions
Content-Type: application/json
Cookie: token=<jwt>
```

```json
{
  "wallet_id": "uuid",
  "token_id": "uuid",
  "type": "BUY | SELL | SWAP_IN | SWAP_OUT | TRANSFER_IN | TRANSFER_OUT",
  "amount": "decimal-string (regex /^\\d+(\\.\\d+)?$/, value > 0)",
  "price_usd_at_time": "decimal-string | null",
  "block_timestamp": "ISO-8601 datetime (with seconds + Z, e.g. 2025-05-08T14:30:00.000Z)",
  "cost_source": "MARKET | INHERITED | MANUAL (optional, defaults to MANUAL on backend for manual entries)"
}
```

Notes confirmed from `apps/backend/src/routes/transactions.ts:13-23`:
- `price_usd_at_time` is `.nullable()` at schema level — but the service throws `ValidationError('PRICE_REQUIRED_FOR_TRANSFER_IN')` if null on TRANSFER_IN.
- `block_timestamp` uses `z.iso.datetime()` — requires seconds and timezone. The form will compose `${dateTimeLocalValue}:00.000Z` before submitting.
- `amount` regex disallows scientific notation — the form uses `<input type="text" inputMode="decimal">` and strips invalid characters on input.

### Response 201
```json
{
  "transaction_id": "uuid",
  "position_id": "uuid",
  "cycle_number": 3,
  "status": "OPEN | CLOSED",
  "wac": "decimal-string",
  "balance": "decimal-string"
}
```

### Errors
| Status | Error code                  | Form behavior                                                  |
|--------|-----------------------------|----------------------------------------------------------------|
| 400    | `INSUFFICIENT_BALANCE`      | Inline error: "Exceeds balance of {currentBalance} tokens"     |
| 400    | `Validation failed`         | Inline errors per `issues[].path`                              |
| 400    | `PRICE_REQUIRED_FOR_TRANSFER_IN` | Inline error on the price field                           |
| 404    | wallet/token not found      | Inline error: "Selected wallet or token no longer exists"      |
| 401    | unauthorized                | Existing `apiClient` redirects to `/login`                     |

The form additionally pre-validates `SELL` / `SWAP_OUT` / `TRANSFER_OUT` `amount > currentBalance` client-side using the portfolio data (AC-5: submit button disabled with explicit message).

## Navigation Flow

```
Dashboard ──"Add Transaction"──▶ /transactions/new
TokenDetail ──"Add Transaction"──▶ /transactions/new?wallet_id=…&token_id=…
                                          │
                                          ├─ user fills form, sees WAC preview
                                          ├─ optional: clicks "Use this" on inherit suggestion
                                          ▼
                                       Submit
                                          │
                ┌─────────────────────────┼─────────────────────────┐
                ▼                         ▼                         ▼
            201 OK                   400 validation              401 auth
                │                         │                         │
                │                         │                         ▼
                │                         ▼                  redirect /login
                │                  inline error,
                │                  form stays open
                ▼
      toast "Transaction added.
       Cycle #N updated."
                │
                ▼
   navigate to /token/{contractAddress}/{network}
   (resolved from the selected token's id → token info from /api/tokens cache)
```

## Risks

### R1 — `block_timestamp` formatting bug
The form's `<input type="datetime-local">` returns `YYYY-MM-DDTHH:mm`. The backend rejects anything that doesn't match `z.iso.datetime()` (needs seconds + timezone). If the formatter forgets to append `:00.000Z`, every submit returns 400 with a Zod `invalid_string`.

**Mitigation**: a pure helper `toIso8601(dateTimeLocal: string): string` with its own unit tests, called inside the form action. The integration test asserts the request body's `block_timestamp` ends in `:00.000Z`.

### R2 — TRANSFER_IN suggestion races with form changes
The user can change wallet, token, and type quickly. If two suggestion fetches are in flight, the latter must win (or the earlier must be cancelled). Without cancellation, stale data could overwrite the current suggestion.

**Mitigation**: `useTransferInSuggestion` reuses the existing `cancelled` flag pattern from `useWallets`. The hook keys on `(contractAddress, network, destinationWalletId, type)` and abandons stale results in the cleanup function.

### R3 — Client-side balance check goes out of sync with backend
The form pre-validates `SELL`/`SWAP_OUT`/`TRANSFER_OUT` against the portfolio response. If the portfolio data is stale (e.g., a sync just ran in another tab), the client could either over-block (refusing a valid sell) or under-block (allowing a sell the backend rejects).

**Mitigation**: trust the backend as the source of truth — when the backend returns 400 `INSUFFICIENT_BALANCE`, the form unblocks and shows the server-provided `currentBalance` and `attempted` values, overriding the client preview. Document the preview as "estimated based on last sync".
