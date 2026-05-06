# Design: US-008-A — On-chain Sync (Etherscan + BSCTrace)

**Story**: US-008-A — Sync on-chain con paginacion y SWAP decomposition
**Date**: 2026-05-05
**Status**: draft
**Reads**: `openspec/changes/US-008-A-onchain-sync/proposal.md`

---

## 1. Directory structure

All paths are relative to project root. New files marked **(new)**, modified files marked **(mod)**.

```
apps/backend/src/
  routes/
    sync.ts                                 (new) Fastify plugin, POST /api/sync/:walletId
  services/
    on-chain-sync.ts                        (new) OnChainSyncService — orchestrator
    errors.ts                               (mod) + ApiKeyMissingError, + ExternalApiError
  sync/
    clients/
      on-chain-api.ts                       (new) OnChainApiClient interface + Normalized*Tx types
      etherscan.ts                          (new) EtherscanClient (REST, chainid=1)
      bsctrace.ts                           (new) BSCTraceClient (JSON-RPC nr_getAssetTransfers)
    constants/
      routers.ts                            (new) SWAP_ROUTERS — per-network address sets
    classify.ts                             (new) groupByTxHash + classifyAndDecomposeTransaction (pure)
    cost-resolver.ts                        (new) resolveTransferCost (DB lookups)
  schemas/
    sync.ts                                 (new) Zod schemas + inferred types for sync
  index.ts                                  (mod) register syncRoutes with prefix '/api/sync'
db/migrations/
  0003_wallet_last_synced_block.sql         (new) ALTER TABLE wallets ADD COLUMN last_synced_block
apps/backend/src/sync/__tests__/            (new) engine-project tests (pure)
  pagination.test.ts
  classify-decompose.test.ts
  bsctrace-normalize.test.ts
apps/backend/tests/
  sync-transfer-cost.test.ts                (new) sync-project test (DB)
  e2e-sync.test.ts                          (new) e2e-project test (DB + http)
```

Rationale for the `sync/` sibling tree under `src/` (not under `services/sync/` as the proposal sketched): it keeps the **pure** code (classify, normalize, clients) in a directory that belongs to the `engine` vitest project (no DB, no Pool import), and leaves `services/on-chain-sync.ts` as the only DB-touching orchestrator. This mirrors the existing split between `position-engine/` (pure) and `services/` (DB).

---

## 2. TypeScript interfaces and types

### 2.1 `apps/backend/src/sync/clients/on-chain-api.ts`

```typescript
// Normalized shape — both Etherscan and BSCTrace adapters emit this.
// All addresses lower-cased on the way out so downstream code never has to
// remember to normalize. Numeric strings (value, blockNumber) preserved as
// strings to avoid losing precision on uint256 amounts.

export type NormalizedTx = {
  readonly txHash: string;
  readonly blockNumber: number;
  readonly transactionIndex: number;  // intra-block ordering for stable sort
  readonly timeStamp: number;          // unix seconds
  readonly from: string;               // lower-cased
  readonly to: string;                 // lower-cased; empty string for contract creation
  readonly value: string;              // wei, decimal string
  readonly isError: '0' | '1';
  readonly gasUsed: string;
  readonly methodId?: string;          // first 4 bytes of input data, lower-cased '0x...'
};

export type NormalizedTokenTx = {
  readonly txHash: string;
  readonly blockNumber: number;
  readonly transactionIndex: number;
  readonly logIndex: number;           // log position within the tx
  readonly timeStamp: number;
  readonly from: string;               // lower-cased
  readonly to: string;                 // lower-cased
  readonly contractAddress: string;    // lower-cased — the ERC20 token contract
  readonly tokenSymbol: string;
  readonly tokenName: string;
  readonly tokenDecimal: number;
  readonly value: string;              // raw, scaled by 10^tokenDecimal
};

export interface OnChainApiClient {
  readonly network: 'ETH' | 'BSC';
  fetchNormalTransactions(
    address: string,
    startBlock: number,
    endBlock: number,
  ): Promise<NormalizedTx[]>;
  fetchTokenTransactions(
    address: string,
    startBlock: number,
    endBlock: number,
  ): Promise<NormalizedTokenTx[]>;
}
```

### 2.2 `apps/backend/src/sync/classify.ts` — types

