// Each run uses its own queue prefix (see the integration config); this
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
