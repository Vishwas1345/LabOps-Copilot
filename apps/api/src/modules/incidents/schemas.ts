import { Severity } from '@prisma/client';
import { z } from 'zod';
import { INCIDENT_STATUSES } from './transitions.js';

export const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

// Strict, as for labs: a misspelt filter must fail, not return everything.
export const listIncidentsQuery = z
  .object({
    status: z.enum(INCIDENT_STATUSES).optional(),
    severity: z.enum(Severity).optional(),
    cursor: z.string().min(1).max(64).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  })
  .strict();

export type ListIncidentsQuery = z.infer<typeof listIncidentsQuery>;

export const incidentParams = z.object({ id: z.string().min(1).max(64) }).strict();
