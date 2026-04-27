import { describe, expect, it, beforeEach } from "vitest";
import { pool, resetDb, createUser, createOnChainWallet } from "./factories";

const testUrl = process.env.DATABASE_URL_TEST;

describe.skipIf(!testUrl)("wallets.last_synced_at", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("una wallet recién creada tiene last_synced_at = NULL", async () => {
    const userId = await createUser();
    const walletId = await createOnChainWallet({ userId });

    const r = await pool.query<{ last_synced_at: Date | null }>(
      `SELECT last_synced_at FROM wallets WHERE id = $1`,
      [walletId],
    );
    expect(r.rows[0]!.last_synced_at).toBeNull();
  });

  it("se puede setear y leer un valor concreto", async () => {
    const userId = await createUser();
    const walletId = await createOnChainWallet({ userId });
    const ts = "2026-01-15T10:30:00.000Z";

    await pool.query(`UPDATE wallets SET last_synced_at = $1 WHERE id = $2`, [ts, walletId]);

    const r = await pool.query<{ last_synced_at: Date }>(
      `SELECT last_synced_at FROM wallets WHERE id = $1`,
      [walletId],
    );
    expect(r.rows[0]!.last_synced_at).toBeInstanceOf(Date);
    expect(r.rows[0]!.last_synced_at!.toISOString()).toBe(ts);
  });
});
