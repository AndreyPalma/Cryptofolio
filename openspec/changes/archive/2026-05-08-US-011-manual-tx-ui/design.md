# US-011 Design — Formulario de ingreso manual de transacciones (UI)

> Authoritative technical design for US-011. Proposal: `openspec/changes/US-011-manual-tx-ui/proposal.md`. Stack constraints: React 19 + React Router v6 + Tailwind 4 + Vitest + @testing-library/react v16. **Strict TDD is active** — every implementation file listed below MUST have a failing test written first.

---

## Architecture Overview

### Component tree

```
RouterProvider
└── ProtectedRoute
    └── ToastProvider                       (NEW — wraps protected app)
        └── AppLayoutShell                  (implicit — page-level layout)
            ├── DashboardPage
            │   └── header
            │       └── <Link to="/transactions/new">Add Transaction</Link>     (NEW button)
            ├── TokenDetailPage
            │   └── TokenDetailHeader
            │       └── <Link to={`/transactions/new?wallet_id=…&token_id=…`}>  (NEW button)
            └── AddTransactionPage          (NEW route — /transactions/new)
                ├── WalletSourceSelect
                ├── TokenSelect             (depends on selected wallet)
                ├── TransactionTypeSelect
                ├── DateTimeInput
                ├── AmountInput
                ├── InheritWacSuggestion    (conditional: type=TRANSFER_IN, on-chain wallet, suggestion present)
                ├── PriceUsdInput
                ├── WacPreview              (conditional: amount + price valid)
                └── SubmitBar               (button + inline error region)
        └── ToastRoot                       (NEW — single toast slot, mounted once)
```

### Data flow

1. **Mount** — `AddTransactionPage` reads `useSearchParams()` to extract `wallet_id`/`token_id`. Both are optional; if present, the form pre-selects them.
2. **Wallets** — `useWallets()` (already exists, will be fixed for camelCase). Used to populate `WalletSourceSelect` and to look up the selected wallet's `network` + `walletType`.
3. **Tokens** — `useTokensByWallet(wallet)` fires `GET /api/tokens?network={wallet.network}` whenever the selected wallet changes. CEX wallets → `network=CEX_BINANCE`. On-chain wallets → `network=ETH` or `BSC`. Cached per network in a module-level `Map<Network, Token[]>`.
4. **Portfolio context for selected token** — when `(wallet, token, type)` is set AND `type ∈ {SELL, SWAP_OUT, TRANSFER_OUT}`, the form needs the *current balance* for the wallet+token pair. This is read on-demand by `useWalletBalance(walletId, contractAddress, network)` which calls `GET /api/portfolio/token/:contractAddress/:network` and picks the matching `walletBreakdown` entry. Reused for TRANSFER_IN inheritance suggestions to avoid double-fetch.
5. **WAC preview** — `useWacPreview(currentBalance, currentWac, type, amount, price)` — pure calculation, no fetch.
6. **TRANSFER_IN suggestion** — `useTransferInSuggestion(token, destinationWalletId, type, wallets)` — fetches portfolio for the token, filters wallet breakdown.
7. **Submit** — `useCreateTransaction()` exposes a React 19 `useActionState`-compatible action. On 201 → calls `useToast().show(...)` then `useNavigate()(/token/:address/:network)`. On 400 → returns `{ status: 'error', errorCode, fieldErrors, currentBalance? }` rendered inline.

### Critical sequencing

- TRANSFER_IN suggestion fetch is **debounced via state keys** (not via setTimeout). The cancelled-flag pattern is the source of truth — every render of the effect captures a fresh `cancelled = false`, and the previous run's cleanup sets the previous capture to `true`. Stale responses are dropped silently.
- The form does NOT block on the suggestion fetch. The price field stays editable; "Use this" button appears only when the response arrives and the user has not modified the price field manually.

---

## New Files

### Hooks

