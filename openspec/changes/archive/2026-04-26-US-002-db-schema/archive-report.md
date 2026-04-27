# Archive Report: US-002-db-schema

**Archived on**: 2026-04-26
**Verdict**: PASS WITH WARNINGS (4 warnings menores, ningún CRITICAL)
**SDD cycle**: explore → propose → spec → design → tasks → apply (Batch 1 + Batch 2) → verify → archive

---

## Intent (from proposal)

Materializar el schema híbrido **on-chain / CEX** en Postgres (Supabase) con todos los invariantes v5 enforced a nivel DB cuando es posible. Sin este schema, los engines (US-004) y APIs (US-005+) no tienen dónde escribir. La elección de `node-pg-migrate` sobre Prisma (US-001) se hizo precisamente para soportar los **partial unique indexes** que esta story requiere.

## Outcome

- 7 ENUMs + 7 tablas + 5 índices de consulta + 2 partial UNIQUEs (on-chain compuesto y CEX compuesto) + 2 CHECK constraints (wallets, tokens) + UNIQUEs por dominio (positions cycle, wallet_sync_cursors, api_credentials).
- ENUMs SoT en `db/enums.ts` (`as const` arrays) con drift guards (`db/enums.test.ts` vs SQL, `db/backend-drift.test.ts` vs backend types).
- Pool pg singleton (`apps/backend/src/db/pool.ts`).
- Seed real fail-on-existing (`db/seed.ts` — 1 user + 3 wallets + 4 tokens + 1 position + 5 transactions).
- E2E harness con vitest globalSetup + factories + `singleFork: true` (post-discovery de race condition).
- 13 archivos e2e cubriendo cada Requirement del spec + 2 NEGATIVE explícitos del PRD + 1 deferred-skip (US-005).

## Specs Affected

| Capability | Action | Result |
|------------|--------|--------|
| `database-schema` | NEW | Copiado completo desde delta a `openspec/specs/database-schema/spec.md` (12 Requirements). |
| `project-scaffold` | MODIFIED | Requirement "DB placeholders" reemplazado en `openspec/specs/project-scaffold/spec.md` (placeholder stub → migración + seed reales con NEGATIVE de stdout sin "placeholder"). |

## Test Results (final)

| Gate | Resultado |
|------|-----------|
| `npm run typecheck` | ✅ exit 0 (backend + frontend) |
| `npm run lint` | ✅ exit 0 |
| `npm run test:engine` | ✅ 87/87 |
| `npm run test:e2e` | ✅ 33/33 + 1 skip intencional |
| `npm run build` | ✅ dist limpio |

**Total**: 120 tests verdes, 1 skip intencional (placeholder US-005).

## Compliance Summary

- **database-schema**: 25/25 scenarios cubiertos por tests ejecutados.
- **project-scaffold (delta)**: 2/2 scenarios cubiertos comportamentalmente; sub-aserción `stdout NOT contains "placeholder"` cubierta implícitamente (los scripts fueron reemplazados — corren código real).
- **TDD compliance**: 6/6 checks (evidence table presente, todos los tests pasan, triangulación adecuada).

## Warnings carried forward (no bloqueantes)

1. Tautología `expect(true).toBe(true)` dentro de `it.skip` en `negative-single-cex-wallet.test.ts:16` — placeholder explícito para US-005. Sugerencia: convertir a `it.todo`.
2. Sub-aserción `stdout NOT contains "placeholder"` no testeada explícitamente — cubierta implícitamente por reemplazo de los scripts.
3. Coverage tool no configurado — testing capabilities del proyecto no lo incluyen.
4. `db/` workspace ESM puro sin build script — documentar en CLAUDE.md o README si se quiere.

## Sugerencias menores para próximas stories

- `it.todo` en lugar de `it.skip` (semántica más clara en vitest).
- Documentar `singleFork: true` para e2e en CLAUDE.md (la decisión es invisible para un dev nuevo).
- Añadir un `db:reset` script de conveniencia (`down + migrate + seed`).
- Considerar configurar `vitest --coverage` cuando el proyecto crezca.

## Engram Topic Keys

| Phase | Topic Key |
|-------|-----------|
| Proposal | `sdd/us-002-db-schema/proposal` |
| Spec | `sdd/us-002-db-schema/spec` |
| Design | `sdd/us-002-db-schema/design` |
| Tasks | `sdd/us-002-db-schema/tasks` |
| Apply progress | `sdd/us-002-db-schema/apply-progress` |
| Verify report | `sdd/us-002-db-schema/verify-report` |
| Archive report | `sdd/us-002-db-schema/archive-report` (este artifact) |

## Archive Location

`openspec/changes/archive/2026-04-26-US-002-db-schema/`

## Next

US-003 (auth: login + JWT + bcrypt) o lo que el PRD priorice. La DB ya está lista para US-004 (WAC engine) y US-005 (APIs).
