// Anchor-based clustering. A failure joins a cluster only if it scores above
// the threshold against the cluster's anchor, never via another member, so a
// chain A~B, B~C cannot pull in an unrelated A and C.

import type { FailureEvent, PairScore } from './scoring.js';
import { JOIN_THRESHOLD, scorePair } from './scoring.js';

export interface ScoredMember {
  event: FailureEvent;
  score: PairScore;
}

/** The best anchor a failure was scored against and did not reach. */
export interface NearMiss {
  anchorEventId: string;
  score: PairScore;
}

export interface NewCluster {
  anchor: FailureEvent;
  /** Joined members, excluding the anchor. */
  members: ScoredMember[];
  /** Why the anchor itself did not join an earlier anchor, if it came close. */
  nearMiss: NearMiss | null;
}

export interface ExistingAnchor {
  incidentId: string;
  anchor: FailureEvent;
}

export interface ClusteringResult {
  joins: Array<ScoredMember & { incidentId: string }>;
  clusters: NewCluster[];
}

const byTimeThenId = (a: FailureEvent, b: FailureEvent) =>
  a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id);

// Inverted indexes: only failures sharing a category or a dependency are
// scored, since no pair without either can reach the threshold.
function buildIndex(events: FailureEvent[]): (anchor: FailureEvent) => FailureEvent[] {
  const byKey = new Map<string, FailureEvent[]>();
  const add = (key: string, event: FailureEvent) =>
    byKey.set(key, [...(byKey.get(key) ?? []), event]);
  for (const event of events) {
    add(`category:${event.errorCategory}`, event);
    if (event.dependencyId) add(`dependency:${event.dependencyId}`, event);
  }
  return (anchor) => {
    const keys = [`category:${anchor.errorCategory}`];
    if (anchor.dependencyId) keys.push(`dependency:${anchor.dependencyId}`);
    const candidates = new Set(keys.flatMap((key) => byKey.get(key) ?? []));
    return [...candidates].sort(byTimeThenId);
  };
}

/**
 * Deterministic for a given input: failures are taken in time order, first
 * offered to existing open incidents, then each unassigned failure anchors a
 * new cluster and gathers later failures that score high enough against it.
 */
export function clusterFailures(
  events: FailureEvent[],
  existing: ExistingAnchor[],
): ClusteringResult {
  const ordered = [...events].sort(byTimeThenId);
  const candidatesOf = buildIndex(ordered);
  const assigned = new Set<string>();
  const nearMisses = new Map<string, NearMiss>();
  const result: ClusteringResult = { joins: [], clusters: [] };

  const offer = (anchor: FailureEvent, onJoin: (member: ScoredMember) => void) => {
    for (const candidate of candidatesOf(anchor)) {
      if (candidate.id === anchor.id || assigned.has(candidate.id)) continue;
      const score = scorePair(anchor, candidate);
      if (score.score >= JOIN_THRESHOLD) {
        assigned.add(candidate.id);
        onJoin({ event: candidate, score });
      } else if (score.score > (nearMisses.get(candidate.id)?.score.score ?? -1)) {
        nearMisses.set(candidate.id, { anchorEventId: anchor.id, score });
      }
    }
  };

  const existingInOrder = [...existing].sort((a, b) => byTimeThenId(a.anchor, b.anchor));
  for (const { incidentId, anchor } of existingInOrder) {
    offer(anchor, (member) => result.joins.push({ ...member, incidentId }));
  }

  for (const anchor of ordered) {
    if (assigned.has(anchor.id)) continue;
    assigned.add(anchor.id);
    const nearMiss = nearMisses.get(anchor.id) ?? null;
    const cluster: NewCluster = { anchor, members: [], nearMiss };
    offer(anchor, (member) => cluster.members.push(member));
    result.clusters.push(cluster);
  }

  return result;
}
