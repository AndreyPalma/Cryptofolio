# Proposal: US-005 — Frontend updates (ApiKeys + SourceBadge + types)

## Intent
Replace legacy Etherscan/BSCScan frontend references with Alchemy as the primary on-chain source, updating types, settings UI, and source badges while keeping legacy literals for the transition period.

## Scope

### In Scope
- Add `alchemy` to `ApiService` union and `ALCHEMY_API_KEY` to `ApiKeysPresence`
- Add `ALCHEMY` to `TransactionSource` enum
- Replace ETHERSCAN/BSCTRACE rows with single ALCHEMY row in `ApiKeysSection`
- Add `alchemy` state and test handler in `useTestApiKey`
- Map `ALCHEMY` in `SourceBadge` with on-chain styling (same as ETHERSCAN)
- Ensure `TokenRow` accepts ALCHEMY via expanded types

### Out of Scope
- Removing legacy `etherscan`/`bsctrace`/`ETHERSCAN`/`BSCTRACE` literals (US-006)
- Backend changes (done in US-004)
- Sync engine migration to Alchemy client (US-007+)

## Capabilities

### New Capabilities
None

### Modified Capabilities
None

## Approach
Additive type expansion and UI row swap. The `useTestApiKey` hook dynamically constructs `/api/credentials/test/${service}`, so adding `alchemy` to the service union automatically enables the test endpoint. `SourceBadge` config is a const record keyed by `TransactionSource`; adding `ALCHEMY` with indigo styling maintains visual parity with other on-chain sources.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `types/settings.ts` | Modified | Add `alchemy` to `API_SERVICES`; add `ALCHEMY_API_KEY` to `ApiKeysPresence` |
| `types/token-detail.ts` | Modified | Add `ALCHEMY` to `TRANSACTION_SOURCE` |
| `components/settings/ApiKeysSection.tsx` | Modified | Replace ETHERSCAN/BSCTRACE rows with ALCHEMY row |
| `hooks/settings/useTestApiKey.ts` | Modified | Add `alchemy` to `initialStates` |
| `components/token-detail/SourceBadge.tsx` | Modified | Add `ALCHEMY` mapping (indigo style) |
| `components/settings/TokenRow.tsx` | Modified | Type-level compatibility via expanded `TransactionSource` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Type errors from exhaustive checks/switches | Low | Update all const arrays and record keys atomically in one commit |
| Backend response mismatch | Low | Backend already returns `ALCHEMY_API_KEY` (US-004) |

## Rollback Plan
Revert the 6 frontend files. No DB or env changes.

## Dependencies
- US-004 backend Alchemy support (complete)

## Success Criteria
- [ ] Settings page shows `ALCHEMY_API_KEY` row with Test button; Binance group unchanged
- [ ] `ALCHEMY_API_KEY` presence reflects backend env state
- [ ] Test button calls `POST /api/credentials/test/alchemy`
- [ ] `SourceBadge` renders "Alchemy" with indigo styling for `ALCHEMY` transactions
- [ ] `npm run typecheck` passes
- [ ] Legacy Etherscan/BSCScan types remain present
