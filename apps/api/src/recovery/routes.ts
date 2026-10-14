import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import { z } from 'zod';
import { actorOf } from '../auth/guard.js';
import { prisma } from '../db.js';
import { AppError } from '../http/errors.js';
import { incidentParams } from '../incidents/schemas.js';
import { assertIncidentExists, IncidentNotFoundError } from '../incidents/service.js';
import { ACTION_TYPES } from '../labs/actions.js';
import { ProposalConflictError, proposeAction } from './propose.js';

// An unknown action type cannot even be stored (ActionType is a DB enum), so
// it is a 400 here; the evaluator's step 1 still guards every other caller.
// Parameters are accepted so policy can record why they were refused.
const proposalBody = z
  .object({
    actionType: z.enum(ACTION_TYPES),
    targetIds: z.array(z.string().min(1).max(64)).max(50),
    parameters: z
      .record(z.string().max(64), z.unknown())
      .refine((value) => JSON.stringify(value).length <= 2000, 'parameters are too large')
      .default({}),
  })
  .strict();

function mapError(error: unknown): never {
  if (error instanceof IncidentNotFoundError) {
    throw new AppError(404, 'INCIDENT_NOT_FOUND', 'incident not found');
  }
  if (error instanceof ProposalConflictError) {
    throw new AppError(409, 'INCIDENT_NOT_PROPOSABLE', 'incident cannot take a proposal now');
  }
  throw error;
}

const MAX_LISTED = 50;

// HTTP only. A blocked proposal is still a 201: it is a recorded decision,
// not a failed request.
export function registerRecoveryRoutes<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression,
    RawReplyDefaultExpression,
    Logger
  >,
  options: { approvalTtlMs: number },
): void {
  app.post('/api/incidents/:id/recovery-proposals', async (request, reply) => {
    const { id } = incidentParams.parse(request.params);
    const body = proposalBody.parse(request.body);
    const actor = actorOf(request);
    const proposal = await prisma
      .$transaction((tx) => proposeAction(tx, id, body, actor, options))
      .catch(mapError);
    return reply.status(proposal.created ? 201 : 200).send({
      data: {
        recoveryActionId: proposal.recoveryActionId,
        status: proposal.status,
        blockedAt: proposal.blockedAt,
      },
    });
  });

  app.get('/api/incidents/:id/recovery-actions', async (request) => {
    const { id } = incidentParams.parse(request.params);
    await assertIncidentExists(id).catch(mapError);
    const rows = await prisma.recoveryAction.findMany({
      where: { incidentId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_LISTED,
    });
    return {
      data: rows.map((row) => ({
        id: row.id,
        investigationId: row.investigationId,
        actionType: row.actionType,
        targetIds: row.targetIds,
        status: row.status,
        proposedBy: row.proposedBy,
        blockedAt: row.blockedAt,
        policyDecisions: row.policyDecisions,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  });
}