```typescript
import type { NormalizedTx, NormalizedTokenTx } from './clients/on-chain-api.js';
import type { TransactionType, CostSource, TransactionSource } from '../db/types.js';

/** All raw rows that share a `tx_hash` collected together. */
export type TxGroup = {
  readonly txHash: string;
  readonly blockNumber: number;
  readonly transactionIndex: number;
  readonly timeStamp: number;
  readonly normalTx: NormalizedTx | null;       // present when value > 0 or wallet is from/to
  readonly tokenTxs: readonly NormalizedTokenTx[];
};

/** A row that is ready to be persisted by OnChainSyncService. Pre-classified,
 *  pre-decomposed. tx_log_index 0/1 for swaps, 0 for everything else. */
export type DecomposedTransaction = {
  readonly id: string;                          // uuid pre-generated so swap legs can cross-link
  readonly type: TransactionType;
  readonly txHash: string;
  readonly txLogIndex: number;
  readonly relatedTxId: string | null;
  readonly blockNumber: number;
  readonly transactionIndex: number;
  readonly blockTimestamp: Date;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly tokenContract: string | null;        // null for native ETH/BNB
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  readonly amount: string;                      // human-readable decimal (already de-scaled)
  readonly source: Extract<TransactionSource, 'ETHERSCAN' | 'BSCTRACE'>;
};
```

### 2.3 `apps/backend/src/sync/cost-resolver.ts` — types

```typescript
export type CostResolution =
  | { readonly costSource: 'INHERITED'; readonly priceUsd: string; readonly originPositionId: string }
  | { readonly costSource: 'INHERITED'; readonly priceUsd: string; readonly originCexTransferId: string }
  | { readonly costSource: 'MANUAL';    readonly priceUsd: null };
```

### 2.4 `apps/backend/src/schemas/sync.ts`

```typescript
import { z } from 'zod';

export const SyncParamsSchema = z.object({
  walletId: z.uuid(),
});
export type SyncParams = z.infer<typeof SyncParamsSchema>;

// Slim response — the full Transaction shape lives in types/transaction.ts
const SyncedTxSchema = z.object({
  id: z.uuid(),
  type: z.enum(['BUY', 'SELL', 'SWAP_IN', 'SWAP_OUT', 'TRANSFER_IN', 'TRANSFER_OUT']),
  txHash: z.string(),
  blockTimestamp: z.string(),                  // ISO
  amount: z.string(),
  priceUsd: z.string().nullable(),
  costSource: z.enum(['MARKET', 'INHERITED', 'MANUAL']).nullable(),
});

export const SyncResultSchema = z.object({
  synced: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  swapsDecomposed: z.number().int().nonnegative(),
  transfersPendingCost: z.number().int().nonnegative(),
  transfersInheritedFromCEX: z.number().int().nonnegative(),
  newTransactions: z.array(SyncedTxSchema).max(10),
});
export type SyncResult = z.infer<typeof SyncResultSchema>;
```

### 2.5 `apps/backend/src/services/on-chain-sync.ts` — class shape

```typescript
import type { Pool, PoolClient } from 'pg';
import type { PriceService } from './price.js';
import type { OnChainApiClient, NormalizedTx, NormalizedTokenTx } from '../sync/clients/on-chain-api.js';
import type { DecomposedTransaction } from '../sync/classify.js';
import type { SyncResult } from '../schemas/sync.js';

export interface OnChainSyncDeps {
  readonly pool: Pool;
  readonly priceService: PriceService;
  readonly etherscanClient: OnChainApiClient;
  readonly bsctraceClient: OnChainApiClient;
}

export class OnChainSyncService {
  constructor(private readonly deps: OnChainSyncDeps) {}

  /** Top-level entry point used by the route. */
  sync(walletId: string): Promise<SyncResult>;

  // Internal stages — extracted so tests can hit them in isolation.
  /** Fetch + paginate; merges normal+token results across all pages. */
  private fetchAllRawTransactions(
    client: OnChainApiClient,
    walletAddress: string,
    fromBlock: number,
  ): Promise<{ normalTxs: NormalizedTx[]; tokenTxs: NormalizedTokenTx[] }>;

  /** Re-fetch when batch length === 1000; boundary-overlap handled by ON CONFLICT. */
  private paginateNormal(
    client: OnChainApiClient,
    walletAddress: string,
    fromBlock: number,
  ): Promise<NormalizedTx[]>;

  /** Same shape as paginateNormal but for tokentx. */
  private paginateToken(
    client: OnChainApiClient,
    walletAddress: string,
    fromBlock: number,
  ): Promise<NormalizedTokenTx[]>;

  /** DB lookups for TRANSFER_IN cost resolution (3-step chain). */
  private resolveTransferCost(
    pgc: PoolClient,
    txHash: string,
    fromAddress: string,
    tokenId: string,
  ): Promise<CostResolution>;

  /** UPSERT token row, returns token_id. */
  private ensureToken(
    pgc: PoolClient,
    network: 'ETH' | 'BSC',
    contract: string,
    symbol: string,
    decimals: number,
  ): Promise<string>;

  /** Per-row engine call + INSERT, mirrors TransactionService.createTransaction step 5-11. */
  private persistOneTransaction(
    pgc: PoolClient,
    walletId: string,
    tx: DecomposedTransaction,
    priceUsd: string | null,
    costSource: 'MARKET' | 'INHERITED' | 'MANUAL' | null,
    relatedTxId: string | null,
  ): Promise<{ inserted: boolean }>;
}
```

