// Request schemas for the metrics routes.

import { z } from 'zod';

// Capped at a week: every metric is an aggregate over the window's rows.
export const metricsQuery = z
  .object({ hours: z.coerce.number().int().min(1).max(168).default(24) })
  .strict();
