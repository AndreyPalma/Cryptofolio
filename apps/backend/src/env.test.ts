import { describe, it, expect } from "vitest";
import { EnvSchema } from "./env.js";

const VALID_ENV = {
  DATABASE_URL: "postgresql://postgres:password@localhost:5432/cryptoledger",
  JWT_SECRET: "supersecretjwtkeyatleast32characters",
  ENCRYPTION_KEY: "0000000000000000000000000000000000000000000000000000000000000000",
  ETHERSCAN_API_KEY: "ETHERSCANKEY",
  BSCTRACE_API_KEY: "BSTRACEKEY",
  BINANCE_API_KEY: "BINANCE_API",
  BINANCE_SECRET_KEY: "BINANCE_SECRET",
  TELEGRAM_BOT_TOKEN: "bot123456:TOKEN",
  TELEGRAM_CHAT_ID: "-100123456",
  APP_PASSWORD: "password123",
};

describe("EnvSchema", () => {
  it("parses a fully valid env without throwing", () => {
    expect(() => EnvSchema.parse(VALID_ENV)).not.toThrow();
  });

  it("throws when DATABASE_URL is missing", () => {
    const { DATABASE_URL: _omitted, ...rest } = VALID_ENV;
    expect(() => EnvSchema.parse(rest)).toThrow();
  });

  it("throws with correct message when DATABASE_URL is malformed", () => {
    expect(() => EnvSchema.parse({ ...VALID_ENV, DATABASE_URL: "not-a-url" })).toThrowError(
      /DATABASE_URL must be a valid Postgres connection URL/,
    );
  });

  it("defaults PORT to 3000 when not provided", () => {
    const result = EnvSchema.parse(VALID_ENV);
    expect(result.PORT).toBe(3000);
  });

  it("accepts PORT from env (coerced from string)", () => {
    const result = EnvSchema.parse({ ...VALID_ENV, PORT: "8080" });
    expect(result.PORT).toBe(8080);
  });

  it("throws when JWT_SECRET is too short", () => {
    expect(() => EnvSchema.parse({ ...VALID_ENV, JWT_SECRET: "tooshort" })).toThrow();
  });

  it("throws when ENCRYPTION_KEY is wrong length", () => {
    expect(() => EnvSchema.parse({ ...VALID_ENV, ENCRYPTION_KEY: "tooshort" })).toThrow();
  });
});
