'use client';

// While something on the page is in flight (an investigation or a recovery),
// re-render from the server every few seconds; stop once it settles. Live
// updates over SSE (Phase 10) replace the timer with "refresh on event".

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const INTERVAL_MS = 2_000;

export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active, router]);
  return active ? <p className="text-xs text-muted-foreground">Updating while work is in progress…</p> : null;
}
