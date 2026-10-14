import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../db.js';

const SEED = 4242;
const PREFIX = `sim-training-event-${SEED}-`;
const RUN_ID = `training-event:${SEED}`;
const URL = '/api/demo/scenarios/training-event';

const CORS_ORIGIN = 'http://localhost:3000';
const enabled = await buildApp({ config: { CORS_ORIGIN, DEMO_ENABLED: true } });
const disabled = await buildApp({ config: { CORS_ORIGIN, DEMO_ENABLED: false } });

async function removeScenarioRows() {
  await prisma.lab.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.dependency.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

beforeEach(removeScenarioRows);

afterAll(async () => {
  await removeScenarioRows();
  await enabled.close();
  await disabled.close();
  await prisma.$disconnect();
});

const run = (app: typeof enabled, payload: unknown = { seed: SEED }) =>
  app.inject({ method: 'POST', url: URL, payload: payload as object });

describe('POST /api/demo/scenarios/:name', () => {
  // Negative: with the flag off the route must not exist at all.
  it('does not exist when DEMO_ENABLED is false', async () => {
    const response = await run(disabled);

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
    expect(await prisma.lab.count({ where: { id: { startsWith: PREFIX } } })).toBe(0);
  });

  it('creates the labs and ingests their events through the shared path', async () => {
    const response = await run(enabled);

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      scenarioRunId: RUN_ID,
      source: 'simulated',
      created: true,
      labs: 40,
      dependencies: 2,
      eventsIngested: 40,
      duplicatesSkipped: 1,
    });

    const labs = await prisma.lab.findMany({
      where: { id: { startsWith: PREFIX } },
      include: { dependencies: true },
    });
    expect(labs).toHaveLength(40);
    expect(labs.every((lab) => lab.source === 'simulated')).toBe(true);
    // Events moved each lab: 21 provisioned, 19 failed. None left provisioning.
    expect(labs.filter((lab) => lab.status === 'ready')).toHaveLength(21);
    expect(labs.filter((lab) => lab.status === 'failed')).toHaveLength(19);
    const events = await prisma.operationalEvent.count({
      where: { labId: { startsWith: PREFIX } },
    });
    expect(events).toBe(40);
    expect(labs.every((lab) => lab.dependencies.length === 2)).toBe(true);
  });

  // Negative: a replay must not duplicate labs; it returns the prior result.
  it('is idempotent for the same seed', async () => {
    await run(enabled);
    const auditBefore = await prisma.auditEntry.count({ where: { targetId: RUN_ID } });

    const replay = await run(enabled);

    expect(replay.statusCode).toBe(200);
    expect(replay.json().data).toMatchObject({
      created: false,
      eventsIngested: 0,
      duplicatesSkipped: 41,
    });
    const events = await prisma.operationalEvent.count({
      where: { labId: { startsWith: PREFIX } },
    });
    expect(events).toBe(40);
    expect(await prisma.lab.count({ where: { id: { startsWith: PREFIX } } })).toBe(40);
    const audit = await prisma.auditEntry.findMany({
      where: { targetId: RUN_ID },
      orderBy: { seq: 'desc' },
      take: 1,
    });
    const auditAfter = await prisma.auditEntry.count({ where: { targetId: RUN_ID } });
    expect(auditAfter).toBe(auditBefore + 1);
    expect(audit[0].outcome).toBe('already_present');
  });

  it.each([
    ['an unknown scenario', '/api/demo/scenarios/apocalypse', { seed: SEED }],
    ['a negative seed', URL, { seed: -1 }],
    ['a fractional seed', URL, { seed: 1.5 }],
    ['an unknown body field', URL, { seed: SEED, labs: 1000 }],
  ])('rejects %s with 400', async (_case, url, payload) => {
    const response = await enabled.inject({ method: 'POST', url, payload });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  });
});
