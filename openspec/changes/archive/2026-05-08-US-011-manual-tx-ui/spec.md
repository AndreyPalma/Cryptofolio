# US-011 Spec — Formulario de ingreso manual de transacciones (UI)

## Overview

A new protected route `/transactions/new` renders `AddTransactionPage`, which allows users to manually record a transaction against any of their wallets. The form provides real-time WAC and balance preview (computed client-side), a WAC inheritance suggestion for `TRANSFER_IN` operations targeting on-chain wallets, and client-side balance validation for outbound types. On success it shows an inline toast and redirects to the token detail page.

All backend APIs consumed by this story already exist and are used without modification. The only backend-touching fix in scope is a camelCase transform inside `useWallets` (D8), which is a frontend-only change.

---

## Functional Requirements

**FR-1 — Fields rendered**  
The form renders exactly six fields: Wallet/Source (select), Token (select, filtered by selected wallet), Type (select), Amount (text input), Price USD (text input), Date & Time (datetime-local input).

**FR-2 — Wallet/Source options**  
`Wallet/Source` lists all wallets returned by `GET /api/wallets`, transformed through the `useWallets` camelCase fix (D8). CEX wallet is labeled "Binance Account". On-chain wallets are labeled with their `label` field (fallback: address substring).

**FR-3 — Token filter by wallet network**  
When a wallet is selected, `GET /api/tokens?network={wallet.network}` is fetched and tokens with `is_hidden: false` are shown in the Token select. The token list does NOT restrict to tokens with existing positions (supporting first-BUY flows).

**FR-4 — CEX token filter**  
When the selected wallet has `walletType: 'CEX'` (network `CEX_BINANCE`), the Token select shows only tokens with `network: 'CEX_BINANCE'`.

**FR-5 — Type options and SWAP note**  
The Type select includes all six values: `BUY`, `SELL`, `SWAP_IN`, `SWAP_OUT`, `TRANSFER_IN`, `TRANSFER_OUT`. When `SWAP_IN` or `SWAP_OUT` is selected, a non-blocking info note appears below the field: "Swaps usually come in pairs (OUT + IN). To record a full swap, submit both sides separately."

**FR-6 — Price field visibility and required state**  
The Price USD field is always rendered (no DOM toggling). Required for: `BUY`, `SELL`, `SWAP_IN`, `SWAP_OUT`, `TRANSFER_IN`. Optional (empty → submits `null`) for: `TRANSFER_OUT`. A value of `0` is invalid regardless of type. The label reads "Price USD *" for required types and "Price USD (optional)" for `TRANSFER_OUT`.

**FR-7 — WAC and balance preview**  
When Amount and Price (for inbound types) are both valid positive numbers, a preview panel shows "New WAC: $X" and "New Balance: Y" computed with client-side `parseFloat`. The panel includes the disclaimer "Estimated — final value computed on submit." The preview hides if either field parses to NaN or non-positive.

**FR-8 — TRANSFER_IN WAC inheritance suggestion**  
When `type = TRANSFER_IN`, the destination wallet is `ON_CHAIN`, and a token is selected, the form fetches `GET /api/portfolio/token/{contractAddress}/{network}` (no `wallet_id` filter). If the response's `position.walletBreakdown` contains at least one entry with a positive balance that belongs to a different `ON_CHAIN` wallet, an inline suggestion panel appears above the Price field: "Inherit WAC $X from {walletLabel}?" with a "Use this" button. Clicking "Use this" sets the Price field to the WAC value and sets the hidden `cost_source` field to `INHERITED`. If the user edits the price afterwards, `cost_source` reverts to `MANUAL`.

**FR-9 — SELL/SWAP_OUT/TRANSFER_OUT balance guard**  
For outbound types (`SELL`, `SWAP_OUT`, `TRANSFER_OUT`), if the parsed amount exceeds the current balance for the selected wallet+token (from `GET /api/portfolio` response), the Submit button is disabled and an inline error reads "Exceeds balance of {currentBalance} tokens". If the backend returns `400 INSUFFICIENT_BALANCE` anyway (stale client data), the form unlocks and shows the server's `currentBalance` value in the error.

