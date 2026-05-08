# US-011 Exploration — Formulario de ingreso manual de transacciones (UI)

## Summary

US-011 adds a manual transaction form with real-time WAC preview. All necessary backend APIs are already in place (US-006 through US-009). The frontend has strong patterns to follow from the dashboard and token-detail pages. The main gaps are: no toast library, no form library, no per-wallet token-list endpoint, and no backend WAC-preview endpoint (must be computed client-side). The TRANSFER_IN WAC inheritance suggestion requires querying existing positions via `GET /api/portfolio/token/:contractAddress/:network` with a wallet filter — that endpoint already exists.

---

## API Surface (what exists that US-011 can use)

### POST /api/transactions
Route: `apps/backend/src/routes/transactions.ts`

**Request body** (Zod schema `CreateTransactionBodySchema`):
```typescript
{
  wallet_id:         string (UUID)
  token_id:          string (UUID)
  type:              'BUY' | 'SELL' | 'SWAP_IN' | 'SWAP_OUT' | 'TRANSFER_IN' | 'TRANSFER_OUT'
  amount:            string (numeric regex, must be > 0)
  price_usd_at_time: string (numeric regex) | null   // nullable for TRANSFER_OUT only
  block_timestamp:   string (ISO-8601 datetime)
  cost_source?:      'MARKET' | 'INHERITED' | 'MANUAL'  // optional
}
```

**Response 201** (`CreateTransactionResult`):
```typescript
{
  transaction_id: string
  position_id:    string
  cycle_number:   number
  status:         'OPEN' | 'CLOSED'
  wac:            string (DecimalString)
  balance:        string (DecimalString)
}
```

**Error responses**:
- `400 INSUFFICIENT_BALANCE` — includes `currentBalance` and `attempted` fields
- `400 Validation failed` — Zod issues array
- `400 ValidationError` — domain errors (e.g., `PRICE_REQUIRED_FOR_TRANSFER_IN` when type=TRANSFER_IN and price is null)
- `404 NotFoundError` — wallet or token not found

**Important domain rule**: `price_usd_at_time` is nullable in the schema, but the service throws `ValidationError('PRICE_REQUIRED_FOR_TRANSFER_IN')` if type=TRANSFER_IN and price is null. The form must always require a price for TRANSFER_IN. For TRANSFER_OUT, price can be null (generates zero realized P&L per engine logic).

### GET /api/wallets
Route: `apps/backend/src/routes/wallets.ts` → `services/wallet.ts`

Returns `Wallet[]` ordered by `created_at ASC`. Each wallet:
```typescript
{
  id:             string (UUID)
  user_id:        string
  wallet_type:    'ON_CHAIN' | 'CEX'
  address:        string | null   // null for CEX
  network:        'ETH' | 'BSC' | 'CEX_BINANCE'
  label:          string | null
  last_synced_at: string | null
  created_at:     string
}
```

The frontend hook `useWallets` (already implemented) fetches `GET /api/wallets` and returns `WalletEntry[]` — a subset type: `{ id, label, walletType, network }`. The form can reuse this hook directly.

CEX wallets have `network = 'CEX_BINANCE'`. There is always at most one CEX wallet (enforced in service layer).

### GET /api/tokens
Route: `apps/backend/src/routes/tokens.ts` → `services/token.ts`

Accepts optional query params: `?network=ETH` (filter by network) and `?includeHidden=true`.

Returns `Token[]`:
```typescript
{
  id:                string (UUID)
  symbol:            string
  name:              string | null
  network:           string
  contract_address:  string    // for CEX tokens: symbol.toLowerCase()
  decimals:          number
  binance_symbol:    string | null
  is_hidden:         boolean
  target_exit_price: string | null
  created_at:        string
}
```

This is the key endpoint for the token selector filtered by wallet:
- For ON_CHAIN wallet (ETH/BSC): fetch `GET /api/tokens?network={wallet.network}`
- For CEX wallet: fetch `GET /api/tokens?network=CEX_BINANCE`

Note: the `network` filter exists on the tokens endpoint, which maps to wallet.network exactly.

### GET /api/portfolio
Returns `PortfolioSummary` — summary + `tokens[]` (all OPEN positions aggregated, with `walletBreakdown[]` per token showing per-wallet wac/balance). This is the data source for WAC preview.

