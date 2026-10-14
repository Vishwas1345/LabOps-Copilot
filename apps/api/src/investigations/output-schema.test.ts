import { describe, expect, it } from 'vitest';
import type { InvestigationOutput } from './output-schema.js';
import { intersectWithIncident, parseOutput } from './output-schema.js';

const valid: InvestigationOutput = {
  outcome: 'diagnosis',
  summary: 'Twelve labs timed out pulling the same base image.',
  candidateCause: 'The image registry was degraded.',
  evidenceFor: ['ev-1', 'ev-2'],
  evidenceAgainst: [],
  missingEvidence: ['Registry health metrics for the window'],
  diagnosticChecks: ['Check registry latency'],
  confidence: 0.7,
  recommendedAction: 'RETRY_PROVISIONING',
  targetLabIds: ['lab-1', 'lab-2'],
};

describe('parseOutput', () => {
  it('accepts a valid diagnosis, as an object or as JSON text', () => {
    expect(parseOutput(valid)).toEqual({ ok: true, output: valid });
    expect(parseOutput(JSON.stringify(valid))).toEqual({ ok: true, output: valid });
  });

  it('accepts insufficient evidence with no action as a valid answer', () => {
    const answer = {
      ...valid,
      outcome: 'insufficient_evidence',
      candidateCause: null,
      recommendedAction: null,
      targetLabIds: [],
    };

    expect(parseOutput(answer).ok).toBe(true);
  });

  // Negative: unknown keys are rejected, not stripped. Approval is never the
  // model's to grant, so a model claiming it must fail validation.
  it.each([
    ['an unknown field', { extra: 'x' }],
    ['a claim of approval', { requiresApproval: false }],
    ['an action outside the allow-list', { recommendedAction: 'DELETE_LAB' }],
    ['a free-form command', { recommendedAction: 'run: rm -rf /' }],
    ['a confidence above 1', { confidence: 1.5 }],
    ['an empty summary', { summary: '   ' }],
    ['an oversized summary', { summary: 'x'.repeat(2001) }],
    ['too many targets', { targetLabIds: Array.from({ length: 51 }, (_, i) => `lab-${i}`) }],
    ['an unknown outcome', { outcome: 'certain' }],
  ])('rejects %s', (_label, change) => {
    expect(parseOutput({ ...valid, ...change })).toEqual({
      ok: false,
      failure: 'SCHEMA_REJECTED',
    });
  });

  it('rejects a missing field', () => {
    const { confidence: _confidence, ...partial } = valid;

    expect(parseOutput(partial)).toEqual({ ok: false, failure: 'SCHEMA_REJECTED' });
  });

  // Negative: text that is not JSON is malformed; nothing is salvaged from it.
  it.each([
    ['prose', 'I think the registry is down. Recommend RETRY_PROVISIONING.'],
    ['truncated JSON', JSON.stringify(valid).slice(0, 40)],
  ])('treats %s as malformed', (_label, raw) => {
    expect(parseOutput(raw)).toEqual({ ok: false, failure: 'MALFORMED_OUTPUT' });
  });

  it.each([null, undefined, 42, []])('rejects a non-object (%p)', (raw) => {
    expect(parseOutput(raw).ok).toBe(false);
  });
});

describe('intersectWithIncident', () => {
  const truth = { labIds: new Set(['lab-1', 'lab-2']), eventIds: new Set(['ev-1']) };

  // Negative: a hallucinated lab never survives to be acted on.
  it('drops target labs outside the incident and reports them', () => {
    const { output, droppedTargets } = intersectWithIncident(
      { ...valid, targetLabIds: ['lab-1', 'lab-999', 'lab-2'] },
      truth,
    );

    expect(output.targetLabIds).toEqual(['lab-1', 'lab-2']);
    expect(droppedTargets).toEqual(['lab-999']);
  });

  it('drops evidence references that were not in the pack', () => {
    const { output } = intersectWithIncident(
      { ...valid, evidenceFor: ['ev-1', 'ev-invented'], evidenceAgainst: ['ev-other'] },
      truth,
    );

    expect(output.evidenceFor).toEqual(['ev-1']);
    expect(output.evidenceAgainst).toEqual([]);
  });
});
