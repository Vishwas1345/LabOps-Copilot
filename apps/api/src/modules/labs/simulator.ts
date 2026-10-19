// Deterministic lab simulator: same seed and epoch, byte-identical scenario.
// No Math.random or Date.now; every value derives from the seed or the epoch.

import type { ErrorCategory } from './failures.js';

export interface SimulatedDependency {
  id: string;
  kind: string;
}

export interface SimulatedLab {
  id: string;
  name: string;
  labType: string;
  dependencyIds: string[];
}

export interface SimulatedEvent {
  /** Stable per logical event; a redelivery reuses it (the dedup key). */
  providerEventId: string;
  labId: string;
  type: 'provision_succeeded' | 'provision_failed';
  errorCategory?: ErrorCategory;
  /** Only set when the failure is attributable to a shared dependency. */
  dependencyId?: string;
  message: string;
  occurredAt: string;
  source: 'simulated';
}

export interface Scenario {
  name: string;
  seed: number;
  labs: SimulatedLab[];
  dependencies: SimulatedDependency[];
  events: SimulatedEvent[];
}

/** mulberry32: tiny, fast, good enough for test data; never for security. */
function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const MINUTE = 60_000;
const LAB_TYPES = ['azure-vm', 'aws-ec2', 'k8s-workshop'] as const;

type Failure = Pick<SimulatedEvent, 'errorCategory' | 'dependencyId' | 'message'>;

/** A lab's one provisioning outcome; its id is stable, so a redelivery reuses it. */
function provisionEvent(lab: SimulatedLab, occurredAt: string, failure?: Failure): SimulatedEvent {
  return {
    providerEventId: `${lab.id}-provision`,
    labId: lab.id,
    type: failure ? 'provision_failed' : 'provision_succeeded',
    ...(failure ?? { message: 'Provisioning completed' }),
    occurredAt,
    source: 'simulated',
  };
}

// A training event: 40 labs; one shared dependency degrades and times out a
// burst of 12, while permission and network failures are scattered and
// unrelated. They must not merge with the burst, which is what makes it a test.
export function createTrainingEvent(seed: number, epoch: Date): Scenario {
  const random = createPrng(seed);
  const at = (offsetMs: number) => new Date(epoch.getTime() + offsetMs).toISOString();
  const between = (min: number, max: number) => min + Math.floor(random() * (max - min));
  const prefix = `sim-training-event-${seed}`;

  const registry = { id: `${prefix}-dep-image-registry`, kind: 'image-registry' };
  const network = { id: `${prefix}-dep-network`, kind: 'virtual-network' };

  const labs: SimulatedLab[] = Array.from({ length: 40 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return {
      id: `${prefix}-lab-${n}`,
      name: `Training Lab ${n}`,
      labType: LAB_TYPES[Math.floor(random() * LAB_TYPES.length)],
      dependencyIds: [registry.id, network.id],
    };
  });

  const order = shuffle(labs, random);
  const timeouts = order.slice(0, 12);
  const permissionDenied = order.slice(12, 16);
  const networkConfig = order.slice(16, 19);
  const succeeded = order.slice(19);


  const events: SimulatedEvent[] = [
    ...succeeded.map((lab) => provisionEvent(lab, at(between(0, 30 * MINUTE)))),
    // The burst: one degraded dependency, all within a five-minute window.
    ...timeouts.map((lab) =>
      provisionEvent(lab, at(between(10 * MINUTE, 15 * MINUTE)), {
        errorCategory: 'PROVISION_TIMEOUT',
        dependencyId: registry.id,
        message: 'VM provisioning timed out pulling the base image',
      }),
    ),
    // Unrelated: a per-lab role assignment problem, hours apart.
    ...permissionDenied.map((lab, i) =>
      provisionEvent(lab, at((60 + i * 90) * MINUTE + between(0, 10 * MINUTE)), {
        errorCategory: 'PERMISSION_DENIED',
        message: 'Deployment identity lacks the Contributor role',
      }),
    ),
    // Unrelated: per-lab subnet misconfiguration, also spread out.
    ...networkConfig.map((lab, i) =>
      provisionEvent(lab, at((45 + i * 120) * MINUTE + between(0, 10 * MINUTE)), {
        errorCategory: 'NETWORK_CONFIG',
        message: 'Subnet address range overlaps an existing range',
      }),
    ),
  ];

  events.sort(
    (a, b) =>
      a.occurredAt.localeCompare(b.occurredAt) ||
      a.providerEventId.localeCompare(b.providerEventId),
  );

  // Platforms redeliver: the same event, verbatim, right after the original.
  const redelivered = events.findIndex((e) => e.errorCategory === 'PROVISION_TIMEOUT');
  events.splice(redelivered + 1, 0, { ...events[redelivered] });

  return {
    name: 'training-event',
    seed,
    labs,
    dependencies: [registry, network],
    events,
  };
}

