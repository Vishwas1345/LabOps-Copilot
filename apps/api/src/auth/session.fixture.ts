// Test-only: a signed-in operator without going through login, so route tests
// stay independent of the login rate limit. Never imported by app code.

import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { createSession, SESSION_COOKIE } from './session.js';

export async function signedInCookie(): Promise<{ cookie: string; operatorId: string }> {
  const operator = await prisma.operator.create({
    data: { username: `test-${randomUUID()}`, passwordHash: 'not-a-real-hash' },
  });
  const { token } = await prisma.$transaction((tx) => createSession(tx, operator.id));
  return { cookie: `${SESSION_COOKIE}=${token}`, operatorId: operator.id };
}