| File | Purpose |
|------|---------|
| `apps/frontend/src/hooks/useTokensByWallet.ts` | Fetches token list filtered by `wallet.network`. Module-level cache keyed by network. Returns `{ data, loading, error }`. |
| `apps/frontend/src/hooks/useWalletBalance.ts` | Looks up current balance + WAC for a `(walletId, contractAddress, network)` triple by querying portfolio. Used for SELL pre-validation AND as the data source for inheritance suggestions. |
| `apps/frontend/src/hooks/useWacPreview.ts` | Pure synchronous hook (no `useEffect`). Computes new WAC + new balance given current state and form inputs. Returns `{ visible, newBalance, newWac, newCostBasis } | { visible: false }`. |
| `apps/frontend/src/hooks/useTransferInSuggestion.ts` | When type=TRANSFER_IN + on-chain destination wallet + token selected, fetches portfolio and filters wallet breakdown for inheritance candidates. Returns `{ candidate: { walletId, label, wac } | null, loading, error }`. |
| `apps/frontend/src/hooks/useCreateTransaction.ts` | Wraps `apiClient.post('/api/transactions', ...)`. Returns an action function and a status object compatible with `useActionState`. |
| `apps/frontend/src/hooks/useToast.ts` | Re-exports the `useToast` hook from `lib/toast-context`. (Thin wrapper for ergonomics — could be inlined in `lib/toast-context.tsx` instead; see "Toast" section.) |

### Lib / Context

| File | Purpose |
|------|---------|
| `apps/frontend/src/lib/toast-context.tsx` | `ToastProvider` + `useToast` + `<ToastRoot />`. Single-toast model with 3-second auto-dismiss. |
| `apps/frontend/src/lib/iso-datetime.ts` | Pure helper `toIso8601(dateTimeLocal: string): string` and inverse `fromIso8601(iso: string): string` for `<input type="datetime-local">` ↔ backend `z.iso.datetime()`. **R1 mitigation** — own unit test file. |
| `apps/frontend/src/lib/transaction-rules.ts` | Pure helpers: `isPriceRequired(type)`, `isOutbound(type)`, `isInbound(type)`, `validateAmount(value)`, `validatePriceUsd(value, type)`. Used by both the form and tests. |

### Pages

| File | Purpose |
|------|---------|
| `apps/frontend/src/pages/AddTransactionPage.tsx` | Top-level page. Owns form state via `useActionState`. Reads query params for prefill. Mounts subcomponents. |

### Components

All under `apps/frontend/src/components/add-transaction/`.

| File | Purpose |
|------|---------|
| `WalletSourceSelect.tsx` | Wallet dropdown grouped by source. Options: on-chain wallets first, then "Binance Account" CEX wallet. |
| `TokenSelect.tsx` | Token dropdown filtered by `useTokensByWallet`. Disabled while wallets/tokens are loading. |
| `TransactionTypeSelect.tsx` | 6-option dropdown. Renders the swap nudge note when type ∈ {SWAP_IN, SWAP_OUT}. |
| `DateTimeInput.tsx` | `<input type="datetime-local">` wrapper. Defaults to "now" on mount. |
| `AmountInput.tsx` | `<input type="text" inputMode="decimal">` with regex strip. Renders inline error and balance hint ("Balance: 12.345"). |
| `PriceUsdInput.tsx` | Same input pattern. Label switches between "Price USD *" and "Price USD (optional)". |
| `WacPreview.tsx` | Read-only summary block: "New WAC: $X · New balance: Y · Estimated, final value computed on submit". |
| `InheritWacSuggestion.tsx` | "Inherit WAC $X from {label}? [Use this]" panel. |
| `SubmitBar.tsx` | Submit button + inline error region (`<p role="alert">`). Disabled when client-side validation blocks the form. |

### Tests (TDD — written first)

All under `apps/frontend/src/__tests__/` mirroring source paths, OR colocated as `Foo.test.tsx`. The repo convention (verify in existing US-010 tests) determines the exact location — design assumes colocated `*.test.tsx` next to source.

