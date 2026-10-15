---
name: correlation-engine
description: Use when adding, tuning or reviewing incident correlation - signals, scoring, clustering, thresholds, or the correlation explanation shown to operators. Covers deterministic grouping, single-link-chain blocking, anchor scoring, and re-runnability.
---

# Working on the correlation engine

## Preconditions

Read `ARCHITECTURE.md §8` and `CLAUDE.md §6` (correlation rules).

Correlation answers **"do these failures belong together?"** It does **not** answer
**"why did this fail?"** Root-cause reasoning belongs to the LLM. Keeping those
two apart is what makes this system explainable and testable.

## Where things go

```
apps/api/src/incidents/
  scoring.ts       signal extraction, weight table and pair scoring
  clustering.ts    candidate generation + agglomeration
  correlate.job.ts the correlate job: loads the window, clusters, creates
                   incidents and their audit entries
  service.ts       incident reads, transitions, scope locking
```

## Procedure

1. **Grouping is deterministic. No LLM in this module.** Not for merging, not
   for naming, not for deciding confidence. If a feature seems to want the
   model here, it belongs in `investigations`.

2. **Add new signals as data.** Extend the weight table rather than branching
   logic:

   ```ts
   export const SIGNAL_WEIGHTS = {
     errorCategory: 0.3,
     sharedDependency: 0.3,
     temporalProximity: 0.2,
     labType: 0.05,
   } as const;
   export const JOIN_THRESHOLD = 0.7;
   ```

   Preceding-sequence and transition-pattern signals are not built: they need
   labs with event history.

   Every weight needs a rationale recorded next to it. "Why is this 0.30?" must
   have an answer that is not vibes.

3. **Generate candidates with inverted indices, not an O(n²) scan.** Index
   events by normalised error category and by dependency id, then only score
   pairs that share a key: no pair without either can reach the threshold.

4. **Block single-link chaining.** Agglomeration must require the candidate to
   score at or above the threshold **against the cluster anchor**, not against any
   member. Without this, A~B and B~C merge A, B and C into one cluster even
   when A and C are unrelated — and the operator sees one meaningless
   mega-incident.

5. **Every included lab records why.** `IncidentLab` carries `reason` and
   `signalScore`. The UI renders this rationale verbatim. A correlation result
   an operator cannot interrogate is not an explainable correlation result.

6. **Correlation must be re-runnable without duplicating incidents.** A run
   skips failures already in an incident, under an advisory lock, and a partial
   unique index on the window key backs it. Re-processing the same events must
   be a no-op, not a second incident.

7. **Keep the possibility of false correlation visible.** `confidenceScore` is
   labelled correlation strength. Never render it as certainty, and never show
   it without the reasons that produced it.

## Forbidden

- Merging on raw error string equality
- Letting the LLM merge, split or name clusters
- Hiding the score breakdown from the UI
- Silently dropping a lab that scored below threshold — record why

## Mandatory negative test

This is the single most important test in the project:

- Two failures with the **same raw error string** but different normalised
  categories must **not** merge.
- Two failures with different raw strings but the **same** normalised category
  **must** merge, and the reason must be readable.
- A chain A~B, B~C where A and C do not score above threshold must produce two
  clusters, not one.
- Re-running correlation over the same window produces no duplicate incidents.

## Verify

```bash
npm run build -w @labops/api
```

Run correlation over a seeded scenario and read the persisted `IncidentLab`
reasons. If you cannot explain every inclusion from the stored rows, the
explanation is not finished.
