// The approval expiry sweep, run on the worker's tick. Correctness never
// depends on it (approve and execute both check expiry themselves); it moves
// abandoned proposals out of awaiting_approval so incidents do not sit there.

import { prisma } from '../../../db.js';
import type { LockedAction } from './approve.js';
import { expireAction } from './approve.js';

const SWEEPER = { type: 'system', id: 'approval-expiry-sweep' } as const;
// Bounded per tick; the next tick takes the rest.
const MAX_PER_SWEEP = 100;

export async function expireStaleApprovals(now: Date = new Date()): Promise<number> {
  const due = await prisma.recoveryAction.findMany({
    where: { status: 'awaiting_approval', expiresAt: { lte: now } },
    select: { id: true },
    orderBy: { expiresAt: 'asc' },
    take: MAX_PER_SWEEP,
  });
  let expired = 0;
  for (const { id } of due) {
    const done = await prisma.$transaction(async (tx) => {
      // SKIP LOCKED: another worker's sweep, or an approval deciding this row
      // right now, owns it; that one settles it and this sweep moves on.
      const [action] = await tx.$queryRaw<LockedAction[]>`
        SELECT id, "incidentId", status, "expiresAt", "approvedAt" FROM "RecoveryAction"
        WHERE id = ${id} AND status = 'awaiting_approval' AND "expiresAt" <= ${now}
        FOR UPDATE SKIP LOCKED`;
      if (!action) return false;
      await expireAction(tx, action, SWEEPER);
      return true;
    });
    if (done) expired += 1;
  }
  return expired;
}