// Shared outages: 15 labs on three dependencies, for the paths the training
// event never takes. A license server outage (a dependency recheck, which
// fixes nothing, so verification fails), a quota exhausted (no automated fix:
// the model escalates to a human), and two timeouts on one cache 25 minutes
// apart: alike, but too far apart in time to merge.
export function createSharedOutages(seed: number, epoch: Date): Scenario {
  const random = createPrng(seed);
  const at = (offsetMs: number) => new Date(epoch.getTime() + offsetMs).toISOString();
  const between = (min: number, max: number) => min + Math.floor(random() * (max - min));
  const prefix = `sim-shared-outages-${seed}`;

  const license = { id: `${prefix}-dep-license-server`, kind: 'license-server' };
  const quota = { id: `${prefix}-dep-subscription-quota`, kind: 'subscription-quota' };
  const cache = { id: `${prefix}-dep-artifact-cache`, kind: 'artifact-cache' };

  const labs: SimulatedLab[] = Array.from({ length: 15 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return {
      id: `${prefix}-lab-${n}`,
      name: `Workshop Lab ${n}`,
      labType: LAB_TYPES[Math.floor(random() * LAB_TYPES.length)],
      dependencyIds: [license.id, quota.id, cache.id],
    };
  });

  const order = shuffle(labs, random);
  const unavailable = order.slice(0, 6);
  const quotaExceeded = order.slice(6, 11);
  const [cacheFirst, cacheSecond] = order.slice(11, 13);
  const succeeded = order.slice(13);

  const cacheTimeout = {
    errorCategory: 'PROVISION_TIMEOUT',
    dependencyId: cache.id,
    message: 'Provisioning timed out fetching lab artifacts',
  } as const;

  const events: SimulatedEvent[] = [
    ...succeeded.map((lab) => provisionEvent(lab, at(between(0, 30 * MINUTE)))),
    ...unavailable.map((lab) =>
      provisionEvent(lab, at(between(10 * MINUTE, 15 * MINUTE)), {
        errorCategory: 'DEPENDENCY_UNAVAILABLE',
        dependencyId: license.id,
        message: 'License server did not respond during software activation',
      }),
    ),
    ...quotaExceeded.map((lab) =>
      provisionEvent(lab, at(between(60 * MINUTE, 65 * MINUTE)), {
        errorCategory: 'QUOTA_EXCEEDED',
        dependencyId: quota.id,
        message: 'Subscription vCPU quota exhausted for the region',
      }),
    ),
    // Past the 15-minute nearby limit, so time scores 0 and the pair stays
    // below the join threshold: the near miss operators can inspect.
    provisionEvent(cacheFirst, at(120 * MINUTE), cacheTimeout),
    provisionEvent(cacheSecond, at(145 * MINUTE), cacheTimeout),
  ];

  events.sort(
    (a, b) =>
      a.occurredAt.localeCompare(b.occurredAt) ||
      a.providerEventId.localeCompare(b.providerEventId),
  );

  return {
    name: 'shared-outages',
    seed,
    labs,
    dependencies: [license, quota, cache],
    events,
  };
}

/** Fixed epoch so timestamps are reproducible; not tied to the current date. */
export const TRAINING_EVENT_EPOCH = new Date('2026-01-15T09:00:00.000Z');
// Later the same day: after the training event's last failure, on its own
// dependencies, so nothing from the two scenarios can correlate.
export const SHARED_OUTAGES_EPOCH = new Date('2026-01-15T15:00:00.000Z');

export const SCENARIOS = {
  'training-event': (seed: number) => createTrainingEvent(seed, TRAINING_EVENT_EPOCH),
  'shared-outages': (seed: number) => createSharedOutages(seed, SHARED_OUTAGES_EPOCH),
} as const;

export type ScenarioName = keyof typeof SCENARIOS;
