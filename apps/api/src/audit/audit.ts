import type { ActorType, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { redactSecrets } from '../observability/redact.js';

// The only path into AuditEntry. Writes take the caller's transaction so a
// change and its entry commit together; a DB trigger makes the table append-only.

export interface Actor {
  type: ActorType;
  id: string;
}

export interface AuditEntryInput {
  actor: Actor;
  /** Dotted verb, e.g. `lab.transition`. */
  action: string;
  targetType: string;
  targetId: string;
  outcome: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

export async function writeAudit(
  tx: Prisma.TransactionClient,
  entry: AuditEntryInput,
): Promise<void> {
  await tx.auditEntry.create({
    data: {
      actorType: entry.actor.type,
      actorId: entry.actor.id,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      outcome: entry.outcome,
      correlationId: entry.correlationId,
      // Audit rows live forever, so secret-named keys never get stored.
      metadata: entry.metadata
        ? (redactSecrets(entry.metadata) as Prisma.InputJsonObject)
        : undefined,
    },
  });
}

export interface AuditEntryView {
  /** Commit order; a string because it is a bigint. */
  seq: string;
  actorType: ActorType;
  actorId: string;
  action: string;
  outcome: string;
  metadata: unknown;
  createdAt: string;
}

// Bounded: one target's history is small, and an unbounded read is a
// footgun on an append-only table that only grows.
const MAX_TARGET_ENTRIES = 500;

/** One target's history, in commit order. */
export async function listAuditFor(
  targetType: string,
  targetId: string,
): Promise<AuditEntryView[]> {
  const rows = await prisma.auditEntry.findMany({
    where: { targetType, targetId },
    orderBy: { seq: 'asc' },
    take: MAX_TARGET_ENTRIES,
  });
  return rows.map((row) => ({
    seq: row.seq.toString(),
    actorType: row.actorType,
    actorId: row.actorId,
    action: row.action,
    outcome: row.outcome,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  }));
}
