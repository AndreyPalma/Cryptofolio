/**
 * SC-PASS-01 through SC-PASS-06 — AppPasswordService unit tests
 * RED phase: written before implementation — modules do not exist yet
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import bcrypt from "bcrypt";

// ─── helpers ──────────────────────────────────────────────────────────────────

const VALID_PASSWORD = "SecurePassword123!";

// Reset module state between tests so the singleton is fresh
// (prefixed with _ because it is not called directly in this file;
// the beforeEach/afterEach pattern handles module isolation instead)
async function _freshBootstrap(password = VALID_PASSWORD) {
  vi.resetModules();
  process.env.APP_PASSWORD = password;
  const mod = await import("../../src/services/auth-bootstrap.js");
  await mod.bootstrapAuth();
  return mod;
}

// ─── password.ts ──────────────────────────────────────────────────────────────

describe("password.ts", () => {
  it("SC-PASS-01 — hashPassword returns $2b$12$ prefix (factor 12)", async () => {
    const { hashPassword } = await import("../../src/services/password.js");
    const hash = await hashPassword(VALID_PASSWORD);
    expect(hash).toMatch(/^\$2b\$12\$/);
  });

  it("SC-PASS-02 — verifyPassword returns true for correct password", async () => {
    const { hashPassword, verifyPassword } = await import("../../src/services/password.js");
    const hash = await hashPassword(VALID_PASSWORD);
    const result = await verifyPassword(VALID_PASSWORD, hash);
    expect(result).toBe(true);
  });

  it("SC-PASS-03 — verifyPassword returns false for wrong password", async () => {
    const { hashPassword, verifyPassword } = await import("../../src/services/password.js");
    const hash = await hashPassword(VALID_PASSWORD);
    const result = await verifyPassword("WrongPassword", hash);
    expect(result).toBe(false);
  });
});

// ─── auth-bootstrap.ts ────────────────────────────────────────────────────────

describe("auth-bootstrap.ts", () => {
  let originalPassword: string | undefined;

  beforeEach(() => {
    originalPassword = process.env.APP_PASSWORD;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalPassword === undefined) {
      delete process.env.APP_PASSWORD;
    } else {
      process.env.APP_PASSWORD = originalPassword;
    }
    vi.restoreAllMocks();
  });

  it("SC-PASS-04 — bootstrapAuth throws if APP_PASSWORD is not set", async () => {
    delete process.env.APP_PASSWORD;
    const { bootstrapAuth } = await import("../../src/services/auth-bootstrap.js");
    await expect(bootstrapAuth()).rejects.toThrow("APP_PASSWORD env var is required");
  });

  it("SC-PASS-05 — getPasswordHash throws if bootstrapAuth was never called", async () => {
    delete process.env.APP_PASSWORD;
    const { getPasswordHash } = await import("../../src/services/auth-bootstrap.js");
    expect(() => getPasswordHash()).toThrow("Auth not bootstrapped");
  });

  it("SC-PASS-06 — bootstrapAuth is idempotent — hash is not recalculated on second call", async () => {
    process.env.APP_PASSWORD = VALID_PASSWORD;
    const { bootstrapAuth, getPasswordHash } = await import(
      "../../src/services/auth-bootstrap.js"
    );

    // Spy BEFORE first call
    const hashSpy = vi.spyOn(bcrypt, "hash");

    await bootstrapAuth();
    const hash1 = getPasswordHash();

    await bootstrapAuth(); // second call — must not rehash
    const hash2 = getPasswordHash();

    expect(hash1).toBe(hash2);
    // bcrypt.hash should have been called exactly once (only on first bootstrapAuth)
    expect(hashSpy).toHaveBeenCalledTimes(1);
  });
});
