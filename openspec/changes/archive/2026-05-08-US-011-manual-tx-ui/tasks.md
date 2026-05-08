# US-011 Tasks — Formulario de ingreso manual de transacciones (UI)

> **Strict TDD is active.** Every R task writes a failing test first; every G task implements exactly enough to make it pass. Test runner: `npx vitest run --project frontend`.
>
> Test convention: colocated `*.test.{ts,tsx}` next to source file (confirmed by vitest.workspace.ts include pattern `apps/frontend/src/**/*.{test,spec}.{ts,tsx}`).

---

## Phase 1: Foundation — lib modules

### 1.1 — `toIso8601` / `fromIso8601` helper

- [x] **T1.R** — WRITE FAILING TEST: `toIso8601("2025-05-08T14:30")` returns `"2025-05-08T14:30:00.000Z"`; `toIso8601("")` returns `""`; `fromIso8601("2025-05-08T14:30:00.000Z")` returns `"2025-05-08T14:30"`.
  - File: `apps/frontend/src/lib/iso-datetime.test.ts`
- [x] **T1.G** — IMPLEMENT: export `toIso8601(dateTimeLocal: string): string` (appends `":00.000Z"` when non-empty) and `fromIso8601(iso: string): string` (slices to `"YYYY-MM-DDTHH:mm"`) in `iso-datetime.ts`.
  - File: `apps/frontend/src/lib/iso-datetime.ts`

### 1.2 — Transaction rules helpers

- [x] **T2.R** — WRITE FAILING TEST: `isPriceRequired` returns `true` for BUY/SELL/SWAP_IN/SWAP_OUT/TRANSFER_IN and `false` for TRANSFER_OUT; `isOutbound` returns `true` for SELL/SWAP_OUT/TRANSFER_OUT and `false` for BUY/SWAP_IN/TRANSFER_IN; `isInbound` is the complement of `isOutbound`; `validateAmount("0")` returns an error string; `validateAmount("1.5")` returns `null`; `validateAmount("")` returns `"{field} is required"` style error; `validatePriceUsd("0", "BUY")` returns error; `validatePriceUsd("", "TRANSFER_OUT")` returns `null` (empty + optional = ok); `validatePriceUsd("0", "TRANSFER_OUT")` returns error (zero always invalid).
  - File: `apps/frontend/src/lib/transaction-rules.test.ts`
- [x] **T2.G** — IMPLEMENT: export `isPriceRequired(type: TransactionType): boolean`, `isOutbound(type: TransactionType): boolean`, `isInbound(type: TransactionType): boolean`, `validateAmount(value: string): string | null`, `validatePriceUsd(value: string, type: TransactionType): string | null` in `transaction-rules.ts`.
  - File: `apps/frontend/src/lib/transaction-rules.ts`

### 1.3 — ToastContext

- [x] **T3.R** — WRITE FAILING TEST: `useToast()` called outside `<ToastProvider>` throws `"useToast must be used inside <ToastProvider>"`; `show("hello")` renders a toast in the DOM with the message; after 3 seconds the toast is removed from the DOM (use `vi.useFakeTimers`); a second `show("bye")` call while the first toast is visible replaces it (only one toast in DOM at a time).
  - File: `apps/frontend/src/lib/toast-context.test.tsx`
- [x] **T3.G** — IMPLEMENT: `ToastContext`, `ToastProvider`, `useToast()`, `<ToastRoot />` (fixed bottom-right, `role="status"` for success / `role="alert"` for error, `null` when no toast, 3-second auto-dismiss via `window.setTimeout`). Export `ToastProvider` and `useToast` from `toast-context.tsx`.
  - File: `apps/frontend/src/lib/toast-context.tsx`

---

## Phase 2: Bug fix — `useWallets` camelCase transform

### 2.1 — `useWallets` regression test + fix

- [x] **T4.R** — WRITE FAILING TEST: mock `apiClient.get` to return a raw `WalletApiRow[]` array where each row has `wallet_type` (snake_case). Assert that `useWallets()` exposes `walletType` (camelCase) in `WalletEntry[]`. Assert both `"ON_CHAIN"` and `"CEX"` wallet types are mapped correctly. Assert `id`, `label`, and `network` pass through unchanged.
  - File: `apps/frontend/src/hooks/useWallets.test.ts`
