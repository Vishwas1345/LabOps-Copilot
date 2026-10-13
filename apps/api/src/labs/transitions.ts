/**
 * Lab lifecycle transitions declared as data rather than scattered status
 * assignments, so the API, the worker and the tests all reject the same
 * illegal moves (CLAUDE.md 6).
 *
 * The Prisma model currently stores `status` as a String. Converting it to a
 * native enum is tracked as part of the database-model work; until then these
 * literals are the single source of truth at the application boundary.
 */

export const LAB_STATUSES = [
  'provisioning',
  'ready',
  'failed',
  'recovering',
  'stopped',
] as const;

export type LabStatus = (typeof LAB_STATUSES)[number];

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

/**
 * Throws unless the move is declared above. Callers inside a transaction use
 * this rather than branching, so an illegal transition cannot be written by
 * accident.
 */
export function assertTransition(from: LabStatus, to: LabStatus): void {
  if (!canTransition(from, to)) {
    throw new IllegalTransitionError(from, to);
  }
}