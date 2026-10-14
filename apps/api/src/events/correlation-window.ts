// The correlate job's contract: which ten-minute window a failure arms, and
// the payload the job carries. Events produces it; incidents consumes it.

import { z } from 'zod';

export const CORRELATION_WINDOW_MS = 10 * 60_000;

export const correlatePayload = z.object({ windowStart: z.iso.datetime() }).strict();

/** Events in the same ten-minute window share one correlate job. */
export function correlationWindow(occurredAt: Date): { start: Date; jobKey: string } {
  const bucket = Math.floor(occurredAt.getTime() / CORRELATION_WINDOW_MS);
  const start = new Date(bucket * CORRELATION_WINDOW_MS);
  // BullMQ job ids may not contain ':', so the key uses epoch milliseconds.
  return { start, jobKey: `correlate-${start.getTime()}` };
}