**FR-10 — Submit and success flow**  
On successful `POST /api/transactions` (201), the form shows a toast "Transaction added. Cycle #{cycleNumber} updated." (auto-dismissed after 3 seconds) and navigates to `/token/{contractAddress}/{network}` resolved from the submitted token's data.

**FR-11 — Inline validation errors**  
Empty required fields and invalid values show inline errors adjacent to each field. Errors appear on submit attempt (not on-change). Price = 0 shows "Price must be greater than 0". Empty required field shows "{FieldName} is required".

**FR-12 — Entry points**  
Two entry points navigate to `/transactions/new`:
1. "Add Transaction" button in the `DashboardPage` header (no query params).
2. "Add Transaction" button in the `TokenDetailPage` action area, appending `?wallet_id={firstWalletInBreakdown}&token_id={tokenId}` to pre-fill Wallet and Token selects.

**FR-13 — `useWallets` camelCase fix (D8)**  
`useWallets` maps the raw backend `wallet_type` (snake_case) field to `walletType` (camelCase) before exposing `WalletEntry[]`. A `WalletApiRow` internal type mirrors the raw backend shape. No backend changes are made.

**FR-14 — Toast infrastructure**  
A `ToastContext` + `useToast()` hook provides `{ show(message: string, variant: 'success' | 'error'): void }`. The `<Toast />` component is mounted once in `AppLayout`. Only one toast is shown at a time; a new call replaces the previous one. Auto-dismiss after 3 seconds.

**FR-15 — `block_timestamp` formatting**  
A pure helper `toIso8601(dateTimeLocal: string): string` converts the `<input type="datetime-local">` value (`YYYY-MM-DDTHH:mm`) to an ISO-8601 string with seconds and timezone (`YYYY-MM-DDTHH:mm:00.000Z`) required by `z.iso.datetime()` on the backend.

**FR-16 — Amount and price string format**  
Before submitting, `amount` and `price_usd_at_time` are coerced to numeric strings matching `/^\d+(\.\d+)?$/` (no scientific notation, no leading zeros beyond `0.xxx`). The Amount input uses `type="text" inputMode="decimal"` and strips non-numeric characters on input.

---

## Scenarios

### Scenario 1 — Successful BUY transaction (happy path, on-chain wallet)

```
Given the user is authenticated and navigates to /transactions/new
And GET /api/wallets returns one ON_CHAIN wallet "MetaMask ETH" (id: wallet-1, network: ETH)
And GET /api/tokens?network=ETH returns token ETH (id: token-eth, contract_address: "0xeeee...", network: ETH)
When the user selects "MetaMask ETH" as Wallet
And selects "ETH" as Token
And selects "BUY" as Type
And enters "1.5" as Amount
And enters "3000" as Price USD
And picks "2025-05-08T14:30" as Date & Time
And clicks Submit
Then POST /api/transactions is called with:
  wallet_id: "wallet-1"
  token_id: "token-eth"
  type: "BUY"
  amount: "1.5"
  price_usd_at_time: "3000"
  block_timestamp: "2025-05-08T14:30:00.000Z"
  cost_source: "MANUAL"
And the response is 201 { transaction_id, position_id, cycle_number: 2, status: "OPEN", wac: "3000", balance: "1.5" }
And a toast "Transaction added. Cycle #2 updated." appears
And the user is navigated to /token/0xeeee.../ETH
```

### Scenario 2 — Pre-fill from TokenDetailPage entry point

```
Given the user is on /token/0xeeee.../ETH and clicks "Add Transaction"
When the browser navigates to /transactions/new?wallet_id=wallet-1&token_id=token-eth
Then the Wallet select is pre-selected with "MetaMask ETH"
And the Token select is pre-selected with "ETH"
And all other fields are empty
```

### Scenario 3 — Binance Account CEX token filter (FR-3, FR-4)

