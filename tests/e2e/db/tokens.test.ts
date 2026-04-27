import { describe, expect, it, beforeEach } from "vitest";
import { pool, resetDb, createToken } from "./factories";

const testUrl = process.env.DATABASE_URL_TEST;

describe.skipIf(!testUrl)("tokens — on-chain y CEX coexistiendo", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("inserta un token on-chain con contract_address válido", async () => {
    const id = await createToken({
      symbol: "USDC",
      network: "ETH",
      contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      decimals: 6,
    });
    const r = await pool.query<{ network: string; contract_address: string; binance_symbol: string | null }>(
      `SELECT network, contract_address, binance_symbol FROM tokens WHERE id = $1`,
      [id],
    );
    expect(r.rows[0]!.network).toBe("ETH");
    expect(r.rows[0]!.contract_address).toBe("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48");
    expect(r.rows[0]!.binance_symbol).toBeNull();
  });

  it("inserta un token CEX con binance_symbol y sin contract_address", async () => {
    const id = await createToken({
      symbol: "ETH",
      network: "CEX_BINANCE",
      contractAddress: null,
      binanceSymbol: "ETH",
    });
    const r = await pool.query<{ network: string; contract_address: string | null; binance_symbol: string }>(
      `SELECT network, contract_address, binance_symbol FROM tokens WHERE id = $1`,
      [id],
    );
    expect(r.rows[0]!.network).toBe("CEX_BINANCE");
    expect(r.rows[0]!.contract_address).toBeNull();
    expect(r.rows[0]!.binance_symbol).toBe("ETH");
  });

  it("ETH on-chain y ETH en Binance coexisten como filas distintas", async () => {
    const onChain = await createToken({
      symbol: "ETH",
      network: "ETH",
      contractAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    });
    const cex = await createToken({
      symbol: "ETH",
      network: "CEX_BINANCE",
      contractAddress: null,
      binanceSymbol: "ETH",
    });
    expect(onChain).not.toBe(cex);

    const r = await pool.query<{ count: string }>(
      `SELECT count(*)::text FROM tokens WHERE symbol = 'ETH'`,
    );
    expect(Number(r.rows[0]!.count)).toBe(2);
  });

  it("rechaza un token on-chain sin contract_address (CHECK violation)", async () => {
    await expect(
      pool.query(
        `INSERT INTO tokens (symbol, network, contract_address, decimals) VALUES ('FOO', 'ETH', NULL, 18)`,
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rechaza un token CEX_BINANCE con contract_address (CHECK violation)", async () => {
    await expect(
      pool.query(
        `INSERT INTO tokens (symbol, network, contract_address, decimals)
         VALUES ('FOO', 'CEX_BINANCE', '0xabc0000000000000000000000000000000000001', 18)`,
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
