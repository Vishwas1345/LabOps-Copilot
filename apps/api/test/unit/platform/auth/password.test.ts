import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../../../src/platform/auth/password.js';

describe('password hashing', () => {
  it('verifies the right password', async () => {
    const stored = await hashPassword('correct horse battery staple');

    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  // Negative: a near miss must fail, not just an unrelated string.
  it('rejects a wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple');

    expect(await verifyPassword('correct horse battery stapl', stored)).toBe(false);
  });

  it('salts every hash, so equal passwords hash differently', async () => {
    const [first, second] = await Promise.all([hashPassword('same'), hashPassword('same')]);

    expect(first).not.toBe(second);
    expect(first).not.toContain('same');
  });

  // Negative: a corrupt or foreign hash fails closed instead of throwing.
  it.each([
    ['empty', ''],
    ['other scheme', 'bcrypt$2b$10$abc'],
    ['missing parts', 'scrypt$32768$8$1$c2FsdA'],
    ['short hash', 'scrypt$32768$8$1$c2FsdA$c2hvcnQ'],
    ['bad cost', 'scrypt$abc$8$1$c2FsdA$c2hvcnQ'],
  ])('rejects a malformed stored hash (%s)', async (_label, stored) => {
    expect(await verifyPassword('anything', stored)).toBe(false);
  });
});
