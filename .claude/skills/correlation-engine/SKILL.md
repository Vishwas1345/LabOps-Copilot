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
  signals.ts       individual signal extractors
  scoring.ts       weight table and pair scoring
  clustering.ts    candidate generation + agglomeration
  service.ts       incident lifecycle, persistence
```

## Procedure

1. **Grouping is deterministic. No LLM in this module.** Not for merging, not
   for naming, not for deciding confidence. If a feature seems to want the
   model here, it belongs in `investigations`.

2. **Add new signals as data.** Extend the weight table rather than branching
   logic:

   ```ts
   const SIGNAL_WEIGHTS = {
     ERROR_CATEGORY: 0.30,
     SHARED_DEPENDENCY: 0.30,
     TEMPORAL_PROXIMITY: 0.20,
     PRECEDING_SEQUENCE: 0.10,
     TRANSITION_PATTERN: 0.05,
     LAB_TYPE_MATCH: 0.05,
   } as const;
   ```

   Every weight needs a rationale recorded next to it. "Why is this 0.30?" must
   have an answer that is not vibes.

3. **Generate candidates with inverted indices, not an O(n²) scan.** Index
   events by `(normalisedErrorCategory)`, `(dependencyId)` and `(timeBucket)`,
   then only score pairs that share an index key.

4. **Block single-link chaining.** Agglomeration must require the candidate to
   score above the threshold **against the cluster anchor**, not against any
   member. Without this, A~B and B~C merge A, B and C into one cluster even
   when A and C are unrelated — and the operator sees one meaningless
   mega-incident.

5. **Every included lab records why.** `IncidentLab` carries `reason` and
   `signalScore`. The UI renders this rationale verbatim. A correlation result
   an operator cannot interrogate is not an explainable correlation result.

6. **Correlation must be re-runnable without duplicating incidents.** Upsert
   against the correlation window key. Re-processing the same events must be a
   no-op, not a second incident.

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