---

## 3. Key algorithms

### 3.1 `fetchAllRawTransactions` — paginate then return

```typescript
private async paginateNormal(
  client: OnChainApiClient,
  address: string,
  fromBlock: number,
): Promise<NormalizedTx[]> {
  const all: NormalizedTx[] = [];
  let startBlock = fromBlock + 1;        // last_synced_block is inclusive of "already done"
  const endBlock = 99_999_999;
  const PAGE = 1000;

  while (true) {
    const batch = await client.fetchNormalTransactions(address, startBlock, endBlock);
    all.push(...batch);
    if (batch.length < PAGE) break;
    // Re-query starting one block before the last to guarantee we don't miss
    // rows in a block that straddles the page boundary. ON CONFLICT handles dups.
    const lastBlock = batch[batch.length - 1]!.blockNumber;
    startBlock = lastBlock - 1;
  }
  return all;
}

private async fetchAllRawTransactions(
  client: OnChainApiClient,
  address: string,
  fromBlock: number,
): Promise<{ normalTxs: NormalizedTx[]; tokenTxs: NormalizedTokenTx[] }> {
  const [normalTxs, tokenTxs] = await Promise.all([
    this.paginateNormal(client, address, fromBlock),
    this.paginateToken(client, address, fromBlock),
  ]);
  return { normalTxs, tokenTxs };
}
```

The 1000-row sentinel comes from Etherscan's hard cap on `&offset=1000`. BSCTrace's `nr_getAssetTransfers` paginates with `pageKey`; the BSCTrace adapter loops internally and surfaces a single flat array, so for that adapter `paginateNormal` will see one batch with `< 1000` rows on the first iteration. The contract is: **adapter MUST return ≤ 1000 rows per call**, with `length === 1000` meaning "more available".

### 3.2 `groupByTxHash` + `classifyAndDecomposeTransaction` (pure, lives in `sync/classify.ts`)

