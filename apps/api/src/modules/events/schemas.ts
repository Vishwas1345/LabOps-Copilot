import { z } from 'zod';
import { ERROR_CATEGORIES } from '../labs/failures.js';

export const EVENT_TYPES = ['provision_succeeded', 'provision_failed'] as const;

// Allowed clock skew for event timestamps; anything later is rejected.
const MAX_FUTURE_SKEW_MS = 5 * 60_000;

// What may enter the system. Strict, so an unexpected field is a 400 rather
// than silently dropped data. Categories are a closed set: never free text.
export const incomingEvent = z
  .object({
    providerEventId: z.string().min(1).max(128).optional(),
    labId: z.string().min(1).max(64),
    type: z.enum(EVENT_TYPES),
    errorCategory: z.enum(ERROR_CATEGORIES).optional(),
    dependencyId: z.string().min(1).max(64).optional(),
    message: z.string().min(1).max(2000),
    metadata: z.record(z.string(), z.unknown()).optional(),
    occurredAt: z.iso
      .datetime()
      .refine((at) => Date.parse(at) <= Date.now() + MAX_FUTURE_SKEW_MS, {
        message: 'occurredAt is in the future',
      }),
    source: z.enum(['simulated', 'provider']),
  })
  .strict()
  .refine((e) => (e.type === 'provision_failed') === (e.errorCategory !== undefined), {
    message: 'errorCategory is required for provision_failed and forbidden otherwise',
    path: ['errorCategory'],
  });

export type IncomingEvent = z.infer<typeof incomingEvent>;

export const eventsQuery = z
  .object({
    cursor: z.string().min(1).max(64).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type EventsQuery = z.infer<typeof eventsQuery>;
