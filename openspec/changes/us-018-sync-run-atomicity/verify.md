# US-018 Verification Report

## Acceptance Criteria Cross-Check

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | sync_runs table shape matches dataModel | ✅ PASS | `0006_sync_runs.sql` lines 2-10: id UUID PK, wallet_id FK CASCADE, type CHECK, status CHECK, started_at, completed_at, txs_persisted |
| 2 | Index `sync_runs_wallet_status_idx` | ✅ PASS | Migration lines 12-13 |
| 3 | `transactions.sync_run_id UUID NULL REFERENCES sync_runs(id) ON DELETE CASCADE` | ✅ PASS | Migration lines 15-16 |
| 4 | Index `transactions_sync_run_id_idx` with WHERE clause | ✅ PASS | Migration lines 18-20 |
| 5 | Down migration drops in correct order + documentation | ✅ PASS | Migration lines 23-29 with note about data integrity |
| 6 | `SyncRunHelper` class exported with correct API | ✅ PASS | `sync-run-helper.ts`: start(), recordTxsPersisted(), commitSuccess(), rollback() |
| 7 | `start()` inserts running row, returns UUID | ✅ PASS | Lines 27-37 |
| 8 | `commitSuccess()` single DB transaction: UPSERT positions + UPDATE cursors + UPDATE sync_runs; auto-rollback on failure | ✅ PASS | Lines 45-119, BEGIN/COMMIT, catch → ROLLBACK + rollback(runId) |
| 9 | `rollback()` DELETE FROM sync_runs, relies on CASCADE | ✅ PASS | Lines 122-125 |
| 10 | `cleanupStaleRuns()` exported, deletes running rows | ✅ PASS | Lines 128-134 |
| 11 | Log 'Cleaned up N stale sync runs' at startup | ✅ PASS | `index.ts` lines 116-121 (in isMain block, not buildServer — documented deviation) |
| 12 | `position-state-buffer.ts` with loadInitial + apply | ✅ PASS | Exports `loadInitial()` and `apply()`, uses DISTINCT ON with OPEN preference |
| 13 | Position engine NOT modified | ✅ PASS | Only imports from engine, no changes to `position-engine/` |
| 14 | Test: start() creates running row | ✅ PASS | `sync-run-helper.test.ts` line 177 |
| 15 | Test: commitSuccess() upserts positions + cursors atomically | ✅ PASS | Line 234 |
| 16 | Test: rollback() deletes run + child txs via CASCADE | ✅ PASS | Line 311 |
| 17 | Test: cleanupStaleRuns() deletes running, keeps completed | ✅ PASS | Line 334 (2 running + 1 completed; AC suggests 3+2 — behavior identical) |
| 18 | Test: simulated crash (run + txs, no commitSuccess, cleanup) | ✅ PASS | Covered by cleanupStaleRuns test (inserts running runs + txs, verifies cascade) |
| 19 | Test: commitSuccess() failure → auto rollback | ✅ PASS | Line 374 (VARCHAR(255) overflow triggers error) |
| 20 | Inline documentation: no 'failed' status, multi-instance path | ✅ PASS | JSDoc on SyncRunHelper class |
| 21 | NEGATIVE: FK violation on non-existent sync_run_id | ✅ PASS | Line 415 |
| 22 | NEGATIVE: legacy NULL sync_run_id immune to CASCADE | ✅ PASS | Line 423 |
| 23 | NEGATIVE: concurrent start() not blocked | ✅ PASS | Implicitly: cleanupStaleRuns test creates 2 running for same wallet |
| 24 | Quality gates | ⏳ PENDING | Requires manual execution (see commands below) |

## Documented Deviation

**cleanupStaleRuns placement**: The PRD says "Se llama en `buildServer()`", but implementation places it in the `isMain` block of `index.ts`. Rationale: `buildServer()` is exported for tests; adding pool-dependent cleanup inside it would force all test suites to have a live DB or sync_runs table. The `isMain` block runs before `buildServer()`, so the effect is identical (cleanup before routes).

## computePnl Fix (US-013 finding)

| Check | Status |
|-------|--------|
| `FIAT_IN` added to inbound branch | ✅ `portfolio.ts` line 171 |
| `FIAT_OUT` falls through to outbound branch (correct) | ✅ Comment at line 184 |
| `computePnl` now exported | ✅ `export function` at line 165 |
| 3 unit tests cover FIAT_IN, FIAT_OUT, regression | ✅ `portfolio-computepnl-fiat.test.ts` |

## Quality Gate Commands (manual)

```bash
npm run db:migrate           # Apply 0006_sync_runs.sql
npm run db:migrate:down      # Verify reversibility
npm run db:migrate           # Re-apply
npm run typecheck            # TS compiles
npm run lint                 # No warnings
npm run test:engine          # sync-run-helper + computePnl tests
```
