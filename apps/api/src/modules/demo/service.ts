// Runs a simulator scenario into the database. Demo-only; never on a path
// that handles real provider data.

import { writeAudit } from '../../platform/audit/audit.js';
import { prisma } from '../../db.js';
import { ingestEvent } from '../events/service.js';
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
  /** New events stored by this run (0 on a replay). */
  eventsIngested: number;
  /** Events the dedup key recognised, including the scenario's redelivery. */
  duplicatesSkipped: number;
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

  // The same path external events take: one validated ingest per event, in
  // scenario order, so dedup and lab transitions behave exactly as in prod.
  const actor = { type: 'system', id: 'demo-scenario' } as const;
  let eventsIngested = 0;
  for (const event of scenario.events) {
    const result = await ingestEvent(event, actor);
    if (!result.duplicate) eventsIngested += 1;
  }

  return {
    scenarioRunId,
    scenario: name,
    seed,
    source: 'simulated',
    created: labsCreated > 0,
    labs: scenario.labs.length,
    dependencies: scenario.dependencies.length,
    eventsIngested,
    duplicatesSkipped: scenario.events.length - eventsIngested,
  };
}
