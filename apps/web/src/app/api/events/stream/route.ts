// Relays the API's event stream through the web server (BFF): the browser's
// EventSource talks to this origin, and the session cookie is forwarded here,
// never exposed to browser code or sent cross-origin.

import { cookies } from 'next/headers';
import { apiUrl } from '@/lib/api';
import { SESSION_COOKIE } from '@/lib/session';

export const dynamic = 'force-dynamic';

const BOUNDARY = /^\d{1,20}$/;

export async function GET(request: Request): Promise<Response> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return new Response(null, { status: 401 });

  // Only a well-formed resume point is passed on.
  const lastEventId = request.headers.get('last-event-id');
  const upstream = await fetch(apiUrl('/api/events/stream'), {
    headers: {
      cookie: `${SESSION_COOKIE}=${token}`,
      ...(lastEventId && BOUNDARY.test(lastEventId) ? { 'last-event-id': lastEventId } : {}),
    },
    // Closing the browser tab closes the upstream connection too.
    signal: request.signal,
    cache: 'no-store',
  });
  if (!upstream.ok || !upstream.body) return new Response(null, { status: upstream.status });

  return new Response(upstream.body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
