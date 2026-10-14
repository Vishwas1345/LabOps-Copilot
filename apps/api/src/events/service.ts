// The single ingest path for simulated and provider events: validate,
// redact, dedupe, store, then move the lab if its state machine allows.

import type { OperationalEvent } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { Actor } from '../audit/audit.js';
import { writeAudit } from '../audit/audit.js';
import { prisma } from '../db.js';
import type { JobRecord } from '../jobs/record.js';
import { dispatchJob, recordJob } from '../jobs/record.js';
import type { LabTransition } from '../labs/service.js';
import { tryTransitionLab } from '../labs/service.js';
import type { ErrorCategory } from '../labs/failures.js';
import { logger } from '../observability/logger.js';
import { currentTraceparent, withSpan } from '../observability/tracing.js';
import { correlationWindow } from './correlation-window.js';
import { normalise } from './normalise.js';
import type { EventsQuery, IncomingEvent } from './schema.js';
import { incomingEvent } from './schema.js';

export interface IngestResult {
  eventId: string;
  duplicate: boolean;
  /** Null for a duplicate, or when the lab's state machine skips the move. */
  transition: LabTransition | null;
  /** The correlate job a stored failure armed; null otherwise. */
  jobId: string | null;
}

/** The event names a lab or dependency that does not exist. */
export class UnknownReferenceError extends Error {
  constructor(readonly field: 'labId' | 'dependencyId') {
    super(`unknown ${field}`);
    this.name = 'UnknownReferenceError';
  }
}

function isPrismaError(
  error: unknown,
  code: string,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

async function findDuplicate(deduplicationKey: string): Promise<IngestResult | null> {
  const existing = await prisma.operationalEvent.findUnique({
    where: { deduplicationKey },
    select: { id: true },
  });
  return existing ? { eventId: existing.id, duplicate: true, transition: null, jobId: null } : null;
}

// Takes `unknown` and validates itself, so no caller (API, demo, a future
// adapter) can hand it an unchecked event.
export function ingestEvent(input: unknown, actor: Actor): Promise<IngestResult> {
  return withSpan('event.ingest', () => ingest(input, actor));
}

async function ingest(input: unknown, actor: Actor): Promise<IngestResult> {
  const { event, deduplicationKey } = normalise(incomingEvent.parse(input));

  const known = await findDuplicate(deduplicationKey);
  if (known) return known;

  try {
    const { result, job } = await prisma.$transaction(async (tx) => {
      const stored = await tx.operationalEvent.create({
        data: {
          labId: event.labId,
          type: event.type,
          errorCategory: event.errorCategory,
          dependencyId: event.dependencyId,
          message: event.message,
          metadata: event.metadata as Prisma.InputJsonObject | undefined,
          source: event.source,
          occurredAt: new Date(event.occurredAt),
          deduplicationKey,
        },
        select: { id: true },
      });

      await writeAudit(tx, {
        actor,
        action: 'event.received',
        targetType: 'event',
        targetId: stored.id,
        outcome: 'stored',
        metadata: { labId: event.labId, type: event.type, errorCategory: event.errorCategory },
      });

      const target = event.type === 'provision_failed' ? 'failed' : 'ready';
      const transition = await tryTransitionLab(tx, event.labId, target, actor, {
        reason: `event ${stored.id}`,
      });

      // Outbox: the job row commits with the event; Redis gets it after.
      let job: JobRecord | null = null;
      if (event.type === 'provision_failed') {
        const window = correlationWindow(new Date(event.occurredAt));
        job = await recordJob(
          tx,
          'correlate',
          window.jobKey,
          { windowStart: window.start.toISOString() },
          currentTraceparent(),
        );
      }

      const result: IngestResult = {
        eventId: stored.id,
        duplicate: false,
        transition,
        jobId: job?.id ?? null,
      };
      return { result, job };
    });

    if (job) {
      // The event is safe either way; a failed send is resent by the reconciler.
      await dispatchJob(job).catch((error: unknown) =>
        logger.warn({ err: error, jobId: result.jobId }, 'dispatch failed; reconciler will retry'),
      );
    }
    return result;
  } catch (error) {
    // A concurrent copy of this event won the unique key: report the original.
    if (isPrismaError(error, 'P2002')) {
      const winner = await findDuplicate(deduplicationKey);
      if (winner) return winner;
    }
    if (isPrismaError(error, 'P2003')) {
      // Prisma names the violated foreign key in meta.constraint.
      const field =
        error.meta?.constraint === 'OperationalEvent_dependencyId_fkey' ? 'dependencyId' : 'labId';
      throw new UnknownReferenceError(field);
    }
    throw error;
  }
}

export interface EventView {
  id: string;
  type: IncomingEvent['type'];
  errorCategory: string | null;
  dependencyId: string | null;
  message: string;
  source: string;
  occurredAt: string;
}

/** Newest first; `id` breaks ties, one extra row signals a next page. */
export async function listLabEvents(
  labId: string,
  query: EventsQuery,
): Promise<{ items: EventView[]; nextCursor: string | null }> {
  const rows = await prisma.operationalEvent.findMany({
    where: { labId },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;

  return {
    items: page.map(toEventView),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

/** Events by id, oldest first: the evidence an incident points at. */
export async function getEventViews(eventIds: string[]): Promise<EventView[]> {
  const rows = await prisma.operationalEvent.findMany({
    where: { id: { in: eventIds } },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map(toEventView);
}

function toEventView(row: OperationalEvent): EventView {
  return {
    id: row.id,
    type: row.type,
    errorCategory: row.errorCategory,
    dependencyId: row.dependencyId,
    message: row.message,
    source: row.source,
    occurredAt: row.occurredAt.toISOString(),
  };
}

/** A stored failure, as correlation reads it. */
export interface StoredFailure {
  id: string;
  labId: string;
  errorCategory: ErrorCategory;
  dependencyId: string | null;
  occurredAt: Date;
}

const failureFields = {
  id: true,
  labId: true,
  errorCategory: true,
  dependencyId: true,
  occurredAt: true,
} as const;

// A failure without a category cannot be grouped, so it is never returned.
function toFailures(
  rows: Array<Omit<StoredFailure, 'errorCategory'> & { errorCategory: ErrorCategory | null }>,
): StoredFailure[] {
  return rows.flatMap((row) =>
    row.errorCategory ? [{ ...row, errorCategory: row.errorCategory }] : [],
  );
}

export async function listFailuresBetween(
  tx: Prisma.TransactionClient,
  from: Date,
  to: Date,
): Promise<StoredFailure[]> {
  const rows = await tx.operationalEvent.findMany({
    where: { type: 'provision_failed', occurredAt: { gte: from, lt: to } },
    select: failureFields,
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
  });
  return toFailures(rows);
}