| Test file | Covers |
|-----------|--------|
| `lib/iso-datetime.test.ts` | `toIso8601` produces `…:00.000Z`. Round-trip identity. Edge: empty string. |
| `lib/transaction-rules.test.ts` | `isPriceRequired` per type matrix. `validateAmount('0')` → error. `validatePriceUsd('0', 'BUY')` → error. `validatePriceUsd('', 'TRANSFER_OUT')` → ok. |
| `lib/toast-context.test.tsx` | `useToast()` outside provider throws. `show()` appears in DOM, dismisses after 3s. Two consecutive `show()` calls — second replaces first. |
| `hooks/useWallets.test.ts` | **Regression**: response with `wallet_type` is mapped to `walletType`. Both ON_CHAIN and CEX kinds. |
| `hooks/useTokensByWallet.test.ts` | Fetches with correct `network` query string. CEX wallet → `?network=CEX_BINANCE`. Cache hit on re-mount. |
| `hooks/useWalletBalance.test.ts` | Returns matching breakdown entry. Returns `null` when wallet not in breakdown. |
| `hooks/useWacPreview.test.ts` | BUY new position → newWac = price. BUY adds to existing → weighted avg. SELL reduces balance, WAC unchanged. SWAP_IN behaves like BUY. SWAP_OUT like SELL. TRANSFER_IN with price → like BUY. TRANSFER_IN with INHERITED → preserves source WAC. TRANSFER_OUT with no price → balance reduced, WAC unchanged. NaN inputs → `visible: false`. |
| `hooks/useTransferInSuggestion.test.ts` | Filters out destination wallet. Filters out 0-balance entries. Filters out CEX wallets. Returns `null` when type≠TRANSFER_IN. Cancellation: rapidly changing `destinationWalletId` does not surface stale data. |
| `hooks/useCreateTransaction.test.ts` | 201 → returns success state. 400 INSUFFICIENT_BALANCE → exposes `currentBalance` + `attempted`. 400 Validation failed → exposes `fieldErrors` keyed by `path`. |
| `components/add-transaction/WalletSourceSelect.test.tsx` | Renders ON_CHAIN wallets and "Binance Account" CEX wallet. `onChange` fires with selected id. |
| `components/add-transaction/TokenSelect.test.tsx` | Disabled until tokens load. Filters by network. Empty state copy. |
| `components/add-transaction/TransactionTypeSelect.test.tsx` | All 6 options present. Swap nudge note appears for SWAP_IN/SWAP_OUT only. |
| `components/add-transaction/AmountInput.test.tsx` | Strips invalid chars on input. Shows balance hint when provided. Shows "Exceeds balance" when over. |
| `components/add-transaction/PriceUsdInput.test.tsx` | Label suffix switches between "*" and "(optional)" based on type. |
| `components/add-transaction/WacPreview.test.tsx` | Hides when amount/price invalid. Renders formatted USD. |
| `components/add-transaction/InheritWacSuggestion.test.tsx` | Renders WAC + label. Click → onUse called with WAC value. |
| `pages/AddTransactionPage.test.tsx` | **Integration** with mocked `apiClient`. Covers AC-1..AC-7: pre-select via query params, submit success → toast + navigate, INSUFFICIENT_BALANCE inline error, TRANSFER_IN inheritance prompt, price=0 inline error. |

**Test count: 17 files** (≈ 9 hooks/lib + 8 components/pages).

---

## Modified Files

| File | Change | Why |
|------|--------|-----|
| `apps/frontend/src/routes/router.tsx` | Add `/transactions/new` protected route → `AddTransactionPage`. | New entry point. |
| `apps/frontend/src/App.tsx` | Wrap `RouterProvider` with `ToastProvider` (between `AuthProvider` and `RouterProvider`). | Toast must be available to all protected pages. |
| `apps/frontend/src/hooks/useWallets.ts` | Fetch `WalletApiRow[]` (snake_case), map to `WalletEntry[]` (camelCase) before `setData`. Add internal type `WalletApiRow`. | D8 — fix the `walletType` undefined bug consumers expect. |
| `apps/frontend/src/pages/DashboardPage.tsx` | In the `<header>`, add a primary "Add Transaction" `<Link>` next to the existing `RefreshIndicator`. | D2 entry point #1. |
| `apps/frontend/src/components/token-detail/TokenDetailHeader.tsx` | Add an "Add Transaction" `<Link>` with `to={\`/transactions/new?wallet_id=${firstWalletId}&token_id=${tokenId}\`}`. `firstWalletId` = `position.walletBreakdown[0]?.walletId`. | D2 entry point #2. |
| `apps/frontend/src/types/token-detail.ts` | (No change to `WalletEntry` — it stays camelCase.) | — |
| `apps/frontend/src/hooks/useWallets.test.ts` (if exists) or create | Add regression test asserting `walletType` is defined. | D8 mitigation — this is the test file from the table above. |

