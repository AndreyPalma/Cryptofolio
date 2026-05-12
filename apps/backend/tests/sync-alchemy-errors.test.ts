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
  createAlchemyErrorResponse,
} from "./helpers/mock-alchemy.js";
import { testPool, seedUser, seedWallet, seedToken, truncateAllTables } from "./helpers/test-db.js";
import { ApiKeyMissingError, ExternalApiError, NotFoundError } from "../src/services/errors.js";

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

describe("OnChainSyncService errors and edge cases (Group E)", () => {
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

  function makeService(apiKey = "test-key") {
    return new OnChainSyncService({
      pool: testPool,
      priceService: createMockPriceService({}),
      onChainClientFactory: (n) => createAlchemyClient({ apiKey, network: n, log: silentLog }),
    });
  }

  it("E-1: empty ALCHEMY_API_KEY throws ApiKeyMissingError and does not modify DB", async () => {
    const user = await seedUser(testPool);
    const wallet = await seedWallet(testPool, {
      userId: user.id,
      network: "ETH",
      address: "0xabc123abc123abc123abc123abc123abc123abcd",
    });
    const service = makeService("");
    await expect(service.sync(wallet.id, user.id)).rejects.toThrow(ApiKeyMissingError);
    const txCount = await testPool.query(
      "SELECT COUNT(*)::int AS c FROM transactions WHERE wallet_id = $1",
      [wallet.id],
    );
    expect(txCount.rows[0]?.c).toBe(0);
    const cursor = await testPool.query("SELECT * FROM wallet_sync_cursors WHERE wallet_id = $1", [
      wallet.id,
    ]);
    expect(cursor.rows).toHaveLength(0);
  });

  it("E-2: Alchemy 429x4 throws ExternalApiError, rolls back, cursor does not advance", async () => {
    const user = await seedUser(testPool);
    const wallet = await seedWallet(testPool, {
      userId: user.id,
      network: "ETH",
      address: "0xabc123abc123abc123abc123abc123abc123abcd",
    });
    mockAlchemy({
      requestMatcher: () => true,
      response: createAlchemyErrorResponse(429),
    });
    const service = makeService();
    await expect(service.sync(wallet.id, user.id)).rejects.toThrow(ExternalApiError);
    const txCount = await testPool.query(
      "SELECT COUNT(*)::int AS c FROM transactions WHERE wallet_id = $1",
      [wallet.id],
    );
    expect(txCount.rows[0]?.c).toBe(0);
    const cursor = await testPool.query("SELECT * FROM wallet_sync_cursors WHERE wallet_id = $1", [
      wallet.id,
    ]);
    expect(cursor.rows).toHaveLength(0);
    const runs = await testPool.query(
      "SELECT * FROM sync_runs WHERE wallet_id = $1 AND status = 'running'",
      [wallet.id],
    );
    expect(runs.rows).toHaveLength(0);
  });

  it("E-3: Alchemy 200 body.error throws ExternalApiError without retry and rolls back", async () => {
    const user = await seedUser(testPool);
    const wallet = await seedWallet(testPool, {
      userId: user.id,
      network: "ETH",
      address: "0xabc123abc123abc123abc123abc123abc123abcd",
    });
    let callCount = 0;
    mockAlchemy({
      requestMatcher: () => true,
      response: () => {
        callCount++;
        return createAlchemyResponse({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32600, message: "invalid params" },
        });
      },
    });
    const service = makeService();
    await expect(service.sync(wallet.id, user.id)).rejects.toThrow(ExternalApiError);
    expect(callCount).toBe(1);
    const txCount = await testPool.query(
      "SELECT COUNT(*)::int AS c FROM transactions WHERE wallet_id = $1",
      [wallet.id],
    );
    expect(txCount.rows[0]?.c).toBe(0);
  });

  it("E-4: priceUnavailable on BUY skips row (inserted=false) and does not touch transfersPendingCost", async () => {
    const user = await seedUser(testPool);
    const wallet = await seedWallet(testPool, {
      userId: user.id,
      network: "ETH",
      address: "0xabc123abc123abc123abc123abc123abc123abcd",
    });
    await seedToken(testPool, {
      symbol: "USDC",
      contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      decimals: 6,
    });
    const service = new OnChainSyncService({
      pool: testPool,
      priceService: createMockPriceService({}),
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
            {
              uniqueId: "0:e4",
              hash: "0:e4",
              blockNum: "0x64",
              from: "0xsomeone",
              to: "0xabc123abc123abc123abc123abc123abc123abcd",
              value: 1,
              asset: "USDC",
              category: "erc20",
              rawContract: {
                address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
                value: "0x5f5e100",
                decimal: "0x6",
              },
              metadata: { blockTimestamp: "2025-04-15T12:34:56.000Z" },
            },
          ],
        },
      }),
    });
    const result = await service.sync(wallet.id, user.id);
    expect(result.synced).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.transfersPendingCost).toBe(0);
  });

  it("E-5: AbortSignal after first step throws ABORTED and rolls back", async () => {
    const user = await seedUser(testPool);
    const wallet = await seedWallet(testPool, {
      userId: user.id,
      network: "ETH",
      address: "0xabc123abc123abc123abc123abc123abc123abcd",
    });
    const controller = new AbortController();
    mockAlchemy({
      requestMatcher: () => true,
      response: createAlchemyResponse({ jsonrpc: "2.0", id: 1, result: { transfers: [] } }),
    });
    const service = makeService();
    // Abort immediately so it fires after fetch_normal but before fetch_tokens
    controller.abort();
    await expect(service.sync(wallet.id, user.id, { signal: controller.signal })).rejects.toThrow(
      "ABORTED",
    );
    const cursor = await testPool.query("SELECT * FROM wallet_sync_cursors WHERE wallet_id = $1", [
      wallet.id,
    ]);
    expect(cursor.rows).toHaveLength(0);
  });

  it("E-6: sync wallet belonging to another user throws NotFoundError", async () => {
    const userA = await seedUser(testPool);
    const userB = await seedUser(testPool);
    const wallet = await seedWallet(testPool, {
      userId: userA.id,
      network: "ETH",
      address: "0xabc123abc123abc123abc123abc123abc123abcd",
    });
    const service = makeService();
    await expect(service.sync(wallet.id, userB.id)).rejects.toThrow(NotFoundError);
    const txCount = await testPool.query(
      "SELECT COUNT(*)::int AS c FROM transactions WHERE wallet_id = $1",
      [wallet.id],
    );
    expect(txCount.rows[0]?.c).toBe(0);
  });

  it("E-7: wallet with address=null throws invariant violation", async () => {
    const user = await seedUser(testPool);
    const wallet = await seedWallet(testPool, { userId: user.id, network: "ETH", address: null });
    const service = makeService();
    await expect(service.sync(wallet.id, user.id)).rejects.toThrow("invariant violation");
    const txCount = await testPool.query(
      "SELECT COUNT(*)::int AS c FROM transactions WHERE wallet_id = $1",
      [wallet.id],
    );
    expect(txCount.rows[0]?.c).toBe(0);
  });

  it("E-8: CEX wallet throws invariant violation", async () => {
    const user = await seedUser(testPool);
    const wallet = await seedWallet(testPool, {
      userId: user.id,
      walletType: "CEX",
      network: "CEX_BINANCE",
      address: null,
    });
    const service = makeService();
    await expect(service.sync(wallet.id, user.id)).rejects.toThrow("invariant violation");
    const txCount = await testPool.query(
      "SELECT COUNT(*)::int AS c FROM transactions WHERE wallet_id = $1",
      [wallet.id],
    );
    expect(txCount.rows[0]?.c).toBe(0);
  });
});
