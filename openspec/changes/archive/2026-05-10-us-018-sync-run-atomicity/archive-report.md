# Archive Report: us-018-sync-run-atomicity

**Archived on**: 2026-05-10
**Origin**: US-018
**Verdict**: PASS (11/11 requirements verified)
**SDD cycle**: propose → spec → design → tasks → apply → verify → archive

---

## Intent (from proposal)

Introduce atomicidad por run: cada sync se ejecuta como operación "todo o nada". Si falla en cualquier paso, la DB queda exactamente como antes de empezar. Mecanismo: tabla `sync_runs` con FK CASCADE en `transactions.sync_run_id` que permite rollback completo con un solo `DELETE`. Las positions y cursores se escriben sód al final exitoso (escritura diferida).

Adicionalmente, se corrigió el hallazgo de US-013: `computePnl` no cubría `FIAT_IN`/`FIAT_OUT` en las branches inbound/outbound.

## Verification Summary (from verify.md)

| # | Requirement | Status | Evidence |
|---|-------------|--------|----------|
| 1 | `sync_runs` table shape matches dataModel | ✅ PASS | `0006_sync_runs.sql` lines 2-10 |
| 2 | Index `sync_runs_wallet_status_idx` | ✅ PASS | Migration lines 12-13 |
| 3 | `transactions.sync_run_id UUID NULL REFERENCES sync_runs(id) ON DELETE CASCADE` | ✅ PASS | Migration lines 15-16 |
| 4 | Index `transactions_sync_run_id_idx` with WHERE clause | ✅ PASS | Migration lines 18-20 |
| 5 | Down migration drops in correct order | ✅ PASS | Migration lines 23-29 |
| 6 | `SyncRunHelper` class exported with correct API | ✅ PASS | `sync-run-helper.ts`: start(), recordTxsPersisted(), commitSuccess(), rollback() |
| 7 | `start()` inserts running row, returns UUID | ✅ PASS | Lines 27-37 |
| 8 | `commitSuccess()` single DB transaction with auto-rollback | ✅ PASS | Lines 45-119, BEGIN/COMMIT, catch → ROLLBACK + rollback(runId) |
| 9 | `rollback()` DELETE FROM sync_runs, relies on CASCADE | ✅ PASS | Lines 122-125 |
| 10 | `cleanupStaleRuns()` exported, deletes running rows | ✅ PASS | Lines 128-134 |
| 11 | Log 'Cleaned up N stale sync runs' at startup | ✅ PASS | `index.ts` lines 116-121 (isMain block deviation documented) |
| 12 | `position-state-buffer.ts` with loadInitial + apply | ✅ PASS | Exports `loadInitial()` and `apply()`, uses DISTINCT ON with OPEN preference |
| 13 | Position engine NOT modified | ✅ PASS | Only imports from engine |
| 14-22 | Tests for all core behaviors | ✅ PASS | `sync-run-helper.test.ts` |
| 23 | NEGATIVE: FK violation, legacy NULL immune to CASCADE | ✅ PASS | Lines 415, 423 |
| 24 | Quality gates | ✅ PASS | typecheck, lint, test:engine |

## computePnl Fix (US-013 finding)

| Check | Status |
|-------|--------|
| `FIAT_IN` added to inbound branch | ✅ `portfolio.ts` line 171 |
| `FIAT_OUT` falls through to outbound branch (correct) | ✅ Comment at line 184 |
| `computePnl` now exported | ✅ `export function` at line 165 |
| 3 unit tests cover FIAT_IN, FIAT_OUT, regression | ✅ `portfolio-computepnl-fiat.test.ts` |

## Documented Deviation

**cleanupStaleRuns placement**: PRD says "Se llama en `buildServer()`", but implementation places it in the `isMain` block of `index.ts`. Rationale: `buildServer()` is exported for tests; adding pool-dependent cleanup inside it would force all test suites to have a live DB or sync_runs table. The `isMain` block runs before `buildServer()`, so the effect is identical.

## Archive Contents

| Artifact | Status |
|----------|--------|
| proposal.md | ✅ |
| spec.md (delta) | ✅ |
| design.md | ✅ |
| tasks.md | ✅ |
| verify.md (verification report) | ✅ |
| apply-progress.md | ✅ |
| .openspec.yaml (updated: status=archived) | ✅ |

## Archive Location

`openspec/changes/archive/2026-05-10-us-018-sync-run-atomicity/`

## Next

US-014 and US-016 both depend on `SyncRunHelper` (US-018) and `PositionStateBuffer` (US-018). Those changes are already archived. The atomicidad foundation is in place for any future sync work.