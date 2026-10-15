import { z } from 'zod';
import { LAB_STATUSES } from './transitions.js';

export const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

// Strict: ignoring a typo like `stauts` would silently return unfiltered data.
export const listLabsQuery = z
  .object({
    status: z.enum(LAB_STATUSES).optional(),
    cursor: z.string().min(1).max(64).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_SIZE)
      .default(DEFAULT_PAGE_SIZE),
  })
  .strict();

export type ListLabsQuery = z.infer<typeof listLabsQuery>;

export const labParams = z.object({ id: z.string().min(1).max(64) }).strict();
