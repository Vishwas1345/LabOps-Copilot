// Server-side sessions. The cookie carries a random token; only its SHA-256 is
// stored, so reading the table yields no usable session.

import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';

export const SESSION_COOKIE = 'labops_session';
// Absolute, not sliding: a stolen cookie dies within a working day.
export const SESSION_TTL_MS = 8 * 60 * 60_000;

// 32 random bytes in base64url. Anything else is rejected before a lookup.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface SessionOperator {
  id: string;
  username: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Also clears this operator's expired sessions, so the table stays small. */
export async function createSession(
  tx: Prisma.TransactionClient,
  operatorId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await tx.operatorSession.deleteMany({ where: { operatorId, expiresAt: { lte: new Date() } } });
  await tx.operatorSession.create({ data: { id: hashToken(token), operatorId, expiresAt } });
  return { token, expiresAt };
}

/** The signed-in operator, or null for a malformed, unknown, expired or revoked token. */
export async function findSessionOperator(token: string): Promise<SessionOperator | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const session = await prisma.operatorSession.findUnique({
    where: { id: hashToken(token) },
    select: { expiresAt: true, revokedAt: true, operator: { select: { id: true, username: true } } },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  return session.operator;
}

export async function revokeSession(tx: Prisma.TransactionClient, token: string): Promise<void> {
  if (!TOKEN_PATTERN.test(token)) return;
  await tx.operatorSession.updateMany({
    where: { id: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
