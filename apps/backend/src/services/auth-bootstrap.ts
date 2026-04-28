import { hashPassword } from "./password.js";

/**
 * Module-scoped singleton — the bcrypt hash of APP_PASSWORD.
 * Lives only in process memory; recalculated on each startup.
 */
let _passwordHash: string | null = null;

/**
 * Reads APP_PASSWORD from env, hashes it with bcrypt factor 12,
 * and stores the result in _passwordHash.
 *
 * Idempotent: if _passwordHash is already set, returns immediately.
 * Throws if APP_PASSWORD is missing or empty.
 */
export async function bootstrapAuth(): Promise<void> {
  if (_passwordHash !== null) return; // idempotent — do not rehash

  const plain = process.env.APP_PASSWORD;
  if (!plain || plain.length === 0) {
    throw new Error("APP_PASSWORD env var is required");
  }

  _passwordHash = await hashPassword(plain);
}

/**
 * Returns the stored bcrypt hash.
 * Throws if bootstrapAuth() was never called.
 */
export function getPasswordHash(): string {
  if (_passwordHash === null) {
    throw new Error("Auth not bootstrapped");
  }
  return _passwordHash;
}
