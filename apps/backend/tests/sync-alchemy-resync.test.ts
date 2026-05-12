import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createAlchemyClient } from "../src/sync/clients/alchemy.js";
import { OnChainSyncService } from "../src/services/on-chain-sync.js";
import { createMockPriceService } from "./helpers/mock-price.js";
import {
  setupMockFetch,
  clearMockFetch,
  teardownMockFetch,
  mockAlchemy,
  createAlchemyResponse,
} from "./helpers/mock-alchemy.js";
import { testPool, seedUser, seedWallet, seedToken, truncateAllTables } from "./helpers/test-db.js";

const silentLog = {
  warn: () => {
    /* noop */
  },
  error: () => {
    /* noop */
  },
  info: () => {
    /* noop */
  },
  debug: () => {
    /* noop */
  },
  trace: () => {
    /* noop */
  },
  fatal: () => {
    /* noop */
  },
  child: function () {
    return this;
  },
  level: "silent",
  silent: () => {
    /* noop */
  },
} as unknown as import("fastify").FastifyBaseLogger;

function makeAlchemyTransfer(overrides: {
  uniqueId: string;
  hash: string;
  blockNum: string;
  from: string;
  to: string;
  category: string;
  rawContract: { address: string | null; value: string; decimal: string };
  asset?: string;
}): unknown {
  return {
    uniqueId: overrides.uniqueId,
    hash: overrides.hash,
    blockNum: overrides.blockNum,
    from: overrides.from,
    to: overrides.to,
    value: 1,
    asset: overrides.asset ?? "ETH",
    category: overrides.category,
    rawContract: overrides.rawContract,
    metadata: { blockTimestamp: "2025-04-15T12:34:56.000Z" },
  };
}

