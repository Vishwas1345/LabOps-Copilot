// Password hashing with node:crypto scrypt; no dependency needed. Parameters
// travel with each hash, so they can be raised later without breaking logins.

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// N=2^15, r=8 costs ~32 MB and tens of ms per hash: slow for guessing, fine
// for a login. maxmem must exceed 128 * N * r or Node refuses.
const COST = { N: 2 ** 15, r: 8, p: 1 } as const;
const MAX_MEMORY = 64 * 1024 * 1024;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function derive(
  password: string,
  salt: Buffer,
  cost: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { ...cost, maxmem: MAX_MEMORY }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** Returns `scrypt$N$r$p$salt$hash`, salt and hash in base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, COST);
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64url'), key.toString('base64url')]
    .join('$');
}

/** Constant-time comparison; a malformed stored hash never matches. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (scheme !== 'scrypt' || !salt || !hash || !Object.values(cost).every(Number.isInteger)) {
    return false;
  }
  const expected = Buffer.from(hash, 'base64url');
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await derive(password, Buffer.from(salt, 'base64url'), cost);
  return timingSafeEqual(actual, expected);
}
