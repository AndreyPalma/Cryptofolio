import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { createAlchemyClient } from "../src/sync/clients/alchemy.js";
import { ApiKeyMissingError, ExternalApiError } from "../src/services/errors.js";
import {
  setupMockFetch,
  clearMockFetch,
  teardownMockFetch,
  mockAlchemy,
  createAlchemyResponse,
  createAlchemyErrorResponse,
} from "./helpers/mock-alchemy.js";

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

describe("AlchemyClient", () => {
  beforeAll(() => {
    setupMockFetch();
  });

  afterAll(() => {
    teardownMockFetch();
  });

  beforeEach(() => {
    clearMockFetch();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("A-1: construction ETH uses eth-mainnet URL", async () => {
    const client = createAlchemyClient({ apiKey: "test-key", network: "ETH", log: silentLog });
    let urlCalled = "";
    mockAlchemy({
      requestMatcher: (url) => {
        urlCalled = url;
        return true;
      },
      response: createAlchemyResponse({ jsonrpc: "2.0", id: 1, result: { transfers: [] } }),
    });
    await client.fetchNormalTransactions("0xabc", 0, 10);
    expect(urlCalled).toContain("eth-mainnet.g.alchemy.com");
  });

  it("A-2: construction BSC uses bnb-mainnet URL", async () => {
    const client = createAlchemyClient({ apiKey: "test-key", network: "BSC", log: silentLog });
    let urlCalled = "";
    mockAlchemy({
      requestMatcher: (url) => {
        urlCalled = url;
        return true;
      },
      response: createAlchemyResponse({ jsonrpc: "2.0", id: 1, result: { transfers: [] } }),
    });
    await client.fetchNormalTransactions("0xabc", 0, 10);
    expect(urlCalled).toContain("bnb-mainnet.g.alchemy.com");
  });

  it("A-3: assertConfigured with empty apiKey throws ApiKeyMissingError", () => {
    const client = createAlchemyClient({ apiKey: "", network: "ETH", log: silentLog });
    expect(() => client.assertConfigured()).toThrow(ApiKeyMissingError);
    expect(() => client.assertConfigured()).toThrow("ALCHEMY_API_KEY");
  });

  it("A-4: assertConfigured with valid apiKey does not throw", () => {
    const client = createAlchemyClient({ apiKey: "abc", network: "ETH", log: silentLog });
    expect(() => client.assertConfigured()).not.toThrow();
  });

  it("A-5: fetchNormalTransactions makes exactly 2 POSTs with categories external,internal", async () => {
    const client = createAlchemyClient({ apiKey: "test-key", network: "ETH", log: silentLog });
    let callCount = 0;
    const categoriesSeen: string[][] = [];
    mockAlchemy({
      requestMatcher: (_url, body) => {
        callCount++;
        const b = body as { params?: [{ category?: string[] }] };
        categoriesSeen.push(b.params?.[0]?.category ?? []);
        return true;
      },
      response: createAlchemyResponse({ jsonrpc: "2.0", id: 1, result: { transfers: [] } }),
    });
    await client.fetchNormalTransactions("0xabc", 0, 10);
    expect(callCount).toBe(2);
    expect(categoriesSeen).toEqual([
      ["external", "internal"],
      ["external", "internal"],
    ]);
  });

  it("A-6: fetchTokenTransactions makes exactly 2 POSTs with category erc20", async () => {
    const client = createAlchemyClient({ apiKey: "test-key", network: "ETH", log: silentLog });
    let callCount = 0;
    const categoriesSeen: string[][] = [];
    mockAlchemy({
      requestMatcher: (_url, body) => {
        callCount++;
        const b = body as { params?: [{ category?: string[] }] };
        categoriesSeen.push(b.params?.[0]?.category ?? []);
        return true;
      },
      response: createAlchemyResponse({ jsonrpc: "2.0", id: 1, result: { transfers: [] } }),
    });
    await client.fetchTokenTransactions("0xabc", 0, 10);
    expect(callCount).toBe(2);
    expect(categoriesSeen).toEqual([["erc20"], ["erc20"]]);
  });

  it("A-7: self-transfer with same uniqueId is deduped to a single result", async () => {
    const client = createAlchemyClient({ apiKey: "test-key", network: "ETH", log: silentLog });
    const transfer = {
      uniqueId: "0xself:external:0",
      hash: "0xself",
      blockNum: "0x64",
      from: "0xabc123abc123abc123abc123abc123abc123abcd",
      to: "0xabc123abc123abc123abc123abc123abc123abcd",
      value: 1,
      asset: "ETH",
      category: "external",
      rawContract: { address: null, value: "0xde0b6b3a7640000", decimal: "0x12" },
      metadata: { blockTimestamp: "2025-04-15T12:34:56.000Z" },
    };
    mockAlchemy({
      requestMatcher: () => true,
      response: createAlchemyResponse({ jsonrpc: "2.0", id: 1, result: { transfers: [transfer] } }),
    });
    const txs = await client.fetchNormalTransactions(
      "0xabc123abc123abc123abc123abc123abc123abcd",
      0,
      10,
    );
    expect(txs).toHaveLength(1);
  });

  it("A-8: pageKey triggers second request per direction (4 total for 2 pages each)", async () => {
    const client = createAlchemyClient({ apiKey: "test-key", network: "ETH", log: silentLog });
    let callCount = 0;
    mockAlchemy({
      requestMatcher: () => true,
      response: () => {
        callCount++;
        const hasPageKey = callCount % 2 === 1; // 1st and 3rd calls have pageKey
        return createAlchemyResponse({
          jsonrpc: "2.0",
          id: 1,
          result: {
            transfers: [
              {
                uniqueId: `0xpage:${callCount}`,
                hash: `0xpage${callCount}`,
                blockNum: "0x64",
                from: "0xabc123abc123abc123abc123abc123abc123abcd",
                to: "0xdef456def456def456def456def456def456def4",
                value: 1,
                asset: "ETH",
                category: "external",
                rawContract: { address: null, value: "0xde0b6b3a7640000", decimal: "0x12" },
                metadata: { blockTimestamp: "2025-04-15T12:34:56.000Z" },
              },
            ],
            pageKey: hasPageKey ? "next" : undefined,
          },
        });
      },
    });
    const txs = await client.fetchNormalTransactions(
      "0xabc123abc123abc123abc123abc123abc123abcd",
      0,
      10,
    );
    expect(callCount).toBe(4);
    expect(txs).toHaveLength(4);
  });

  it("A-9: uint256 max rawContract.value mapped to exact BigInt string", async () => {
    const client = createAlchemyClient({ apiKey: "test-key", network: "ETH", log: silentLog });
    const transfer = {
      uniqueId: "0xmax:erc20:0",
      hash: "0xmax",
      blockNum: "0x64",
      from: "0xabc",
      to: "0xdef",
      value: 1,
      asset: "TOK",
      category: "erc20",
      rawContract: {
        address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        value: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        decimal: "0x12",
      },
      metadata: { blockTimestamp: "2025-04-15T12:34:56.000Z" },
    };
    mockAlchemy({
      requestMatcher: () => true,
      response: createAlchemyResponse({ jsonrpc: "2.0", id: 1, result: { transfers: [transfer] } }),
    });
    const txs = await client.fetchTokenTransactions("0xabc", 0, 10);
    expect(txs[0]?.value).toBe(
      "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    );
  });

  it("A-10: rawContract.decimal 0x12 mapped to tokenDecimal 18", async () => {
    const client = createAlchemyClient({ apiKey: "test-key", network: "ETH", log: silentLog });
    const transfer = {
      uniqueId: "0xdec:erc20:0",
      hash: "0xdec",
      blockNum: "0x64",
      from: "0xabc",
      to: "0xdef",
      value: 1,
      asset: "TOK",
      category: "erc20",
      rawContract: {
        address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        value: "0x64",
        decimal: "0x12",
      },
      metadata: { blockTimestamp: "2025-04-15T12:34:56.000Z" },
    };
    mockAlchemy({
      requestMatcher: () => true,
      response: createAlchemyResponse({ jsonrpc: "2.0", id: 1, result: { transfers: [transfer] } }),
    });
    const txs = await client.fetchTokenTransactions("0xabc", 0, 10);
    expect(txs[0]?.tokenDecimal).toBe(18);
  });

  it("A-11: metadata.blockTimestamp ISO maps to unix timestamp 1744720496", async () => {
    const client = createAlchemyClient({ apiKey: "test-key", network: "ETH", log: silentLog });
    const transfer = {
      uniqueId: "0xts:external:0",
      hash: "0xts",
      blockNum: "0x64",
      from: "0xabc",
      to: "0xdef",
      value: 1,
      asset: "ETH",
      category: "external",
      rawContract: { address: null, value: "0xde0b6b3a7640000", decimal: "0x12" },
      metadata: { blockTimestamp: "2025-04-15T12:34:56.000Z" },
    };
    mockAlchemy({
      requestMatcher: () => true,
      response: createAlchemyResponse({ jsonrpc: "2.0", id: 1, result: { transfers: [transfer] } }),
    });
    const txs = await client.fetchNormalTransactions("0xabc", 0, 10);
    expect(txs[0]?.timeStamp).toBe(1744720496);
  });

  it("A-12: merged transfers are sorted by blockNumber ascending", async () => {
    const client = createAlchemyClient({ apiKey: "test-key", network: "ETH", log: silentLog });
    const t1 = {
      uniqueId: "0xsort:external:1",
      hash: "0xsort1",
      blockNum: "0x66",
      from: "0xabc",
      to: "0xdef",
      value: 1,
      asset: "ETH",
      category: "external",
      rawContract: { address: null, value: "0xde0b6b3a7640000", decimal: "0x12" },
      metadata: { blockTimestamp: "2025-04-15T12:34:56.000Z" },
    };
    const t2 = {
      uniqueId: "0xsort:external:2",
      hash: "0xsort2",
      blockNum: "0x64",
      from: "0xdef",
      to: "0xabc",
      value: 2,
      asset: "ETH",
      category: "external",
      rawContract: { address: null, value: "0x1bc16d674ec80000", decimal: "0x12" },
      metadata: { blockTimestamp: "2025-04-15T12:34:56.000Z" },
    };
    mockAlchemy({
      requestMatcher: (_url, body) => {
        const b = body as { params?: [{ fromAddress?: string; toAddress?: string }] };
        return !!b.params?.[0]?.fromAddress;
      },
      response: createAlchemyResponse({ jsonrpc: "2.0", id: 1, result: { transfers: [t1] } }),
    });
    mockAlchemy({
      requestMatcher: (_url, body) => {
        const b = body as { params?: [{ fromAddress?: string; toAddress?: string }] };
        return !!b.params?.[0]?.toAddress;
      },
      response: createAlchemyResponse({ jsonrpc: "2.0", id: 1, result: { transfers: [t2] } }),
    });
    const txs = await client.fetchNormalTransactions("0xabc", 0, 10);
    expect(txs.map((t) => t.blockNumber)).toEqual([100, 102]);
  });

  it("A-13: first 429 then 200 returns result after sleep >= 250ms", async () => {
    const client = createAlchemyClient({ apiKey: "test-key", network: "ETH", log: silentLog });
    let callCount = 0;
    mockAlchemy({
      requestMatcher: () => true,
      response: () => {
        callCount++;
        if (callCount === 1) {
          return createAlchemyErrorResponse(429);
        }
        return createAlchemyResponse({ jsonrpc: "2.0", id: 1, result: { transfers: [] } });
      },
    });
    const start = Date.now();
    await client.fetchNormalTransactions("0xabc", 0, 10);
    expect(callCount).toBe(2);
    expect(Date.now() - start).toBeGreaterThanOrEqual(250);
  });

  it("A-14: four consecutive 429s throws ExternalApiError with scrubbed URL", async () => {
    const client = createAlchemyClient({ apiKey: "test-key", network: "ETH", log: silentLog });
    mockAlchemy({
      requestMatcher: () => true,
      response: createAlchemyErrorResponse(429),
    });
    await expect(client.fetchNormalTransactions("0xabc", 0, 10)).rejects.toThrow(ExternalApiError);
    try {
      await client.fetchNormalTransactions("0xabc", 0, 10);
    } catch (err) {
      const e = err as ExternalApiError;
      expect(e.statusCode).toBe(502);
      const cause = e.upstreamCause as { status?: number; url?: string };
      expect(cause?.status).toBe(429);
      expect(cause?.url).toContain("/v2/***");
      expect(cause?.url).not.toContain("test-key");
    }
  });

  it("A-15: HTTP 200 with body.error throws ExternalApiError without retry", async () => {
    const client = createAlchemyClient({ apiKey: "test-key", network: "ETH", log: silentLog });
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
    await expect(client.fetchNormalTransactions("0xabc", 0, 10)).rejects.toThrow(ExternalApiError);
    expect(callCount).toBe(1);
  });

  it("A-16: 429 exhausted logs and cause contain scrubbed URL without key segment", async () => {
    const client = createAlchemyClient({ apiKey: "my-secret-key", network: "ETH", log: silentLog });
    mockAlchemy({
      requestMatcher: () => true,
      response: createAlchemyErrorResponse(429),
    });
    try {
      await client.fetchNormalTransactions("0xabc", 0, 10);
    } catch (err) {
      const e = err as ExternalApiError;
      const cause = e.upstreamCause as { url?: string };
      expect(cause?.url).toMatch(/\/v2\/\*\*\*/);
      expect(cause?.url).not.toContain("my-secret-key");
    }
  });

  it("A-17: fetchNormal body has categories external,internal and fetchToken has erc20", async () => {
    const client = createAlchemyClient({ apiKey: "test-key", network: "ETH", log: silentLog });
    const normalCats: string[][] = [];
    const tokenCats: string[][] = [];
    mockAlchemy({
      requestMatcher: (_url, body) => {
        const b = body as { method?: string; params?: [{ category?: string[] }] };
        if (b.method === "alchemy_getAssetTransfers") {
          const cats = b.params?.[0]?.category ?? [];
          if (cats.includes("external")) normalCats.push(cats);
          if (cats.includes("erc20")) tokenCats.push(cats);
        }
        return true;
      },
      response: createAlchemyResponse({ jsonrpc: "2.0", id: 1, result: { transfers: [] } }),
    });
    await client.fetchNormalTransactions("0xabc", 0, 10);
    await client.fetchTokenTransactions("0xabc", 0, 10);
    expect(normalCats).toEqual([
      ["external", "internal"],
      ["external", "internal"],
    ]);
    expect(tokenCats).toEqual([["erc20"], ["erc20"]]);
  });
});
