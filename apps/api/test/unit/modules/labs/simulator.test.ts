import { afterEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CATEGORIES } from '../../../../src/modules/labs/failures.js';
import { RECOVERY_OUTCOMES, simulateRetry } from '../../../../src/modules/labs/recovery-simulator.js';
import type { SimulatedEvent } from '../../../../src/modules/labs/simulator.js';
import {
  createTrainingEvent,
  SCENARIOS,
  SHARED_OUTAGES_EPOCH,
  TRAINING_EVENT_EPOCH,
} from '../../../../src/modules/labs/simulator.js';

const MINUTE = 60_000;
const time = (e: SimulatedEvent) => Date.parse(e.occurredAt);
const ofCategory = (events: SimulatedEvent[], category: string) =>
  events.filter((e) => e.errorCategory === category);
const failedLabNumbers = (seed: number) =>
  SCENARIOS['training-event'](seed)
    .events.filter((e) => e.type === 'provision_failed')
    .map((e) => e.labId.slice(-2))
    .sort();

afterEach(() => {
  vi.useRealTimers();
});

describe('determinism', () => {
  it('produces byte-identical output for the same seed', () => {
    const first = JSON.stringify(SCENARIOS['training-event'](42));
    const second = JSON.stringify(SCENARIOS['training-event'](42));

    expect(second).toBe(first);
  });

  // Negative: a scenario must not depend on when it runs.
  it('ignores the wall clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
    const early = JSON.stringify(SCENARIOS['training-event'](7));
    vi.setSystemTime(new Date('2031-06-30T23:59:59Z'));
    const late = JSON.stringify(SCENARIOS['training-event'](7));

    expect(late).toBe(early);
  });

  // Negative: a hardcoded scenario would pass the test above; this would not.
  it('produces a different failure set for a different seed', () => {
    expect(failedLabNumbers(1)).not.toEqual(failedLabNumbers(2));
  });

  it('derives every timestamp from the epoch', () => {
    const epoch = new Date('2030-03-01T00:00:00.000Z');
    const scenario = createTrainingEvent(3, epoch);

    for (const e of scenario.events) {
      expect(time(e)).toBeGreaterThanOrEqual(epoch.getTime());
      expect(time(e)).toBeLessThan(epoch.getTime() + 8 * 60 * MINUTE);
    }
  });
});

