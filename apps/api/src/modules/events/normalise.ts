// Redaction at the boundary: secrets are removed before an event is stored,
// so nothing downstream (logs, AI context, audit) can see them.

import { createHash } from 'node:crypto';
import { redactSecrets, redactText } from '../../platform/observability/redact.js';
import type { IncomingEvent } from './schemas.js';

// The provider's own id when it has one; otherwise a hash of what makes the
// event unique, so an id-less redelivery still collapses to one row.
export function deduplicationKey(event: IncomingEvent): string {
  if (event.providerEventId) {
    return `${event.source}:${event.providerEventId}`;
  }
  const identity = [event.labId, event.type, event.errorCategory ?? '', event.occurredAt];
  return `hash:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}

export interface NormalisedEvent {
  event: IncomingEvent;
  deduplicationKey: string;
}

export function normalise(event: IncomingEvent): NormalisedEvent {
  return {
    event: {
      ...event,
      message: redactText(event.message),
      metadata: event.metadata ? redactSecrets(event.metadata) : undefined,
    },
    deduplicationKey: deduplicationKey(event),
  };
}
