import { describe, expect, it } from "vitest";
import { pool } from "./factories";

const testUrl = process.env.DATABASE_URL_TEST;

interface IndexRow {
  indexname: string;
  indexdef: string;
}

describe.skipIf(!testUrl)("query indexes from spec", () => {
  it("declara los 5 índices de transactions/wallet_sync_cursors con sus cláusulas WHERE", async () => {
    const r = await pool.query<IndexRow>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename IN ('transactions', 'wallet_sync_cursors')
       ORDER BY indexname`,
    );
    const byName = new Map(r.rows.map((row) => [row.indexname, row.indexdef]));

    expect(byName.has("transactions_position_id_idx")).toBe(true);
    expect(byName.get("transactions_position_id_idx")).toMatch(/\(position_id\)/);

    expect(byName.has("transactions_wallet_token_idx")).toBe(true);
    expect(byName.get("transactions_wallet_token_idx")).toMatch(/\(wallet_id, token_id\)/);

    expect(byName.has("transactions_block_timestamp_idx")).toBe(true);
    expect(byName.get("transactions_block_timestamp_idx")).toMatch(/block_timestamp DESC/);

    expect(byName.has("transactions_tx_hash_idx")).toBe(true);
    expect(byName.get("transactions_tx_hash_idx")).toMatch(/WHERE \(?tx_hash IS NOT NULL\)?/);

    expect(byName.has("wallet_sync_cursors_wallet_op_idx")).toBe(true);
    expect(byName.get("wallet_sync_cursors_wallet_op_idx")).toMatch(/\(wallet_id, operation\)/);
  });

  it("declara los partial UNIQUE on-chain y CEX con sus cláusulas WHERE correctas", async () => {
    const r = await pool.query<IndexRow>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'transactions'
         AND indexname IN ('transactions_unique_onchain', 'transactions_unique_cex')`,
    );
    const byName = new Map(r.rows.map((row) => [row.indexname, row.indexdef]));

    expect(byName.get("transactions_unique_onchain")).toMatch(
      /UNIQUE.*\(tx_hash, tx_log_index\)[\s\S]*WHERE/i,
    );
    expect(byName.get("transactions_unique_onchain")).toMatch(/ETHERSCAN/);
    expect(byName.get("transactions_unique_onchain")).toMatch(/BSCTRACE/);

    expect(byName.get("transactions_unique_cex")).toMatch(
      /UNIQUE.*\(cex_trade_id, tx_log_index\)[\s\S]*WHERE \(?cex_trade_id IS NOT NULL\)?/i,
    );
  });
});
