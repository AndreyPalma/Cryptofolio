import pkg from "pg";
import { parseEnv } from "../env.js";

const { Pool } = pkg;

const env = parseEnv();

const isLocalhost =
  env.DATABASE_URL.includes("localhost") ||
  env.DATABASE_URL.includes("127.0.0.1");

// Supabase Pooler presents a self-signed cert chain — scope the bypass to the pg Pool only,
// never to the global process (which would also affect Binance/DefiLlama fetch calls).
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  ssl: isLocalhost ? false : { rejectUnauthorized: false },
});
