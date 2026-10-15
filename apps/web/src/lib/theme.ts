// The operator's theme choice. Absent means "follow the system"; the cookie
// value is checked, so only a known class name can reach the <html> element.

export const THEME_COOKIE = 'labops_theme';

export type Theme = 'light' | 'dark';

export function parseTheme(value: string | undefined): Theme | null {
  return value === 'light' || value === 'dark' ? value : null;
}