```
Given the user navigates to /transactions/new
And GET /api/wallets returns one CEX wallet "Binance Account" (network: CEX_BINANCE)
When the user selects "Binance Account"
Then GET /api/tokens?network=CEX_BINANCE is fetched
And the Token select shows only tokens with network=CEX_BINANCE
And no on-chain tokens appear in the Token select
```

### Scenario 4 — WAC preview for inbound BUY (FR-7)

```
Given the user has selected wallet-1 (ETH), token-eth (ETH), type BUY
And GET /api/portfolio returns walletBreakdown for wallet-1: { balance: "1.0", wac: "2000" }
When the user enters amount "1.0" and price "3000"
Then the preview panel shows "New WAC: $2,500.00" and "New Balance: 2.0"
And the panel shows disclaimer "Estimated — final value computed on submit."
```
_Computation: (1.0 × 2000 + 1.0 × 3000) / (1.0 + 1.0) = 2500_

### Scenario 5 — WAC preview for outbound SELL (FR-7)

```
Given wallet-1 holds 2.0 ETH at WAC 2500
When the user selects type SELL and enters amount "0.5"
Then the preview panel shows "New WAC: $2,500.00" (unchanged) and "New Balance: 1.5"
```
_WAC does not change on SELL per PRD invariant._

### Scenario 6 — Preview hides when amount is invalid (FR-7)

```
Given the user has selected type BUY and entered price "3000"
When the user clears the Amount field or enters "abc"
Then the WAC preview panel is not rendered
```

### Scenario 7 — SWAP_IN / SWAP_OUT info note (FR-5)

```
Given the user selects type SWAP_OUT
Then a non-blocking note appears below the Type field:
  "Swaps usually come in pairs (OUT + IN). To record a full swap, submit both sides separately."
And the form remains submittable
```

### Scenario 8 — TRANSFER_IN WAC inheritance suggestion shown (FR-8)

```
Given the user selects wallet-1 (ON_CHAIN, ETH), token-eth, type TRANSFER_IN
When GET /api/portfolio/token/0xeeee.../ETH returns walletBreakdown:
  [{ walletId: "wallet-2", label: "Cold Wallet ETH", balance: "5.0", wac: "1800.50" }]
Then an inline panel appears above the Price field:
  "Inherit WAC $1,800.50 from 'Cold Wallet ETH'?"
  [Use this]
```

### Scenario 9 — "Use this" sets price and cost_source (FR-8)

```
Given the TRANSFER_IN inheritance suggestion is visible with WAC $1800.50
When the user clicks "Use this"
Then the Price USD field is set to "1800.50"
And the hidden cost_source field is set to "INHERITED"

When the user then manually edits the Price USD field to "1900"
Then the hidden cost_source field reverts to "MANUAL"
```

### Scenario 10 — TRANSFER_IN inheritance suggestion not shown for CEX wallet (FR-8)

```
Given the user selects "Binance Account" (CEX wallet, network: CEX_BINANCE) and type TRANSFER_IN
Then no WAC inheritance suggestion is fetched or displayed
```

### Scenario 11 — SELL with amount exceeding balance disables Submit (FR-9, AC-5)

```
Given wallet-1 holds 1.0 ETH
And the user selects wallet-1, token-eth, type SELL
When the user enters amount "2.0"
Then the Submit button is disabled
And an inline error reads "Exceeds balance of 1.0 tokens"
```

### Scenario 12 — Backend INSUFFICIENT_BALANCE overrides stale client check (FR-9)

```
Given the client shows balance 2.0 ETH (portfolio data not refreshed)
And the actual balance is 0.5 ETH (another tab ran a sync)
And the user submits SELL with amount "1.0" (client allows it)
When the backend returns 400 INSUFFICIENT_BALANCE { currentBalance: "0.5", attempted: "1.0" }
Then the Submit button becomes enabled again (not permanently blocked)
And an inline error reads "Exceeds balance of 0.5 tokens"
```

### Scenario 13 — NEGATIVE: empty required fields block submit (FR-11, AC-7)

