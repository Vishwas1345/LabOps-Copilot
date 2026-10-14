// Which live events should refresh which page. Events are only "something
// changed" signals: the page re-reads everything from the API on refresh.

import { z } from 'zod';

const feedEvent = z.object({ action: z.string(), incidentId: z.string().nullable() });

/**
 * An incident page cares about its own incident; any other page (overview,
 * lists) cares about everything. Unparseable data is ignored, never trusted.
 */
export function isRelevant(data: string, incidentId?: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return false;
  }
  const event = feedEvent.safeParse(parsed);
  if (!event.success) return false;
  return incidentId === undefined || event.data.incidentId === incidentId;
}

/** The incident a dashboard path shows: `/incidents/<id>`, else none. */
export function incidentFromPath(pathname: string | null): string | undefined {
  const match = /^\/incidents\/([a-z0-9]{1,64})\/?$/i.exec(pathname ?? '');
  return match?.[1];
}
