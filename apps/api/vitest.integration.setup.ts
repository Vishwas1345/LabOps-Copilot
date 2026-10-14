import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

// Run the Prisma CLI through node directly rather than through npx. npx is a
// shell script on Windows and a shim elsewhere, so spawning it is not portable:
// a bare "npx" is ENOENT, and "npx.cmd" is EINVAL because Node refuses to spawn
// a command script without a shell. The arguments here are fixed literals, but
// invoking the binary removes the question entirely.
const require = createRequire(import.meta.url);
const prismaCli = require.resolve('prisma/build/index.js');

// Brings the test database to the checked-in migrations before any spec runs,
// creating it if missing, so a newly pulled migration never breaks a local run.
// DATABASE_URL is already the test database (vitest.integration.env.ts).
export function setup(): void {
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
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
