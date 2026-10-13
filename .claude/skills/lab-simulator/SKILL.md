---
name: lab-simulator
description: Use when building or changing the deterministic lab simulator, failure modes, seeded scenarios or demo triggers. Covers fixed-seed reproducibility, normalised error categories, shared simulated dependencies, and labelling simulator output as simulated.
---

# Building or changing the lab simulator

## Preconditions

Read `CLAUDE.md §1` (framing) and `ARCHITECTURE.md §3` (trust boundaries). All
lab infrastructure is simulated. The simulator exists so the whole pipeline is
demonstrable without touching real cloud resources.

## Where things go

```
apps/api/src/labs/
  simulator.ts     scenario generation, failure injection
  transitions.ts   legal Lab status transitions
  service.ts       lab reads and lifecycle
```

## Procedure

1. **Determinism is the point.** The same seed produces byte-identical events,
   in the same order, every run. The demo walkthrough and the Playwright suite
   both depend on it. No `Math.random()`, no `Date.now()` inside scenario
   generation — derive timestamps from the scenario's fixed epoch.

   ```ts
   export function createScenario(seed: number, epoch: Date): Scenario {
     // seeded PRNG, not Math.random
   }
   ```

2. **Use normalised error categories, never raw strings.** The enum is the
   contract correlation depends on:

   ```
   PROVISION_TIMEOUT | NETWORK_CONFIG | PERMISSION_DENIED
   | DEPENDENCY_UNAVAILABLE | QUOTA_EXCEEDED | VALIDATION_FAILED
   ```

   Generate these. Never let the simulator emit free-text error messages that
   correlation then tries to match on — that is the bug the whole design
   exists to avoid.

3. **Model shared dependencies explicitly.** A `Dependency` row that several
   labs reference is what makes correlation demonstrable. Without shared
   dependencies there is nothing to correlate on.

4. **Include the negative material in every scenario.** A realistic scenario
   contains, at minimum:
   - a cluster sharing one dependency
   - unrelated failures that must **not** merge
   - at least one duplicate event
   - at least one action that will fail a precondition

   A scenario where everything succeeds demonstrates nothing.

5. **Never import the simulator from the API or worker paths that handle real
   provider data.** The simulator is one implementation behind the same
   interface as a provider adapter.

## Lab state machine

Transitions are declared as data in `transitions.ts`, not scattered
`status = '...'` assignments:

```text
provisioning → ready | failed
failed       → recovering | stopped
recovering   → ready | failed
ready        → stopped
```

An illegal transition throws identically in the API, the worker and the tests.

## Labelling

- Scenario-trigger responses return `source: 'simulated'`.
- The dashboard must show simulator data as simulated.
- Log lines carry a `simulated: true` field.
- Never write UI copy implying a live CloudLabs connection was tested.

## Mandatory tests

- Same seed → identical event sequence, asserted structurally
- Different seeds → different scenarios, and unrelated failures stay unclustered
- Duplicate event inserted → one `OperationalEvent`, second insert acknowledged
  as duplicate
- Illegal lab transition throws

## Verify

```bash
npm run db:generate && npm run db:push
npm run build -w @labops/api
```

Trigger the scenario twice and diff the resulting events. If they differ, the
seed is leaking.
