// The reset drops a schema, so it runs against a database this file creates
// and drops, never the shared test database.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../../src/db.js';
import { ResetRefused, resetDemoDatabase, withBootLock } from '../../../../src/modules/demo/reset.js';

const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const name = `labops_reset_${process.pid}`;
const url = new URL(process.env.DATABASE_URL ?? '');
url.pathname = `/${name}`;
const scratch = new PrismaClient({ datasourceUrl: url.toString() });
// A threshold in the future treats any activity as old, so the demo resets.
const always = () => new Date(Date.now() + 60_000);
const singleConnection = () => {
  const one = new URL(url);
  one.searchParams.set('connection_limit', '1');
  return new PrismaClient({ datasourceUrl: one.toString() });
};
const audit = (createdAt?: Date) =>
  scratch.auditEntry.create({
    data: { actorType: 'system', actorId: 'test', action: 'scenario.run', targetType: 'scenario', targetId: 's', outcome: 'created', createdAt },
  });

const migrate = () =>
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
const tableExists = async (table: string) =>
  (await scratch.$queryRaw<[{ found: boolean }]>`SELECT to_regclass(${table}) IS NOT NULL AS found`)[0].found;

beforeEach(async () => {
  await scratch.$disconnect();
  await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await prisma.$executeRawUnsafe(`CREATE DATABASE ${name}`);
});

afterAll(async () => {
  await scratch.$disconnect();
  await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await prisma.$disconnect();
});

describe('resetDemoDatabase', () => {
  it('leaves a never-migrated database alone', async () => {
    expect(await resetDemoDatabase(scratch, always())).toBe('empty');
  });

  it('drops a demo database completely, audit trail included, so it can migrate again', async () => {
    migrate();
    await scratch.lab.create({ data: { name: 'demo-lab' } });
    await audit();

    expect(await resetDemoDatabase(scratch, always())).toBe('reset');

    expect(await tableExists('"Lab"')).toBe(false);
    expect(await tableExists('"AuditEntry"')).toBe(false);
    expect(await tableExists('"_prisma_migrations"')).toBe(false);
    migrate();
    expect(await scratch.lab.count()).toBe(0);
  });

  // A deploy starts a new container beside one that is serving: the demo in
  // use must survive the new container's boot.
  it('keeps a demo with activity after the idle threshold', async () => {
    migrate();
    await scratch.lab.create({ data: { name: 'demo-lab' } });
    await audit();

    expect(await resetDemoDatabase(scratch, new Date(Date.now() - 10 * 60_000))).toBe('kept');
    expect(await scratch.lab.count()).toBe(1);
  });

  it('resets a demo whose last activity is older than the threshold', async () => {
    migrate();
    await audit(new Date(Date.now() - 60 * 60_000));

    expect(await resetDemoDatabase(scratch, new Date(Date.now() - 10 * 60_000))).toBe('reset');
  });

  // Negative: a database holding anything a provider sent is not a demo.
  it('refuses to wipe a database with non-simulated data, and leaves it intact', async () => {
    migrate();
    await scratch.lab.create({ data: { name: 'real-lab', source: 'provider' } });

    await expect(resetDemoDatabase(scratch, always())).rejects.toBeInstanceOf(ResetRefused);
    expect(await scratch.lab.count()).toBe(1);
  });
});

describe('withBootLock', () => {
  // Negative: two containers booting at once must never interleave. Without the
  // lock one reset dropped the tables between the other's migrate and seed.
  it('runs two boots one after the other, never together', async () => {
    const [a, b] = [singleConnection(), singleConnection()];
    const spans: Array<[number, number]> = [];
    const boot = (db: PrismaClient) =>
      withBootLock(db, async () => {
        const start = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 300));
        spans.push([start, Date.now()]);
      });
    try {
      await Promise.all([boot(a), boot(b)]);
    } finally {
      await Promise.all([a.$disconnect(), b.$disconnect()]);
    }
    const [first, second] = spans.sort((x, y) => x[0] - y[0]);
    expect(second[0]).toBeGreaterThanOrEqual(first[1]);
  });
});
