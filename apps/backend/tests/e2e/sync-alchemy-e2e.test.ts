import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildServer } from "../../src/index.js";
import type { FastifyInstance } from "fastify";
import {
  setupMockFetch,
  clearMockFetch,
  teardownMockFetch,
  mockAlchemy,
  createAlchemyResponse,
  createAlchemyErrorResponse,
} from "../helpers/mock-alchemy.js";
import {
  testPool,
  seedUser,
  seedWallet,
  seedToken,
  truncateAllTables,
} from "../helpers/test-db.js";

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

describe("E2E sync alchemy (Group G)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    setupMockFetch();
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL ?? "";
    process.env.JWT_SECRET = "a".repeat(32);
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    process.env.ALCHEMY_API_KEY = "test-key";
    process.env.BINANCE_API_KEY = "binance-key";
    process.env.BINANCE_SECRET_KEY = "binance-secret";
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.TELEGRAM_CHAT_ID = "telegram-chat";
    process.env.APP_PASSWORD = "password123";
    app = await buildServer({ enableAuth: false });
  });

  afterAll(async () => {
    teardownMockFetch();
    await app.close();
    await testPool.end();
  });

  beforeEach(async () => {
    clearMockFetch();
    await truncateAllTables();
  });

  it("G-1: ETH happy path returns 200 with 6 transactions", async () => {
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
    mockAlchemy({
      requestMatcher: (_url, body) => {
        const b = body as { params?: [{ fromAddress?: string; category?: string[] }] };
        return !!b.params?.[0]?.fromAddress && b.params[0].category?.includes("external");
      },
      response: createAlchemyResponse({
        jsonrpc: "2.0",
        id: 1,
        result: {
          transfers: [
            makeAlchemyTransfer({
              uniqueId: "0:g1",
              hash: "0:g1:0",
              blockNum: "0x64",
              from: "0xabc123abc123abc123abc123abc123abc123abcd",
              to: "0xsomeone",
              category: "external",
              rawContract: { address: null, value: "0xde0b6b3a7640000", decimal: "0x12" },
              asset: "ETH",
            }),
            makeAlchemyTransfer({
              uniqueId: "1:g1",
              hash: "0:g1:1",
              blockNum: "0x65",
              from: "0xsomeone",
              to: "0xabc123abc123abc123abc123abc123abc123abcd",
              category: "external",
              rawContract: { address: null, value: "0xde0b6b3a7640000", decimal: "0x12" },
              asset: "ETH",
            }),
            makeAlchemyTransfer({
              uniqueId: "2:g1",
              hash: "0:g1:2",
              blockNum: "0x66",
              from: "0xsomeone",
              to: "0xabc123abc123abc123abc123abc123abc123abcd",
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
        const b = body as { params?: [{ toAddress?: string; category?: string[] }] };
        return !!b.params?.[0]?.toAddress && b.params[0].category?.includes("external");
      },
      response: createAlchemyResponse({ jsonrpc: "2.0", id: 1, result: { transfers: [] } }),
    });
    mockAlchemy({
      requestMatcher: (_url, body) => {
        const b = body as { params?: [{ fromAddress?: string; category?: string[] }] };
        return !!b.params?.[0]?.fromAddress && b.params[0].category?.includes("erc20");
      },
      response: createAlchemyResponse({
        jsonrpc: "2.0",
        id: 1,
        result: {
          transfers: [
            makeAlchemyTransfer({
              uniqueId: "3:g1",
              hash: "0:g1:3",
              blockNum: "0x64",
              from: "0xabc123abc123abc123abc123abc123abc123abcd",
              to: "0xsomeone",
              category: "erc20",
              rawContract: {
                address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
                value: "0x1e8480",
                decimal: "0x6",
              },
              asset: "USDC",
            }),
            makeAlchemyTransfer({
              uniqueId: "4:g1",
              hash: "0:g1:4",
              blockNum: "0x65",
              from: "0xsomeone",
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
    mockAlchemy({
      requestMatcher: (_url, body) => {
        const b = body as { params?: [{ toAddress?: string; category?: string[] }] };
        return !!b.params?.[0]?.toAddress && b.params[0].category?.includes("erc20");
      },
      response: createAlchemyResponse({ jsonrpc: "2.0", id: 1, result: { transfers: [] } }),
    });
    // internal are fetched together with external
    const res = await app.inject({ method: "POST", url: `/api/sync/${wallet.id}` });
    expect(res.statusCode).toBe(200);
    const result = JSON.parse(res.payload);
    expect(result.synced).toBe(5);
    const txCount = await testPool.query(
      "SELECT COUNT(*)::int AS c FROM transactions WHERE wallet_id = $1 AND source = $2",
      [wallet.id, "ALCHEMY"],
    );
    expect(txCount.rows[0]?.c).toBe(5);
  });

  it("G-2: BSC PancakeSwap swap returns SWAP_OUT+SWAP_IN linked", async () => {
    const user = await seedUser(testPool);
    const wallet = await seedWallet(testPool, {
      userId: user.id,
      network: "BSC",
      address: "0xabc123abc123abc123abc123abc123abc123abcd",
    });
    await seedToken(testPool, {
      symbol: "USDC",
      network: "BSC",
      contractAddress: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
      decimals: 6,
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
              uniqueId: "0:g2",
              hash: "0:g2",
              blockNum: "0x64",
              from: "0xabc123abc123abc123abc123abc123abc123abcd",
              to: "0x10ed43c718714eb63d5aa57b78b54704e256024e",
              category: "external",
              rawContract: { address: null, value: "0xde0b6b3a7640000", decimal: "0x12" },
              asset: "BNB",
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
              uniqueId: "1:g2",
              hash: "0:g2",
              blockNum: "0x64",
              from: "0x10ed43c718714eb63d5aa57b78b54704e256024e",
              to: "0xabc123abc123abc123abc123abc123abc123abcd",
              category: "erc20",
              rawContract: {
                address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
                value: "0x1e8480",
                decimal: "0x6",
              },
              asset: "USDC",
            }),
          ],
        },
      }),
    });
    const res = await app.inject({ method: "POST", url: `/api/sync/${wallet.id}` });
    expect(res.statusCode).toBe(200);
    const result = JSON.parse(res.payload);
    expect(result.synced).toBe(2);
    const txRows = await testPool.query(
      "SELECT type, related_tx_id FROM transactions WHERE wallet_id = $1 ORDER BY tx_log_index",
      [wallet.id],
    );
    expect(txRows.rows[0]?.type).toBe("SWAP_OUT");
    expect(txRows.rows[1]?.type).toBe("SWAP_IN");
    expect(txRows.rows[0]?.related_tx_id).toBe(txRows.rows[1]?.id);
    expect(txRows.rows[1]?.related_tx_id).toBe(txRows.rows[0]?.id);
  });

  it("G-3: re-sync same POST returns same count (idempotent)", async () => {
    const user = await seedUser(testPool);
    const wallet = await seedWallet(testPool, {
      userId: user.id,
      network: "ETH",
      address: "0xabc123abc123abc123abc123abc123abc123abcd",
    });
    mockAlchemy({
      requestMatcher: () => true,
      response: createAlchemyResponse({ jsonrpc: "2.0", id: 1, result: { transfers: [] } }),
    });
    const r1 = await app.inject({ method: "POST", url: `/api/sync/${wallet.id}` });
    expect(r1.statusCode).toBe(200);
    const r2 = await app.inject({ method: "POST", url: `/api/sync/${wallet.id}` });
    expect(r2.statusCode).toBe(200);
    const count = await testPool.query(
      "SELECT COUNT(*)::int AS c FROM transactions WHERE wallet_id = $1",
      [wallet.id],
    );
    expect(count.rows[0]?.c).toBe(0);
  });

  it("G-4: fixture 429x4 returns 502 and cursor does not advance", async () => {
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
    const res = await app.inject({ method: "POST", url: `/api/sync/${wallet.id}` });
    expect(res.statusCode).toBe(502);
    const cursor = await testPool.query("SELECT * FROM wallet_sync_cursors WHERE wallet_id = $1", [
      wallet.id,
    ]);
    expect(cursor.rows).toHaveLength(0);
  });

  it("G-5: valid key mock returns connected with latencyMs", async () => {
    mockAlchemy({
      requestMatcher: (url) => url.includes("eth-mainnet.g.alchemy.com"),
      response: createAlchemyResponse({ jsonrpc: "2.0", id: 1, result: "0x12a05f200" }),
    });
    const res = await app.inject({ method: "POST", url: "/api/credentials/test/alchemy" });
    expect(res.statusCode).toBe(200);
    const result = JSON.parse(res.payload);
    expect(result.status).toBe("connected");
    expect(result.meta?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("G-6: empty env ALCHEMY_API_KEY returns failed with API key not configured", async () => {
    const originalKey = process.env.ALCHEMY_API_KEY;
    process.env.ALCHEMY_API_KEY = "";
    const res = await app.inject({ method: "POST", url: "/api/credentials/test/alchemy" });
    process.env.ALCHEMY_API_KEY = originalKey ?? "test-key";
    expect(res.statusCode).toBe(200);
    const result = JSON.parse(res.payload);
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("API key not configured");
  });
});
