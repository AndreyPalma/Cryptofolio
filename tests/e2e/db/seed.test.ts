import { describe, expect, it, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { pool, resetDb } from "./factories";

const testUrl = process.env.DATABASE_URL_TEST;

const runSeed = (): { stdout: string; status: number } => {
  try {
    const stdout = execSync("npm run db:seed --silent", {
      env: { ...process.env, DATABASE_URL: testUrl! },
      encoding: "utf-8",
    });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    const out = `${e.stdout?.toString() ?? ""}${e.stderr?.toString() ?? ""}`;
    return { stdout: out, status: e.status ?? 1 };
  }
};

describe.skipIf(!testUrl)("seed reproducible y fail-on-existing", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("puebla la DB con los counts esperados (1 user, 3 wallets, 4 tokens, ≥4 transactions)", async () => {
    const result = runSeed();
    expect(result.status).toBe(0);

    const counts = await pool.query<{ users: string; wallets: string; tokens: string; transactions: string }>(
      `SELECT
        (SELECT count(*)::text FROM users)        AS users,
        (SELECT count(*)::text FROM wallets)      AS wallets,
        (SELECT count(*)::text FROM tokens)       AS tokens,
        (SELECT count(*)::text FROM transactions) AS transactions`,
    );
    const row = counts.rows[0]!;
    expect(Number(row.users)).toBe(1);
    expect(Number(row.wallets)).toBe(3);
    expect(Number(row.tokens)).toBe(4);
    expect(Number(row.transactions)).toBeGreaterThanOrEqual(4);
  });

  it("la segunda corrida sin reset falla limpiamente con exit != 0 y mensaje 'already seeded'", async () => {
    const first = runSeed();
    expect(first.status).toBe(0);

    const second = runSeed();
    expect(second.status).not.toBe(0);
    expect(second.stdout).toMatch(/already seeded/i);
  });
});
