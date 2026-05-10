# Archive Report — US-015-sync-orchestrator-sse

**Archived**: 2026-05-10
**Status**: archived
**Verification**: PASSED WITH WARNINGS (9 items verified)

---

## Verification Summary

All 9 implementation items verified against spec:

| Item | Description | Status |
|------|-------------|--------|
| SyncOrchestrator | `Map<string,AbortController>` lock with tryAcquireLock/releaseLock | ✅ |
| Fastify decorator | `syncOrchestrator` registered via `decorate()` in index.ts | ✅ |
| SSE endpoint | `GET /api/sync/:walletId/stream` with correct headers (text/event-stream, no-cache, keep-alive, X-Accel-Buffering: no) | ✅ |
| Lock shared | POST and SSE share same lock via SyncOrchestrator — 409 on concurrent access | ✅ |
| POST refactor | validateWalletOwnership extracted, lock + emit no-op + releaseLock | ✅ |
| SSE event contract | `running` → `done/skipped` → `error/complete` sequence complete | ✅ |
| useSyncStream hook | EventSource lifecycle, cancel(), retry(), proper cleanup on unmount | ✅ |
| SyncProgress component | State icons (pending/running/done/skipped/error), Cancel/Retry buttons | ✅ |
| ExchangeAccountsSection | CEX wallet shows SyncProgress instead of spinner | ✅ |

---

## Artifacts Archived

| File | Description |
|------|-------------|
| `proposal.md` | Intent, scope, approach, risks, non-goals |
| `spec.md` | Delta spec with ADDED/MODIFIED requirements, SSE event contract |
| `design.md` | Architecture decisions (4 decisions), sequence diagrams, interface specs |
| `tasks.md` | 10 tasks (T-001 to T-010) from sync orchestrator through frontend integration |

---

## Specs Updated (merged to main)

**`openspec/specs/sync-status-management/spec.md`** — Created with:
- Lock concurrency requirement (Map<walletId, AbortController>)
- SyncOrchestrator as Fastify decorator
- SSE endpoint contract (headers, event format, disconnect handling)
- SSE event types: running/done/skipped/error/complete
- useSyncStream hook contract (status, steps, cancel/retry)
- SyncProgress component contract (state icons, buttons, summary)
- POST refactor to use orchestrator with shared lock
- Startup cleanup of orphaned sync_runs

---

## Warnings

### W1: `cancel()` sets status to 'cancelled' outside spec contract
**Severity**: LOW — non-breaking, SyncProgress handles it gracefully

The spec defines `SyncStreamStatus` as `"idle" | "syncing" | "done" | "error"` but `cancel()` in `useSyncStream` sets status to `'cancelled'` before closing the EventSource.

The frontend's `SyncProgress` component only shows buttons based on `status === 'syncing'` (Cancel) or `status === 'error'` (Retry). The `'cancelled'` state falls through without showing any button, which is acceptable UX — the user can simply trigger a new sync.

**Resolution**: No code change needed. Document for next spec review cycle to formally add `'cancelled'` to the status union if desired.

### W2: `cleanupStaleRuns` lives outside `buildServer()` in `isMain` block
**Severity**: LOW — intentional, documented

The spec text says the cleanup runs "al iniciar el servidor (`buildServer()`)" but the implementation places `cleanupStaleRuns` in the `isMain` block before `buildServer()` is called:

```ts
if (isMain) {
  await cleanupStaleRuns(pool);
}
const fastify = await buildServer();
```

This was a deliberate decision for testability — `buildServer()` can be called in tests without triggering the cleanup (which would require a test DB setup). A comment in the code documents this.

**Resolution**: No code change needed. Spec text should be updated to reflect "at server startup (before buildServer)" rather than "inside buildServer()".

---

## Dependencies

- **US-014** (archived 2026-05-10): BinanceSyncService with emit/signal support
- **US-018** (done): sync_runs table, SyncRunHelper, cleanupStaleRuns

---

## SDD Cycle Complete

All phases completed:
- ✅ Proposal (intent, scope, approach)
- ✅ Spec (ADDED/MODIFIED requirements, SSE event contract, hook contract)
- ✅ Design (4 architecture decisions, sequence diagrams, interface specs)
- ✅ Tasks (10 tasks, T-001 through T-010)
- ✅ Apply (implementation)
- ✅ Verify (9 items pass with 2 warnings)
- ✅ Archive (this report)

**Change ready for next US.**