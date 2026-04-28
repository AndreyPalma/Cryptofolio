import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;

/**
 * Hashes a plaintext password with bcrypt factor 12.
 * Should only be called once per process (during bootstrap).
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/**
 * Compares a plaintext password against a bcrypt hash.
 * Always runs bcrypt.compare to completion — no early-exit.
 * Returns false (never throws) if comparison fails for any reason.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