**No backend files are modified.** US-011 is frontend-only.

---

## Component Design

### `AddTransactionPage`

```tsx
export function AddTransactionPage(): React.ReactElement;
```

Internal state (via `useActionState`):

```ts
type FormState = {
  status: 'idle' | 'submitting' | 'success' | 'error';
  errorCode: string | null;
  errorMessage: string | null;
  fieldErrors: Partial<Record<FormFieldName, string>>;
  // Returned only on INSUFFICIENT_BALANCE — drives the AmountInput hint
  currentBalance: DecimalString | null;
};
```

Local controlled state (NOT inside the action — these are inputs the user edits live, the action only reads them at submit time):

```ts
const [walletId, setWalletId] = useState<string>(searchParams.get('wallet_id') ?? '');
const [tokenId,  setTokenId]  = useState<string>(searchParams.get('token_id')  ?? '');
const [type,     setType]     = useState<TransactionType>('BUY');
const [amount,   setAmount]   = useState<string>('');
const [priceUsd, setPriceUsd] = useState<string>('');
const [dateLocal, setDateLocal] = useState<string>(initialNowLocal());
const [costSource, setCostSource] = useState<CostSource>('MANUAL'); // toggled by InheritWacSuggestion
```

### `WalletSourceSelectProps`

```ts
interface WalletSourceSelectProps {
  wallets: WalletEntry[];
  selectedWalletId: string;
  onChange: (walletId: string) => void;
  disabled?: boolean;
}
```

Renders `<optgroup label="On-Chain">` containing `walletType === 'ON_CHAIN'` entries, then `<optgroup label="CEX">` for CEX entries. The CEX option label is the wallet's `label ?? 'Binance Account'`.

### `TokenSelectProps`

```ts
interface TokenSelectProps {
  tokens: Token[] | null;            // null = loading
  selectedTokenId: string;
  onChange: (tokenId: string) => void;
  disabled?: boolean;
}
```

Each option label: `${token.symbol}${token.name ? ` — ${token.name}` : ''}`.

### `TransactionTypeSelectProps`

```ts
interface TransactionTypeSelectProps {
  value: TransactionType;
  onChange: (type: TransactionType) => void;
}
```

Renders all 6 options. Shows nudge note inline below the select for SWAP_IN/SWAP_OUT.

### `AmountInputProps`

```ts
interface AmountInputProps {
  value: string;
  onChange: (value: string) => void;
  currentBalance: DecimalString | null;   // when known, used for hint + over-balance check
  type: TransactionType;                   // determines whether balance check applies
  fieldError: string | null;
}
```

Sanitization on input: replace `/[^\d.]/g`. Prevent multiple `.`.

### `PriceUsdInputProps`

```ts
interface PriceUsdInputProps {
  value: string;
  onChange: (value: string) => void;
  type: TransactionType;
  fieldError: string | null;
}
```

Label: `Price USD ${isPriceRequired(type) ? '*' : '(optional)'}`.

### `WacPreviewProps`

```ts
interface WacPreviewProps {
  currentBalance: DecimalString | null;
  currentWac:     DecimalString | null;
  type:           TransactionType;
  amount:         string;
  priceUsd:       string;
}
```

Renders nothing when preview is hidden.

### `InheritWacSuggestionProps`

```ts
interface InheritWacSuggestionProps {
  candidate: { walletId: string; label: string; wac: DecimalString } | null;
  loading: boolean;
  onUse: (wac: DecimalString) => void;
}
```

Renders nothing when `candidate === null`. Shows a small loading spinner when `loading && !candidate` and the form already has TRANSFER_IN selected.

### `DateTimeInputProps`

```ts
interface DateTimeInputProps {
  value: string;     // YYYY-MM-DDTHH:mm
  onChange: (value: string) => void;
}
```

### `SubmitBarProps`

```ts
interface SubmitBarProps {
  submitting: boolean;
  disabled: boolean;
  errorMessage: string | null;
}
```

---

## Hook Design

### `useTokensByWallet`

