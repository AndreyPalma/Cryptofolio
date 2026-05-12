# Proposal: US-001 — AlchemyClient drop-in implementation

## Intent

Implement a single `AlchemyClient` that satisfies the existing `OnChainApiClient` interface for both ETH and BSC, absorbing all `pageKey` pagination internally so it is a transparent drop-in replacement for `EtherscanClient` and `BSCTraceClient`.

## Scope

### In Scope
- Create `apps/backend/src/sync/clients/alchemy.ts` with `createAlchemyClient(opts): OnChainApiClient`.
- Dual-address paginated fetch (`fromAddress` + `toAddress`) via `alchemy_getAssetTransfers`.
- Merge, dedupe by `uniqueId`, sort, and map to `NormalizedTx[]` / `NormalizedTokenTx[]`.
- Exponential-backoff retry (3 retries on 429/5xx) with jitter + `scrubAlchemyUrl`.
- `assertConfigured()` → `ApiKeyMissingError('ALCHEMY_API_KEY')`.
- Never log or expose the API key in errors.

### Out of Scope
- Wiring the client into `OnChainSyncService` (US-003).
- Adding `ALCHEMY` to enums, DB migrations, or frontend (US-003–US-005).
- Removing `EtherscanClient` / `BSCTraceClient` (US-006).
- Tests (US-007).

## Capabilities

### New Capabilities
- `alchemy-client`: Drop-in `OnChainApiClient` implementation using Alchemy JSON-RPC.

### Modified Capabilities
- None (US-001 is pure client implementation; service wiring happens in US-003).

## Approach

Factory pattern (`createAlchemyClient`) returns a frozen object implementing `OnChainApiClient`. Network (`ETH` | `BSC`) selects the base URL.

`fetchNormalTransactions` and `fetchTokenTransactions` each run **two independent paginated loops** (`fromAddress` and `toAddress`) because Alchemy does not accept a single address filter. Each loop POSTs `alchemy_getAssetTransfers` with `pageKey` continuation until exhausted.

After both loops complete, results are merged, deduplicated by `uniqueId`, sorted by `(blockNumber, appearanceIndex)`, and mapped to the normalized types. Numeric precision is preserved via `BigInt(rawContract.value)` and `parseInt(blockNum, 16)`.

Retry layer wraps `fetch`: HTTP 429 or 5xx triggers up to 3 retries with delays 250 ms → 500 ms → 1000 ms + jitter `[0, 250)` ms. HTTP 200 with JSON-RPC `error` is **not** retried — throws `ExternalApiError` immediately.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/backend/src/sync/clients/alchemy.ts` | New | AlchemyClient factory + retry + mapping |
| `apps/backend/src/sync/clients/on-chain-api.ts` | None | Interface unchanged — drop-in contract |
| `apps/backend/src/services/on-chain-sync.ts` | None | US-001 does not touch service code |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Alchemy plan free-tier CU exhaustion | Low | Single-user usage; monitor after deploy |
| `uniqueId` format changes upstream | Low | Log raw `uniqueId` on parse errors to debug |
| Internal txs (`category: internal`) flood existing wallets on first re-sync | Med | Expected behavior per PRD; no action needed |

## Rollback Plan

Delete `alchemy.ts` and revert any import additions. `EtherscanClient` and `BSCTraceClient` remain untouched in the codebase, so the previous sync path is instantly restorable by switching the factory back in `OnChainSyncService` (US-003).

## Dependencies

- Alchemy API key (`ALCHEMY_API_KEY`) — created in US-002.

## Success Criteria

- [ ] `npm run typecheck` passes.
- [ ] `npm run lint` passes.
- [ ] `createAlchemyClient({ network: 'ETH' }).assertConfigured()` throws `ApiKeyMissingError` when `apiKey` is empty.
- [ ] `fetchNormalTransactions` makes 2 POST calls (from + to), paginates via `pageKey`, merges, dedupes, and returns sorted `NormalizedTx[]`.
- [ ] `fetchTokenTransactions` follows the same pattern with `category: ['erc20']`.
- [ ] Retry logic sleeps ≥ 250 ms on first 429 and gives up on 4th failure with `ExternalApiError('alchemy', ...)`.
- [ ] No API key segment appears in `log.warn`, `log.error`, or `ExternalApiError` cause objects.