`walletBreakdown` entries: `{ walletId, label, balance, wac }`.

To get WAC/balance for a specific wallet+token, the form should scan `walletBreakdown` for the matching `walletId`.

### GET /api/portfolio/token/:contractAddress/:network?wallet_id=X
Returns `TokenDetail` with position stats for the given token. When `wallet_id` is provided (ON_CHAIN only), it filters positions to that specific wallet. This is critical for the TRANSFER_IN inheritance flow.

The `position.walletBreakdown` array in the response gives `{ walletId, label, balance, wac }` — exactly what's needed to suggest WAC inheritance from another wallet.

---

## Missing / Gaps

1. **No `/api/tokens?wallet_id=X` endpoint** — there is no way to ask "which tokens does wallet X hold?". The token list endpoint filters by `network` but not by `wallet_id`. However, the `network` filter is sufficient: ON_CHAIN wallets have a fixed network (ETH or BSC) and CEX wallets are always `CEX_BINANCE`. The form can fetch `GET /api/tokens?network={wallet.network}` and get the relevant tokens. This shows *all tokens on that network* (not just those with existing positions), which is correct for manual entry (you might be buying a new token).

2. **No WAC preview endpoint** — there is no `GET /api/preview` or similar. WAC must be computed client-side (see WAC Preview Strategy below). The backend position engine formula is visible in `engine.ts`.

3. **No toast/notification library** — `package.json` has no toast library (no `sonner`, `react-hot-toast`, `react-toastify`). US-011 must either install one or implement a simple toast component from scratch. Given the project uses Tailwind-first patterns and no external UI library, a minimal inline toast state (`{ message, type }`) managed in the form page is the recommended approach to avoid adding a new dependency.

4. **No form management library** — no `react-hook-form`, `formik`, or similar. LoginPage uses raw `useState` + manual validation. US-011 must follow the same pattern for consistency.

5. **No `GET /api/portfolio?wallet_id=X`** — the portfolio summary endpoint does NOT support filtering by wallet. The full list is always returned, but each item includes `walletBreakdown[]` with per-wallet data. The form can scan this array by `walletId`.

6. **`WalletEntry` type mismatch** — the backend `Wallet` type uses snake_case (`wallet_type`), but `useWallets` expects camelCase (`walletType`). Checking the hook: it types the response as `WalletEntry[]` — this means the backend must already return camelCase OR the hook must transform. Based on the type definition in `token-detail.ts`, `WalletEntry.walletType` is camelCase. However the backend `walletRoutes` returns the raw DB row which has `wallet_type` (snake_case). This is a gap — either the hook transforms, or the backend needs to return camelCase. This must be verified or fixed.

---

## Frontend Patterns (reusable components, hooks, patterns found)

### Hook pattern
All hooks follow: `{ data, loading, error }` with `useEffect` + cleanup cancellation via `cancelled` flag or `isMountedRef`. New hooks should follow the same pattern. Example: `useWallets`, `usePortfolio`, `useTokenDetail`.

### api-client
`apiClient.post<T>(url, body)` for POST, `apiClient.get<T>(url)` for GET. Returns parsed JSON directly. Throws `Error` on non-2xx (except 401 which throws `UnauthorizedError`). The form's submit handler should catch `Error` and display inline.

### cn() helper
Available at `src/lib/cn.ts` — wraps `clsx + twMerge`. Use for conditional class composition.

### format helpers
`src/lib/format.ts` exports `formatUsd`, `formatPct`, `formatCrypto`. The WAC preview can use `formatUsd` for displaying "New WAC: $X".

### LoginPage form pattern
The only existing form example. Pattern:
- `useState` for each field
- `useState<string | null>` for error state
- `useState<boolean>` for submitting state
- Inline `<p role="alert">` for errors
- `<button disabled={submitting}>` during submit
- No form library

### Test pattern
Tests live in `apps/frontend/tests/` (not colocated). Mock `apiClient` with `vi.mock('../src/lib/api-client', ...)`. Use `renderHook` for hooks, `render` + `waitFor` for pages. No `@testing-library/jest-dom` — use DOM assertions directly (`.textContent`, `.querySelector`, `getAttribute`). `MemoryRouter` wraps pages in tests.

