'use client';

// Flips between light and dark and remembers the choice in a cookie, which the
// root layout reads, so the next page renders in the right theme with no flash.

import { SunMoon } from 'lucide-react';
import { THEME_COOKIE } from '@/lib/theme';

const YEAR_SECONDS = 365 * 24 * 60 * 60;

export function ThemeToggle() {
  const toggle = () => {
    const root = document.documentElement;
    const dark = root.classList.contains('dark')
      || (!root.classList.contains('light') && matchMedia('(prefers-color-scheme: dark)').matches);
    const next = dark ? 'light' : 'dark';
    root.classList.remove('light', 'dark');
    root.classList.add(next);
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${YEAR_SECONDS}; samesite=lax`;
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {/* One icon: with no cookie the theme follows the system, which the
          server cannot see, so a sun-or-moon choice could be wrong. */}
      <SunMoon className="size-4" />
    </button>
  );
}
