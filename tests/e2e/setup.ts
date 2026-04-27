// Vitest globalSetup for the `e2e` project.
// - Loads .env from repo root so DATABASE_URL_TEST is available without shell export.
// - Validates DATABASE_URL_TEST.
// - Runs `npm run db:migrate:down` (best effort — ignored if no prior schema).
// - Runs `npm run db:migrate` against DATABASE_URL_TEST.
// Runs ONCE before the entire suite.

import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export default async function setup(): Promise<void> {
  const testUrl = process.env.DATABASE_URL_TEST;
  if (!testUrl) {
    // Soft skip: e2e suite remains green but emits a clear marker.
    console.warn(
      "[e2e setup] DATABASE_URL_TEST is not set — e2e tests requiring DB will skip on connect.",
    );
    return;
  }

  // Prepare a child env where DATABASE_URL points to the TEST DB so
  // node-pg-migrate (which reads DATABASE_URL) targets the right place.
  const childEnv = { ...process.env, DATABASE_URL: testUrl };

  const run = (cmd: string, swallow = false): void => {
    try {
      execSync(cmd, { stdio: "inherit", env: childEnv });
    } catch (err) {
      if (!swallow) throw err;
    }
  };

  // Best-effort tear-down to start from a known-empty state.
  // We loop down a few times in case multiple migrations were applied previously.
  for (let i = 0; i < 5; i++) {
    try {
      execSync("npm run db:migrate:down --silent", { stdio: "ignore", env: childEnv });
    } catch {
      break; // nothing left to revert
    }
  }

  run("npm run db:migrate --silent");
}