```typescript
import { SWAP_ROUTERS } from './constants/routers.js';

export function groupByTxHash(
  normalTxs: readonly NormalizedTx[],
  tokenTxs: readonly NormalizedTokenTx[],
): TxGroup[] {
  const map = new Map<string, { normal: NormalizedTx | null; tokens: NormalizedTokenTx[] }>();
  for (const t of normalTxs) {
    map.set(t.txHash, { normal: t, tokens: [] });
  }
  for (const t of tokenTxs) {
    const slot = map.get(t.txHash) ?? { normal: null, tokens: [] };
    slot.tokens.push(t);
    map.set(t.txHash, slot);
  }
  const out: TxGroup[] = [];
  for (const [txHash, { normal, tokens }] of map) {
    out.push({
      txHash,
      blockNumber: normal?.blockNumber ?? tokens[0]!.blockNumber,
      transactionIndex: normal?.transactionIndex ?? tokens[0]!.transactionIndex,
      timeStamp: normal?.timeStamp ?? tokens[0]!.timeStamp,
      normalTx: normal,
      tokenTxs: tokens.sort((a, b) => a.logIndex - b.logIndex),
    });
  }
  return out.sort(
    (a, b) => a.blockNumber - b.blockNumber || a.transactionIndex - b.transactionIndex,
  );
}

export function classifyAndDecomposeTransaction(
  group: TxGroup,
  walletAddress: string,
  network: 'ETH' | 'BSC',
): DecomposedTransaction[] {
  const wallet = walletAddress.toLowerCase();
  const routers = SWAP_ROUTERS[network];
  const source = network === 'ETH' ? 'ETHERSCAN' : 'BSCTRACE';
  const baseTs = new Date(group.timeStamp * 1000);

  // --- SWAP detection -----------------------------------------------------
  // (a) Native -> token via router: normalTx.to is a router address.
  // (b) Token -> token via router: at least one tokenTx has from === router OR to === router.
  // (c) Token -> native via router: normalTx.from is a router (rare, value > 0 to wallet).
  const involvesRouter =
    (group.normalTx && (routers.has(group.normalTx.to) || routers.has(group.normalTx.from))) ||
    group.tokenTxs.some(t => routers.has(t.from) || routers.has(t.to));

  if (involvesRouter) {
    return decomposeSwap(group, wallet, network, source, baseTs);
  }

  // --- Single token transfer (BUY / SELL / TRANSFER_IN / TRANSFER_OUT) ----
  if (group.tokenTxs.length >= 1) {
    return group.tokenTxs.map(tt => decodeTokenLeg(tt, wallet, source, baseTs));
  }

  // --- Native ETH/BNB transfer -------------------------------------------
  // Treated as TRANSFER_IN/OUT when value > 0; ignore zero-value tx (contract calls).
  if (group.normalTx && group.normalTx.value !== '0' && group.normalTx.isError === '0') {
    return [decodeNativeLeg(group.normalTx, wallet, network, source, baseTs)];
  }
  return [];
}
```

`decomposeSwap` invariants:
1. Generate exactly **two** UUIDs upfront — `outId`, `inId`.
2. The OUT leg is the row whose `from === wallet` (token leaving the wallet, including the case where the token is native ETH/BNB and the OUT leg is the `normalTx`).
3. The IN leg is the row whose `to === wallet`.
4. If both legs are token transfers, sort the two by `logIndex` ASC; the lower `logIndex` becomes OUT (`tx_log_index=0`), the higher becomes IN (`tx_log_index=1`). This is consistent with the on-chain emission order — tokens leave before they arrive.
5. Both legs share `tx_hash`, get `tx_log_index ∈ {0,1}` and `related_tx_id` cross-linked.

### 3.3 `resolveTransferCost` — three-step DB lookup

Lives in `sync/cost-resolver.ts` so it's reusable in tests without instantiating the orchestrator.

```typescript
import type { PoolClient } from 'pg';
import type { CostResolution } from './cost-resolver-types.js';

export async function resolveTransferCost(
  pgc: PoolClient,
  txHash: string,
  fromAddress: string,
  tokenId: string,
): Promise<CostResolution> {
  const fromLower = fromAddress.toLowerCase();

  // Step 1 — match on-chain wallet with OPEN position for the same token
  const step1 = await pgc.query<{ position_id: string; wac: string }>(
    `SELECT p.id AS position_id, p.wac
       FROM wallets w
       JOIN positions p ON p.wallet_id = w.id
      WHERE w.wallet_type = 'ON_CHAIN'
        AND lower(w.address) = $1
        AND p.token_id = $2
        AND p.status   = 'OPEN'
      LIMIT 1`,
    [fromLower, tokenId],
  );
  if (step1.rows[0]) {
    return {
      costSource: 'INHERITED',
      priceUsd: step1.rows[0].wac,
      originPositionId: step1.rows[0].position_id,
    };
  }

  // Step 2 — match Binance withdrawal that wrote this txHash on a CEX TRANSFER_OUT
  const step2 = await pgc.query<{ id: string; wac: string }>(
    `SELECT t.id, p.wac
       FROM transactions t
       JOIN positions    p ON p.id = t.position_id
      WHERE t.source = 'BINANCE'
        AND t.type   = 'TRANSFER_OUT'
        AND t.tx_hash = $1
      ORDER BY t.block_timestamp DESC
      LIMIT 1`,
    [txHash.toLowerCase()],
  );
  if (step2.rows[0]) {
    return {
      costSource: 'INHERITED',
      priceUsd: step2.rows[0].wac,
      originCexTransferId: step2.rows[0].id,
    };
  }

  // Step 3 — fallback: user must enter price manually
  return { costSource: 'MANUAL', priceUsd: null };
}
```

