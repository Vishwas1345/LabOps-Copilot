// Legal lab status moves, declared as data so API, worker and tests agree.
// The DB enum decides which statuses exist; this map decides the moves.

import type { LabStatus as DbLabStatus } from '@prisma/client';

export const LAB_STATUSES = [
  'provisioning',
  'ready',
  'failed',
  'recovering',
  'stopped',
] as const;

export type LabStatus = (typeof LAB_STATUSES)[number];

// Fails typecheck if this list and the DB enum ever differ.
const _statusesMatchDatabase: [LabStatus] extends [DbLabStatus]
  ? [DbLabStatus] extends [LabStatus]
    ? true
    : never
  : never = true;

export const LAB_TRANSITIONS: Readonly<
  Record<LabStatus, readonly LabStatus[]>
> = {
  provisioning: ['ready', 'failed'],
  ready: ['stopped'],
  failed: ['recovering', 'stopped'],
  recovering: ['ready', 'failed'],
  stopped: ['provisioning'],
};

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: LabStatus,
    readonly to: LabStatus,
  ) {
    super(`illegal lab transition: ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export function isLabStatus(value: unknown): value is LabStatus {
  return (
    typeof value === 'string' &&
    (LAB_STATUSES as readonly string[]).includes(value)
  );
}

/** Statuses reachable from `from`. Empty when the lab is terminal. */
export function nextStatuses(from: LabStatus): readonly LabStatus[] {
  return LAB_TRANSITIONS[from];
}

export function canTransition(from: LabStatus, to: LabStatus): boolean {
  return LAB_TRANSITIONS[from].includes(to);
}

/** Throws unless the move is declared above. */
export function assertTransition(from: LabStatus, to: LabStatus): void {
  if (!canTransition(from, to)) {
    throw new IllegalTransitionError(from, to);
  }
}