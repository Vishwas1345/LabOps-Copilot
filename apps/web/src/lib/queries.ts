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
