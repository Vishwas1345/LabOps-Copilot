// The closed set of recovery actions (ARCHITECTURE §10). Lives in labs, the
// lowest module, so investigations and policies can both import it without a
// cycle. Adding one also means a policy and an allow-list row (CLAUDE.md 5).

import type { ActionType as DbActionType } from '@prisma/client';

export const ACTION_TYPES = [
  'RETRY_PROVISIONING',
  'RECHECK_DEPENDENCY',
  'RERUN_VALIDATION',
  'ESCALATE_MANUAL',
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

// Fails typecheck if this list and the DB enum ever differ.
const _actionsMatchDatabase: [ActionType] extends [DbActionType]
  ? [DbActionType] extends [ActionType]
    ? true
    : never
  : never = true;
