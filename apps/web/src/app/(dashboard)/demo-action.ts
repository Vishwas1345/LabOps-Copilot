'use server';

import { redirect } from 'next/navigation';
import { apiRequest } from '@/lib/api';
import { acceptedSchema } from '@/lib/schemas';

// The same two scenarios the live demo seeds (apps/api/src/seed-demo.ts).
const SCENARIOS = ['training-event', 'shared-outages'] as const;

// The API registers the demo route only when DEMO_ENABLED; a 404 means off.
export async function runDemoScenario(): Promise<void> {
  for (const scenario of SCENARIOS) {
    const result = await apiRequest(`/api/demo/scenarios/${scenario}`, acceptedSchema, {
      method: 'POST',
      body: { seed: 42 },
    });
    if (!result.ok) redirect('/?demo=unavailable');
  }
  redirect('/');
}