Step 1 uses `lower(w.address) = $1` to be case-insensitive — wallets are stored EIP-55 mixed-case for display. Step 2 uses `tx_hash` directly because Binance withdrawals carry the on-chain hash in lower-case (R-6 trade-off).

### 3.4 WAC update flow — chronological per-row PositionEngine call

After fetching, classifying, decomposing, and resolving costs, the orchestrator runs a single SQL transaction:

```typescript
// Pseudocode of OnChainSyncService.sync after pre-processing
async sync(walletId: string): Promise<SyncResult> {
  const wallet = await this.loadWallet(walletId);                    // throws NotFoundError / ValidationError
  if (wallet.wallet_type === 'CEX') throw new ValidationError(...);

  const apiClient = wallet.network === 'ETH' ? this.deps.etherscanClient : this.deps.bsctraceClient;
  this.guardApiKeyPresent(wallet.network);                            // throws ApiKeyMissingError

  // Per-batch commits prevent unbounded transaction size on huge wallets;
  // ON CONFLICT keeps re-runs safe across batch boundaries (proposal §3.6).
  const counters = { synced: 0, skipped: 0, swapsDecomposed: 0,
                     transfersPendingCost: 0, transfersInheritedFromCEX: 0 };
  const newTransactionIds: string[] = [];

  const { normalTxs, tokenTxs } = await this.fetchAllRawTransactions(
    apiClient, wallet.address, wallet.last_synced_block,
  );
  const groups = groupByTxHash(normalTxs, tokenTxs);
  const decomposed: DecomposedTransaction[] = groups.flatMap(g =>
    classifyAndDecomposeTransaction(g, wallet.address, wallet.network),
  );
  // CRITICAL ordering — engine is order-sensitive (WAC depends on prior rows).
  decomposed.sort((a, b) =>
    a.blockNumber - b.blockNumber
    || a.transactionIndex - b.transactionIndex
    || a.txLogIndex - b.txLogIndex,
  );

  const pgc = await this.deps.pool.connect();
  try {
    await pgc.query('BEGIN');

    for (const tx of decomposed) {
      const tokenId = await this.ensureToken(
        pgc, wallet.network, tx.tokenContract ?? NATIVE_PSEUDO_ADDRESS[wallet.network],
        tx.tokenSymbol, tx.tokenDecimals,
      );

      // Resolve price + costSource per type
      let priceUsd: string | null = null;
      let costSource: 'MARKET' | 'INHERITED' | 'MANUAL' | null = null;

      if (tx.type === 'BUY' || tx.type === 'SWAP_IN') {
        const r = await this.deps.priceService.getOnChainPrice(wallet.network, tx.tokenContract!);
        priceUsd  = 'priceUsd' in r ? r.priceUsd : null;
        costSource = 'MARKET';
      } else if (tx.type === 'TRANSFER_IN') {
        const cost = await resolveTransferCost(pgc, tx.txHash, tx.fromAddress, tokenId);
        priceUsd  = cost.priceUsd;
        costSource = cost.costSource;
        if (cost.costSource === 'MANUAL') counters.transfersPendingCost++;
        else if ('originCexTransferId' in cost) counters.transfersInheritedFromCEX++;
      } else if (tx.type === 'SELL' || tx.type === 'SWAP_OUT' || tx.type === 'TRANSFER_OUT') {
        // priceUsd null is acceptable for outbound (engine accepts it for TRANSFER_OUT,
        // and uses live price for SELL/SWAP_OUT realized P&L if available).
        const r = await this.deps.priceService.getOnChainPrice(wallet.network, tx.tokenContract!);
        priceUsd  = 'priceUsd' in r ? r.priceUsd : null;
        costSource = null;
      }

      // Engine call (mirrors TransactionService.createTransaction steps 5-11)
      const { inserted } = await this.persistOneTransaction(
        pgc, walletId, tx, priceUsd, costSource, tx.relatedTxId,
      );
      if (inserted) {
        counters.synced++;
        newTransactionIds.push(tx.id);
        if (tx.type === 'SWAP_OUT') counters.swapsDecomposed++;  // count the pair once
      } else {
        counters.skipped++;
      }
    }

    // Update authoritative cursor + parity row in wallet_sync_cursors
    const lastBlock = decomposed.length > 0
      ? decomposed[decomposed.length - 1]!.blockNumber
      : wallet.last_synced_block;
    await pgc.query(
      `UPDATE wallets SET last_synced_block = $1, last_synced_at = now() WHERE id = $2`,
      [lastBlock, walletId],
    );
    await pgc.query(
      `INSERT INTO wallet_sync_cursors (wallet_id, operation, last_value, last_synced_at)
       VALUES ($1, 'block', $2::text, now())
       ON CONFLICT (wallet_id, operation)
       DO UPDATE SET last_value = EXCLUDED.last_value, last_synced_at = EXCLUDED.last_synced_at`,
      [walletId, String(lastBlock)],
    );

    await pgc.query('COMMIT');
  } catch (err) {
    await pgc.query('ROLLBACK');
    throw err;
  } finally {
    pgc.release();
  }

  return this.buildResult(counters, newTransactionIds);
}
```

