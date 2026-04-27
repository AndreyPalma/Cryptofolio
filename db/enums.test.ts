import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SQL_ENUM_DEFINITIONS } from "./enums.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(here, "migrations/0001_initial_schema.sql");

describe("ENUM source-of-truth ↔ migration SQL drift guard", () => {
  const sql = readFileSync(migrationPath, "utf8");

  for (const [enumName, members] of Object.entries(SQL_ENUM_DEFINITIONS)) {
    describe(`${enumName}`, () => {
      it("declares CREATE TYPE in the migration", () => {
        expect(sql).toMatch(new RegExp(`CREATE TYPE\\s+${enumName}\\s+AS ENUM`, "i"));
      });

      for (const member of members) {
        it(`includes member '${member}'`, () => {
          // members appear inside the ENUM body as 'MEMBER'
          expect(sql).toContain(`'${member}'`);
        });
      }
    });
  }

  it("does NOT contain legacy BINANCE_API_SECRET", () => {
    expect(sql).not.toContain("BINANCE_API_SECRET");
  });
});
