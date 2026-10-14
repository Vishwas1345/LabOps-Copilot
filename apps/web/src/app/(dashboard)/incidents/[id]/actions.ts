'use server';

// Operator decisions on one incident. Every id is checked before it reaches
// the API, and the API's own guard and policy checks still decide.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiRequest } from '@/lib/api';
import { isId } from '@/lib/queries';
import { acceptedSchema } from '@/lib/schemas';

async function settle(incidentId: string, ok: boolean, code: string): Promise<never> {
  revalidatePath(`/incidents/${incidentId}`);
  redirect(ok ? `/incidents/${incidentId}` : `/incidents/${incidentId}?notice=${code}`);
}

export async function investigate(incidentId: string): Promise<void> {
  if (!isId(incidentId)) redirect('/incidents');
  const result = await apiRequest(`/api/incidents/${incidentId}/investigate`, acceptedSchema, {
    method: 'POST',
  });
  await settle(incidentId, result.ok, result.ok ? '' : result.code);
}

export async function decide(
  incidentId: string,
  actionId: string,
  decision: 'approve' | 'reject',
): Promise<void> {
  if (!isId(incidentId) || !isId(actionId) || !['approve', 'reject'].includes(decision)) {
    redirect('/incidents');
  }
  const result = await apiRequest(`/api/recovery-actions/${actionId}/${decision}`, acceptedSchema, {
    method: 'POST',
  });
  await settle(incidentId, result.ok, result.ok ? '' : result.code);
}
