/**
 * Crypto primitives: constant-time comparison + scrypt password hashing.
 *
 * Runtime is Node, so node:crypto is available. `safeEqual` hashes both inputs to
 * fixed 32-byte digests before timingSafeEqual so it never throws on length
 * mismatch and never leaks raw input length.
 */
import { createHash, timingSafeEqual, randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

export function safeEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}

/** Opaque random URL-safe token (invite tokens, etc.). */
export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Hash a password with scrypt. Output format: `scrypt$<saltHex>$<hashHex>`.
 * The salt is embedded so verifyPassword needs only the stored string.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/** Verify a password against a stored `scrypt$salt$hash` string (constant-time). */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const derived = (await scrypt(password, salt, expected.length)) as Buffer;
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
