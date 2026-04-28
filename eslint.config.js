// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginN from "eslint-plugin-n";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginJsxA11y from "eslint-plugin-jsx-a11y";

export default tseslint.config(
  // Global ignores
  {
    ignores: ["docs/**", "**/dist/**", "**/node_modules/**", "db/*.js"],
  },

  // Base JS rules
  js.configs.recommended,

  // TypeScript strict across all TS files
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Single top-level project service.
  // allowDefaultProject covers files outside any tsconfig include:
  //   - apps/frontend/vite.config.ts  (in tsconfig.node.json, not tsconfig.json)
  //   - db/seed.ts                    (in root tsconfig.json which is noEmit, fine)
  //   - tests/e2e/smoke.test.ts       (same root tsconfig)
  // These all have typed rules disabled below, so the default project is safe.
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "apps/frontend/vite.config.ts",
            "apps/frontend/tests/*.ts",
            "apps/frontend/tests/*.tsx",
            "db/*.ts",
            "tests/e2e/*.ts",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Global no-unused-vars: treat _-prefixed identifiers as intentionally unused
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  // Backend overrides
  {
    files: ["apps/backend/**/*.{ts,mts,cts}"],
    plugins: {
      n: pluginN,
    },
    rules: {
      ...pluginN.configs["flat/recommended-module"].rules,
      "n/no-missing-import": "off", // TypeScript handles this
    },
  },

  // Fastify plugins — async functions without await are idiomatic in Fastify
  {
    files: ["apps/backend/src/plugins/**/*.ts"],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },

  // Frontend overrides
  {
    files: ["apps/frontend/**/*.{ts,tsx,mts}"],
    plugins: {
      react: pluginReact,
      "react-hooks": pluginReactHooks,
      "jsx-a11y": pluginJsxA11y,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      ...pluginReact.configs.recommended.rules,
      ...pluginReact.configs["jsx-runtime"].rules,
      ...pluginReactHooks.configs.recommended.rules,
      ...pluginJsxA11y.configs.recommended.rules,
      "react/prop-types": "off",
    },
  },

  // Config files (JS/TS at root) — relaxed type-checking
  // Also applies to vite.config.ts and other build tool configs
  {
    files: ["*.config.{js,ts,mjs,mts}", "vitest.workspace.ts", "apps/frontend/vite.config.ts"],
    ...tseslint.configs.disableTypeChecked,
  },

  // Test files and utility scripts — disable strict typed rules that don't apply
  {
    files: ["db/**/*.ts", "tests/**/*.ts", "**/*.test.ts", "**/*.spec.ts", "**/*.test.tsx", "**/*.spec.tsx"],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-dynamic-delete": "off",
      "@typescript-eslint/no-empty-function": "off",
    },
  },
);