```
Given the user navigates to /transactions/new and fills nothing
When the user clicks Submit
Then inline errors appear adjacent to each empty required field:
  - "Wallet is required" next to Wallet select
  - "Token is required" next to Token select
  - "Type is required" next to Type select
  - "Amount is required" next to Amount input
  - "Price USD is required" next to Price USD input (for non-TRANSFER_OUT types)
  - "Date & Time is required" next to Date & Time input
And POST /api/transactions is NOT called
```

### Scenario 14 — NEGATIVE: price = 0 is invalid (FR-11, AC-7)

```
Given the user has filled all other fields correctly
When the user enters "0" in the Price USD field and clicks Submit
Then an inline error reads "Price must be greater than 0"
And POST /api/transactions is NOT called
```

### Scenario 15 — NEGATIVE: price = 0 also invalid when TRANSFER_OUT with explicit value (FR-6, FR-11)

```
Given the user selects type TRANSFER_OUT
And enters "0" in the Price USD field (field is optional but value is present)
When the user clicks Submit
Then an inline error reads "Price must be greater than 0"
And POST /api/transactions is NOT called
```

### Scenario 16 — NEGATIVE: empty Price for TRANSFER_OUT is valid (FR-6)

```
Given the user selects type TRANSFER_OUT and leaves Price USD blank
When all other fields are valid and the user clicks Submit
Then POST /api/transactions is called with price_usd_at_time: null
And no price error appears
```

### Scenario 17 — NEGATIVE: backend Validation failed (Zod) maps errors inline

```
Given the form submits with a malformed amount (edge case bypassing client validation)
When the backend returns 400 { message: "Validation failed", issues: [{ path: ["amount"], message: "..." }] }
Then the error is displayed inline adjacent to the Amount field
And the form stays open
```

### Scenario 18 — NEGATIVE: block_timestamp formatting (FR-15, R1)

```
Given the user selects datetime-local value "2025-05-08T14:30"
When the form action calls toIso8601("2025-05-08T14:30")
Then the submitted block_timestamp is "2025-05-08T14:30:00.000Z"
And the backend accepts it without 400
```

### Scenario 19 — toast auto-dismisses after 3 seconds (FR-14)

```
Given a success toast "Transaction added. Cycle #2 updated." appears
When 3 seconds elapse without user interaction
Then the toast disappears from the DOM
```

---

## Data Contracts

### POST /api/transactions

**Request** (`Content-Type: application/json`, Cookie: `token=<jwt>`)

```typescript
interface CreateTransactionRequest {
  wallet_id:         string;            // UUID (z.uuid())
  token_id:          string;            // UUID (z.uuid())
  type:              TransactionType;   // 'BUY' | 'SELL' | 'SWAP_IN' | 'SWAP_OUT' | 'TRANSFER_IN' | 'TRANSFER_OUT'
  amount:            string;            // numeric regex /^\d+(\.\d+)?$/, value > 0
  price_usd_at_time: string | null;     // numeric regex /^\d+(\.\d+)?$/ when set; null only for TRANSFER_OUT
  block_timestamp:   string;            // ISO-8601 with seconds + Z: "YYYY-MM-DDTHH:mm:ss.sssZ"
  cost_source?:      CostSource;        // 'MARKET' | 'INHERITED' | 'MANUAL' — optional, backend defaults to MANUAL
}
```

**Response 201**

```typescript
interface CreateTransactionResponse {
  transaction_id: string;    // UUID
  position_id:    string;    // UUID
  cycle_number:   number;
  status:         'OPEN' | 'CLOSED';
  wac:            string;    // DecimalString
  balance:        string;    // DecimalString
}
```

**Error responses**

| HTTP | `error` field          | Additional fields                    | Form behavior                                         |
|------|------------------------|--------------------------------------|-------------------------------------------------------|
| 400  | `INSUFFICIENT_BALANCE` | `currentBalance`, `attempted`        | Inline: "Exceeds balance of {currentBalance} tokens"  |
| 400  | `Bad Request`          | `message: "Validation failed"`, `issues[]` | Map `issues[].path[0]` to inline field errors   |
| 400  | `ValidationError`      | `message: "PRICE_REQUIRED_FOR_TRANSFER_IN"` | Inline error on Price field                  |
| 404  | `NotFoundError`        | —                                    | Inline: "Selected wallet or token no longer exists"   |
| 401  | `UnauthorizedError`    | —                                    | `apiClient` redirects to `/login` automatically      |