```ts
export function useTokensByWallet(wallet: WalletEntry | null): {
  data: Token[] | null;
  loading: boolean;
  error: Error | null;
};
```

- When `wallet === null` → returns `{ data: null, loading: false, error: null }`.
- Module-level cache `Map<Network, Token[]>`. Cache hit → return synchronously without re-fetch.
- Uses cancelled-flag pattern.

### `useWalletBalance`

```ts
export function useWalletBalance(
  walletId: string,
  contractAddress: string,
  network: Network,
): {
  balance: DecimalString | null;
  wac:     DecimalString | null;
  loading: boolean;
  error:   Error | null;
};
```

- Fetches `GET /api/portfolio/token/:contractAddress/:network` (no `wallet_id` query — we want the breakdown), then picks the entry where `walletBreakdown[].walletId === walletId`.
- Returns `{ balance: null, wac: null }` when the wallet is not in the breakdown (= position has 0 balance for this wallet).
- Cancellation pattern.

### `useWacPreview`

Pure (no `useEffect`, no state). Implementation:

```ts
type PreviewResult =
  | { visible: false }
  | { visible: true; newBalance: number; newWac: number; newCostBasis: number };

export function useWacPreview(
  currentBalance: DecimalString | null,
  currentWac:     DecimalString | null,
  type:           TransactionType,
  amountStr:      string,
  priceStr:       string,
): PreviewResult;
```

(See "WAC Preview Logic" section below for the formulas.)

### `useTransferInSuggestion`

```ts
export function useTransferInSuggestion(
  token:                 Token | null,
  destinationWalletId:   string | null,
  type:                  TransactionType,
  walletsByType:         Map<string, WalletEntry>,  // walletId → WalletEntry
): {
  candidate: { walletId: string; label: string; wac: DecimalString } | null;
  loading:   boolean;
  error:     Error | null;
};
```

- Effect triggers only when ALL of: `type === 'TRANSFER_IN'`, `token !== null`, `destinationWalletId !== null`, AND the destination wallet's `walletType === 'ON_CHAIN'`. Otherwise returns `{ candidate: null, loading: false, error: null }` and skips the fetch.
- Filter rules in the response: keep entries with `walletId !== destinationWalletId` AND `parseFloat(balance) > 0` AND `walletsByType.get(walletId)?.walletType === 'ON_CHAIN'`. Pick the highest-balance match.
- Cleanup sets `cancelled = true`.

### `useCreateTransaction`

```ts
type SubmitInput = {
  walletId: string;
  tokenId: string;
  type: TransactionType;
  amount: string;
  priceUsd: string | null;
  dateLocal: string;
  costSource: 'MANUAL' | 'INHERITED';
};

type SubmitResult =
  | { status: 'success'; transactionId: string; cycleNumber: number; tokenContractAddress: string; tokenNetwork: Network }
  | { status: 'error';   errorCode: string; errorMessage: string; fieldErrors: Record<string, string>; currentBalance?: DecimalString };

export function useCreateTransaction(): {
  submit: (input: SubmitInput, tokens: Token[]) => Promise<SubmitResult>;
};
```

- The `tokens` parameter is required so the success branch can resolve `tokenContractAddress` + `tokenNetwork` for the redirect (the API only returns `transaction_id` + `cycle_number`).
- On 400 with `error: 'Validation failed'`, parse `issues[]` into `fieldErrors` keyed by `issue.path[0]` (snake_case backend keys mapped to camelCase form fields via a small lookup).
- On 400 with `error: 'INSUFFICIENT_BALANCE'`, surface `currentBalance` + `attempted`.

---

## ToastContext Design

### Shape

```ts
type ToastVariant = 'success' | 'error';
type ToastState   = { id: number; message: string; variant: ToastVariant } | null;

interface ToastContextValue {
  show: (message: string, variant?: ToastVariant) => void;
}
```

### Provider

```tsx
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const idRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const show = (message: string, variant: ToastVariant = 'success') => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    const id = ++idRef.current;
    setToast({ id, message, variant });
    timerRef.current = window.setTimeout(() => {
      setToast(t => (t?.id === id ? null : t));
    }, 3000);
  };

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <ToastRoot toast={toast} />
    </ToastContext.Provider>
  );
}
```

