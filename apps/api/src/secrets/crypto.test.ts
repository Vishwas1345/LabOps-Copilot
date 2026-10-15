import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  openSecret,
  parseCredentialsKey,
  sealSecret,
  SecretDecryptionError,
  SecretUnavailableError,
} from './crypto.js';

const key = randomBytes(32);
const otherKey = randomBytes(32);

describe('parseCredentialsKey', () => {
  it('accepts base64 of exactly 32 bytes', () => {
    expect(parseCredentialsKey(key.toString('base64'))).toEqual(key);
  });

  // Negative: a wrong-sized key must be refused at startup, not at the first
  // save, where it would look like a corrupt credential instead.
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['too short', randomBytes(16).toString('base64')],
    ['too long', randomBytes(64).toString('base64')],
    ['not base64', '!!!!not-a-key!!!!'],
  ])('refuses a key that is %s', (_label, value) => {
    expect(() => parseCredentialsKey(value)).toThrow(SecretUnavailableError);
  });
});

describe('sealSecret / openSecret', () => {
  it('reads back exactly what was sealed', () => {
    const plaintext = 'secret-token-value';

    expect(openSecret(sealSecret(plaintext, key), key)).toBe(plaintext);
  });

  it.each([
    ['an api key', 'AIzaSyA-very-secret-looking-value'],
    ['a bearer token', 'Bearer abc.def.ghi'],
    ['unicode', 'clé-secrète-値'],
    ['a long credential', 'x'.repeat(4096)],
    ['an empty string', ''],
  ])('round-trips %s', (_label, plaintext) => {
    expect(openSecret(sealSecret(plaintext, key), key)).toBe(plaintext);
  });

  // The property that makes an IV worth having: identical input must not
  // produce identical ciphertext, or the store leaks which credentials repeat.
  it('never seals the same plaintext to the same bytes twice', () => {
    const first = sealSecret('repeated', key);
    const second = sealSecret('repeated', key);

    expect(first.equals(second)).toBe(false);
    expect(openSecret(first, key)).toBe('repeated');
    expect(openSecret(second, key)).toBe('repeated');
  });

  it('does not leave the plaintext anywhere in the sealed bytes', () => {
    const plaintext = 'super-secret-credential';
    const sealed = sealSecret(plaintext, key);

    expect(sealed.includes(Buffer.from(plaintext, 'utf8'))).toBe(false);
    expect(sealed.toString('utf8')).not.toContain(plaintext);
  });

  // Negative: a wrong key must fail closed, not return garbage.
  it('fails closed on the wrong key', () => {
    const sealed = sealSecret('secret', key);

    expect(() => openSecret(sealed, otherKey)).toThrow(SecretDecryptionError);
  });

  // Negative: tampering with any part must fail closed. Each byte position is
  // exercised because the layout is iv | tag | ciphertext.
  it.each([
    ['the iv', 0],
    ['the tag', 13],
    ['the ciphertext', 30],
  ])('fails closed when %s is altered', (_label, index) => {
    const sealed = sealSecret('secret-value-that-is-long-enough', key);
    sealed[index] = sealed[index] ^ 0xff;

    expect(() => openSecret(sealed, key)).toThrow(SecretDecryptionError);
  });

  it('fails closed on a truncated blob', () => {
    const sealed = sealSecret('secret', key);

    expect(() => openSecret(sealed.subarray(0, 10), key)).toThrow(SecretDecryptionError);
    expect(() => openSecret(Buffer.alloc(0), key)).toThrow(SecretDecryptionError);
  });

  // Negative: a wrong-key failure and a tampered-blob failure are
  // indistinguishable, because answering the difference is what a probe wants.
  it('gives the same error for a wrong key and for altered bytes', () => {
    const sealed = sealSecret('secret-value-long-enough-to-fill', key);
    const wrongKey = (() => {
      try {
        openSecret(sealed, otherKey);
        return null;
      } catch (error) {
        return (error as Error).message;
      }
    })();

    const tampered = Buffer.from(sealed);
    tampered[30] = tampered[30] ^ 0xff;
    const altered = (() => {
      try {
        openSecret(tampered, key);
        return null;
      } catch (error) {
        return (error as Error).message;
      }
    })();

    expect(wrongKey).toBe(altered);
    expect(wrongKey).not.toContain('key');
  });

  it('never puts the plaintext in the error message', () => {
    const secret = 'leaky-secret-value';
    const sealed = sealSecret(secret, key);

    try {
      openSecret(sealed, otherKey);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });
});