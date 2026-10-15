import { describe, expect, it } from 'vitest';
import { parseTheme } from '@/lib/theme';

describe('parseTheme', () => {
  it.each(['light', 'dark'] as const)('accepts %s', (theme) => {
    expect(parseTheme(theme)).toBe(theme);
  });

  // Negative: the value becomes a class name, so anything else is dropped.
  it.each([undefined, '', 'Dark', 'dark x', '"><script>'])('ignores %p', (value) => {
    expect(parseTheme(value)).toBeNull();
  });
});
