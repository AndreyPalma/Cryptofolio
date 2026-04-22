import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "../../..");

// 8.1: Process exits != 0 if DATABASE_URL missing
describe("env fail-fast (8.1)", () => {
  it("process exits with code != 0 and stderr contains DATABASE_URL when env is missing", () => {
    // Spawn with an empty env so DATABASE_URL is never set, triggering env fail-fast
    const result = spawnSync(process.execPath, ["--import=tsx/esm", "apps/backend/src/index.ts"], {
      cwd: ROOT,
      encoding: "utf8",
      // Intentionally empty env — no DATABASE_URL, triggers Zod validation failure
      env: { PATH: process.env.PATH },
      timeout: 10_000,
    });

    expect(result.status).not.toBe(0);
    const combined = result.stderr + result.stdout;
    expect(combined).toMatch(/DATABASE_URL/);
  });
});

// 8.2: EnvSchema.parse throws exact message for malformed DATABASE_URL
describe("EnvSchema malformed DATABASE_URL (8.2)", () => {
  it("throws ZodError with message containing canonical text", async () => {
    const { EnvSchema } = await import("../src/env.js");

    const VALID_BASE = {
      DATABASE_URL: "not-a-url",
      JWT_SECRET: "supersecretjwtkeyatleast32characters",
      ENCRYPTION_KEY: "0000000000000000000000000000000000000000000000000000000000000000",
      ETHERSCAN_API_KEY: "KEY",
      BSCTRACE_API_KEY: "KEY",
      BINANCE_API_KEY: "KEY",
      BINANCE_SECRET_KEY: "KEY",
      TELEGRAM_BOT_TOKEN: "KEY",
      TELEGRAM_CHAT_ID: "KEY",
      APP_PASSWORD: "password123",
    };

    let thrown: unknown;
    try {
      EnvSchema.parse(VALID_BASE);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeDefined();
    expect(String(thrown)).toMatch(/DATABASE_URL must be a valid Postgres connection URL/);
  });
});

// 8.3: Static assertion — BINANCE_API_SECRET must not appear in scaffold files
describe("BINANCE_API_SECRET absent from scaffold (8.3)", () => {
  const FORBIDDEN = "BINANCE_API_SECRET";

  const PATHS_TO_CHECK = [
    join(ROOT, ".env.example"),
    // backend src files
    join(ROOT, "apps/backend/src/env.ts"),
    join(ROOT, "apps/backend/src/index.ts"),
    join(ROOT, "apps/backend/src/plugins/health.ts"),
    // frontend src files
    join(ROOT, "apps/frontend/src/main.tsx"),
    join(ROOT, "apps/frontend/src/App.tsx"),
    join(ROOT, "apps/frontend/src/lib/cn.ts"),
    join(ROOT, "apps/frontend/vite.config.ts"),
  ];

  for (const filePath of PATHS_TO_CHECK) {
    it(`does not contain '${FORBIDDEN}' in ${filePath.replace(ROOT, ".")}`, () => {
      let content: string;
      try {
        content = readFileSync(filePath, "utf8");
      } catch {
        // File doesn't exist yet — skip rather than fail
        return;
      }
      expect(content).not.toContain(FORBIDDEN);
    });
  }
});