// Structural properties checked across many seeds, not one lucky one.
describe.each(Array.from({ length: 50 }, (_, i) => i + 1))('seed %i', (seed) => {
  const scenario = SCENARIOS['training-event'](seed);
  const timeouts = ofCategory(scenario.events, 'PROVISION_TIMEOUT');
  const unrelated = [
    ...ofCategory(scenario.events, 'PERMISSION_DENIED'),
    ...ofCategory(scenario.events, 'NETWORK_CONFIG'),
  ];

  it('has the expected composition', () => {
    const unique = new Set(scenario.events.map((e) => e.providerEventId));

    expect(scenario.labs).toHaveLength(40);
    expect(scenario.dependencies).toHaveLength(2);
    expect(unique.size).toBe(40);
    expect(scenario.events).toHaveLength(41);
    expect(new Set(timeouts.map((e) => e.labId)).size).toBe(12);
    expect(ofCategory(scenario.events, 'PERMISSION_DENIED')).toHaveLength(4);
    expect(ofCategory(scenario.events, 'NETWORK_CONFIG')).toHaveLength(3);
  });

  it('contains exactly one verbatim redelivery', () => {
    const seen = new Map<string, SimulatedEvent>();
    const duplicates: SimulatedEvent[] = [];
    for (const e of scenario.events) {
      if (seen.has(e.providerEventId)) {
        duplicates.push(e);
        expect(e).toEqual(seen.get(e.providerEventId));
      }
      seen.set(e.providerEventId, e);
    }
    expect(duplicates).toHaveLength(1);
  });

  it('puts the timeout burst on one dependency within five minutes', () => {
    const registry = scenario.dependencies.find((d) => d.kind === 'image-registry');
    const times = timeouts.map(time);

    expect(timeouts.every((e) => e.dependencyId === registry?.id)).toBe(true);
    expect(Math.max(...times) - Math.min(...times)).toBeLessThanOrEqual(5 * MINUTE);
  });

  // Negative material: these must stay separate from the burst and each other.
  it('keeps unrelated failures off any shared dependency and spread out', () => {
    expect(unrelated.every((e) => e.dependencyId === undefined)).toBe(true);
    for (const e of unrelated) {
      for (const t of timeouts) {
        expect(Math.abs(time(e) - time(t))).toBeGreaterThanOrEqual(30 * MINUTE);
      }
    }
    for (const category of ['PERMISSION_DENIED', 'NETWORK_CONFIG']) {
      const times = ofCategory(scenario.events, category).map(time).sort((a, b) => a - b);
      for (let i = 1; i < times.length; i += 1) {
        expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(30 * MINUTE);
      }
    }
  });

  it('labels every event as simulated and sorts by time', () => {
    expect(scenario.events.every((e) => e.source === 'simulated')).toBe(true);
    const times = scenario.events.map(time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe.each(Array.from({ length: 50 }, (_, i) => i + 1))('shared-outages seed %i', (seed) => {
  const scenario = SCENARIOS['shared-outages'](seed);
  const dependency = (kind: string) => scenario.dependencies.find((d) => d.kind === kind)?.id;
  const burst = (category: string, kind: string) => {
    const events = ofCategory(scenario.events, category);
    const times = events.map(time);
    expect(events.every((e) => e.dependencyId === dependency(kind))).toBe(true);
    expect(Math.max(...times) - Math.min(...times)).toBeLessThanOrEqual(5 * MINUTE);
    return events;
  };

  it('has the expected composition, with no redelivery', () => {
    expect(scenario.labs).toHaveLength(15);
    expect(scenario.dependencies).toHaveLength(3);
    expect(new Set(scenario.events.map((e) => e.providerEventId)).size).toBe(15);
    expect(scenario.events).toHaveLength(15);
    expect(scenario.events.every((e) => e.source === 'simulated')).toBe(true);
  });

  it('puts each outage on its own dependency within five minutes', () => {
    expect(burst('DEPENDENCY_UNAVAILABLE', 'license-server')).toHaveLength(6);
    expect(burst('QUOTA_EXCEEDED', 'subscription-quota')).toHaveLength(5);
  });

  // Negative material: the lookalike pair matches on category and dependency
  // but must be past the nearby limit, or it would merge.
  it('keeps the lookalike timeouts more than 15 minutes apart', () => {
    const cache = ofCategory(scenario.events, 'PROVISION_TIMEOUT');

    expect(cache).toHaveLength(2);
    expect(cache.every((e) => e.dependencyId === dependency('artifact-cache'))).toBe(true);
    expect(time(cache[1]) - time(cache[0])).toBeGreaterThan(15 * MINUTE);
  });

  // Negative: nothing here may correlate with the training event's failures.
  it('starts after the training event and shares none of its dependencies', () => {
    const training = SCENARIOS['training-event'](seed);
    const lastTraining = Math.max(...training.events.map(time));
    const theirs = new Set(training.dependencies.map((d) => d.id));

    expect(Math.min(...scenario.events.map(time)) - lastTraining).toBeGreaterThan(15 * MINUTE);
    expect(scenario.dependencies.some((d) => theirs.has(d.id))).toBe(false);
  });
});

describe('recovery outcomes', () => {
  // The scenario's story: the burst recovers on retry, the scattered
  // configuration and permission failures do not.
  it('lets a retry fix a timeout but not a configuration problem', () => {
    expect(simulateRetry('PROVISION_TIMEOUT')).toBe('ready');
    expect(simulateRetry('NETWORK_CONFIG')).toBe('failed');
    expect(simulateRetry('PERMISSION_DENIED')).toBe('failed');
    expect(simulateRetry(null)).toBe('failed');
  });

  it('decides an outcome for every failure category', () => {
    expect(Object.keys(RECOVERY_OUTCOMES).sort()).toEqual([...ERROR_CATEGORIES].sort());
  });

  it('uses a fixed epoch', () => {
    expect(TRAINING_EVENT_EPOCH.toISOString()).toBe('2026-01-15T09:00:00.000Z');
    expect(SHARED_OUTAGES_EPOCH.toISOString()).toBe('2026-01-15T15:00:00.000Z');
  });
});
