import pkg from "pg";
import { Decimal } from "decimal.js";

const { Pool } = pkg;

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_TEST or DATABASE_URL must be set");
  return url;
}

export const testPool = new Pool({
  connectionString: getDatabaseUrl(),
  max: 5,
});

export async function truncateAllTables(): Promise<void> {
  await testPool.query(`
    TRUNCATE TABLE
      transactions,
      positions,
      wallet_sync_cursors,
      sync_runs,
      api_credentials,
      wallets,
      tokens,
      users
    RESTART IDENTITY CASCADE
  `);
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

export async function seedUser(
  pool = testPool,
  opts?: { id?: string; passwordHash?: string },
): Promise<{ id: string; passwordHash: string }> {
  const id = opts?.id ?? crypto.randomUUID();
  const passwordHash = opts?.passwordHash ?? "hashed-password";
  const result = await pool.query<{ id: string; password_hash: string }>(
    `INSERT INTO users (id, password_hash) VALUES ($1, $2) RETURNING id, password_hash`,
    [id, passwordHash],
  );
  const row = result.rows[0];
  if (!row) throw new Error("seedUser failed");
  return { id: row.id, passwordHash: row.password_hash };
}

export async function seedWallet(
  pool = testPool,
  opts: {
    userId: string;
    walletType?: "ON_CHAIN" | "CEX";
    network?: "ETH" | "BSC" | "CEX_BINANCE";
    address?: string | null;
    lastSyncedBlock?: number;
    id?: string;
  },
): Promise<{
  id: string;
  userId: string;
  network: string;
  address: string | null;
  lastSyncedBlock: number;
}> {
  const id = opts.id ?? crypto.randomUUID();
  const walletType = opts.walletType ?? "ON_CHAIN";
  const network = opts.network ?? "ETH";
  const address = opts.address ?? "0xabc123abc123abc123abc123abc123abc123abcd";
  const lastSyncedBlock = opts.lastSyncedBlock ?? 0;
  const result = await pool.query<{
    id: string;
    user_id: string;
    network: string;
    address: string | null;
    last_synced_block: number;
  }>(
    `INSERT INTO wallets (id, user_id, wallet_type, network, address, last_synced_block)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, user_id, network, address, last_synced_block`,
    [id, opts.userId, walletType, network, address, lastSyncedBlock],
  );
  const row = result.rows[0];
  if (!row) throw new Error("seedWallet failed");
  return {
    id: row.id,
    userId: row.user_id,
    network: row.network,
    address: row.address,
    lastSyncedBlock: row.last_synced_block,
  };
}

export async function seedToken(
  pool = testPool,
  opts: {
    symbol: string;
    network?: "ETH" | "BSC";
    contractAddress?: string;
    decimals?: number;
    id?: string;
  },
): Promise<{
  id: string;
  symbol: string;
  network: string;
  contractAddress: string;
  decimals: number;
}> {
  const id = opts.id ?? crypto.randomUUID();
  const network = opts.network ?? "ETH";
  const contractAddress = opts.contractAddress ?? "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
  const decimals = opts.decimals ?? 6;
  const result = await pool.query<{
    id: string;
    symbol: string;
    network: string;
    contract_address: string;
    decimals: number;
  }>(
    `INSERT INTO tokens (id, symbol, network, contract_address, decimals)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, symbol, network, contract_address, decimals`,
    [id, opts.symbol, network, contractAddress, decimals],
  );
  const row = result.rows[0];
  if (!row) throw new Error("seedToken failed");
  return {
    id: row.id,
    symbol: row.symbol,
    network: row.network,
    contractAddress: row.contract_address,
    decimals: row.decimals,
  };
}

export async function seedPosition(
  pool = testPool,
  opts: {
    walletId: string;
    tokenId: string;
    cycleNumber?: number;
    status?: "OPEN" | "CLOSED";
    balance?: string;
    wac?: string;
    costBasis?: string;
    realizedPnlUsd?: string;
    id?: string;
  },
): Promise<{ id: string; walletId: string; tokenId: string; wac: string; balance: string }> {
  const id = opts.id ?? crypto.randomUUID();
  const cycleNumber = opts.cycleNumber ?? 1;
  const status = opts.status ?? "OPEN";
  const balance = opts.balance ?? "100";
  const wac = opts.wac ?? "1.00";
  const costBasis = opts.costBasis ?? new Decimal(balance).times(wac).toFixed(18);
  const realizedPnlUsd = opts.realizedPnlUsd ?? "0";
  const result = await pool.query<{
    id: string;
    wallet_id: string;
    token_id: string;
    wac: string;
    balance: string;
  }>(
    `INSERT INTO positions (
      id, wallet_id, token_id, cycle_number, status,
      balance, wac, cost_basis, realized_pnl_usd, opened_at, closed_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),NULL)
    RETURNING id, wallet_id, token_id, wac::text, balance::text`,
    [id, opts.walletId, opts.tokenId, cycleNumber, status, balance, wac, costBasis, realizedPnlUsd],
  );
  const row = result.rows[0];
  if (!row) throw new Error("seedPosition failed");
  return {
    id: row.id,
    walletId: row.wallet_id,
    tokenId: row.token_id,
    wac: row.wac,
    balance: row.balance,
  };
}

export async function seedTransaction(
  pool = testPool,
  opts: {
    walletId: string;
    tokenId: string;
    positionId?: string | null;
    type: string;
    source: string;
    txHash?: string | null;
    txLogIndex?: number;
    relatedTxId?: string | null;
    blockTimestamp?: Date;
    amount: string;
    priceUsd?: string | null;
    costSource?: string | null;
    syncRunId?: string | null;
    fromAddress?: string | null;
    toAddress?: string | null;
    id?: string;
  },
): Promise<{ id: string }> {
  const id = opts.id ?? crypto.randomUUID();
  const blockTimestamp = opts.blockTimestamp ?? new Date();
  const result = await pool.query<{ id: string }>(
    `INSERT INTO transactions (
      id, wallet_id, token_id, position_id, type, source,
      tx_hash, tx_log_index, related_tx_id, block_timestamp,
      amount, price_usd, cost_source, sync_run_id,
      from_address, to_address
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    RETURNING id`,
    [
      id,
      opts.walletId,
      opts.tokenId,
      opts.positionId ?? null,
      opts.type,
      opts.source,
      opts.txHash ?? null,
      opts.txLogIndex ?? 0,
      opts.relatedTxId ?? null,
      blockTimestamp,
      opts.amount,
      opts.priceUsd ?? null,
      opts.costSource ?? null,
      opts.syncRunId ?? null,
      opts.fromAddress ?? null,
      opts.toAddress ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("seedTransaction failed");
  return { id: row.id };
}
