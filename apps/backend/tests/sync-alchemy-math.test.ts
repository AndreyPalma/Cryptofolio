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
import {
  testPool,
  seedUser,
  seedWallet,
  seedToken,
  seedPosition,
  seedTransaction,
  truncateAllTables,
} from "./helpers/test-db.js";

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

describe("WAC, cycles, cost-resolver math under source=ALCHEMY (Group F)", () => {
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

  function makeService(prices: Record<string, { priceUsd: string } | { priceUnavailable: true }>) {
    return new OnChainSyncService({
      pool: testPool,
      priceService: createMockPriceService(prices),
      onChainClientFactory: (n) =>
        createAlchemyClient({ apiKey: "test-key", network: n, log: silentLog }),
    });
  }

  it("F-1: BUY 100@$1 + BUY 100@$2 → wac=$1.5", async () => {
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
    const service = makeService({
      [`ETH:${token.contractAddress.toLowerCase()}:${ts}`]: { priceUsd: "1.00" },
      [`ETH:${token.contractAddress.toLowerCase()}:${ts + 1}`]: { priceUsd: "2.00" },
    });
    mockAlchemy({
      requestMatcher: () => true,
      response: createAlchemyResponse({
        jsonrpc: "2.0",
        id: 1,
        result: {
          transfers: [
            makeAlchemyTransfer({
              uniqueId: "0:f1",
              hash: "0:f1:0",
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
              uniqueId: "1:f1",
              hash: "0:f1:1",
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
          ],
        },
      }),
    });
    await service.sync(wallet.id, user.id);
    const pos = await testPool.query(
      "SELECT wac::text FROM positions WHERE wallet_id = $1 AND token_id = $2",
      [wallet.id, token.id],
    );
    expect(pos.rows[0]?.wac).toBe("1.5");
  });

  it("F-2: BUY 100@$1 + SELL 50@$5 → wac=$1, balance=50, realized_pnl=$200", async () => {
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
    const service = makeService({
      [`ETH:${token.contractAddress.toLowerCase()}:${ts}`]: { priceUsd: "1.00" },
      [`ETH:${token.contractAddress.toLowerCase()}:${ts + 1}`]: { priceUsd: "5.00" },
    });
    mockAlchemy({
      requestMatcher: () => true,
      response: createAlchemyResponse({
        jsonrpc: "2.0",
        id: 1,
        result: {
          transfers: [
            makeAlchemyTransfer({
              uniqueId: "0:f2",
              hash: "0:f2:0",
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
              uniqueId: "1:f2",
              hash: "0:f2:1",
              blockNum: "0x65",
              from: "0xabc123abc123abc123abc123abc123abc123abcd",
              to: "0xsomeone",
              category: "erc20",
              rawContract: {
                address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
                value: "0x2faf080",
                decimal: "0x6",
              },
              asset: "USDC",
            }),
          ],
        },
      }),
    });
    await service.sync(wallet.id, user.id);
    const pos = await testPool.query(
      "SELECT status, balance::text, wac::text, realized_pnl_usd::text FROM positions WHERE wallet_id = $1 AND token_id = $2",
      [wallet.id, token.id],
    );
    expect(pos.rows[0]?.status).toBe("OPEN");
    expect(pos.rows[0]?.balance).toBe("50");
    expect(pos.rows[0]?.wac).toBe("1");
    expect(pos.rows[0]?.realized_pnl_usd).toBe("200");
  });

  it("F-3: BUY 100@$1 + SELL 100@$2 + BUY 50@$3 → cycle2 wac=$3", async () => {
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
    const service = makeService({
      [`ETH:${token.contractAddress.toLowerCase()}:${ts}`]: { priceUsd: "1.00" },
      [`ETH:${token.contractAddress.toLowerCase()}:${ts + 1}`]: { priceUsd: "2.00" },
      [`ETH:${token.contractAddress.toLowerCase()}:${ts + 2}`]: { priceUsd: "3.00" },
    });
    mockAlchemy({
      requestMatcher: () => true,
      response: createAlchemyResponse({
        jsonrpc: "2.0",
        id: 1,
        result: {
          transfers: [
            makeAlchemyTransfer({
              uniqueId: "0:f3",
              hash: "0:f3:0",
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
              uniqueId: "1:f3",
              hash: "0:f3:1",
              blockNum: "0x65",
              from: "0xabc123abc123abc123abc123abc123abc123abcd",
              to: "0xsomeone",
              category: "erc20",
              rawContract: {
                address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
                value: "0x5f5e100",
                decimal: "0x6",
              },
              asset: "USDC",
            }),
            makeAlchemyTransfer({
              uniqueId: "2:f3",
              hash: "0:f3:2",
              blockNum: "0x66",
              from: "0xsomeone",
              to: "0xabc123abc123abc123abc123abc123abc123abcd",
              category: "erc20",
              rawContract: {
                address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
                value: "0x2faf080",
                decimal: "0x6",
              },
              asset: "USDC",
            }),
          ],
        },
      }),
    });
    await service.sync(wallet.id, user.id);
    const pos = await testPool.query(
      "SELECT cycle_number, status, wac::text FROM positions WHERE wallet_id = $1 AND token_id = $2 ORDER BY cycle_number",
      [wallet.id, token.id],
    );
    expect(pos.rows).toHaveLength(2);
    expect(pos.rows[0]?.status).toBe("CLOSED");
    expect(pos.rows[1]?.status).toBe("OPEN");
    expect(pos.rows[1]?.wac).toBe("3");
  });

  it("F-4: SWAP_IN updates WAC of token_in at swap market price", async () => {
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
    const service = makeService({
      [`ETH:${token.contractAddress.toLowerCase()}:${ts}`]: { priceUsd: "1.00" },
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
              uniqueId: "0:f4",
              hash: "0:f4",
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
              uniqueId: "1:f4",
              hash: "0xf4",
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
    await service.sync(wallet.id, user.id);
    const pos = await testPool.query(
      "SELECT wac::text FROM positions WHERE wallet_id = $1 AND token_id = $2",
      [wallet.id, token.id],
    );
    expect(pos.rows[0]?.wac).toBe("1");
  });

  it("F-5: SWAP_OUT does not change WAC of token_out but updates realized_pnl", async () => {
    const user = await seedUser(testPool);
    const wallet = await seedWallet(testPool, {
      userId: user.id,
      network: "ETH",
      address: "0xabc123abc123abc123abc123abc123abc123abcd",
    });
    const token = await seedToken(testPool, {
      symbol: "ETH",
      contractAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      decimals: 18,
    });
    await seedPosition(testPool, {
      walletId: wallet.id,
      tokenId: token.id,
      status: "OPEN",
      balance: "100",
      wac: "2000",
    });
    const ts = 1744720496;
    const service = makeService({
      [`ETH:${token.contractAddress.toLowerCase()}:${ts}`]: { priceUsd: "2500" },
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
              uniqueId: "0:f5",
              hash: "0:f5",
              blockNum: "0x64",
              from: "0xabc123abc123abc123abc123abc123abc123abcd",
              to: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
              category: "external",
              rawContract: { address: null, value: "0x56bc75e2d63100000", decimal: "0x12" },
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
      response: createAlchemyResponse({ jsonrpc: "2.0", id: 1, result: { transfers: [] } }),
    });
    await service.sync(wallet.id, user.id);
    const pos = await testPool.query(
      "SELECT balance::text, wac::text, realized_pnl_usd::text FROM positions WHERE wallet_id = $1 AND token_id = $2",
      [wallet.id, token.id],
    );
    expect(pos.rows[0]?.balance).toBe("0");
    expect(pos.rows[0]?.wac).toBe("2000");
    expect(pos.rows[0]?.realized_pnl_usd).toBe("50000");
  });

  it("F-6: TRANSFER_IN from wallet A inherits WAC $1500", async () => {
    const user = await seedUser(testPool);
    const walletA = await seedWallet(testPool, {
      userId: user.id,
      network: "ETH",
      address: "0xaaa123aaa123aaa123aaa123aaa123aaa123aaaa",
    });
    const walletB = await seedWallet(testPool, {
      userId: user.id,
      network: "ETH",
      address: "0xbbb123bbb123bbb123bbb123bbb123bbb123bbbb",
    });
    const token = await seedToken(testPool, {
      symbol: "USDC",
      contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      decimals: 6,
    });
    await seedPosition(testPool, {
      walletId: walletA.id,
      tokenId: token.id,
      status: "OPEN",
      balance: "100",
      wac: "1500",
    });
    const service = makeService({});
    mockAlchemy({
      requestMatcher: () => true,
      response: createAlchemyResponse({
        jsonrpc: "2.0",
        id: 1,
        result: {
          transfers: [
            makeAlchemyTransfer({
              uniqueId: "0:f6",
              hash: "0xf6",
              blockNum: "0x64",
              from: "0xaaa123aaa123aaa123aaa123aaa123aaa123aaaa",
              to: "0xbbb123bbb123bbb123bbb123bbb123bbb123bbbb",
              category: "internal",
              rawContract: { address: null, value: "0xde0b6b3a7640000", decimal: "0x12" },
              asset: "ETH",
            }),
          ],
        },
      }),
    });
    await service.sync(walletB.id, user.id);
    const pos = await testPool.query(
      "SELECT wac::text FROM positions WHERE wallet_id = $1 AND token_id = $2",
      [walletB.id, token.id],
    );
    expect(pos.rows[0]?.wac).toBe("1500.00");
  });

  it("F-7: TRANSFER_IN matching Binance tx_hash inherits WAC $1800", async () => {
    const user = await seedUser(testPool);
    const walletCex = await seedWallet(testPool, {
      userId: user.id,
      walletType: "CEX",
      network: "CEX_BINANCE",
      address: null,
    });
    const walletOnChain = await seedWallet(testPool, {
      userId: user.id,
      network: "ETH",
      address: "0xbbb123bbb123bbb123bbb123bbb123bbb123bbbb",
    });
    const token = await seedToken(testPool, {
      symbol: "USDC",
      contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      decimals: 6,
    });
    const pos = await seedPosition(testPool, {
      walletId: walletCex.id,
      tokenId: token.id,
      status: "OPEN",
      balance: "100",
      wac: "1800",
    });
    await seedTransaction(testPool, {
      walletId: walletCex.id,
      tokenId: token.id,
      positionId: pos.id,
      type: "TRANSFER_OUT",
      source: "BINANCE",
      txHash: "0xbridgef7",
      amount: "100",
      priceUsd: "1800",
      costSource: "MARKET",
    });
    const service = makeService({});
    mockAlchemy({
      requestMatcher: () => true,
      response: createAlchemyResponse({
        jsonrpc: "2.0",
        id: 1,
        result: {
          transfers: [
            makeAlchemyTransfer({
              uniqueId: "0:f7",
              hash: "0xbridgef7",
              blockNum: "0x64",
              from: "0xbinancehotwallet",
              to: "0xbbb123bbb123bbb123bbb123bbb123bbb123bbbb",
              category: "internal",
              rawContract: { address: null, value: "0xde0b6b3a7640000", decimal: "0x12" },
              asset: "ETH",
            }),
          ],
        },
      }),
    });
    await service.sync(walletOnChain.id, user.id);
    const txRows = await testPool.query(
      "SELECT price_usd::text FROM transactions WHERE wallet_id = $1",
      [walletOnChain.id],
    );
    expect(txRows.rows[0]?.price_usd).toBe("1800.00");
  });
});
