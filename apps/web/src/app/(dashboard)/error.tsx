'use client';

// Any failed or malformed API response on a page lands here: an error state
// the operator can retry, never a crashed page or half-rendered data.

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Alert variant="destructive" className="space-y-3">
      <p>The API returned something this page could not use, or could not be reached.</p>
      <Button variant="outline" size="sm" onClick={reset}>
        Try again
      </Button>
    </Alert>
  );
}
