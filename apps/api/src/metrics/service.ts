// The operator metrics view. Each number is derived from committed rows by the
// module that owns them, so it counts both processes, survives a restart and
// cannot disagree with the audit trail (ARCHITECTURE.md section 12).

import { prisma } from '../db.js';
import type { EventStats } from '../events/stats.js';
import { eventsReceivedSince } from '../events/stats.js';
import type { IncidentStats } from '../incidents/stats.js';
import { incidentStats } from '../incidents/stats.js';
import type { InvestigationStats } from '../investigations/stats.js';
import { investigationStats } from '../investigations/stats.js';
import type { QueueStats } from '../jobs/stats.js';
import { queueStats } from '../jobs/stats.js';
import type { RecoveryStats } from '../recovery/stats.js';
import { recoveryStats } from '../recovery/stats.js';

export interface Metrics {
  window: { hours: number; since: string };
  events: EventStats;
  incidents: IncidentStats;
  queues: QueueStats[];
  investigations: InvestigationStats;
  recovery: RecoveryStats;
  /**
   * The live stream only delivers rows older than the oldest open transaction,
   * so a long one delays every update. Null when none is open.
   */
  oldestOpenTransactionMs: number | null;
}

// Only xact_start is read: the query column could hold another session's data.
async function oldestOpenTransactionMs(): Promise<number | null> {
  const [row] = await prisma.$queryRaw<[{ ms: number | null }]>`
    SELECT EXTRACT(EPOCH FROM now() - min(xact_start))::float8 * 1000 AS ms
    FROM pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid() AND xact_start IS NOT NULL`;
  return row.ms === null ? null : Math.round(row.ms);
}

export async function collectMetrics(hours: number, now = new Date()): Promise<Metrics> {
  const since = new Date(now.getTime() - hours * 3_600_000);
  const [received, incidents, queues, investigations, recovery, oldest] = await Promise.all([
    eventsReceivedSince(since),
    incidentStats(since),
    queueStats(since),
    investigationStats(since),
    recoveryStats(since),
    oldestOpenTransactionMs(),
  ]);
  return {
    window: { hours, since: since.toISOString() },
    events: { received },
    incidents,
    queues,
    investigations,
    recovery,
    oldestOpenTransactionMs: oldest,
  };
}
