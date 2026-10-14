import type { ActorType, Prisma } from '@prisma/client';
import { redactSecrets } from '../observability/redact.js';

// The only write path into AuditEntry. Takes the caller's transaction so a
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
