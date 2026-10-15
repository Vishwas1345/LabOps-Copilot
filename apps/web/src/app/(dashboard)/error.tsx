'use client';

// Any failed or malformed API response on a page lands here: an error state
// the operator can retry, never a crashed page or half-rendered data.

import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-danger-border bg-danger-bg px-6 py-10 text-center">
      <TriangleAlert className="size-6 text-danger" />
      <p className="text-sm font-medium text-danger">
        The API returned something this page could not use, or could not be reached.
      </p>
      <Button variant="outline" size="sm" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
