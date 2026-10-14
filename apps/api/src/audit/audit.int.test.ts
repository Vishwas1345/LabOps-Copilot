import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../db.js';
import { writeAudit } from './audit.js';

// The append-only guarantee is a database property, so it is tested against
// the real database. Rows written here are never cleaned up: they cannot be,
// which is the point. Each test uses a fresh targetId to stay independent.

afterAll(async () => {
  await prisma.$disconnect();
});

async function writeOne(targetId: string) {
  await prisma.$transaction((tx) =>
    writeAudit(tx, {
      actor: { type: 'system', id: 'audit-test' },
      action: 'test.write',
      targetType: 'test',
      targetId,
      outcome: 'ok',
      metadata: { note: 'hello', nested: { apiToken: 'sk-should-not-persist' } },
    }),
  );
  return prisma.auditEntry.findFirstOrThrow({ where: { targetId } });
}

describe('AuditEntry', () => {
  it('stores an entry with a sequence number', async () => {
    const entry = await writeOne(randomUUID());

    expect(entry.action).toBe('test.write');
    expect(typeof entry.seq).toBe('bigint');
  });

  it('assigns strictly increasing seq values', async () => {
    const first = await writeOne(randomUUID());
    const second = await writeOne(randomUUID());

    expect(second.seq > first.seq).toBe(true);
  });

  it('redacts secret-named keys before storing metadata', async () => {
    const entry = await writeOne(randomUUID());

    expect(JSON.stringify(entry.metadata)).not.toContain('sk-should-not-persist');
    expect(entry.metadata).toMatchObject({ note: 'hello' });
  });

  // Negative cases: history cannot be rewritten, whoever tries.
  it('rejects UPDATE at the database', async () => {
    const entry = await writeOne(randomUUID());

    await expect(
      prisma.auditEntry.update({
        where: { id: entry.id },
        data: { outcome: 'rewritten' },
      }),
    ).rejects.toThrow(/append-only/);
  });

  it('rejects DELETE at the database', async () => {
    const entry = await writeOne(randomUUID());

    await expect(
      prisma.auditEntry.delete({ where: { id: entry.id } }),
    ).rejects.toThrow(/append-only/);
  });

  it('rejects raw SQL UPDATE, DELETE and TRUNCATE too', async () => {
    const entry = await writeOne(randomUUID());

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "AuditEntry" SET outcome = 'x' WHERE id = '${entry.id}'`,
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "AuditEntry" WHERE id = '${entry.id}'`),
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.$executeRawUnsafe('TRUNCATE "AuditEntry"'),
    ).rejects.toThrow(/append-only/);
  });

  it('rejects an actor type outside the enum', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "AuditEntry" (id, "actorType", "actorId", action, "targetType", "targetId", outcome)
         VALUES ('${randomUUID()}', 'robot', 'x', 'a', 't', 't', 'o')`,
      ),
    ).rejects.toThrow(/invalid input value for enum/);
  });
});
