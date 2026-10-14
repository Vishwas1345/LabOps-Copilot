import type { ActorType, Prisma } from '@prisma/client';
import { redactSecrets } from '../observability/redact.js';

/**
 * The only write path into AuditEntry. It takes the caller's transaction
 * client rather than the global one, so a state change and the entry
 * describing it commit or roll back together (CLAUDE.md 6). There is no
 * update or delete function: the table is append-only, and a database
 * trigger enforces that even for code that bypasses this module.
 */

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
      // Callers build metadata from our own values, but audit rows live
      // forever, so a secret-named key is censored before it can be stored.
      metadata: entry.metadata
        ? (redactSecrets(entry.metadata) as Prisma.InputJsonObject)
        : undefined,
    },
  });
}
