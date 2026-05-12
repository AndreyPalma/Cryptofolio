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

describe("OnChainSyncService first sync (Group C)", () => {
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

  function createService() {
    const alchemyEth = createAlchemyClient({ apiKey: "test-key", network: "ETH", log: silentLog });
    const alchemyBsc = createAlchemyClient({ apiKey: "test-key", network: "BSC", log: silentLog });
    return new OnChainSyncService({
      pool: testPool,
      priceService: createMockPriceService({}),
      onChainClientFactory: (n) => (n === "ETH" ? alchemyEth : alchemyBsc),
    });
  }

  it("C-1: empty wallet returns 0 inserts and cursor advances", async () => {
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
    const service = createService();
    const result = await service.sync(wallet.id, user.id);
    expect(result.synced).toBe(0);
    expect(result.skipped).toBe(0);
    const walletRow = await testPool.query<{ last_synced_block: number }>(
      "SELECT last_synced_block FROM wallets WHERE id = $1",
      [wallet.id],
    );
    expect(walletRow.rows[0]?.last_synced_block).toBeGreaterThanOrEqual(0);
  });

  it("C-2: 1 erc20 inbound creates BUY with MARKET cost and OPEN position", async () => {
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
    const priceKey = `ETH:${token.contractAddress.toLowerCase()}:1744720496`;
    const service = new OnChainSyncService({
      pool: testPool,
      priceService: createMockPriceService({ [priceKey]: { priceUsd: "1.00" } }),
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
              uniqueId: "0xc2:erc20:0",
              hash: "0xc2",
              blockNum: "0x64",
              from: "0xsomeone",
              to: "0xabc123abc123abc123abc123abc123abc123abcd",
              category: "erc20",
              rawContract: {
                address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
                value: "0xf4240",
                decimal: "0x6",
              },
              asset: "USDC",
            }),
          ],
        },
      }),
    });
    const result = await service.sync(wallet.id, user.id);
    expect(result.synced).toBe(1);
    const txRows = await testPool.query(
      "SELECT type, source, price_usd::text, cost_source FROM transactions WHERE wallet_id = $1",
      [wallet.id],
    );
    expect(txRows.rows).toHaveLength(1);
    expect(txRows.rows[0]?.type).toBe("BUY");
    expect(txRows.rows[0]?.source).toBe("ALCHEMY");
    expect(txRows.rows[0]?.price_usd).toBe("1.00");
    expect(txRows.rows[0]?.cost_source).toBe("MARKET");
    const posRows = await testPool.query(
      "SELECT status, balance::text, wac::text FROM positions WHERE wallet_id = $1 AND token_id = $2",
      [wallet.id, token.id],
    );
    expect(posRows.rows).toHaveLength(1);
    expect(posRows.rows[0]?.status).toBe("OPEN");
    expect(posRows.rows[0]?.balance).toBe("1");
    expect(posRows.rows[0]?.wac).toBe("1");
  });

  it("C-3: BUY 100 + SELL 30 leaves OPEN balance=70 and realized_pnl=3", async () => {
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
    const priceKeyBuy = `ETH:${token.contractAddress.toLowerCase()}:${ts}`;
    const priceKeySell = `ETH:${token.contractAddress.toLowerCase()}:${ts + 1}`;
    const service = new OnChainSyncService({
      pool: testPool,
      priceService: createMockPriceService({
        [priceKeyBuy]: { priceUsd: "1.00" },
        [priceKeySell]: { priceUsd: "1.10" },
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
              uniqueId: "0xc3buy:erc20:0",
              hash: "0xc3buy",
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
              uniqueId: "0xc3sell:erc20:0",
              hash: "0xc3sell",
              blockNum: "0x65",
              from: "0xabc123abc123abc123abc123abc123abc123abcd",
              to: "0xsomeone",
              category: "erc20",
              rawContract: {
                address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
                value: "0x1c9c380",
                decimal: "0x6",
              },
              asset: "USDC",
            }),
          ],
        },
      }),
    });
    const result = await service.sync(wallet.id, user.id);
    expect(result.synced).toBe(2);
    const posRows = await testPool.query(
      "SELECT status, balance::text, wac::text, realized_pnl_usd::text FROM positions WHERE wallet_id = $1 AND token_id = $2",
      [wallet.id, token.id],
    );
    expect(posRows.rows[0]?.status).toBe("OPEN");
    expect(posRows.rows[0]?.balance).toBe("70");
    expect(posRows.rows[0]?.wac).toBe("1");
    expect(posRows.rows[0]?.realized_pnl_usd).toBe("3");
  });

  it("C-4: BUY 100 + SELL 100 closes position", async () => {
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
        [`ETH:${token.contractAddress.toLowerCase()}:${ts + 1}`]: { priceUsd: "1.10" },
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
              uniqueId: "0xc4buy:erc20:0",
              hash: "0xc4buy",
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
              uniqueId: "0xc4sell:erc20:0",
              hash: "0xc4sell",
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
          ],
        },
      }),
    });
    const result = await service.sync(wallet.id, user.id);
    expect(result.synced).toBe(2);
    const posRows = await testPool.query(
      "SELECT status, balance::text, realized_pnl_usd::text FROM positions WHERE wallet_id = $1 AND token_id = $2",
      [wallet.id, token.id],
    );
    expect(posRows.rows[0]?.status).toBe("CLOSED");
    expect(posRows.rows[0]?.balance).toBe("0");
  });

  it("C-5: BUY 100 + SELL 100 + BUY 50 creates cycle1 CLOSED and cycle2 OPEN", async () => {
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
        [`ETH:${token.contractAddress.toLowerCase()}:${ts + 1}`]: { priceUsd: "1.10" },
        [`ETH:${token.contractAddress.toLowerCase()}:${ts + 2}`]: { priceUsd: "3.00" },
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
              uniqueId: "0xc5a:erc20:0",
              hash: "0xc5a",
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
              uniqueId: "0xc5b:erc20:0",
              hash: "0xc5b",
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
              uniqueId: "0xc5c:erc20:0",
              hash: "0xc5c",
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
    const result = await service.sync(wallet.id, user.id);
    expect(result.synced).toBe(3);
    const posRows = await testPool.query(
      "SELECT cycle_number, status, balance::text, wac::text FROM positions WHERE wallet_id = $1 AND token_id = $2 ORDER BY cycle_number",
      [wallet.id, token.id],
    );
    expect(posRows.rows).toHaveLength(2);
    expect(posRows.rows[0]?.status).toBe("CLOSED");
    expect(posRows.rows[1]?.status).toBe("OPEN");
    expect(posRows.rows[1]?.wac).toBe("3");
  });

  it("C-6: ETH swap decomposes into SWAP_OUT + SWAP_IN with mutual relatedTxId", async () => {
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
              uniqueId: "0xc6:external:0",
              hash: "0xc6",
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
              uniqueId: "0xc6:erc20:0",
              hash: "0xc6",
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
    const result = await service.sync(wallet.id, user.id);
    expect(result.synced).toBe(2);
    expect(result.swapsDecomposed).toBe(1);
    const txRows = await testPool.query(
      "SELECT type, related_tx_id, tx_log_index FROM transactions WHERE wallet_id = $1 ORDER BY tx_log_index",
      [wallet.id],
    );
    expect(txRows.rows).toHaveLength(2);
    expect(txRows.rows[0]?.type).toBe("SWAP_OUT");
    expect(txRows.rows[1]?.type).toBe("SWAP_IN");
    expect(txRows.rows[0]?.related_tx_id).toBe(txRows.rows[1]?.id);
    expect(txRows.rows[1]?.related_tx_id).toBe(txRows.rows[0]?.id);
  });

  it("C-7: BSC PancakeSwap swap decomposes correctly", async () => {
    const user = await seedUser(testPool);
    const wallet = await seedWallet(testPool, {
      userId: user.id,
      network: "BSC",
      address: "0xabc123abc123abc123abc123abc123abc123abcd",
    });
    const token = await seedToken(testPool, {
      symbol: "USDC",
      network: "BSC",
      contractAddress: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
      decimals: 6,
    });
    const ts = 1744720496;
    const service = new OnChainSyncService({
      pool: testPool,
      priceService: createMockPriceService({
        [`BSC:${token.contractAddress.toLowerCase()}:${ts}`]: { priceUsd: "1.00" },
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
              uniqueId: "0xc7:external:0",
              hash: "0xc7",
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
              uniqueId: "0xc7:erc20:0",
              hash: "0xc7",
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
    const result = await service.sync(wallet.id, user.id);
    expect(result.synced).toBe(2);
    expect(result.swapsDecomposed).toBe(1);
  });

  it("C-8: internal tx refund is TRANSFER_IN and does not crash without methodId", async () => {
    const user = await seedUser(testPool);
    const wallet = await seedWallet(testPool, {
      userId: user.id,
      network: "ETH",
      address: "0xabc123abc123abc123abc123abc123abc123abcd",
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
            makeAlchemyTransfer({
              uniqueId: "0xc8:internal:0",
              hash: "0xc8",
              blockNum: "0x64",
              from: "0xcontract1111111111111111111111111111111111",
              to: "0xabc123abc123abc123abc123abc123abc123abcd",
              category: "internal",
              rawContract: { address: null, value: "0x6f05b59d3b20000", decimal: "0x12" },
              asset: "ETH",
            }),
          ],
        },
      }),
    });
    const result = await service.sync(wallet.id, user.id);
    expect(result.synced).toBe(1);
    const txRows = await testPool.query("SELECT type FROM transactions WHERE wallet_id = $1", [
      wallet.id,
    ]);
    expect(txRows.rows[0]?.type).toBe("TRANSFER_IN");
  });

  it("C-9: TRANSFER_IN from on-chain wallet A inherits WAC", async () => {
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
            makeAlchemyTransfer({
              uniqueId: "0xc9:internal:0",
              hash: "0xc9",
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
    const result = await service.sync(walletB.id, user.id);
    expect(result.synced).toBe(1);
    const txRows = await testPool.query(
      "SELECT cost_source, price_usd::text FROM transactions WHERE wallet_id = $1",
      [walletB.id],
    );
    expect(txRows.rows[0]?.cost_source).toBe("INHERITED");
    expect(txRows.rows[0]?.price_usd).toBe("1500.00");
  });

  it("C-10: TRANSFER_IN matching Binance TRANSFER_OUT tx_hash inherits CEX WAC", async () => {
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
      txHash: "0xbridge001",
      amount: "100",
      priceUsd: "1800",
      costSource: "MARKET",
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
            makeAlchemyTransfer({
              uniqueId: "0xc10:internal:0",
              hash: "0xbridge001",
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
    const result = await service.sync(walletOnChain.id, user.id);
    expect(result.synced).toBe(1);
    expect(result.transfersInheritedFromCEX).toBe(1);
    const txRows = await testPool.query(
      "SELECT cost_source, price_usd::text FROM transactions WHERE wallet_id = $1",
      [walletOnChain.id],
    );
    expect(txRows.rows[0]?.cost_source).toBe("INHERITED");
    expect(txRows.rows[0]?.price_usd).toBe("1800.00");
  });

  it("C-11: TRANSFER_IN from unknown address gets MANUAL costSource", async () => {
    const user = await seedUser(testPool);
    const wallet = await seedWallet(testPool, {
      userId: user.id,
      network: "ETH",
      address: "0xabc123abc123abc123abc123abc123abc123abcd",
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
            makeAlchemyTransfer({
              uniqueId: "0xc11:internal:0",
              hash: "0xc11",
              blockNum: "0x64",
              from: "0xunknown",
              to: "0xabc123abc123abc123abc123abc123abc123abcd",
              category: "internal",
              rawContract: { address: null, value: "0xde0b6b3a7640000", decimal: "0x12" },
              asset: "ETH",
            }),
          ],
        },
      }),
    });
    const result = await service.sync(wallet.id, user.id);
    expect(result.synced).toBe(1);
    expect(result.transfersPendingCost).toBe(1);
    const txRows = await testPool.query(
      "SELECT cost_source, price_usd FROM transactions WHERE wallet_id = $1",
      [wallet.id],
    );
    expect(txRows.rows[0]?.cost_source).toBe("MANUAL");
    expect(txRows.rows[0]?.price_usd).toBeNull();
  });

  it("C-12: 2500 txs across 3 pages insert without duplicates", async () => {
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
    const prices: Record<string, { priceUsd: string }> = {};
    for (let i = 0; i < 2500; i++) {
      prices[`ETH:${token.contractAddress.toLowerCase()}:${ts + i}`] = { priceUsd: "1.00" };
    }
    const service = new OnChainSyncService({
      pool: testPool,
      priceService: createMockPriceService(prices),
      onChainClientFactory: (n) =>
        createAlchemyClient({ apiKey: "test-key", network: n, log: silentLog }),
    });
    let page = 0;
    mockAlchemy({
      requestMatcher: () => true,
      response: () => {
        page++;
        const perPage = 1000;
        const start = (page - 1) * perPage;
        const end = Math.min(start + perPage, 2500);
        const transfers = [];
        for (let i = start; i < end; i++) {
          transfers.push(
            makeAlchemyTransfer({
              uniqueId: `0xc12:erc20:${i}`,
              hash: `0xc12:${i}`,
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
        }
        return createAlchemyResponse({
          jsonrpc: "2.0",
          id: 1,
          result: { transfers, pageKey: page < 3 ? `page${page}` : undefined },
        });
      },
    });
    const result = await service.sync(wallet.id, user.id);
    expect(result.synced).toBe(2500);
    const txCount = await testPool.query(
      "SELECT COUNT(*)::int AS c FROM transactions WHERE wallet_id = $1",
      [wallet.id],
    );
    expect(txCount.rows[0]?.c).toBe(2500);
  });

  it("C-13: 5 BUYs at different prices produce correct WAC", async () => {
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
        [`ETH:${token.contractAddress.toLowerCase()}:${ts + 1}`]: { priceUsd: "2.00" },
        [`ETH:${token.contractAddress.toLowerCase()}:${ts + 2}`]: { priceUsd: "3.00" },
        [`ETH:${token.contractAddress.toLowerCase()}:${ts + 3}`]: { priceUsd: "4.00" },
        [`ETH:${token.contractAddress.toLowerCase()}:${ts + 4}`]: { priceUsd: "5.00" },
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
            {
              ...makeAlchemyTransfer({
                uniqueId: "0:c13",
                hash: "0:c13:0",
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
            },
            {
              ...makeAlchemyTransfer({
                uniqueId: "1:c13",
                hash: "0:c13:1",
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
            },
            {
              ...makeAlchemyTransfer({
                uniqueId: "2:c13",
                hash: "0:c13:2",
                blockNum: "0x66",
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
            },
            {
              ...makeAlchemyTransfer({
                uniqueId: "3:c13",
                hash: "0:c13:3",
                blockNum: "0x67",
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
            },
            {
              ...makeAlchemyTransfer({
                uniqueId: "4:c13",
                hash: "0:c13:4",
                blockNum: "0x68",
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
            },
          ],
        },
      }),
    });
    const result = await service.sync(wallet.id, user.id);
    expect(result.synced).toBe(5);
    const posRows = await testPool.query(
      "SELECT wac::text FROM positions WHERE wallet_id = $1 AND token_id = $2",
      [wallet.id, token.id],
    );
    // WAC = (100*1 + 100*2 + 100*3 + 100*4 + 100*5) / 500 = 3
    expect(posRows.rows[0]?.wac).toBe("3");
  });

  it("C-14: counters reflect exact mix of operations", async () => {
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
              uniqueId: "0:c14",
              hash: "0:c14:0",
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
              uniqueId: "1:c14",
              hash: "0:c14:1",
              blockNum: "0x65",
              from: "0xabc123abc123abc123abc123abc123abc123abcd",
              to: "0xsomeone",
              category: "erc20",
              rawContract: {
                address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
                value: "0x1c9c380",
                decimal: "0x6",
              },
              asset: "USDC",
            }),
            makeAlchemyTransfer({
              uniqueId: "2:c14",
              hash: "0:c14:2",
              blockNum: "0x66",
              from: "0xcontract",
              to: "0xabc123abc123abc123abc123abc123abc123abcd",
              category: "internal",
              rawContract: { address: null, value: "0x6f05b59d3b20000", decimal: "0x12" },
              asset: "ETH",
            }),
          ],
        },
      }),
    });
    const result = await service.sync(wallet.id, user.id);
    expect(result.synced).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.swapsDecomposed).toBe(0);
    expect(result.transfersPendingCost).toBe(1);
    expect(result.transfersInheritedFromCEX).toBe(0);
  });
});
