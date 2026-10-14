'use client';

// Re-renders the page from the server when a relevant change commits. The
// EventSource reconnects by itself and resumes from Last-Event-ID; a burst
// of events becomes one refresh.

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { isRelevant } from '@/lib/live';

const DEBOUNCE_MS = 300;

export function LiveRefresh({ incidentId }: { incidentId?: string }) {
  const router = useRouter();
  useEffect(() => {
    const source = new EventSource('/api/events/stream');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), DEBOUNCE_MS);
    };
    source.onmessage = (message: MessageEvent<string>) => {
      if (isRelevant(message.data, incidentId)) refresh();
    };
    // Too far behind to replay: reload everything.
    source.addEventListener('reset', refresh);
    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [incidentId, router]);
  return null;
}
