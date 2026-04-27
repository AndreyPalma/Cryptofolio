// NEGATIVE acceptance criterion del PRD: duplicado CEX (mismo cex_trade_id, mismo
// tx_log_index) MUST fallar. Garantiza que el partial UNIQUE compuesto no fue
// degradado a `UNIQUE(cex_trade_id)` (regresión v4 corregida en v5).

import { describe, expect, it, beforeEach } from "vitest";
import { pool, resetDb, createUser, createCexWallet, createToken } from "./factories";

const testUrl = process.env.DATABASE_URL_TEST;
const NOW = "2026-04-26T00:00:00.000Z";

describe.skipIf(!testUrl)("NEGATIVE: duplicado CEX (cex_trade_id, tx_log_index)", () => {
  let cexWallet: string;
  let usdtCex: string;

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
  });

  it("rechaza un INSERT idéntico (cex_trade_id=999, tx_log_index=0) con código 23505", async () => {
    await pool.query(
      `INSERT INTO transactions
        (wallet_id, token_id, type, source, cex_trade_id, tx_log_index,
         block_timestamp, amount, price_usd, cost_source)
       VALUES ($1, $2, 'BUY', 'BINANCE', 999, 0, $3, 1, 1.00, 'MARKET')`,
      [cexWallet, usdtCex, NOW],
    );

    await expect(
      pool.query(
        `INSERT INTO transactions
          (wallet_id, token_id, type, source, cex_trade_id, tx_log_index,
           block_timestamp, amount, price_usd, cost_source)
         VALUES ($1, $2, 'BUY', 'BINANCE', 999, 0, $3, 1, 1.00, 'MARKET')`,
        [cexWallet, usdtCex, NOW],
      ),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "transactions_unique_cex",
    });
  });
});
