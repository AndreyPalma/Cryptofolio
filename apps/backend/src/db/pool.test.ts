import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";

// Provide a minimal valid env BEFORE importing the pool module — parseEnv runs at import time.
const ORIGINAL_ENV = { ...process.env };

beforeAll(() => {
  process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/test";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.ETHERSCAN_API_KEY = "k";
  process.env.BSCTRACE_API_KEY = "k";
  process.env.BINANCE_API_KEY = "k";
  process.env.BINANCE_SECRET_KEY = "k";
  process.env.TELEGRAM_BOT_TOKEN = "k";
  process.env.TELEGRAM_CHAT_ID = "k";
  process.env.APP_PASSWORD = "12345678";
});

afterAll(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

describe("apps/backend/src/db/pool", () => {
  it("exports a singleton Pool instance (referential equality across imports)", async () => {
    const a = await import("./pool.js");
    const b = await import("./pool.js");
    expect(a.pool).toBe(b.pool);
  });

  it("does not crash on import with a valid DATABASE_URL", async () => {
    const mod = await import("./pool.js");
    expect(mod.pool).toBeDefined();
  });
});

// Suppress unused-import lints for vi
void vi;
