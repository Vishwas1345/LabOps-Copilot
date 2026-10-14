// A deterministic stand-in for a model, used by default and by every test.
// It reads the evidence the way a real model would, from the prompt text, and
// answers from a fixed rule. It is not a diagnosis engine: it exists so the
// pipeline around the model can be exercised without a network call.

import type { InvestigationOutput } from './output-schema.js';
import type { LlmProvider } from './provider.js';
import type { EvidencePack } from './evidence.js';
import type { Prompt } from './prompt.js';
import { EVIDENCE_CLOSE, EVIDENCE_OPEN } from './prompt.js';

const ACTION_BY_CATEGORY: Record<string, InvestigationOutput['recommendedAction']> = {
  PROVISION_TIMEOUT: 'RETRY_PROVISIONING',
  DEPENDENCY_UNAVAILABLE: 'RECHECK_DEPENDENCY',
};

function readPack(prompt: Prompt): EvidencePack {
  const body = prompt.evidence.slice(EVIDENCE_OPEN.length, -EVIDENCE_CLOSE.length);
  return JSON.parse(body) as EvidencePack;
}

/** Several failures sharing one category and one dependency read as one cause. */
export function fixtureAnswer(pack: EvidencePack): InvestigationOutput {
  const [first] = pack.failures;
  const shared =
    pack.failures.length >= 2 &&
    first.dependency !== null &&
    pack.failures.every((f) => f.category === first.category && f.dependency === first.dependency);

  if (!shared) {
    return {
      outcome: 'insufficient_evidence',
      summary: `${pack.failures.length} failure(s) without a shared category and dependency.`,
      candidateCause: null,
      evidenceFor: [],
      evidenceAgainst: [],
      missingEvidence: ['A common dependency or category across the failures'],
      diagnosticChecks: ['Inspect each failed lab individually'],
      confidence: 0.2,
      recommendedAction: null,
      targetLabIds: [],
    };
  }
  return {
    outcome: 'diagnosis',
    summary: `${pack.failures.length} labs failed with ${first.category} on ${first.dependency}.`,
    candidateCause: `${first.dependency} degraded during the failure window`,
    evidenceFor: pack.failures.map((f) => f.eventId),
    evidenceAgainst: [],
    missingEvidence: [`Health metrics for ${first.dependency}`],
    diagnosticChecks: [`Check ${first.dependency} status for the window`],
    confidence: 0.6,
    recommendedAction: ACTION_BY_CATEGORY[first.category ?? ''] ?? 'ESCALATE_MANUAL',
    targetLabIds: pack.failures.map((f) => f.labId),
  };
}

export const fixtureProvider: LlmProvider = {
  name: 'fixture',
  model: 'fixture-v1',
  analyse: async (prompt) => fixtureAnswer(readPack(prompt)),
};
