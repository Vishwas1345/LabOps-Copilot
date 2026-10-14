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

  const event = (
    lab: SimulatedLab,
    occurredAt: string,
    failure?: Pick<SimulatedEvent, 'errorCategory' | 'dependencyId' | 'message'>,
  ): SimulatedEvent => ({
    providerEventId: `${lab.id}-provision`,
    labId: lab.id,
    type: failure ? 'provision_failed' : 'provision_succeeded',
    ...(failure ?? { message: 'Provisioning completed' }),
    occurredAt,
    source: 'simulated',
  });

  const events: SimulatedEvent[] = [
    ...succeeded.map((lab) => event(lab, at(between(0, 30 * MINUTE)))),
    // The burst: one degraded dependency, all within a five-minute window.
    ...timeouts.map((lab) =>
      event(lab, at(between(10 * MINUTE, 15 * MINUTE)), {
        errorCategory: 'PROVISION_TIMEOUT',
        dependencyId: registry.id,
        message: 'VM provisioning timed out pulling the base image',
      }),
    ),
    // Unrelated: a per-lab role assignment problem, hours apart.
    ...permissionDenied.map((lab, i) =>
      event(lab, at((60 + i * 90) * MINUTE + between(0, 10 * MINUTE)), {
        errorCategory: 'PERMISSION_DENIED',
        message: 'Deployment identity lacks the Contributor role',
      }),
    ),
    // Unrelated: per-lab subnet misconfiguration, also spread out.
    ...networkConfig.map((lab, i) =>
      event(lab, at((45 + i * 120) * MINUTE + between(0, 10 * MINUTE)), {
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

/** Fixed epoch so timestamps are reproducible; not tied to the current date. */
export const TRAINING_EVENT_EPOCH = new Date('2026-01-15T09:00:00.000Z');

export const SCENARIOS = {
  'training-event': (seed: number) => createTrainingEvent(seed, TRAINING_EVENT_EPOCH),
} as const;

export type ScenarioName = keyof typeof SCENARIOS;
