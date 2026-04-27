// NEGATIVE acceptance criterion del PRD: solo puede existir una wallet CEX_BINANCE.
// Esta regla se enforce a NIVEL SERVICE-LAYER (US-005), NO a nivel DB schema.
// El DB explícitamente acepta múltiples filas CEX_BINANCE — la unicidad se valida
// en la capa de servicio donde puede emitir un error de dominio claro.
// Service-layer enforcement: see US-005.

import { describe, it, expect } from "vitest";
import { pool, resetDb, createUser, createCexWallet } from "./factories";

const testUrl = process.env.DATABASE_URL_TEST;

describe.skipIf(!testUrl)("NEGATIVE (deferred): único CEX_BINANCE wallet — service layer (US-005)", () => {
  it.skip("DB acepta dos wallets CEX_BINANCE; la regla de unicidad la enforce el service layer (TODO: US-005)", () => {
    // Placeholder: when US-005 lands, this test moves to a service-layer suite
    // and asserts that creating a second CEX_BINANCE wallet returns a domain error.
    expect(true).toBe(true);
  });

  it("verifica explícitamente que el DB NO restringe el número de wallets CEX_BINANCE", async () => {
    await resetDb();
    const userId = await createUser();
    await createCexWallet(userId, "Binance #1");
    await createCexWallet(userId, "Binance #2");

    const r = await pool.query<{ count: string }>(
      `SELECT count(*)::text FROM wallets WHERE wallet_type = 'CEX' AND network = 'CEX_BINANCE'`,
    );
    expect(Number(r.rows[0]!.count)).toBe(2);
  });
});
