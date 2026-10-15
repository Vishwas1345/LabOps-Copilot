import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { signedInCookie } from '../fixtures/session.fixture.js';
import { loadConfig } from '../../src/platform/config/env.js';
import { prisma } from '../../src/db.js';

// Runs against the real, migrated database. Proves the harness itself works:
// config loads from the environment, Prisma connects, and the routes read
// real rows rather than mocks.

const app = await buildApp({ config: loadConfig() });

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('api against a real database', () => {
  it('reports the database as up', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      service: 'labops-api',
      status: 'ok',
      checks: { database: 'up' },
    });
  });

  it('lists a lab that exists in the database', async () => {
    const lab = await prisma.lab.create({
      data: { name: 'int-test-lab', status: 'ready' },
    });

    try {
      const { cookie } = await signedInCookie();
      const response = await app.inject({ method: 'GET', url: '/api/labs', headers: { cookie } });

      expect(response.statusCode).toBe(200);
      const ids = (response.json().data as Array<{ id: string }>).map(
        (item) => item.id,
      );
      expect(ids).toContain(lab.id);
    } finally {
      await prisma.lab.delete({ where: { id: lab.id } });
    }
  });
});