`persistOneTransaction` is structurally identical to `TransactionService.createTransaction` steps 5-11:

1. Load OPEN position by `(wallet_id, token_id)` `FOR UPDATE` (no concurrent syncs in V1, but the lock makes this future-proof).
2. Count CLOSED cycles for `(wallet_id, token_id)`.
3. Build `positionIdentity = openPosition === null ? { id: uuid, walletId, tokenId } : undefined`.
4. Call `processTransaction({ position, priorClosedCycles, transaction, positionIdentity })`.
5. UPSERT position with `ON CONFLICT (wallet_id, token_id, cycle_number) DO UPDATE`.
6. INSERT into `transactions` with `ON CONFLICT (tx_hash, tx_log_index) DO NOTHING RETURNING id`.
7. Return `inserted = result.rowCount === 1`.

`NATIVE_PSEUDO_ADDRESS` is `{ ETH: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', BSC: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c' }` (DefiLlama convention for ETH; WBNB for BSC) — used so native value transfers resolve to a token row and have a price.

---

## 4. Error classes

Add to `apps/backend/src/services/errors.ts`:

```typescript
/** 400 — required env-var/credential not configured for the requested operation. */
export class ApiKeyMissingError extends DomainError {
  readonly serviceName: string;
  constructor(serviceName: string) {
    super(
      `API key not configured for service '${serviceName}'`,
      400,
      'API_KEY_MISSING',
    );
    this.name = 'ApiKeyMissingError';
    this.serviceName = serviceName;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 502 — upstream third-party API returned an error / timed out / sent bad JSON. */
export class ExternalApiError extends DomainError {
  readonly serviceName: string;
  readonly cause: unknown;
  constructor(serviceName: string, cause: unknown) {
    super(
      `Upstream service '${serviceName}' failed`,
      502,
      'EXTERNAL_API_ERROR',
    );
    this.name = 'ExternalApiError';
    this.serviceName = serviceName;
    this.cause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
```

`ExternalApiError` MUST NOT log the request URL with the API key in it. The `EtherscanClient` and `BSCTraceClient` build URLs with `URL` object, scrub `apikey` from `searchParams` before passing to `cause`, and pass only `{ status, statusText, body: string|null }` upstream.

The global `setErrorHandler` already reads `statusCode` + `message` + `name`, so both new classes wire up automatically.

---

## 5. Migration SQL — `db/migrations/0003_wallet_last_synced_block.sql`

```sql
-- Up Migration

-- US-008-A — block-cursor for on-chain sync.
-- 0 = "never synced, start from genesis"; sync window is `WHERE block_number > last_synced_block`.
-- Mirrored at runtime into wallet_sync_cursors(operation='block') for parity with the
-- Binance per-operation cursor model (US-008-B), but `wallets.last_synced_block` is
-- the authoritative read (AC-8).

ALTER TABLE wallets
  ADD COLUMN last_synced_block INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN wallets.last_synced_block IS
  'Last on-chain block synced for this wallet. 0 = unsynced. Only meaningful for wallet_type=ON_CHAIN.';


-- Down Migration

ALTER TABLE wallets DROP COLUMN IF EXISTS last_synced_block;
```

Forward-only safe: the column has a default and is nullable=NO, so existing rows get `0` automatically and re-running the sync after the migration sweeps the entire history once.

---

## 6. SWAP router constants — `apps/backend/src/sync/constants/routers.ts`