### Tailwind patterns
Dark theme: `bg-gray-950`, `bg-gray-900`, `bg-gray-800`. Text: `text-white`, `text-gray-400`. Borders: `border-gray-700`. Buttons: `rounded-md bg-indigo-600 px-4 py-2 text-sm`. Error: `text-red-400`, `border-red-800 bg-red-950`. All `select` elements use `bg-gray-800 border border-gray-700 text-white rounded`.

### Existing reusable components
- `NetworkBadge` — displays ETH/BSC/CEX_BINANCE badge
- `WalletSelector` — `<select>` with wallet options (currently uses `WalletBreakdown[]`, may need adapting for full `WalletEntry[]`)
- `TokenLogo` — token logo with fallback
- `TypeBadge`, `SourceBadge`, `CostSourceBadge` — informational badges

---

## WAC Preview Strategy

**Decision: client-side computation only.** No backend preview endpoint exists. The WAC formula from `engine.ts`:

For inbound types (BUY, SWAP_IN, TRANSFER_IN):
```
new_wac    = (old_balance * old_wac + amount * price) / (old_balance + amount)
new_balance = old_balance + amount
```

For outbound types (SELL, SWAP_OUT, TRANSFER_OUT):
```
new_balance = old_balance - amount   // WAC does NOT change
new_wac     = old_wac               // unchanged per PRD invariant
```

Special case: if `old_balance === 0` (no existing position):
```
new_wac    = price    // first lot sets WAC directly
new_balance = amount
```

**Data source for current WAC/balance**: use `GET /api/portfolio` response. Scan `tokens[]` → find matching `contractAddress + network` → scan `walletBreakdown[]` → find matching `walletId`. Use `walletBreakdown[i].wac` and `walletBreakdown[i].balance` for the preview formula.

**Precision**: use `parseFloat` for display only; the backend handles the authoritative computation. The preview is informational, not binding.

**When to show preview**: only when `amount` is a valid positive number AND `price_usd` is a valid positive number (for inbound) or `amount` is valid (for outbound). Display as: `New WAC: $X.XX | New Balance: Y`.

**Edge case**: SELL with amount > current balance → preview shows the validation error instead of WAC preview.

---

## TRANSFER_IN Inheritance Strategy

**AC-4**: When `type = TRANSFER_IN` AND the selected wallet is ON_CHAIN, the form should suggest "Inherit WAC $X from [WalletAlias]?" with a "Use this" button that auto-fills the price field.

**Implementation approach**:
1. When the user selects `type = TRANSFER_IN` and an ON_CHAIN wallet + token combination, fetch `GET /api/portfolio/token/:contractAddress/:network` (no wallet_id filter = all wallets).
2. The response `position.walletBreakdown` shows all wallets that hold the token. Filter out the selected wallet itself.
3. If one or more OTHER wallets have a non-zero balance for this token, show the suggestion badge with the first wallet's WAC and alias.
4. "Use this" button sets `price_usd_at_time` to that WAC value and sets `cost_source = 'INHERITED'`.

**Caveats**:
- This is a UI hint only. The backend's authoritative WAC inheritance logic (checking `from_address` against registered wallets) does NOT run for manual transactions. The user must explicitly confirm by clicking "Use this".
- For CEX wallets, TRANSFER_IN inheritance is not applicable (Binance deposits come from on-chain; the suggestion should only appear for ON_CHAIN wallet destinations).
- A new hook `useTokenPositions(contractAddress, network)` should wrap `GET /api/portfolio/token/:contractAddress/:network` without wallet filter, fetching on demand when type=TRANSFER_IN is selected.

---

## Routing Plan

**Form route**: `/transactions/new`

This is a new route not yet defined in `router.tsx`. It should be added as a protected route.

The form needs to redirect to `/token/:contractAddress/:network` after successful submit (AC-6). The token's `contractAddress` and `network` come from the selected `token_id` — the form must resolve these from the token list response after submission.

**Alternative**: Accept `?wallet_id=X&token_id=Y` query params to pre-fill the form when navigated from TokenDetailPage. This would let the "Add Transaction" button on the token detail page pre-select the wallet and token.

