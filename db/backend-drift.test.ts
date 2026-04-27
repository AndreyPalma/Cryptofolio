// Drift guard between db/enums.ts (DB SoT) and apps/backend/src/db/types.ts
// (backend-local copy required because tsc rootDir restricts cross-package imports).
//
// Reads the backend file as text and asserts each member of each enum is present
// in the same `as const` array name.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SQL_ENUM_DEFINITIONS } from "./enums.js";

const here = dirname(fileURLToPath(import.meta.url));
const backendTypesPath = resolve(here, "../apps/backend/src/db/types.ts");
const backendSrc = readFileSync(backendTypesPath, "utf8");

const arrayNameByEnum: Record<string, string> = {
  wallet_type: "WALLET_TYPES",
  network: "NETWORKS",
  transaction_type: "TRANSACTION_TYPES",
  transaction_source: "TRANSACTION_SOURCES",
  position_status: "POSITION_STATUSES",
  cost_source: "COST_SOURCES",
  service_name: "SERVICE_NAMES",
};

describe("backend types.ts ↔ db/enums.ts drift guard", () => {
  for (const [enumName, members] of Object.entries(SQL_ENUM_DEFINITIONS)) {
    const arrayName = arrayNameByEnum[enumName]!;
    describe(arrayName, () => {
      it(`is exported as a const array`, () => {
        expect(backendSrc).toMatch(new RegExp(`export const ${arrayName}\\s*=\\s*\\[`));
      });

      for (const member of members) {
        it(`includes member '${member}'`, () => {
          expect(backendSrc).toContain(`"${member}"`);
        });
      }
    });
  }

  it("does NOT contain legacy 'BINANCE_API_SECRET'", () => {
    expect(backendSrc).not.toContain("BINANCE_API_SECRET");
  });
});
