# Spec: SummaryCards — US-009

> **Change:** `US-009-dashboard-ui`
> **Phase:** sdd-spec
> **Date:** 2026-05-07

---

## 1. Overview

`SummaryCards` renders four metric cards at the top of the dashboard. Each card is a read-only display of backend-computed accounting values. The component owns no computation — it formats and displays what the API returns.

---

## 2. Props

```typescript
interface SummaryCardsProps {
  summary: {
    totalValueUsd: string,
    totalCostBasisUsd: string,
    totalPnlUsd: string,
    totalPnlPct: string | null   // null when cost basis is 0
  }
}
```

All numeric values are decimal strings from the backend. The component must never call `parseFloat` directly — it routes every value through `formatUsd` or `formatPct` from `src/lib/format.ts`.

---

## 3. Card Definitions

### Card 1 — Total Portfolio Value
- **Label**: `"Total Portfolio Value"`
- **Value field**: `summary.totalValueUsd`
- **Format**: `formatUsd(totalValueUsd)` -> e.g., `"$12,345.67"`
- **Color**: neutral (no P&L coloring)
- **Null handling**: not applicable — backend always returns a string (may be `"0.00"`)

### Card 2 — Total Cost Basis
- **Label**: `"Total Cost Basis"`
- **Value field**: `summary.totalCostBasisUsd`
- **Format**: `formatUsd(totalCostBasisUsd)` -> e.g., `"$10,000.00"`
- **Color**: neutral
- **Null handling**: not applicable

### Card 3 — Total P&L ($)
- **Label**: `"Total P&L"`
- **Value field**: `summary.totalPnlUsd`
- **Format**: `formatUsd(totalPnlUsd)` with sign prefix -> e.g., `"+$2,345.67"` or `"-$500.00"`
- **Color**: applies P&L coloring (section 5)
- **Null handling**: not applicable — backend always returns a string

### Card 4 — Total P&L (%)
- **Label**: `"Total P&L %"`
- **Value field**: `summary.totalPnlPct`
- **Format**: when not null -> `formatPct(totalPnlPct)` with sign -> e.g., `"+23.46%"` or `"-5.00%"`
- **Color**: applies P&L coloring (section 5) when not null
- **Null handling**: when `totalPnlPct === null` -> display `"—"` in neutral color, no sign prefix

---

## 4. Loading Skeleton

`SummaryCards` is called with a loading variant (or a separate `SummaryCardsSkeleton` component) during `DashboardPage` initial load state.

Skeleton behavior:
- Render 4 cards at the same dimensions as real cards.
- Each card shows a gray animated-pulse rectangle in place of the value.
- The label text IS rendered (not skeletonized) — preserves layout anchor.
- No data is shown.

Implementation note: skeleton can be achieved via a conditional prop (`loading?: boolean`) or by rendering a dedicated `SummaryCardsSkeleton` component from `DashboardPage`. Either is acceptable — the spec does not prescribe which approach, only the visual outcome.

---

## 5. P&L Coloring Rules

Applied to Card 3 (P&L $) and Card 4 (P&L %) only.

| Condition | Color class | Hex |
|-----------|-------------|-----|
| `parseFloat(value) > 0` | `text-pnl-positive` | `#22C55E` |
| `parseFloat(value) < 0` | `text-pnl-negative` | `#EF4444` |
| `parseFloat(value) === 0` | neutral (no color class) | — |
| `value === null` | neutral | — |

Color evaluation uses `parseFloat` of the raw decimal string only for the comparison — NOT for display. Display always goes through `formatUsd`/`formatPct`.

Color tokens are defined in `src/index.css` via Tailwind v4 `@theme`:

```css
@theme {
  --color-pnl-positive: #22C55E;
  --color-pnl-negative: #EF4444;
}
```

Use Tailwind classes (`text-pnl-positive`, `text-pnl-negative`). No inline `style={{color: ...}}`.

---

## 6. GIVEN/WHEN/THEN Scenarios

### GIVEN cost basis is zero (new user, no positions)
WHEN `totalPnlPct === null`
THEN Card 4 renders `"—"` in neutral color
AND Card 3 still renders `totalPnlUsd` (which will be `"0.00"`) in neutral color

### GIVEN portfolio has positive P&L
WHEN `totalPnlUsd = "2345.67"` and `totalPnlPct = "23.4567"`
THEN Card 3 renders `"+$2,345.67"` in green (`#22C55E`)
AND Card 4 renders `"+23.46%"` in green

### GIVEN portfolio has negative P&L
WHEN `totalPnlUsd = "-500.00"` and `totalPnlPct = "-5.0000"`
THEN Card 3 renders `"-$500.00"` in red (`#EF4444`)
AND Card 4 renders `"-5.00%"` in red

### GIVEN the component is in skeleton/loading state
WHEN `loading === true`
THEN all four value areas render animated gray rectangles
AND card labels are visible
AND no data values are shown

---

## 7. NEGATIVE Cases

### NEGATIVE: backend returns `"0.00"` for all fields (empty portfolio)
THEN all four cards render their zero-formatted values
AND P&L cards show neutral color (value is 0, not positive or negative)
AND no error is thrown

### NEGATIVE: `totalPnlPct` is the string `"0.00"` (not null, but zero P&L)
THEN Card 4 renders `"0.00%"` (or `"+0.00%"`) in neutral color
AND does NOT render `"—"` — `"—"` is only for `null`

### NEGATIVE: malformed decimal string from backend (e.g., `"NaN"` or `""`)
THEN `formatUsd` / `formatPct` must NOT throw — they should return `"—"` as a safe fallback
Note: this is a backend contract violation; the spec records the defensive behavior, not the expected path

---

## 8. Format Helpers Contract

From `src/lib/format.ts`:

```typescript
// Accepts a decimal string or number; returns localized USD string
function formatUsd(value: string | number): string

// Accepts a decimal string or number; returns localized percent string
function formatPct(value: string | number): string

// Sign prefix helper: prepends "+" for positive values
function withSign(value: string | number, formatted: string): string
```

`SummaryCards` uses `withSign(raw, formatUsd(raw))` for P&L cards when the value is not null.

---

## 9. File Location

`apps/frontend/src/components/dashboard/SummaryCards.tsx`
