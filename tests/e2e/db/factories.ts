// Test factories for e2e DB tests. Each factory returns the row id so tests can
// build graphs ergonomically. `resetDb()` truncates every domain table in FK order.

import pkg from "pg";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";

const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const testUrl = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
if (!testUrl) {
  throw new Error("e2e factories: DATABASE_URL_TEST (or DATABASE_URL) must be set");
}

export const pool = new Pool({ connectionString: testUrl, max: 4 });

const PLACEHOLDER_HASH =
  "$2b$12$placeholderplaceholderplaceholderplaceholderplaceholder";

export async function resetDb(): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE
      api_credentials,
      wallet_sync_cursors,
      transactions,
      positions,
      tokens,
      wallets,
      users
    RESTART IDENTITY CASCADE
  `);
}

export async function createUser(): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO users (password_hash) VALUES ($1) RETURNING id`,
    [PLACEHOLDER_HASH],
  );
  return r.rows[0]!.id;
}

export interface CreateOnChainWalletInput {
  userId: string;
  address?: string;
  network?: "ETH" | "BSC";
  label?: string;
}

export async function createOnChainWallet(input: CreateOnChainWalletInput): Promise<string> {
  const address = input.address ?? "0x000000000000000000000000000000000000dead";
  const network = input.network ?? "ETH";
  const label = input.label ?? `${network} wallet`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO wallets (user_id, wallet_type, address, network, label)
     VALUES ($1, 'ON_CHAIN', $2, $3, $4) RETURNING id`,
    [input.userId, address, network, label],
  );
  return r.rows[0]!.id;
}

export async function createCexWallet(userId: string, label = "Binance"): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO wallets (user_id, wallet_type, address, network, label)
     VALUES ($1, 'CEX', NULL, 'CEX_BINANCE', $2) RETURNING id`,
    [userId, label],
  );
  return r.rows[0]!.id;
}

export interface CreateTokenInput {
  symbol: string;
  network: "ETH" | "BSC" | "CEX_BINANCE";
  contractAddress?: string | null;
  binanceSymbol?: string | null;
  decimals?: number;
}

export async function createToken(input: CreateTokenInput): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO tokens (symbol, network, contract_address, binance_symbol, decimals)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      input.symbol,
      input.network,
      input.contractAddress ?? null,
      input.binanceSymbol ?? null,
      input.decimals ?? 18,
    ],
  );
  return r.rows[0]!.id;
}

export async function closePool(): Promise<void> {
  await pool.end();
}
