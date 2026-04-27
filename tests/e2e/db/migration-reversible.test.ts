import { describe, expect, it, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { pool, resetDb } from "./factories";

const EXPECTED_TABLES = [
  "api_credentials",
  "positions",
  "tokens",
  "transactions",
  "users",
  "wallet_sync_cursors",
  "wallets",
];

const testUrl = process.env.DATABASE_URL_TEST;

describe.skipIf(!testUrl)("migration reversible", () => {
  beforeAll(async () => {
    await resetDb();
  });

  it("crea las 7 tablas del dominio sobre DB limpia", async () => {
    const r = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename = ANY($1::text[])
       ORDER BY tablename`,
      [EXPECTED_TABLES],
    );
    expect(r.rows.map((row) => row.tablename)).toEqual(EXPECTED_TABLES);
  });

  it("up → down → up es idempotente: el snapshot de columnas es idéntico", async () => {
    const childEnv = { ...process.env, DATABASE_URL: testUrl! };

    const snapshot = async (): Promise<string> => {
      const c = await pool.query<{ table_name: string; column_name: string; data_type: string }>(
        `SELECT table_name, column_name, data_type
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = ANY($1::text[])
         ORDER BY table_name, ordinal_position`,
        [EXPECTED_TABLES],
      );
      return c.rows.map((r) => `${r.table_name}.${r.column_name}:${r.data_type}`).join("\n");
    };

    const before = await snapshot();
    expect(before.length).toBeGreaterThan(0);

    // Down — loop best-effort to peel the single migration we have
    for (let i = 0; i < 3; i++) {
      try {
        execSync("npm run db:migrate:down --silent", { stdio: "ignore", env: childEnv });
      } catch {
        break;
      }
    }
    const downCheck = await pool.query<{ count: string }>(
      `SELECT count(*)::text FROM pg_tables WHERE schemaname='public' AND tablename = ANY($1::text[])`,
      [EXPECTED_TABLES],
    );
    expect(Number(downCheck.rows[0]!.count)).toBe(0);

    // Up again
    execSync("npm run db:migrate --silent", { stdio: "ignore", env: childEnv });

    const after = await snapshot();
    expect(after).toBe(before);
  });
});