### `useToast`

Throws `Error('useToast must be used inside <ToastProvider>')` when called outside the provider. (This protects against a regression where the provider is removed without updating consumers.)

### `<ToastRoot />`

Single fixed-position element bottom-right (`fixed bottom-4 right-4`). Renders `null` when `toast === null`. `role="status"` for success, `role="alert"` for error. Dismiss button is intentionally omitted — the 3-second auto-dismiss is sufficient and matches D1's "no queue" tradeoff.

### Mounting

`ToastProvider` wraps `RouterProvider` in `App.tsx`. This ensures any page (including `LoginPage`) can use it later, but for US-011 only `AddTransactionPage` consumes it.

---

## `useAddTransaction` — Form State Machine

> Note: the proposal calls it `useCreateTransaction`. The hook is named `useCreateTransaction` (matches the action verb); this section describes how the page composes it into a state machine via `useActionState`.

### States

```
idle ─submit─▶ submitting ─201─▶ success ─navigate─▶ (page unmounts)
                       │
                       └─400/4xx/5xx─▶ error ─user edits─▶ idle
```

### Transitions

```ts
type Action =
  | { kind: 'submit'; payload: SubmitInput }
  | { kind: 'success'; transactionId: string; cycleNumber: number; tokenContractAddress: string; tokenNetwork: Network }
  | { kind: 'error'; errorCode: string; errorMessage: string; fieldErrors: Record<string, string>; currentBalance?: DecimalString }
  | { kind: 'reset-field-error'; field: string };

function reducer(state: FormState, action: Action): FormState { /* ... */ }
```

The reducer is encapsulated inside `AddTransactionPage` (not exported) — `useActionState` itself drives the transition by awaiting `useCreateTransaction.submit`.

### Submit guards (run before calling `submit`)

Listed in the order they short-circuit:

1. `walletId` empty → focus wallet select, `errorMessage = "Select a wallet"`.
2. `tokenId` empty → focus token select.
3. `dateLocal` empty → focus date input.
4. `validateAmount(amount)` returns error → set `fieldErrors.amount`.
5. `validatePriceUsd(priceUsd, type)` returns error → set `fieldErrors.priceUsd`.
6. If `isOutbound(type)` AND `currentBalance !== null` AND `parseFloat(amount) > parseFloat(currentBalance)` → `errorMessage = "Exceeds balance of {currentBalance} tokens"`, button stays disabled (this is AC-5, the disabled state is computed *during render*, not on click).
7. All guards pass → call `submit`, transition to `submitting`.

### Submit body (after guards pass)

```ts
const body: CreateTransactionRequest = {
  wallet_id: walletId,
  token_id: tokenId,
  type,
  amount,
  price_usd_at_time:
    isPriceRequired(type)
      ? priceUsd                               // required path — guard already validated > 0
      : (priceUsd.trim() === '' ? null : priceUsd),
  block_timestamp: toIso8601(dateLocal),
  cost_source: costSource,
};
```

### Success branch

```ts
toast.show(`Transaction added. Cycle #${result.cycleNumber} updated.`, 'success');
navigate(`/token/${result.tokenContractAddress}/${result.tokenNetwork}`);
```

### Error branch

- `INSUFFICIENT_BALANCE` → updates `state.currentBalance`. The page passes `state.currentBalance` to `AmountInput`'s hint, which now reads "Server says: 12.345 tokens. Your input: 50."
- `Validation failed` → spreads `fieldErrors` onto the inputs.
- `PRICE_REQUIRED_FOR_TRANSFER_IN` → maps to `fieldErrors.priceUsd = 'Price required for TRANSFER_IN'`.
- 401 → `apiClient` already redirects.
- Any other 4xx/5xx → `errorMessage = 'Could not save transaction. Try again.'`.

---

## WAC Preview Logic

### Inputs

| Name | Type | Source |
|------|------|--------|
| `currentBalance` | `DecimalString \| null` | `useWalletBalance` |
| `currentWac`     | `DecimalString \| null` | `useWalletBalance` |
| `type`           | `TransactionType`       | form state |
| `amountStr`      | `string`                | form state |
| `priceStr`       | `string`                | form state |

When `useWalletBalance` returns `null` for both balance + WAC, the position does not exist yet — for INBOUND types we treat `currentBalance = 0`, `currentWac = 0`.

### Output

```ts
type PreviewResult =
  | { visible: false }
  | { visible: true; newBalance: number; newWac: number; newCostBasis: number };
