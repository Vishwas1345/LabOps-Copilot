'use server';

import { redirect } from 'next/navigation';
import { apiRequest } from '@/lib/api';
import { acceptedSchema } from '@/lib/schemas';

// The API registers the demo route only when DEMO_ENABLED; a 404 means off.
export async function runDemoScenario(): Promise<void> {
  const result = await apiRequest('/api/demo/scenarios/training-event', acceptedSchema, {
    method: 'POST',
    body: { seed: 42 },
  });
  redirect(result.ok ? '/' : '/?demo=unavailable');
}