- [x] **T4.G** — IMPLEMENT: add internal type `WalletApiRow` (with `wallet_type`) to `useWallets.ts`. Change `apiClient.get<WalletApiRow[]>("/api/wallets")` and map each row: `{ id, label, walletType: row.wallet_type, network }` before calling `setData`.
  - File: `apps/frontend/src/hooks/useWallets.ts`

---

## Phase 3: Data hooks

### 3.1 — `useTokensByWallet`

- [x] **T5.R** — WRITE FAILING TEST: when `wallet` is `null`, returns `{ data: null, loading: false, error: null }` without fetching; when wallet has `network: "ETH"`, calls `GET /api/tokens?network=ETH`; when wallet has `network: "CEX_BINANCE"`, calls `GET /api/tokens?network=CEX_BINANCE`; a second render with the same network returns cached data without a second fetch; filters out tokens with `is_hidden: true` from the result.
  - File: `apps/frontend/src/hooks/useTokensByWallet.test.ts`
- [x] **T5.G** — IMPLEMENT: `useTokensByWallet(wallet: WalletEntry | null)` — module-level `Map<string, Token[]>` cache keyed by `network`; cancelled-flag pattern in `useEffect`; returns `{ data: Token[] | null, loading: boolean, error: Error | null }`. Define and export `Token` interface (mirrors `TokenApiRow` from spec with camelCase).
  - File: `apps/frontend/src/hooks/useTokensByWallet.ts`

### 3.2 — `useWalletBalance`

- [x] **T6.R** — WRITE FAILING TEST: fetches `GET /api/portfolio/token/{contractAddress}/{network}` and picks the breakdown entry matching `walletId`; returns `{ balance, wac }` for the matching entry; returns `{ balance: null, wac: null }` when `walletId` is not in the breakdown; uses cancelled-flag (rapidly changing `walletId` does not surface stale data from the previous call); returns `loading: true` while the request is in flight.
  - File: `apps/frontend/src/hooks/useWalletBalance.test.ts`
- [x] **T6.G** — IMPLEMENT: `useWalletBalance(walletId: string, contractAddress: string, network: string)` — fetches `/api/portfolio/token/${contractAddress}/${network}`, scans `position.walletBreakdown`, returns matching entry or null values. Cancelled-flag pattern.
  - File: `apps/frontend/src/hooks/useWalletBalance.ts`

### 3.3 — `useWacPreview`

- [x] **T7.R** — WRITE FAILING TEST: BUY on new position (`currentBalance=null, currentWac=null`) with `amount="1"`, `priceUsd="3000"` → `{ visible: true, newBalance: 1, newWac: 3000 }`; BUY adding to existing (`balance="1.0"`, `wac="2000"`) with `amount="1.0"`, `price="3000"` → `newWac: 2500, newBalance: 2`; SELL reducing balance: `balance="2.0"`, `wac="2500"`, `amount="0.5"` → `{ visible: true, newBalance: 1.5, newWac: 2500 }` (WAC unchanged); SWAP_IN behaves like BUY; SWAP_OUT behaves like SELL; TRANSFER_IN with price behaves like BUY; TRANSFER_OUT with no price (`priceStr=""`) → balance reduced, WAC unchanged; `amount="abc"` → `{ visible: false }`; outbound on empty position (`balance=null`) → `{ visible: false }`.
  - File: `apps/frontend/src/hooks/useWacPreview.test.ts`
- [x] **T7.G** — IMPLEMENT: `useWacPreview(currentBalance, currentWac, type, amountStr, priceStr)` — pure function (no `useEffect`, no state), implements the spec formula exactly. Returns `PreviewResult` (`{ visible: false }` or `{ visible: true; newBalance: number; newWac: number; newCostBasis: number }`).
  - File: `apps/frontend/src/hooks/useWacPreview.ts`

### 3.4 — `useTransferInSuggestion`

- [x] **T8.R** — WRITE FAILING TEST: returns `{ candidate: null, loading: false }` when `type !== "TRANSFER_IN"`; does not fetch when destination wallet is CEX (`walletType: "CEX"`); filters out the destination wallet from breakdown results; filters out entries with `balance: "0"`; filters out entries from CEX wallets (not present in `walletsByType` as ON_CHAIN); returns the highest-balance ON_CHAIN candidate; rapidly toggling `destinationWalletId` resolves the last value only (stale data from previous in-flight is dropped).
  - File: `apps/frontend/src/hooks/useTransferInSuggestion.test.ts`
