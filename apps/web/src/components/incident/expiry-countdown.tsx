'use client';

// How long an approval stays valid. After it lapses the worker refuses the
// action, so the countdown is the operator's real deadline.

import { useEffect, useState } from 'react';
import { formatDateTime } from '@/lib/format';

function remaining(expiresAt: string, now: number): string {
  const seconds = Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000));
  if (seconds === 0) return 'expired';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')} left`;
}

export function ExpiryCountdown({ expiresAt }: { expiresAt: string | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!expiresAt) return null;
  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      Expires {formatDateTime(expiresAt)}
      {/* Rendered after mount only: the server's clock would not match the browser's. */}
      {now !== null && <span className="ml-1.5 font-medium text-foreground">· {remaining(expiresAt, now)}</span>}
    </span>
  );
}
