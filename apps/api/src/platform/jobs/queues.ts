// Queue access. Lazy, so processes and tests that never enqueue never open a
// Redis connection. Every key is namespaced by QUEUE_PREFIX.

import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { loadConfig } from '../config/env.js';

export const QUEUE_NAMES = ['correlate', 'investigate', 'execute'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

/** What BullMQ carries; the real payload lives in Postgres (JobExecution). */
export interface JobMessage {
  jobExecutionId: string;
  generation: number;
}

export const MAX_ATTEMPTS = 3;

const queues = new Map<QueueName, Queue<JobMessage>>();
const clients = new Set<Redis>();

/** A new client per Queue or Worker; BullMQ workers need their own for blocking reads. */
export function redisConnection(): Redis {
  // maxRetriesPerRequest: null makes commands wait for a reconnect, not fail.
  const client = new Redis(loadConfig().REDIS_URL, { maxRetriesPerRequest: null });
  clients.add(client);
  return client;
}

export function queuePrefix(): string {
  return loadConfig().QUEUE_PREFIX;
}

export function getQueue(name: QueueName): Queue<JobMessage> {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue<JobMessage>(name, { connection: redisConnection(), prefix: queuePrefix() });
    queues.set(name, queue);
  }
  return queue;
}

/** Closes every queue and every client this process created. */
export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
  await Promise.all([...clients].map((client) => client.quit().catch(() => undefined)));
  clients.clear();
}
