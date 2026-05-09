import pkg from "pg";
import { parseEnv } from "../env.js";

const { Pool } = pkg;

const env = parseEnv();

const isLocalhost =
  env.DATABASE_URL.includes("localhost") ||
  env.DATABASE_URL.includes("127.0.0.1");

// Supabase Pooler presents a self-signed cert chain that Node rejects by default.
// Disabling TLS verification only for non-local connections.
if (!isLocalhost) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
});
