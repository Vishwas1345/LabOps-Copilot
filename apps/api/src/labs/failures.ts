// Normalised failure categories: the contract correlation groups on.
// Lives in labs (the lowest module) so events and incidents can import it.

import type { ErrorCategory as DbErrorCategory } from '@prisma/client';

export const ERROR_CATEGORIES = [
  'PROVISION_TIMEOUT',
  'NETWORK_CONFIG',
  'PERMISSION_DENIED',
  'DEPENDENCY_UNAVAILABLE',
  'QUOTA_EXCEEDED',
  'VALIDATION_FAILED',
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

// Fails typecheck if this list and the DB enum ever differ.
const _categoriesMatchDatabase: [ErrorCategory] extends [DbErrorCategory]
  ? [DbErrorCategory] extends [ErrorCategory]
    ? true
    : never
  : never = true;