```

### Computation

```ts
const a = parseFloat(amountStr);
const p = parseFloat(priceStr);
const cb = currentBalance === null ? 0 : parseFloat(currentBalance);
const cw = currentWac     === null ? 0 : parseFloat(currentWac);

if (Number.isNaN(a) || a <= 0) return { visible: false };

switch (type) {
  case 'BUY':
  case 'SWAP_IN':
  case 'TRANSFER_IN': {
    if (Number.isNaN(p) || p <= 0) return { visible: false };
    const newBalance    = cb + a;
    const newCostBasis  = cb * cw + a * p;
    const newWac        = newBalance > 0 ? newCostBasis / newBalance : 0;
    return { visible: true, newBalance, newWac, newCostBasis };
  }
  case 'SELL':
  case 'SWAP_OUT':
  case 'TRANSFER_OUT': {
    if (cb === 0) return { visible: false };           // outbound on empty position — handled by submit guard
    const newBalance   = Math.max(0, cb - a);
    const newCostBasis = newBalance * cw;
    return { visible: true, newBalance, newWac: cw, newCostBasis };  // WAC unchanged on outbound (PRD)
  }
}
```

### Display

`WacPreview` renders:

```
New balance: {formatCrypto(newBalance)} {token.symbol}
New WAC: {formatUsd(newWac)}
New cost basis: {formatUsd(newCostBasis)}
Estimated — final value computed on submit.
```

Hidden when `visible === false`.

---

## TRANSFER_IN Inheritance Fetch Logic

### When to fetch

The effect fires (i.e. issues a real HTTP request) only when ALL of the following are true:

- `type === 'TRANSFER_IN'`
- `token !== null` (`tokenId` resolved to a token in the loaded list)
- `destinationWalletId !== null`
- The destination wallet (looked up by id in the wallets list) has `walletType === 'ON_CHAIN'`

If any condition becomes false, the effect's cleanup runs and the next effect short-circuits to `setCandidate(null)` without fetching.

### What to fetch

```http
GET /api/portfolio/token/{token.contractAddress}/{token.network}
```

No `wallet_id` query — we want every wallet that holds the token.

### Filter pipeline

```ts
const breakdown: WalletBreakdown[] = response.position?.walletBreakdown ?? [];

const candidates = breakdown.filter(b =>
  b.walletId !== destinationWalletId
  && parseFloat(b.balance) > 0
  && walletsByType.get(b.walletId)?.walletType === 'ON_CHAIN'
);

const candidate = candidates.length === 0
  ? null
  : candidates.reduce((max, cur) =>
      parseFloat(cur.balance) > parseFloat(max.balance) ? cur : max,
    );
