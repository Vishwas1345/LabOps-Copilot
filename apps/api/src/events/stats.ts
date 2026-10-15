// Ingest volume for the metrics view, from committed events only.

import { prisma } from '../db.js';

export interface EventStats {
  /** A redelivered duplicate is never stored, so it is never counted. */
  received: number;
}

export function eventsReceivedSince(since: Date): Promise<number> {
  return prisma.operationalEvent.count({ where: { receivedAt: { gte: since } } });
}
