import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import { z } from 'zod';
import { listAudit } from './audit.js';

// The cursor is a seq, digits only, so it can never reach BigInt() malformed.
const auditQuery = z
  .object({
    cursor: z.string().regex(/^\d{1,19}$/).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

// Read-only; behind the session guard like every non-public route.
export function registerAuditRoutes<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression,
    RawReplyDefaultExpression,
    Logger
  >,
): void {
  app.get('/api/audit', async (request) => {
    const page = await listAudit(auditQuery.parse(request.query));
    return { data: page.items, nextCursor: page.nextCursor };
  });
}