```

### Cancelled flag pattern

```ts
useEffect(() => {
  if (!shouldFetch()) {
    setCandidate(null);
    setLoading(false);
    return;
  }

  let cancelled = false;
  setLoading(true);
  setError(null);

  apiClient
    .get<TokenPortfolioResponse>(`/api/portfolio/token/${token.contractAddress}/${token.network}`)
    .then(res => {
      if (cancelled) return;
      setCandidate(filterToCandidate(res, destinationWalletId, walletsByType));
    })
    .catch(e => {
      if (cancelled) return;
      setError(e instanceof Error ? e : new Error(String(e)));
      setCandidate(null);
    })
    .finally(() => {
      if (!cancelled) setLoading(false);
    });

  return () => { cancelled = true; };
}, [type, token?.contractAddress, token?.network, destinationWalletId, walletsByType]);
```

The `walletsByType` Map is memoized at the page level via React Compiler (no manual `useMemo`).

### "Use this" interaction

When the user clicks "Use this" in `InheritWacSuggestion`:

1. `setPriceUsd(candidate.wac)` — fills the price field.
2. `setCostSource('INHERITED')` — flag is sent in the POST body.
3. The `PriceUsdInput.onChange` handler resets `costSource` back to `'MANUAL'` whenever the user edits the price field after the fact (i.e. the next user-typed change reverts the flag, per D7).

---

## Type Dropdown Rules

| Type          | Direction | Price required | WAC behavior on this transaction      | Balance affected |
|---------------|-----------|----------------|---------------------------------------|------------------|
| BUY           | INBOUND   | ✓ (> 0)        | Recalculated (weighted avg)           | +amount          |
| SELL          | OUTBOUND  | ✓ (> 0)        | Unchanged (PRD: WAC is pure)          | -amount          |
| SWAP_IN       | INBOUND   | ✓ (> 0)        | Recalculated                          | +amount          |
| SWAP_OUT      | OUTBOUND  | ✓ (> 0)        | Unchanged                             | -amount          |
| TRANSFER_IN   | INBOUND   | ✓ (> 0) ¹     | Recalculated (or inherited)           | +amount          |
| TRANSFER_OUT  | OUTBOUND  | ✗ (optional)   | Unchanged                             | -amount          |

¹ Required at the form level, but on the wire `price_usd_at_time` is `nullable`. The backend service throws `PRICE_REQUIRED_FOR_TRANSFER_IN` if null — the form pre-validates to avoid the round-trip.

`isPriceRequired(type)` and `isOutbound(type)` live in `lib/transaction-rules.ts` and are unit-tested.

### Submit-button disabled conditions (composed by the page)

```
disabled = submitting
        || walletId === ''
        || tokenId === ''
        || dateLocal === ''
        || amountInvalid
        || priceInvalid
        || (isOutbound(type) && currentBalance !== null && amount > currentBalance)
```

`amountInvalid` / `priceInvalid` are derived live via `validateAmount` / `validatePriceUsd`.

---

## Routing Changes

### New route

```tsx
{
  path: "/transactions/new",
  element: (
    <ProtectedRoute>
      <AddTransactionPage />
    </ProtectedRoute>
  ),
}
```

### Query parameters (read by `AddTransactionPage`)

| Param      | Type   | Source                                   | Behavior                                                               |
|------------|--------|------------------------------------------|------------------------------------------------------------------------|
| `wallet_id`| uuid   | TokenDetailPage Add button → `position.walletBreakdown[0]?.walletId` | Pre-selects the wallet on mount. Validated against `useWallets` data. |
| `token_id` | uuid   | TokenDetailPage Add button → `data.token.id`                          | Pre-selects the token. Token list is fetched after the wallet resolves; until then the field shows "Loading…" but the value is preserved. |

If a query param does not match any loaded wallet/token, it is silently ignored and the user picks manually.

### Provider order (App.tsx after changes)

```tsx
<AuthProvider>
  <ToastProvider>
    <RouterProvider router={router} />
  </ToastProvider>
</AuthProvider>
```

`ToastProvider` is between `AuthProvider` and `RouterProvider` because:
- `AuthProvider` wraps everything (per existing comment in `App.tsx:4-7`).
- `RouterProvider` must be the deepest router-aware boundary so `useNavigate` works inside the toast (currently the toast doesn't use navigation, but this layering keeps the option open).

---

## Risks Already Accounted For

- **R1 (block_timestamp formatting)** — `lib/iso-datetime.ts` is its own module with `iso-datetime.test.ts` running pure unit tests. The integration test in `AddTransactionPage.test.tsx` asserts the request body's `block_timestamp` matches `/T\d\d:\d\d:00\.000Z$/`.
- **R2 (TRANSFER_IN race)** — cancellation is enforced in `useTransferInSuggestion`; tests rapidly toggle `destinationWalletId` and assert no stale candidate appears.
- **R3 (stale balance)** — server is treated as the source of truth on 400 INSUFFICIENT_BALANCE; the form replaces the client-side hint with `currentBalance` from the response.

---

## Out of Scope (explicit reminders)

- Backend mutations of `POST /api/transactions`, `GET /api/wallets`, `GET /api/tokens`, `GET /api/portfolio/token/:address/:network` — consumed as-is.
- `decimal.js` on the frontend — D6.
- Toast queue / dismiss button — D1.
- Editing or deleting existing transactions — separate story.
- Bulk import / CSV — separate story.
