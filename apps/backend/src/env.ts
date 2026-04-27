import { z } from "zod";

export const EnvSchema = z.object({
  DATABASE_URL: z.url({ error: "DATABASE_URL must be a valid Postgres connection URL" }),
  DATABASE_URL_TEST: z
    .url({ error: "DATABASE_URL_TEST must be a valid Postgres connection URL" })
    .optional(),
  JWT_SECRET: z.string().min(32, { error: "JWT_SECRET must be at least 32 chars" }),
  ENCRYPTION_KEY: z
    .string()
    .length(64, { error: "ENCRYPTION_KEY must be 64 hex chars (32 bytes)" }),
  ETHERSCAN_API_KEY: z.string().min(1),
  BSCTRACE_API_KEY: z.string().min(1),
  BINANCE_API_KEY: z.string().min(1),
  // The correct name is BINANCE_SECRET_KEY — the legacy name from v4 was different and is a known bug
  BINANCE_SECRET_KEY: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
  APP_PASSWORD: z.string().min(8),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof EnvSchema>;

// Lazy parse — only called from index.ts entry point, not on import
// This allows tests to import EnvSchema without triggering a parse of process.env
export function parseEnv(): Env {
  return EnvSchema.parse(process.env);
}
