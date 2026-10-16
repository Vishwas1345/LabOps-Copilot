// Demo hosts only: drops every table so the boot that follows migrates and
// seeds a fresh scenario. A shared demo otherwise stays resolved after its
// first visitor and ages out of the dashboard's windows. The audit trail's
// triggers block DELETE and TRUNCATE but not DROP, so this resets the schema,
// which is acceptable only for a database that has held nothing but the demo.
// A deploy runs the old and new containers side by side on one database, so
// boots take a lock and a demo in use is kept (docs/infra/DEPLOYMENT.md §0).

import type { PrismaClient } from '@prisma/client';

export type ResetOutcome = 'empty' | 'kept' | 'reset';

// Any fixed number: it only has to be the same in every boot.
const BOOT_LOCK = 734_501;

export class ResetRefused extends Error {
  constructor(reason: string) {
    super(`demo reset refused: ${reason}`);
    this.name = 'ResetRefused';
  }
}

/** Both switches, so neither a stray flag nor a dev machine can wipe a database. */
export function resetAllowed(env: Record<string, string | undefined>): boolean {
  return env.DEMO_RESET_ON_BOOT === 'true' && env.APP_ENV === 'production';
}

/**
 * Runs `step` while holding a database-wide lock, so two containers booting at
 * once never interleave reset, migrate and seed. Session-scoped: `db` must use
 * a single connection, or the unlock could run on a connection without it.
 */
export async function withBootLock<T>(db: PrismaClient, step: () => Promise<T>): Promise<T> {
  await db.$executeRaw`SELECT pg_advisory_lock(${BOOT_LOCK})`;
  try {
    return await step();
  } finally {
    await db.$executeRaw`SELECT pg_advisory_unlock(${BOOT_LOCK})`;
  }
}

/** Resets unless the demo saw activity after `idleSince`: a demo in use stays. */
export async function resetDemoDatabase(db: PrismaClient, idleSince: Date): Promise<ResetOutcome> {
  const [{ schema, migrated }] = await db.$queryRaw<[{ schema: string; migrated: boolean }]>`
    SELECT current_schema() AS schema, to_regclass('"Lab"') IS NOT NULL AS migrated`;
  if (!migrated) return 'empty';
  // The identifier is spliced into DDL below, so it must be a plain name.
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new ResetRefused('unexpected schema name');

  // Anything a provider sent means this is not a demo database: never wipe it.
  const [{ real }] = await db.$queryRaw<[{ real: number }]>`
    SELECT (SELECT count(*) FROM "Lab" WHERE source <> 'simulated')::int
         + (SELECT count(*) FROM "OperationalEvent" WHERE source <> 'simulated')::int AS real`;
  if (real > 0) throw new ResetRefused('the database holds non-simulated data');

  // Waking from sleep means at least 15 idle minutes; a deploy beside a running
  // container, or a second boot right after the first, finds recent activity.
  const [{ latest }] = await db.$queryRaw<[{ latest: Date | null }]>`
    SELECT max("createdAt") AS latest FROM "AuditEntry"`;
  if (latest && latest > idleSince) return 'kept';

  await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  return 'reset';
}
