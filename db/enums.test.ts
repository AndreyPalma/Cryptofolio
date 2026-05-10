import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SQL_ENUM_DEFINITIONS } from "./enums.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "migrations");
const sql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(resolve(migrationsDir, f), "utf8"))
  .join("\n");

describe("ENUM source-of-truth ↔ migration SQL drift guard", () => {

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
