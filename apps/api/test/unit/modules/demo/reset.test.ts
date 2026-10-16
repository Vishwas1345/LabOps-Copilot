import { describe, expect, it } from 'vitest';
import { resetAllowed } from '../../../../src/modules/demo/reset.js';

describe('resetAllowed', () => {
  it('allows a reset only with the flag on a production host', () => {
    expect(resetAllowed({ DEMO_RESET_ON_BOOT: 'true', APP_ENV: 'production' })).toBe(true);
  });

  // Negative: either switch alone, or a near miss, must never wipe a database.
  it.each([
    [{}],
    [{ DEMO_RESET_ON_BOOT: 'true' }],
    [{ APP_ENV: 'production' }],
    [{ DEMO_RESET_ON_BOOT: 'true', APP_ENV: 'development' }],
    [{ DEMO_RESET_ON_BOOT: '1', APP_ENV: 'production' }],
    [{ DEMO_RESET_ON_BOOT: 'TRUE', APP_ENV: 'production' }],
  ])('refuses %o', (env) => {
    expect(resetAllowed(env)).toBe(false);
  });
});
