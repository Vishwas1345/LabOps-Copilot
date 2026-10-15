// Sign-in and sign-out, each with its audit entry in the same transaction.

import { randomBytes } from 'node:crypto';
import { writeAudit } from '../audit/audit.js';
import { prisma } from '../../db.js';
import type { GoogleFailure, GoogleIdentity } from './google.js';
import { hashPassword, verifyPassword } from './password.js';
import type { SessionOperator } from './session.js';
import { createSession, revokeSession } from './session.js';

export interface SignedIn {
  operator: SessionOperator;
  token: string;
  expiresAt: Date;
}

// Compared against when the username is unknown, so a miss costs the same
// scrypt time as a wrong password and timing does not reveal who exists.
// Built at load, not on first use, or the first miss would pay for two hashes.
const unknownUserHash = hashPassword(randomBytes(16).toString('hex'));

/** Null for an unknown user or a wrong password alike; the caller cannot tell which. */
export async function signIn(username: string, password: string): Promise<SignedIn | null> {
  const operator = await prisma.operator.findUnique({ where: { username } });
  const valid = await verifyPassword(password, operator?.passwordHash ?? (await unknownUserHash));

  return prisma.$transaction(async (tx) => {
    if (!operator || !valid) {
      // Never the typed username: people paste passwords into that field, and
      // the audit table is append-only. A known account is recorded by its id.
      await writeAudit(tx, {
        actor: { type: 'human', id: 'anonymous' },
        action: 'auth.login',
        targetType: 'operator',
        targetId: operator?.id ?? 'unknown',
        outcome: 'rejected',
      });
      return null;
    }
    const session = await createSession(tx, operator.id);
    await writeAudit(tx, {
      actor: { type: 'human', id: operator.id },
      action: 'auth.login',
      targetType: 'operator',
      targetId: operator.id,
      outcome: 'succeeded',
    });
    return { operator: { id: operator.id, username: operator.username }, ...session };
  });
}

/**
 * Signs in a Google identity that already passed verification and the
 * allow-list. The operator is found by Google's stable subject id; the first
 * sign-in links an operator named after the email, creating it without a
 * password if none exists.
 */
export async function signInWithGoogle(identity: GoogleIdentity): Promise<SignedIn> {
  return prisma.$transaction(async (tx) => {
    const linked = await tx.operatorIdentity.findUnique({
      where: { provider_subject: { provider: 'google', subject: identity.subject } },
      select: { operator: { select: { id: true, username: true } } },
    });
    let operator = linked?.operator;
    if (!operator) {
      operator =
        (await tx.operator.findUnique({ where: { username: identity.email }, select: { id: true, username: true } })) ??
        (await tx.operator.create({ data: { username: identity.email }, select: { id: true, username: true } }));
      await tx.operatorIdentity.create({
        data: { provider: 'google', subject: identity.subject, email: identity.email, operatorId: operator.id },
      });
    }
    const session = await createSession(tx, operator.id);
    await writeAudit(tx, {
      actor: { type: 'human', id: operator.id },
      action: 'auth.login',
      targetType: 'operator',
      targetId: operator.id,
      outcome: 'succeeded',
      metadata: { provider: 'google' },
    });
    return { operator, ...session };
  });
}

/** A refused Google sign-in: the reason only, never the email (the audit is permanent). */
export async function auditRejectedGoogleSignIn(reason: GoogleFailure): Promise<void> {
  await prisma.$transaction((tx) =>
    writeAudit(tx, {
      actor: { type: 'human', id: 'anonymous' },
      action: 'auth.login',
      targetType: 'operator',
      targetId: 'unknown',
      outcome: 'rejected',
      metadata: { provider: 'google', reason },
    }),
  );
}

export async function signOut(operator: SessionOperator, token: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await revokeSession(tx, token);
    await writeAudit(tx, {
      actor: { type: 'human', id: operator.id },
      action: 'auth.logout',
      targetType: 'operator',
      targetId: operator.id,
      outcome: 'succeeded',
    });
  });
}

/**
 * Creates the operator or resets its password. A reset revokes the operator's
 * live sessions: a rotated password must end access gained with the old one.
 * Idempotent: compose seeds on every start, and an unchanged password must not
 * sign everyone out.
 */
export async function seedOperator(
  username: string,
  password: string,
): Promise<'created' | 'updated' | 'unchanged'> {
  const current = await prisma.operator.findUnique({
    where: { username },
    select: { passwordHash: true },
  });
  if (current?.passwordHash && (await verifyPassword(password, current.passwordHash))) {
    return 'unchanged';
  }

  const passwordHash = await hashPassword(password);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.operator.findUnique({ where: { username }, select: { id: true } });
    const operator = existing
      ? await tx.operator.update({ where: { id: existing.id }, data: { passwordHash } })
      : await tx.operator.create({ data: { username, passwordHash } });
    if (existing) {
      await tx.operatorSession.updateMany({
        where: { operatorId: operator.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    const outcome = existing ? 'updated' : 'created';
    await writeAudit(tx, {
      actor: { type: 'system', id: 'seed-operator' },
      action: 'operator.seeded',
      targetType: 'operator',
      targetId: operator.id,
      outcome,
    });
    return outcome;
  });
}
