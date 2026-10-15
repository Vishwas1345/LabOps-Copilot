// Credential sealing at rest: AES-256-GCM with a key from the environment, the
// same trust model as DATABASE_URL. Rotation means re-sealing every row, which
// `keyVersion` keeps contained. Trade-offs: ARCHITECTURE.md section 13.

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
    // Wrong key and altered bytes read the same, so a probe learns nothing.
    super('stored credential could not be read');
    this.name = 'SecretDecryptionError';
  }
}

/** CREDENTIALS_KEY is base64 of exactly 32 bytes; anything else is no key. */
export function parseCredentialsKey(value: string | undefined): Buffer {
  const key = Buffer.from(value ?? '', 'base64');
  if (key.length !== KEY_BYTES) throw new SecretUnavailableError();
  return key;
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