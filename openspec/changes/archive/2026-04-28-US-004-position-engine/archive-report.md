# Archive Report — US-004 PositionEngine

**Archivado:** 2026-04-28
**Ciclo SDD:** proposal → spec → design → tasks → apply → verify → archive
**Verdict de verify:** PASS WITH WARNINGS (0 CRITICALs, 4 WARNINGs menores)

## Cambios implementados

- `apps/backend/src/position-engine/types.ts` — interfaces TransactionInput, PositionState, ProcessTransactionInput, PositionEngineResult, WACResult + error classes tipadas (InsufficientBalanceError, InvalidTransactionError, InvalidPositionStateError)
- `apps/backend/src/position-engine/decimal-utils.ts` — config global Decimal (precision=40, ROUND_HALF_EVEN) + helpers toDecimal, roundToStorage, ZERO, isInbound, isOutbound (con type predicates)
- `apps/backend/src/position-engine/engine.ts` — processTransaction + calculateWAC (función pura, sin acceso a DB)
- `apps/backend/src/position-engine/index.ts` — superficie pública del módulo

## Quality gates

- test:engine: 125/125 ✅
- typecheck: sin errores ✅
- lint: sin errores ✅

## Warnings resueltos antes de archivar

- W-001: Eliminado `export { Decimal }` de decimal-utils.ts (Decimal es API interna)
- W-004: Agregado `relatedTxId?: string` a TransactionInput para trazabilidad en US-006/US-008

## Warnings documentados (no bloqueantes)

- W-002: `PositionEngineResult` (impl) vs `EngineResult` (spec shorthand) — naming no afecta contrato
- W-003: `costSource` cambiado a optional en TransactionInput (alineado con spec)

## Decisiones clave

- Motor como función pura: processTransaction({ position, priorClosedCycles, transaction, positionIdentity? }) → PositionEngineResult
- decimal.js con precision=40, ROUND_HALF_EVEN; output truncado a 18 decimales (NUMERIC(38,18))
- PositionRepository (US-006) será quien envuelva el motor con SELECT FOR UPDATE en Postgres
- import { Decimal } named (no default) requerido con module: nodenext ESM

## Stories desbloqueadas

- US-006: PositionRepository + API manual de transacciones (dependía de US-004 ✅)
- US-007: API portfolio y P&L (dependía de US-004 ✅)
