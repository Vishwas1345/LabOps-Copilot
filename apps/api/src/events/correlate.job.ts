// Placeholder correlate handler (Phase 4): proves the queue path end to end by
// counting the window's failures. Phase 5 replaces it with real correlation.

import type pino from 'pino';
import { z } from 'zod';
import { prisma } from '../db.js';

export const CORRELATION_WINDOW_MS = 10 * 60_000;

export const correlatePayload = z.object({ windowStart: z.iso.datetime() }).strict();

/** Events in the same ten-minute window share one correlate job. */
export function correlationWindow(occurredAt: Date): { start: Date; jobKey: string } {
  const bucket = Math.floor(occurredAt.getTime() / CORRELATION_WINDOW_MS);
  const start = new Date(bucket * CORRELATION_WINDOW_MS);
  // BullMQ job ids may not contain ':', so the key uses epoch milliseconds.
  return { start, jobKey: `correlate-${start.getTime()}` };
}

export async function handleCorrelate(
  payload: unknown,
  log: pino.Logger,
): Promise<{ failures: number }> {
  const { windowStart } = correlatePayload.parse(payload);
  const start = new Date(windowStart);
  const failures = await prisma.operationalEvent.count({
    where: {
      type: 'provision_failed',
      occurredAt: { gte: start, lt: new Date(start.getTime() + CORRELATION_WINDOW_MS) },
    },
  });
  log.info({ windowStart, failures }, 'correlation window received');
  return { failures };
}