- [x] **T8.G** — IMPLEMENT: `useTransferInSuggestion(token, destinationWalletId, type, walletsByType)` — guarded `useEffect` (fires only when all conditions met), cancelled-flag, filter pipeline returning highest-balance ON_CHAIN match as `candidate: { walletId, label, wac }`.
  - File: `apps/frontend/src/hooks/useTransferInSuggestion.ts`

### 3.5 — `useCreateTransaction`

- [x] **T9.R** — WRITE FAILING TEST: mocked `apiClient.post` returning 201 → `submit(...)` resolves to `{ status: "success", transactionId, cycleNumber, tokenContractAddress, tokenNetwork }` (contract address + network resolved from the `tokens[]` arg); 400 with `error: "INSUFFICIENT_BALANCE"` → `{ status: "error", errorCode: "INSUFFICIENT_BALANCE", currentBalance }` with the value from the response body; 400 with `message: "Validation failed"` and `issues` array → `{ status: "error", fieldErrors: { [path[0]]: message } }`; any other 4xx → `{ status: "error", errorMessage: "Could not save transaction. Try again." }`.
  - File: `apps/frontend/src/hooks/useCreateTransaction.test.ts`
- [x] **T9.G** — IMPLEMENT: `useCreateTransaction()` returning `{ submit(input: SubmitInput, tokens: Token[]): Promise<SubmitResult> }`. Calls `apiClient.post("/api/transactions", body)`, handles 201, 400 variants (INSUFFICIENT_BALANCE, Validation failed, PRICE_REQUIRED_FOR_TRANSFER_IN, NotFoundError), maps `issues[].path[0]` to camelCase `fieldErrors`. Converts `SubmitInput` to `CreateTransactionRequest` shape (snake_case, `toIso8601`).
  - File: `apps/frontend/src/hooks/useCreateTransaction.ts`

### 3.6 — `useToast` re-export

- [x] **T10.R** — WRITE FAILING TEST: importing `useToast` from `hooks/useToast` and calling it inside `<ToastProvider>` returns the same `{ show }` as the context directly. (This is a thin wrapper; the test can be minimal — assert the import resolves and `show` is a function.)
  - File: `apps/frontend/src/hooks/useToast.test.ts`
- [x] **T10.G** — IMPLEMENT: `hooks/useToast.ts` re-exports `useToast` from `../lib/toast-context`.
  - File: `apps/frontend/src/hooks/useToast.ts`

---

## Phase 4: Primitive components

### 4.1 — `WalletSourceSelect`

- [x] **T11.R** — WRITE FAILING TEST: renders an `<optgroup label="On-Chain">` containing ON_CHAIN wallet options and an `<optgroup label="CEX">` containing CEX wallet options; CEX wallet option label is `wallet.label ?? "Binance Account"`; changing the select fires `onChange` with the selected wallet id.
  - File: `apps/frontend/src/components/add-transaction/WalletSourceSelect.test.tsx`
- [x] **T11.G** — IMPLEMENT: `WalletSourceSelect({ wallets, selectedWalletId, onChange, disabled? })` — renders a native `<select>` with two optgroups, maps ON_CHAIN wallets first then CEX.
  - File: `apps/frontend/src/components/add-transaction/WalletSourceSelect.tsx`

### 4.2 — `TokenSelect`

