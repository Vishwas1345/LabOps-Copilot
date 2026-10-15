// Query strings built from the browser's URL. Only known values reach the
// API; anything else is dropped, so a crafted URL cannot widen a request.

export const INCIDENT_STATUSES = [
  'open',
  'investigating',
  'awaiting_approval',
  'recovering',
  'manual_review',
  'resolved',
];
export const INCIDENT_SEVERITIES = ['high', 'medium', 'low'];

const ID = /^[a-z0-9]{1,64}$/i;

export const isId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);

export function incidentQuery(params: { status?: string; severity?: string; cursor?: string }): string {
  const query = new URLSearchParams({ limit: '25' });
  if (params.status && INCIDENT_STATUSES.includes(params.status)) query.set('status', params.status);
  if (params.severity && INCIDENT_SEVERITIES.includes(params.severity)) {
    query.set('severity', params.severity);
  }
  if (isId(params.cursor)) query.set('cursor', params.cursor);
  return query.toString();
}

// The dashboard's time window. Only these values reach the API.
export const WINDOWS = { '1h': 1, '24h': 24, '7d': 168 } as const;
export type WindowKey = keyof typeof WINDOWS;

export function windowFrom(value: string | undefined): WindowKey {
  return value !== undefined && Object.hasOwn(WINDOWS, value) ? (value as WindowKey) : '24h';
}