```typescript
// Mainnet router addresses, lower-cased so set-membership checks are O(1)
// without per-call normalization. The set is intentionally narrow — only routers
// that emit 1 outbound + 1 inbound transfer per swap. Aggregators that fan-out
// across multiple routers (1inch, 0x) are out of scope for V1; they'd appear
// as multi-leg groups and currently fall through to the per-tokenTx path.

export const SWAP_ROUTERS: Readonly<Record<'ETH' | 'BSC', ReadonlySet<string>>> = {
  ETH: new Set<string>([
    '0x7a250d5630b4cf539739df2c5dacb4c659f2488d', // Uniswap V2 Router 02
    '0xe592427a0aece92de3edee1f18e0157c05861564', // Uniswap V3 SwapRouter
    '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', // Uniswap V3 SwapRouter02
    '0x66a9893cc07d91d95644aedd05d03f95e1dba8af', // Uniswap Universal Router (V4 era)
  ]),
  BSC: new Set<string>([
    '0x10ed43c718714eb63d5aa57b78b54704e256024e', // PancakeSwap V2 Router
    '0x13f4ea83d0bd40e75c8222255bc855a974568dd4', // PancakeSwap V3 SmartRouter
    '0x1b81d678ffb9c0263b24a97847620c99d213eb14', // PancakeSwap V3 SmartRouterHelper
  ]),
} as const;
```

Adding aggregators later is a code-edit + deploy (V1 trade-off, R-8 in the proposal).

---

## 7. Route handler — `apps/backend/src/routes/sync.ts`

```typescript
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import pg from 'pg';
import { OnChainSyncService } from '../services/on-chain-sync.js';
import { createPriceService } from '../services/price.js';
import { createEtherscanClient } from '../sync/clients/etherscan.js';
import { createBSCTraceClient } from '../sync/clients/bsctrace.js';
import { ApiKeyMissingError } from '../services/errors.js';
import { SyncParamsSchema, SyncResultSchema } from '../schemas/sync.js';

const { Pool } = pg;

export const syncRoutes: FastifyPluginAsync = async (fastify) => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const priceService = createPriceService(fastify.log);

  // Lazy guard — if the env var is missing we still allow the server to boot;
  // the per-network guard inside the service throws ApiKeyMissingError at sync time.
  const etherscanKey = process.env.ETHERSCAN_API_KEY;
  const bsctraceKey  = process.env.BSCTRACE_API_KEY;

  const etherscanClient = createEtherscanClient({
    apiKey: etherscanKey ?? '',
    log: fastify.log,
  });
  const bsctraceClient = createBSCTraceClient({
    apiKey: bsctraceKey ?? '',
    log: fastify.log,
  });

  const service = new OnChainSyncService({
    pool, priceService, etherscanClient, bsctraceClient,
  });

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/:walletId',
    {
      schema: {
        params: SyncParamsSchema,
        response: { 200: SyncResultSchema },
      },
    },
    async (req) => {
      // The orchestrator owns wallet lookup, network resolution, and api-key check.
      // Throwing ApiKeyMissingError here is reserved for cases the orchestrator can't
      // distinguish (e.g. service was constructed without keys and we can short-circuit).
      const wallet = await service.sync(req.params.walletId);
      return wallet;
    },
  );
};
```

Registered in `index.ts`:

```typescript
const { syncRoutes } = await import('./routes/sync.js');
await fastify.register(syncRoutes, { prefix: '/api/sync' });
```

The global `authPlugin.onRequest` hook covers `/api/sync/*` automatically — no per-route `onRequest` needed.

### 7.1 API-key guard placement

