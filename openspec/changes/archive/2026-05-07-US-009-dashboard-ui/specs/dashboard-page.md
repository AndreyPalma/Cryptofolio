# Spec: DashboardPage — US-009

> **Change:** `US-009-dashboard-ui`
> **Phase:** sdd-spec
> **Date:** 2026-05-07

---

## 1. Overview

`DashboardPage` is the root page component rendered at `/`. It orchestrates data fetching via `usePortfolio`, drives the refresh lifecycle, and composes `SummaryCards`, `RefreshIndicator`, and `PortfolioTable`. It owns no business logic — it is a coordination layer.

---

## 2. API Contract (input)

`DashboardPage` has no props. All data comes from `usePortfolio()`.

Hook return shape:

```typescript
{
  data: PortfolioSummary | null,
  loading: boolean,          // true only during the initial fetch
  error: Error | null,
  lastFetchedAt: Date | null,
  refetch: () => Promise<void>
}
```

Where `PortfolioSummary` mirrors `GET /api/portfolio`:

```typescript
{
  summary: {
    totalValueUsd: string,
    totalCostBasisUsd: string,
    totalPnlUsd: string,
    totalPnlPct: string | null
  },
  portfolioItems: PortfolioItem[]
}
```

---

## 3. Data Fetching Behavior

### GIVEN the component mounts for the first time
WHEN `usePortfolio` fires the initial fetch  
THEN `loading` is `true` and `data` is `null`  
AND the page renders the skeleton state (§4.1)

### GIVEN the initial fetch succeeds
WHEN the response arrives with valid data  
THEN `loading` becomes `false`, `data` is populated, `lastFetchedAt` is set to `new Date()`  
AND the page renders the full dashboard layout

### GIVEN the initial fetch fails (non-401 error)
WHEN the fetch rejects with an `Error`  
THEN `loading` becomes `false`, `error` is set, `data` remains `null`  
AND the page renders the error-no-data state (§4.3)

### GIVEN a successful initial load, WHEN the 60s background refetch succeeds
THEN `data` swaps atomically to the new response  
AND `loading` must NOT become `true` during the background fetch — the previous data renders uninterrupted  
AND `lastFetchedAt` is updated to the new `Date()`

### GIVEN a successful initial load, WHEN the 60s background refetch fails
THEN `error` is set, `data` retains its previous value  
AND the page renders the stale-data-with-error state (§4.4)

### GIVEN the user is on a 401 response (session expired)
THEN `apiClient` handles the redirect to `/login` before `usePortfolio` sees the response  
AND `DashboardPage` does not need to handle 401 explicitly

---

## 4. UI States

### 4.1 Skeleton State (`loading === true && data === null`)

- Render 4 gray animated-pulse summary card skeletons at the same dimensions as the real cards.
- Render 5 gray animated-pulse table row skeletons at full table width.
- Do NOT render `RefreshIndicator` or `PortfolioTable` in this state.
- No spinner. No loading text.

### 4.2 Loaded State (`data !== null && error === null`)

- Render `<SummaryCards summary={data.summary} />`.
- Render `<RefreshIndicator lastFetchedAt={lastFetchedAt} isRefetching={false} />`.
- Render `<PortfolioTable items={data.portfolioItems} />`.

### 4.3 Error State, No Data (`error !== null && data === null`)

- Render an inline error card with the message: `"Couldn't load portfolio."`.
- Render a `[Retry]` button that calls `refetch()` when clicked.
- Do NOT render `SummaryCards` or `PortfolioTable`.
- Do NOT render `RefreshIndicator`.

### 4.4 Error State, Stale Data (`error !== null && data !== null`)

- Render `<SummaryCards>` and `<PortfolioTable>` with the last known `data` — do not blank them out.
- Render a dismissible banner above the table: `"Last update failed — showing data from Xs ago. [Retry]"`.
- `[Retry]` calls `refetch()`.
- `RefreshIndicator` continues to tick normally using the last known `lastFetchedAt`.

### 4.5 Empty State (`data !== null && data.portfolioItems.length === 0`)

- `SummaryCards` renders with all-zero values (backend returns zero strings in this case).
- `PortfolioTable` renders `PortfolioTableEmptyState` with the message: `"Add your first wallet in Settings"` — styled as a navigable link to `/settings`.
- This is NOT an error state; `error` is `null`.

---

## 5. Polling Behavior

### GIVEN the component is mounted
WHEN 60 seconds elapse  
THEN `usePortfolio` fires a background refetch automatically  
AND `loading` does not change during the background refetch

### GIVEN the browser tab becomes hidden (`document.visibilityState === 'hidden'`)
THEN polling pauses (the `setInterval` is not cleared but skips the fetch when hidden)  
OR the interval is paused using the Page Visibility API (`visibilitychange` event)  
AND no fetch is made while the tab is hidden

### GIVEN the browser tab becomes visible again (`document.visibilityState === 'visible'`)
THEN an immediate refetch fires regardless of where the interval timer is  
AND the 60s interval resets from that point

### GIVEN the component unmounts
THEN the `setInterval` is cleared via the `useEffect` cleanup function  
AND no further fetches occur  
AND no React state updates are attempted after unmount

---

## 6. "Updated Xs ago" Counter

- Provided by `useRelativeTime(lastFetchedAt)` → string, ticking every second.
- `lastFetchedAt === null` → string is `"Never updated"` (only during initial load before first success).
- 0–59 seconds → `"Updated Xs ago"` (e.g., `"Updated 5s ago"`).
- 60–3599 seconds → `"Updated Xm ago"` (e.g., `"Updated 2m ago"`).
- ≥ 3600 seconds → `"Updated 1h+ ago"`.
- The counter itself does NOT trigger data refetches.

---

## 7. Token Filtering

- `DashboardPage` must NOT filter `portfolioItems` before passing to `PortfolioTable`.
- Filtering of zero-balance tokens occurs inside `PortfolioTable` (see `portfolio-table.md §3`).
- This keeps filtering co-located with the component that owns the display contract.

---

## 8. NEGATIVE Cases

### NEGATIVE: portfolio with all zero balances
WHEN the API returns `portfolioItems` that all have `balance === "0"`  
THEN after filtering, `PortfolioTable` shows empty state  
AND `SummaryCards` renders with backend-provided zero values (not computed by frontend)

### NEGATIVE: rapid mount/unmount (e.g., fast navigation away and back)
WHEN the component unmounts before the initial fetch completes  
THEN the in-flight fetch response is ignored (guarded by an `isMounted` ref or AbortController)  
AND no React warning `"Can't perform a state update on an unmounted component"` is thrown

### NEGATIVE: `refetch()` called while a fetch is already in-flight
THEN the second fetch does not fire (or the first is aborted) — no duplicate requests  
Implementation: `usePortfolio` tracks an `isFetching` ref and skips if already in-flight

### NEGATIVE: network goes offline during background polling
THEN `error` is set with the fetch rejection  
AND stale data continues to render (state §4.4)  
AND the next 60s tick will try again

---

## 9. Accessibility

- The page landmark is `<main>`.
- Error messages are rendered in an `aria-live="polite"` region so screen readers announce them.
- `[Retry]` buttons have accessible labels (`aria-label="Retry loading portfolio"`).

---

## 10. File Location

`apps/frontend/src/pages/DashboardPage.tsx`
