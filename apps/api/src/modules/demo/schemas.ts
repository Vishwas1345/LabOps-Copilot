// Request schemas for the demo route.

import { z } from 'zod';
import { SCENARIOS } from '../labs/simulator.js';
import type { ScenarioName } from '../labs/simulator.js';

export const scenarioParams = z
  .object({ name: z.enum(Object.keys(SCENARIOS) as [ScenarioName]) })
  .strict();

export const scenarioBody = z
  .object({ seed: z.number().int().min(0).max(2 ** 31 - 1).default(42) })
  .strict();
