# Apply Progress — us-018-sync-run-atomicity

> Generado: 2026-05-10
> Actualizado: 2026-05-10
> Batch: 1 (T01–T07)

## Estado de tareas

| Tarea | Archivo | Estado |
|-------|---------|--------|
| T01 | `apps/backend/src/services/__tests__/sync-run-helper.test.ts` | ✅ Completada |
| T02 | `apps/backend/tests/portfolio-computepnl-fiat.test.ts` | ✅ Completada |
| T03 | `db/migrations/0006_sync_runs.sql` | ✅ Completada |
| T04 | `apps/backend/src/services/sync-run-helper.ts` + `position-state-buffer.ts` | ✅ Completada |
| T05 | `apps/backend/src/services/portfolio.ts` | ✅ Completada |
| T06 | `apps/backend/src/index.ts` | ✅ Completada |
| T07 | — (quality gate) | ⏳ Pendiente: ejecutar manualmente |

## Detalles

### T01 — sync-run-helper.test.ts
8 test cases con DB real (skipIf sin DATABASE_URL_TEST): start(), accumulate+commit,
commitSuccess atomicidad, rollback CASCADE, cleanupStaleRuns, NEGATIVE auto-rollback,
NEGATIVE FK violation, NEGATIVE legacy immunity.

### T02 — portfolio-computepnl-fiat.test.ts
3 tests unitarios: FIAT_IN→INBOUND, FIAT_OUT→OUTBOUND, regresión BUY/SELL.

### T03 — 0006_sync_runs.sql
sync_runs tabla + índice + transactions.sync_run_id FK CASCADE + índice parcial. Down completo.

### T04 — sync-run-helper.ts + position-state-buffer.ts
SyncRunHelper: start/recordTxsPersisted/commitSuccess/rollback. PositionStateBuffer: loadInitial/apply.

### T05 — portfolio.ts
FIAT_IN en branch inbound, FIAT_OUT documentado en outbound, computePnl exportada.

### T06 — index.ts
cleanupStaleRuns integrado en bloque isMain después de pool init.

## Quality Gate T07 — pendiente ejecución manual

```bash
npm run db:migrate
npm run db:migrate:down
npm run db:migrate
npm run typecheck
npm run lint
npm run test:engine
```
