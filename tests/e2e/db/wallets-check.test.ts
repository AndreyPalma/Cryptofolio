import { describe, expect, it, beforeEach } from "vitest";
import { pool, resetDb, createUser } from "./factories";

const testUrl = process.env.DATABASE_URL_TEST;

describe.skipIf(!testUrl)("wallets CHECK constraint", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDb();
    userId = await createUser();
  });

  it("ON_CHAIN con address y network ETH inserta OK", async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO wallets (user_id, wallet_type, address, network)
       VALUES ($1, 'ON_CHAIN', '0xabc0000000000000000000000000000000000001', 'ETH')
       RETURNING id`,
      [userId],
    );
    expect(r.rows[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("ON_CHAIN sin address falla con CHECK violation", async () => {
    await expect(
      pool.query(
        `INSERT INTO wallets (user_id, wallet_type, address, network)
         VALUES ($1, 'ON_CHAIN', NULL, 'ETH')`,
        [userId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("CEX con address falla con CHECK violation", async () => {
    await expect(
      pool.query(
        `INSERT INTO wallets (user_id, wallet_type, address, network)
         VALUES ($1, 'CEX', '0xabc0000000000000000000000000000000000002', 'CEX_BINANCE')`,
        [userId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("ON_CHAIN con network CEX_BINANCE falla con CHECK violation", async () => {
    await expect(
      pool.query(
        `INSERT INTO wallets (user_id, wallet_type, address, network)
         VALUES ($1, 'ON_CHAIN', '0xabc0000000000000000000000000000000000003', 'CEX_BINANCE')`,
        [userId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
