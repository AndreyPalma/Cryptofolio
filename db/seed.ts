// Seed script — populates a freshly migrated DB with deterministic fixtures.
// Fail-on-existing strategy (see openspec/changes/US-002-db-schema/design.md).

import pkg from "pg";

const { Pool } = pkg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("seed: DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });

const NOW = new Date().toISOString();

async function main(): Promise<void> {
  const existing = await pool.query<{ count: string }>("SELECT count(*)::text FROM users");
  if (Number(existing.rows[0]?.count ?? "0") > 0) {
    console.error(
      "seed: DB already seeded — run 'npm run db:migrate:down' to reset, then re-run migrate + seed",
    );
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const userRes = await client.query<{ id: string }>(
      `INSERT INTO users (password_hash) VALUES ($1) RETURNING id`,
      ["$2b$12$placeholderplaceholderplaceholderplaceholderplaceholder"],
    );
    const userId = userRes.rows[0]!.id;

    const walletRes = await client.query<{ id: string; label: string }>(
      `INSERT INTO wallets (user_id, wallet_type, address, network, label) VALUES
        ($1, 'ON_CHAIN', '0x000000000000000000000000000000000000dead', 'ETH',         'SafePal ETH'),
        ($1, 'ON_CHAIN', '0x000000000000000000000000000000000000beef', 'BSC',         'SafePal BSC'),
        ($1, 'CEX',      NULL,                                          'CEX_BINANCE', 'Binance')
       RETURNING id, label`,
      [userId],
    );
    const walletByLabel = new Map(walletRes.rows.map((r) => [r.label, r.id]));
    const ethWallet = walletByLabel.get("SafePal ETH")!;
    const cexWallet = walletByLabel.get("Binance")!;

    const tokenRes = await client.query<{ id: string; symbol: string; network: string }>(
      `INSERT INTO tokens (symbol, name, network, contract_address, decimals, binance_symbol) VALUES
        ('USDC', 'USD Coin',    'ETH',         '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 6,  NULL),
        ('CAKE', 'PancakeSwap', 'BSC',         '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', 18, NULL),
        ('ETH',  'Ether',       'CEX_BINANCE', NULL,                                         18, 'ETH'),
        ('USDT', 'Tether',      'CEX_BINANCE', NULL,                                         6,  'USDT')
       RETURNING id, symbol, network`,
      [],
    );
    const tokenKey = (symbol: string, network: string): string =>
      tokenRes.rows.find((r) => r.symbol === symbol && r.network === network)!.id;

    const usdcEth = tokenKey("USDC", "ETH");
    const ethCex = tokenKey("ETH", "CEX_BINANCE");
    const usdtCex = tokenKey("USDT", "CEX_BINANCE");

    const posRes = await client.query<{ id: string }>(
      `INSERT INTO positions (wallet_id, token_id, cycle_number, status, wac, balance, cost_basis)
       VALUES ($1, $2, 1, 'OPEN', 1.00, 100, 100)
       RETURNING id`,
      [ethWallet, usdcEth],
    );
    const posId = posRes.rows[0]!.id;

    await client.query(
      `INSERT INTO transactions
        (wallet_id, token_id, position_id, type, source, tx_hash, tx_log_index,
         block_timestamp, amount, price_usd, cost_source)
       VALUES ($1, $2, $3, 'BUY', 'ETHERSCAN',
               '0xbuy0000000000000000000000000000000000000000000000000000000000aa', 0,
               $4, 100, 1.00, 'MARKET')`,
      [ethWallet, usdcEth, posId, NOW],
    );

    await client.query(
      `INSERT INTO transactions
        (wallet_id, token_id, position_id, type, source, tx_hash, tx_log_index,
         block_timestamp, amount, price_usd, cost_source)
       VALUES ($1, $2, $3, 'SELL', 'ETHERSCAN',
               '0xsell000000000000000000000000000000000000000000000000000000000bb', 0,
               $4, 25, 1.01, 'MARKET')`,
      [ethWallet, usdcEth, posId, NOW],
    );

    const swapOutRes = await client.query<{ id: string }>(
      `INSERT INTO transactions
        (wallet_id, token_id, type, source, cex_trade_id, tx_log_index,
         block_timestamp, amount, price_usd, cost_source)
       VALUES ($1, $2, 'SWAP_OUT', 'BINANCE', 555000111, 0, $3, 100, 1.00, 'MARKET')
       RETURNING id`,
      [cexWallet, usdtCex, NOW],
    );
    await client.query(
      `INSERT INTO transactions
        (wallet_id, token_id, type, source, cex_trade_id, tx_log_index, related_tx_id,
         block_timestamp, amount, price_usd, cost_source)
       VALUES ($1, $2, 'SWAP_IN', 'BINANCE', 555000111, 1, $3, $4, 0.033, 3030.30, 'MARKET')`,
      [cexWallet, ethCex, swapOutRes.rows[0]!.id, NOW],
    );

    await client.query(
      `INSERT INTO transactions
        (wallet_id, token_id, type, source, tx_hash, tx_log_index,
         block_timestamp, amount, price_usd, cost_source, from_address, to_address)
       VALUES ($1, $2, 'TRANSFER_OUT', 'BINANCE',
               '0xwithdraw0000000000000000000000000000000000000000000000000000cc', 0,
               $3, 0.033, 3030.30, 'MARKET', NULL,
               '0x000000000000000000000000000000000000dead')`,
      [cexWallet, ethCex, NOW],
    );

    await client.query("COMMIT");
    console.log("seed: OK — 1 user, 3 wallets, 4 tokens, 1 position, 5 transactions");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("seed: failed", err);
  process.exit(1);
});
