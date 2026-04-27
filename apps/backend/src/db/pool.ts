import pkg from "pg";
import { parseEnv } from "../env.js";

const { Pool } = pkg;

const env = parseEnv();

const requiresSsl = env.DATABASE_URL.includes("sslmode=require");

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  ssl: requiresSsl ? { rejectUnauthorized: false } : undefined,
});
