'use client';

// Counts a headline number up from zero once, on mount. The server renders the
// final value, so it reads correctly before hydration, without JavaScript and
// for screen readers; reduced motion skips the animation entirely.

import { useEffect, useState } from 'react';

const DURATION_MS = 900;

export function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (value === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / DURATION_MS);
      // Ease out: fast at first, settling onto the real number.
      setShown(Math.round(value * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span aria-label={String(value)}>{shown}</span>;
}
