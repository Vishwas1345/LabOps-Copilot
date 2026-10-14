// GET /api/events/stream: server-sent events from the committed audit tail.
// The message id is a transaction-id boundary, not a seq: a client that
// reconnects with Last-Event-ID gets exactly what committed after it.
// Delivery is at-least-once; the dashboard treats events as "refresh now".

import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import { findSessionOperator, SESSION_COOKIE } from '../auth/session.js';
import type { FeedEvent } from './feed.js';
import { readFeed } from './feed.js';
import { FeedHub } from './hub.js';

const BOUNDARY = /^\d{1,20}$/;

export interface StreamOptions {
  pollMs: number;
  heartbeatMs: number;
  /** A client further behind than this is told to reload instead of replayed. */
  replayLimit: number;
}

const DEFAULTS: StreamOptions = { pollMs: 1_000, heartbeatMs: 15_000, replayLimit: 500 };

const message = (event: FeedEvent, id?: string) =>
  `${id ? `id: ${id}\n` : ''}data: ${JSON.stringify(event)}\n\n`;

export function registerEventStreamRoutes<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression,
    RawReplyDefaultExpression,
    Logger
  >,
  overrides: Partial<StreamOptions> = {},
): void {
  const options = { ...DEFAULTS, ...overrides };
  const hub = new FeedHub(options.pollMs);
  app.addHook('onClose', async () => hub.stop());

  // Behind the session guard (deny by default), like every non-public route.
  app.get('/api/events/stream', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE] ?? '';
    const lastId = request.headers['last-event-id'];
    const resumeFrom = typeof lastId === 'string' && BOUNDARY.test(lastId) ? lastId : null;

    reply.hijack();
    const out = reply.raw;
    out.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const write = (chunk: string) => {
      if (!out.writableEnded) out.write(chunk);
    };

    // The id goes on the last message of a batch only: a client cut off
    // mid-batch resumes from the batch start, repeating rather than skipping.
    const deliver = (events: FeedEvent[], boundary: string, truncated: boolean) => {
      if (truncated) return write(`event: reset\nid: ${boundary}\ndata: {}\n\n`);
      if (events.length === 0) return;
      events.forEach((event, i) => write(message(event, i === events.length - 1 ? boundary : undefined)));
    };

    let subscription: Awaited<ReturnType<FeedHub['subscribe']>>;
    try {
      subscription = await hub.subscribe((batch) =>
        deliver(batch.events, batch.boundary, batch.truncated),
      );
      // Replay what this client missed, up to where live delivery starts.
      if (resumeFrom) {
        const missed = await readFeed(resumeFrom, subscription.boundary, options.replayLimit + 1);
        deliver(
          missed.slice(0, options.replayLimit),
          subscription.boundary,
          missed.length > options.replayLimit,
        );
      }
    } catch (error) {
      request.log.warn({ err: error }, 'live feed unavailable');
      out.end();
      return;
    }
    // The client's resume point is where live delivery starts, never later.
    write(`event: ready\nid: ${subscription.boundary}\ndata: {}\n\n`);

    // Heartbeat, and the session re-checked on it: a revoked or expired
    // session ends the stream instead of watching forever.
    const heartbeat = setInterval(() => {
      void findSessionOperator(token).then((operator) => {
        if (operator) write(': heartbeat\n\n');
        else out.end();
      });
    }, options.heartbeatMs);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      subscription.unsubscribe();
    });
  });
}
