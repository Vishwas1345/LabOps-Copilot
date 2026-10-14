// Runs a simulator scenario into the database. Demo-only; never on a path
// that handles real provider data.

import { writeAudit } from '../audit/audit.js';
import { prisma } from '../db.js';
import { createSimulatedLabs } from '../labs/service.js';
import type { ScenarioName } from '../labs/simulator.js';
import { SCENARIOS } from '../labs/simulator.js';

export interface ScenarioRun {
  scenarioRunId: string;
  scenario: ScenarioName;
  seed: number;
  source: 'simulated';
  /** False on a replay: the same seed already created these labs. */
  created: boolean;
  labs: number;
  dependencies: number;
  plannedEvents: number;
}

export async function runScenario(
  name: ScenarioName,
  seed: number,
): Promise<ScenarioRun> {
  const scenario = SCENARIOS[name](seed);
  const scenarioRunId = `${name}:${seed}`;

  const labsCreated = await prisma.$transaction(async (tx) => {
    const count = await createSimulatedLabs(tx, scenario);
    await writeAudit(tx, {
      actor: { type: 'system', id: 'demo-scenario' },
      action: 'scenario.run',
      targetType: 'scenario',
      targetId: scenarioRunId,
      outcome: count > 0 ? 'created' : 'already_present',
      metadata: { labsCreated: count, simulated: true },
    });
    return count;
  });

  return {
    scenarioRunId,
    scenario: name,
    seed,
    source: 'simulated',
    created: labsCreated > 0,
    labs: scenario.labs.length,
    dependencies: scenario.dependencies.length,
    // Ingested from Phase 3 on; reported now so the run is self-describing.
    plannedEvents: scenario.events.length,
  };
}
