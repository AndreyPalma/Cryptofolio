import { describe, expect, it, beforeEach } from "vitest";
import { pool, resetDb, createUser, createCexWallet, createToken } from "./factories";

const testUrl = process.env.DATABASE_URL_TEST;
const NOW = "2026-04-26T00:00:00.000Z";
const TRADE_ID = 555000111;

describe.skipIf(!testUrl)("transactions — Binance Convert (swap decomposition)", () => {
  let cexWallet: string;
  let usdtCex: string;
  let ethCex: string;

  beforeEach(async () => {
    await resetDb();
    const userId = await createUser();
    cexWallet = await createCexWallet(userId);
    usdtCex = await createToken({
      symbol: "USDT",
      network: "CEX_BINANCE",
      contractAddress: null,
      binanceSymbol: "USDT",
      decimals: 6,
    });
    ethCex = await createToken({
      symbol: "ETH",
      network: "CEX_BINANCE",
      contractAddress: null,
      binanceSymbol: "ETH",
    });
  });

  it("inserta un Convert como dos rows: SWAP_OUT (log 0) + SWAP_IN (log 1) linkeadas por related_tx_id", async () => {
    const out = await pool.query<{ id: string }>(
      `INSERT INTO transactions
        (wallet_id, token_id, type, source, cex_trade_id, tx_log_index,
         block_timestamp, amount, price_usd, cost_source)
       VALUES ($1, $2, 'SWAP_OUT', 'BINANCE', $3, 0, $4, 100, 1.00, 'MARKET')
       RETURNING id`,
      [cexWallet, usdtCex, TRADE_ID, NOW],
    );
    const outId = out.rows[0]!.id;

    const inn = await pool.query<{ id: string; related_tx_id: string }>(
      `INSERT INTO transactions
        (wallet_id, token_id, type, source, cex_trade_id, tx_log_index, related_tx_id,
         block_timestamp, amount, price_usd, cost_source)
       VALUES ($1, $2, 'SWAP_IN', 'BINANCE', $3, 1, $4, $5, 0.033, 3030.30, 'MARKET')
       RETURNING id, related_tx_id`,
      [cexWallet, ethCex, TRADE_ID, outId, NOW],
    );

    expect(inn.rows[0]!.related_tx_id).toBe(outId);

    const both = await pool.query<{ count: string }>(
      `SELECT count(*)::text FROM transactions WHERE cex_trade_id = $1`,
      [TRADE_ID],
    );
    expect(Number(both.rows[0]!.count)).toBe(2);
  });

  it("transacción CEX puramente con cex_trade_id (sin tx_hash) inserta OK", async () => {
    const r = await pool.query<{ tx_hash: string | null }>(
      `INSERT INTO transactions
        (wallet_id, token_id, type, source, cex_trade_id, tx_log_index,
         block_timestamp, amount, price_usd, cost_source)
       VALUES ($1, $2, 'BUY', 'BINANCE', 999, 0, $3, 1, 1.00, 'MARKET')
       RETURNING tx_hash`,
      [cexWallet, usdtCex, NOW],
    );
    expect(r.rows[0]!.tx_hash).toBeNull();
  });
});
