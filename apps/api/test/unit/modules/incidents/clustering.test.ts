import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../../../../src/modules/labs/simulator.js';
import { clusterFailures } from '../../../../src/modules/incidents/clustering.js';
import type { FailureEvent } from '../../../../src/modules/incidents/scoring.js';
import { JOIN_THRESHOLD, scorePair } from '../../../../src/modules/incidents/scoring.js';

const T0 = new Date('2026-01-15T09:00:00.000Z').getTime();
const MIN = 60_000;

const failure = (id: string, overrides: Partial<FailureEvent> = {}): FailureEvent => ({
  id,
  labId: `lab-${id}`,
  errorCategory: 'PROVISION_TIMEOUT',
  dependencyId: 'dep-registry',
  dependencyKind: 'image-registry',
  labType: `type-${id}`,
  occurredAt: new Date(T0),
  ...overrides,
});
const at = (minutes: number) => new Date(T0 + minutes * MIN);
const ids = (events: Array<{ id: string }>) => events.map((e) => e.id);

describe('scorePair', () => {
  it('scores a same-category, same-dependency burst well above the threshold', () => {
    const score = scorePair(failure('a'), failure('b', { occurredAt: at(2) }));

    expect(score.score).toBe(0.8);
    expect(score.reasons).toEqual([
      'same category PROVISION_TIMEOUT',
      'same dependency image-registry',
      '2 min from anchor',
    ]);
  });

  // Category alone, even with lab type and the same minute, never merges.
  it('keeps same-category failures without a shared dependency below the threshold', () => {
    const score = scorePair(
      failure('a', { dependencyId: null, labType: 'vm' }),
      failure('b', { dependencyId: null, labType: 'vm' }),
    );

    expect(score.score).toBe(0.55);
    expect(score.score).toBeLessThan(JOIN_THRESHOLD);
    expect(score.reasons).toContain('no shared dependency');
  });

  it('reaches the threshold exactly with category, dependency and nearby time', () => {
    expect(scorePair(failure('a'), failure('b', { occurredAt: at(10) })).score).toBe(0.7);
  });

  // Unrounded, these signals sum to 0.8500000000000001, which operators would see.
  it('reports a clean two-decimal score', () => {
    const sameType = { labType: 'vm' };
    expect(scorePair(failure('a', sameType), failure('b', sameType)).score).toBe(0.85);
  });
});

describe('clusterFailures', () => {
  it('groups a burst on one dependency into one cluster with reasons', () => {
    const { clusters } = clusterFailures(
      [failure('a'), failure('b', { occurredAt: at(1) }), failure('c', { occurredAt: at(3) })],
      [],
    );

    expect(clusters).toHaveLength(1);
    expect(clusters[0].anchor.id).toBe('a');
    expect(ids(clusters[0].members.map((m) => m.event))).toEqual(['b', 'c']);
  });

  // Mandatory: different category, same dependency and time, must not merge.
  it('does not merge different categories, even on the same dependency', () => {
    const { clusters } = clusterFailures(
      [failure('a'), failure('b', { errorCategory: 'NETWORK_CONFIG' })],
      [],
    );

    expect(clusters.map((c) => c.anchor.id)).toEqual(['a', 'b']);
    expect(clusters[1].nearMiss?.score.reasons[0]).toMatch(/different category/);
  });

  // Mandatory: A~B and B~C but A not~C gives two clusters, not one chain.
  it('blocks single-link chaining', () => {
    const a = failure('a');
    const b = failure('b', { occurredAt: at(10) });
    const c = failure('c', { occurredAt: at(20) });
    expect(scorePair(a, b).score).toBeGreaterThanOrEqual(JOIN_THRESHOLD);
    expect(scorePair(b, c).score).toBeGreaterThanOrEqual(JOIN_THRESHOLD);
    expect(scorePair(a, c).score).toBeLessThan(JOIN_THRESHOLD);

    const { clusters } = clusterFailures([a, b, c], []);

    expect(clusters.map((cl) => [cl.anchor.id, ...ids(cl.members.map((m) => m.event))])).toEqual([
      ['a', 'b'],
      ['c'],
    ]);
  });

  it('records why a failure did not join the nearest anchor', () => {
    const { clusters } = clusterFailures(
      [failure('a'), failure('b', { dependencyId: 'dep-other', dependencyKind: 'network' })],
      [],
    );

    expect(clusters[1].nearMiss).toMatchObject({ anchorEventId: 'a', score: { score: 0.5 } });
    expect(clusters[1].nearMiss?.score.reasons).toContain('no shared dependency');
  });

  it('offers new failures to an existing open incident first', () => {
    const anchor = failure('existing-anchor');

    const result = clusterFailures([failure('late', { occurredAt: at(2) })], [
      { incidentId: 'inc-1', anchor },
    ]);

    expect(result.joins.map((j) => [j.incidentId, j.event.id])).toEqual([['inc-1', 'late']]);
    expect(result.clusters).toHaveLength(0);
  });

  it('gives the same result whatever the input order', () => {
    const events = [
      failure('a'),
      failure('b', { occurredAt: at(1) }),
      failure('c', { errorCategory: 'PERMISSION_DENIED', dependencyId: null }),
      failure('d', { occurredAt: at(30) }),
    ];

    const forward = clusterFailures(events, []);
    const reversed = clusterFailures([...events].reverse(), []);

    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });
});

// The real demo data: across many seeds, the burst is one incident and every
// unrelated failure stands alone.
describe.each(Array.from({ length: 50 }, (_, i) => i + 1))('training-event seed %i', (seed) => {
  const scenario = SCENARIOS['training-event'](seed);
  const labType = new Map(scenario.labs.map((lab) => [lab.id, lab.labType]));
  const kind = new Map(scenario.dependencies.map((d) => [d.id, d.kind]));
  const seen = new Set<string>();
  const failures: FailureEvent[] = scenario.events
    .filter((e) => e.errorCategory && !seen.has(e.providerEventId) && seen.add(e.providerEventId))
    .map((e) => ({
      id: e.providerEventId,
      labId: e.labId,
      errorCategory: e.errorCategory!,
      dependencyId: e.dependencyId ?? null,
      dependencyKind: e.dependencyId ? (kind.get(e.dependencyId) ?? null) : null,
      labType: labType.get(e.labId)!,
      occurredAt: new Date(e.occurredAt),
    }));

  it('forms one 12-lab timeout incident and 7 single-lab incidents', () => {
    const { clusters } = clusterFailures(failures, []);
    const sizes = clusters.map((c) => c.members.length + 1).sort((x, y) => y - x);

    expect(sizes).toEqual([12, 1, 1, 1, 1, 1, 1, 1]);
    const burst = clusters.find((c) => c.members.length === 11);
    expect(burst?.anchor.errorCategory).toBe('PROVISION_TIMEOUT');
  });
});
