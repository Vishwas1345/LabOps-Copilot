// @vitest-environment node
import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config.mjs';

describe('security headers', () => {
  it('sends the hardening headers on every path', async () => {
    const rules = await nextConfig.headers?.();
    expect(rules).toHaveLength(1);
    expect(rules?.[0].source).toBe('/:path*');
    expect(Object.fromEntries(rules![0].headers.map((h) => [h.key, h.value]))).toEqual({
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    });
  });

  // Negative: the framework banner tells an attacker which version to target.
  it('does not advertise the framework', () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
