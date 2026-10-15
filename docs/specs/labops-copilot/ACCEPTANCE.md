# LabOps Copilot — acceptance map

Each acceptance criterion in [SPEC.md](./SPEC.md), and the test or screen that
proves it. Paths are under `apps/`. "E2E" is the browser journey in
`web/e2e/journey.spec.ts`, run in CI against the compose stack with the fixture
model; its step names are quoted.

A criterion with no automated proof is listed as a gap, not hidden.

| # | Criterion | Proven by |
|---|---|---|
| 1 | The same scenario twice gives the same labs, failures and incidents | `api/src/labs/simulator.test.ts` "produces byte-identical output for the same seed"; `api/src/demo/routes.int.test.ts` "is idempotent for the same seed" |
| 2 | Failures sharing one dependency become one incident | `api/src/incidents/clustering.test.ts` "forms one 12-lab timeout incident and 7 single-lab incidents"; E2E "2. related failures group" |
| 3 | Unrelated permission failures do not join it | `api/src/incidents/clustering.test.ts` "does not merge different categories, even on the same dependency"; `api/src/incidents/correlate.int.test.ts` "does not merge identical raw messages with different categories"; E2E "the permission failure stays apart" |
| 4 | Every affected lab shows why it was included and its link strength | `api/src/incidents/correlate.int.test.ts` "merges different messages with the same category, with readable reasons"; E2E "3. each lab shows why it was included and how strongly" |
| 5 | The same event twice appears once and creates no extra incident | `api/src/events/routes.int.test.ts` "returns 201 for a new event and 200 for its redelivery"; `api/src/jobs/jobs.int.test.ts` "collapses duplicate sends of one key into one job"; `api/src/metrics/metrics.int.test.ts` counts the scenario's redelivery once |
| 6 | An investigation shows cause, supporting evidence, missing or contradicting evidence, and uncertainty | `api/src/investigations/investigate.int.test.ts` "stores a fixture diagnosis and hands its action to policy"; E2E "4. the investigation shows cause, evidence and uncertainty" |
| 7 | Malformed AI output or a timeout leaves the incident unchanged and is audited | `api/src/investigations/investigate.int.test.ts` "handles %s without damaging the incident" (timeout, prose, unknown field, off-list action, refusal, provider error); `api/src/investigations/provider.test.ts` "times out a provider that never answers" |
| 8 | Text telling the AI to approve or ignore rules changes nothing | `api/src/investigations/provider.test.ts` "gives the same structured answer with an injected instruction"; `api/src/investigations/investigate.int.test.ts` "keeps injected text inert and secrets out of the prompt"; `api/src/investigations/evidence.test.ts` "keeps the policy fixed and the injected text inside the data block" |
| 9 | An off-list action, or a lab outside the incident, is never offered for approval | `api/src/investigations/investigate.int.test.ts` "an action outside the allow-list" (SCHEMA_REJECTED) and "drops a hallucinated target lab"; `api/src/investigations/output-schema.test.ts` "drops target labs outside the incident and reports them" |
| 10 | A retry for a permission failure is blocked and the rule is shown | `api/src/recovery/propose.int.test.ts` "blocks a retry on a permission failure at the state step, and audits why"; `api/src/recovery/workflow.int.test.ts` (a stub model recommends the retry; policy blocks it at `state`). **Gap:** the blocked card is not exercised in a browser. The default fixture model never recommends a blocked action, and no production path from the UI reaches one, so the journey cannot show it. |
| 11 | An approved action runs in the background and the screen updates without a refresh | `api/src/recovery/approve.int.test.ts` "records the approver from the session and queues one execute job"; E2E "7. a double-clicked approval runs once, verified without a reload" (asserts zero full page loads) |
| 12 | Approve clicked twice, or two operators at once, runs once | `api/src/recovery/approve.int.test.ts` "queues one job when two approvals race"; `api/src/recovery/execute.int.test.ts` "changes nothing when the same job runs again"; E2E step 7 (double click, one approval, one start) |
| 13 | Lab state changed after approval blocks execution and shows why | `api/src/recovery/execute.int.test.ts` "blocks a lab that changed after approval" (blocked at `state`, audited) |
| 14 | An approval past its expiry cannot run | `api/src/recovery/approve.int.test.ts` "expires a late approval and sends the incident to manual review"; `api/src/recovery/execute.int.test.ts` "blocks an approval that expired before execution"; `api/src/recovery/expire.int.test.ts` |
| 15 | Recovery whose verification fails does not resolve the incident | `api/src/recovery/execute.int.test.ts` "does not resolve an incident while any of its labs is still failed" and "never resolves through a read-only recheck" |
| 16 | Verification passing resolves the incident and shows before/after state | `api/src/recovery/execute.int.test.ts` "retries, verifies every lab is ready, and only then resolves"; E2E step 7 ("Before: 12 failed · After: 12 ready") |
| 17 | The audit history lists every step with actor and time | `api/src/recovery/workflow.int.test.ts` (the incident's history holds every step, and none of another incident's); E2E "8. the timeline records every step with its actor", including the rejection |
| 18 | A signed-out visitor cannot investigate, approve or reject | `api/src/auth/auth.int.test.ts` "rejects every non-public route without a session"; E2E "a signed-out visitor is sent to sign in" |
| 19 | Saved integration credentials never appear again | `api/src/integrations/integrations.int.test.ts` "never echoes the credential in any response" and "is recorded in the audit, without the credential" |
| 20 | Every simulated lab and screen is labelled simulated | `api/src/labs/simulator.test.ts` "labels every event as simulated and sorts by time"; the banner in `web/src/app/layout.tsx`; E2E "every screen says the data is simulated" |
| 21 | Demo controls are unavailable outside local and demo environments | `api/src/demo/routes.int.test.ts` "does not exist when DEMO_ENABLED is false" |
| 22 | One incident can be followed from first event to verified recovery through logs and a single trace | **Partly.** `api/src/jobs/trace.int.test.ts` "continues the ingest trace in the worker" proves one trace spans the API and the worker. Following one incident through the logs and a trace viewer is a manual walkthrough, written up in Phase 15. |
