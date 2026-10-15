// The shapes the dashboard reads from the API. Not strict: the API may add
// fields, and the page ignores what it does not use. What it does use must
// match, or the page shows an error state instead of rendering garbage.

import { z } from 'zod';

export const healthSchema = z.object({
  service: z.string(),
  status: z.string(),
  checks: z.object({ database: z.string() }),
});

const iso = z.string();
const json = z.unknown();

export const operatorSchema = z.object({ data: z.object({ id: z.string(), username: z.string() }) });

export const loginSchema = z.object({
  data: z.object({ operator: z.object({ id: z.string(), username: z.string() }), expiresAt: iso }),
});

export const labSummarySchema = z.object({ data: z.record(z.string(), z.number()) });

const duration = z.object({ samples: z.number(), p50Ms: z.number().nullable(), p95Ms: z.number().nullable() });

export const metricsSchema = z.object({
  data: z.object({
    window: z.object({ hours: z.number() }),
    events: z.object({ received: z.number() }),
    incidents: z.object({
      created: z.number(),
      byStatusNow: z.record(z.string(), z.number()),
      timeToIdentify: duration,
    }),
    queues: z.array(z.object({ queue: z.string(), depth: z.number(), retries: z.number(), run: duration })),
    investigations: z.object({ byStatus: z.record(z.string(), z.number()), latency: duration }),
    recovery: z.object({ byStatus: z.record(z.string(), z.number()), approvalToVerified: duration }),
    oldestOpenTransactionMs: z.number().nullable(),
  }),
});

export const failureSeriesSchema = z.object({
  data: z.object({
    failures: z.object({
      bucketMs: z.number().nullable(),
      buckets: z.array(z.object({ start: z.string(), counts: z.record(z.string(), z.number()) })),
      totals: z.record(z.string(), z.number()),
    }),
  }),
});
export type FailureSeries = z.infer<typeof failureSeriesSchema>['data']['failures'];

export const incidentSummary = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  severity: z.string(),
  correlationStrength: z.number().nullable(),
  labCount: z.number(),
  createdAt: iso,
  updatedAt: iso,
  resolvedAt: iso.nullable(),
});
export type IncidentSummary = z.infer<typeof incidentSummary>;

export const incidentListSchema = z.object({
  data: z.array(incidentSummary),
  nextCursor: z.string().nullable(),
});

export const incidentDetailSchema = z.object({
  data: incidentSummary.extend({
    anchorEventId: z.string(),
    correlationReason: z.object({ summary: z.string().optional() }).passthrough(),
    labs: z.array(
      z.object({
        labId: z.string(),
        eventId: z.string(),
        reason: z.string(),
        signalScore: z.number().nullable(),
        signals: json,
      }),
    ),
    events: z.array(
      z.object({
        id: z.string(),
        errorCategory: z.string().nullable(),
        dependencyId: z.string().nullable(),
        message: z.string(),
        occurredAt: iso,
      }),
    ),
  }),
});
export type IncidentDetail = z.infer<typeof incidentDetailSchema>['data'];

export const investigationSchema = z.object({
  id: z.string(),
  status: z.string(),
  outcome: z.string().nullable(),
  summary: z.string().nullable(),
  candidateCause: z.string().nullable(),
  evidenceFor: z.array(z.string()),
  evidenceAgainst: z.array(z.string()),
  missingEvidence: z.array(z.string()),
  diagnosticChecks: z.array(z.string()),
  confidence: z.number().nullable(),
  recommendedAction: z.string().nullable(),
  targetLabIds: z.array(z.string()),
  droppedTargets: z.array(z.string()),
  failure: z.string().nullable(),
  modelMetadata: json,
  createdAt: iso,
  completedAt: iso.nullable(),
});
export type Investigation = z.infer<typeof investigationSchema>;
export const investigationsSchema = z.object({ data: z.array(investigationSchema) });

export const policyDecision = z.object({ step: z.string(), passed: z.boolean(), reason: z.string() });
export type PolicyDecision = z.infer<typeof policyDecision>;

export const recoveryActionSchema = z.object({
  id: z.string(),
  actionType: z.string(),
  targetIds: z.array(z.string()),
  status: z.string(),
  proposedBy: z.string(),
  blockedAt: z.string().nullable(),
  policyDecisions: z.array(policyDecision),
  expiresAt: iso.nullable(),
  approvedBy: z.string().nullable(),
  approvedAt: iso.nullable(),
  executedAt: iso.nullable(),
  result: z
    .object({
      before: z.record(z.string(), z.string()).optional(),
      executionDecisions: z.array(policyDecision).optional(),
    })
    .nullable(),
  verificationResult: z
    .object({
      passed: z.boolean(),
      after: z.record(z.string(), z.string()).optional(),
      notReady: z.array(z.string()).optional(),
      changedByEvents: z.array(z.string()).optional(),
      reason: z.string().optional(),
    })
    .nullable(),
  createdAt: iso,
});
export type RecoveryAction = z.infer<typeof recoveryActionSchema>;
export const recoveryActionsSchema = z.object({ data: z.array(recoveryActionSchema) });

export const auditEntrySchema = z.object({
  seq: z.string(),
  actorType: z.string(),
  actorId: z.string(),
  action: z.string(),
  outcome: z.string(),
  metadata: json,
  createdAt: iso,
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;
export const incidentAuditSchema = z.object({ data: z.array(auditEntrySchema) });

export const auditFeedSchema = z.object({
  data: z.array(auditEntrySchema.extend({ targetType: z.string(), targetId: z.string() })),
  nextCursor: z.string().nullable(),
});

export const acceptedSchema = z.object({ data: z.unknown() });

/**
 * What the API is willing to say about an integration. There is no credential
 * field here, so the page cannot render one even if the API ever sent one.
 */
export const integrationConnectionSchema = z.object({
  provider: z.string(),
  displayName: z.string(),
  state: z.string(),
  hasCredential: z.boolean(),
  supportedEventTypes: z.array(z.string()).nullable(),
  capabilities: z.object({
    reachable: z.boolean(),
    canReadLabs: z.boolean(),
    canReceiveEvents: z.boolean(),
    canRegisterWebhook: z.boolean(),
    canTriggerSync: z.boolean(),
    canExecuteRecovery: z.boolean(),
  }),
  lastSuccessfulTestAt: iso.nullable(),
  lastSyncAt: iso.nullable(),
  updatedAt: iso.nullable(),
});
export type IntegrationConnection = z.infer<typeof integrationConnectionSchema>;

export const integrationsSchema = z.object({ data: z.array(integrationConnectionSchema) });

/** A 204 with no body. */
export const emptySchema = z.null();
