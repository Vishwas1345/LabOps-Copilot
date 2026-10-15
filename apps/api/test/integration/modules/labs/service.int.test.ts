import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { Actor } from '../../../../src/platform/audit/audit.js';
import { prisma } from '../../../../src/db.js';
import type { LabStatus } from '../../../../src/modules/labs/transitions.js';
import { IllegalTransitionError } from '../../../../src/modules/labs/transitions.js';
import {
  ConcurrentTransitionError,
  LabNotFoundError,
  transitionLab,
} from '../../../../src/modules/labs/service.js';

const ACTOR: Actor = { type: 'system', id: 'labs-service-test' };
const created: string[] = [];

afterEach(async () => {
  await prisma.lab.deleteMany({ where: { id: { in: created.splice(0) } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function labIn(status: LabStatus) {
  const lab = await prisma.lab.create({
    data: { name: 'transition-test', status },
  });
  created.push(lab.id);
  return lab.id;
}

function auditFor(labId: string) {
  return prisma.auditEntry.findMany({
    where: { targetType: 'lab', targetId: labId },
    orderBy: { seq: 'asc' },
  });
}

/** Polls Postgres until some transaction is waiting on a row lock. */
async function waitForBlockedLock(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [{ waiting }] = await prisma.$queryRaw<[{ waiting: bigint }]>`
      SELECT count(*) AS waiting FROM pg_locks WHERE NOT granted`;
    if (waiting > 0n) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('no transaction ever blocked on the row lock');
}

async function statusOf(labId: string) {
  return (await prisma.lab.findUniqueOrThrow({ where: { id: labId } })).status;
}

describe('transitionLab', () => {
  it('applies a legal transition and records it', async () => {
    const id = await labIn('failed');

    const result = await prisma.$transaction((tx) =>
      transitionLab(tx, id, 'recovering', ACTOR, { reason: 'approved retry' }),
    );

    expect(result).toEqual({ from: 'failed', to: 'recovering' });
    expect(await statusOf(id)).toBe('recovering');
    const audit = await auditFor(id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'lab.transition',
      actorType: 'system',
      actorId: 'labs-service-test',
      outcome: 'applied',
      metadata: { from: 'failed', to: 'recovering', reason: 'approved retry' },
    });
  });

  // Negative: the map is enforced, and a rejected move leaves no trace.
  it('rejects an illegal transition and writes nothing', async () => {
    const id = await labIn('ready');

    await expect(
      prisma.$transaction((tx) => transitionLab(tx, id, 'recovering', ACTOR)),
    ).rejects.toThrow(IllegalTransitionError);

    expect(await statusOf(id)).toBe('ready');
    expect(await auditFor(id)).toHaveLength(0);
  });

  it('rejects an unknown lab', async () => {
    await expect(
      prisma.$transaction((tx) =>
        transitionLab(tx, 'no-such-lab', 'ready', ACTOR),
      ),
    ).rejects.toThrow(LabNotFoundError);
  });

  // Negative: state and audit are one unit. If anything later in the same
  // transaction fails, neither the status change nor its entry survives.
  it('rolls back status and audit together', async () => {
    const id = await labIn('failed');

    await expect(
      prisma.$transaction(async (tx) => {
        await transitionLab(tx, id, 'recovering', ACTOR);
        throw new Error('later step failed');
      }),
    ).rejects.toThrow('later step failed');

    expect(await statusOf(id)).toBe('failed');
    expect(await auditFor(id)).toHaveLength(0);
  });

  // Negative: two transitions racing from the same state cannot both win.
  // The interleaving is forced, not hoped for: A writes and holds its row
  // lock uncommitted; B reads the old status (A is invisible to it), then
  // blocks on A's lock. Only once Postgres reports B as waiting does A
  // commit. Without the compare-and-set, B would then overwrite A.
  it('refuses a transition based on a status another transaction changed', async () => {
    const id = await labIn('failed');

    let signalWritten!: () => void;
    const written = new Promise<void>((resolve) => (signalWritten = resolve));
    let releaseA!: () => void;
    const aMayCommit = new Promise<void>((resolve) => (releaseA = resolve));

    const txA = prisma.$transaction(
      async (tx) => {
        await transitionLab(tx, id, 'recovering', ACTOR);
        signalWritten();
        await aMayCommit;
      },
      { timeout: 10_000 },
    );
    await written;

    const txB = prisma.$transaction(
      (tx) => transitionLab(tx, id, 'stopped', ACTOR),
      { timeout: 10_000 },
    );
    await waitForBlockedLock();
    releaseA();

    await txA;
    await expect(txB).rejects.toThrow(ConcurrentTransitionError);
    expect(await statusOf(id)).toBe('recovering');
    expect(await auditFor(id)).toHaveLength(1);
  });

  it('rejects a status outside the database enum', async () => {
    const id = await labIn('ready');

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "Lab" SET status = 'exploded' WHERE id = '${id}'`,
      ),
    ).rejects.toThrow(/invalid input value for enum/);
  });
});
