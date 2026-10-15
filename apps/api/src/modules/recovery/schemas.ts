// Request schemas for the recovery routes.

import { z } from 'zod';
import { ACTION_TYPES } from '../labs/actions.js';

export const actionParams = z.object({ id: z.string().min(1).max(64) }).strict();

// An unknown action type cannot even be stored (ActionType is a DB enum), so
// it is a 400 here; the evaluator's step 1 still guards every other caller.
// Parameters are accepted so policy can record why they were refused.
export const proposalBody = z
  .object({
    actionType: z.enum(ACTION_TYPES),
    targetIds: z.array(z.string().min(1).max(64)).max(50),
    parameters: z
      .record(z.string().max(64), z.unknown())
      .refine((value) => JSON.stringify(value).length <= 2000, 'parameters are too large')
      .default({}),
  })
  .strict();
