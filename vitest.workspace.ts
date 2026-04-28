import { defineWorkspace } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineWorkspace([
  {
    plugins: [react()],
    test: {
      name: "frontend",
      environment: "jsdom",
      include: [
        "apps/frontend/src/**/*.{test,spec}.{ts,tsx}",
        "apps/frontend/tests/**/*.{test,spec}.{ts,tsx}",
      ],
      globals: true,
      setupFiles: [],
    },
  },
  {
    test: {
      name: "engine",
      environment: "node",
      include: [
        "apps/backend/src/**/*.{test,spec}.ts",
        "apps/backend/tests/**/*.{test,spec}.ts",
        "db/*.{test,spec}.ts",
      ],
      exclude: ["apps/backend/tests/sync-*.{test,spec}.ts"],
    },
  },
  {
    test: {
      name: "sync",
      environment: "node",
      include: [
        "apps/backend/src/**/sync/*.{test,spec}.ts",
        "apps/backend/tests/sync-*.{test,spec}.ts",
      ],
    },
  },
  {
    test: {
      name: "e2e",
      environment: "node",
      include: ["tests/e2e/**/*.{test,spec}.ts"],
      globalSetup: ["./tests/e2e/setup.ts"],
      // Serial run: every e2e file mutates the shared test DB (TRUNCATE CASCADE
      // in resetDb()). Parallel files race on the same tables.
      pool: "forks",
      poolOptions: { forks: { singleFork: true } },
      fileParallelism: false,
      sequence: { concurrent: false },
    },
  },
]);
