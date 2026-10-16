// Demo hosts only: drops every table so the boot that follows migrates and
// seeds a fresh scenario. A shared demo otherwise stays resolved after its
// first visitor and ages out of the dashboard's windows. The audit trail's
// triggers block DELETE and TRUNCATE but not DROP, so this resets the schema,
// which is acceptable only for a database that has held nothing but the demo.

import type { PrismaClient } from '@prisma/client';

export type ResetOutcome = 'empty' | 'reset';

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

export async function resetDemoDatabase(db: PrismaClient): Promise<ResetOutcome> {
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

  await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  return 'reset';
}
