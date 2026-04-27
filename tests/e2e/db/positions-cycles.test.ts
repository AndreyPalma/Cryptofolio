import { describe, expect, it, beforeEach } from "vitest";
import { pool, resetDb, createUser, createOnChainWallet, createToken } from "./factories";

const testUrl = process.env.DATABASE_URL_TEST;

describe.skipIf(!testUrl)("positions — UNIQUE(wallet_id, token_id, cycle_number)", () => {
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

  it("permite dos ciclos consecutivos sobre la misma (wallet, token)", async () => {
    await pool.query(
      `INSERT INTO positions (wallet_id, token_id, cycle_number, status, wac, balance, cost_basis, realized_pnl_usd, closed_at)
       VALUES ($1, $2, 1, 'CLOSED', 1.00, 0,   0,   12.34, now()),
              ($1, $2, 2, 'OPEN',   2.50, 100, 250, 0,     NULL)`,
      [walletId, tokenId],
    );
    const r = await pool.query<{ count: string }>(
      `SELECT count(*)::text FROM positions WHERE wallet_id = $1 AND token_id = $2`,
      [walletId, tokenId],
    );
    expect(Number(r.rows[0]!.count)).toBe(2);
  });

  it("rechaza dos posiciones con el mismo cycle_number", async () => {
    await pool.query(
      `INSERT INTO positions (wallet_id, token_id, cycle_number, status, wac, balance)
       VALUES ($1, $2, 1, 'OPEN', 1.00, 100)`,
      [walletId, tokenId],
    );
    await expect(
      pool.query(
        `INSERT INTO positions (wallet_id, token_id, cycle_number, status, wac, balance)
         VALUES ($1, $2, 1, 'OPEN', 2.00, 50)`,
        [walletId, tokenId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
