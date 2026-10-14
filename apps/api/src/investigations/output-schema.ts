// What the model must return. Model output is untrusted input: strict objects
// reject unknown keys instead of stripping them, enums are closed, and every
// string and list is bounded. There is deliberately no field for approval or
// authority; those belong to policy and the operator, never to the model.

import { z } from 'zod';
import { ACTION_TYPES } from '../labs/actions.js';

const text = (max: number) => z.string().trim().min(1).max(max);
const ids = z.array(z.string().min(1).max(64)).max(50);
const notes = z.array(text(300)).max(10);

export const investigationOutput = z
  .object({
    // "Not enough to say" is a first-class answer, never an error.
    outcome: z.enum(['diagnosis', 'insufficient_evidence']),
    summary: text(2000),
    candidateCause: text(500).nullable(),
    evidenceFor: ids,
    evidenceAgainst: ids,
    missingEvidence: notes,
    diagnosticChecks: notes,
    confidence: z.number().min(0).max(1),
    recommendedAction: z.enum(ACTION_TYPES).nullable(),
    targetLabIds: ids,
  })
  .strict();

export type InvestigationOutput = z.infer<typeof investigationOutput>;

export type ParsedOutput =
  | { ok: true; output: InvestigationOutput }
  | { ok: false; failure: 'MALFORMED_OUTPUT' | 'SCHEMA_REJECTED' };

/** A string must be JSON; anything else is validated as it is. Never salvaged. */
export function parseOutput(raw: unknown): ParsedOutput {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, failure: 'MALFORMED_OUTPUT' };
    }
  }
  const result = investigationOutput.safeParse(value);
  return result.success
    ? { ok: true, output: result.data }
    : { ok: false, failure: 'SCHEMA_REJECTED' };
}

export interface IncidentTruth {
  labIds: ReadonlySet<string>;
  eventIds: ReadonlySet<string>;
}

/**
 * Cuts the model's references down to server-side truth: target labs must be
 * in the incident, evidence must be events that were in the pack. What was
 * cut is returned too, so the operator can see what the model invented.
 */
export function intersectWithIncident(
  output: InvestigationOutput,
  truth: IncidentTruth,
): { output: InvestigationOutput; droppedTargets: string[] } {
  const inIncident = (id: string) => truth.labIds.has(id);
  const inPack = (id: string) => truth.eventIds.has(id);
  return {
    output: {
      ...output,
      targetLabIds: output.targetLabIds.filter(inIncident),
      evidenceFor: output.evidenceFor.filter(inPack),
      evidenceAgainst: output.evidenceAgainst.filter(inPack),
    },
    droppedTargets: output.targetLabIds.filter((id) => !inIncident(id)),
  };
}
