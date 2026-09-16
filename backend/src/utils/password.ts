import bcrypt from "bcryptjs";
import { env } from "../env.js";

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_SALT_ROUNDS);
}

export function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function passwordNeedsRehash(hash: string): boolean {
  try {
    return bcrypt.getRounds(hash) !== env.BCRYPT_SALT_ROUNDS;
  } catch {
    return false;
  }
}