The proposal called for the env-var check in the route. We put the **decision** in the orchestrator (after wallet lookup, so we know which network's key is needed) but the **route-time short-circuit** is still helpful for fast-fail and for tests. Order:

1. `service.sync(walletId)` calls `loadWallet` → 404 if missing.
2. `loadWallet` checks `wallet_type` → `ValidationError` (400) if `CEX`.
3. Service inspects `wallet.network`, picks the matching client, calls `client.assertConfigured()` which throws `ApiKeyMissingError` if its API key is empty string. AC-13 / AC-14 satisfied.

`assertConfigured()` is one method on `OnChainApiClient`:

```typescript
export interface OnChainApiClient {
  readonly network: 'ETH' | 'BSC';
  assertConfigured(): void;                                   // throws ApiKeyMissingError
  fetchNormalTransactions(...): Promise<NormalizedTx[]>;
  fetchTokenTransactions(...): Promise<NormalizedTokenTx[]>;
}
```

This keeps the route plugin un-aware of which env var matters per network — the client knows.

---

## 8. Data-flow summary

```
POST /api/sync/:walletId
        |
        v
+-----------------------------+
| OnChainSyncService.sync     |
|  1. loadWallet (404/400)    |
|  2. assertConfigured (400)  |
|  3. fetchAllRawTransactions |--> EtherscanClient | BSCTraceClient
|  4. groupByTxHash (pure)    |
|  5. classifyAndDecompose    |--> SWAP_ROUTERS, NormalizedTx[]
|  6. sort by block,tix,logix |
|  7. BEGIN                   |
|     for each decomposed tx: |
|       - ensureToken         |
|       - resolveTransferCost |--> step 1 / step 2 / MANUAL
|       - PriceService        |--> DefiLlama (BUY/SWAP_IN/SELL/SWAP_OUT)
|       - PositionEngine.process
|       - UPSERT position     |
|       - INSERT transaction (ON CONFLICT DO NOTHING)
|     UPDATE wallets.last_synced_block
|     UPSERT wallet_sync_cursors[block]
|  8. COMMIT                  |
|  9. build SyncResult        |
+-----------------------------+
```

The `OnChainSyncService` is the only object that holds a Postgres client. `EtherscanClient` / `BSCTraceClient` are pure HTTP. `classify.ts` / `cost-resolver.ts` (the latter receives a `PoolClient` parameter, but the function itself stays stateless) are pure-ish — both DB-free at module level so the `engine` vitest project can import them.

---

## 9. Test boundaries (mirroring proposal §5)

| File | Project | Imports allowed |
|---|---|---|
| `pagination.test.ts` | engine | `OnChainSyncService` with mocked clients; **no Pool**, the test passes a `pgc` stub for `persistOneTransaction` paths |
| `classify-decompose.test.ts` | engine | `classify.ts` + `routers.ts` only |
| `bsctrace-normalize.test.ts` | engine | `bsctrace.ts` + `etherscan.ts` with `fetch` stubbed |
| `sync-transfer-cost.test.ts` | sync | `cost-resolver.ts` + dockerized Pg |
| `e2e-sync.test.ts` | e2e | `buildServer` + dockerized Pg + `nock`/`undici` MockAgent for HTTP |

Engine-project tests exercise pure code only. Anything that touches `pool.query` lives in the `sync` or `e2e` projects — same convention as the existing `position-engine` ↔ `services` split.

---

## 10. Open questions / assumptions promoted from the proposal

- **Q1 (R-2 widening)**: 1inch / 0x aggregator detection — deferred to V2. Aggregator swaps will currently classify as multiple `BUY`/`SELL` rows because the fan-out isn't router-pinned. Acceptable for V1 (single-user, manual review).
- **Q2 (Native swap pricing)**: when a SWAP IN leg is native ETH/BNB, we look up the native pseudo-address in DefiLlama. If DefiLlama returns `priceUnavailable`, the row still inserts with `priceUsd=null` and `cost_source=null` — the engine handles outbound legs without price for `TRANSFER_OUT`, but `SWAP_IN` requires a price. **Decision**: if `SWAP_IN` price is unavailable, treat as `cost_source='MANUAL'` and fall back to `priceUsd=null`, mirroring the `TRANSFER_IN` fallback. The engine's `INBOUND_REQUIRES_PRICE` guard will refuse to open the cycle, so the orchestrator catches `InvalidTransactionError` and increments `transfersPendingCost`. That row is **not inserted** — the user resyncs after price becomes available. Documented as a known V1 limitation.
- **Q3 (BSCTrace pageKey)**: the `BSCTraceClient` adapter normalizes BSCTrace's pageKey-based pagination into a flat `NormalizedTx[]` per call; the orchestrator's pagination loop only sees Etherscan-style 1000-row windows. Verified by `bsctrace-normalize.test.ts` (R-5 mitigation).

---

## 11. Next phase

`sdd-tasks` decomposes this design into a checklist: migration → errors → schemas → routers/clients → classify → cost-resolver → service → route → wiring → tests (engine first, then sync, then e2e).
