# Apply Progress — us-015-sync-orchestrator-sse (Verification Fixes)

## Batch: Verification Fix Pass (2026-05-10)

### Issues Fixed

| ID | Severity | Status |
|----|----------|--------|
| C-001 | CRITICAL | ✅ Fixed |
| W-001 | WARNING | ✅ Fixed |
| W-002 | WARNING | ✅ Fixed |
| W-003 | WARNING | ✅ Fixed |

---

### C-001 — SyncProgress missing `summary` prop and summary block

**Files changed:**
- `apps/frontend/src/components/settings/SyncProgress.tsx`
  - Added `summary: Record<string, unknown> | null` to `SyncProgressProps`
  - Added summary block rendered when `status === 'done' && summary`, showing total transactions
- `apps/frontend/src/components/settings/ExchangeAccountsSection.tsx`
  - Added `summary` to `useSyncStream` destructure
  - Added `summary={summary}` prop to `<SyncProgress />`

---

### W-001 — useSyncStream missing cleanup on unmount

**File changed:** `apps/frontend/src/hooks/settings/useSyncStream.ts`
- Added `useEffect` import
- Added cleanup `useEffect` with empty deps array that closes `esRef.current` on unmount

---

### W-002 — Stale closure in onerror handler

**File changed:** `apps/frontend/src/hooks/settings/useSyncStream.ts`
- Changed `es.onerror` from reading `status` directly (stale closure) to using `setStatus(current => ...)` functional form
- Condition check now always uses the actual current state value, not the captured closure value

---

### W-003 — BinanceSyncService fiat done missing `skipped` field

**File changed:** `apps/backend/src/services/binance-sync.ts`
- Both `done` emits in `syncFiat()` now include `skipped: 0`
- The `skipped` emit changed from `{ code, message }` to `{ reason }` for consistency with SSE contract
