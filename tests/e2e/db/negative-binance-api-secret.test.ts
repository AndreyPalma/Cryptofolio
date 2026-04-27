// NEGATIVE acceptance criterion del PRD: el ENUM service_name SHALL NOT contener
// 'BINANCE_API_SECRET' (alias legacy v4). Cualquier intento de insertarlo debe
// fallar con error de tipo ENUM inválido (Postgres devuelve 22P02 invalid_text_representation).

import { describe, expect, it, beforeEach } from "vitest";
import { resetDb, createUser, pool } from "./factories";

const testUrl = process.env.DATABASE_URL_TEST;

describe.skipIf(!testUrl)("NEGATIVE: service_name='BINANCE_API_SECRET' rechazado por ENUM", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDb();
    userId = await createUser();
  });

  it("rechaza el INSERT con código 22P02 (invalid_text_representation)", async () => {
    await expect(
      pool.query(
        `INSERT INTO api_credentials (user_id, service_name, credential_encrypted)
         VALUES ($1, 'BINANCE_API_SECRET', 'enc:placeholder')`,
        [userId],
      ),
    ).rejects.toMatchObject({ code: "22P02" });
  });

  it("acepta el alias canónico 'BINANCE_SECRET_KEY'", async () => {
    const r = await pool.query<{ service_name: string }>(
      `INSERT INTO api_credentials (user_id, service_name, credential_encrypted)
       VALUES ($1, 'BINANCE_SECRET_KEY', 'enc:placeholder')
       RETURNING service_name`,
      [userId],
    );
    expect(r.rows[0]!.service_name).toBe("BINANCE_SECRET_KEY");
  });
});
