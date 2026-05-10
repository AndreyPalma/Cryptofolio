# Archive Report — US-013: FIAT_IN/FIAT_OUT + cex_order_id

> Archivado: 2026-05-10
> Status: COMPLETED

## Resumen Ejecutivo

Cambio aditivo puro que extiende el dominio de transacciones para soportar movimientos fiat (compra/venta de crypto con moneda fiat via Binance). Cero breaking changes — todos los 6 tipos existentes funcionan igual que antes.

## Artefactos

| Artefacto | Ubicación |
|-----------|-----------|
| Proposal | `proposal.md` |
| Spec | `spec.md` |
| Design | `design.md` |
| Tasks | `tasks.md` |
| Apply Progress | `apply-progress.md` |

## Archivos implementados

| Archivo | Cambio |
|---------|--------|
| `db/migrations/0005_fiat_types_cex_order_id.sql` | CREADO — ALTER TYPE + columna + índice |
| `db/enums.ts` | MODIFICADO — FIAT_IN/FIAT_OUT en TRANSACTION_TYPES |
| `db/enums.test.ts` | MODIFICADO — drift guard lee todos los migrations/ |
| `apps/backend/src/position-engine/decimal-utils.ts` | MODIFICADO — isInbound/isOutbound extendidos |
| `apps/backend/src/schemas/sync.ts` | MODIFICADO — z.enum extendido |
| `apps/backend/tests/position-engine-fiat.test.ts` | CREADO — 11 tests TDD |

## Quality Gate

- `position-engine-fiat.test.ts`: 11/11 ✅
- `db/enums.test.ts` (drift guard): 35/35 ✅
- `position-engine/engine.test.ts`: 15/15 ✅
- Total: 61/61 tests verdes

## Hallazgos documentados para US-014

- `portfolio.ts#computePnl` no incluye FIAT_IN en el branch inbound — afectaría el cálculo de P&L de transacciones fiat en el portfolio. Fix recomendado en US-014 o como task independiente.

## Specs actualizadas

- `openspec/specs/database-schema/spec.md` — enum values + columna cex_order_id documentados
