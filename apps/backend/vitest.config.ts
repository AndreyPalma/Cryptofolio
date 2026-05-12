import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    globalSetup: ["./tests/global-setup.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "sync",
          include: ["tests/sync-*.test.ts"],
          setupFiles: ["./tests/setup.ts"],
          maxWorkers: 1,
          minWorkers: 1,
        },
      },
      {
        extends: true,
        test: {
          name: "engine",
          include: ["src/sync/classify.test.ts", "src/position-engine/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "e2e",
          include: ["tests/e2e/**/*.test.ts"],
          setupFiles: ["./tests/setup.ts"],
          maxWorkers: 1,
          minWorkers: 1,
          poolOptions: {
            threads: { singleThread: true },
          },
        },
      },
    ],
  },
});
