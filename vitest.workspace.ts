import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "engine",
      environment: "node",
      include: ["apps/backend/src/**/*.{test,spec}.ts", "apps/backend/tests/*.{test,spec}.ts"],
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
    },
  },
]);