---

### GET /api/wallets

Returns `WalletApiRow[]` (raw backend, snake_case). The `useWallets` hook transforms each row:

```typescript
// Internal type — mirrors raw backend row
interface WalletApiRow {
  id:             string;
  user_id:        string;
  wallet_type:    'ON_CHAIN' | 'CEX';   // snake_case from DB
  address:        string | null;
  network:        string;               // 'ETH' | 'BSC' | 'CEX_BINANCE'
  label:          string | null;
  last_synced_at: string | null;
  created_at:     string;
}

// Consumer-facing type (already defined in types/token-detail.ts)
interface WalletEntry {
  id:         string;
  label:      string | null;
  walletType: 'ON_CHAIN' | 'CEX';  // camelCase after transform
  network:    string;
}
```

Transform applied in `useWallets`: `walletType = row.wallet_type`.

---

### GET /api/tokens

**Query params**: `?network={ETH|BSC|CEX_BINANCE}` (required for this form's usage). `includeHidden` is NOT passed (defaults to false — hidden tokens excluded).

**Response item**:

```typescript
interface TokenApiRow {
  id:               string;   // UUID
  symbol:           string;
  name:             string | null;
  network:          string;
  contract_address: string;   // for CEX: symbol.toLowerCase()
  decimals:         number;
  binance_symbol:   string | null;
  is_hidden:        boolean;
  target_exit_price: string | null;
  created_at:       string;
}
```

Only tokens where `is_hidden === false` are shown in the Token select.

---

### GET /api/portfolio

Used to retrieve `currentBalance` and `currentWac` for the selected wallet+token combination for WAC preview and client-side balance guard.

Relevant shape within the response:

```typescript
interface PortfolioSummary {
  tokens: Array<{
    contractAddress: string;
    network: string;
    walletBreakdown: Array<{
      walletId: string;
      label:    string | null;
      balance:  string;   // DecimalString
      wac:      string;   // DecimalString
    }>;
    // ... other fields not used by this form
  }>;
}
```

Lookup: find `tokens[]` entry by `(contractAddress, network)` → scan `walletBreakdown[]` by `walletId`. If not found (no existing position), treat as `balance: "0"`, `wac: "0"`.

---

### GET /api/portfolio/token/:contractAddress/:network

Used only for `TRANSFER_IN` inheritance suggestion. No `wallet_id` query param.

Relevant shape:

```typescript
interface TokenDetail {
  position: {
    walletBreakdown: Array<{
      walletId: string;
      label:    string | null;
      balance:  string;   // DecimalString
      wac:      string;   // DecimalString
    }>;
  } | null;
}
```

Filter criteria applied client-side:
- Exclude the entry whose `walletId` equals the destination wallet's `id`.
- Keep entries with `parseFloat(balance) > 0`.
- Keep only entries whose `walletId` corresponds to an `ON_CHAIN` wallet (cross-referenced from `useWallets` data).
- Show suggestion for the first matching entry.

---

## Validation Rules

| Field            | Required?                                          | Type / Format                                       | Additional rules                                                                                          |
|------------------|----------------------------------------------------|-----------------------------------------------------|-----------------------------------------------------------------------------------------------------------|
| `wallet_id`      | Always                                             | UUID string from wallet select                      | Must exist in wallets list                                                                                 |
| `token_id`       | Always                                             | UUID string from token select                       | Token list is filtered by wallet's network; must not be hidden                                            |
| `type`           | Always                                             | One of the six `TransactionType` values             | —                                                                                                          |
| `amount`         | Always                                             | Matches `/^\d+(\.\d+)?$/`, `parseFloat > 0`        | No scientific notation; no negative sign; no leading zeros beyond `0.xxx`                                 |
| `price_usd_at_time` | Required for `BUY`, `SELL`, `SWAP_IN`, `SWAP_OUT`, `TRANSFER_IN` | Matches `/^\d+(\.\d+)?$/`, `parseFloat > 0` | Optional (blank → `null`) for `TRANSFER_OUT`; value `0` always invalid even when field is optional        |
| `block_timestamp` | Always                                            | `datetime-local` input + `toIso8601()` transform   | Must produce `YYYY-MM-DDTHH:mm:00.000Z`; future dates allowed (manual backfill use case)                 |
| `cost_source`    | No (hidden, auto-set)                              | `'INHERITED'` when "Use this" clicked; else `'MANUAL'` | Reverts to `'MANUAL'` if user edits price after clicking "Use this"                                 |

**Client-side balance check** (pre-submit, for outbound types only):

- Types: `SELL`, `SWAP_OUT`, `TRANSFER_OUT`
- Rule: `parseFloat(amount) > parseFloat(currentBalance)` → disable Submit, show inline error
- `currentBalance` sourced from `GET /api/portfolio` → `walletBreakdown[walletId].balance`; defaults to `"0"` if not found

---

## Computed Fields

### WAC Preview

**Shown when**: `type` is known AND `amount` parses to a positive number AND (`price_usd_at_time` parses to a positive number OR type is an outbound type).

**Formula** (client-side, informational only):

```
oldBalance = parseFloat(walletBreakdown.balance) or 0 if no position
oldWac     = parseFloat(walletBreakdown.wac)     or 0 if no position

Inbound (BUY, SWAP_IN, TRANSFER_IN):
  if oldBalance === 0:
    newWac     = parseFloat(price_usd_at_time)
    newBalance = parseFloat(amount)
  else:
    newWac     = (oldBalance * oldWac + parseFloat(amount) * parseFloat(price_usd_at_time))
                 / (oldBalance + parseFloat(amount))
    newBalance = oldBalance + parseFloat(amount)

Outbound (SELL, SWAP_OUT, TRANSFER_OUT):
  newWac     = oldWac                         // WAC never changes on outbound
  newBalance = oldBalance - parseFloat(amount)
```

**Display**: `formatUsd(newWac)` and `formatCrypto(newBalance)` using existing format helpers. Hidden if either computed input is NaN or non-positive (for inbound types, price must also be valid). Shows disclaimer "Estimated — final value computed on submit." below the values.

### `toIso8601` Helper

```
input:  "2025-05-08T14:30"    (datetime-local output)
output: "2025-05-08T14:30:00.000Z"
rule:   append ":00.000Z" to the input string
```

---

## Navigation

### Entry Points

| Origin | Button label | URL navigated to |
|--------|-------------|-----------------|
| `DashboardPage` header | "Add Transaction" | `/transactions/new` |
| `TokenDetailPage` action area | "Add Transaction" | `/transactions/new?wallet_id={firstWalletInBreakdown.walletId}&token_id={token.id}` |

### Route Registration

Add to `router.tsx` as a protected route:

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

### Success Redirect

After 201 response: navigate to `/token/{contractAddress}/{network}` where `contractAddress` and `network` come from the submitted token's record (resolved from the token list already fetched by `useTokensByWallet`).

### Cancel / Back

A "Cancel" link or back-chevron navigates to the browser history previous page (`history.back()` or `navigate(-1)`).

### Authentication Failure

`apiClient` automatically redirects to `/login` on 401. No additional handling needed in the form.

---

## Out of Scope

- Backend changes of any kind (no new endpoints, no response shape changes).
- A backend WAC preview endpoint — preview is intentionally client-side and approximate.
- `related_tx_id` pairing for SWAP pairs — backend does not enforce pairing for manual entries.
- Editing or deleting existing transactions.
- Bulk / CSV import.
- Dust conversion handling (explicit non-goal per PRD v5).
- Toast queue (multiple simultaneous toasts) — only one toast at a time is supported.
- Typeahead / autocomplete on the Token select — plain native `<select>` is sufficient for V1 token list sizes.
- Backend-side camelCase response normalisation — the transform lives only in `useWallets` on the frontend.
- Multi-cycle WAC simulation beyond the current open position (the preview only uses the current open cycle's balance and WAC).
