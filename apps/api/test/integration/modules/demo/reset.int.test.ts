// The reset drops a schema, so it runs against a database this file creates
// and drops, never the shared test database.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../../src/db.js';
import { ResetRefused, resetDemoDatabase } from '../../../../src/modules/demo/reset.js';

const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const name = `labops_reset_${process.pid}`;
const url = new URL(process.env.DATABASE_URL ?? '');
url.pathname = `/${name}`;
const scratch = new PrismaClient({ datasourceUrl: url.toString() });

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
    expect(await resetDemoDatabase(scratch)).toBe('empty');
  });

  it('drops a demo database completely, audit trail included, so it can migrate again', async () => {
    migrate();
    await scratch.lab.create({ data: { name: 'demo-lab' } });
    await scratch.auditEntry.create({
      data: { actorType: 'system', actorId: 'test', action: 'scenario.run', targetType: 'scenario', targetId: 's', outcome: 'created' },
    });

    expect(await resetDemoDatabase(scratch)).toBe('reset');

    expect(await tableExists('"Lab"')).toBe(false);
    expect(await tableExists('"AuditEntry"')).toBe(false);
    expect(await tableExists('"_prisma_migrations"')).toBe(false);
    migrate();
    expect(await scratch.lab.count()).toBe(0);
  });

  // Negative: a database holding anything a provider sent is not a demo.
  it('refuses to wipe a database with non-simulated data, and leaves it intact', async () => {
    migrate();
    await scratch.lab.create({ data: { name: 'real-lab', source: 'provider' } });

    await expect(resetDemoDatabase(scratch)).rejects.toBeInstanceOf(ResetRefused);
    expect(await scratch.lab.count()).toBe(1);
  });
});
