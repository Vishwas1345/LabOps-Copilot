// Credential sealing at rest.
//
// AES-256-GCM: the key comes from the environment, exactly as DATABASE_URL and
// REDIS_URL do. This is the same trust model the project already has, and it
// needs no new dependency. The weakness is stated rather than hidden: a key in
// the environment is readable by anything that can read the process, and
// rotating it means re-sealing every stored credential. `keyVersion` on the
// stored row is what keeps that a contained change later.
//
// GCM is authenticated, so a wrong key and a tampered blob fail the same way and
// identically: decryption throws. Neither is ever distinguishable, because
// telling them apart is exactly what an attacker probing the ciphertext wants.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Wire format: iv || tag || ciphertext. */
const HEADER_BYTES = IV_BYTES + TAG_BYTES;

export class SecretUnavailableError extends Error {
  constructor() {
    super('no credentials key is configured');
    this.name = 'SecretUnavailableError';
  }
}

export class SecretDecryptionError extends Error {
  constructor() {
    // Deliberately vague: whether the key was wrong or the bytes were altered
    // is not something an error message should answer.
    super('stored credential could not be read');
    this.name = 'SecretDecryptionError';
  }
}

/**
 * Parses CREDENTIALS_KEY: base64 of exactly 32 bytes. Rejects anything else at
 * startup rather than at the first credential save.
 */
export function parseCredentialsKey(value: string | undefined): Buffer {
  if (!value) throw new SecretUnavailableError();

  let key: Buffer;
  try {
    key = Buffer.from(value, 'base64');
  } catch {
    throw new SecretUnavailableError();
  }

  if (key.length !== KEY_BYTES) {
    throw new SecretUnavailableError();
  }
  return key;
}

export function encodeCredentialsKey(key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new SecretUnavailableError();
  }
  return key.toString('base64');
}

/** Seals a credential. The same input never seals to the same bytes twice. */
export function sealSecret(plaintext: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

/** Reads a sealed credential. Throws on a wrong key or altered bytes. */
export function openSecret(sealed: Buffer, key: Buffer): string {
  if (sealed.length < HEADER_BYTES) throw new SecretDecryptionError();

  try {
    const iv = sealed.subarray(0, IV_BYTES);
    const tag = sealed.subarray(IV_BYTES, HEADER_BYTES);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(sealed.subarray(HEADER_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new SecretDecryptionError();
  }
}