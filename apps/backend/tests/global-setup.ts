import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pkg from "pg";

const { Pool } = pkg;

export default async function setup(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn("DATABASE_URL_TEST or DATABASE_URL not set — skipping test DB migrations");
    return;
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false },
  });

  try {
    // Check if pgmigrations table exists
    const checkResult = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'pgmigrations'
      )
    `);
    const hasMigrationsTable =
      (checkResult.rows[0] as { exists: boolean } | undefined)?.exists === true;

    if (!hasMigrationsTable) {
      // Fresh database — apply consolidated schema directly
      const initialSql = readFileSync(
        resolve(process.cwd(), "../../db/migrations/0000_initial_schema.sql"),
        "utf8",
      );
      await pool.query(initialSql);

      // Track the single consolidated migration
      await pool.query(`
        CREATE TABLE IF NOT EXISTS pgmigrations (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL UNIQUE,
          run_on TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query("INSERT INTO pgmigrations (name) VALUES ($1) ON CONFLICT DO NOTHING", [
        "0000_initial_schema",
      ]);
    }
  } finally {
    await pool.end();
  }
}