describe("OnChainSyncService re-sync and idempotency (Group D)", () => {
  beforeAll(() => {
    setupMockFetch();
  });

  afterAll(() => {
    teardownMockFetch();
  });

  beforeEach(async () => {
    clearMockFetch();
    await truncateAllTables();
  });

  it("D-1: re-sync with same fixture inserts 0 rows and cursor does not retreat", async () => {
    const user = await seedUser(testPool);
    const wallet = await seedWallet(testPool, {
      userId: user.id,
      network: "ETH",
      address: "0xabc123abc123abc123abc123abc123abc123abcd",
    });
    const token = await seedToken(testPool, {
      symbol: "USDC",
      contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      decimals: 6,
    });
    const ts = 1744720496;
    const service = new OnChainSyncService({
      pool: testPool,
      priceService: createMockPriceService({
        [`ETH:${token.contractAddress.toLowerCase()}:${ts}`]: { priceUsd: "1.00" },
      }),
      onChainClientFactory: (n) =>
        createAlchemyClient({ apiKey: "test-key", network: n, log: silentLog }),
    });
    mockAlchemy({
      requestMatcher: () => true,
      response: createAlchemyResponse({
        jsonrpc: "2.0",
        id: 1,
        result: {
          transfers: [
            makeAlchemyTransfer({
              uniqueId: "0:d1",
              hash: "0xd1:0",
              blockNum: "0x64",
              from: "0xsomeone",
              to: "0xabc123abc123abc123abc123abc123abc123abcd",
              category: "erc20",
              rawContract: {
                address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
                value: "0x5f5e100",
                decimal: "0x6",
              },
              asset: "USDC",
            }),
          ],
        },
      }),
    });
    const r1 = await service.sync(wallet.id, user.id);
    expect(r1.synced).toBe(1);
    const cursor1 = await testPool.query(
      "SELECT last_value FROM wallet_sync_cursors WHERE wallet_id = $1 AND operation = $2",
      [wallet.id, "block"],
    );
    const block1 = cursor1.rows[0]?.last_value;
    // re-run with same fixture
    const r2 = await service.sync(wallet.id, user.id);
    expect(r2.synced).toBe(0);
    const cursor2 = await testPool.query(
      "SELECT last_value FROM wallet_sync_cursors WHERE wallet_id = $1 AND operation = $2",
      [wallet.id, "block"],
    );
    expect(cursor2.rows[0]?.last_value).toBe(block1);
  });

  it("D-2: re-sync with 1 new tx inserts exactly 1 row", async () => {
    const user = await seedUser(testPool);
    const wallet = await seedWallet(testPool, {
      userId: user.id,
      network: "ETH",
      address: "0xabc123abc123abc123abc123abc123abc123abcd",
    });
    const token = await seedToken(testPool, {
      symbol: "USDC",
      contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      decimals: 6,
    });
    const ts = 1744720496;
    let callCount = 0;
    const service = new OnChainSyncService({
      pool: testPool,
      priceService: createMockPriceService({
        [`ETH:${token.contractAddress.toLowerCase()}:${ts}`]: { priceUsd: "1.00" },
        [`ETH:${token.contractAddress.toLowerCase()}:${ts + 1}`]: { priceUsd: "1.00" },
      }),
      onChainClientFactory: (n) =>
        createAlchemyClient({ apiKey: "test-key", network: n, log: silentLog }),
    });
    mockAlchemy({
      requestMatcher: () => true,
      response: () => {
        callCount++;
        const transfers =
          callCount === 1
            ? [
                makeAlchemyTransfer({
                  uniqueId: "0:d2",
                  hash: "0:d2:0",
                  blockNum: "0x64",
                  from: "0xsomeone",
                  to: "0xabc123abc123abc123abc123abc123abc123abcd",
                  category: "erc20",
                  rawContract: {
                    address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
                    value: "0x5f5e100",
                    decimal: "0x6",
                  },
                  asset: "USDC",
                }),
              ]
            : [
                makeAlchemyTransfer({
                  uniqueId: "0:d2",
                  hash: "0:d2:0",
                  blockNum: "0x64",
                  from: "0xsomeone",
                  to: "0xabc123abc123abc123abc123abc123abc123abcd",
                  category: "erc20",
                  rawContract: {
                    address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
                    value: "0x5f5e100",
                    decimal: "0x6",
                  },
                  asset: "USDC",
                }),
                makeAlchemyTransfer({
                  uniqueId: "1:d2",
                  hash: "0:d2:1",
                  blockNum: "0x65",
                  from: "0xsomeone",
                  to: "0xabc123abc123abc123abc123abc123abc123abcd",
                  category: "erc20",
                  rawContract: {
                    address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
                    value: "0x5f5e100",
                    decimal: "0x6",
                  },
                  asset: "USDC",
                }),
              ];
        return createAlchemyResponse({ jsonrpc: "2.0", id: 1, result: { transfers } });
      },
    });
    const r1 = await service.sync(wallet.id, user.id);
    expect(r1.synced).toBe(1);
    const r2 = await service.sync(wallet.id, user.id);
    expect(r2.synced).toBe(1);
    const txCount = await testPool.query(
      "SELECT COUNT(*)::int AS c FROM transactions WHERE wallet_id = $1",
      [wallet.id],
    );
    expect(txCount.rows[0]?.c).toBe(2);
  });

  it("D-3: idempotency exact — same 5 txs trigger ON CONFLICT with 0 inserts and no error", async () => {
    const user = await seedUser(testPool);
    const wallet = await seedWallet(testPool, {
      userId: user.id,
      network: "ETH",
      address: "0xabc123abc123abc123abc123abc123abc123abcd",
    });
    const token = await seedToken(testPool, {
      symbol: "USDC",
      contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      decimals: 6,
    });
    const ts = 1744720496;
    const service = new OnChainSyncService({
      pool: testPool,
      priceService: createMockPriceService({
        [`ETH:${token.contractAddress.toLowerCase()}:${ts}`]: { priceUsd: "1.00" },
      }),
      onChainClientFactory: (n) =>
        createAlchemyClient({ apiKey: "test-key", network: n, log: silentLog }),
    });
    const transfers = Array.from({ length: 5 }, (_, i) =>
      makeAlchemyTransfer({
        uniqueId: `0:d3:${i}`,
        hash: `0:d3:${i}`,
        blockNum: `0x${(100 + i).toString(16)}`,
        from: "0xsomeone",
        to: "0xabc123abc123abc123abc123abc123abc123abcd",
        category: "erc20",
        rawContract: {
          address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
          value: "0x1",
          decimal: "0x6",
        },
        asset: "USDC",
      }),
    );
    mockAlchemy({
      requestMatcher: () => true,
      response: createAlchemyResponse({ jsonrpc: "2.0", id: 1, result: { transfers } }),
    });
    const r1 = await service.sync(wallet.id, user.id);
    expect(r1.synced).toBe(5);
    const r2 = await service.sync(wallet.id, user.id);
    expect(r2.synced).toBe(0);
    expect(r2.skipped).toBe(5);
  });

  it("D-4: re-sync with pre-existing swap does not duplicate legs or break relatedTxId", async () => {
    const user = await seedUser(testPool);
    const wallet = await seedWallet(testPool, {
      userId: user.id,
      network: "ETH",
      address: "0xabc123abc123abc123abc123abc123abc123abcd",
    });
    const token = await seedToken(testPool, {
      symbol: "USDC",
      contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      decimals: 6,
    });
    const ts = 1744720496;
    const service = new OnChainSyncService({
      pool: testPool,
      priceService: createMockPriceService({
        [`ETH:${token.contractAddress.toLowerCase()}:${ts}`]: { priceUsd: "1.00" },
      }),
      onChainClientFactory: (n) =>
        createAlchemyClient({ apiKey: "test-key", network: n, log: silentLog }),
    });
    mockAlchemy({
      requestMatcher: (_url, body) => {
        const b = body as { params?: [{ fromAddress?: string }] };
        return !!b.params?.[0]?.fromAddress;
      },
      response: createAlchemyResponse({
        jsonrpc: "2.0",
        id: 1,
        result: {
          transfers: [
            makeAlchemyTransfer({
              uniqueId: "0:d4",
              hash: "0:d4",
              blockNum: "0x64",
              from: "0xabc123abc123abc123abc123abc123abc123abcd",
              to: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
              category: "external",
              rawContract: { address: null, value: "0xde0b6b3a7640000", decimal: "0x12" },
              asset: "ETH",
            }),
          ],
        },
      }),
    });
    mockAlchemy({
      requestMatcher: (_url, body) => {
        const b = body as { params?: [{ toAddress?: string }] };
        return !!b.params?.[0]?.toAddress;
      },
      response: createAlchemyResponse({
        jsonrpc: "2.0",
        id: 1,
        result: {
          transfers: [
            makeAlchemyTransfer({
              uniqueId: "1:d4",
              hash: "0:d4",
              blockNum: "0x64",
              from: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
              to: "0xabc123abc123abc123abc123abc123abc123abcd",
              category: "erc20",
              rawContract: {
                address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
                value: "0x1e8480",
                decimal: "0x6",
              },
              asset: "USDC",
            }),
          ],
        },
      }),
    });
    const r1 = await service.sync(wallet.id, user.id);
    expect(r1.synced).toBe(2);
    const relatedBefore = await testPool.query(
      "SELECT related_tx_id FROM transactions WHERE wallet_id = $1 ORDER BY tx_log_index",
      [wallet.id],
    );
    const r2 = await service.sync(wallet.id, user.id);
    expect(r2.synced).toBe(0);
    const relatedAfter = await testPool.query(
      "SELECT related_tx_id FROM transactions WHERE wallet_id = $1 ORDER BY tx_log_index",
      [wallet.id],
    );
    expect(relatedAfter.rows).toEqual(relatedBefore.rows);
  });

  it("D-5: empty fixture on re-sync keeps cursor monotonic", async () => {
    const user = await seedUser(testPool);
    const wallet = await seedWallet(testPool, {
      userId: user.id,
      network: "ETH",
      address: "0xabc123abc123abc123abc123abc123abc123abcd",
    });
    const token = await seedToken(testPool, {
      symbol: "USDC",
      contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      decimals: 6,
    });
    const ts = 1744720496;
    let callCount = 0;
    const service = new OnChainSyncService({
      pool: testPool,
      priceService: createMockPriceService({
        [`ETH:${token.contractAddress.toLowerCase()}:${ts}`]: { priceUsd: "1.00" },
      }),
      onChainClientFactory: (n) =>
        createAlchemyClient({ apiKey: "test-key", network: n, log: silentLog }),
    });
    mockAlchemy({
      requestMatcher: () => true,
      response: () => {
        callCount++;
        const transfers =
          callCount === 1
            ? [
                makeAlchemyTransfer({
                  uniqueId: "0:d5",
                  hash: "0:d5",
                  blockNum: "0x64",
                  from: "0xsomeone",
                  to: "0xabc123abc123abc123abc123abc123abc123abcd",
                  category: "erc20",
                  rawContract: {
                    address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
                    value: "0x5f5e100",
                    decimal: "0x6",
                  },
                  asset: "USDC",
                }),
              ]
            : [];
        return createAlchemyResponse({ jsonrpc: "2.0", id: 1, result: { transfers } });
      },
    });
    await service.sync(wallet.id, user.id);
    const cursor1 = await testPool.query(
      "SELECT last_value FROM wallet_sync_cursors WHERE wallet_id = $1 AND operation = $2",
      [wallet.id, "block"],
    );
    const block1 = cursor1.rows[0]?.last_value;
    await service.sync(wallet.id, user.id);
    const cursor2 = await testPool.query(
      "SELECT last_value FROM wallet_sync_cursors WHERE wallet_id = $1 AND operation = $2",
      [wallet.id, "block"],
    );
    expect(cursor2.rows[0]?.last_value).toBe(block1);
  });
});
