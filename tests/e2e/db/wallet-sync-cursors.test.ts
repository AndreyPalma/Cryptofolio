import { describe, expect, it, beforeEach } from "vitest";
import { pool, resetDb, createUser, createOnChainWallet, createCexWallet } from "./factories";

const testUrl = process.env.DATABASE_URL_TEST;

describe.skipIf(!testUrl)("wallet_sync_cursors UNIQUE(wallet_id, operation)", () => {
  let userId: string;
  let cexWallet: string;

  beforeEach(async () => {
    await resetDb();
    userId = await createUser();
    cexWallet = await createCexWallet(userId);
  });

  it("permite múltiples operations distintas para la misma wallet", async () => {
    await pool.query(
      `INSERT INTO wallet_sync_cursors (wallet_id, operation, last_value)
       VALUES ($1, 'trades:ETHUSDT', '1700000000000'),
              ($1, 'converts',       '1700000001000'),
              ($1, 'withdrawals',    '1700000002000'),
              ($1, 'deposits',       '1700000003000')`,
      [cexWallet],
    );

    const r = await pool.query<{ count: string }>(
      `SELECT count(*)::text FROM wallet_sync_cursors WHERE wallet_id = $1`,
      [cexWallet],
    );
    expect(Number(r.rows[0]!.count)).toBe(4);
  });

  it("permite la misma operation para wallets distintas", async () => {
    const ethWallet = await createOnChainWallet({
      userId,
      address: "0xabc0000000000000000000000000000000000010",
      network: "ETH",
    });

    await pool.query(
      `INSERT INTO wallet_sync_cursors (wallet_id, operation) VALUES ($1, 'converts'), ($2, 'converts')`,
      [cexWallet, ethWallet],
    );

    const r = await pool.query<{ count: string }>(
      `SELECT count(*)::text FROM wallet_sync_cursors WHERE operation = 'converts'`,
    );
    expect(Number(r.rows[0]!.count)).toBe(2);
  });

  it("rechaza un (wallet_id, operation) duplicado con UNIQUE violation", async () => {
    await pool.query(
      `INSERT INTO wallet_sync_cursors (wallet_id, operation) VALUES ($1, 'converts')`,
      [cexWallet],
    );

    await expect(
      pool.query(
        `INSERT INTO wallet_sync_cursors (wallet_id, operation) VALUES ($1, 'converts')`,
        [cexWallet],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
