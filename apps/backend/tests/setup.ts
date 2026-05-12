import { beforeEach, afterAll } from "vitest";
import { testPool, truncateAllTables } from "./helpers/test-db.js";

beforeEach(async () => {
  await truncateAllTables();
});

afterAll(async () => {
  await testPool.end();
});
