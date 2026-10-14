import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import { z } from 'zod';
import { SCENARIOS } from '../labs/simulator.js';
import type { ScenarioName } from '../labs/simulator.js';
import { runScenario } from './service.js';

const params = z
  .object({ name: z.enum(Object.keys(SCENARIOS) as [ScenarioName]) })
  .strict();

const body = z
  .object({ seed: z.number().int().min(0).max(2 ** 31 - 1).default(42) })
  .strict();

// Registered only when DEMO_ENABLED is true (see app.ts), so in any other
// environment the route does not exist: a 404, not a 403.
export function registerDemoRoutes<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression,
    RawReplyDefaultExpression,
    Logger
  >,
): void {
  app.post('/api/demo/scenarios/:name', async (request, reply) => {
    const { name } = params.parse(request.params);
    const { seed } = body.parse(request.body ?? {});

    const run = await runScenario(name, seed);
    request.log.info({ simulated: true, ...run }, 'demo scenario run');

    // 201 on first run; 200 on a replay, returning the same result.
    return reply.status(run.created ? 201 : 200).send({ data: run });
  });
}
