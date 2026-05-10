# Archive Report — US-016-on-chain-batched-sync

**Archived**: 2026-05-10
**Status**: archived
**Verification**: PASSED (12/12 requirements)

---

## Verification Summary

All 12 implementation items verified against spec:

| Item | Description | Status |
|------|-------------|--------|
| Signature backward compatible | `opts?: { emit?, signal? }` optional, POST handler works without opts | ✅ |
| SyncRunHelper lifecycle | `start(walletId, 'ON_CHAIN')` → `loadInitial` → `commitSuccess` / `rollback` | ✅ |
| 4 SSE steps | `fetch_normal` → `fetch_tokens` → `classify` → `persist` with running/done events | ✅ |
| checkAborted between all steps | `checkAborted(signal)` called between steps and between batches | ✅ |
| persistBatched with batch size 500 | `ON_CHAIN_PERSIST_BATCH_SIZE = 500`, chunk iteration with slice | ✅ |
| batchProgress events emitted per batch | `{ type: 'batchProgress', done: N, total: M }` after each batch | ✅ |
| persistOneTransaction refactored | No `PoolClient`, receives `runId`, calls `apply(buffer, input)`, includes `sync_run_id` | ✅ |
| SyncOrchestrator lock wired | `tryAcquireLock` / `releaseLock` in SSE route for `ON_CHAIN` wallet | ✅ |
| POST route passes signal | `onChainService.sync(walletId, userId, { signal: ac.signal })` | ✅ |
| SYNC_STEPS_ON_CHAIN and union type | `CexSyncStepName \| OnChainSyncStepName` union in `SyncStepName` | ✅ |
| useSyncStream parametrized by walletType | `initialSteps(walletType)` selects CEX or ON_CHAIN steps | ✅ |
| SyncProgress shows batchProgress | `{batchProgress.done} / {batchProgress.total} txs` during persist step | ✅ |

---

## Artifacts Archived

| File | Description |
|------|-------------|
| `proposal.md` | Intent, scope, approach, risks, non-goals, rollback plan |
| `spec.md` | Delta spec with ADDED/MODIFIED requirements, SSE event contract, domain invariants |
| `design.md` | 5 architecture decisions, sequence diagrams, component specs, error flow table |
| `tasks.md` | 6 tasks (T01–T03 backend, T04–T06 frontend) all marked complete |
| `apply-progress.md` | Full implementation log with decisions taken during apply |

---

## Specs Updated (merged to main)

**`openspec/specs/on-chain-sync/spec.md`** — Updated with:
- SSE streaming with 4 steps (`fetch_normal`, `fetch_tokens`, `classify`, `persist`)
- `SyncRunHelper` lifecycle replacing manual `BEGIN/COMMIT/ROLLBACK`
- `ON_CHAIN_PERSIST_BATCH_SIZE = 500` for batch INSERT during persist step
- `batchProgress` SSE event format (`{ type: 'batchProgress', done, total }`)
- `AbortSignal` support via `checkAborted()` between all steps and batches
- `SyncOrchestrator` lock wired for ON_CHAIN wallets in SSE route
- Frontend union type `SyncStepName` (CEX + on-chain steps)
- `useSyncStream` parametrized by wallet type
- `batchProgress` display in `SyncProgress` component

---

## Warnings

None.

---

## Dependencies

- **US-015** (archived 2026-05-10): SyncOrchestrator, SSE route handler, `useSyncStream` hook, `SyncProgress` component
- **US-018** (done): `sync_runs` table with CASCADE DELETE, `SyncRunHelper`, `PositionStateBuffer`

---

## SDD Cycle Complete

All phases completed:
- ✅ Proposal (intent, scope, approach, risks, rollback plan)
- ✅ Spec (ADDED/MODIFIED requirements, SSE event contract, constants)
- ✅ Design (5 architecture decisions, sequence diagram, component specs, error flow)
- ✅ Tasks (6 tasks T01–T06, all complete)
- ✅ Apply (implementation)
- ✅ Verify (12/12 requirements pass)
- ✅ Archive (this report)

**Change ready for next US.**