**Navigation flow**:
1. User clicks "Add Transaction" → navigates to `/transactions/new` (optionally with query params)
2. User fills in form fields; real-time WAC preview appears
3. On success → toast "Transaction added. Cycle #N updated." → navigate to `/token/:contractAddress/:network`
4. On failure → inline error message; form stays open

**Router addition** in `router.tsx`:
```typescript
{
  path: '/transactions/new',
  element: (
    <ProtectedRoute>
      <AddTransactionPage />
    </ProtectedRoute>
  ),
}
```

---

## Open Questions

1. **`WalletEntry` camelCase mismatch**: the backend `GET /api/wallets` returns raw DB rows with `wallet_type` (snake_case), but `useWallets` types the response as `WalletEntry` which has `walletType` (camelCase). Does the hook currently transform, or is the backend returning camelCase already? This must be verified before building the wallet selector. If it's a gap, a transformation in `useWallets` or in the hook response is needed.

2. **Toast implementation**: install a minimal toast library (e.g., `sonner` — ~4kB, Tailwind-friendly) vs. implement a simple `{ message, visible }` state in the page component? The project has no existing toast. Given the project pattern of zero third-party UI libs, a simple local toast state is preferred — but confirm with the team.

3. **"Add Transaction" entry point**: where does the button live? Is it a global FAB on the dashboard, or a per-token button on TokenDetailPage? The routing plan above covers both, but the UX entry point affects whether query params pre-fill the form.

4. **SWAP_OUT / SWAP_IN**: the form exposes these types in the `type` select. However, SWAP pairs must be stored as two linked rows with `related_tx_id`. Can the manual form create a single SWAP_IN or SWAP_OUT row without a pair? The backend `createTransaction` does not enforce pairing — it will accept a standalone SWAP_IN. Is this intentional for manual entry, or should the form warn the user they need to enter both sides separately?

5. **Token selection UX when no existing position**: `GET /api/tokens?network=ETH` returns ALL non-hidden tokens on ETH, even those with zero balance. Is this the right list for the token selector, or should it be filtered to tokens with existing positions? For a "buy new token" flow, showing all is correct. Confirm the intended scope.

6. **Price field for TRANSFER_OUT**: the backend accepts `price_usd_at_time = null` for TRANSFER_OUT (generates zero P&L). Should the form hide the price field for TRANSFER_OUT, or show it as optional? LoginPage pattern would suggest: show with `required={false}` and send null if blank.

---

## Risks

1. **Client-side WAC precision**: using `parseFloat` for the preview loses decimal precision (JS float vs. backend Decimal.js). Preview may show slightly different values than what the backend commits. This is acceptable for a preview, but must be clearly labeled as "estimated" or the precision gap must be documented.

2. **`WalletEntry` type mismatch (snake_case vs camelCase)**: if the backend returns snake_case and the hook trusts the type annotation without transformation, `walletType` will be undefined at runtime. This would silently break the wallet selector. Must be verified with an actual API call or test before implementing.

3. **TRANSFER_IN inheritance fetch on every type change**: fetching `GET /api/portfolio/token/:address/:network` every time the user toggles `type` to TRANSFER_IN could fire many requests. The hook should debounce or fetch only once per (token, wallet) combination and cache the result.

4. **Zod `z.uuid()` on `wallet_id` and `token_id`**: the backend validates these as UUIDs. The form must submit the actual UUID from the wallets/tokens API — not a human-readable label. If the token selector shows symbols (ETH, USDT) and submits the UUID, this is fine. But the form state must store `token.id` (UUID), not `token.symbol`.

5. **`block_timestamp` format**: the backend schema uses `z.iso.datetime()` (Zod 4 ISO datetime). The form's datetime-local input returns `YYYY-MM-DDTHH:mm` (no seconds, no timezone). The form must append `:00.000Z` or handle timezone before submitting.

6. **`amount` and `price_usd_at_time` as strings**: the backend expects numeric strings matching `/^\d+(\.\d+)?$/`. The form must ensure the submitted values match this regex (no scientific notation, no negative sign, no leading zeros beyond "0.xxx"). Standard `<input type="number">` can return scientific notation for very small values — use `<input type="text" inputMode="decimal">` or coerce with `parseFloat(val).toString()`.
