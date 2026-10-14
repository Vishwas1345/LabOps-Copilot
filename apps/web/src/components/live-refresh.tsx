'use client';

// One live stream per tab, mounted in the dashboard layout, which stays
// mounted across navigation: a per-page stream reopened on every click, and
// each closed one held an API stream open for about a minute (Next notices a
// gone browser late). The page filter follows the URL without reconnecting.
// A burst of events becomes one refresh; EventSource resumes by itself.

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { incidentFromPath, isRelevant } from '@/lib/live';

const DEBOUNCE_MS = 300;

export function LiveRefresh() {
  // Refs, not effect dependencies: the stream opens once, on mount, whatever
  // the page or the router instance does afterwards.
  const router = useRef(useRouter());
  const incidentId = useRef<string | undefined>(undefined);
  incidentId.current = incidentFromPath(usePathname());

  useEffect(() => {
    const source = new EventSource('/api/events/stream');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.current.refresh(), DEBOUNCE_MS);
    };
    source.onmessage = (message: MessageEvent<string>) => {
      if (isRelevant(message.data, incidentId.current)) refresh();
    };
    // Too far behind to replay: reload everything.
    source.addEventListener('reset', refresh);
    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, []);
  return null;
}
