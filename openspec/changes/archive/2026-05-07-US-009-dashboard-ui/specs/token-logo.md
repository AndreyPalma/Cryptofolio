# Spec: TokenLogo — US-009

> **Change:** `US-009-dashboard-ui`
> **Phase:** sdd-spec
> **Date:** 2026-05-07

---

## 1. Overview

`TokenLogo` is a self-contained display component that renders a token's logo. It chooses between a CDN image (on-chain tokens) and a letter-avatar (CEX tokens and CDN failures). It never fetches data or makes API calls — all inputs come from props.

---

## 2. Props

```typescript
interface TokenLogoProps {
  symbol: string
  contractAddress: string | null
  network: 'ETH' | 'BSC' | 'CEX_BINANCE'
  size?: 'sm' | 'md' | 'lg'   // default: 'md'
}
```

---

## 3. Rendering Strategy

The rendering path is decided ENTIRELY by `network`. Not by `contractAddress`.

| network value | Strategy                              |
|---------------|---------------------------------------|
| ETH           | CDN attempt first, letter-avatar on error |
| BSC           | CDN attempt first, letter-avatar on error |
| CEX_BINANCE   | Letter-avatar immediately (no CDN attempt — ever) |

This distinction is load-bearing: the spec explicitly forbids making a CDN request for CEX tokens even if contractAddress is accidentally non-null (backend contract violation scenario).

---

## 4. CDN Path (ON_CHAIN tokens: ETH and BSC)

### 4.1 URL Construction

Chain mapping used to build the CDN URL:

| network | chain segment |
|---------|---------------|
| ETH     | ethereum      |
| BSC     | smartchain    |

CDN URL template:
```
https://assets.trustwalletapp.com/blockchains/{chain}/assets/{checksumAddress}/logo.png
```

Where {checksumAddress} is the EIP-55 checksum form of contractAddress.

Checksum computation: implemented as a pure client-side helper function with no external library. If computing the checksum fails for any reason (e.g., unexpected input format), fall back to letter-avatar immediately.

Guard: if contractAddress is null, skip the CDN attempt entirely and render letter-avatar directly.

### 4.2 img Element

```
<img
  src={cdnUrl}
  alt={symbol + " logo"}
  onError={handleError}
  className={sizeClass}
/>
```

### 4.3 Error Handling

GIVEN the CDN image fails to load (onError fires)
THEN the component switches to letter-avatar rendering
AND the broken img element is removed from the DOM
AND no error is logged — this is an expected degraded path, not an error condition

The switch is handled via local React state: `const [useFallback, setUseFallback] = useState(false)`. When onError fires, setUseFallback(true).

---

## 5. Letter-Avatar Path (CEX tokens and CDN fallbacks)

### 5.1 Content

Display the first character of `symbol`, uppercased.

Examples:
- "ETH" -> "E"
- "PEPE" -> "P"
- "BNB" -> "B"
- "" (empty) -> "?" (fallback placeholder, no crash)

### 5.2 Background Color

Background color is DETERMINISTIC and derived from `symbol`. The same symbol always produces the same color across renders, sessions, and devices. No random assignment.

Algorithm: compute a simple hash of the symbol string, take modulo of the palette size, use the result as an index into a fixed color palette.

Palette requirements:
- Minimum 8 colors
- Must be accessible (sufficient contrast with white or dark text)
- Must NOT include Binance yellow (#F0B90B) — that color is reserved exclusively for SourceBadge
- Derived from the Tailwind CSS color system (e.g., indigo-500, violet-500, teal-500, rose-500, amber-500, cyan-500, emerald-500, orange-500)

Implementation:
```typescript
function computeAvatarColor(symbol: string): string
```
Pure function — no side effects. Returns a CSS hex value or Tailwind arbitrary color.

### 5.3 Shape and Layout

The letter-avatar renders as a circle. Same size classes as the CDN image variant to ensure consistent table row height.

The letter is centered vertically and horizontally. Font weight: medium or semibold. Text color: white (on dark backgrounds) or dark (on light backgrounds) — whichever provides accessible contrast.

### 5.4 Accessibility

The avatar container must have `aria-label={symbol + " logo"}`.

---

## 6. Size Classes

| size prop | Dimensions |
|-----------|-----------|
| sm        | 24x24 px  |
| md        | 32x32 px  |
| lg        | 40x40 px  |

Implemented via Tailwind utility classes (e.g., `w-8 h-8` for md). No inline `style={{}}` for size — size values are static and known at build time.

---

## 7. GIVEN/WHEN/THEN Scenarios

### GIVEN an ETH on-chain token with a valid contract address
WHEN TokenLogo renders
THEN an img element is rendered with src pointing to the Trust Wallet CDN
AND the URL contains the "ethereum" chain segment
AND the contractAddress appears in EIP-55 checksum form in the URL

### GIVEN a BSC on-chain token with a valid contract address
WHEN TokenLogo renders
THEN the CDN URL contains the "smartchain" chain segment

### GIVEN an ETH on-chain token whose CDN image returns a 404 (onError fires)
THEN the img element is replaced with a letter-avatar
AND the letter-avatar shows the first letter of symbol in uppercase
AND the background color is deterministically derived from symbol
AND no error is surfaced to the user

### GIVEN a CEX_BINANCE token (regardless of contractAddress value)
WHEN TokenLogo renders
THEN NO img element with a CDN URL is rendered
AND the letter-avatar is shown immediately without any CDN attempt
AND no network request for a logo image is made

### GIVEN two TokenLogo instances both with symbol = "ETH" but different networks
WHEN one has network = 'ETH' and one has network = 'CEX_BINANCE'
THEN the on-chain instance attempts to load the CDN image (with letter-avatar fallback on error)
AND the CEX instance always renders the letter-avatar immediately
AND both show the same letter "E" if in avatar mode, with the same background color

---

## 8. NEGATIVE Cases

### NEGATIVE: contractAddress is null on an ON_CHAIN token (backend contract violation)
THEN skip the CDN attempt entirely
AND render the letter-avatar immediately
Guard condition: `if (contractAddress === null) return <LetterAvatar ...>`

### NEGATIVE: symbol is an empty string
THEN letter-avatar shows "?" as the placeholder character
AND no crash occurs
AND computeAvatarColor("") returns a valid color without throwing

### NEGATIVE: checksum computation throws an exception
THEN catch the error inside TokenLogo
AND fall back to letter-avatar immediately
AND no error propagates to the parent component or to the console

### NEGATIVE: network is a value outside the union (runtime only — TypeScript prevents at compile time)
THEN the component falls back to letter-avatar rendering
AND TypeScript's exhaustive type check on 'ETH' | 'BSC' | 'CEX_BINANCE' catches this at compile time

---

## 9. Exported Utilities

The following must be exported as named exports for direct unit testing:

```typescript
// Computes EIP-55 checksum address from a raw hex address string
function toChecksumAddress(address: string): string

// Returns a deterministic background color for a letter-avatar given a symbol
function computeAvatarColor(symbol: string): string

// Maps network to Trust Wallet CDN chain segment
function networkToChain(network: 'ETH' | 'BSC'): 'ethereum' | 'smartchain'
```

These may live in `src/lib/token-logo-utils.ts` or be exported from the component file directly.

---

## 10. File Locations

```
apps/frontend/src/components/dashboard/TokenLogo.tsx
apps/frontend/src/lib/token-logo-utils.ts   (optional — if utilities are extracted)
```
