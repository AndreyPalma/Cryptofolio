import { describe, expect, it, beforeEach } from "vitest";
import { pool, resetDb, createUser, createOnChainWallet, createToken } from "./factories";

const testUrl = process.env.DATABASE_URL_TEST;

const TX_HASH = "0xabc1230000000000000000000000000000000000000000000000000000000001";
const NOW = "2026-04-26T00:00:00.000Z";

describe.skipIf(!testUrl)("transactions on-chain — partial UNIQUE (tx_hash, tx_log_index)", () => {
  let walletId: string;
  let tokenId: string;

  beforeEach(async () => {
    await resetDb();
    const userId = await createUser();
    walletId = await createOnChainWallet({ userId });
    tokenId = await createToken({
      symbol: "USDC",
      network: "ETH",
      contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      decimals: 6,
    });
  });

  it("inserta una BUY on-chain con tx_hash + tx_log_index=0", async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO transactions
        (wallet_id, token_id, type, source, tx_hash, tx_log_index, block_timestamp, amount, price_usd, cost_source)
       VALUES ($1, $2, 'BUY', 'ETHERSCAN', $3, 0, $4, 100, 1.00, 'MARKET')
       RETURNING id`,
      [walletId, tokenId, TX_HASH, NOW],
    );
    expect(r.rows[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("permite mismo tx_hash con distinto tx_log_index (router swap multi-log)", async () => {
    await pool.query(
      `INSERT INTO transactions
        (wallet_id, token_id, type, source, tx_hash, tx_log_index, block_timestamp, amount, price_usd, cost_source)
       VALUES ($1, $2, 'SWAP_OUT', 'ETHERSCAN', $3, 0, $4, 100, 1.00, 'MARKET'),
              ($1, $2, 'SWAP_IN',  'ETHERSCAN', $3, 1, $4, 0.033, 3030.30, 'MARKET')`,
      [walletId, tokenId, TX_HASH, NOW],
    );
    const r = await pool.query<{ count: string }>(
      `SELECT count(*)::text FROM transactions WHERE tx_hash = $1`,
      [TX_HASH],
    );
    expect(Number(r.rows[0]!.count)).toBe(2);
  });

  it("rechaza duplicado on-chain (mismo tx_hash, mismo tx_log_index, source ETHERSCAN)", async () => {
    await pool.query(
      `INSERT INTO transactions
        (wallet_id, token_id, type, source, tx_hash, tx_log_index, block_timestamp, amount, price_usd, cost_source)
       VALUES ($1, $2, 'BUY', 'ETHERSCAN', $3, 0, $4, 100, 1.00, 'MARKET')`,
      [walletId, tokenId, TX_HASH, NOW],
    );
    await expect(
      pool.query(
        `INSERT INTO transactions
          (wallet_id, token_id, type, source, tx_hash, tx_log_index, block_timestamp, amount, price_usd, cost_source)
         VALUES ($1, $2, 'BUY', 'ETHERSCAN', $3, 0, $4, 100, 1.00, 'MARKET')`,
        [walletId, tokenId, TX_HASH, NOW],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("transacciones MANUAL no aplican el partial UNIQUE on-chain (permite duplicados)", async () => {
    await pool.query(
      `INSERT INTO transactions
        (wallet_id, token_id, type, source, tx_hash, tx_log_index, block_timestamp, amount, price_usd, cost_source)
       VALUES ($1, $2, 'BUY', 'MANUAL', $3, 0, $4, 100, 1.00, 'MANUAL'),
              ($1, $2, 'BUY', 'MANUAL', $3, 0, $4, 100, 1.00, 'MANUAL')`,
      [walletId, tokenId, TX_HASH, NOW],
    );
    const r = await pool.query<{ count: string }>(
      `SELECT count(*)::text FROM transactions WHERE source = 'MANUAL'`,
    );
    expect(Number(r.rows[0]!.count)).toBe(2);
  });
});
