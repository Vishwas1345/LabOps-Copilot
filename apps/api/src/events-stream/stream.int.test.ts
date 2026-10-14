import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { writeAudit } from '../audit/audit.js';
import { signedInCookie } from '../auth/session.fixture.js';
import { loadConfig } from '../config/env.js';
import { prisma } from '../db.js';
import { currentBoundary, readFeed } from './feed.js';

const app = await buildApp({
  config: { ...loadConfig(), DEMO_ENABLED: false },
  streamOptions: { pollMs: 100, heartbeatMs: 200, replayLimit: 2 },
});
await app.listen({ port: 0, host: '127.0.0.1' });
const address = app.server.address();
const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const entry = (marker: string) => ({
  actor: { type: 'system', id: 'stream-test' } as const,
  action: 'test.stream',
  targetType: 'test',
  targetId: marker,
  outcome: 'written',
  metadata: { secretish: 'never streamed', incidentId: `inc-${marker}` },
});
const commitEntry = (marker: string) => prisma.$transaction((tx) => writeAudit(tx, entry(marker)));
const markersIn = async (from: string, to: string) =>
  (await readFeed(from, to, 10_000)).map((event) => event.targetId);

describe('readFeed', () => {
  // The core case: B commits before A although A took the lower seq. B must
  // wait until A finishes, or a client that saw B would never get A.
  it('holds back a committed row while an older transaction is still running', async () => {
    const start = await currentBoundary();
    const a = `A-${randomUUID()}`;
    const b = `B-${randomUUID()}`;
    let releaseA!: () => void;
    let aWritten!: () => void;
    const written = new Promise<void>((resolve) => (aWritten = resolve));
    const held = new Promise<void>((resolve) => (releaseA = resolve));
    const transactionA = prisma.$transaction(
      async (tx) => {
        await writeAudit(tx, entry(a));
        aWritten();
        await held;
      },
      { timeout: 20_000 },
    );
    await written;

    await commitEntry(b);
    const whileOpen = await markersIn(start, await currentBoundary());

    releaseA();
    await transactionA;
    const afterCommit = await markersIn(start, await currentBoundary());

    expect(whileOpen).not.toContain(b);
    expect(whileOpen).not.toContain(a);
    expect(afterCommit).toEqual(expect.arrayContaining([a, b]));
  });

  // Negative: a rolled-back write never appears.
  it('never returns a row whose transaction rolled back', async () => {
    const start = await currentBoundary();
    const ghost = `ghost-${randomUUID()}`;

    await prisma
      .$transaction(async (tx) => {
        await writeAudit(tx, entry(ghost));
        throw new Error('roll back');
      })
      .catch(() => undefined);
    await commitEntry(`after-${randomUUID()}`);

    expect(await markersIn(start, await currentBoundary())).not.toContain(ghost);
  });
});

/** Reads an SSE response until `done(text)` or the timeout. */
async function readStream(
  headers: Record<string, string>,
  done: (text: string) => boolean,
  timeoutMs = 5_000,
): Promise<{ status: number; text: string; ended: boolean }> {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/events/stream`, { headers, signal: controller.signal });
  if (!response.body) return { status: response.status, text: '', ended: true };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let ended = false;
  const deadline = Date.now() + timeoutMs;
  while (!done(text) && Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), deadline - Date.now())),
    ]);
    if (chunk === null) break;
    if (chunk.done) {
      ended = true;
      break;
    }
    text += decoder.decode(chunk.value);
  }
  controller.abort();
  return { status: response.status, text, ended };
}

const readyId = (text: string) => /event: ready\nid: (\d+)/.exec(text)?.[1];

describe('GET /api/events/stream', () => {
  it('refuses a client without a session', async () => {
    const response = await fetch(`${base}/api/events/stream`);
    expect(response.status).toBe(401);
    await response.body?.cancel();
  });

  it('streams a committed entry live, without its metadata', async () => {
    const { cookie } = await signedInCookie();
    const marker = `live-${randomUUID()}`;
    setTimeout(() => void commitEntry(marker), 300);

    const { status, text } = await readStream({ cookie }, (t) => t.includes(marker));

    expect(status).toBe(200);
    const line = text.split('\n').find((l) => l.startsWith('data: ') && l.includes(marker));
    const event = JSON.parse(line!.slice('data: '.length));
    expect(event).toMatchObject({ targetId: marker, action: 'test.stream', incidentId: `inc-${marker}` });
    expect(event).not.toHaveProperty('metadata');
    expect(line).not.toContain('never streamed');
  });

  // Negative: a reconnecting client receives exactly what it missed.
  it('replays the entries missed since Last-Event-ID', async () => {
    const { cookie } = await signedInCookie();
    const first = await readStream({ cookie }, (t) => readyId(t) !== undefined);
    const resumeFrom = readyId(first.text)!;
    const missed = [`m1-${randomUUID()}`, `m2-${randomUUID()}`];
    for (const marker of missed) await commitEntry(marker);

    const second = await readStream({ cookie, 'last-event-id': resumeFrom }, (t) =>
      missed.every((marker) => t.includes(marker)),
    );

    for (const marker of missed) expect(second.text).toContain(marker);
  });

  it('tells a client too far behind to reload instead of replaying', async () => {
    const { cookie } = await signedInCookie();
    const first = await readStream({ cookie }, (t) => readyId(t) !== undefined);
    for (let i = 0; i < 3; i += 1) await commitEntry(`burst-${randomUUID()}`);

    const second = await readStream({ cookie, 'last-event-id': readyId(first.text)! }, (t) =>
      t.includes('event: reset'),
    );

    expect(second.text).toContain('event: reset');
  });

  // Negative: signing out must end an open stream, not leave it watching.
  it('ends the stream when its session is revoked', async () => {
    const { cookie, operatorId } = await signedInCookie();
    // Awaited inside: a Prisma query is lazy and never runs until it is.
    setTimeout(async () => {
      await prisma.operatorSession.updateMany({
        where: { operatorId },
        data: { revokedAt: new Date() },
      });
    }, 300);

    const { ended } = await readStream({ cookie }, () => false, 3_000);

    expect(ended).toBe(true);
  });

  it('keeps serving other clients after one disconnects', async () => {
    const { cookie } = await signedInCookie();
    await readStream({ cookie }, (t) => readyId(t) !== undefined);
    const marker = `after-drop-${randomUUID()}`;
    setTimeout(() => void commitEntry(marker), 300);

    const { text } = await readStream({ cookie }, (t) => t.includes(marker));

    expect(text).toContain(marker);
  });
});
