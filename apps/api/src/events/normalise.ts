// Redaction at the boundary: secrets are removed before an event is stored,
// so nothing downstream (logs, AI context, audit) can see them.

import { createHash } from 'node:crypto';
import { redactSecrets } from '../observability/redact.js';
import type { IncomingEvent } from './schema.js';

// key=value or key: value where the key names a secret, plus bearer tokens.
const SECRET_ASSIGNMENT =
  /\b(password|passwd|secret|token|api[_-]?key|access[_-]?key)(\s*[:=]\s*)\S+/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

export function redactText(text: string): string {
  return text
    .replace(SECRET_ASSIGNMENT, '$1$2[redacted]')
    .replace(BEARER_TOKEN, 'Bearer [redacted]');
}

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