- [x] **T12.R** — WRITE FAILING TEST: when `tokens === null`, the select is disabled and shows a loading placeholder option; when `tokens` is an empty array, shows "No tokens available" disabled option; when tokens are provided, each option is labeled `"{symbol} — {name}"` (or just `"{symbol}"` when `name` is null); `onChange` fires with the selected token id; `is_hidden: true` tokens do not appear (the hook filters them, but assert the component doesn't re-add them).
  - File: `apps/frontend/src/components/add-transaction/TokenSelect.test.tsx`
- [x] **T12.G** — IMPLEMENT: `TokenSelect({ tokens, selectedTokenId, onChange, disabled? })` — renders native `<select>`, disabled when `tokens === null || disabled`, appropriate placeholder options for null/empty states, correct option labels.
  - File: `apps/frontend/src/components/add-transaction/TokenSelect.tsx`

### 4.3 — `TransactionTypeSelect`

- [x] **T13.R** — WRITE FAILING TEST: renders exactly 6 options (BUY, SELL, SWAP_IN, SWAP_OUT, TRANSFER_IN, TRANSFER_OUT); the swap nudge note is NOT rendered when type is BUY or SELL; the swap nudge note IS rendered when type is SWAP_IN or SWAP_OUT with text containing "submit both sides separately"; `onChange` fires with the new type value.
  - File: `apps/frontend/src/components/add-transaction/TransactionTypeSelect.test.tsx`
- [x] **T13.G** — IMPLEMENT: `TransactionTypeSelect({ value, onChange })` — renders native `<select>` with all 6 transaction types, conditionally renders the swap nudge note below the select.
  - File: `apps/frontend/src/components/add-transaction/TransactionTypeSelect.tsx`

### 4.4 — `DateTimeInput`

- [x] **T14.R** — WRITE FAILING TEST: renders an `<input type="datetime-local">`; `onChange` fires with the input's value string; value prop controls the displayed value.
  - File: `apps/frontend/src/components/add-transaction/DateTimeInput.test.tsx`
- [x] **T14.G** — IMPLEMENT: `DateTimeInput({ value, onChange })` — renders a controlled `<input type="datetime-local">` with appropriate label and Tailwind styling.
  - File: `apps/frontend/src/components/add-transaction/DateTimeInput.tsx`

### 4.5 — `AmountInput`

- [x] **T15.R** — WRITE FAILING TEST: typing letters or special chars strips non-numeric characters (keeps digits and `.`) so `onChange` receives sanitized value; typing `"1..5"` (double dot) strips the second dot — only one decimal point allowed; when `currentBalance` is provided and type is SELL/SWAP_OUT/TRANSFER_OUT and `parseFloat(value) > parseFloat(currentBalance)`, renders inline error `"Exceeds balance of {currentBalance} tokens"`; when `currentBalance` is provided and type is outbound, renders a balance hint `"Balance: {currentBalance}"`; when `fieldError` prop is non-null, renders it as inline error.
  - File: `apps/frontend/src/components/add-transaction/AmountInput.test.tsx`
- [x] **T15.G** — IMPLEMENT: `AmountInput({ value, onChange, currentBalance, type, fieldError })` — `<input type="text" inputMode="decimal">`, `onChange` handler sanitizes via `/[^\d.]/g` replace + double-dot guard, renders balance hint and over-balance error, renders `fieldError`.
  - File: `apps/frontend/src/components/add-transaction/AmountInput.tsx`

### 4.6 — `PriceUsdInput`

- [x] **T16.R** — WRITE FAILING TEST: when `type` is BUY/SELL/SWAP_IN/SWAP_OUT/TRANSFER_IN, the label reads `"Price USD *"`; when `type` is TRANSFER_OUT, the label reads `"Price USD (optional)"`; `onChange` fires with the raw string value; when `fieldError` is non-null, renders it as inline error.
  - File: `apps/frontend/src/components/add-transaction/PriceUsdInput.test.tsx`
- [x] **T16.G** — IMPLEMENT: `PriceUsdInput({ value, onChange, type, fieldError })` — renders controlled text input with dynamic label using `isPriceRequired(type)`, renders `fieldError`.
  - File: `apps/frontend/src/components/add-transaction/PriceUsdInput.tsx`

---

## Phase 5: Complex components

### 5.1 — `WacPreview`

- [x] **T17.R** — WRITE FAILING TEST: renders nothing (no DOM output) when `amount` parses to NaN; renders nothing when `type` is BUY and `priceUsd` parses to NaN; renders `"New WAC:"` text when inputs are valid; renders `"New balance:"` text; renders the disclaimer `"Estimated — final value computed on submit."`; formatted USD value matches `Intl.NumberFormat` output for `newWac`; formatted crypto value matches `newBalance`.
  - File: `apps/frontend/src/components/add-transaction/WacPreview.test.tsx`
- [x] **T17.G** — IMPLEMENT: `WacPreview({ currentBalance, currentWac, type, amount, priceUsd })` — calls `useWacPreview` internally, renders `null` when `!visible`, otherwise renders new balance, new WAC, new cost basis, and disclaimer. Use existing `formatUsd` and `formatCrypto` from `lib/format.ts`.
  - File: `apps/frontend/src/components/add-transaction/WacPreview.tsx`

### 5.2 — `InheritWacSuggestion`

- [x] **T18.R** — WRITE FAILING TEST: renders `null` when `candidate === null` and `loading === false`; renders a spinner/loading indicator when `loading === true` and `candidate === null`; renders `"Inherit WAC ${wac} from '{label}'?"` when `candidate` is present; renders a "Use this" button when candidate is present; clicking "Use this" calls `onUse(candidate.wac)`; when `candidate.label` is null, uses a fallback label.
  - File: `apps/frontend/src/components/add-transaction/InheritWacSuggestion.test.tsx`
- [x] **T18.G** — IMPLEMENT: `InheritWacSuggestion({ candidate, loading, onUse })` — renders nothing when no candidate and not loading, loading spinner when fetching, suggestion panel with "Use this" button when candidate is available.
  - File: `apps/frontend/src/components/add-transaction/InheritWacSuggestion.tsx`

### 5.3 — `SubmitBar`

- [x] **T19.R** — WRITE FAILING TEST: Submit button has `disabled` attribute when `disabled === true`; Submit button is enabled when `disabled === false`; when `submitting === true`, button text changes to a loading indicator (e.g., "Saving…"); when `errorMessage` is non-null, renders a `<p role="alert">` with the error text; when `errorMessage` is null, no alert element is rendered.
  - File: `apps/frontend/src/components/add-transaction/SubmitBar.test.tsx`
- [x] **T19.G** — IMPLEMENT: `SubmitBar({ submitting, disabled, errorMessage })` — renders a submit `<button type="submit">` that is disabled when `disabled || submitting`, shows loading text when `submitting`, renders `<p role="alert">` for `errorMessage`.
  - File: `apps/frontend/src/components/add-transaction/SubmitBar.tsx`

---

## Phase 6: Page assembly

### 6.1 — `AddTransactionPage` — basic render and query param prefill

- [x] **T20.R** — WRITE FAILING TEST: the page renders all six fields (Wallet, Token, Type, Amount, Price USD, Date & Time); with `?wallet_id=wallet-1&token_id=token-eth` query params, the Wallet select is pre-selected to `wallet-1` and Token select to `token-eth`; the Date & Time input defaults to a non-empty value (current datetime); "Cancel" link or button is rendered and calls `navigate(-1)` when clicked. Use `vi.mock` on `useWallets`, `useTokensByWallet`, `useWalletBalance`, `useTransferInSuggestion`, `useCreateTransaction`.
  - File: `apps/frontend/src/pages/AddTransactionPage.test.tsx`
- [x] **T20.G** — IMPLEMENT: `AddTransactionPage` — reads `useSearchParams` for prefill, owns all local state (`walletId`, `tokenId`, `type`, `amount`, `priceUsd`, `dateLocal`, `costSource`), assembles the form with all sub-components, renders a Cancel nav element.
  - File: `apps/frontend/src/pages/AddTransactionPage.tsx`

### 6.2 — `AddTransactionPage` — client-side validation on submit

- [x] **T21.R** — WRITE FAILING TEST: clicking Submit with all fields empty shows inline errors for each required field and does NOT call `apiClient.post`; entering `"0"` for Price USD and clicking Submit shows `"Price must be greater than 0"` inline and does NOT call `apiClient.post`; entering `"0"` for Amount and clicking Submit shows amount error; TRANSFER_OUT with blank Price USD and all other fields valid submits successfully (`price_usd_at_time: null` in the POST body).
  - File: `apps/frontend/src/pages/AddTransactionPage.test.tsx` (add test cases to same file)
- [x] **T21.G** — IMPLEMENT: add submit handler with guard pipeline to `AddTransactionPage` — validate all required fields before calling `useCreateTransaction.submit`; map validation results to inline `fieldErrors` state; pass `fieldErrors` down to each input component.
  - File: `apps/frontend/src/pages/AddTransactionPage.tsx`

### 6.3 — `AddTransactionPage` — TRANSFER_IN WAC inheritance interaction

- [x] **T22.R** — WRITE FAILING TEST: when type is TRANSFER_IN and destination wallet is ON_CHAIN and `useTransferInSuggestion` returns a candidate, the `InheritWacSuggestion` panel is rendered above the Price field; clicking "Use this" sets the Price field value to `candidate.wac` and sets internal `costSource` to `"INHERITED"`; subsequently typing a new value in the Price field resets `costSource` to `"MANUAL"`.
  - File: `apps/frontend/src/pages/AddTransactionPage.test.tsx` (add test cases)
- [x] **T22.G** — IMPLEMENT: wire `useTransferInSuggestion` into `AddTransactionPage`; pass `onUse` handler to `InheritWacSuggestion` that sets `priceUsd` and `costSource`; `PriceUsdInput.onChange` resets `costSource` to `"MANUAL"` if current value is `"INHERITED"`.
  - File: `apps/frontend/src/pages/AddTransactionPage.tsx`

### 6.4 — `AddTransactionPage` — SELL balance guard

- [x] **T23.R** — WRITE FAILING TEST: when type is SELL and `useWalletBalance` returns `balance: "1.0"`, entering `amount="2.0"` disables the Submit button and shows `"Exceeds balance of 1.0 tokens"` error; when amount drops to `"0.5"` (under balance), Submit is re-enabled; when backend returns 400 INSUFFICIENT_BALANCE with `currentBalance: "0.5"`, form shows the error and the button becomes enabled again.
  - File: `apps/frontend/src/pages/AddTransactionPage.test.tsx` (add test cases)
- [x] **T23.G** — IMPLEMENT: wire `useWalletBalance` into `AddTransactionPage`; compute `isOverBalance` from balance + amount in render; pass the result to `SubmitBar.disabled`; on 400 INSUFFICIENT_BALANCE response, update local `serverBalance` state to override the client-side balance hint.
  - File: `apps/frontend/src/pages/AddTransactionPage.tsx`

### 6.5 — Route registration

- [x] **T24.R** — WRITE FAILING TEST: navigating to `/transactions/new` without auth redirects to `/login` (ProtectedRoute guard); navigating while authenticated renders `AddTransactionPage` (assert a landmark element unique to the page, e.g., `<h1>Add Transaction</h1>` or the form's first label).
  - File: `apps/frontend/src/routes/router.test.tsx`
- [x] **T24.G** — IMPLEMENT: add the `/transactions/new` protected route to `router.tsx` importing `AddTransactionPage`; wrap `RouterProvider` in `App.tsx` with `ToastProvider` between `AuthProvider` and `RouterProvider`.
  - Files: `apps/frontend/src/routes/router.tsx`, `apps/frontend/src/App.tsx`

---

## Phase 7: Entry points + prefill

### 7.1 — `DashboardPage` — Add Transaction button

- [x] **T25.R** — WRITE FAILING TEST: `DashboardPage` renders an "Add Transaction" link/button; clicking it navigates to `/transactions/new` (assert `to="/transactions/new"` on the `<Link>` or mock `useNavigate` and assert the call). Mock `usePortfolio` to return a loaded state.
  - File: `apps/frontend/src/pages/DashboardPage.test.tsx`
- [x] **T25.G** — IMPLEMENT: add `<Link to="/transactions/new">Add Transaction</Link>` to the header section of `DashboardPage` next to `RefreshIndicator`.
  - File: `apps/frontend/src/pages/DashboardPage.tsx`

### 7.2 — `TokenDetailHeader` — Add Transaction button with prefill query params

- [x] **T26.R** — WRITE FAILING TEST: `TokenDetailHeader` renders an "Add Transaction" link; the link's `to` prop equals `/transactions/new?wallet_id={firstWalletId}&token_id={tokenId}` where `firstWalletId` is `position.walletBreakdown[0]?.walletId` and `tokenId` is `token.id`; when `position` is `null` (no open position), the link still renders and `wallet_id` param is absent or uses an empty string (decide based on design); the link is not rendered when `position.walletBreakdown` is empty.
  - File: `apps/frontend/src/components/token-detail/TokenDetailHeader.test.tsx`
- [x] **T26.G** — IMPLEMENT: add an "Add Transaction" `<Link>` to `TokenDetailHeader`'s action area, constructing the URL with `firstWalletId = position?.walletBreakdown[0]?.walletId` and `tokenId = token.id`. Import `Link` (already imported in this file).
  - File: `apps/frontend/src/components/token-detail/TokenDetailHeader.tsx`

---

## Phase 8: Toast flow + success redirect

### 8.1 — Success path: toast + navigate

- [x] **T27.R** — WRITE FAILING TEST: when `useCreateTransaction.submit` resolves with `status: "success"`, `cycleNumber: 2`, `tokenContractAddress: "0xeeee"`, `tokenNetwork: "ETH"`, the page calls `toast.show("Transaction added. Cycle #2 updated.", "success")`; AND calls `navigate("/token/0xeeee/ETH")`; assert both via `vi.mock` on `toast-context` and `react-router-dom`'s `useNavigate`. Mock `useWallets` to return one ETH wallet. Mock `useTokensByWallet` to return one token. Fill all valid form fields before submitting.
  - File: `apps/frontend/src/pages/AddTransactionPage.test.tsx` (add test cases)
- [x] **T27.G** — IMPLEMENT: in `AddTransactionPage`'s submit success branch, call `toast.show(...)` then `navigate(...)` using the resolved token data. Ensure `useToast` is imported from `hooks/useToast` and `useNavigate` from `react-router-dom`.
  - File: `apps/frontend/src/pages/AddTransactionPage.tsx`

### 8.2 — Toast auto-dismiss

- [x] **T28.R** — WRITE FAILING TEST: in `ToastContext` integration test (extending T3.R), after calling `show("message")`, advance fake timers by 3000ms and assert the toast element is no longer in the DOM. (This test likely already passes from T3.G; if T3.R already covered this, mark T28 as merged into T3 and skip.)
  - File: `apps/frontend/src/lib/toast-context.test.tsx` (already targeted in T3)
- [x] **T28.G** — VERIFY: confirm that `window.setTimeout(..., 3000)` in `ToastProvider` works correctly in jsdom with `vi.useFakeTimers()`. No new code needed if T3.G already implements it correctly.
  - File: `apps/frontend/src/lib/toast-context.tsx`

### 8.3 — Backend Zod validation error mapped inline

- [x] **T29.R** — WRITE FAILING TEST: when `useCreateTransaction.submit` resolves with `status: "error"`, `fieldErrors: { amount: "Invalid amount format" }`, `AddTransactionPage` renders the error adjacent to the Amount field (the `AmountInput`'s `fieldError` prop receives `"Invalid amount format"`). No toast should appear for validation errors.
  - File: `apps/frontend/src/pages/AddTransactionPage.test.tsx` (add test cases)
- [x] **T29.G** — IMPLEMENT: in `AddTransactionPage`'s submit error branch, spread `result.fieldErrors` into local `fieldErrors` state (using `useState` or `useReducer`) and pass each to the corresponding input's `fieldError` prop. No toast for validation errors — only for success.
  - File: `apps/frontend/src/pages/AddTransactionPage.tsx`

---

## Implementation Order and Dependencies

```
Phase 1 (lib) → Phase 2 (bug fix) → Phase 3 (hooks) → Phase 4 (primitives)
                                                              ↓
                                                        Phase 5 (complex)
                                                              ↓
                                                        Phase 6 (page)
                                                              ↓
                                                 Phase 7 (entry points) + Phase 8 (toast)
```

Hooks in Phase 3 can be developed in parallel with each other. `useCreateTransaction` (T9) depends on `iso-datetime` (T1) for `toIso8601`. `useWacPreview` (T7) depends on `transaction-rules` (T2) for `isOutbound/isInbound`. All Phase 4 components depend on Phase 2 (`WalletEntry.walletType`) being correct.

---

## Acceptance Criteria Coverage

| AC | Covered by |
|----|-----------|
| AC-1: Form renders all 6 fields | T20.R |
| AC-2: Wallet list from `useWallets` with camelCase fix | T4.R, T4.G |
| AC-3: Token list filtered by network (CEX only shows CEX tokens) | T5.R |
| AC-4: WAC preview visible/hidden per formula | T7.R, T17.R |
| AC-5: SELL over-balance disables submit | T23.R |
| AC-6: TRANSFER_IN inheritance suggestion | T8.R, T22.R |
| AC-7: Empty required fields block submit + inline errors | T21.R |
| AC-8: Price=0 invalid for all types | T2.R, T21.R |
| AC-9: Success toast + navigate | T27.R |
| AC-10: Pre-fill from query params | T20.R |
| AC-11: TRANSFER_OUT price optional (null on wire) | T21.R |
| AC-12: block_timestamp formatted correctly | T1.R |
| AC-13: Toast auto-dismisses after 3s | T3.R, T28.R |
| AC-14: Backend Zod errors mapped inline | T9.R, T29.R |
| AC-15: Entry point from DashboardPage | T25.R |
| AC-16: Entry point from TokenDetailHeader with prefill | T26.R |
