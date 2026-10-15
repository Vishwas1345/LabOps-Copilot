import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import { scenarioBody, scenarioParams } from './schemas.js';
import { runScenario } from './service.js';

// Registered only when DEMO_ENABLED is true (see app.ts), so in any other
// environment the route does not exist: a 404, not a 403. Public for the demo
// only; it runs the simulator and touches no real resource.
export function registerDemoRoutes<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression,
    RawReplyDefaultExpression,
    Logger
  >,
): void {
  app.post('/api/demo/scenarios/:name', { config: { public: true } }, async (request, reply) => {
    const { name } = scenarioParams.parse(request.params);
    const { seed } = scenarioBody.parse(request.body ?? {});

    const run = await runScenario(name, seed);
    request.log.info({ simulated: true, ...run }, 'demo scenario run');

    // 201 on first run; 200 on a replay, returning the same result.
    return reply.status(run.created ? 201 : 200).send({ data: run });
  });
}
