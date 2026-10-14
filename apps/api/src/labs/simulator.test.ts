import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SimulatedEvent } from './simulator.js';
import { createTrainingEvent, SCENARIOS, TRAINING_EVENT_EPOCH } from './simulator.js';

const MINUTE = 60_000;
const time = (e: SimulatedEvent) => Date.parse(e.occurredAt);
const ofCategory = (events: SimulatedEvent[], category: string) =>
  events.filter((e) => e.errorCategory === category);
const failedLabNumbers = (seed: number) =>
  SCENARIOS['training-event'](seed)
    .events.filter((e) => e.type === 'provision.failed')
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

describe('recovery outcomes', () => {
  it('lets a retry fix a timeout but not a configuration problem', () => {
    expect(SCENARIOS['training-event'](42).recoveryOutcomes).toEqual({
      PROVISION_TIMEOUT: 'recovers',
      NETWORK_CONFIG: 'still_failing',
      PERMISSION_DENIED: 'still_failing',
    });
  });

  it('uses a fixed epoch', () => {
    expect(TRAINING_EVENT_EPOCH.toISOString()).toBe('2026-01-15T09:00:00.000Z');
  });
});
