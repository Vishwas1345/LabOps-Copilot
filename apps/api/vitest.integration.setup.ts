import { execFileSync } from 'node:child_process';

// Brings the test database to the checked-in migrations before any spec runs,
// creating it if missing, so a newly pulled migration never breaks a local run.
// DATABASE_URL is already the test database (vitest.integration.env.ts).
export function setup(): void {
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: ['ignore', 'ignore', 'inherit'] });
}

// Each run uses its own queue prefix (see vitest.integration.env.ts); this
// removes that run's Redis keys afterwards so nothing accumulates.
export async function teardown(): Promise<void> {
  // Guard: never obliterate anything but a test run's own queues.
  if (!process.env.QUEUE_PREFIX?.startsWith('labops-test-')) {
    throw new Error(`refusing to clean queue prefix ${process.env.QUEUE_PREFIX ?? '(unset)'}`);
  }
  const { closeQueues, getQueue, QUEUE_NAMES } = await import('./src/jobs/queues.js');
  await Promise.all(
    QUEUE_NAMES.map((name) => getQueue(name).obliterate({ force: true })),
  );
  await closeQueues();
}
