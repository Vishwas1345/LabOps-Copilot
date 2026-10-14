// One poller per API process, shared by every open stream: the database work
// does not grow with the number of viewers. It runs only while someone is
// subscribed, and a subscriber's failure never reaches the others.

import { logger } from '../observability/logger.js';
import type { FeedEvent } from './feed.js';
import { currentBoundary, readFeed } from './feed.js';

export interface FeedBatch {
  events: FeedEvent[];
  /** Everything below this has been delivered; a client resumes from here. */
  boundary: string;
  /** More than one batch's worth: some events were not sent individually. */
  truncated: boolean;
}

type Subscriber = (batch: FeedBatch) => void;

const MAX_BATCH = 500;

export class FeedHub {
  private readonly subscribers = new Set<Subscriber>();
  private boundary: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(private readonly intervalMs: number) {}

  /** Subscribes and returns the boundary live delivery starts from. */
  async subscribe(subscriber: Subscriber): Promise<{ boundary: string; unsubscribe: () => void }> {
    if (this.boundary === null) this.boundary = await currentBoundary();
    this.subscribers.add(subscriber);
    this.timer ??= setInterval(() => void this.poll(), this.intervalMs);
    return { boundary: this.boundary, unsubscribe: () => this.remove(subscriber) };
  }

  get size(): number {
    return this.subscribers.size;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.boundary = null;
  }

  private remove(subscriber: Subscriber): void {
    this.subscribers.delete(subscriber);
    if (this.subscribers.size === 0) this.stop();
  }

  private async poll(): Promise<void> {
    // One poll at a time: a slow query must not overlap the next tick.
    if (this.polling || this.boundary === null) return;
    this.polling = true;
    try {
      const to = await currentBoundary();
      if (to === this.boundary) return;
      const events = await readFeed(this.boundary, to, MAX_BATCH + 1);
      // A burst too large for one batch still moves to the boundary, and
      // says so: the stream tells clients to reload rather than miss events.
      const batch = {
        events: events.slice(0, MAX_BATCH),
        boundary: to,
        truncated: events.length > MAX_BATCH,
      };
      this.boundary = to;
      for (const subscriber of this.subscribers) {
        try {
          subscriber(batch);
        } catch (error) {
          logger.warn({ err: error }, 'live feed subscriber failed');
        }
      }
    } catch (error) {
      logger.warn({ err: error }, 'live feed poll failed; retrying next tick');
    } finally {
      this.polling = false;
    }
  }
}
